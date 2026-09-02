/* ============================================================================
   template: golden-minutes — بطاقة الدقائق الذهبية للحصة
   ----------------------------------------------------------------------------
   A one-page teacher card for the "golden minutes" of a lesson:
   masthead (art · organization lines + title · logo/badge corner) ·
   ١ session-data grid · then ٢ first-five-minutes timeline beside
   ٣ a student-readiness checklist · ٤ last-five-minutes step strip ·
   bottom row ٥ after-lesson decision · ٦ quick note · ٧ teacher block ·
   and a visitor-note footer.

   Blocks color through tpal() — per-block "color" names in kid mode, the
   single accent in pro mode. Every empty "value" renders as a writable
   dotted line, so the card can be typed on screen or filled by hand after
   printing; the readiness/decision circles toggle on click. 🔄 clears both.
   ========================================================================== */
import { esc, pic, picOrNothing, repeat, wline, mixWhite } from "../util.js";
import { tpal } from "../theme.js";

export const template = "golden-minutes";

/** The masthead badge box IS the logo spot — no .site-logo overlay needed. */
export const ownsLogo = true;

/* --c2 is the light gradient end, precomputed because html2canvas (the
   save-as-image capture) cannot resolve color-mix() inside gradients. */
const vars = p => `--c:${p.main};--c2:${mixWhite(p.main, 0.72)};--tint:${p.tint}`;

/* --- small shared pieces ----------------------------------------------------- */

/** The numbered section bar: title on the right, white number circle on the left. */
function bar(title, num){
  return `<header class="gm-bar">
    <span class="gm-bar-tx">${esc(title)}</span>
    ${num != null && num !== "" ? `<span class="gm-bar-num">${esc(num)}</span>` : ""}
  </header>`;
}

/** A value if present, else a writable dotted line (cleared by 🔄 / reset). */
const fillOr = (v, cls) => (v != null && v !== "")
  ? `<b class="${cls || ""}">${esc(v)}</b>`
  : `<span class="wline gm-fill ${cls || ""}" contenteditable="true" spellcheck="false"></span>`;

/** An icon inside a soft tinted chip. */
const chip = (icon, cls) => `<span class="gm-icw ${cls || ""}">${picOrNothing(icon)}</span>`;

/** Writable dotted note lines, or the note text when one is given. */
const noteLines = (text, lines, def) => (text != null && text !== "")
  ? `<p class="gm-note-tx">${esc(text)}</p>`
  : repeat(lines != null ? lines : def, () => wline("gm-line"));

/* --- masthead ---------------------------------------------------------------- */

function masthead(m){
  // Optional organization lines above the title — a school, a district, an
  // authority, anything. Empty by default: the engine names nobody.
  const o = m.org || {};
  const mark = (o.title || o.subtitle)
    ? `<div class="gm-org">${o.title ? `<b>${esc(o.title)}</b>` : ""}${o.subtitle ? `<i>${esc(o.subtitle)}</i>` : ""}</div>`
    : "";

  const deco = m.titleDeco ? `<span class="gm-tdeco">${picOrNothing(m.titleDeco)}</span>` : "";

  // The corner box: the school logo when one is set (site-wide or meta.logo),
  // else the JSON badge (icon + text), else nothing.
  const b = m.badge;
  const badge = m.logo
    ? `<div class="gm-badge gm-badge-logo">${pic(m.logo, "gm-badge-pic")}</div>`
    : b
    ? `<div class="gm-badge">
         ${typeof b === "string" ? `<span>${esc(b)}</span>`
           : `${picOrNothing(b.icon, "gm-badge-ic")}<span>${esc(b.text || "")}</span>` +
             (b.deco ? `<i class="gm-badge-deco">${picOrNothing(b.deco)}</i>` : "")}
       </div>`
    : `<div class="gm-head-side"></div>`;

  return `<header class="gm-head">
    <div class="gm-head-side gm-art">${picOrNothing(m.art, "gm-art-pic", "gm-art-emoji")}</div>
    <div class="gm-head-main">
      ${mark}
      <h1 class="gm-title">${deco}<span>${esc(m.title || "بطاقة الدقائق الذهبية للحصة")}</span>${deco}</h1>
    </div>
    ${badge}
  </header>`;
}

/* --- ١ session data ----------------------------------------------------------- */

function sessionBlock(s){
  if (!s) return "";
  const p = tpal(s.color || "teal", 0);
  const rows = (s.rows || []).map(r => `
    <div class="gm-field ${r.wide ? "gm-wide" : ""}">
      <span class="gm-f-lab">${chip(r.icon, "gm-f-ic")}<span>${esc(r.label)}</span></span>
      <span class="gm-f-val">${fillOr(r.value)}</span>
    </div>`).join("");
  return `<section class="gm-card gm-sess" style="${vars(p)}">
    ${bar(s.title || "بيانات الحصة", s.number != null ? s.number : 1)}
    <div class="gm-sess-grid">${rows}</div>
  </section>`;
}

/* --- ٢ first five minutes (vertical timeline) --------------------------------- */

function firstFiveBlock(b){
  if (!b) return "";
  const p = tpal(b.color || "teal", 1);
  const rows = (b.items || []).map((it, i) => `
    <li class="gm-min">
      <span class="gm-min-lab">${chip(it.icon)}<span>${esc(it.label || "")}</span></span>
      <div class="gm-min-tx"><span>${esc(it.text || "")}</span>${it.sub ? `<i>${esc(it.sub)}</i>` : ""}</div>
      <span class="gm-min-num">${i + 1}</span>
    </li>`).join("");
  return `<section class="gm-card gm-first" style="${vars(p)}">
    ${bar(b.title || "أول خمس دقائق", b.number != null ? b.number : 2)}
    <ul class="gm-mins">${rows}</ul>
  </section>`;
}

