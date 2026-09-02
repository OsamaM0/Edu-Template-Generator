/* ============================================================================
   choose — multiple choice. One selection per row.
   ========================================================================== */
import { esc, pic } from "../util.js";
import { cardHead, instr } from "../card.js";

export const type = "choose";

export function render(sec){
  const rows = (sec.rows || []).map(row => {
    const opts = (row.options || []).map(o => `
      <div class="opt" role="radio" aria-checked="false" tabindex="0">
        <span class="pv">${pic(o.image)}</span>
        ${o.label ? `<span class="sl">${esc(o.label)}</span>` : ""}
        <span class="radio"></span>
      </div>`).join("");
    const s = row.subject || {};
    return `<div class="mcq-row" role="radiogroup">
      <div class="mcq-opts">${opts}</div>
      <div class="mcq-subj">
        <span class="pv">${pic(s.image)}</span>
        ${s.label ? `<span class="sl">${esc(s.label)}</span>` : ""}
      </div>
    </div>`;
  }).join("");

  return `${cardHead(sec)}${instr(sec)}<div class="mcq-rows" data-w="mcq">${rows}</div>`;
}

export function wire(card){
  card.querySelectorAll('[data-w="mcq"] .mcq-row').forEach(row => {
    const opts = [...row.querySelectorAll(".opt")];
    const select = opt => {
      opts.forEach(o => { o.classList.remove("sel"); o.setAttribute("aria-checked", "false"); });
      opt.classList.add("sel");
      opt.setAttribute("aria-checked", "true");
    };
    opts.forEach(opt => {
      opt.addEventListener("click", () => select(opt));
      opt.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); select(opt); }
      });
    });
  });
}

/** Called by the toolbar's reset button. */
export function reset(card){
  card.querySelectorAll(".opt").forEach(o => {
    o.classList.remove("sel");
    o.setAttribute("aria-checked", "false");
  });
}
