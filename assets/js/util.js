/* ============================================================================
   util.js — escaping, the image-slot rule, small HTML helpers
   No DOM access, no state: pure string in / string out.
   ========================================================================== */

import { hasIcon, icon } from "./icons.js";

/** HTML-escape any value. Every piece of lesson JSON goes through this. */
export const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A value is an image URL if it looks like a path/URL; otherwise it is text (emoji). */
export const isUrl = v => typeof v === "string" && /[./\\]/.test(v) && !/\s/.test(v.trim());

/**
 * The placeholder rule — every icon / image / mascot / deco slot accepts:
 *   "puzzle"                    -> built-in line-art SVG (see icons.js)
 *   "🦁"                        -> the emoji itself
 *   "img/lion.png", "https://…" -> an <img> (class .dyn: swapped to a
 *                                  placeholder by render.js if it fails to load)
 *   "" / missing                -> a dashed placeholder box
 */
export function pic(v, cls, emCls){
  if (v == null || v === "") return `<span class="ph ${cls || ""}" style="width:32px;height:28px;">🖼️</span>`;
  if (typeof v === "string" && hasIcon(v.trim())) return icon(v.trim(), cls);
  if (isUrl(v)) return `<img class="pic dyn ${cls || ""}" src="${esc(v)}" alt="" loading="lazy">`;
  return `<span class="pic-emoji ${emCls || ""}">${esc(v)}</span>`;
}

/** Same as pic(), but an empty value renders nothing instead of a placeholder. */
export const picOrNothing = (v, cls, emCls) => (v == null || v === "" ? "" : pic(v, cls, emCls));

/** Turn every run of 3+ underscores in a sentence into an editable blank. */
export const blanks = t => esc(t).replace(/_{3,}/g,
  `<span class="blank" contenteditable="true" spellcheck="false"></span>`);

/** A writable dotted line. */
export const wline = extra => `<div class="wline ${extra || ""}" contenteditable="true" spellcheck="false"></div>`;

/**
 * An inline identity value (school, teacher, class…). When `editable` is set it
 * becomes a contenteditable field the reader can type into on screen and in
 * print; otherwise it is plain escaped text. Opt-in, so existing sheets that
 * pass a value with no flag are unchanged.
 */
export const field = (value, editable, placeholder) => {
  const v = esc(value == null ? "" : String(value));
  if (!editable) return v;
  const ph = placeholder ? ` data-ph="${esc(placeholder)}"` : "";
  return `<span class="ef" contenteditable="true" spellcheck="false"${ph}>${v}</span>`;
};

/** Repeat a string-producing function n times. */
export const repeat = (n, fn) => Array.from({ length: Math.max(0, n | 0) }, (_, i) => fn(i)).join("");

/** Lighten a hex color toward white. keep=0.10 -> a 10%-strength tint. */
export function mixWhite(hex, keep){
  const n = hex.replace("#", "");
  const p = n.length === 3 ? n.split("").map(c => c + c) : [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)];
  const m = c => Math.round(255 - (255 - parseInt(c, 16)) * keep);
  return `rgb(${m(p[0])}, ${m(p[1])}, ${m(p[2])})`;
}
