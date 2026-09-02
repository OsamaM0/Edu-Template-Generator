/* ============================================================================
   question — one identified question, answerable on screen and on paper
   ----------------------------------------------------------------------------
   The difference between this and `note` is identity. A note card is prose; a
   question card carries `questionId`, so whatever the student writes or selects
   can be collected as {question_id: answer} and graded against a key the page
   itself never sees.

   Every kind renders as a real control rather than a list to read:
     multiple_choice / true_false   selectable option rows (radio semantics)
     complete                       the "____" runs become typeable blanks
     short_answer                   writing lines

   Printed, it looks like a worksheet — circles to tick, lines to write on.
   On screen, answer.js reads the same markup back.
   ========================================================================== */
import { esc, blanks, wline, repeat } from "../util.js";
import { cardHead, instr } from "../card.js";

export const type = "question";

/** Option rows. `value` is what gets submitted; `data-i` its original index. */
function options(sec){
  const opts = (sec.options || []).map((o, i) => {
    const label = typeof o === "string" ? o : (o.label || "");
    const value = typeof o === "string" ? o : (o.value != null ? o.value : label);
    return `
    <label class="qz-opt" role="radio" aria-checked="false" tabindex="0"
           data-i="${i}" data-value="${esc(value)}">
      <span class="tx">${esc(label)}</span>
      <span class="radio"></span>
    </label>`;
  }).join("");

  return opts ? `<div class="qz-opts" data-w="qz-opts" role="radiogroup">${opts}</div>` : "";
}

export function render(sec){
  const lines = repeat(sec.lines || 0, () => wline());

  return `${cardHead(sec)}${instr(sec)}
    <div class="qz" data-qid="${esc(sec.questionId || "")}" data-kind="${esc(sec.kind || "")}">
      ${sec.text ? `<p class="qz-text">${blanks(sec.text)}</p>` : ""}
      ${options(sec)}
      ${lines ? `<div class="qz-lines">${lines}</div>` : ""}
    </div>`;
}

export function wire(card){
  card.querySelectorAll('[data-w="qz-opts"]').forEach(group => {
    const opts = [...group.querySelectorAll(".qz-opt")];

    const select = opt => {
      opts.forEach(o => { o.classList.remove("sel"); o.setAttribute("aria-checked", "false"); });
      opt.classList.add("sel");
      opt.setAttribute("aria-checked", "true");
      // The answer layer listens here rather than polling the DOM.
      card.dispatchEvent(new CustomEvent("edu:answer", { bubbles: true }));
    };

    opts.forEach(opt => {
      opt.addEventListener("click", () => select(opt));
      opt.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); select(opt); }
      });
    });
  });
}

export function reset(card){
  card.querySelectorAll(".qz-opt").forEach(o => {
    o.classList.remove("sel");
    o.setAttribute("aria-checked", "false");
  });
  card.querySelectorAll(".wline, .blank").forEach(l => { l.textContent = ""; });
}
