/* ============================================================================
   answers/store.mjs — one issued sheet, one student, one submission
   ----------------------------------------------------------------------------
   A page key is derived from the request, so two students asking for the same
   worksheet get the same key and the same URL. That is exactly right for a
   cache and exactly wrong for an answer sheet: the link has to belong to one
   student, be openable once, and stop working the moment it is submitted.

   So an ASSIGNMENT sits in front of the page. It is random (not derived), it
   names the student, it carries the answer key the submission is graded
   against, and it has a lifecycle:

     issued  ──open──▶  issued  ──submit──▶  submitted   (link dead)
        └────────────revoke / expire───────▶  revoked     (link dead)

   Nothing here reopens a dead link. "Give the student another go" means issuing
   a NEW assignment, which mints a new id and a new token — so an old link that
   leaks is worth nothing, and every attempt is a separate record with its own
   result instead of one record quietly overwritten.

   WHERE THE RECORDS LIVE. In MongoDB (server/store), one document per
   assignment, plus a link_events document for every transition and every
   refused attempt to open a dead link. They used to be JSON files under
   EDU_PIPELINE_ASSIGN_DIR; those are still readable and
   `node tools/store.mjs import-files` moves them in.

   The document CONTAINS THE ANSWER KEY and the link's token, which is why it
   lives in the database this platform writes rather than the one it reads
   lessons from, and why that database's user should not be shared with anything
   that only needs results.

   THE STUDENT IS WHATEVER THE CALLER SENT. There is no roster to look one up
   in: the partner platform names them, and the name is stored on the record as
   a snapshot so a sheet issued last term keeps what was printed on it.

   This module is deliberately still the only door: everything above it — the
   routes, the group roll-up, the dashboard — passes assignment RECORDS around
   and never touches a collection.
   ========================================================================== */
import crypto from "node:crypto";

import config from "../config.mjs";
import { assignments } from "../../store/repo.mjs";

export const STATUS = { ISSUED: "issued", SUBMITTED: "submitted", REVOKED: "revoked", EXPIRED: "expired" };

/**
 * Ids travel in URLs and were once filenames, so the alphabet stays as narrow
 * as it was — nothing that could be a path segment, a wildcard or a quote.
 */
const ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
export const isId = v => ID_RE.test(String(v == null ? "" : v));

/* ------------------------------------------------------------------ memory -- */

/* A small read-through cache. Every request for a student's sheet reads the
   record twice — once to check the token, once to render — and a link being
   opened by thirty students at once should not be thirty round trips per open. */
const hot = new Map();

function remember(record){
  if (!record) return record;
  hot.delete(record.id);
  hot.set(record.id, record);
  while (hot.size > 500) hot.delete(hot.keys().next().value);
  return record;
}

const forget = id => hot.delete(id);

/* ------------------------------------------------------------------ tokens -- */

/**
 * The link's secret half. Random rather than derived: the id appears in URLs,
 * logs and the teacher's dashboard, and none of those should be enough to open
 * a student's sheet.
 */
const mintToken = () => crypto.randomBytes(24).toString("base64url");

