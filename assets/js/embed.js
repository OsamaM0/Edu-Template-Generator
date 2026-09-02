/* ============================================================================
   embed.js — iframe integration (only does anything when the page is framed)
   ----------------------------------------------------------------------------
   Publishes the worksheet height to the host page so the iframe can grow
   instead of scrolling. The host either listens for the message itself or
   drops in assets/js/iframe-resizer.js, which does it automatically.

   Messages sent to the host   { source: "edu-worksheet", type, … }
     height  { height:<px>, lessonId }
     ready   { lessonId, source }
     error   { code, message }
   Message accepted from host  { source: "edu-host", type: "hello" }
     -> re-sends the latest status + height, so the host can attach its
        listener at any time without missing the handshake.
   ========================================================================== */

export const isFramed = () => {
  try { return window.self !== window.top; } catch { return true; }
};

let lastHeight = 0;
let lastStatus = null;
let lessonId = null;
let observer = null;

function measure(){
  const app = document.getElementById("app");
  const el = app && !app.hidden ? app : document.body;
  return Math.ceil(el.getBoundingClientRect().height + 2);
}

// "*" as the target origin because the host origin is unknown by design;
// the payload is a page height and a public lesson id, nothing sensitive.
function send(msg){
  if (!isFramed()) return;
  // `source` is spread LAST so a payload field can never overwrite the marker
  // the host filters on.
  parent.postMessage({ ...msg, source: "edu-worksheet" }, "*");
}

function postHeight(force){
  const height = measure();
  if (!force && Math.abs(height - lastHeight) < 2) return;
  lastHeight = height;
  send({ type: "height", height, lessonId });
}

/** Start reporting height. Safe to call again after a re-render. */
export function startHeightReporting(id){
  if (id != null) lessonId = id;
  if (!isFramed()) return;

  if (!observer){
    const fire = () => postHeight(false);
    observer = new ResizeObserver(fire);
    observer.observe(document.body);
    window.addEventListener("load", fire);
    window.addEventListener("resize", fire);
  }

  postHeight(true);
  requestAnimationFrame(() => postHeight(true));
  setTimeout(() => postHeight(true), 300);   // after webfonts settle
}

/** Tell the host the worksheet is ready (useful for spinners on their side). */
export function postReady(info){
  lastStatus = { type: "ready", ...info };
  send(lastStatus);
}

/** Tell the host a lesson failed to load. */
export function postError(code, message){
  lastStatus = { type: "error", code, message };
  send(lastStatus);
}

window.addEventListener("message", ev => {
  const m = ev.data;
  if (!m || m.source !== "edu-host" || m.type !== "hello") return;
  if (lastStatus) send(lastStatus);
  postHeight(true);
});
