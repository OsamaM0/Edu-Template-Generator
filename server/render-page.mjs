/* ============================================================================
   render-page.mjs — turn worksheet JSON into a complete HTML page, in Node
   ----------------------------------------------------------------------------
   The template modules under assets/js/templates/ are pure string builders
   (data in → markup out, no DOM), so the SAME code that runs in the browser
   renders the sheet here. The page therefore arrives fully painted: correct
   even with JavaScript disabled, and identical to what the site shows.

   Two knobs decide what the page carries:
     standalone   true  → every stylesheet inlined; the file survives on its own
                  false → <link> tags pointing back at this server   (default)
     interactive  true  → the app boots and wires drawing / matching / inputs,
                          the toolbar works, answers can be typed     (default)
                  false → static markup only, no script at all
   ========================================================================== */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setTheme, getAccent, getTheme, themeFromMeta } from "../assets/js/theme.js";
import { detect, forTemplate, knownTemplates } from "../assets/js/templates/index.js";
import { normStyle } from "../assets/js/templates/learning-pattern.js";
import { mixWhite, esc } from "../assets/js/util.js";
import { DEFAULT_LOGO, resolveLogo, logoOverlay } from "../assets/js/logo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Screen stylesheets, in the order index.html links them. */
const CSS = [
  "assets/css/base.css",
  "assets/css/layout.css",
  "assets/css/sections.css",
  "assets/css/template-cards.css",
  "assets/css/template-diff-lesson.css",
  "assets/css/template-golden-minutes.css",
  "assets/css/template-learning-pattern.css",
  "assets/css/theme-pro.css",
  "assets/css/present.css"
];
const PRINT_CSS = "assets/css/print.css";

const FONTS = "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400;500;600;700;800&family=Cairo:wght@500;600;700;800&display=swap";

/** Files are read once and kept — the sheet is what changes, not the CSS. */
const fileCache = new Map();
async function readAsset(rel){
  if (!fileCache.has(rel)) fileCache.set(rel, await readFile(path.join(ROOT, rel), "utf8"));
  return fileCache.get(rel);
}
export const clearAssetCache = () => fileCache.clear();

/** JSON safe to sit inside a <script> block. */
const jsonForScript = v => JSON.stringify(v)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/* --------------------------------------------------------------- the sheet -- */

/**
 * Render just the sheet: the markup that goes inside <div class="page" id="app">.
 * Mirrors assets/js/render.js — same template pick, same theme resolution.
 */
export function renderSheet(data, opts = {}){
  const meta = data.meta || {};

  const template = detect(data);
  const tpl = forTemplate(template);

  const t = themeFromMeta(meta, opts.theme);
  setTheme(t.theme, t.accent);
  const theme  = getTheme();
  const accent = getAccent();

  // Site-wide logo, same contract as the browser (opts.logo mirrors config.js).
  const logoCfg = Object.assign({}, DEFAULT_LOGO, opts.logo);
  const logo = resolveLogo(meta, logoCfg);
  const payload = { ...data, meta: { ...meta, logo } };

  const body = tpl.render(payload, { footerDecor: opts.footerDecor }) +
    (tpl.ownsLogo ? "" : logoOverlay(logo, logoCfg.width));

  return {
    template,
    theme,
    accent,
    title: meta.pageTitle || meta.badge || meta.title || "ورقة عمل",
    body,
    style: `--accent:${accent.main};--accent-tint:${accent.tint};--accent2:${mixWhite(accent.main, 0.72)}`
  };
}

/* ---------------------------------------------------------------- the page -- */

/**
 * @param {object} data  worksheet / cards / lesson-plan JSON
 * @param {object} opts
 *   theme        "pro" | "kid" | …            force a look (JSON decides if absent)
 *   standalone   boolean                      inline the CSS (default false)
 *   interactive  boolean                      ship the app JS (default true)
 *   toolbar      boolean                      show the floating toolbar (default true)
 *   embed        boolean                      drop the outer page chrome
 *   autoImage    boolean                      download the A4 JPG once painted
 *   autoPrint    boolean                      open the print dialog once painted
 *   title        string                       override <title>
 *   baseUrl      string                       absolute prefix for asset links
 *   footerDecor  string[]                     playful-theme footer strip
 *   logo         {src,width}                  site-wide logo (mirrors config.js)
 *   answer       {assignmentId,token,submitUrl,questions,student,reportUrl}
 *                                             ship the answer layer (see below)
 * @returns {Promise<{html:string, template:string, theme:string, title:string}>}
 */
