/* ============================================================================
   present.js — board / projector mode
   ----------------------------------------------------------------------------
   Turns the printed sheet into a real slide deck: a cover slide, then every
   section or card on its own, blown up to fill a classroom screen.

   The key idea: slides are NOT re-rendered. The live card element is MOVED
   into the stage and moved back on exit, so every listener and every answer
   the class has already typed survives the trip. Cards are enlarged with a
   CSS transform, which scales text as vectors — crisp on a projector.

   Controls: ← → Space PageUp/Down Home End · Esc exits · F fullscreen ·
   on-screen arrows, dots, click-to-advance, and touch swipe.
   ========================================================================== */
import { forTemplate, detect } from "./templates/index.js";
import { fireResize } from "./render.js";

const MAX_SCALE = 4.5;   // don't blow a tiny card up past legibility
const MIN_SCALE = 1;

let ui = null;           // the overlay, built once
let slides = [];         // [{ el, parent, next, w, h, title, cover }]
let index = 0;
let open = false;
let onKey = null, onFsChange = null;

/* ---------------------------------------------------------------- helpers -- */

/** Ask the template which elements are slides; fall back to a generic sweep. */
function collect(app, data){
  const tpl = forTemplate(detect(data || {}));
  if (typeof tpl.slides === "function"){
    const out = tpl.slides(app);
    if (out && out.length) return out;
  }
  const els = [...app.querySelectorAll(".grid > .card, .ic-card, .ac-card")];
  return els.map(el => ({ el, title: "" }));
}

function coverHtml(data){
  const m = (data && data.meta) || {};
  const title = m.lessonTitle || m.title || m.badge || "";
  const badge = m.lessonTitle ? (m.badge || "") : (m.pageTitle ? "" : "");
  const sub   = m.subtitle || "";

  // A couple of context lines, whichever the template happens to carry.
  const rows = []
    .concat((data && data.info && data.info.rows) || [])
    .concat((data && data.identity) || [])
    .slice(0, 3)
    .map(r => `<span><b>${r.label}:</b> ${r.value}</span>`)
    .join("");

  return `<div class="p-cover">
    ${badge ? `<div class="p-cover-badge">${badge}</div>` : ""}
    <h1 class="p-cover-title">${title}</h1>
    ${sub ? `<p class="p-cover-sub">${sub}</p>` : ""}
    ${rows ? `<div class="p-cover-rows">${rows}</div>` : ""}
    <div class="p-cover-hint">اضغط <kbd>←</kbd> أو المسافة للبدء</div>
  </div>`;
}

/* ------------------------------------------------------------------- chrome -- */

function build(){
  const el = document.createElement("div");
  el.className = "present";
  el.id = "present";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "وضع العرض");
  el.innerHTML = `
    <div class="p-progress"><i></i></div>
    <header class="p-bar">
      <span class="p-lesson"></span>
      <span class="p-spacer"></span>
      <span class="p-count"></span>
      <button class="p-btn" data-act="full" type="button" title="ملء الشاشة (F)">⛶</button>
      <button class="p-btn" data-act="exit" type="button" title="خروج (Esc)">✕</button>
    </header>

    <div class="p-stage"><div class="p-slot"></div></div>

    <footer class="p-nav">
      <!-- RTL: forward is leftward, so "prev" sits first (= rightmost).
           ▶/◀ are used instead of ‹/› because the angle quotes are
           bidi-mirrored and would end up pointing the wrong way. -->
      <button class="p-arrow" data-act="prev" type="button" aria-label="السابق">▶</button>
      <div class="p-dots"></div>
      <button class="p-arrow" data-act="next" type="button" aria-label="التالي">◀</button>
    </footer>
    <div class="p-label"></div>`;
  document.body.appendChild(el);

  el.addEventListener("click", e => {
    const act = e.target.closest("[data-act]");
    if (act){
      const a = act.dataset.act;
      if (a === "next") next();
      if (a === "prev") prev();
      if (a === "exit") close();
      if (a === "full") toggleFullscreen();
      return;
    }
    const dot = e.target.closest("[data-slide]");
    if (dot){ show(+dot.dataset.slide); return; }
    // Clicking empty stage advances; clicking the card itself must not, or the
    // teacher could not tick an answer on the board.
    if (e.target.classList.contains("p-stage")) next();
  });

  // touch swipe
  let x0 = null;
  const stage = el.querySelector(".p-stage");
  stage.addEventListener("touchstart", e => { x0 = e.changedTouches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) (dx > 0 ? prev : next)();   // RTL: swipe right = back
    x0 = null;
  }, { passive: true });

  return {
    root: el,
    slot:     el.querySelector(".p-slot"),
    stage,
    lesson:   el.querySelector(".p-lesson"),
    count:    el.querySelector(".p-count"),
    dots:     el.querySelector(".p-dots"),
    label:    el.querySelector(".p-label"),
    progress: el.querySelector(".p-progress i")
  };
}

/* -------------------------------------------------------------------- slides -- */

