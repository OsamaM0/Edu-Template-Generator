/* ============================================================================
   homework — a paragraph plus writable dotted lines.
   ========================================================================== */
import { esc, pic, wline, repeat } from "../util.js";
import { cardHead } from "../card.js";

export const type = "homework";

export function render(sec){
  const lines = repeat(sec.lines || 3, () => wline());
  return `${cardHead(sec)}
    <div class="hw-text">
      ${sec.icon ? `<span class="ic">${pic(sec.icon)}</span>` : ""}
      <p>${esc(sec.text || "")}</p>
    </div>
    <div class="lines-list">${lines}</div>`;
}

export function reset(card){
  card.querySelectorAll(".wline").forEach(l => { l.textContent = ""; });
}
