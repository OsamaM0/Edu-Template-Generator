/* ============================================================================
   template: differentiated-lesson — a full lesson-plan sheet built on
   differentiated instruction (التعليم المتمايز)
   ----------------------------------------------------------------------------
   masthead (formula · title · art) · banner · meta row ·
   sidebar (goals / strategies / tools / homework) beside the main flow
   (level groups → intro → differentiated activities → differentiated
   assessment) · a closing 3-card strip (closure / support / enrichment).

   Levels carry meaning, so their colors survive BOTH themes:
     basic → orange · middle → sky · advanced → teal   (or a per-item "color")
   Everything else colors through tpal(): named colors in kid mode, the single
   accent in pro mode — the engine's usual rule.
   ========================================================================== */
import { esc, picOrNothing, repeat, mixWhite } from "../util.js";
import { tpal, PALETTES, resolveAccent } from "../theme.js";

export const template = "differentiated-lesson";

/** The masthead art corner doubles as the logo spot — no overlay needed. */
export const ownsLogo = true;

/* --- level colors ----------------------------------------------------------- */

const LEVEL_COLOR = { basic: "orange", middle: "sky", advanced: "teal" };

/** The color of a leveled item: its own "color", else its level, else a cycle. */
function levelPal(item, i){
  const name = (item && item.color) || LEVEL_COLOR[item && item.level];
  if (name && PALETTES[name]) return PALETTES[name];
  if (name) return resolveAccent(name);                       // hex
  const cycle = ["orange", "sky", "teal", "purple", "green"];
  return PALETTES[cycle[(i || 0) % cycle.length]];
}

/* --c2 is the light gradient end, precomputed because html2canvas (the
   save-as-image capture) cannot resolve color-mix() inside gradients. */
const vars = p => `--c:${p.main};--c2:${mixWhite(p.main, 0.72)};--tint:${p.tint}`;

/* --- small shared pieces ----------------------------------------------------- */

/** A plain bullet list. */
const bullets = items => items && items.length
  ? `<ul class="dl-list">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`
  : "";

/** A white card with a colored gradient header. `p` from tpal()/levelPal(). */
function card(p, icon, title, bodyHtml, cls){
  return `<section class="dl-card ${cls || ""}" style="${vars(p)}">
    <header class="dl-card-hd">${picOrNothing(icon, "dl-hd-ic")}<span>${esc(title)}</span></header>
    <div class="dl-card-bd">${bodyHtml}</div>
  </section>`;
}

/* --- masthead ---------------------------------------------------------------- */

function masthead(meta){
  const m = meta || {};
  const f = m.formula;
  const lines = f && f.lines && f.lines.length
    ? f.lines.map(l => `<div class="fline" dir="ltr">${esc(l)}</div>`).join("")
    : "";
  const formula = lines
    ? `<div class="dl-head-side dl-formula-wrap">
         <div class="dl-formula">${lines}</div>
         ${f.icon ? `<span class="dl-bulb">${picOrNothing(f.icon)}</span>` : ""}
       </div>`
    : `<div class="dl-head-side"></div>`;

  // The corner slot: the school logo when one is set (site-wide or meta.logo)
  // takes the spot, else the sheet's own art.
  const corner = m.logo
    ? `<span class="dl-logo">${picOrNothing(m.logo, "dl-logo-pic")}</span>`
    : picOrNothing(m.art, "dl-art-pic", "dl-art-emoji");

  return `<header class="dl-head">
    ${formula}
    <div class="dl-head-main">
      <h1 class="dl-title">${esc(m.title || "خطة درس")}</h1>
      ${m.subtitle ? `<h2 class="dl-subtitle">${esc(m.subtitle)}</h2>` : ""}
    </div>
    <div class="dl-head-side dl-art">${corner}</div>
  </header>` +
  (m.banner ? `<div class="dl-banner">${esc(m.banner)}</div>` : "");
}

/* --- meta row ---------------------------------------------------------------- */

