/* ============================================================================
   loader.js — resolve a URL into worksheet JSON
   ----------------------------------------------------------------------------
   Resolution order (first hit wins):
     0. window.EDU_DATA         payload printed into the page (POST /api/render)
     1. ?data=<base64-json>      inline payload, no network        (opt-in)
     2. ?src=<url>              explicit JSON URL                  (opt-in)
     3. ?lesson=<id>            API  -> {apiBase}/lessons/{id}
                                static -> data/lessons/{id}.json
     4. config.defaultLesson    same as 3, with the configured id

   Every failure throws a LoadError carrying a `code` that main.js turns into
   an Arabic message. Nothing here touches the DOM.
   ========================================================================== */

import { unpack } from "./pack.js";

const CFG = Object.assign({
  apiBase: "",
  apiPath: "{base}/lessons/{id}",
  lessonPath: "data/lessons/{id}.json",
  packedPath: "data/lessons/{id}.wsx",
  fallbackToStatic: true,
  lessonParams: ["lesson", "lessonId", "id", "l"],
  defaultLesson: "",
  requestHeaders: {},
  credentials: "same-origin",
  unwrapKeys: ["data", "worksheet", "lesson", "result"],
  allowInlineData: true,
  allowSrcParam: true,
  showToolbar: "auto",
  cache: "no-store",
  footerDecor: ["🌼", "🌱", "🌸", "🍀", "🌷"]
}, window.EDU_CONFIG || {});

export const config = CFG;

export class LoadError extends Error {
  constructor(code, message, detail){
    super(message);
    this.name = "LoadError";
    this.code = code;         // invalid-id | not-found | network | parse | offline | no-lesson
    this.detail = detail || "";
  }
}

/* --- URL parsing ---------------------------------------------------------- */

/** Lesson ids become part of a file path, so keep them boring on purpose. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function readParams(search){
  const qs = new URLSearchParams(search != null ? search : location.search);

  let lessonId = null;
  for (const key of CFG.lessonParams){
    const v = qs.get(key);
    if (v != null && v !== ""){ lessonId = v.trim(); break; }
  }

  const toolbar = qs.get("toolbar");

  const opts = (typeof window !== "undefined" && window.EDU_OPTIONS) || {};

  return {
    lessonId,
    // A page rendered by POST /api/render carries its payload inline.
    inline:  (typeof window !== "undefined" && window.EDU_DATA) || null,
    // ?age= and ?theme= are the same knob, in the two vocabularies.
    theme:   qs.get("age") || qs.get("theme") || opts.theme || null,
    data:    CFG.allowInlineData ? qs.get("data") : null,
    src:     CFG.allowSrcParam   ? qs.get("src")  : null,
    toolbar: toolbar == null ? (opts.toolbar == null ? null : !!opts.toolbar)
                             : !/^(0|false|no|off)$/i.test(toolbar),
    embed:   /^(1|true|yes)$/i.test(qs.get("embed") || "") || !!opts.embed,
    // Automation hooks: render, then immediately save the image / open print.
    autoImage: /^(1|true|yes)$/i.test(qs.get("image") || "") || !!opts.autoImage,
    autoPrint: /^(1|true|yes)$/i.test(qs.get("print") || "") || !!opts.autoPrint
  };
}

/* --- helpers -------------------------------------------------------------- */

const fill = (tpl, vars) =>
  String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));

function decodeInline(s){
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e){
    throw new LoadError("parse", "?data= payload is not valid base64 JSON", e.message);
  }
}

/** Unwrap {data:{…}} / {worksheet:{…}} style API envelopes. */
function unwrap(json){
  let out = json;
  for (const key of CFG.unwrapKeys){
    if (out && typeof out === "object" && !Array.isArray(out) && out[key] && typeof out[key] === "object"){
      out = out[key];
    }
  }
  return out;
}

