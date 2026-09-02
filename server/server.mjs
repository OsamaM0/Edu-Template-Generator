/* ============================================================================
   server.mjs — the API in front of the worksheet engine
   ----------------------------------------------------------------------------
   POST worksheet JSON, get back a finished HTML page with that data already in
   it. Node's own http module, no dependencies, no build step.

     GET    /api/health              is it up, what version
     GET    /api/templates           the templates and what each one needs
     POST   /api/validate            structural check, tells you what it detects
     POST   /api/render              → text/html   ← the main one
     GET    /api/render?data=<b64>   → text/html   (same, for links and <iframe>)
     POST   /api/sheets              store once, get a shareable URL back
     GET    /api/sheets/:id          the stored JSON
     GET    /api/lessons/:id         alias, so config.apiBase="/api" just works
     DELETE /api/sheets/:id          drop it early
     GET    /s/:id                   the stored sheet as a page
     /api/pipeline/*  /t/*  /a/*        the document pipeline — server/pipeline/
     everything else                 the static site (index.html, assets, …)

   Environment:
     PORT / EDU_PORT      listen port                      (default 8138)
     EDU_HOST             bind address                     (default 0.0.0.0)
     EDU_API_KEY          when set, /api/* needs X-Api-Key: <it>
     EDU_CORS_ORIGIN      Access-Control-Allow-Origin      (default *)
     EDU_MAX_BODY         request body limit in bytes      (default 4000000)
     EDU_SHEET_TTL_MIN    stored-sheet lifetime in minutes (default 1440)
     EDU_MAX_SHEETS       how many stored sheets to keep   (default 500)
   ========================================================================== */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { renderPage, validate, knownTemplates } from "./render-page.mjs";
import { pipelineRoute, pipelineOpenPath } from "./pipeline/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PORT      = Number(process.env.PORT || process.env.EDU_PORT || 8138);
const HOST      = process.env.EDU_HOST || "0.0.0.0";
const API_KEY   = process.env.EDU_API_KEY || "";
const CORS      = process.env.EDU_CORS_ORIGIN || "*";
const MAX_BODY  = Number(process.env.EDU_MAX_BODY || 4_000_000);
const TTL_MS    = Number(process.env.EDU_SHEET_TTL_MIN || 1440) * 60_000;
const MAX_SHEET = Number(process.env.EDU_MAX_SHEETS || 500);

const VERSION = "1.1.0";

/* ------------------------------------------------------------------ store -- */
/* Deliberately in memory: sheets are short-lived render jobs, not content.
   Restarting the server clears them; lessons that must survive live in
   data/lessons/ and are addressed by ?lesson=<id>. */

const sheets = new Map();   // id -> { data, options, created, expires }

function putSheet(data, options){
  sweep();
  if (sheets.size >= MAX_SHEET){
    sheets.delete(sheets.keys().next().value);          // oldest first
  }
  const id  = crypto.randomBytes(9).toString("base64url");
  const now = Date.now();
  sheets.set(id, { data, options, created: now, expires: now + TTL_MS });
  return id;
}

function getSheet(id){
  const s = sheets.get(id);
  if (!s) return null;
  if (s.expires <= Date.now()){ sheets.delete(id); return null; }
  return s;
}

function sweep(){
  const now = Date.now();
  for (const [id, s] of sheets) if (s.expires <= now) sheets.delete(id);
}

/* ---------------------------------------------------------------- helpers -- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".wsx":  "application/octet-stream",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/markdown; charset=utf-8"
};

function cors(res){
  res.setHeader("Access-Control-Allow-Origin", CORS);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, obj){
  const body = Buffer.from(JSON.stringify(obj, null, 2), "utf8");
  res.writeHead(status, { "Content-Type": MIME[".json"], "Content-Length": body.length });
  res.end(body);
}

function sendHtml(res, status, html, headers){
  const body = Buffer.from(html, "utf8");
  res.writeHead(status, Object.assign({
    "Content-Type": MIME[".html"],
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  }, headers || {}));
  res.end(body);
}

const fail = (res, status, code, message, detail) =>
  sendJson(res, status, { error: { code, message, detail: detail || undefined } });

/** Read the body with a hard ceiling, then parse it as JSON.
    On overflow the stream is paused rather than destroyed, so the 413 answer
    still reaches the client instead of the socket dying under it. */
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
        bad(Object.assign(new Error(`Request body exceeds the ${MAX_BODY}-byte limit`),
          { status: 413, code: "body-too-large" }));
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
  if (!raw.trim()){
    throw Object.assign(new Error("Request body is empty"), { status: 400, code: "empty-body" });
  }
  try {
    return JSON.parse(raw);
  } catch (e){
    throw Object.assign(new Error("Request body is not valid JSON"), { status: 400, code: "invalid-json", detail: e.message });
  }
}

