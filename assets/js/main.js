/* ============================================================================
   main.js — application entry point
   Boot, loading/error states, toolbar, public JS API.
   ========================================================================== */
import { config, readParams, loadWorksheet, LoadError, staticUrlFor } from "./loader.js";
import { render, resetAnswers } from "./render.js";
import { getTheme } from "./theme.js";
import { startHeightReporting, postReady, postError, isFramed } from "./embed.js";
import { installDeterrents } from "./protect.js";
import { toImage } from "./to-image.js";
import * as present from "./present.js";

const app     = document.getElementById("app");
const stateEl = document.getElementById("state");
const toolbar = document.getElementById("toolbar");

let params  = readParams();
let current = null;                     // last rendered worksheet JSON
let forcedTheme = params.theme;         // ?theme= or the toolbar toggle

/* ---------------------------------------------------------------- states -- */

const ui = {
  spinner: document.getElementById("state-spinner"),
  icon:    document.getElementById("state-icon"),
  title:   document.getElementById("state-title"),
  text:    document.getElementById("state-text"),
  code:    document.getElementById("state-code"),
  btn:     document.getElementById("state-btn")
};

function showLoading(){
  stateEl.hidden = false;
  stateEl.classList.remove("is-error");
  app.hidden = true;
  ui.spinner.hidden = false;
  ui.icon.hidden = true;
  ui.code.hidden = true;
  ui.btn.hidden  = true;
  ui.title.textContent = "جارٍ تحميل ورقة العمل…";
  ui.text.textContent  = "";
}

function showWorksheet(){
  stateEl.hidden = true;
  app.hidden = false;
}

/** Arabic copy per LoadError code. `ctx` carries the lesson id / url. */
function messageFor(err, ctx){
  const id = ctx.lessonId ? `«${ctx.lessonId}»` : "";
  switch (err.code){
    case "no-lesson":
      return {
        icon: "🔗",
        title: "لم يُحدَّد رقم الدرس",
        text: "أضف رقم الدرس إلى الرابط ليتم تحميل ورقة العمل الخاصة به.",
        code: `${location.pathname}?lesson=<رقم الدرس>`
      };
    case "invalid-id":
      return {
        icon: "⚠️",
        title: "رقم الدرس غير صالح",
        text: "يُسمح بالحروف الإنجليزية والأرقام والشرطات فقط في رقم الدرس.",
        code: String(err.detail || "")
      };
    case "not-found":
      return {
        icon: "🔍",
        title: `لم يتم العثور على الدرس ${id}`,
        text: "تأكد من رقم الدرس في الرابط، أو من أن ملف الدرس منشور على الخادم.",
        code: ctx.url || staticUrlFor(ctx.lessonId || "")
      };
    case "parse":
      return {
        icon: "🧩",
        title: "بيانات الدرس غير صالحة",
        text: "تم العثور على الملف لكن محتواه ليس JSON صحيحاً.",
        code: `${ctx.url || ""}\n${err.detail || ""}`.trim()
      };
    case "offline":
      return {
        icon: "🖥️",
        title: "شغّل الموقع عبر خادم ويب",
        text: "المتصفح يمنع قراءة ملفات JSON عند فتح الصفحة مباشرة من القرص (file://). شغّل خادماً محلياً ثم افتح العنوان التالي:",
        code: `python -m http.server 8138\nhttp://localhost:8138/index.html?lesson=${ctx.lessonId || config.defaultLesson}`
      };
    default:
      return {
        icon: "📡",
        title: "تعذّر تحميل بيانات الدرس",
        text: "تحقق من الاتصال بالشبكة أو من إعدادات الخادم، ثم أعد المحاولة.",
        code: `${ctx.url || ""}\n${err.message || ""}`.trim()
      };
  }
}

function showError(err, ctx){
  const m = messageFor(err, ctx || {});
  stateEl.hidden = false;
  stateEl.classList.add("is-error");
  app.hidden = true;
  ui.spinner.hidden = true;
  ui.icon.hidden = false;
  ui.icon.textContent = m.icon;
  ui.title.textContent = m.title;
  ui.text.textContent  = m.text;
  ui.code.hidden = !m.code;
  ui.code.textContent = m.code || "";
  // Offer the default lesson as an escape hatch, unless that is what just failed.
  ui.btn.hidden = !config.defaultLesson || (ctx && ctx.lessonId === config.defaultLesson);
  ui.btn.href = `?lesson=${encodeURIComponent(config.defaultLesson)}`;
  toolbar.hidden = true;   // nothing to print, theme or reset

  console.error("[edu] load failed:", err.code, err.message, err.detail || "");
  postError(err.code, err.message);
}

/* --------------------------------------------------------------- toolbar -- */

function toolbarVisible(){
  if (params.toolbar != null) return params.toolbar;          // ?toolbar=0|1 wins
  if (config.showToolbar === true)  return true;
  if (config.showToolbar === false) return false;
  return !isFramed();                                          // "auto"
}