export async function renderPage(data, opts = {}){
  const standalone  = !!opts.standalone;
  const interactive = opts.interactive !== false;
  const toolbar     = opts.toolbar !== false;
  const embed       = !!opts.embed;
  const base        = String(opts.baseUrl || "").replace(/\/+$/, "");
  const url         = rel => `${base}/${rel}`;

  /* A rendered page can be served from anywhere — /s/<id>, /api/render, or a
     downloaded file — so a relative asset path would resolve against the wrong
     directory. Stylesheets already go through url(); the logo needs the same
     treatment, whether it comes from config.js or from the sheet's meta.logo.
     Emoji and built-in icon names are left alone: they are not paths. */
  const isRelAsset = v => typeof v === "string" && v !== "" &&
    !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(v) &&
    (v.includes("/") || /\.(?:svg|png|jpe?g|webp|gif|ico)$/i.test(v));
  const assetUrl = v => (base && isRelAsset(v)) ? url(v) : v;

  const logo = Object.assign({}, DEFAULT_LOGO, opts.logo);
  logo.src = assetUrl(logo.src);

  if (data && data.meta && isRelAsset(data.meta.logo)){
    data = { ...data, meta: { ...data.meta, logo: assetUrl(data.meta.logo) } };
  }

  const sheet = renderSheet(data, Object.assign({}, opts, { logo }));
  const title = opts.title || sheet.title;

  let head;
  if (standalone){
    // Everything inlined — the file keeps its looks with no server behind it.
    const sheets = await Promise.all(CSS.map(readAsset));
    const print  = await readAsset(PRINT_CSS);
    const ico    = await readAsset("assets/img/favicon.svg");
    head = `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(ico, "utf8").toString("base64")}">
<style>\n${sheets.join("\n")}\n</style>\n<style media="print">\n${print}\n</style>`;
  } else {
    head = `<link rel="icon" href="${url("assets/img/favicon.svg")}">\n` +
      CSS.map(f => `<link rel="stylesheet" href="${url(f)}">`).join("\n") +
      `\n<link rel="stylesheet" href="${url(PRINT_CSS)}" media="print">`;
  }

  // The app expects the same shell index.html gives it: #app, #state, #toolbar.
  const shell = interactive ? `
<div class="state" id="state" role="status" aria-live="polite" hidden>
  <div class="state-card">
    <div class="state-spinner" id="state-spinner"></div>
    <div class="state-icon" id="state-icon" hidden></div>
    <h1 class="state-title" id="state-title"></h1>
    <p class="state-text" id="state-text"></p>
    <pre class="state-code" id="state-code" hidden></pre>
    <a class="state-btn" id="state-btn" href="./" hidden></a>
  </div>
</div>

<div class="toolbar no-print" id="toolbar"${toolbar ? "" : " hidden"}>
  <button id="btn-present" type="button" title="وضع العرض على السبورة (F5)">🎬 عرض</button>
  <button id="btn-print"  type="button" title="طباعة على صفحة A4">🖨️ طباعة</button>
  <button id="btn-image"  type="button" title="حفظ الورقة كصورة A4">🖼️ حفظ صورة</button>
  <button id="btn-theme"  type="button" title="تبديل النمط بين المرح والاحترافي">🎨 النمط</button>
  <button id="btn-reset"  type="button" title="إعادة تعيين إجابات الطالب">🔄 إعادة تعيين</button>
</div>` : "";

  /* The answer layer, on an issued sheet only.
     What goes into window.EDU_ANSWER is deliberately the LEAST that lets the
     page report a submission: ids, kinds, and where to post. No answer key,
     no goal texts, no grading rules — the page is held by a student, and
     everything it knows is something they can read. */
  const answerBoot = (interactive && opts.answer) ? `
<script>
window.EDU_ANSWER = ${jsonForScript({
    assignmentId: opts.answer.assignmentId,
    token: opts.answer.token,
    submitUrl: opts.answer.submitUrl,
    student: opts.answer.student || null,
    questions: opts.answer.questions || []
  })};
</script>
<script type="module" src="${url("assets/js/answer.js")}"></script>` : "";

  // window.EDU_DATA is the highest-priority source in loader.js, so the app
  // re-renders exactly this payload and wires it up. No second request.
  const boot = interactive ? `
<script>
window.EDU_CONFIG = Object.assign({}, window.EDU_CONFIG, {
  showToolbar: ${toolbar ? "true" : "false"},
  logo: ${jsonForScript(logo)},
  protection: Object.assign({}, (window.EDU_CONFIG||{}).protection, { enabled:false })
});
window.EDU_DATA = ${jsonForScript(data)};
window.EDU_OPTIONS = ${jsonForScript({
    theme: opts.theme || null,
    embed,
    toolbar,
    autoImage: !!opts.autoImage,
    autoPrint: !!opts.autoPrint
  })};
</script>
<script type="module" src="${url("assets/js/main.js")}"></script>${answerBoot}` : "";

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="generator" content="EduWebTemplateGenerator">
<meta name="edu-template" content="${esc(sheet.template)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
${head}
</head>
<body${embed ? ` data-embed="1"` : ""}>

<div class="page" id="app" data-template="${esc(sheet.template)}" data-theme="${esc(sheet.theme)}" style="${sheet.style}">${sheet.body}</div>
${shell}${boot}
</body>
</html>
`;

  return { html, template: sheet.template, theme: sheet.theme, title };
}

/* ------------------------------------------------------------- validation -- */

/** Cheap structural check: is this renderable, and what would it render as? */
export function validate(data){
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)){
    return { valid: false, template: null, errors: ["Payload must be a JSON object."], warnings };
  }

  const meta = data.meta || {};
  if (!data.meta) warnings.push('No "meta" block — the sheet renders with default title and colors.');

  const asked = meta.template || meta.type || data.template;
  const template = detect(data);
  if (asked && !knownTemplates().includes(template)){
    errors.push(`Unknown template "${asked}". Known: ${knownTemplates().join(", ")}.`);
  }

  if (template === "worksheet"){
    if (!Array.isArray(data.sections) || !data.sections.length){
      warnings.push('No "sections" array — the worksheet renders header and info blocks only.');
    }
  }
  if (template.startsWith("interactive-card")){
    if (!Array.isArray(data.cards) || !data.cards.length) errors.push('Card templates need a non-empty "cards" array.');
  }
  if (template === "differentiated-lesson"){
    if (!data.groups && !data.activities && !data.assessment){
      warnings.push("Lesson plan has no groups / activities / assessment — the sheet will be mostly empty.");
    }
  }
  if (template === "golden-minutes"){
    if (!data.session && !data.firstFive && !data.lastFive){
      warnings.push("Golden-minutes card has no session / firstFive / lastFive — the sheet will be mostly empty.");
    }
  }
  if (template === "learning-pattern"){
    const qs = Array.isArray(data.questions) ? data.questions : [];
    const st = Array.isArray(data.styles) ? data.styles : [];
    if (!qs.length) errors.push('The learning-pattern survey needs a non-empty "questions" array.');
    if (!st.length) errors.push('The learning-pattern survey needs a non-empty "styles" array.');
    const keys = new Set(st.map(s => normStyle(s && (s.key || s.id || s.name))));
    const orphans = qs
      .map((q, i) => ({ i, key: normStyle(q && (q.style || q.pattern || q.type)) }))
      .filter(q => !keys.has(q.key));
    if (orphans.length){
      warnings.push(`Statements ${orphans.map(o => o.i + 1).join(", ")} feed no declared style — they are shown but never scored.`);
    }
  }

  return { valid: errors.length === 0, template, errors, warnings };
}

export { knownTemplates };
