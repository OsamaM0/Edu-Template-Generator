/* ============================================================================
   classify — sort word chips into columns.
   Click a chip, then a column (or a specific line). Click a placed word to
   send it back to the bank.
   ========================================================================== */
import { esc, pic, repeat } from "../util.js";
import { cardHead, instr, hint } from "../card.js";
import { tpal } from "../theme.js";

export const type = "classify";

export function render(sec){
  const chips = (sec.chips || [])
    .map(w => `<span class="chip" role="button" tabindex="0">${esc(w)}</span>`).join("");

  const cols = (sec.columns || []).map((col, i) => {
    const cp = tpal(col.color, i + 3);
    const lines = repeat(col.lines || 3, () => `<div class="cl-line"></div>`);
    return `<div class="cl-col" style="--cc:${cp.main};--cct:${cp.tint}">
      <div class="cl-col-head">
        ${col.icon ? `<span class="ic">${pic(col.icon)}</span>` : ""}
        <span>${esc(col.title || "")} ${col.subtitle ? `<span class="sub">${esc(col.subtitle)}</span>` : ""}</span>
      </div>
      <div class="cl-lines">${lines}</div>
    </div>`;
  }).join("");

  return `${cardHead(sec)}${instr(sec)}
    <div data-w="classify">
      <div class="word-bank" style="margin-bottom:6px">${chips}</div>
      <div class="cl-cols">${cols}</div>
    </div>
    ${hint("اضغط الكلمة ثم اضغط العمود المناسب.")}`;
}

export function wire(card){
  card.querySelectorAll('[data-w="classify"]').forEach(w => {
    const chips = [...w.querySelectorAll(".chip")];
    let sel = null;

    const pickChip = chip => {
      if (sel === chip){ chip.classList.remove("sel"); sel = null; return; }
      if (sel) sel.classList.remove("sel");
      sel = chip; chip.classList.add("sel");
    };

    chips.forEach(chip => {
      chip.addEventListener("click", () => pickChip(chip));
      chip.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); pickChip(chip); }
      });
    });

    w.querySelectorAll(".cl-col").forEach(col => col.addEventListener("click", ev => {
      const line = ev.target.closest(".cl-line");

      // Clicking a filled line returns that word to the bank.
      if (line && line.classList.contains("filled")){
        const t = line.textContent.trim();
        line.textContent = "";
        line.classList.remove("filled");
        chips.forEach(c => { if (c.textContent === t) c.classList.remove("used"); });
        return;
      }

      if (!sel) return;
      const target = line && !line.classList.contains("filled")
        ? line
        : [...col.querySelectorAll(".cl-line")].find(l => !l.classList.contains("filled"));
      if (!target) return;

      target.textContent = sel.textContent;
      target.classList.add("filled");
      sel.classList.remove("sel");
      sel.classList.add("used");
      sel = null;
    }));
  });
}

export function reset(card){
  card.querySelectorAll(".cl-line").forEach(l => { l.textContent = ""; l.classList.remove("filled"); });
  card.querySelectorAll(".chip").forEach(c => c.classList.remove("used", "sel"));
}
