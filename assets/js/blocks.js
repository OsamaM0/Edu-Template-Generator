/* ============================================================================
   blocks.js — the fixed blocks that are not "sections":
   hero · student bar · info · warmup · objectives · footer
   Each returns "" when its JSON key is absent, so the card just disappears.
   ========================================================================== */
import { esc, pic, isUrl, field } from "./util.js";
import { cardOpen, cardClose, cardHead } from "./card.js";
import { tpal } from "./theme.js";

export function heroHtml(meta){
  const m = meta || {};
  const em = v => (isUrl(v) ? `<img src="${esc(v)}" alt="">` : `<span class="em">${esc(v)}</span>`);
  const decor = m.decor || {};
  const side = (arr, cls) =>
    (arr && arr.length) ? `<div class="hero-decor ${cls}">${arr.map(em).join("")}</div>` : "";

  return `<header class="hero">
    <span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span>
    <div class="hero-badge">${esc(m.badge || "ورقة عمل")}</div><br>
    ${m.title ? `<div class="hero-title">${esc(m.title)}</div>` : ""}
    ${side(decor.right, "right")}${side(decor.left, "left")}
    <div class="hero-grass"></div>
  </header>`;
}

export function studentBarHtml(fields){
  if (!fields || !fields.length) return "";
  /* A locked field is one the server already knows — a sheet issued to a named
     student says whose it is, and that is not a value the page may edit. */
  const f = fields.map(x => `
    <div class="student-field${x.locked ? " is-locked" : ""}">
      <span class="ic">${pic(x.icon)}</span>
      <label>${esc(x.label)}:</label>
      <input type="text" ${x.value ? `value="${esc(x.value)}"` : ""}${x.locked ? " readonly" : ""}>
    </div>`).join("");
  return `<div class="student-bar">${f}</div>`;
}

export function infoHtml(info){
  if (!info) return "";
  const p = tpal(info.color || "yellow", 0);
  const rows = (info.rows || []).map(r => `
    <div class="info-row">
      <span class="ic">${pic(r.icon)}</span>
      <span class="lbl">${esc(r.label)}:</span>
      <span class="val">${field(r.value, r.editable, r.placeholder)}</span>
    </div>`).join("");
  return cardOpen(p) + `<div class="info-rows">${rows}</div>` + cardClose();
}

export function warmupHtml(w){
  if (!w) return "";
  const p = tpal(w.color || "orange", 1);
  return cardOpen(p) + cardHead(w) + `
    <div class="warmup-body">
      <p>${esc(w.text || "")}</p>
      ${w.mascot ? `<span class="mascot">${pic(w.mascot)}</span>` : ""}
    </div>` + cardClose();
}

export function objectivesHtml(o){
  if (!o) return "";
  const p = tpal(o.color || "green", 2);
  const items = (o.items || []).map(t => `<li>${esc(t)}</li>`).join("");
  return cardOpen(p) + cardHead(o) + `
    <div class="obj-body">
      <ul class="obj-list">${items}</ul>
      ${o.image ? `<span class="obj-img">${pic(o.image)}</span>` : ""}
    </div>` + cardClose();
}

export function footerHtml(decor){
  const items = (decor || []).map(d => `<span>${esc(d)}</span>`).join("");
  return `<div class="footer-grass">${items}</div>`;
}
