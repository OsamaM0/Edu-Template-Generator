/* ============================================================================
   template: learning-pattern — استبيان تحديد أنماط التعلم
   ----------------------------------------------------------------------------
   A one-page learning-styles questionnaire. It is a QUESTION sheet, exactly
   like every other answerable template here:

     masthead (art · organization lines + title · logo corner) ·
     student row · ١ aim + the point scale · ٢ the statements grid — one row
     per statement, one tickable cell per scale point.

   What makes it unusual is only the SHAPE of an answer. A statement has no
   right answer; it has a POINT on a scale, and that point feeds the learning
   style the statement belongs to. So the sheet collects, it does not mark:

     · every statement row carries data-qid, like every other question here
     · every tick cell carries data-value (the scale label the student chose)
       and data-points (what that label is worth)
     · ticking one dispatches edu:answer, so the submit bar's progress follows

   Scoring — the sum per style, the dominant style, the advice — happens on the
   server when the sheet is submitted, against a key stored beside the
   assignment. That is the rule every other template obeys: the page never
   carries its own marking. See server/pipeline/answers/profile.mjs.

   The chrome colors through tpal() as usual: named colors in kid mode, the
   single accent in pro.
   ========================================================================== */
import { esc, pic, picOrNothing, mixWhite } from "../util.js";
import { tpal } from "../theme.js";

export const template = "learning-pattern";

/** The masthead badge box IS the logo spot — no .site-logo overlay needed. */
export const ownsLogo = true;

/* --- the styles ---------------------------------------------------------------
   A statement declares which style it feeds. Nothing on the page reads it — the
   server does the arithmetic — but it travels in the markup so a submitted
   sheet can be re-scored from what was actually printed. */

/** Spelling variants an endpoint may send for the same style. */
const STYLE_ALIASES = {
  "visual": "visual", "v": "visual", "see": "visual", "seeing": "visual", "بصري": "visual",

  "auditory": "auditory", "audio": "auditory", "a": "auditory",
  "aural": "auditory", "hearing": "auditory", "listening": "auditory", "سماعي": "auditory",

  "kinesthetic": "kinesthetic", "kinaesthetic": "kinesthetic", "kinetic": "kinesthetic",
  "k": "kinesthetic", "motor": "kinesthetic", "doing": "kinesthetic",
  "tactile": "kinesthetic", "حركي": "kinesthetic",

  "reading": "reading", "read": "reading", "write": "reading", "writing": "reading",
  "read-write": "reading", "reading-writing": "reading", "readwrite": "reading",
  "r": "reading", "قراءة": "reading", "قراءة/كتابة": "reading", "كتابة": "reading"
};

/** A style key, canonicalized. An unknown key is kept as-is, so a sheet may
    declare styles of its own as long as `styles[]` lists them. */
export const normStyle = s => {
  const v = String(s == null ? "" : s).toLowerCase().trim().replace(/_/g, "-");
  return STYLE_ALIASES[v] || v;
};

/* --c2 is the light gradient end, precomputed because html2canvas (the
   save-as-image capture) cannot resolve color-mix() inside gradients. */
const vars = p => `--c:${p.main};--c2:${mixWhite(p.main, 0.72)};--tint:${p.tint}`;

/* --- the model ---------------------------------------------------------------
   Parsed once per render and kept, so wire() and reset() act on exactly the
   statements and scale that were drawn on the sheet. Only one sheet is ever
   rendered at a time, which is what makes a module-level model safe. */

let MODEL = null;

const DEFAULT_SCALE = [
  { label: "تمامًا",     value: 4 },
  { label: "أحيانًا",    value: 3 },
  { label: "قليلًا",     value: 2 },
  { label: "لا يمثلني", value: 1 }
];

/** The point scale: `[{label, value}]`, highest first, as the sheet reads it. */
function readScale(data){
  const raw = (data.intro && data.intro.scale) || data.scale;
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_SCALE;
  return raw.map((o, i) => (o && typeof o === "object")
    ? { label: String(o.label == null ? "" : o.label), value: Number(o.value != null ? o.value : raw.length - i) }
    : { label: String(o), value: raw.length - i });
}

/**
 * The statements, each with the style it feeds and the id it is submitted
 * under. An instrument that ships without ids gets positional ones, which is
 * enough for a printed classroom copy — a sheet that is going to be SUBMITTED
 * is built by the server, and the server writes real ids
 * (server/pipeline/build/learning-pattern.mjs).
 */
