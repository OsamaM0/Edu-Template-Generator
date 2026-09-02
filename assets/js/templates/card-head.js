/* ============================================================================
   card-head.js — header pieces shared by BOTH interactive-card templates
   (question cards and answer cards use the same masthead + footer language)
   ========================================================================== */
import { esc, pic, picOrNothing, isUrl, field } from "../util.js";

/** Centre block: big title, subtitle, and the lesson pill. */
export function mastheadMain(meta){
  const m = meta || {};
  const lessonLabel = m.lessonLabel || "عنوان الدرس";
  return `<div class="ic-head-main">
    <h1 class="ic-title">${esc(m.badge || m.title || "بطاقات مراجعة تفاعلية")}</h1>
    ${m.subtitle ? `<p class="ic-sub">${esc(m.subtitle)}</p>` : ""}
    ${m.lessonTitle ? `<div class="ic-lesson"><span class="l">${esc(lessonLabel)}:</span> ${esc(m.lessonTitle)}</div>` : ""}
  </div>`;
}

/**
 * Logo slot. meta.logo arrives already resolved by the dispatcher: the sheet's
 * own logo if it set one, else the site-wide logo (config.js → logo). An image
 * URL, a data: URI, or an emoji. Empty ("" everywhere) renders a neutral
 * dashed box, never a stand-in for anybody's real branding.
 */
export function logoBlock(meta){
  const m = meta || {};
  if (!m.logo) return `<div class="ic-head-side ic-logo is-empty"><span class="ph">شعار</span></div>`;
  const inner = isUrl(m.logo)
    ? `<img class="dyn" src="${esc(m.logo)}" alt="${esc(m.logoAlt || "")}">`
    : pic(m.logo);
  return `<div class="ic-head-side ic-logo">${inner}</div>`;
}

/** Right block of the question masthead: teacher / school identity rows. */
export function identityBlock(rows){
  if (!rows || !rows.length) return `<div class="ic-head-side"></div>`;
  const html = rows.map(r => `
    <div class="ic-id-row">
      ${picOrNothing(r.icon, "ic-id-ic")}
      <span class="lbl">${esc(r.label)}:</span>
      <span class="val">${field(r.value, r.editable, r.placeholder)}</span>
    </div>`).join("");
  return `<div class="ic-head-side ic-identity">${html}</div>`;
}

/** Right block of the answer masthead: the dark subject/grade tile. */
export function subjectBlock(s){
  if (!s) return `<div class="ic-head-side"></div>`;
  return `<div class="ic-head-side ic-subject">
    ${picOrNothing(s.icon, "ic-subject-ic")}
    <span class="tx">
      <b>${esc(s.title || "")}</b>
      ${s.subtitle ? `<i>${esc(s.subtitle)}</i>` : ""}
    </span>
  </div>`;
}

/** Bottom strip: 1–3 icon + text items spread across the sheet. */
export function cardsFooter(footer){
  const items = (footer && footer.items) || [];
  if (!items.length) return "";
  const html = items.map(it => `
    <span class="ic-foot-item">
      ${picOrNothing(it.icon, "ic-foot-ic")}
      <span>${esc(it.text || "")}</span>
    </span>`).join("");
  return `<footer class="ic-foot"><span class="ic-foot-dots" aria-hidden="true"></span>${html}</footer>`;
}

/** The dashed cut guide wrapper around one printable card. */
export const cutOpen  = () => `<div class="ic-cut"><span class="ic-scissors" aria-hidden="true">✂</span>`;
export const cutClose = () => `</div>`;