/** Capture the sheet as an A4 JPG, with progress feedback on the button. */
async function saveAsImage(){
  if (!current) return;
  present.close();                        // a staged slide would leave a hole in the sheet
  const btn = document.getElementById("btn-image");
  const idle = btn ? btn.textContent : "";
  if (btn){ btn.disabled = true; btn.textContent = "⏳ جارٍ الحفظ…"; }
  try {
    await toImage(app, current);
    if (btn) btn.textContent = "✅ تم الحفظ";
  } catch (err){
    console.error("[edu] to-image failed:", err);
    if (btn) btn.textContent = "⚠️ تعذر الحفظ";
  }
  if (btn) setTimeout(() => { btn.textContent = idle; btn.disabled = false; }, 2200);
}

function wireToolbar(){
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  const btnImage = document.getElementById("btn-image");
  if (btnImage) btnImage.addEventListener("click", saveAsImage);

  document.getElementById("btn-reset").addEventListener("click", () => {
    if (current) resetAnswers(app);
  });

  document.getElementById("btn-theme").addEventListener("click", () => {
    forcedTheme = getTheme() === "pro" ? "playful" : "pro";
    if (current) paint(current);
  });

  const btnPresent = document.getElementById("btn-present");
  if (btnPresent){
    btnPresent.addEventListener("click", () => {
      if (current) present.toggle(app, current);
    });
  }

  // F5 starts the show, the way every other presentation tool does.
  window.addEventListener("keydown", e => {
    if (e.key === "F5" && !e.ctrlKey && !e.shiftKey && current && !present.isOpen()){
      e.preventDefault();
      present.present(app, current);
    }
  });
}

/* ------------------------------------------------------------------ boot -- */

function paint(data){
  // A re-render replaces app.innerHTML; any card currently staged in the deck
  // would be orphaned, so put it back first.
  present.close();
  current = data;
  render(data, app, { forcedTheme, footerDecor: config.footerDecor });
  showWorksheet();

  /* Anything layered on top of the sheet — the answer bar on an issued sheet,
     a host app's own additions — has just had its markup replaced underneath
     it. This is the one announcement that the DOM is new. */
  document.dispatchEvent(new CustomEvent("edu:rendered", { detail: { data } }));
}

async function boot(){
  if (window.__EDU_BLOCKED) return;   // guard.js already replaced the page
  if (params.embed) document.body.dataset.embed = "1";
  installDeterrents(config);
  wireToolbar();
  toolbar.hidden = !toolbarVisible();
  showLoading();

  let ctx = { lessonId: params.lessonId || config.defaultLesson, url: null };

  try {
    const result = await loadWorksheet(params);
    ctx = { lessonId: result.lessonId, url: result.url };

    if (!result.data || typeof result.data !== "object"){
      throw new LoadError("parse", "Worksheet payload is not an object", result.url);
    }

    paint(result.data);

    if (result.lessonId) document.documentElement.dataset.lesson = result.lessonId;
    postReady({ lessonId: result.lessonId, from: result.source });   // api | static | packed | src | inline | inline-global
    startHeightReporting(result.lessonId);
    runAutoActions();

  } catch (err){
    showError(err instanceof LoadError ? err : new LoadError("network", String(err && err.message || err)), ctx);
    startHeightReporting(ctx.lessonId);
  }
}

/** ?image=1 / ?print=1 (or the same flags from the render API) fire once the
    sheet is on screen — the hook headless pipelines drive the page with. */
async function runAutoActions(){
  if (params.autoImage){
    await new Promise(r => setTimeout(r, 250));    // let fonts and art settle
    await saveAsImage();
    document.documentElement.dataset.eduImage = "done";
  }
  if (params.autoPrint) setTimeout(() => window.print(), 300);
}

/* ------------------------------------------------------------ public API -- */
/* For host apps and AI generators that produce worksheet JSON directly. */
window.EduWorksheet = {
  /** Render any worksheet object immediately. */
  render(data, opts){
    if (opts && opts.theme) forcedTheme = opts.theme;
    paint(data);
    startHeightReporting(null);
    return app;
  },
  /** Load a lesson by id without a page reload. */
  async load(lessonId){
    showLoading();
    params = { ...params, lessonId: String(lessonId), data: null, src: null };
    try {
      const r = await loadWorksheet(params);
      paint(r.data);
      startHeightReporting(r.lessonId);
      return r.data;
    } catch (err){
      showError(err, { lessonId: String(lessonId), url: null });
      throw err;
    }
  },
  /** The worksheet JSON currently on screen. */
  get data(){ return current; },
  get theme(){ return getTheme(); },
  setTheme(t){ forcedTheme = t; if (current) paint(current); },
  reset(){ if (current) resetAnswers(app); },
  print(){ window.print(); },
  toImage(){ return saveAsImage(); },

  /* --- presentation / board mode --- */
  present(){ if (current) present.present(app, current); },
  exitPresent(){ present.close(); },
  togglePresent(){ if (current) present.toggle(app, current); },
  nextSlide(){ present.next(); },
  prevSlide(){ present.prev(); },
  goToSlide(i){ present.goTo(i); },
  get presenting(){ return present.isOpen(); },

  config
};

// Back-compat with the single-file prototype.
window.renderWorksheet = data => window.EduWorksheet.render(data);

boot();
