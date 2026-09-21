/* ============================================================================
   cache.mjs — build a page once, serve it forever
   ----------------------------------------------------------------------------
   The endpoint's contract is that the second call for the same document is not
   a rebuild: no Mongo read, no template run, just bytes off disk. That only
   works if the key is derived from the request rather than handed out at
   random, so the caller who asks for (worksheet, 43617, seed 7) tomorrow gets
   the page that was built for them today.

     key = <type>-<document_idx>-<seed>-<hash of everything that changes the HTML>

   Two layers: an in-memory LRU for the hot pages and a disk copy under
   data/cache so a restart does not throw the work away. Each page is two
   files — the HTML and a .json sidecar holding the request that produced it,
   which is what lets /t/<key>?embed=1 build the variant without the caller
   having to repeat the original parameters.

   CACHE_VERSION is part of every key. Bump it when a builder changes shape,
   or old pages will be served for requests that would now render differently.
   ========================================================================== */
import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import config from "./config.mjs";

/* 4: `exam_date` prints into every template's date field.
   5: `school` and `teacher` print into the header rows that were blank.
   6: `subject` fills المادة, which used to be derived from the lesson
      documents — every page cached under 5 has the old, guessed value on it. */
export const CACHE_VERSION = "6";

/** Keys reach the filesystem, so nothing but this alphabet is ever accepted. */
const KEY_RE = /^[A-Za-z0-9_-]{3,160}$/;
export const isKey = k => KEY_RE.test(String(k || ""));

/* -------------------------------------------------------------------- key -- */

const sortObject = o => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Everything that changes the rendered bytes, and nothing that does not.
 * `download` is absent on purpose — it only sets a response header, so the
 * same cached page serves both the inline and the attachment request.
 */
export function canonicalRequest(req){
  return {
    v: CACHE_VERSION,
    type: req.type,
    documentIdx: String(req.documentIdx),
    seed: req.seed,
    /* The student is printed ON the sheet, so two students asking for the same
       lesson must not share one cached page. Only the identity fields go in —
       the assignment id and its token never do, because those change on every
       issue and would make the cache a write-only pile of one-hit pages. */
    student: req.student
      ? { id: req.student.id || "", name: req.student.name || "",
          classroom: req.student.classroom || "", section: req.student.section || "" }
      : null,
    /* Printed in the header, so two schools sharing one cached page would put
       the wrong name on somebody's sheet. The id rides along because a caller
       that sends one expects it back out of /data/<key> unchanged. */
    school: req.school ? { id: req.school.id || "", name: req.school.name || "" } : null,
    teacher: req.teacher ? { id: req.teacher.id || "", name: req.teacher.name || "" } : null,
    /* The subject prints on the المادة line of every type, so two subjects
       asking for the same lesson are two different pages — and a request that
       names none prints a blank line, which is a third. */
    subject: req.subject ? { id: req.subject.id || "", name: req.subject.name || "" } : null,
    /* Printed on the sheet, so it belongs to the key: the same worksheet sat
       on two different days is two different pages. The ISO day is what goes
       in for a real date, so "2026-9-15" and "2026-09-15" hash the same; free
       text hashes as the text it will print. */
    examDate: req.examDate ? (req.examDate.iso || req.examDate.text || null) : null,
    counts: sortObject(req.counts),
    theme: req.theme || null,
    color: req.color || null,
    standalone: !!req.standalone,
    interactive: req.interactive !== false,
    toolbar: req.toolbar !== false,
    embed: !!req.embed,
    autoImage: !!req.autoImage,
    autoPrint: !!req.autoPrint,
    title: req.title || null
  };
}

const slug = s => String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "x";

export function cacheKey(req){
  const canonical = canonicalRequest(req);
  const hash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 10);
  return `${slug(canonical.type)}-${slug(canonical.documentIdx)}-${slug(String(canonical.seed))}-${hash}`;
}

/* ----------------------------------------------------------------- memory -- */

const hot = new Map();   // key -> { html, meta }

function touch(key, entry){
  hot.delete(key);
  hot.set(key, entry);
  while (hot.size > config.memoryPages) hot.delete(hot.keys().next().value);
}

/* ------------------------------------------------------------------- disk -- */

