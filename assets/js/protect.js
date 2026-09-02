/* ============================================================================
   protect.js — in-page copy deterrents
   ----------------------------------------------------------------------------
   Blocks the casual copy routes: right-click menu, text selection/copy outside
   the answer fields, and the Ctrl+S / Ctrl+U shortcuts. Printing stays enabled
   on purpose — it is a core feature of a worksheet.

   These are deterrents, not protection (devtools bypasses all of them), so
   they are configurable and by default only active inside an embed, where the
   host site's students are the audience. config.protection.deterrents:
     true     always on
     "embed"  only when framed or body[data-embed]   (default in config.js)
     false    off
   ========================================================================== */

/** True when the event happens inside something the student legitimately edits. */
const inEditable = e =>
  !!(e.target && e.target.closest && e.target.closest("input, textarea, select, [contenteditable]"));

export function installDeterrents(config){
  const P = config.protection || {};
  const embedded = window !== window.top || document.body.dataset.embed === "1";
  const active = P.deterrents === true || (P.deterrents === "embed" && embedded);
  if (!P.enabled || !active) return;

  document.addEventListener("contextmenu", e => {
    if (!inEditable(e)) e.preventDefault();
  });

  document.addEventListener("selectstart", e => {
    if (!inEditable(e)) e.preventDefault();
  });

  document.addEventListener("copy", e => {
    if (!inEditable(e)) e.preventDefault();
  });

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && /^[su]$/i.test(e.key)) e.preventDefault();
  });
}
