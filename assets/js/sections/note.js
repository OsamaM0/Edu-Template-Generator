/* ============================================================================
   note — the generic fallback card.
   Any section whose "type" has no dedicated renderer lands here, so an
   unknown type never breaks the page. Supports:
   title, titleIcon, number, instruction, text, items[], lines
   ========================================================================== */
import { esc, wline, repeat } from "../util.js";
import { cardHead, instr } from "../card.js";

export const type = "note";

export function render(sec){
  const items = (sec.items || []).map(t => `<li>${esc(t)}</li>`).join("");
  const lines = repeat(sec.lines || 0, () => wline());

  return `${cardHead(sec)}${instr(sec)}
    ${sec.text ? `<p class="note-text">${esc(sec.text)}</p>` : ""}
    ${items ? `<ul class="obj-list">${items}</ul>` : ""}
    ${lines ? `<div class="lines-list">${lines}</div>` : ""}`;
}

export function reset(card){
  card.querySelectorAll(".wline").forEach(l => { l.textContent = ""; });
}
