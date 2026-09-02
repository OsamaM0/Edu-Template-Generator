/* ============================================================================
   routes.mjs — the unified endpoint
   ----------------------------------------------------------------------------
     GET|POST /api/pipeline/document        build (or serve) a document → JSON
     GET      /api/pipeline/document/:key   what was built under that key
     DELETE   /api/pipeline/document/:key   drop it, so the next call rebuilds
     GET      /api/pipeline/data/:key       the worksheet JSON behind the page
     GET      /api/pipeline/lesson/:idx     the normalized lesson, for inspection
     GET      /api/pipeline/types           the document types and their counts
     GET      /api/pipeline/cache           what is cached  ·  DELETE empties it
     GET      /api/pipeline/health          extension + store status
     GET      /t/:key                     the built page itself

   Sheets issued to a student, answered, and analysed:
     POST     /api/pipeline/assign          issue a single-use answer link
                                          — or a whole class, with "students":[…]
     POST     /api/pipeline/batch           a roster in, one exam link per student out
     GET      /a/:id?t=<token>            that link — the answerable sheet
     POST     /api/pipeline/submit          {assignment_id, token, answers} → analysis
     GET      /api/pipeline/assignments     what has been issued, newest first
     GET      /api/pipeline/assignment/:id  one issued sheet  ·  DELETE revokes it
     GET      /api/pipeline/result/:id      the analysis JSON
     GET      /api/pipeline/report/:id      the analysis as a page

   The store, read-only — what this platform has produced:
     GET      /api/pipeline/store           document counts, per collection
     GET      /api/pipeline/documents       every sheet generated so far
     GET      /api/pipeline/documents/:key/questions   its questions and key
     GET      /api/pipeline/links           every issued link and its status
     GET      /api/pipeline/students/:id/results       one student's history
     GET      /api/pipeline/analytics/questions        which item was got wrong
     GET      /api/pipeline/analytics/goals?group_id=  what to reteach

   There are no roster endpoints. Schools, teachers, classes and students belong
   to the partner platform: they arrive as parameters on the request that asks
   for a sheet, and are stored as snapshots on what we issue. Nothing here is
   the authority on who a student is.

   A class at a time — every sheet issued with the same group_id:
     GET      /api/pipeline/groups          the groups that exist, with counts
     GET      /api/pipeline/group/:id       the full group analysis, as JSON
     GET      /api/pipeline/group/:id/dashboard  the same analysis, as a page
     GET      /api/pipeline/group/:id/answers    every answer every student sent
     DELETE   /api/pipeline/group/:id       revoke the links still outstanding

   Passing student_id to /document issues an answer link alongside the sheet, so
   one call gives a teacher both the printable copy and the student's link. Every
   call issues a NEW link; submitting kills the one that was used. Adding a
   group_id files that link under a group, which is what the dashboard reads.

   The request is the same three things whether it arrives as a query string or
   a JSON body: what to build, which lesson, and the seed.

     { "type": "worksheet", "document_idx": "43617", "seed": 7 }

   exam_date fills the date field every template carries — the one that used to
   print empty for someone to write in by hand. It is part of the cache key,
   because it changes the printed bytes.

     { "type": "worksheet", "document_idx": "43617", "exam_date": "2026-09-15" }

   Pages are rendered with root-relative asset links (baseUrl: ""), so one
   cached copy is correct behind localhost, a domain, or a reverse proxy — the
   HTML never hard-codes the host it happened to be built on.
   ========================================================================== */
import crypto from "node:crypto";

import { renderPage, validate } from "../render-page.mjs";

import config, { configProblems } from "./config.mjs";
import { loadLesson, ping, clearLessonCache } from "./source.mjs";
import { buildDocument, typeDocs, knownTypes, normType } from "./build/index.mjs";
import { seedFrom } from "./rng.mjs";
import { pageUrl, verifyPageToken, signingEnabled } from "./sign.mjs";
import { normalizeStudent, normalizeGroup, normalizeSchool, normalizeTeacher, normalizeExamDate,
  publicQuestions } from "./build/common.mjs";
import * as cache from "./cache.mjs";

import * as store from "./answers/store.mjs";
import { gradeAll } from "./answers/grade.mjs";
import { analyze } from "./answers/analyze.mjs";
import { renderReport, renderClosedPage } from "./answers/report.mjs";
import { publish, readResult } from "./answers/deliver.mjs";
import { collect, listGroups, analyseGroup, groupAnswers } from "./answers/group.mjs";
import { renderDashboard } from "./answers/dashboard.mjs";

import { stats as storeStats, checkAccess, settings as storeSettings } from "../store/index.mjs";
import { documents as documentStore, results as resultStore, assignments, audit }
  from "../store/repo.mjs";

const VERSION = "1.1.0";
const MAX_BODY = Number(process.env.EDU_MAX_BODY || 4_000_000);
const API_KEY = process.env.EDU_API_KEY || "";

/* ---------------------------------------------------------------- plumbing -- */

const JSON_TYPE = "application/json; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";

