/* ============================================================================
   to-image.js — save the sheet as a high-resolution A4-portrait JPG
   ----------------------------------------------------------------------------
   Works for EVERY template: the live .page element is captured with
   html2canvas at ~200 dpi, placed centred on an exact A4 canvas (no
   distortion, scale-to-fit) and downloaded as <lesson title>.jpg.

   html2canvas is loaded lazily on the first click — the vendored copy first,
   the CDN as a fallback — so it costs nothing until the button is pressed.
   ========================================================================== */

/* A4 portrait at 200 dpi */
const A4W = 1654;
const A4H = 2339;

const VENDOR = "assets/js/vendor/html2canvas.min.js";
const CDN    = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

let loading = null;

function loadScript(src){
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload  = () => ok();
    s.onerror = () => { s.remove(); bad(new Error(`failed to load ${src}`)); };
    document.head.appendChild(s);
  });
}

function ensureHtml2canvas(){
  if (window.html2canvas) return Promise.resolve();
  if (!loading){
    loading = loadScript(VENDOR).catch(() => loadScript(CDN)).catch(err => {
      loading = null;               // allow a retry on the next click
      throw err;
    });
  }
  return loading;
}

/** A safe file name from the lesson title. */
function fileName(data){
  const m = (data && data.meta) || {};
  const t = m.lessonTitle || m.title || m.badge || document.title || "ورقة-عمل";
  return String(t).trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 80) + ".jpg";
}

/**
 * Capture `app` (the .page element) and download it as an A4-portrait JPG.
 * Resolves when the download has been triggered.
 */
export async function toImage(app, data){
  await ensureHtml2canvas();
  await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());

  const rect = app.getBoundingClientRect();
  const w = Math.ceil(rect.width);
  const h = Math.ceil(app.scrollHeight);

  // Capture at the pixel density that makes the sheet exactly A4W wide.
  const capScale = Math.max(1, A4W / w);

  const canvas = await window.html2canvas(app, {
    scale: capScale,
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,          // keep the sheet's own rounded background
    width: w,
    height: h,
    scrollX: 0, scrollY: 0,
    logging: false,
    imageTimeout: 0,
    // html2canvas draws spaced text glyph-by-glyph, which destroys Arabic
    // ligature shaping — flatten letter-spacing in the capture clone only.
    onclone(doc){
      const st = doc.createElement("style");
      st.textContent = "*{letter-spacing:normal !important;}";
      doc.head.appendChild(st);
    }
  });

  // Compose onto an exact A4 page — scale to fit, never distort.
  const out = document.createElement("canvas");
  out.width  = A4W;
  out.height = A4H;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4W, A4H);

  const fit = Math.min(A4W / canvas.width, A4H / canvas.height);
  const dW  = Math.round(canvas.width  * fit);
  const dH  = Math.round(canvas.height * fit);
  ctx.drawImage(canvas, Math.round((A4W - dW) / 2), Math.round((A4H - dH) / 2), dW, dH);

  const link = document.createElement("a");
  link.download = fileName(data);
  link.href = out.toDataURL("image/jpeg", 0.95);
  link.click();
}
