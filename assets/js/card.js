/* ============================================================================
   card.js — the chrome every card shares: outer <section>, head, instruction
   Section renderers build their body and let these wrap it.
   ========================================================================== */
import { esc, pic } from "./util.js";

/** Opening tag of a card. p = {main, tint} from theme.js. */
export function cardOpen(p, span, extraCls){
  const sp = span === 2 ? "sp2" : span === 3 ? "sp3" : "";
  return `<section class="card ${sp} ${extraCls || ""}" style="--c:${p.main};--tint:${p.tint}">`;
}

export const cardClose = () => `</section>`;

/** Numbered circle + title icon + title, in a tinted pill. */
export function cardHead(sec){
  const num = sec.number != null ? `<span class="num">${esc(sec.number)}</span>` : "";
  const ic  = sec.titleIcon ? `<span class="t-ic">${pic(sec.titleIcon)}</span>` : "";
  return `<div class="card-head">${num}${ic}<h2>${esc(sec.title || "")}</h2></div>`;
}

/** Small grey line under the head. */
export const instr = sec =>
  sec.instruction ? `<div class="instruction">${esc(sec.instruction)}</div>` : "";

/** Bottom-of-card usage hint. The 💡 is hidden by the pro theme. */
export const hint = text => `<div class="hint"><span class="hint-ic">💡 </span>${esc(text)}</div>`;