function readQuestions(data){
  const raw = Array.isArray(data.questions) ? data.questions
            : Array.isArray(data.statements) ? data.statements : [];
  return raw.map((q, i) => (q && typeof q === "object")
    ? {
        id: String(q.id != null && q.id !== "" ? q.id : `lp-${i + 1}`),
        text: String(q.text != null ? q.text : q.statement || ""),
        style: normStyle(q.style || q.pattern || q.type)
      }
    : { id: `lp-${i + 1}`, text: String(q), style: "" });
}

/** Parse the payload once. Everything downstream reads this. */
function readModel(data){
  return { scale: readScale(data), questions: readQuestions(data) };
}

/* --- small shared pieces ----------------------------------------------------- */

/** The numbered section bar: title on the right, white number circle on the left. */
function bar(title, num){
  return `<header class="lp-bar">
    <span class="lp-bar-tx">${esc(title)}</span>
    ${num != null && num !== "" ? `<span class="lp-bar-num">${esc(num)}</span>` : ""}
  </header>`;
}

/** A value if present, else a writable dotted line (cleared by 🔄 / reset). */
const fillOr = (v, cls) => (v != null && v !== "")
  ? `<b class="${cls || ""}">${esc(v)}</b>`
  : `<span class="wline lp-fill ${cls || ""}" contenteditable="true" spellcheck="false"></span>`;

/* --- masthead ---------------------------------------------------------------- */

function masthead(m){
  // Optional organization lines above the title — a school, a district, an
  // authority, anything. Empty by default: the engine names nobody.
  const o = m.org || {};
  const mark = (o.title || o.subtitle)
    ? `<div class="lp-org">${o.title ? `<b>${esc(o.title)}</b>` : ""}${o.subtitle ? `<i>${esc(o.subtitle)}</i>` : ""}</div>`
    : "";

  const deco = m.titleDeco ? `<span class="lp-tdeco">${picOrNothing(m.titleDeco)}</span>` : "";

  // The corner box: the school logo when one is set (site-wide or meta.logo),
  // else the JSON badge (icon + text), else nothing.
  const b = m.badge;
  const badge = m.logo
    ? `<div class="lp-badge lp-badge-logo">${pic(m.logo, "lp-badge-pic")}</div>`
    : b
    ? `<div class="lp-badge">
         ${typeof b === "string" ? `<span>${esc(b)}</span>`
           : `${picOrNothing(b.icon, "lp-badge-ic")}<span>${esc(b.text || "")}</span>`}
       </div>`
    : `<div class="lp-head-side"></div>`;

  return `<header class="lp-head">
    <div class="lp-head-side lp-art">${picOrNothing(m.art, "lp-art-pic", "lp-art-emoji")}</div>
    <div class="lp-head-main">
      ${mark}
      <h1 class="lp-title">${deco}<span>${esc(m.title || "استبيان تحديد أنماط التعلم للطلاب")}</span>${deco}</h1>
      ${m.subtitle ? `<h2 class="lp-subtitle">${esc(m.subtitle)}</h2>` : ""}
    </div>
    ${badge}
  </header>`;
}

/* --- the student row ---------------------------------------------------------- */

function metaBlock(b){
  if (!b || !Array.isArray(b.fields) || !b.fields.length) return "";
  const p = tpal(b.color || "teal", 0);
  const fields = b.fields.map(f => `
    <div class="lp-mf">
      <span class="lp-mf-lab">${picOrNothing(f.icon, "lp-mf-ic")}<span>${esc(f.label)}</span></span>
      <span class="lp-mf-val">${fillOr(f.value)}</span>
    </div>`).join("");
  return `<section class="lp-meta" style="${vars(p)}">${fields}</section>`;
}

/* --- ١ the aim + the point scale ---------------------------------------------- */

function introBlock(b, scale){
  if (!b) return "";
  const p = tpal(b.color || "teal", 1);
  const chips = scale.map(s => `<span class="lp-chip"><b>${esc(s.label)}</b><i>${esc(s.value)}</i></span>`).join("");
  return `<section class="lp-card lp-intro" style="${vars(p)}">
    ${bar(b.title || "الهدف من الاستبيان", b.number != null ? b.number : 1)}
    <div class="lp-intro-bd">
      ${b.text ? `<p class="lp-intro-tx">${esc(b.text)}</p>` : ""}
      <div class="lp-scale">
        ${b.scaleLabel ? `<span class="lp-scale-lab">${esc(b.scaleLabel)}</span>` : ""}
        <div class="lp-chips">${chips}</div>
      </div>
    </div>
  </section>`;
}

