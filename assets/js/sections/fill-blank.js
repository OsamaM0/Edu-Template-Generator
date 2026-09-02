/* ============================================================================
   fill-blank — word bank + sentences containing ___ blanks.
   Click a word to fill the first empty blank; blanks are typeable;
   double-click a blank to clear it and return the word to the bank.
   ========================================================================== */
import { esc, pic, blanks } from "../util.js";
import { cardHead, instr, hint } from "../card.js";

export const type = "fill-blank";

export function render(sec){
  const bank = (sec.wordBank || [])
    .map(w => `<span class="chip" role="button" tabindex="0">${esc(w)}</span>`).join("");

  /* data-qid is what makes a filled-in blank reportable: the answer layer reads
     the blanks inside an item and files them under that question's id. Items
     without one (a plain practice sentence) are simply not collected. */
  const items = (sec.items || []).map(it => `
    <div class="fb-item"${it.qid ? ` data-qid="${esc(it.qid)}"` : ""}${it.kind ? ` data-kind="${esc(it.kind)}"` : ""}>
      ${it.icon ? `<span class="ic">${pic(it.icon)}</span>` : ""}
      <p>${blanks(it.text || "")}</p>
    </div>`).join("");

  return `${cardHead(sec)}${instr(sec)}
    ${bank ? `<div class="word-bank" data-w="bank">${bank}</div>` : ""}
    <div class="fb-items">${items}</div>
    ${hint("اضغط الكلمة ثم يكتمل الفراغ، أو اكتب بنفسك.")}`;
}

export function wire(card){
  const chips = [...card.querySelectorAll('[data-w="bank"] .chip')];

  const fill = chip => {
    const blank = [...card.querySelectorAll(".blank")].find(b => !b.textContent.trim());
    if (!blank) return;
    blank.textContent = chip.textContent;
    chip.classList.add("used");
  };

  chips.forEach(chip => {
    chip.addEventListener("click", () => fill(chip));
    chip.addEventListener("keydown", e => {
      if (e.key === " " || e.key === "Enter"){ e.preventDefault(); fill(chip); }
    });
  });

  card.querySelectorAll(".blank").forEach(b => b.addEventListener("dblclick", () => {
    const t = b.textContent.trim();
    b.textContent = "";
    chips.forEach(c => { if (c.textContent === t) c.classList.remove("used"); });
  }));
}

export function reset(card){
  card.querySelectorAll(".blank").forEach(b => { b.textContent = ""; });
  card.querySelectorAll(".chip").forEach(c => c.classList.remove("used", "sel"));
}