/** Length-independent comparison, so a wrong guess leaks nothing by timing. */
export function sameToken(a, b){
  const left = Buffer.from(String(a == null ? "" : a), "utf8");
  const right = Buffer.from(String(b == null ? "" : b), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------- write -- */

/**
 * Issue a sheet to a student.
 *
 * @param {object} input
 *   student      {id, name, classroom, section}   who it is for
 *   school       {id, name}                       where, as the caller named it
 *   teacher      {id, name}                       who set it, as the caller named them
 *   subject      {id, name}                       المادة, as the caller named it
 *   request      the canonical build request, so the page can be rebuilt
 *   pageKey      the cache key of the built page
 *   answerKey    the rows the submission is graded against
 *   goals        the lesson's goals, for the per-goal analysis
 *   scoring      "mastery" | "profile" — how the answers are read
 *   profile      the survey instrument, when scoring is "profile"
 *   documentIdx / lessonTitle / type / seed / title / teacherId
 * @returns {Promise<object>} the stored record, token included
 */
export async function issue(input){
  const now = Date.now();
  const record = {
    schema: "pipeline.assignment/1",
    id: crypto.randomBytes(16).toString("base64url"),
    token: mintToken(),
    status: STATUS.ISSUED,

    student: input.student || null,
    studentId: (input.student && input.student.id) || "",

    /* The group this sheet belongs to, when the caller named one. Stored flat
       beside the object as well, because "every record with this group id" is
       the query the dashboard is built on and it should not have to reach
       through a nullable object to run it. */
    group: input.group || null,
    groupId: (input.group && input.group.id) || "",

    /* Who issued it and where, when the caller said. Nothing requires either —
       a sheet issued from Postman names nobody — but a dashboard that can say
       which teacher set an exam is worth the nullable column, and a report
       printed for a file needs the school's name on it.

       Snapshots, like the student: what the partner platform sent, kept as
       sent, never a reference to a list this database does not hold. */
    school: input.school || null,
    teacher: input.teacher || null,
    teacherId: input.teacherId || (input.teacher && input.teacher.id) || "",

    /* The subject the sheet was printed under — the value on its المادة line.
       Stored beside the school for the same reason: it came from the caller,
       not from the lesson, so nothing downstream can re-derive it. */
    subject: input.subject || null,

    /* When the sheet is sat, as it was printed on it. Stored rather than
       recomputed so a report always quotes the date the student saw, even if
       the same lesson is re-issued for a later sitting. */
    examDate: input.examDate || null,

    type: input.type,
    documentIdx: String(input.documentIdx),
    lessonTitle: input.lessonTitle || "",
    title: input.title || "",
    seed: input.seed,
    pageKey: input.pageKey,
    request: input.request,

    answerKey: input.answerKey || [],
    goals: input.goals || [],

    /* How this submission is to be read — "mastery" against the lesson's goals,
       or "profile" for a survey — and, for a profile, the instrument it was
       printed from. Stored rather than looked up at submit time: the sheet a
       student answered is the sheet it must be scored against, even if the
       instrument is edited between issuing and submitting. */
    scoring: input.scoring || "mastery",
    profile: input.profile || null,

    createdAt: new Date(now).toISOString(),
    expiresAt: config.assignTtlMs ? new Date(now + config.assignTtlMs).toISOString() : null,
    openedAt: null,
    submittedAt: null,
    revokedAt: null,
    revokedReason: "",
    attempts: 0
  };

  await assignments.put(record, { event: "issued" });
  return remember(record);
}

/* -------------------------------------------------------------------- read -- */

/** The record, or null. Nothing here decides whether it may be OPENED. */
export async function get(id){
  if (!isId(id)) return null;

  const cached = hot.get(id);
  if (cached) return cached;

  try { return remember(await assignments.get(id)); }
  catch { return null; }   // the store is down; the caller reports "no such link"
}

/**
 * May this request open the sheet?
 *
 * The reasons are separated deliberately: "already submitted" and "revoked" are
 * both 410 Gone to a student, but a teacher looking at a log needs to know
 * which one happened.
 *
 * @returns {{ok:true, record} | {ok:false, status:number, code:string, message:string}}
 */
export function openable(record, token){
  if (!record){
    return { ok: false, status: 404, code: "no-assignment",
      message: "لا يوجد اختبار بهذا الرابط. اطلب رابطاً جديداً من معلمك." };
  }
  if (!sameToken(token, record.token)){
    return { ok: false, status: 401, code: "bad-token",
      message: "هذا الرابط غير مكتمل أو غير صحيح. افتح الرابط كما وصلك تماماً." };
  }
  if (record.status === STATUS.SUBMITTED){
    return { ok: false, status: 410, code: "already-submitted",
      message: "تم تسليم هذه الورقة بالفعل، ولم يعد الرابط صالحاً. اطلب من معلمك رابطاً جديداً إذا أردت المحاولة مرة أخرى." };
  }
  if (record.status === STATUS.REVOKED){
    return { ok: false, status: 410, code: "revoked",
      message: "تم إلغاء هذا الرابط. اطلب من معلمك رابطاً جديداً." };
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()){
    return { ok: false, status: 410, code: "expired",
      message: "انتهت صلاحية هذا الرابط. اطلب من معلمك رابطاً جديداً." };
  }
  return { ok: true, record };
}

/* ------------------------------------------------------------------ change -- */

/** First open is stamped; later ones are counted. Neither changes openability. */
export async function markOpened(record, context = {}){
  const next = { ...record, attempts: record.attempts + 1, openedAt: record.openedAt || new Date().toISOString() };
  await assignments.put(next, { event: "opened", ip: context.ip, userAgent: context.userAgent });
  return remember(next);
}

/**
 * Close the sheet against further answers.
 *
 * Written BEFORE the result is analysed and delivered, not after: if grading or
 * the backend call fails, the link must still be dead. A student who could
 * resubmit because the report generator threw is a worse failure than a
 * submission that has to be re-graded from the saved answers.
 */
export async function markSubmitted(record, submittedAt, context = {}){
  const next = {
    ...record,
    status: STATUS.SUBMITTED,
    submittedAt: submittedAt || new Date().toISOString()
  };
  await assignments.put(next, { event: "submitted", ip: context.ip, userAgent: context.userAgent });
  return remember(next);
}

/** Revoke by hand — a mistyped student, a link sent to the wrong person. */
export async function revoke(id, reason){
  const record = await get(id);
  if (!record) return null;
  if (record.status === STATUS.SUBMITTED) return record;   // already closed; leave the result alone

  const next = {
    ...record,
    status: STATUS.REVOKED,
    revokedAt: new Date().toISOString(),
    revokedReason: String(reason || "revoked by request")
  };
  await assignments.put(next, { event: "revoked", reason: next.revokedReason });
  return remember(next);
}

/**
 * A refused attempt to open a link. Not a state change — the record is already
 * where it is going to stay — but the one thing a teacher wants when a student
 * says "the link says it's closed": did they click it, and when.
 */
export async function noteRefusal(id, code, context = {}){
  if (!isId(id)) return;
  await assignments.logEvent({
    assignmentId: id, event: "blocked", reason: code,
    ip: context.ip, userAgent: context.userAgent
  });
}

/** The link's own history: issued, opened, submitted, refused. */
export async function history(id){
  if (!isId(id)) return [];
  try { return await assignments.events(id); }
  catch { return []; }
}

/* --------------------------------------------------------------- inventory -- */

/** What a caller may see about an assignment: never the key, never the token. */
export const describe = record => ({
  assignment_id: record.id,
  status: record.status,
  student: record.student,
  school: record.school || null,
  teacher: record.teacher || null,
  subject: record.subject || null,
  group: record.group || null,
  group_id: record.groupId || "",
  type: record.type,
  scoring: record.scoring || "mastery",
  document_idx: record.documentIdx,
  lesson_title: record.lessonTitle,
  seed: record.seed,
  exam_date: (record.examDate && (record.examDate.iso || record.examDate.text)) || "",
  exam_date_text: (record.examDate && record.examDate.text) || "",
  page_key: record.pageKey,
  question_count: record.answerKey.length,
  goal_count: record.goals.length,
  created_at: record.createdAt,
  expires_at: record.expiresAt,
  opened_at: record.openedAt,
  submitted_at: record.submittedAt,
  revoked_at: record.revokedAt,
  revoked_reason: record.revokedReason || undefined,
  attempts: record.attempts
});

/**
 * Every assignment, newest first. Optionally narrowed to one student — which is
 * the question actually asked of this ("what has أحمد been given?") — or to one
 * group, which is the question the dashboard asks ("what did الخامس/ب do?").
 */
export async function list(filter = {}){
  try { return await assignments.list(filter); }
  catch { return []; }
}

export async function remove(id){
  if (!isId(id)) return false;
  forget(id);
  try { return await assignments.remove(id); }
  catch { return false; }
}