/* Not memoized on purpose. A memoized "the directory exists" belief never
   recovers if the directory is removed underneath a running server — by a
   deploy script, a cleanup job, or a developer — and every write from then on
   fails with ENOENT. Recursive mkdir on an existing directory is one cheap
   syscall next to the file write it precedes. */
const ensureDir = () => mkdir(config.cacheDir, { recursive: true });

const htmlPath = key => path.join(config.cacheDir, `${key}.html`);
const metaPath = key => path.join(config.cacheDir, `${key}.json`);

const expired = meta =>
  config.cacheTtlMs > 0 && Date.now() - Date.parse(meta.builtAt) > config.cacheTtlMs;

/**
 * The cached page, or null. A TTL-expired page is deleted here rather than
 * left for the sweeper, so the next read is a clean miss.
 */
export async function get(key){
  if (!isKey(key)) return null;

  const cached = hot.get(key);
  if (cached){
    if (!expired(cached.meta)){ touch(key, cached); return cached; }
    hot.delete(key);
  }

  try {
    const [html, metaRaw] = await Promise.all([
      readFile(htmlPath(key), "utf8"),
      readFile(metaPath(key), "utf8")
    ]);
    const meta = JSON.parse(metaRaw);

    if (expired(meta)){ await remove(key); return null; }

    const entry = { html, meta };
    touch(key, entry);
    return entry;
  } catch {
    return null;   // missing, unreadable, or half-written — all mean "rebuild"
  }
}

export async function put(key, html, meta){
  if (!isKey(key)) throw new Error(`Refusing to cache under an unsafe key: ${key}`);

  await ensureDir();
  const record = { ...meta, key, builtAt: meta.builtAt || new Date().toISOString(), bytes: Buffer.byteLength(html, "utf8") };

  // HTML first: a page whose sidecar is missing reads as a miss, which is
  // recoverable. A sidecar with no page would look like a hit and 404.
  await writeFile(htmlPath(key), html, "utf8");
  await writeFile(metaPath(key), JSON.stringify(record, null, 2), "utf8");

  touch(key, { html, meta: record });
  sweep().catch(() => { /* housekeeping must never fail a request */ });
  return record;
}

export async function remove(key){
  if (!isKey(key)) return false;
  hot.delete(key);
  const results = await Promise.allSettled([unlink(htmlPath(key)), unlink(metaPath(key))]);
  return results.some(r => r.status === "fulfilled");
}

/* --------------------------------------------------------------- inventory -- */

export async function list(){
  try {
    const files = (await readdir(config.cacheDir)).filter(f => f.endsWith(".json"));
    const pages = await Promise.all(files.map(async file => {
      try { return JSON.parse(await readFile(path.join(config.cacheDir, file), "utf8")); }
      catch { return null; }
    }));
    return pages.filter(Boolean).sort((a, b) => String(b.builtAt).localeCompare(String(a.builtAt)));
  } catch {
    return [];
  }
}

/** Drop the oldest pages once the directory outgrows EDU_PIPELINE_CACHE_MAX. */
let sweeping = false;
export async function sweep(){
  if (sweeping) return 0;
  sweeping = true;
  try {
    const keys = (await readdir(config.cacheDir))
      .filter(f => f.endsWith(".html"))
      .map(f => f.slice(0, -5));

    if (keys.length <= config.cacheMax) return 0;

    const aged = await Promise.all(keys.map(async key => {
      try { return { key, at: (await stat(htmlPath(key))).mtimeMs }; }
      catch { return { key, at: 0 }; }
    }));

    const doomed = aged.sort((a, b) => a.at - b.at).slice(0, keys.length - config.cacheMax);
    await Promise.all(doomed.map(d => remove(d.key)));
    return doomed.length;
  } catch {
    return 0;
  } finally {
    sweeping = false;
  }
}

export async function clear(){
  hot.clear();
  const pages = await list();
  await Promise.all(pages.map(p => remove(p.key)));
  return pages.length;
}

export async function stats(){
  const pages = await list();
  return {
    pages: pages.length,
    memoryPages: hot.size,
    bytes: pages.reduce((sum, p) => sum + (p.bytes || 0), 0),
    dir: config.cacheDir,
    ttlMinutes: config.cacheTtlMs ? config.cacheTtlMs / 60_000 : 0,
    max: config.cacheMax,
    version: CACHE_VERSION
  };
}