function metaRow(info){
  if (!info || !info.length) return "";
  const cells = info.map((r, i) => {
    const p = tpal(r.color, i);
    return `<div class="dl-meta-cell" style="${vars(p)}">
      <span class="dl-meta-ic">${picOrNothing(r.icon)}</span>
      <span class="dl-meta-tx">
        <i class="dl-meta-lbl">${esc(r.label)}</i>
        <b class="dl-meta-val">${esc(r.value)}</b>
      </span>
    </div>`;
  }).join("");
  return `<section class="dl-meta">${cells}</section>`;
}

/* --- sidebar ----------------------------------------------------------------- */

function goalsCard(goals, i){
  if (!goals) return "";
  const cats = (goals.groups || []).map(g => `
    <div class="dl-goal-cat">
      <div class="dl-goal-title">${picOrNothing(g.icon, "dl-goal-ic")}<span>${esc(g.title)}</span></div>
      ${bullets(g.items)}
    </div>`).join("");
  return card(tpal(goals.color || "green", i), goals.icon || "target", goals.title || "الأهداف", cats);
}

function checkListCard(block, defIcon, defTitle, i, checks){
  if (!block) return "";
  const items = (block.items || []).map(t => `
    <li>${checks ? `<span class="dl-chk">✓</span>` : `<span class="dl-dot"></span>`}<span>${esc(t)}</span></li>`).join("");
  return card(tpal(block.color, i), block.icon || defIcon, block.title || defTitle,
    `<ul class="dl-ticks">${items}</ul>`);
}

function homeworkCard(hw, i){
  if (!hw) return "";
  const rows = (hw.items || []).map((r, k) => {
    const p = levelPal(r, k);
    return `<li class="dl-hw-item" style="${vars(p)}">
      <span class="dl-hw-face">${picOrNothing(r.icon || "user")}</span>
      <span class="dl-hw-tx">
        ${r.label ? `<b class="dl-hw-lbl">${esc(r.label)}</b>` : ""}
        <span>${esc(r.text)}</span>
      </span>
    </li>`;
  }).join("");
  return card(tpal(hw.color || "yellow", i), hw.icon || "notebook", hw.title || "الواجب المنزلي المتمايز",
    `<ul class="dl-hw">${rows}</ul>`);
}

/* --- groups ------------------------------------------------------------------ */

function groupsBlock(groups){
  if (!groups || !(groups.items || []).length) return "";
  const cols = groups.items.map((g, i) => {
    const p = levelPal(g, i);
    return `<article class="dl-grp" style="${vars(p)}">
      <header class="dl-grp-hd">
        <span class="dl-grp-ic">${picOrNothing(g.icon || "users")}</span>
        <span>${esc(g.name)}</span>
      </header>
      <div class="dl-grp-bd">${bullets(g.items)}</div>
    </article>`;
  }).join("");
  const arrows = repeat(groups.items.length, () => `<span class="dl-arr">↓</span>`);
  return `<div class="dl-groups">
    <div class="dl-sec-banner">${picOrNothing(groups.icon || "users", "dl-sec-ic")}<span>${esc(groups.title || "تقسيم المجموعات")}</span></div>
    <div class="dl-grp-grid" style="--n:${groups.items.length}">${cols}</div>
    <div class="dl-arrows" style="--n:${groups.items.length}" aria-hidden="true">${arrows}</div>
  </div>`;
}

/* --- intro ------------------------------------------------------------------- */

function introBlock(intro, i){
  if (!intro) return "";
  const body = `
    <div class="dl-intro-box">
      ${intro.art ? `<span class="dl-intro-art">${picOrNothing(intro.art)}</span>` : ""}
      <span>${esc(intro.text || "")}</span>
    </div>
    ${intro.equation ? `<div class="dl-intro-eq" dir="ltr">${esc(intro.equation)}</div>` : ""}`;
  return card(tpal(intro.color || "yellow", i), intro.icon || "star", intro.title || "تمهيد", body, "dl-intro");
}

/* --- activities + assessment (both are leveled column strips) ---------------- */

