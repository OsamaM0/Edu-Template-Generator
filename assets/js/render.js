/* ============================================================================
   render.js — turn a lesson JSON object into the live page
   ----------------------------------------------------------------------------
   render(data, mount, opts) is the single entry point and is idempotent:
   calling it again (theme toggle, new lesson) fully replaces the previous
   render and tears down its listeners.

   It does three things and delegates the rest:
     1. pick the TEMPLATE      (worksheet | interactive-card | …-answers)
     2. resolve THEME + COLOR  (kid/pro, accent) before any markup is built
     3. hand the payload to that template, then wire it up
   ========================================================================== */
import { setTheme, getTheme, getAccent, themeFromMeta } from "./theme.js";
import { detect, forTemplate } from "./templates/index.js";
import { mixWhite } from "./util.js";
import { DEFAULT_LOGO, resolveLogo, logoOverlay } from "./logo.js";

/** Listeners from the previous render, torn down before the next one. */
let teardown = [];
let activeTemplate = "worksheet";
/** Re-measure hooks (matching lines, canvases) for the current render. */
let resizeHooks = [];

/** Force everything that measures itself to re-measure — used by present.js
    when a card is moved into the slide stage and scaled. */
export const fireResize = () => resizeHooks.forEach(fn => fn());

export function render(data, mount, opts = {}){
  const app  = mount || document.getElementById("app");
  const meta = data.meta || {};

  teardown.forEach(fn => fn());
  teardown = [];

  document.title = meta.pageTitle || meta.badge || meta.title || "ورقة عمل";

  // 1. template
  activeTemplate = detect(data);
  const tpl = forTemplate(activeTemplate);
  app.dataset.template = activeTemplate;

  // 2. theme + color, BEFORE markup: tpal() reads this state.
  const t = themeFromMeta(meta, opts.forcedTheme);
  setTheme(t.theme, t.accent);
  app.dataset.theme = getTheme();
  app.style.setProperty("--accent", getAccent().main);
  app.style.setProperty("--accent-tint", getAccent().tint);
  // Light gradient end — precomputed so html2canvas captures never meet color-mix().
  app.style.setProperty("--accent2", mixWhite(getAccent().main, 0.72));

  // 3. body — with the site-wide logo resolved into meta.logo first, so every
  //    template's fixed logo spot fills from the one configured place.
  const logoCfg = Object.assign({}, DEFAULT_LOGO, (window.EDU_CONFIG || {}).logo);
  const logo = resolveLogo(meta, logoCfg);
  const payload = { ...data, meta: { ...meta, logo } };

  app.innerHTML = tpl.render(payload, { footerDecor: opts.footerDecor }) +
    (tpl.ownsLogo ? "" : logoOverlay(logo, logoCfg.width));

  swapBrokenImages(app);

  const out = tpl.wire ? tpl.wire(app, data) : null;
  attachResize(app, (out && out.onResize) || []);

  return app;
}

export const currentTemplate = () => activeTemplate;

/** An image URL that fails to load becomes the dashed placeholder box. */
function swapBrokenImages(app){
  app.querySelectorAll("img.dyn").forEach(im => {
    im.addEventListener("error", () => {
      const ph = document.createElement("span");
      ph.className = "ph";
      ph.style.cssText = "width:32px;height:28px;font-size:14px;";
      ph.textContent = "🖼️";
      im.replaceWith(ph);
    }, { once: true });
  });
}

/** One resize listener per render, feeding every hook the template asked for. */
function attachResize(app, hooks){
  resizeHooks = hooks;
  if (!hooks.length) return;
  const fire = () => hooks.forEach(fn => fn());
  const ro = new ResizeObserver(fire);
  ro.observe(app);
  window.addEventListener("resize", fire);
  window.addEventListener("beforeprint", fire);
  teardown.push(() => {
    ro.disconnect();
    window.removeEventListener("resize", fire);
    window.removeEventListener("beforeprint", fire);
  });
  requestAnimationFrame(fire);   // fonts/images can shift positions on first paint
}

/** Toolbar reset: clear every student answer without reloading the page.
    In presentation mode one card is temporarily staged OUTSIDE #app, so the
    slide stage is swept too — otherwise the card on the board keeps its
    answers while the rest of the sheet is cleared. */
export function resetAnswers(app){
  const tpl = forTemplate(activeTemplate);
  const stage = document.querySelector(".p-slot");
  const roots = stage && stage.firstElementChild ? [app, stage] : [app];

  roots.forEach(root => {
    if (tpl.reset) tpl.reset(root);
    root.querySelectorAll(".wline, .blank").forEach(l => { l.textContent = ""; });
    root.querySelectorAll("input[type=text]").forEach(i => { i.value = ""; });
  });
}
