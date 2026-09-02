/* ============================================================================
   template: interactive-card-answers — the model-answer counterpart
   ----------------------------------------------------------------------------
   masthead (subject tile) · meta chips · cut line · 2×N answer grid · footer
   Each card: model answer, a short "why" note, and a skill + score bar.
   ========================================================================== */
import { esc, picOrNothing, field } from "../util.js";
import { tpal } from "../theme.js";
import { mastheadMain, logoBlock, subjectBlock, cardsFooter } from "./card-head.js";

export const template = "interactive-card-answers";

/** The masthead logoBlock IS the logo spot — no .site-logo overlay needed. */
export const ownsLogo = true;

/* --- header ---------------------------------------------------------------- */

function metaBar(rows){
  if (!rows || !rows.length) return "";
  const chips = rows.map(r => `
    <div class="ac-chip">
      ${picOrNothing(r.icon, "ac-chip-ic")}
      <span class="lbl">${esc(r.label)}:</span>
      <span class="val">${field(r.value, r.editable, r.placeholder)}</span>
    </div>`).join("");
  return `<div class="ac-meta">${chips}</div>`;
}

const cutLine = () => `<div class="ac-cut"><span class="ic-scissors" aria-hidden="true">✂</span></div>`;

/* --- one answer card -------------------------------------------------------- */

function answerCard(c, i){
  const p = tpal(c.color, i);

  const listTag = c.ordered ? "ol" : "ul";
  const bullets = (c.bullets || []).length
    ? `<${listTag} class="ac-list">${c.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</${listTag}>`
    : "";

  const note = c.note
    ? `<div class="ac-note">
         <h4>${esc(c.note.title || "تفسير مختصر")}</h4>
         <p>${esc(c.note.text || "")}</p>
       </div>`
    : "";

  const skill = c.skill
    ? `<span class="b-lbl">${esc(c.skill.label || "المهارة")}:</span>
       <span class="b-val">${esc(c.skill.value || "")}</span>`
    : "";

  const score = c.score
    ? `<span class="b-score">${esc(c.score.label || "الدرجة المقترحة")}:
         <b>${esc(c.score.value || "")}</b></span>`
    : "";

  const bar = (skill || score) ? `<div class="ac-bar">${skill}${score}</div>` : "";

  return `<article class="ac-card" style="--c:${p.main};--tint:${p.tint}">
    ${c.number != null ? `<span class="ac-num">${esc(c.number)}</span>` : ""}
    <h3 class="ac-title">${esc(c.title || "الإجابة النموذجية")}</h3>
    <div class="ac-body">
      <div class="ac-text">
        ${c.lead ? `<p class="lead">${esc(c.lead)}</p>` : ""}
        ${c.text ? `<p>${esc(c.text)}</p>` : ""}
        ${bullets}
      </div>
      ${c.icon ? `<span class="ac-art">${picOrNothing(c.icon)}</span>` : ""}
    </div>
    ${note}
    ${bar}
  </article>`;
}

/* --- template hooks --------------------------------------------------------- */

export function render(data){
  const meta = data.meta || {};
  const cards = (data.cards || []).map(answerCard).join("");

  return `<header class="ic-head ac-head">
      ${subjectBlock(data.subject)}
      ${mastheadMain(meta)}
      ${logoBlock(meta)}
    </header>` +
    metaBar(data.metaBar) +
    cutLine() +
    `<main class="ac-grid" style="--cols:${Number(meta.columns) || 2}">${cards}</main>` +
    cardsFooter(data.footer);
}

/* Answer sheets are read-only by design — nothing to wire or reset. */

/** Presentation mode: reveal one model answer at a time. */
export function slides(app){
  return [...app.querySelectorAll(".ac-card")].map(el => {
    const n = el.querySelector(".ac-num");
    const s = el.querySelector(".ac-bar .b-val");
    const label = [n && `إجابة ${n.textContent}`, s && s.textContent].filter(Boolean).join(" — ");
    return { el, title: label || "" };
  });
}