function exampleBox(ex){
  if (!ex) return "";
  return `<div class="dl-ex">
    ${ex.icon ? `<span class="dl-ex-ic">${picOrNothing(ex.icon)}</span>` : ""}
    ${ex.label ? `<span class="dl-ex-lbl">${esc(ex.label)}</span>` : ""}
    <b class="dl-ex-eq" dir="ltr">${esc(ex.text || "")}</b>
  </div>`;
}

function leveledStrip(block, defIcon, defTitle, cls, colHtml){
  if (!block || !(block.columns || []).length) return "";
  const cols = block.columns.map((c, i) => colHtml(c, levelPal(c, i))).join("");
  return `<section class="dl-strip ${cls}" style="${vars(tpal(block.color, 0))}">
    <header class="dl-strip-hd">${picOrNothing(block.icon || defIcon, "dl-sec-ic")}<span>${esc(block.title || defTitle)}</span></header>
    <div class="dl-strip-grid" style="--n:${block.columns.length}">${cols}</div>
  </section>`;
}

const activitiesBlock = act => leveledStrip(act, "puzzle", "الأنشطة التعليمية المتمايزة", "dl-acts",
  (c, p) => `<div class="dl-act-col" style="${vars(p)}">
      <div class="dl-col-title">${picOrNothing(c.titleIcon || "star", "dl-col-ic")}<span>${esc(c.title)}</span></div>
      ${bullets(c.items)}
      ${exampleBox(c.example)}
    </div>`);

const assessmentBlock = ass => leveledStrip(ass, "clipboard-check", "التقويم المتمايز", "dl-ass",
  (c, p) => `<div class="dl-ass-col" style="${vars(p)}">
      <div class="dl-ass-title">${picOrNothing(c.icon || "user", "dl-col-ic")}<span>${esc(c.title)}</span></div>
      ${c.text ? `<p class="dl-ass-desc">${esc(c.text)}</p>` : ""}
      ${c.example ? `<div class="dl-ass-ex">
          <span class="dl-ass-chk">✔</span>
          <span class="dl-ass-ex-tx">
            ${c.example.label ? `<i>${esc(c.example.label)}</i>` : ""}
            <b dir="ltr">${esc(c.example.text || "")}</b>
          </span>
        </div>` : ""}
    </div>`);

/* --- closing strip ----------------------------------------------------------- */

function closingBlock(cards){
  if (!cards || !cards.length) return "";
  const html = cards.map((c, i) => {
    const body = `
      ${c.deco ? `<div class="dl-close-deco">${picOrNothing(c.deco)}</div>` : ""}
      ${bullets(c.items)}
      ${c.note ? `<div class="dl-close-note">${esc(c.note)}</div>` : ""}`;
    return card(tpal(c.color, i), c.icon, c.title, body, "dl-close");
  }).join("");
  return `<section class="dl-closing" style="--n:${cards.length}">${html}</section>`;
}

/* --- template hooks ----------------------------------------------------------- */

export function render(data){
  const side = [
    goalsCard(data.goals, 0),
    checkListCard(data.strategies, "puzzle", "استراتيجيات التعليم المتمايز", 1, true),
    checkListCard(data.tools, "computer", "الوسائل التعليمية", 2, false),
    homeworkCard(data.homework, 3)
  ].join("");

  return masthead(data.meta) +
    metaRow(data.info) +
    `<div class="dl-outer">
      <aside class="dl-side">${side}</aside>
      <main class="dl-main">
        <div class="dl-top">
          ${groupsBlock(data.groups)}
          ${introBlock(data.intro, 4)}
        </div>
        ${activitiesBlock(data.activities)}
        ${assessmentBlock(data.assessment)}
      </main>
    </div>` +
    closingBlock(data.closing);
}

/** Presentation mode: every card / strip is one slide, titled by its header. */
export function slides(app){
  const els = [...app.querySelectorAll(".dl-side .dl-card, .dl-groups, .dl-intro, .dl-strip, .dl-closing .dl-card")];
  return els.map(el => {
    const h = el.querySelector(".dl-card-hd, .dl-sec-banner, .dl-strip-hd");
    return { el, title: h ? h.textContent.trim() : "" };
  });
}