/* --- ٣ readiness · ٥ decision (clickable-circle checklists) ------------------- */

/** tickFirst=true puts the circle on the right (decision), else on the left. */
function checklist(b, defTitle, defNum, defColor, i, cls, tickFirst){
  if (!b) return "";
  const p = tpal(b.color || defColor, i);
  const rows = (b.items || []).map(it => {
    const ic = chip(it.icon, "gm-ck-ic");
    const tx = `<span class="gm-ck-tx">${esc(it.text)}</span>`;
    const tick = `<button class="gm-tick" type="button" aria-label="تحديد"></button>`;
    return `<li class="gm-ck">${tickFirst ? tick + tx + ic : ic + tx + tick}</li>`;
  }).join("");
  return `<section class="gm-card ${cls}" style="${vars(p)}">
    ${bar(b.title || defTitle, b.number != null ? b.number : defNum)}
    <ul class="gm-ck-list">${rows}</ul>
    ${b.deco ? `<div class="gm-ck-deco">${picOrNothing(b.deco)}</div>` : ""}
  </section>`;
}

/* --- ٤ last five minutes (numbered step strip, 1 on the right) ---------------- */

function lastFiveBlock(b){
  if (!b) return "";
  const p = tpal(b.color || "green", 3);
  const cols = (b.items || []).map((it, i) => `
    <div class="gm-step">
      <span class="gm-step-num">${i + 1}</span>
      <div class="gm-step-box">
        <span class="gm-step-tx">${esc(it.text)}</span>
        ${chip(it.icon, "gm-step-ic")}
      </div>
    </div>`).join("");
  return `<section class="gm-card gm-last" style="${vars(p)}">
    ${bar(b.title || "آخر خمس دقائق", b.number != null ? b.number : 4)}
    <div class="gm-last-grid" style="--n:${(b.items || []).length}">${cols}</div>
  </section>`;
}

/* --- ٦ quick note · ٧ teacher · visitor footer -------------------------------- */

function noteBlock(b){
  if (!b) return "";
  const p = tpal(b.color || "teal", 5);
  return `<section class="gm-card gm-note" style="${vars(p)}">
    ${bar(b.title || "ملاحظة سريعة", b.number != null ? b.number : 6)}
    <div class="gm-note-bd">
      ${noteLines(b.text, b.lines, 3)}
      ${b.deco ? `<span class="gm-note-deco">${picOrNothing(b.deco)}</span>` : ""}
    </div>
  </section>`;
}

function teacherBlock(t){
  if (!t) return "";
  const p = tpal(t.color || "teal", 6);
  const fields = (t.fields || []).map(f => `
    <div class="gm-sig-row"><span class="gm-sig-lab">${esc(f.label)} :</span>${fillOr(f.value, "gm-sig-val")}</div>`).join("");
  return `<section class="gm-card gm-teacher" style="${vars(p)}">
    ${bar(t.title || "اسم المعلم", t.number != null ? t.number : 7)}
    <div class="gm-tch-bd">
      <div class="gm-tch-row">
        <span class="gm-tch-name">${fillOr(t.name)}</span>
        ${chip(t.icon || "user", "gm-tch-ic")}
      </div>
      ${fields ? `<div class="gm-sig">${fields}</div>` : ""}
    </div>
  </section>`;
}

function visitorBlock(v){
  if (!v) return "";
  const p = tpal(v.color || "teal", 7);
  return `<section class="gm-vis" style="${vars(p)}">
    <div class="gm-vis-bd">
      <div class="gm-vis-title">${esc(v.title || "ملاحظة الزائر (عند وجود زيارة)")}</div>
      ${noteLines(v.text, v.lines, 2)}
    </div>
    ${v.icon ? chip(v.icon, "gm-vis-ic") : ""}
  </section>`;
}

/* --- template hooks ----------------------------------------------------------- */

export function render(data){
  const m = data.meta || {};
  return masthead(m) +
    sessionBlock(data.session) +
    `<div class="gm-mid">
      ${firstFiveBlock(data.firstFive)}
      ${checklist(data.readiness, "مؤشر جاهزية الطلاب", 3, "green", 2, "gm-ready", false)}
    </div>` +
    lastFiveBlock(data.lastFive) +
    `<div class="gm-bottom">
      ${checklist(data.decision, "قرار المعلم بعد الحصة", 5, "green", 4, "gm-decide", true)}
      ${noteBlock(data.note)}
      ${teacherBlock(data.teacher)}
    </div>` +
    visitorBlock(data.visitor) +
    (m.footer ? `<div class="gm-foot">${picOrNothing(m.footer)}</div>` : "");
}

/** The readiness / decision circles toggle a ✓ on click. */
export function wire(app){
  app.querySelectorAll(".gm-tick").forEach(t =>
    t.addEventListener("click", () => t.classList.toggle("on")));
  return {};
}

/** 🔄: un-tick every circle (dotted lines are swept globally by render.js). */
export function reset(app){
  app.querySelectorAll(".gm-tick.on").forEach(t => t.classList.remove("on"));
}

/** Presentation mode: every block is one slide, titled by its bar. */
export function slides(app){
  const els = [...app.querySelectorAll(".gm-card, .gm-vis")];
  return els.map(el => {
    const h = el.querySelector(".gm-bar-tx, .gm-vis-title");
    return { el, title: h ? h.textContent.trim() : "" };
  });
}