const truthy = v => v != null && !/^(0|false|no|off)$/i.test(String(v));
const falsy  = v => v != null && /^(0|false|no|off)$/i.test(String(v));

/**
 * A request may send the worksheet directly, or wrap it:
 *   { "options": {...}, "data": {...} }   ("worksheet" / "lesson" also accepted)
 * Query parameters win over body options, so one saved request can be re-aimed
 * from the URL alone.
 */
function unpackRequest(body, query){
  let data = body;
  let options = {};

  if (body && typeof body === "object" && !Array.isArray(body)){
    for (const key of ["data", "worksheet", "lesson", "sheet"]){
      if (body[key] && typeof body[key] === "object"){
        data = body[key];
        options = Object.assign({}, body.options);
        break;
      }
    }
  }

  const q = query;
  const opt = Object.assign({
    theme: null, standalone: false, interactive: true, toolbar: true,
    embed: false, autoImage: false, autoPrint: false, title: null, download: null
  }, options);

  if (q.get("theme") || q.get("age")) opt.theme = q.get("theme") || q.get("age");
  if (q.has("standalone"))  opt.standalone  = truthy(q.get("standalone"));
  if (q.has("interactive")) opt.interactive = !falsy(q.get("interactive"));
  if (q.has("toolbar"))     opt.toolbar     = !falsy(q.get("toolbar"));
  if (q.has("embed"))       opt.embed       = truthy(q.get("embed"));
  if (q.has("image"))       opt.autoImage   = truthy(q.get("image"));
  if (q.has("print"))       opt.autoPrint   = truthy(q.get("print"));
  if (q.get("title"))       opt.title       = q.get("title");
  if (q.has("download"))    opt.download    = q.get("download") || true;

  // An embedded sheet has no room for the floating toolbar unless asked for.
  if (opt.embed && !q.has("toolbar") && options.toolbar == null) opt.toolbar = false;

  return { data, options: opt };
}

/** Absolute origin of this request, so rendered pages can link back to assets. */
function originOf(req){
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host  = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  return `${proto}://${host}`;
}