/* --- ٢ the statements grid ----------------------------------------------------
   Every row repeats --n and the block colors in its own style attribute. On the
   sheet that is redundant (the card already sets them); in presentation mode it
   is what keeps a row correct after it has been MOVED out of the card and onto
   the slide stage on its own. */

function quizBlock(b, model, p){
  const q = b || {};
  const { scale, questions } = model;
  const rowVars = `${vars(p)};--n:${scale.length}`;

  const head = `<div class="lp-row lp-head-row" style="${rowVars}">
    <span class="lp-q">${esc(q.statementLabel || "العبارة")}</span>
    ${scale.map(s => `<span class="lp-opt-h">${esc(s.label)}</span>`).join("")}
  </div>`;

  const rows = questions.map((it, i) => `
    <div class="lp-row" style="${rowVars}" data-qid="${esc(it.id)}" data-kind="scale"
         data-style="${esc(it.style)}" role="radiogroup" aria-label="${esc(it.text)}">
      <span class="lp-q"><i class="lp-q-num">${i + 1}</i><span class="lp-q-tx">${esc(it.text)}</span></span>
      ${scale.map(s => `<button class="lp-opt" type="button" role="radio" aria-checked="false"
          data-value="${esc(s.label)}" data-points="${esc(s.value)}"
          aria-label="${esc(s.label)}" title="${esc(s.label)}"><span class="lp-opt-lab">${esc(s.label)}</span></button>`).join("")}
    </div>`).join("");

  return `<section class="lp-card lp-quiz" style="${rowVars}">
    ${bar(q.title || "العبارات", q.number != null ? q.number : 2)}
    <div class="lp-grid">${head}${rows}</div>
  </section>`;
}

/* --- template hooks ----------------------------------------------------------- */

export function render(data){
  const m = data.meta || {};
  MODEL = readModel(data);

  return masthead(m) +
    metaBlock(data.student) +
    introBlock(data.intro, MODEL.scale) +
    quizBlock(data.quiz, MODEL, tpal((data.quiz && data.quiz.color) || "teal", 2)) +
    (m.footer ? `<div class="lp-foot">${picOrNothing(m.footer)}</div>` : "");
}

/**
 * One tick per statement.
 *
 * The row elements are captured once and kept rather than re-queried:
 * presentation mode MOVES a live row out of #app and onto the slide stage, and
 * a moved element is still the same element — a fresh querySelectorAll rooted
 * at #app would stop finding it half-way through a presentation.
 */
export function wire(app){
  const rows = [...app.querySelectorAll(".lp-row:not(.lp-head-row)")];

  rows.forEach(row => {
    const opts = [...row.querySelectorAll(".lp-opt")];
    const pick = o => {
      // A second click on the same cell clears it — a mis-tick must be undoable
      // without resetting the whole sheet.
      const was = o.classList.contains("on");
      opts.forEach(x => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
      if (!was){ o.classList.add("on"); o.setAttribute("aria-checked", "true"); }
      // The submit bar counts answered questions off this event.
      row.dispatchEvent(new CustomEvent("edu:answer", { bubbles: true }));
    };
    opts.forEach(o => {
      o.addEventListener("click", () => pick(o));
      o.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); pick(o); }
      });
    });
  });

  return {};
}

/** 🔄: un-tick every statement. */
export function reset(app){
  app.querySelectorAll(".lp-opt.on").forEach(o => {
    o.classList.remove("on");
    o.setAttribute("aria-checked", "false");
  });
  app.dispatchEvent(new CustomEvent("edu:answer", { bubbles: true }));
}

/**
 * Presentation mode: the aim card, then ONE STATEMENT PER SLIDE.
 *
 * A whole 16-row grid blown up on a classroom screen is unreadable and
 * unanswerable — nobody can see which row is being asked about. So each row is
 * its own slide, and `w`/`h` ask the stage for a slide-shaped box instead of
 * the 25px strip the row occupies on the A4 sheet. present.css re-lays the row
 * inside it: the statement on top, the scale as full-width buttons underneath.
 */
export function slides(app){
  const out = [];

  const intro = app.querySelector(".lp-intro");
  if (intro){
    const h = intro.querySelector(".lp-bar-tx");
    out.push({ el: intro, title: h ? h.textContent.trim() : "" });
  }

  const rows = [...app.querySelectorAll(".lp-row:not(.lp-head-row)")];
  rows.forEach((el, i) => out.push({
    el,
    title: `العبارة ${i + 1} من ${rows.length}`,
    w: 760,
    h: 380
  }));

  return out;
}
