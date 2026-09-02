/* ============================================================================
   template: worksheet — the original A4 student worksheet
   A 3-column RTL grid of activity cards. JSON order = right-to-left placement.
   ========================================================================== */
import { esc } from "../util.js";
import { cardOpen, cardClose } from "../card.js";
import { tpal } from "../theme.js";
import { heroHtml, studentBarHtml, infoHtml, warmupHtml, objectivesHtml, footerHtml } from "../blocks.js";
import { forType } from "../sections/index.js";

export const template = "worksheet";

export function render(data, ctx){
  const meta = data.meta || {};

  const sections = (data.sections || []).map((sec, i) => {
    const p = tpal(sec.color, i);
    const mod = forType(sec.type);
    return cardOpen(p, sec.span, `sec-${esc(sec.type || "note")}`) + mod.render(sec, p) + cardClose();
  }).join("");

  return heroHtml(meta) +
    studentBarHtml(data.studentBar) +
    `<main class="grid">` +
      infoHtml(data.info) +
      warmupHtml(data.warmup) +
      objectivesHtml(data.objectives) +
      sections +
    `</main>` +
    footerHtml(ctx.footerDecor);
}

/** Hand each activity card to its own section module. */
export function wire(app, data){
  const cards = [...app.querySelectorAll(".grid > .card")];
  const secs  = data.sections || [];
  const fixed = cards.length - secs.length;      // info / warmup / objectives
  const onResize = [];

  secs.forEach((sec, i) => {
    const card = cards[fixed + i];
    if (!card) return;
    card._section = sec;
    const out = forType(sec.type).wire ? forType(sec.type).wire(card) : null;
    if (out && typeof out.onResize === "function") onResize.push(out.onResize);
  });

  return { onResize };
}

export function reset(app){
  app.querySelectorAll(".grid > .card").forEach(card => {
    const mod = forType(card._section && card._section.type);
    if (mod.reset) mod.reset(card);
  });
  app.querySelectorAll(".student-bar input").forEach(i => { i.value = ""; });
}

/** Presentation mode: one activity card per slide, titled by its own heading. */
export function slides(app){
  return [...app.querySelectorAll(".grid > .card")].map(el => {
    const h = el.querySelector(".card-head h2");
    const n = el.querySelector(".card-head .num");
    const label = [n && n.textContent, h && h.textContent].filter(Boolean).join(". ");
    return { el, title: label || "" };
  });
}