async function fetchJson(url){
  if (location.protocol === "file:"){
    throw new LoadError("offline", "fetch() is blocked on the file:// protocol", url);
  }

  let res;
  try {
    res = await fetch(url, {
      cache: CFG.cache,
      credentials: CFG.credentials,
      headers: Object.assign({ Accept: "application/json" }, CFG.requestHeaders)
    });
  } catch (e){
    throw new LoadError("network", `Request failed: ${url}`, e.message);
  }

  if (res.status === 404) throw new LoadError("not-found", `404: ${url}`, url);
  if (!res.ok)            throw new LoadError("network", `HTTP ${res.status}: ${url}`, url);

  try {
    return unwrap(await res.json());
  } catch (e){
    throw new LoadError("parse", `Response is not valid JSON: ${url}`, e.message);
  }
}

/** Fetch + decrypt a .wsx container (see pack.js). */
async function fetchPacked(url){
  if (location.protocol === "file:"){
    throw new LoadError("offline", "fetch() is blocked on the file:// protocol", url);
  }

  let res;
  try {
    res = await fetch(url, { cache: CFG.cache, credentials: CFG.credentials, headers: CFG.requestHeaders });
  } catch (e){
    throw new LoadError("network", `Request failed: ${url}`, e.message);
  }

  if (res.status === 404) throw new LoadError("not-found", `404: ${url}`, url);
  if (!res.ok)            throw new LoadError("network", `HTTP ${res.status}: ${url}`, url);

  try {
    return unwrap(await unpack(await res.arrayBuffer()));
  } catch (e){
    throw new LoadError("parse", `Not a valid packed lesson: ${url}`, e.message);
  }
}

/* --- URL builders --------------------------------------------------------- */

export const staticUrlFor = id => fill(CFG.lessonPath, { id });

export const apiUrlFor = id =>
  fill(CFG.apiPath, { base: String(CFG.apiBase).replace(/\/+$/, ""), id });

/* --- the public entry point ----------------------------------------------- */

/**
 * @returns {Promise<{data:object, lessonId:string|null, source:string, url:string|null}>}
 */
export async function loadWorksheet(params){
  const p = params || readParams();

  // 0. payload printed into the page by the render API
  if (p.inline && typeof p.inline === "object"){
    return { data: p.inline, lessonId: null, source: "inline-global", url: null };
  }

  // 1. inline base64
  if (p.data){
    return { data: decodeInline(p.data), lessonId: null, source: "inline", url: null };
  }

  // 2. explicit URL
  if (p.src){
    return { data: await fetchJson(p.src), lessonId: null, source: "src", url: p.src };
  }

  // 3./4. by lesson id
  const rawId = p.lessonId || CFG.defaultLesson;
  if (!rawId){
    throw new LoadError("no-lesson", "No lesson id in the URL and no defaultLesson configured");
  }

  const id = String(rawId).trim();
  if (!ID_RE.test(id)){
    throw new LoadError("invalid-id", `Rejected lesson id: ${id}`, id);
  }

  // API first when configured, static file as the safety net.
  if (CFG.apiBase){
    const apiUrl = apiUrlFor(id);
    try {
      return { data: await fetchJson(apiUrl), lessonId: id, source: "api", url: apiUrl };
    } catch (err){
      if (!CFG.fallbackToStatic) throw err;
      console.warn(`[edu] API request failed (${err.code}), falling back to the static file.`, err);
    }
  }

  // Encrypted container first when enabled; plain JSON stays the dev fallback
  // so unpacked lessons keep working locally before tools/pack-lessons.mjs ran.
  if (CFG.protection && CFG.protection.packedLessons){
    const packedUrl = fill(CFG.packedPath, { id });
    try {
      return { data: await fetchPacked(packedUrl), lessonId: id, source: "packed", url: packedUrl };
    } catch (err){
      if (err.code !== "not-found") throw err;
      console.warn(`[edu] no packed lesson at ${packedUrl}, trying the plain JSON file.`);
    }
  }

  const fileUrl = staticUrlFor(id);
  return { data: await fetchJson(fileUrl), lessonId: id, source: "static", url: fileUrl };
}