function sendJson(res, status, obj){
  const body = Buffer.from(JSON.stringify(obj, null, 2), "utf8");
  res.writeHead(status, { "Content-Type": JSON_TYPE, "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function sendHtml(res, status, html, headers){
  const body = Buffer.from(html, "utf8");
  res.writeHead(status, Object.assign({ "Content-Type": HTML_TYPE, "Content-Length": body.length }, headers || {}));
  res.end(body);
}

const fail = (res, status, code, message, detail) =>
  sendJson(res, status, { error: { code, message, detail: detail || undefined } });

function readBody(req){
  return new Promise((ok, bad) => {
    const chunks = [];
    let size = 0, done = false;

    req.on("data", c => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY){
        done = true;
        req.pause();
        bad(Object.assign(new Error(`Request body exceeds the ${MAX_BODY}-byte limit`), { status: 413, code: "body-too-large" }));
        return;
      }
      chunks.push(c);
    });
    req.on("end",   () => { if (!done) ok(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", e  => { if (!done){ done = true; bad(e); } });
  });
}

async function readJson(req){
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch (e){ throw Object.assign(new Error("Request body is not valid JSON"), { status: 400, code: "invalid-json", detail: e.message }); }
}

const truthy = v => v != null && v !== "" && !/^(0|false|no|off)$/i.test(String(v));
const falsy  = v => v != null && /^(0|false|no|off)$/i.test(String(v));

function originOf(req){
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host  = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

/**
 * Who is asking, as far as an audit row is concerned. Behind a proxy the socket
 * address is the proxy, so the forwarded header is preferred — it is not proof
 * of anything, but neither is a log line, and "which address opened this link"
 * is worth more than nothing when a student says the link was already used.
 */
const clientOf = req => ({
  ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
  userAgent: String(req.headers["user-agent"] || "")
});

/** RFC 5987 filename, so Arabic lesson titles survive Content-Disposition. */
function disposition(name){
  const clean = String(name).replace(/[\\/:*?"<>|\r\n]+/g, "").trim() || "document";
  const file  = clean.toLowerCase().endsWith(".html") ? clean : `${clean}.html`;
  const ascii = file.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

/* ------------------------------------------------------------------ params -- */

const firstOf = (source, keys) => {
  for (const key of keys){
    const v = source[key];
    if (v != null && v !== "") return v;
  }
  return undefined;
};

/**
 * Counts arrive three ways, all equivalent:
 *   body   { "counts": { "multiple_choice": 5 } }
 *   query  ?count.multiple_choice=5   or   ?count_multiple_choice=5
 *   query  ?counts={"multiple_choice":5}
 */
function readCounts(body, query){
  const out = {};

  if (body.counts && typeof body.counts === "object") Object.assign(out, body.counts);

  const inline = query.get("counts");
  if (inline){
    try { Object.assign(out, JSON.parse(inline)); }
    catch { throw Object.assign(new Error("?counts= is not valid JSON."), { status: 400, code: "invalid-counts" }); }
  }

  for (const [key, value] of query){
    const m = key.match(/^counts?[._[]([A-Za-z_-]+)\]?$/);
    if (m) out[m[1]] = value;
  }
  return out;
}

/**
 * Who the sheet is for.
 *
 * Accepted three ways, because three kinds of caller send it three ways:
 *   ?student_id=12345&student_name=أحمد          a link built by hand
 *   { "student_id": "12345", "student_name": … }  a flat integration
 *   { "student": { "id": "12345", "name": … } }   a system that has a student object
 *
 * Returns null when nothing identifies a student, which is the classroom-copy
 * case — a blank sheet with editable name fields, exactly as before.
 */
function readStudent(body, both){
  const nested = (body && typeof body.student === "object" && !Array.isArray(body.student)) ? body.student : null;

  const flat = {
    id: firstOf(both, ["student_id", "studentId", "studentid"]),
    name: firstOf(both, ["student_name", "studentName", "studentname"]),
    classroom: firstOf(both, ["student_class", "studentClass", "classroom", "grade", "class"]),
    section: firstOf(both, ["student_section", "studentSection", "section"])
  };

  // A bare ?student=12345 is an id, not a name — that is what the parameter
  // means everywhere else in this API.
  if (flat.id == null && !nested && typeof both.student === "string") flat.id = both.student;

  return normalizeStudent(nested ? { ...nested, ...clean(flat) } : flat);
}

/** Drop the keys nothing was supplied for, so a nested object is not overwritten. */
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));

/**
 * Which group this sheet belongs to.
 *
 * Same three spellings as the student, for the same reason:
 *   ?group_id=lesson-43617-oct&group_name=الخامس/ب
 *   { "group_id": "lesson-43617-oct", "group_name": "الخامس/ب" }
 *   { "group": { "id": "lesson-43617-oct", "name": "الخامس/ب" } }
 *
 * A bare ?group=lesson-43617-oct is an id — the id is what everything joins on,
 * and a name that cannot be looked up is not worth accepting in its place.
 *
 * The group is NOT part of the cache key: it changes nothing on the printed
 * page, and putting it there would fragment one class's identical sheets into
 * one cache entry per class for no gain (see cache.canonicalRequest).
 */
function readGroup(body, both){
  const nested = (body && typeof body.group === "object" && !Array.isArray(body.group)) ? body.group : null;

  const flat = {
    id: firstOf(both, ["group_id", "groupId", "groupid", "lesson_group", "class_id", "cohort"]),
    name: firstOf(both, ["group_name", "groupName", "groupname", "cohort_name"])
  };

  if (flat.id == null && !nested && typeof both.group === "string") flat.id = both.group;

  return normalizeGroup(nested ? { ...nested, ...clean(flat) } : flat);
}

/**
 * The school and the teacher the sheet is issued under.
 *
 * The same three spellings the student takes, for the same reason:
 *   ?school=ثانوية الأمير&teacher=أ. سارة الحارثي
 *   ?school_id=SCH-19&school_name=ثانوية الأمير
 *   { "teacher": { "id": "T-7", "name": "أ. سارة الحارثي" } }
 *
 * A bare ?school= / ?teacher= is the NAME, where a bare ?student= is an id —
 * there is no school or teacher list here to resolve an id against, and the
 * name is the half that gets printed (see build/common.normalizeSchool).
 *
 * Both ARE part of the cache key, like the student and unlike the group: they
 * change the printed bytes (see cache.canonicalRequest).
 */
function readSchool(body, both){
  const nested = (body && typeof body.school === "object" && !Array.isArray(body.school)) ? body.school : null;

  const flat = {
    id: firstOf(both, ["school_id", "schoolId", "schoolid"]),
    name: firstOf(both, ["school_name", "schoolName", "schoolname"])
      ?? (typeof both.school === "string" ? both.school : undefined)
  };

  return normalizeSchool(nested ? { ...nested, ...clean(flat) } : flat);
}

function readTeacher(body, both){
  const nested = (body && typeof body.teacher === "object" && !Array.isArray(body.teacher)) ? body.teacher : null;

  const flat = {
    id: firstOf(both, ["teacher_id", "teacherId", "teacherid"]),
    name: firstOf(both, ["teacher_name", "teacherName", "teachername"])
      ?? (typeof both.teacher === "string" ? both.teacher : undefined)
  };

  return normalizeTeacher(nested ? { ...nested, ...clean(flat) } : flat);
}

/**
 * When the sheet is sat.
 *
 * Every template carries a date field and every one of them used to print it
 * empty. `exam_date` is what fills it — one value, read the same way on every
 * document type, so a class sitting the same exam gets sheets that agree:
 *
 *   ?exam_date=2026-09-15
 *   { "exam_date": "2026-09-15" }
 *   { "exam": { "date": "2026-09-15" } }
 *
 * A year-first date is formatted for the sheet; anything else is printed as
 * sent, which is what makes "الأسبوع الرابع" a usable answer too.
 *
 * It IS part of the cache key — unlike the group — because it changes the
 * printed bytes (see cache.canonicalRequest).
 */
function readExamDate(body, both){
  const nested = (body && typeof body.exam === "object" && !Array.isArray(body.exam)) ? body.exam : null;

  return normalizeExamDate(
    firstOf(both, ["exam_date", "examDate", "examdate", "exam_day", "date", "sitting_date", "test_date"]) ??
    (nested ? firstOf(nested, ["date", "exam_date", "day"]) : undefined)
  );
}

/** One request shape, whatever the caller used to express it. */
function readRequest(body, query){
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const q = Object.fromEntries(query);
  const both = { ...b, ...q };   // query wins, so a stored POST can be re-aimed from the URL

  const type = firstOf(both, ["type", "document_type", "documentType", "doc_type", "docType", "template", "kind"]);
  const documentIdx = firstOf(both, ["document_idx", "documentIdx", "documentIndex", "idx", "document", "doc_id", "lesson"]);

  if (documentIdx == null || String(documentIdx).trim() === ""){
    throw Object.assign(
      new Error('"document_idx" is required — the lesson to build from.'),
      { status: 400, code: "missing-document-idx" }
    );
  }

  const request = {
    type: type == null || String(type).trim() === "" ? "worksheet" : String(type),
    documentIdx: String(documentIdx).trim(),
    // Normalized here, not at build time: ?seed=4 and {"seed":4} are the same
    // request, and an un-normalized seed would hash them to two cache entries.
    seed: seedFrom(firstOf(both, ["seed", "random_seed", "randomSeed"]) ?? 0),
    counts: readCounts(b, query),
    theme: firstOf(both, ["theme", "age"]) || null,
    refresh: truthy(firstOf(both, ["refresh", "rebuild", "force", "fresh"]))
  };

  /* The student, when there is one. Part of the request rather than a wrapper
     around it: the identity is printed ON the sheet, so it belongs to the same
     object every builder and the cache key already read. */
  const student = readStudent(b, both);
  if (student) request.student = student;

  /* The group, when there is one. Filed with the issued sheet, never rendered
     on it — which is why it rides along here but stays out of the cache key. */
  const group = readGroup(b, both);
  if (group) request.group = group;

  /* Who it is issued under. Printed on the sheet — into the header rows that
     were blank lines until now — so they ride beside the student for the same
     reason the day does. */
  const school = readSchool(b, both);
  if (school) request.school = school;

  const teacher = readTeacher(b, both);
  if (teacher) request.teacher = teacher;

  /* The day it is sat, when the caller named one. Printed on the sheet, so it
     rides in the request beside the student rather than beside the group. */
  const examDate = readExamDate(b, both);
  if (examDate) request.examDate = examDate;

  /* Whether this call should also mint a single-use answer link. On by default
     once a student is named — "issue a sheet to أحمد" and "give أحمد a link to
     answer it" are the same intent — and ?assign=0 opts out for a teacher who
     only wants the printable copy. */
  request.issue = student ? !falsy(firstOf(both, ["assign", "issue", "answerable"])) : false;

  // Optional main color — a palette name (teal, blue…) or a hex value. Part of
  // the render, so it is part of the cache key (see cache.canonicalRequest).
  const color = firstOf(both, ["color", "accent", "main_color", "mainColor"]);
  if (color != null && String(color).trim() !== "") request.color = String(color).trim();

  // Render options — each one changes the HTML, so each one is part of the key.
  if (both.standalone != null)  request.standalone  = truthy(both.standalone);
  if (both.interactive != null) request.interactive = !falsy(both.interactive);
  if (both.toolbar != null)     request.toolbar     = !falsy(both.toolbar);
  if (both.embed != null)       request.embed       = truthy(both.embed);
  if (both.image != null)       request.autoImage   = truthy(both.image);
  if (both.print != null)       request.autoPrint   = truthy(both.print);
  if (both.autoImage != null)   request.autoImage   = truthy(both.autoImage);
  if (both.autoPrint != null)   request.autoPrint   = truthy(both.autoPrint);
  if (both.title)               request.title       = String(both.title);

  // An embedded page has no room for the floating toolbar unless asked for.
  if (request.embed && both.toolbar == null) request.toolbar = false;

  if (!normType(request.type)){
    throw Object.assign(
      new Error(`Unknown type "${request.type}". Known types: ${knownTypes().join(", ")}.`),
      { status: 400, code: "unknown-type" }
    );
  }
  return request;
}

/* ------------------------------------------------------------------- build -- */

/**
 * The Pipeline brand logo, on every generated sheet. Root-relative so the
 * cached HTML stays host-agnostic (the same server serves /assets), and the
 * browser caches the image once rather than per page.
 * Override per environment with EDU_PIPELINE_LOGO.
 */
const PAGE_LOGO = {
  src: process.env.EDU_PIPELINE_LOGO || "/assets/img/logo.png",
  width: Number(process.env.EDU_PIPELINE_LOGO_WIDTH) || 96
};

/** Concurrent first-hits on the same key wait on one build instead of racing. */
const inflight = new Map();

async function buildPage(request){
  const key = cache.cacheKey(request);

  if (inflight.has(key)) return inflight.get(key);

  const work = (async () => {
    const lesson = await loadLesson(request.documentIdx, { fresh: request.refresh });
    const built = buildDocument(lesson, request);

    const check = validate(built.data);
    if (!check.valid){
      throw Object.assign(
        new Error(`Built a "${built.type}" document the engine cannot render.`),
        { status: 500, code: "invalid-document", detail: check.errors.join(" ") }
      );
    }

    const page = await renderPage(built.data, {
      theme: request.theme || undefined,
      standalone: !!request.standalone,
      interactive: request.interactive !== false,
      toolbar: request.toolbar !== false,
      embed: !!request.embed,
      autoImage: !!request.autoImage,
      autoPrint: !!request.autoPrint,
      title: request.title || undefined,
      baseUrl: "",
      logo: PAGE_LOGO
    });

    const meta = await cache.put(key, page.html, {
      request: cache.canonicalRequest(request),
      type: built.type,
      template: page.template,
      theme: page.theme,
      documentIdx: lesson.documentIdx,
      lessonTitle: lesson.title,
      title: page.title,
      seed: built.seed,
      examDate: built.examDate,
      school: built.school,
      teacher: built.teacher,
      counts: built.counts,
      color: built.color,
      used: built.used,
      sources: lesson.found,
      warnings: [...built.warnings, ...check.warnings],
      builtAt: new Date().toISOString()
    });

    /* The record of what was generated, beside the cached bytes: the request it
       came from, the questions that were drawn, and the key they are graded
       against. Awaited — an exam whose questions were not recorded is worth
       knowing about — but never fatal, because a page that renders and does not
       file is still a page the teacher asked for. */
    try {
      await documentStore.record({
        key, built, request: cache.canonicalRequest(request), meta,
        lessonTitle: lesson.title,
        subject: lesson.subject || null,
        school: request.school || null,
        teacher: request.teacher || null
      });
      audit.log({ action: "document.build", entityType: "documents", entityId: key,
        actorType: "api", detail: { type: built.type, document_idx: lesson.documentIdx, seed: built.seed } });
    } catch (err){
      console.warn(`[pipeline] built page ${key} was not recorded: ${err.message}`);
    }

    return { key, html: page.html, meta };
  })().finally(() => inflight.delete(key));

  inflight.set(key, work);
  return work;
}

/** The cached page if there is one, otherwise a fresh build. */
async function getOrBuild(request){
  const key = cache.cacheKey(request);

  if (!request.refresh){
    const hit = await cache.get(key);
    if (hit) return { key, html: hit.html, meta: hit.meta, cached: true };
  }

  const built = await buildPage(request);
  return { ...built, cached: false };
}

/* ------------------------------------------------------------- assignments -- */

/**
 * Rebuild the DOCUMENT (not the page) behind a request.
 *
 * The answer key and the goal list are not stored in the page cache: they would
 * be served by /document/<key> to anyone holding the key, and a cache is not
 * the right place for the answers to a live sheet. They are re-derived instead,
 * which costs a memoized Mongo read and a pure function — and guarantees the
 * key matches the sheet, because it is produced by the same call that produced
 * the sheet.
 */
async function documentFor(request){
  const lesson = await loadLesson(request.documentIdx, { fresh: !!request.refresh });
  return { lesson, built: buildDocument(lesson, request) };
}

/**
 * Hand this sheet to this student, once.
 *
 * Returns null — not an error — when the document type asks no questions. A
 * lesson plan or a golden-minutes card is a perfectly good thing to generate
 * for a named student; there is simply nothing to submit, so there is no link
 * to issue and the caller is told why in `warnings`.
 */
async function issueFor(request, pageKey){
  const { lesson, built } = await documentFor(request);
  if (!built.answerable) return null;

  return store.issue({
    student: request.student,
    group: request.group || null,
    school: built.school || null,
    teacher: built.teacher || null,
    examDate: built.examDate || null,
    type: built.type,
    documentIdx: lesson.documentIdx,
    lessonTitle: lesson.title,
    title: built.title,
    seed: built.seed,
    pageKey,
    request: cache.canonicalRequest(request),
    answerKey: built.answerKey,
    goals: built.goals,
    scoring: built.scoring,
    profile: built.profile
  });
}

/** The URLs an issued sheet has: the student's, and the teacher's report. */
const assignmentLinks = (origin, record) => ({
  answer_url: `${origin}${config.answerPrefix}/${record.id}?t=${encodeURIComponent(record.token)}`,
  report_url: `${origin}${config.apiPrefix}/report/${record.id}?t=${encodeURIComponent(record.token)}`,
  result_url: `${origin}${config.apiPrefix}/result/${record.id}?t=${encodeURIComponent(record.token)}`,
  status_url: `${origin}${config.apiPrefix}/assignment/${record.id}`
});

/** Where a group's four views live. */
const groupLinks = (origin, groupId) => {
  const base = `${origin}${config.apiPrefix}/group/${encodeURIComponent(groupId)}`;
  return {
    group_url: base,
    dashboard_url: `${base}/dashboard`,
    answers_url: `${base}/answers`,
    assignments_url: `${origin}${config.apiPrefix}/assignments?group_id=${encodeURIComponent(groupId)}`
  };
};

const describeAssignment = (origin, record) => ({
  ...store.describe(record),
  ...assignmentLinks(origin, record),
  ...(record.groupId ? { group_dashboard_url: groupLinks(origin, record.groupId).dashboard_url } : {})
});

/* ---------------------------------------------------------------- responses -- */

/**
 * Page links carry their own signature when EDU_PIPELINE_PAGE_SECRET is set.
 * Each variant is signed separately rather than sharing one token, so handing
 * someone the embed URL does not also hand them the rest.
 */
function links(origin, key){
  const page = extra => pageUrl(origin, config.pagePrefix, key, extra);
  return {
    url: page(),
    embedUrl: page({ embed: 1 }),
    printUrl: page({ print: 1 }),
    imageUrl: page({ image: 1 }),
    downloadUrl: page({ download: 1 }),
    dataUrl: `${origin}${config.apiPrefix}/data/${key}`,
    infoUrl: `${origin}${config.apiPrefix}/document/${key}`
  };
}

const describe = (origin, key, meta, cached) => ({
  ok: true,
  cached,
  key,
  type: meta.type,
  template: meta.template,
  theme: meta.theme,
  document_idx: meta.documentIdx,
  lessonTitle: meta.lessonTitle,
  title: meta.title,
  seed: meta.seed,
  exam_date: meta.examDate ? (meta.examDate.iso || meta.examDate.text) : undefined,
  exam_date_text: meta.examDate ? meta.examDate.text : undefined,
  school: meta.school || undefined,
  teacher: meta.teacher || undefined,
  counts: meta.counts,
  color: meta.color,
  used: meta.used,
  sources: meta.sources,
  builtAt: meta.builtAt,
  bytes: meta.bytes,
  ...links(origin, key),
  warnings: meta.warnings && meta.warnings.length ? meta.warnings : undefined
});

/* ------------------------------------------------------------------ handlers -- */

async function handleDocument(req, res, url){
  const body = req.method === "POST" ? await readJson(req) : {};
  const request = readRequest(body, url.searchParams);
  const origin = originOf(req);

  const { key, html, meta, cached } = await getOrBuild(request);
  const format = String(url.searchParams.get("format") || body.format || "json").toLowerCase();

  if (format === "html"){
    const headers = { "X-Edu-Template": meta.template, "X-Pipeline-Key": key, "X-Pipeline-Cached": String(cached), "Cache-Control": "no-store" };
    if (truthy(url.searchParams.get("download"))) headers["Content-Disposition"] = disposition(meta.title);
    return sendHtml(res, 200, html, headers);
  }

  if (format === "redirect"){
    res.writeHead(302, { Location: links(origin, key).url, "Cache-Control": "no-store" });
    return res.end();
  }

  const payload = describe(origin, key, meta, cached);

  /* A named student gets a link of their own alongside the sheet. Issued after
     the page is built, so a build that fails never leaves a dangling record —
     and issued on EVERY call, because "a new request creates a new link" is the
     rule the revocation model rests on. */
  if (request.issue){
    const record = await issueFor(request, key);
    if (record){
      payload.assignment = describeAssignment(origin, record);
      payload.answer_url = payload.assignment.answer_url;
    } else {
      payload.warnings = [
        ...(payload.warnings || []),
        `A "${meta.type}" document asks no questions, so no answer link was issued. Use type=worksheet or type=cards for a sheet a student can submit.`
      ];
    }
  }

  return sendJson(res, cached && !request.issue ? 200 : 201, payload);
}

/**
 * POST /api/pipeline/assign — issue an answer link, and nothing else.
 *
 * /document with a student_id does this too; this endpoint exists because
 * "give this student a new attempt" is its own action, and it should not have
 * to be spelled as a document request that happens to have a side effect.
 *
 * A "students": [...] array issues the whole class in one call, under one
 * group_id. Sheets are built one after another rather than all at once: each
 * student's copy is its own render (their name is on it), and a class of forty
 * arriving as forty concurrent builds would be a burst for no gain.
 */
async function handleAssign(req, res, url){
  const body = req.method === "POST" ? await readJson(req) : {};
  const request = readRequest(body, url.searchParams);
  const origin = originOf(req);

  const roster = readRoster(body, url);
  if (roster) return assignMany(res, request, roster, origin, url);

  if (!request.student){
    return fail(res, 400, "missing-student",
      '"student_id" is required to issue an answer link.',
      'Send { "student_id": "…", "student_name": "…" } with the document request, or a "students": [ … ] array to issue a whole group.');
  }

  const { key } = await getOrBuild(request);
  const record = await issueFor(request, key);

  if (!record){
    return fail(res, 422, "not-answerable",
      `A "${request.type}" document asks no questions, so there is nothing to submit.`,
      "Issue a worksheet or a card deck instead.");
  }

  return sendJson(res, 201, {
    ok: true,
    ...describeAssignment(origin, record),
    page_url: links(origin, key).url,
    ...(request.group ? { group: request.group, ...groupLinks(origin, request.group.id) } : {})
  });
}

/* ------------------------------------------------------------------ rosters -- */

/** The most students one call issues. A bigger class is several calls. */
const ROSTER_LIMIT = Number(process.env.EDU_PIPELINE_ROSTER_LIMIT || 200);

/**
 * A roster entry → the student it names, plus the overrides it carries.
 *
 * An entry is a bare id ("STU-1042"), or an object. The object is a student,
 * and it may also re-aim the request for that one student: a different seed
 * (so no two sheets in a room carry the same draw), a different sitting date
 * (a make-up exam), or a different lesson entirely.
 */
function readRosterEntry(entry){
  if (typeof entry === "string" || typeof entry === "number"){
    return { student: normalizeStudent({ id: entry }), overrides: {} };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { student: null, overrides: {} };

  const student = normalizeStudent({
    id: firstOf(entry, ["id", "student_id", "studentId"]),
    name: firstOf(entry, ["name", "student_name", "studentName", "full_name"]),
    classroom: firstOf(entry, ["classroom", "class", "grade", "student_class"]),
    section: firstOf(entry, ["section", "student_section"])
  });

  const overrides = {};

  const seed = firstOf(entry, ["seed", "random_seed", "randomSeed"]);
  if (seed != null) overrides.seed = seedFrom(seed);

  const examDate = normalizeExamDate(firstOf(entry, ["exam_date", "examDate", "date"]));
  if (examDate) overrides.examDate = examDate;

  const documentIdx = firstOf(entry, ["document_idx", "documentIdx", "lesson"]);
  if (documentIdx != null) overrides.documentIdx = String(documentIdx).trim();

  const type = firstOf(entry, ["type", "document_type", "documentType"]);
  if (type != null) overrides.type = String(type);

  return { student, overrides };
}

/**
 * A per-student seed derived from the base seed and the student's identity.
 *
 * Deterministic, not random: re-running the same batch has to hand every
 * student back the sheet they already have, or a re-issued link would ask
 * different questions from the printed copy in front of them.
 */
function seedForStudent(baseSeed, student){
  const who = `${student.id || ""}|${student.name || ""}`;
  const hash = crypto.createHash("sha256").update(`${baseSeed}:${who}`).digest();
  return seedFrom(hash.readUInt32BE(0));
}

/**
 * One call, one group, one link per student.
 *
 * A student whose entry names nobody is REPORTED, not fatal: a roster pasted
 * from a spreadsheet has blank rows in it, and failing thirty-nine links
 * because of the fortieth would be the wrong trade. The caller is told exactly
 * which rows were skipped and why.
 *
 * Sheets are built one after another rather than all at once: each student's
 * copy is its own render (their name is on it), and a class of forty arriving
 * as forty concurrent builds would be a burst for no gain.
 *
 * Never throws for one bad row. Returns {issued, skipped}.
 */
async function issueRoster(request, roster, origin, options = {}){
  const uniqueSeed = !!options.uniqueSeed;
  const issued = [];
  const skipped = [];

  for (const [index, entry] of roster.entries()){
    const { student, overrides } = readRosterEntry(entry);
    if (!student){
      skipped.push({ index, reason: "no student id or name", entry });
      continue;
    }

    /* The call's request, re-aimed at this student. Their own seed wins over
       the derived one, which wins over the call's — a roster that spells out a
       seed for one student means it. */
    const one = {
      ...request,
      ...overrides,
      student,
      seed: overrides.seed != null ? overrides.seed
          : uniqueSeed ? seedForStudent(request.seed, student)
          : request.seed,
      issue: true
    };

    try {
      const { key } = await getOrBuild(one);
      const record = await issueFor(one, key);

      if (!record){
        skipped.push({ index, student, reason: `a "${one.type}" document asks no questions` });
        continue;
      }
      issued.push({ ...describeAssignment(origin, record), page_url: links(origin, key).url });

    } catch (err){
      // One student's build failing is that student's problem, not the class's.
      skipped.push({ index, student, reason: err.message });
    }
  }

  return { issued, skipped };
}

/** The roster as an array, or null when the caller sent none. */
function readRoster(body, url){
  if (Array.isArray(body.students)) return body.students;
  if (Array.isArray(body.roster))   return body.roster;

  /* ?students=STU-1,STU-2 — ids only, for a call made from a browser bar or a
     shell. Anything richer than an id needs the JSON body. */
  const inline = url.searchParams.get("students") || url.searchParams.get("student_ids");
  if (inline) return inline.split(",").map(v => v.trim()).filter(Boolean);

  return null;
}

/** Refuses a roster that is empty or larger than one call handles. */
function rosterProblem(roster){
  if (!roster.length){
    return { code: "empty-roster", message: '"students" is an empty array — nothing to issue.' };
  }
  if (roster.length > ROSTER_LIMIT){
    return {
      code: "roster-too-large",
      message: `"students" holds ${roster.length} entries; ${ROSTER_LIMIT} is the most one call issues.`,
      detail: "Split the class into several calls under the same group_id — they land in the same group."
    };
  }
  return null;
}

/** Did the caller ask for a per-student draw? */
const wantsUniqueSeed = both =>
  truthy(firstOf(both, ["unique_seed", "uniqueSeed", "vary_seed", "vary", "shuffle_per_student"]));

async function assignMany(res, request, roster, origin, url){
  const problem = rosterProblem(roster);
  if (problem) return fail(res, 400, problem.code, problem.message, problem.detail);

  const uniqueSeed = wantsUniqueSeed(Object.fromEntries(url.searchParams));
  const { issued, skipped } = await issueRoster(request, roster, origin, { uniqueSeed });

  return sendJson(res, issued.length ? 201 : 422, {
    ok: issued.length > 0,
    group: request.group || null,
    issued: issued.length,
    skipped: skipped.length ? skipped : undefined,
    assignments: issued,
    ...(request.group ? groupLinks(origin, request.group.id) : {}),
    note: request.group
      ? "Every link above is filed under this group — the dashboard reads them as they come back."
      : "No group_id was sent, so these links are not grouped. Pass group_id to get a dashboard over them."
  });
}

/* -------------------------------------------------------------------- batch -- */

/**
 * POST /api/pipeline/batch — a roster in, a list of exam links out.
 *
 * /assign issues ONE link and grew a "students" array as a convenience. /batch
 * is the other way round: the roster is the point, so it is required, no
 * top-level student is needed, and the response leads with a flat `links`
 * array — one row per student, the exam link and nothing to dig through —
 * which is the shape a caller mail-merges or writes into their own system.
 *
 *   {
 *     "type": "worksheet",
 *     "document_idx": "43617",
 *     "exam_date": "2026-09-15",
 *     "group_id": "g5b-midterm",
 *     "unique_seed": true,
 *     "students": [
 *       "STU-1042",
 *       { "id": "STU-1043", "name": "...", "classroom": "..." },
 *       { "id": "STU-1044", "name": "...", "exam_date": "2026-09-22", "seed": 12 }
 *     ]
 *   }
 *
 * `unique_seed` gives every student their own draw of the same lesson, derived
 * from their identity so the batch stays repeatable — re-running it hands each
 * student back the sheet they already hold rather than a new one.
 *
 * A partial batch is a SUCCESS: the links that could be issued come back beside
 * the rows that could not, because thirty-nine working links plus a named
 * failure is worth more to a teacher than a 400 with nothing in it.
 */
async function handleBatch(req, res, url){
  const body = req.method === "POST" ? await readJson(req) : {};
  const roster = readRoster(body, url);

  if (!roster){
    return fail(res, 400, "missing-students",
      '"students" is required — batch issues one link per student.',
      'Send { "document_idx": "43617", "students": [ "STU-1042", { "id": "STU-1043", "name": "..." } ] }, or ?students=STU-1042,STU-1043 for ids alone.');
  }

  const problem = rosterProblem(roster);
  if (problem) return fail(res, 400, problem.code, problem.message, problem.detail);

  const request = readRequest(body, url.searchParams);
  const origin = originOf(req);

  const both = { ...body, ...Object.fromEntries(url.searchParams) };
  const uniqueSeed = wantsUniqueSeed(both);

  const { issued, skipped } = await issueRoster(request, roster, origin, { uniqueSeed });

  /* The headline: one flat row per student. Everything needed to hand a link
     over — who it is for, where it opens, when it dies — with the full
     assignment record still there under `assignments` for anyone who wants it. */
  const linkRows = issued.map(a => ({
    student_id:   (a.student && a.student.id) || "",
    student_name: (a.student && a.student.name) || "",
    classroom:    (a.student && a.student.classroom) || "",
    section:      (a.student && a.student.section) || "",
    assignment_id: a.assignment_id,
    exam_url:   a.answer_url,
    report_url: a.report_url,
    exam_date:  a.exam_date || "",
    seed: a.seed,
    expires_at: a.expires_at
  }));

  return sendJson(res, issued.length ? 201 : 422, {
    ok: issued.length > 0,
    requested: roster.length,
    issued: issued.length,
    failed: skipped.length,
    type: request.type,
    document_idx: request.documentIdx,
    exam_date: request.examDate ? (request.examDate.iso || request.examDate.text) : "",
    exam_date_text: request.examDate ? request.examDate.text : "",
    school: request.school || null,
    teacher: request.teacher || null,
    unique_seed: uniqueSeed,
    group: request.group || null,
    /* The point of the endpoint. */
    links: linkRows,
    skipped: skipped.length ? skipped : undefined,
    assignments: issued,
    ...(request.group ? groupLinks(origin, request.group.id) : {}),
    note: request.group
      ? "Every link above is filed under this group — the dashboard reads them as they come back."
      : "No group_id was sent, so these links are not grouped. Pass group_id to get a dashboard over them."
  });
}

/* ------------------------------------------------------------- answer page -- */

/**
 * GET /a/<id>?t=<token> — the sheet, answerable.
 *
 * Rendered fresh rather than served from the page cache. The page carries the
 * assignment's token in window.EDU_ANSWER, so caching it would mean caching one
 * student's credentials under a key another student can compute.
 */
async function handleAnswerPage(req, res, id, url){
  const record = await store.get(id);
  const gate = store.openable(record, url.searchParams.get("t"));
  const client = clientOf(req);

  if (!gate.ok){
    /* Recorded before the page is sent: "the link says it is closed" is a
       support question, and the answer is in this row. */
    if (record) store.noteRefusal(id, gate.code, client);
    // A student clicked a link; answer with a page, not with a JSON error.
    return sendHtml(res, gate.status, renderClosedPage(gate.status, gate.message), { "Cache-Control": "no-store" });
  }

  const stored = record.request;
  const request = {
    ...stored,
    documentIdx: stored.documentIdx,
    student: record.student,
    // The student's copy is theirs to answer, not to reprint or re-theme.
    toolbar: false,
    interactive: true
  };

  const { built } = await documentFor(request);

  const origin = originOf(req);
  const page = await renderPage(built.data, {
    theme: request.theme || undefined,
    standalone: false,
    interactive: true,
    toolbar: false,
    embed: !!request.embed,
    baseUrl: "",
    logo: PAGE_LOGO,
    answer: {
      assignmentId: record.id,
      token: record.token,
      submitUrl: `${config.apiPrefix}/submit`,
      student: record.student,
      // Ids and kinds only — the key stays on this side of the wire.
      questions: publicQuestions(record.answerKey)
    }
  });

  await store.markOpened(record, client);

  return sendHtml(res, 200, page.html, {
    "X-Edu-Template": built.template,
    "X-Pipeline-Assignment": record.id,
    "Cache-Control": "no-store",
    // A single-use answer sheet must never be reachable from a shared cache.
    "Referrer-Policy": "no-referrer"
  });
}

/* ---------------------------------------------------------------- submitting -- */

/**
 * POST /api/pipeline/submit — {assignment_id, token, answers:{question_id: answer}}
 *
 * The link is closed BEFORE the answers are graded. Grading, the report and the
 * backend call all happen afterwards and none of them can reopen it: a failure
 * downstream must not turn into a second submission, and the answers are on
 * disk either way, so a re-grade is always possible.
 */
async function handleSubmit(req, res, url){
  const body = await readJson(req);
  const id = body.assignment_id || body.assignmentId || url.searchParams.get("assignment_id");
  const token = body.token || url.searchParams.get("t");

  const record = await store.get(id);
  const gate = store.openable(record, token);
  const client = clientOf(req);
  if (!gate.ok){
    if (record) store.noteRefusal(id, gate.code, client);
    return fail(res, gate.status, gate.code, gate.message);
  }

  const answers = (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers))
    ? body.answers
    : {};

  const submittedAt = new Date().toISOString();
  await store.markSubmitted(record, submittedAt, client);  // the link dies here

  const graded = gradeAll(record.answerKey, answers);
  const analysis = analyze({ assignment: record, graded, goals: record.goals, answers, submittedAt });
  /* The page key travels with the analysis so the stored result can be joined
     back to the exact document the student answered. */
  analysis.page_key = record.pageKey || "";
  const published = await publish(analysis, {
    ...client,
    source: "web",
    durationSec: Number(body.duration_sec || body.durationSec) || null
  });

  const origin = originOf(req);
  return sendJson(res, 201, {
    ok: true,
    message: "تم استلام إجاباتك وتحليلها. لم يعد هذا الرابط صالحاً.",
    assignment_id: record.id,
    student: record.student,
    document_idx: record.documentIdx,
    lesson_title: record.lessonTitle,
    submitted_at: submittedAt,
    overall: analysis.overall,
    goals: analysis.goals,
    report: analysis.report,
    // Present only on a survey: the dominant style and its advice. answer.js
    // shows this instead of a mark when it is there.
    profile: analysis.profile,
    ...assignmentLinks(origin, record),
    output: published.output,
    delivery: published.delivery
  });
}

/* ------------------------------------------------------------------ results -- */

/**
 * A result may be read by the API key holder, or by whoever holds the
 * assignment's own token — which is what lets the student's own browser open
 * the report it was just handed a link to.
 */
function resultAllowed(req, record, url){
  if (hasApiKey(req)) return true;
  return store.sameToken(url.searchParams.get("t") || "", record.token);
}

async function handleResult(req, res, id, url, as){
  const record = await store.get(id);
  if (!record) return fail(res, 404, "not-found", `No assignment "${id}".`);

  if (!resultAllowed(req, record, url)){
    return fail(res, 401, "unauthorized",
      "Reading a result needs the API key or the assignment's own token (?t=).");
  }

  const analysis = await readResult(id);
  if (!analysis){
    return fail(res, 404, "no-result",
      record.status === store.STATUS.SUBMITTED
        ? `Assignment "${id}" was submitted but its result file is missing.`
        : `Assignment "${id}" has not been submitted yet (status: ${record.status}).`);
  }

  if (as === "html"){
    return sendHtml(res, 200, renderReport(analysis), { "Cache-Control": "no-store" });
  }
  return sendJson(res, 200, analysis);
}


/* ------------------------------------------------------------------ groups -- */

/**
 * A group id is compared against stored records and echoed into pages, never
 * joined onto a filesystem path — but it arrives from a URL, so it is checked
 * before it is used rather than trusted because of where it happens to go.
 */
const GROUP_RE = /^[\p{L}\p{N} ._:@-]{1,64}$/u;
const isGroupId = v => GROUP_RE.test(String(v == null ? "" : v));

/** Read the group once, with the results its submitted sheets produced. */
async function loadGroup(res, groupId, url){
  if (!isGroupId(groupId)){
    fail(res, 400, "bad-group-id",
      `"${groupId}" is not a group id.`,
      "Up to 64 characters: letters, digits, spaces, and . _ - : @");
    return null;
  }

  const gathered = await collect(groupId, {
    documentIdx: url.searchParams.get("document_idx") || undefined,
    status: url.searchParams.get("status") || undefined
  });

  if (!gathered.records.length){
    fail(res, 404, "no-group",
      `No sheet has been issued under group "${groupId}".`,
      `Issue one with POST ${config.apiPrefix}/assign and a "group_id".`);
    return null;
  }
  return gathered;
}

/**
 * GET /api/pipeline/group/:id — the whole class, as JSON or as a page.
 *
 * Computed per request rather than cached. The numbers change every time a
 * student submits, and a dashboard that is stale by one submission is a
 * dashboard a teacher stops trusting; reading a few dozen small JSON files is
 * cheap next to that.
 */
async function handleGroup(req, res, groupId, url, as){
  const gathered = await loadGroup(res, groupId, url);
  if (!gathered) return;

  const origin = originOf(req);
  const analysis = analyseGroup({
    groupId,
    records: gathered.records,
    results: gathered.results,
    links: record => assignmentLinks(origin, record)
  });

  if (as === "html"){
    return sendHtml(res, 200, renderDashboard(analysis), { "Cache-Control": "no-store" });
  }
  return sendJson(res, 200, { ...analysis, ...groupLinks(origin, groupId) });
}

/**
 * GET /api/pipeline/group/:id/answers — every answer every student in the group
 * sent, raw and graded, with the link to each student's own full report.
 *
 * Deliberately separate from the analysis: one is what the class MEANS and the
 * other is what it SAID, and a caller exporting answers into their own system
 * should not have to download the roll-up to get them.
 */
async function handleGroupAnswers(req, res, groupId, url){
  const gathered = await loadGroup(res, groupId, url);
  if (!gathered) return;

  const origin = originOf(req);
  const studentId = url.searchParams.get("student_id");

  const records = studentId
    ? gathered.records.filter(r => String(r.studentId) === String(studentId))
    : gathered.records;

  const payload = groupAnswers({
    groupId,
    records,
    results: gathered.results,
    links: record => assignmentLinks(origin, record)
  });

  return sendJson(res, 200, { ...payload, ...groupLinks(origin, groupId) });
}

/**
 * DELETE /api/pipeline/group/:id — close the group.
 *
 * Revokes every link still outstanding and leaves every submitted one alone:
 * "the test is over" must not touch work already handed in.
 */
async function handleGroupClose(req, res, groupId, url){
  if (!isGroupId(groupId)) return fail(res, 400, "bad-group-id", `"${groupId}" is not a group id.`);

  const records = await store.list({ groupId });
  if (!records.length) return fail(res, 404, "no-group", `No sheet has been issued under group "${groupId}".`);

  const reason = url.searchParams.get("reason") || `group ${groupId} closed`;
  const open = records.filter(r => r.status === store.STATUS.ISSUED);
  for (const record of open) await store.revoke(record.id, reason);

  return sendJson(res, 200, {
    ok: true,
    group_id: groupId,
    revoked: open.length,
    kept: records.length - open.length,
    note: "Submitted sheets are untouched — their results stay readable, and the dashboard still reports them."
  });
}

/**
 * A key reads <type>-<document_idx>-<seed>-<hash>, so a page built with default
 * options carries everything needed to build it again. That is what keeps a
 * link working after the page is swept out of the cache or the disk is wiped.
 *
 * The rebuilt request is only trusted when it hashes back to the same key —
 * a page built with custom counts or a forced theme cannot be reconstructed,
 * and correctly stays a 404 rather than silently serving a different sheet.
 */
async function rebuildFromKey(key){
  const parts = key.match(/^(.+)-([A-Za-z0-9]+)-([A-Za-z0-9]+)-([0-9a-f]{10})$/);
  if (!parts) return null;

  const [, type, documentIdx, seed] = parts;
  if (!normType(type)) return null;

  const request = {
    type, documentIdx,
    seed: seedFrom(seed),
    counts: {},
    theme: null,
    refresh: false
  };
  if (cache.cacheKey(request) !== key) return null;

  try { return await getOrBuild(request); }
  catch { return null; }   // lesson gone, database down — a 404 is the honest answer
}

/**
 * The built page. Query parameters that change the rendering (?embed=1,
 * ?image=1, …) are applied by rebuilding the variant under its own key — the
 * original request is stored beside the page, so the caller does not have to
 * repeat it.
 */
async function handlePage(req, res, key, url){
  const hit = (await cache.get(key)) || (await rebuildFromKey(key));
  if (!hit){
    return fail(res, 404, "not-found",
      `No page built under key "${key}".`,
      `Build it with POST ${config.apiPrefix}/document.`);
  }

  const wantsVariant = ["embed", "image", "print", "theme", "toolbar", "interactive", "standalone", "title"]
    .some(p => url.searchParams.has(p));

  let html = hit.html;
  let meta = hit.meta;
  let servedKey = key;

  if (wantsVariant){
    const request = readRequest({ ...hit.meta.request, document_idx: hit.meta.request.documentIdx }, url.searchParams);
    const variantKey = cache.cacheKey(request);
    if (variantKey !== key){
      const variant = await getOrBuild(request);
      html = variant.html;
      meta = variant.meta;
      servedKey = variant.key;
    }
  }

  /* A page was served. Fire-and-forget inside the repository: it is the only
     signal that says which generated sheets are actually being used, and a
     counter is never worth failing a page over. */
  documentStore.touchServed(servedKey);

  const headers = {
    "X-Edu-Template": meta.template,
    "X-Edu-Theme": meta.theme,
    "X-Pipeline-Key": servedKey,
    "Cache-Control": "no-store"
  };
  if (url.searchParams.has("download")){
    const name = url.searchParams.get("download");
    headers["Content-Disposition"] = disposition(name && name !== "1" ? name : meta.title);
  }
  return sendHtml(res, 200, html, headers);
}

async function handleHealth(req, res){
  const problems = configProblems();

  /* ONE server, TWO databases, and the difference is the thing most worth
     reporting: `lessons` is the generator's, read-only; `store` is ours, and
     the check below actually attempts a write. A user with `read` where
     `readWrite` was meant pings perfectly and then refuses every submission,
     so "connected" on its own would be a lie worth catching here. */
  let lessons = { ok: false, configured: !!config.mongoUri, db: config.db };
  if (config.mongoUri){
    try {
      const started = Date.now();
      await ping();
      lessons = { ...lessons, ok: true, ms: Date.now() - started };
    } catch (err){
      lessons = { ...lessons, ok: false, error: err.message };
    }
  } else {
    lessons.error = "EDU_PIPELINE_MONGO_URI is not set.";
  }

  const access = await checkAccess();
  const store = { database: storeSettings.db, enabled: storeSettings.enabled, ...access };
  const ok = problems.ok && lessons.ok && access.canWrite;

  return sendJson(res, ok ? 200 : 503, {
    ok,
    lessons,
    store,
    extension: "pipeline",
    version: VERSION,
    enabled: config.enabled,
    types: knownTypes(),
    collections: config.collections,
    // Never echo the values — only whether they are present.
    security: {
      apiKeyRequired: !!API_KEY,
      pageLinksSigned: signingEnabled(),
      linkTtlMinutes: config.linkTtlMs ? config.linkTtlMs / 60_000 : 0,
      publicPages: config.publicPages
    },
    /* Where a submitted result goes. Paths and flags only — a token or an
       endpoint's query string would be a credential, and this route is open. */
    answers: {
      answerPrefix: config.answerPrefix,
      saveResults: config.saveResults,
      printResults: config.printResults,
      linkTtlMinutes: config.assignTtlMs ? config.assignTtlMs / 60_000 : 0,
      backend: {
        submitEndpoint: config.submitEndpoint ? new URL(config.submitEndpoint).origin + new URL(config.submitEndpoint).pathname : null,
        analysisEndpoint: config.analysisEndpoint ? new URL(config.analysisEndpoint).origin + new URL(config.analysisEndpoint).pathname : null,
        authenticated: !!config.backendToken,
        timeoutMs: config.backendTimeoutMs
      }
    },

    /* Where each thing is written. Databases by name, paths as paths — never a
       credential, since this route is reachable without the API key. */
    storage: {
      lessonDatabase: config.db,
      resultDatabase: storeSettings.db,
      outputDir: config.outputDir,
      cacheDir: config.cacheDir
    },
    cache: await cache.stats(),
    errors: problems.errors.length ? problems.errors : undefined,
    warnings: problems.warnings.length ? problems.warnings : undefined
  });
}

/** The link board, narrowed by whatever the query string named. */
const assignmentBoard = (params, limit) => assignments.board({
  groupId: params.get("group_id"),
  studentId: params.get("student_id"),
  documentIdx: params.get("document_idx"),
  status: params.get("status"),
  limit
});

/* -------------------------------------------------------------------- router -- */

/** Did the caller present the configured API key? False when none is configured. */
const hasApiKey = req => {
  if (!API_KEY) return false;
  const sent = req.headers["x-api-key"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return sent === API_KEY;
};

/**
 * May this request open /t/<key>?
 *
 * An API-key holder always may. Otherwise the link has to prove itself: pages
 * are locked outright when EDU_PIPELINE_PUBLIC_PAGES=0, and must carry a valid
 * signature when EDU_PIPELINE_PAGE_SECRET is set. With neither configured, pages
 * are open — which is why config.warnings says so.
 */
function pageAllowed(req, key, url){
  if (hasApiKey(req)) return { ok: true };

  if (!config.publicPages){
    return { ok: false, status: 401, code: "unauthorized",
      message: "Built pages require the X-Api-Key header on this server." };
  }

  const check = verifyPageToken(key, url.searchParams.get("t"), url.searchParams.get("e"));
  if (check.ok) return { ok: true };

  if (check.reason === "expired"){
    return { ok: false, status: 410, code: "link-expired",
      message: "This link has expired. Ask the API for a fresh one." };
  }
  return { ok: false, status: 401, code: "invalid-link",
    message: "This link is missing its signature or the signature does not match.",
    detail: `Request the page through POST ${config.apiPrefix}/document, which returns signed URLs.` };
}

/**
 * The endpoints a STUDENT reaches, which therefore cannot sit behind the
 * server-wide API key: the browser holding a single-use link has an assignment
 * token and nothing else.
 *
 * They are not unauthenticated — each one verifies that token itself (see
 * store.openable and resultAllowed). This list only says "do not ALSO demand
 * the operator's key", and server.mjs consults it before its own gate.
 */
export function pipelineOpenPath(pathname){
  if (!config.enabled) return false;
  if (pathname.startsWith(`${config.answerPrefix}/`)) return true;

  const rest = pathname.startsWith(`${config.apiPrefix}/`)
    ? pathname.slice(config.apiPrefix.length + 1)
    : null;
  if (rest == null) return false;

  return rest === "submit" || /^(result|report)\/[^/]+$/.test(rest);
}

/**
 * Returns true when this extension has answered the request, false to let the
 * core router carry on. Every path it claims lives under /api/pipeline, /t or /a.
 */
export async function pipelineRoute(req, res, url){
  if (!config.enabled) return false;

  const { pathname } = url;

  /* The cache is storage, not a static asset. When it happens to sit inside the
     served site root, its URL space is claimed here and refused — otherwise
     /data/cache/<key>.html would serve any page straight off disk, with
     no signature checked, and /t/<key> signing would protect nothing. */
  if (config.privateUrlPrefixes.some(prefix => pathname.startsWith(prefix))){
    fail(res, 404, "not-found", `No such file: ${pathname}`);
    return true;
  }

  const api = pathname === config.apiPrefix || pathname.startsWith(`${config.apiPrefix}/`);
  const page = pathname.startsWith(`${config.pagePrefix}/`);
  const answer = pathname.startsWith(`${config.answerPrefix}/`);
  if (!api && !page && !answer) return false;

  const method = req.method.toUpperCase();

  /* --- a student's own sheet ---
     No API key and no page signature: the assignment id and its token ARE the
     credential, and store.openable() is the only thing that decides. */
  if (answer){
    const id = decodeURIComponent(pathname.slice(config.answerPrefix.length + 1));
    if (method !== "GET" && method !== "HEAD"){
      fail(res, 405, "method-not-allowed", "Use GET.");
      return true;
    }
    if (!store.isId(id)){
      sendHtml(res, 404, renderClosedPage(404, "هذا الرابط غير صحيح. تأكد من نسخه كاملاً."), { "Cache-Control": "no-store" });
      return true;
    }
    await handleAnswerPage(req, res, id, url);
    return true;
  }

  /* --- the page --- */
  if (page){
    const key = decodeURIComponent(pathname.slice(config.pagePrefix.length + 1));
    if (method !== "GET" && method !== "HEAD"){
      fail(res, 405, "method-not-allowed", "Use GET.");
      return true;
    }
    if (!cache.isKey(key)){
      fail(res, 400, "bad-key", `"${key}" is not a page key.`);
      return true;
    }

    // Checked before the cache is touched, so an unsigned request cannot even
    // learn whether a given lesson has been built.
    const allowed = pageAllowed(req, key, url);
    if (!allowed.ok){
      fail(res, allowed.status, allowed.code, allowed.message, allowed.detail);
      return true;
    }

    await handlePage(req, res, key, url);
    return true;
  }

  const rest = pathname.slice(config.apiPrefix.length).replace(/^\/+/, "");

  /* --- meta --- */
  if (rest === "health" && method === "GET"){ await handleHealth(req, res); return true; }

  if (rest === "types" && method === "GET"){
    sendJson(res, 200, { types: typeDocs(), defaultType: "worksheet" });
    return true;
  }

  if (rest === "" || rest === "document"){
    if (method !== "GET" && method !== "POST"){
      fail(res, 405, "method-not-allowed", "Use GET (query) or POST (JSON body).");
      return true;
    }
    await handleDocument(req, res, url);
    return true;
  }

  /* --- issuing, answering, grading --- */

  if (rest === "assign"){
    if (method !== "GET" && method !== "POST"){
      fail(res, 405, "method-not-allowed", "Use POST (JSON body) or GET (query).");
      return true;
    }
    await handleAssign(req, res, url);
    return true;
  }

  if (rest === "batch" || rest === "assign/batch" || rest === "batch/assign"){
    if (method !== "GET" && method !== "POST"){
      fail(res, 405, "method-not-allowed", "Use POST (JSON body) or GET (?students=a,b,c).");
      return true;
    }
    await handleBatch(req, res, url);
    return true;
  }

  if (rest === "submit"){
    if (method !== "POST"){ fail(res, 405, "method-not-allowed", "Use POST."); return true; }
    await handleSubmit(req, res, url);
    return true;
  }

  /* --- a whole group at once --- */

  if (rest === "groups" && method === "GET"){
    const groups = await listGroups({
      documentIdx: url.searchParams.get("document_idx") || undefined,
      status: url.searchParams.get("status") || undefined
    });
    const origin = originOf(req);
    sendJson(res, 200, {
      count: groups.length,
      groups: groups.map(g => ({ ...g, ...groupLinks(origin, g.group_id) }))
    });
    return true;
  }

  const groupRoute = rest.match(/^groups?\/(.+)$/);
  if (groupRoute){
    const [, tail] = groupRoute;
    const view = tail.match(/^(.+?)\/(dashboard|answers|report)$/);
    const groupId = decodeURIComponent(view ? view[1] : tail);

    if (method === "DELETE" && !view){
      await handleGroupClose(req, res, groupId, url);
      return true;
    }
    if (method !== "GET" && method !== "HEAD"){
      fail(res, 405, "method-not-allowed", "Use GET, or DELETE to revoke the links still outstanding.");
      return true;
    }

    if (view && view[2] === "answers") await handleGroupAnswers(req, res, groupId, url);
    else if (view) await handleGroup(req, res, groupId, url, "html");
    else await handleGroup(req, res, groupId, url, String(url.searchParams.get("format") || "json").toLowerCase() === "html" ? "html" : "json");
    return true;
  }

  if (rest === "assignments" && method === "GET"){
    const records = await store.list({
      studentId: url.searchParams.get("student_id") || undefined,
      groupId: url.searchParams.get("group_id") || undefined,
      documentIdx: url.searchParams.get("document_idx") || undefined,
      status: url.searchParams.get("status") || undefined
    });
    const origin = originOf(req);
    sendJson(res, 200, {
      count: records.length,
      // Bounded: a term's worth of assignments is not a useful HTTP response.
      assignments: records.slice(0, Math.min(Number(url.searchParams.get("limit")) || 100, 500))
        .map(r => describeAssignment(origin, r))
    });
    return true;
  }

  const assignment = rest.match(/^assignments?\/([^/]+)$/);
  if (assignment){
    const id = decodeURIComponent(assignment[1]);
    if (!store.isId(id)){ fail(res, 400, "bad-id", `"${id}" is not an assignment id.`); return true; }

    if (method === "DELETE"){
      const gone = await store.revoke(id, url.searchParams.get("reason") || "revoked by request");
      if (!gone){ fail(res, 404, "not-found", `No assignment "${id}".`); return true; }
      sendJson(res, 200, {
        ok: true,
        revoked: gone.status === store.STATUS.REVOKED,
        note: gone.status === store.STATUS.SUBMITTED
          ? "Already submitted — the link was closed at submission and its result is kept."
          : "The link no longer opens. Issue a new one to give the student another attempt.",
        ...store.describe(gone)
      });
      return true;
    }
    if (method !== "GET"){ fail(res, 405, "method-not-allowed", "Use GET or DELETE."); return true; }

    const record = await store.get(id);
    if (!record){ fail(res, 404, "not-found", `No assignment "${id}".`); return true; }
    sendJson(res, 200, describeAssignment(originOf(req), record));
    return true;
  }

  const result = rest.match(/^(result|report)\/([^/]+)$/);
  if (result){
    const id = decodeURIComponent(result[2]);
    if (method !== "GET"){ fail(res, 405, "method-not-allowed", "Use GET."); return true; }
    if (!store.isId(id)){ fail(res, 400, "bad-id", `"${id}" is not an assignment id.`); return true; }
    await handleResult(req, res, id, url, result[1] === "report" ? "html" : "json");
    return true;
  }

  /* --- one built document --- */
  const doc = rest.match(/^document\/([^/]+)$/);
  if (doc){
    const key = decodeURIComponent(doc[1]);
    if (!cache.isKey(key)){ fail(res, 400, "bad-key", `"${key}" is not a page key.`); return true; }

    if (method === "DELETE"){
      const gone = await cache.remove(key);
      sendJson(res, gone ? 200 : 404, gone ? { deleted: key } : { error: { code: "not-found", message: `No page "${key}".` } });
      return true;
    }
    if (method !== "GET"){ fail(res, 405, "method-not-allowed", "Use GET or DELETE."); return true; }

    const hit = await cache.get(key);
    if (!hit){ fail(res, 404, "not-found", `No page built under key "${key}".`); return true; }
    sendJson(res, 200, describe(originOf(req), key, hit.meta, true));
    return true;
  }

  /* --- the JSON a page was rendered from --- */
  const data = rest.match(/^data\/([^/]+)$/);
  if (data){
    const key = decodeURIComponent(data[1]);
    if (method !== "GET"){ fail(res, 405, "method-not-allowed", "Use GET."); return true; }
    if (!cache.isKey(key)){ fail(res, 400, "bad-key", `"${key}" is not a page key.`); return true; }

    const hit = await cache.get(key);
    if (!hit){ fail(res, 404, "not-found", `No page built under key "${key}".`); return true; }

    // Rebuilt rather than stored twice: the request is deterministic, so this
    // returns exactly the payload the cached page was rendered from.
    const request = { ...hit.meta.request, documentIdx: hit.meta.request.documentIdx };
    const lesson = await loadLesson(request.documentIdx);
    sendJson(res, 200, buildDocument(lesson, request).data);
    return true;
  }

  /* --- the lesson behind a document_idx, for inspection --- */
  const lessonRoute = rest.match(/^lessons?\/([^/]+)$/);
  if (lessonRoute){
    if (method !== "GET"){ fail(res, 405, "method-not-allowed", "Use GET."); return true; }
    const idx = decodeURIComponent(lessonRoute[1]);
    const lesson = await loadLesson(idx, { fresh: truthy(url.searchParams.get("refresh")) });
    sendJson(res, 200, lesson);
    return true;
  }

  /* --- the store, read-only ---
     Behind the API key like the rest of /api/pipeline. What this platform has
     produced, and nothing about who anyone is: the roster belongs to the
     partner platform and is never stored here as a record of its own. */

  if (rest === "store" && method === "GET"){
    sendJson(res, 200, {
      ...(await storeStats()),
      access: await checkAccess(),
      documents: await documentStore.stats()
    });
    return true;
  }

  const collection = rest.match(/^(documents|links)$/);
  if (collection){
    if (method !== "GET"){ fail(res, 405, "method-not-allowed", "Use GET."); return true; }
    const q = url.searchParams;
    const limit = Number(q.get("limit")) || undefined;

    const items = collection[1] === "documents"
      ? await documentStore.list({ type: q.get("type"), documentIdx: q.get("document_idx"), limit })
      /* Every issued link and where it stands — the same records the dashboard
         reads, without the answer key or the token. */
      : await assignmentBoard(q, limit);

    sendJson(res, 200, { count: items.length, [collection[1]]: items });
    return true;
  }

  /* One student's history. The id is the partner platform's — we hold results
     filed under it, not a student record. */
  const studentResults = rest.match(/^students\/([^/]+)\/results$/);
  if (studentResults && method === "GET"){
    const id = decodeURIComponent(studentResults[1]);
    const results = await resultStore.studentResults(id, url.searchParams.get("limit"));
    sendJson(res, 200, {
      student_id: id,
      count: results.length,
      note: results.length ? undefined
        : "No results under this student id. Ids come from the platform that issued the sheets; nothing here keeps a roster.",
      results
    });
    return true;
  }

  /* The questions of one generated sheet, with the key it is graded against. */
  const documentQuestions = rest.match(/^documents\/([^/]+)\/questions$/);
  if (documentQuestions && method === "GET"){
    const key = decodeURIComponent(documentQuestions[1]);
    if (!cache.isKey(key)){ fail(res, 400, "bad-key", `"${key}" is not a page key.`); return true; }
    const record = await documentStore.get(key);
    if (!record){ fail(res, 404, "not-found", `No document recorded under "${key}".`); return true; }
    sendJson(res, 200, { document: record, questions: await documentStore.questions(key) });
    return true;
  }

  /* Item analysis and goal mastery — the two questions a department asks of a
     term's results, answered over every submission rather than one sheet. */
  if (rest === "analytics/questions" && method === "GET"){
    const rows = await resultStore.questionDifficulty({ documentIdx: url.searchParams.get("document_idx") });
    sendJson(res, 200, { count: rows.length, questions: rows });
    return true;
  }

  if (rest === "analytics/goals" && method === "GET"){
    const groupId = url.searchParams.get("group_id");
    if (!groupId){ fail(res, 400, "missing-group", "Pass ?group_id=<id>."); return true; }
    const rows = await resultStore.goalMastery(groupId);
    sendJson(res, 200, { group_id: groupId, count: rows.length, goals: rows });
    return true;
  }

  /* --- cache administration --- */
  if (rest === "cache"){
    if (method === "GET"){
      sendJson(res, 200, { ...(await cache.stats()), pages: await cache.list() });
      return true;
    }
    if (method === "DELETE"){
      clearLessonCache();
      sendJson(res, 200, { cleared: await cache.clear() });
      return true;
    }
    fail(res, 405, "method-not-allowed", "Use GET or DELETE.");
    return true;
  }

  fail(res, 404, "unknown-endpoint",
    `No Pipeline endpoint at ${pathname}.`,
    `Try ${config.apiPrefix}/document, ${config.apiPrefix}/types or ${config.apiPrefix}/health.`);
  return true;
}
