/* ============================================================================
   template: interactive-card — printable/cut-out review QUESTION cards
   ----------------------------------------------------------------------------
   masthead · objectives strip + card counter · 2×N cut-out grid · footer
   Every card is interactive on screen (typeable answer lines, selectable MCQ)
   and cuts cleanly on paper.
   ========================================================================== */
import { esc, picOrNothing, blanks, wline, repeat } from "../util.js";
import { tpal } from "../theme.js";
import { mastheadMain, logoBlock, identityBlock, cardsFooter, cutOpen, cutClose } from "./card-head.js";

export const template = "interactive-card";

/** The masthead logoBlock IS the logo spot — no .site-logo overlay needed. */
export const ownsLogo = true;

/* --- header ---------------------------------------------------------------- */

function objectivesStrip(obj, counter){
  if (!obj && !counter) return "";

  const goals = obj && obj.items && obj.items.length
    ? `<ol class="ic-goals">${obj.items.map((t, i) => `
        <li><span class="n">${i + 1}</span><span class="t">${esc(t)}</span></li>`).join("")}</ol>`
    : `<div class="ic-goals"></div>`;

  const head = obj
    ? `<div class="ic-strip-title">
         ${picOrNothing(obj.icon || "target", "ic-strip-ic")}
         <span>${esc(obj.title || "أهداف الدرس")}</span>
       </div>`
    : "";

  const count = counter
    ? `<div class="ic-counter">
         <span class="c-lbl">${esc(counter.label || "عدد البطاقات")}</span>
         <span class="c-val">${esc(counter.value)}</span>
         <span class="c-unit">${esc(counter.unit || "")}</span>
         ${picOrNothing(counter.icon || "book", "c-ic")}
       </div>`
    : "";

  return `<section class="ic-strip">${head}${goals}${count}</section>`;
}

/* --- one question card ------------------------------------------------------ */

function questionCard(c, i){
  const p = tpal(c.color, i);

  // Text first, radio second: in RTL that puts the circles in a tidy column
  // down the left edge, matching the printed reference.
  const opts = (c.options || []).map((o, k) => {
    const label = typeof o === "string" ? o : (o.label || "");
    const value = typeof o === "string" ? o : (o.value != null ? o.value : label);
    return `
    <label class="ic-opt" role="radio" aria-checked="false" tabindex="0"
           data-i="${k}" data-value="${esc(value)}">
      <span class="tx">${esc(label)}</span>
      <span class="radio"></span>
    </label>`;
  }).join("");

  const bullets = (c.bullets || []).map(b => `<li>${esc(b)}</li>`).join("");

  // Answer area: numbered lines, plain lines, or the single default line.
  const n = c.lines != null ? c.lines : 1;
  const lines = c.numbered
    ? repeat(n, k => `<div class="ic-ans-row"><span class="ic-ans-n">${k + 1}.</span>${wline()}</div>`)
    : repeat(n, () => `<div class="ic-ans-row">${wline()}</div>`);

  const answerLabel = c.answerLabel === "" ? "" :
    `<span class="ic-ans-lbl">${esc(c.answerLabel || "إجابتك")}:</span>`;

  /* data-qid is the card's identity for the answer layer — a deck built from a
     lesson carries one per question, a hand-written deck carries none and is
     simply not collected. */
  const ident = (c.questionId ? ` data-qid="${esc(c.questionId)}"` : "") +
                (c.kind ? ` data-kind="${esc(c.kind)}"` : "");

  return cutOpen() + `
    <article class="ic-card"${ident} style="--c:${p.main};--tint:${p.tint}">
      ${c.number != null ? `<span class="ic-num">${esc(c.number)}</span>` : ""}
      ${c.tag ? `<span class="ic-tag">${esc(c.tag)}</span>` : ""}
      <div class="ic-body">
        <div class="ic-q">
          ${c.question ? `<p class="ic-qt">${blanks(c.question)}</p>` : ""}
          ${opts ? `<div class="ic-opts" data-w="ic-opts" role="radiogroup">${opts}</div>` : ""}
          ${bullets ? `<ul class="ic-bullets">${bullets}</ul>` : ""}
          ${c.fill ? `<p class="ic-fill">${blanks(c.fill)}</p>` : ""}
        </div>
        ${c.icon ? `<span class="ic-art">${picOrNothing(c.icon)}</span>` : ""}
      </div>
      <div class="ic-ans">${answerLabel}<div class="ic-ans-lines">${lines}</div></div>
    </article>` + cutClose();
}

/* --- template hooks --------------------------------------------------------- */

export function render(data){
  const meta = data.meta || {};
  const cards = (data.cards || []).map(questionCard).join("");

  return `<header class="ic-head">
      ${identityBlock(data.identity)}
      ${mastheadMain(meta)}
      ${logoBlock(meta)}
    </header>` +
    objectivesStrip(data.objectives, data.counter) +
    `<main class="ic-grid" style="--cols:${Number(meta.columns) || 2}">${cards}</main>` +
    cardsFooter(data.footer);
}

export function wire(app){
  app.querySelectorAll('[data-w="ic-opts"]').forEach(group => {
    const opts = [...group.querySelectorAll(".ic-opt")];
    const select = o => {
      opts.forEach(x => { x.classList.remove("sel"); x.setAttribute("aria-checked", "false"); });
      o.classList.add("sel");
      o.setAttribute("aria-checked", "true");
      o.dispatchEvent(new CustomEvent("edu:answer", { bubbles: true }));
    };
    opts.forEach(o => {
      o.addEventListener("click", () => select(o));
      o.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); select(o); }
      });
    });
  });
}

export function reset(app){
  app.querySelectorAll(".ic-opt").forEach(o => {
    o.classList.remove("sel");
    o.setAttribute("aria-checked", "false");
  });
  app.querySelectorAll(".wline, .blank").forEach(l => { l.textContent = ""; });
}

/** Presentation mode: one review card per slide, titled "بطاقة N — tag". */
export function slides(app){
  return [...app.querySelectorAll(".ic-card")].map(el => {
    const n   = el.querySelector(".ic-num");
    const tag = el.querySelector(".ic-tag");
    const label = [n && `بطاقة ${n.textContent}`, tag && tag.textContent].filter(Boolean).join(" — ");
    return { el, title: label || "" };
  });
}