/** RFC 5987 filename, so Arabic lesson titles survive the Content-Disposition. */
function disposition(name){
  const clean = String(name).replace(/[\\/:*?"<>|\r\n]+/g, "").trim() || "worksheet";
  const file  = clean.toLowerCase().endsWith(".html") ? clean : `${clean}.html`;
  const ascii = file.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

/* ----------------------------------------------------------------- routes -- */

async function handleRender(req, res, body, url){
  const { data, options } = unpackRequest(body, url.searchParams);

  const check = validate(data);
  if (!check.valid){
    return fail(res, 422, "invalid-worksheet", "The payload cannot be rendered.", check.errors.join(" "));
  }

  const page = await renderPage(data, Object.assign({}, options, { baseUrl: originOf(req) }));

  const headers = {
    "X-Edu-Template": page.template,
    "X-Edu-Theme": page.theme
  };
  if (options.download){
    headers["Content-Disposition"] = disposition(options.download === true ? page.title : options.download);
  }
  sendHtml(res, 200, page.html, headers);
}

async function handleSheets(req, res, body, url){
  const { data, options } = unpackRequest(body, url.searchParams);

  const check = validate(data);
  if (!check.valid){
    return fail(res, 422, "invalid-worksheet", "The payload cannot be stored.", check.errors.join(" "));
  }

  const id = putSheet(data, options);
  const s  = getSheet(id);
  const origin = originOf(req);

  sendJson(res, 201, {
    id,
    template: check.template,
    url:      `${origin}/s/${id}`,
    embedUrl: `${origin}/s/${id}?embed=1`,
    imageUrl: `${origin}/s/${id}?image=1`,
    apiUrl:   `${origin}/api/sheets/${id}`,
    createdAt: new Date(s.created).toISOString(),
    expiresAt: new Date(s.expires).toISOString(),
    warnings: check.warnings
  });
}

async function handleStoredPage(req, res, id, url){
  const s = getSheet(id);
  if (!s) return fail(res, 404, "not-found", `No stored sheet with id "${id}". It may have expired.`);

  const merged = unpackRequest({ data: s.data, options: s.options }, url.searchParams);
  const page = await renderPage(merged.data, Object.assign({}, merged.options, { baseUrl: originOf(req) }));

  const headers = { "X-Edu-Template": page.template, "X-Edu-Theme": page.theme };
  if (merged.options.download){
    headers["Content-Disposition"] = disposition(merged.options.download === true ? page.title : merged.options.download);
  }
  sendHtml(res, 200, page.html, headers);
}

function decodeInline(s){
  const b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b, "base64").toString("utf8"));
}

/* ----------------------------------------------------------- static files -- */

async function serveStatic(req, res, pathname){
  let rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  /* Dotfiles are never part of the site. The site root doubles as the app
     directory on most deployments, so .env, .git/config and .htaccess sit
     right beside index.html — and a static server that hands them out leaks
     every credential the app has. 404, not 403: a refusal that confirms the
     file exists is still an answer. */
  if (rel.split(/[\\/]/).some(segment => segment.startsWith("."))){
    return fail(res, 404, "not-found", `No such file: /${rel}`);
  }

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT){
    return fail(res, 403, "forbidden", "Path escapes the site root.");
  }

  let info;
  try {
    info = await stat(file);
    if (info.isDirectory()) return serveStatic(req, res, pathname.replace(/\/*$/, "/") );
  } catch {
    return fail(res, 404, "not-found", `No such file: /${rel}`);
  }

  const ext  = path.extname(file).toLowerCase();
  const etag = `W/"${info.size}-${Number(info.mtimeMs).toString(36)}"`;
  if (req.headers["if-none-match"] === etag){
    res.writeHead(304, { ETag: etag });
    return res.end();
  }

  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": info.size,
    "ETag": etag,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
  });
  createReadStream(file).pipe(res);
}

/* ------------------------------------------------------------------ router -- */

const TEMPLATE_DOCS = [
  { template: "differentiated-lesson", aliases: ["lesson-plan", "differentiated", "diff-lesson"],
    describes: "خطة درس وفق التعليم المتمايز",
    blocks: ["meta", "info", "goals", "strategies", "tools", "homework", "groups", "intro", "activities", "assessment", "closing"],
    required: [] },
  { template: "worksheet", aliases: ["sheet"],
    describes: "ورقة عمل الطالب",
    blocks: ["meta", "studentBar", "info", "warmup", "objectives", "sections"],
    required: ["sections"] },
  { template: "interactive-card", aliases: ["review-card", "cards", "questions"],
    describes: "بطاقات مراجعة (أسئلة) قابلة للقص",
    blocks: ["meta", "identity", "objectives", "cards", "footer"],
    required: ["cards"] },
  { template: "interactive-card-answers", aliases: ["answers", "answer-cards"],
    describes: "بطاقات الإجابات النموذجية",
    blocks: ["meta", "subject", "chips", "cards", "footer"],
    required: ["cards"] },
  { template: "golden-minutes", aliases: ["golden-minutes-card", "golden", "minutes-card"],
    describes: "بطاقة الدقائق الذهبية للحصة",
    blocks: ["meta", "session", "firstFive", "readiness", "lastFive", "decision", "note", "teacher", "visitor"],
    required: [] },
  { template: "learning-pattern", aliases: ["learning-style", "learning-styles", "style-survey", "vark"],
    describes: "استبيان تحديد أنماط التعلم: بصري، سماعي، حركي، قراءة/كتابة",
    blocks: ["meta", "student", "intro", "quiz", "questions", "styles", "verdict"],
    required: ["questions", "styles"] }
];

async function route(req, res){
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  cors(res);
  if (method === "OPTIONS"){ res.writeHead(204); return res.end(); }

  const isApi = pathname.startsWith("/api/") || pathname.startsWith("/s/");

  /* A few extension endpoints are reached by a student's browser holding a
     single-use link and nothing else — submitting answers, opening the report
     that submission produced. They authenticate against that link's own token
     instead, so demanding the operator's key here would lock out the only
     people they exist for. pipelineOpenPath names them; everything else on
     /api/* is gated as before. */
  if (API_KEY && isApi && pathname !== "/api/health" && !pipelineOpenPath(pathname)){
    const sent = req.headers["x-api-key"] ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (sent !== API_KEY) return fail(res, 401, "unauthorized", "Missing or wrong X-Api-Key header.");
  }

  /* --- extensions ---
     Bolted on, not built in: pipelineRoute answers for /api/pipeline/* and /t/*
     and returns false for everything else, so the routing below is unchanged.
     See server/pipeline/ for what it does. */
  if (await pipelineRoute(req, res, url)) return;

  /* --- meta --- */
  if (method === "GET" && pathname === "/api/health"){
    return sendJson(res, 200, {
      ok: true, version: VERSION, templates: knownTemplates(),
      storedSheets: sheets.size, uptimeSeconds: Math.round(process.uptime()),
      authRequired: !!API_KEY
    });
  }

  if (method === "GET" && pathname === "/api/templates"){
    return sendJson(res, 200, { templates: TEMPLATE_DOCS });
  }

  /* --- render --- */
  if (pathname === "/api/render"){
    if (method === "POST") return handleRender(req, res, await readJson(req), url);
    if (method === "GET"){
      const b64 = url.searchParams.get("data");
      if (!b64) return fail(res, 400, "no-data", "GET /api/render needs ?data=<base64url JSON>. Use POST for anything sizeable.");
      let parsed;
      try { parsed = decodeInline(b64); }
      catch (e){ return fail(res, 400, "invalid-json", "?data= is not base64-encoded JSON.", e.message); }
      return handleRender(req, res, parsed, url);
    }
    return fail(res, 405, "method-not-allowed", "Use POST (or GET with ?data=).");
  }

  /* --- validate --- */
  if (pathname === "/api/validate"){
    if (method !== "POST") return fail(res, 405, "method-not-allowed", "Use POST.");
    const { data } = unpackRequest(await readJson(req), url.searchParams);
    const out = validate(data);
    return sendJson(res, out.valid ? 200 : 422, out);
  }

  /* --- stored sheets --- */
  if (pathname === "/api/sheets"){
    if (method !== "POST") return fail(res, 405, "method-not-allowed", "Use POST.");
    return handleSheets(req, res, await readJson(req), url);
  }

  const sheetApi = pathname.match(/^\/api\/(?:sheets|lessons)\/([^/]+)$/);
  if (sheetApi){
    const id = decodeURIComponent(sheetApi[1]);

    if (method === "DELETE"){
      const had = sheets.delete(id);
      return sendJson(res, had ? 200 : 404, had ? { deleted: id } : { error: { code: "not-found", message: `No stored sheet "${id}".` } });
    }
    if (method !== "GET") return fail(res, 405, "method-not-allowed", "Use GET or DELETE.");

    const s = getSheet(id);
    if (s) return sendJson(res, 200, s.data);

    // Not a stored sheet — fall through to the lesson files, so a client
    // configured with apiBase:"/api" can read data/lessons/<id>.json too.
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)){
      try {
        const file = path.join(ROOT, "data", "lessons", `${id}.json`);
        return sendJson(res, 200, JSON.parse(await readFile(file, "utf8")));
      } catch { /* fall through to 404 */ }
    }
    return fail(res, 404, "not-found", `No sheet or lesson with id "${id}".`);
  }

  const stored = pathname.match(/^\/s\/([^/]+)$/);
  if (stored){
    if (method !== "GET") return fail(res, 405, "method-not-allowed", "Use GET.");
    return handleStoredPage(req, res, decodeURIComponent(stored[1]), url);
  }

  if (pathname.startsWith("/api/")){
    return fail(res, 404, "unknown-endpoint", `No API endpoint at ${pathname}. See /api/health.`);
  }

  /* --- the site itself --- */
  if (method !== "GET" && method !== "HEAD"){
    return fail(res, 405, "method-not-allowed", `${method} is not allowed on ${pathname}.`);
  }
  return serveStatic(req, res, pathname);
}

/* ------------------------------------------------------------------- boot -- */

const server = http.createServer((req, res) => {
  route(req, res).catch(err => {
    const status = err.status || 500;
    if (status >= 500) console.error("[edu-api]", err);

    // A rejected oversized upload is still streaming; hang up once the answer
    // has actually gone out, so the client reads the 413 first.
    if (status === 413) res.on("finish", () => { try { req.destroy(); } catch { /* already gone */ } });

    if (!res.headersSent) fail(res, status, err.code || "server-error", err.message || "Unexpected error", err.detail);
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`EduWebTemplateGenerator API  ·  v${VERSION}`);
  console.log(`  site   http://localhost:${PORT}/`);
  console.log(`  render POST http://localhost:${PORT}/api/render`);
  console.log(`  health GET  http://localhost:${PORT}/api/health`);
  if (API_KEY) console.log("  auth   X-Api-Key required on /api/*");
});