/** Put the currently staged element back exactly where it came from. */
function restoreCurrent(){
  const s = slides[index];
  if (!s || s.cover) { ui.slot.innerHTML = ""; return; }
  if (s.el.parentElement === ui.slot){
    s.parent.insertBefore(s.el, s.next);
  }
  ui.slot.innerHTML = "";
  s.el.style.removeProperty("width");
  s.el.style.removeProperty("height");
}

function fit(){
  const s = slides[index];
  if (!s) return;
  const availW = ui.stage.clientWidth  - 48;
  const availH = ui.stage.clientHeight - 48;
  if (s.cover){ ui.slot.style.transform = ""; return; }

  const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / s.w, availH / s.h)));
  ui.slot.style.width  = s.w + "px";
  ui.slot.style.height = s.h + "px";
  ui.slot.style.transform = `scale(${k})`;
}

function show(i){
  if (!open || !slides.length) return;
  const target = Math.max(0, Math.min(slides.length - 1, i));
  if (target !== index) restoreCurrent();
  index = target;
  const s = slides[index];

  if (s.cover){
    ui.slot.style.removeProperty("width");
    ui.slot.style.removeProperty("height");
    ui.slot.innerHTML = s.html;
  } else {
    // Pin the card to the size it had on the sheet so the scale is predictable.
    s.el.style.width  = s.w + "px";
    s.el.style.height = s.h + "px";
    ui.slot.appendChild(s.el);
  }

  fit();
  ui.count.textContent = `${index + 1} / ${slides.length}`;
  ui.label.textContent = s.title || "";
  ui.label.classList.toggle("is-empty", !s.title);
  ui.progress.style.width = `${((index + 1) / slides.length) * 100}%`;
  ui.dots.querySelectorAll("[data-slide]").forEach((d, n) =>
    d.classList.toggle("on", n === index));

  ui.root.classList.remove("p-anim");
  void ui.root.offsetWidth;          // restart the transition
  ui.root.classList.add("p-anim");

  // Matching lines and canvases measure themselves — let them re-measure.
  fireResize();
}

const next = () => show(index + 1);
const prev = () => show(index - 1);

/* --------------------------------------------------------------- fullscreen -- */

function toggleFullscreen(){
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

/* --------------------------------------------------------------- open/close -- */

export function isOpen(){ return open; }

export function present(app, data){
  if (open) return;
  const found = collect(app, data);
  if (!found.length) return;

  if (!ui) ui = build();

  // Measure every card BEFORE anything moves — afterwards the grid reflows.
  slides = [{ cover: true, html: coverHtml(data), title: "" }].concat(
    found.map(s => {
      const r = s.el.getBoundingClientRect();
      return {
        el: s.el,
        parent: s.el.parentElement,
        next: s.el.nextSibling,
        /* A template may ask for a different box than the element occupies on
           the sheet — learning-pattern presents one statement per slide, and a
           25px-tall grid row scaled up is a strip, not a slide. The override is
           what the stage pins the element to and what fit() scales; the CSS
           re-lays the element inside it. */
        w: Math.round(s.w || r.width),
        h: Math.round(s.h || r.height),
        title: s.title || ""
      };
    })
  );

  const meta = (data && data.meta) || {};
  ui.lesson.textContent = meta.lessonTitle || meta.title || meta.badge || "";
  ui.dots.innerHTML = slides.map((s, i) =>
    `<button class="p-dot" data-slide="${i}" type="button" aria-label="شريحة ${i + 1}"></button>`).join("");

  // Carry the sheet's theme + accent onto the overlay.
  ui.root.dataset.theme = app.dataset.theme || "playful";
  ui.root.dataset.template = app.dataset.template || "worksheet";
  ui.root.style.setProperty("--accent", getComputedStyle(app).getPropertyValue("--accent"));

  open = true;
  index = 0;
  document.body.classList.add("is-presenting");
  ui.root.hidden = false;
  show(0);
  ui.root.focus();

  onKey = e => {
    const k = e.key;
    if (k === "Escape"){ close(); return; }
    // RTL: the left arrow moves forward, the right arrow moves back.
    if (k === "ArrowLeft" || k === " " || k === "PageDown" || k === "Enter"){ e.preventDefault(); next(); }
    else if (k === "ArrowRight" || k === "PageUp" || k === "Backspace"){ e.preventDefault(); prev(); }
    else if (k === "Home"){ e.preventDefault(); show(0); }
    else if (k === "End"){ e.preventDefault(); show(slides.length - 1); }
    else if (k === "f" || k === "F"){ e.preventDefault(); toggleFullscreen(); }
  };
  // capture:false and on window so a focused contenteditable still gets its keys
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", fit);
  onFsChange = () => setTimeout(fit, 80);
  document.addEventListener("fullscreenchange", onFsChange);
}

export function close(){
  if (!open) return;
  restoreCurrent();
  open = false;
  ui.root.hidden = true;
  document.body.classList.remove("is-presenting");
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", fit);
  document.removeEventListener("fullscreenchange", onFsChange);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  slides = [];
  index = 0;
  fireResize();
}

export const toggle = (app, data) => (open ? close() : present(app, data));
export const goTo = show;
export { next, prev };
