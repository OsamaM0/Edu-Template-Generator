/* ============================================================================
   self-assessment — clickable faces (playful) / selectable pills (pro).
   The face circle is hidden by theme-pro.css; the label becomes the control.
   ========================================================================== */
import { esc, pic } from "../util.js";
import { cardHead } from "../card.js";
import { tpal } from "../theme.js";

export const type = "self-assessment";

export function render(sec){
  const faces = (sec.options || []).map((o, i) => {
    const fp = tpal(o.color, i);
    return `<div class="sa-face" role="button" tabindex="0" aria-pressed="false" style="--fc:${fp.main};--fc-t:${fp.tint}">
      <span class="fc">${pic(o.icon)}</span>
      <span class="sl">${esc(o.label || "")}</span>
    </div>`;
  }).join("");

  return `${cardHead(sec)}
    ${sec.prompt ? `<div class="sa-prompt">${esc(sec.prompt)}</div>` : ""}
    <div class="sa-faces" data-w="faces">${faces}</div>`;
}

export function wire(card){
  card.querySelectorAll('[data-w="faces"]').forEach(w => {
    const faces = [...w.querySelectorAll(".sa-face")];
    const select = f => {
      faces.forEach(x => {
        x.classList.remove("sel");
        x.classList.add("dim");
        x.setAttribute("aria-pressed", "false");
      });
      f.classList.add("sel");
      f.classList.remove("dim");
      f.setAttribute("aria-pressed", "true");
    };
    faces.forEach(f => {
      f.addEventListener("click", () => select(f));
      f.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); select(f); }
      });
    });
  });
}

export function reset(card){
  card.querySelectorAll(".sa-face").forEach(f => {
    f.classList.remove("sel", "dim");
    f.setAttribute("aria-pressed", "false");
  });
}
