/* ============================================================================
   logo.js — ONE school logo, ONE place, EVERY template
   ----------------------------------------------------------------------------
   The site-wide logo lives in config.js (window.EDU_CONFIG.logo) and defaults
   to assets/img/logo.png — replace that file (or point src elsewhere)
   and every sheet updates. Resolution order, per sheet:

     meta.logo set        → the sheet's own logo wins ("" hides it entirely)
     meta.logo absent     → the site-wide logo.src
     logo.src: ""         → no logo anywhere

   The resolved value is written back into meta.logo BEFORE the template
   renders, so templates with a native corner slot (interactive cards,
   differentiated-lesson art side, the golden-minutes badge box) just read
   meta.logo. Templates without one (worksheet) get the .site-logo overlay,
   pinned to the sheet's top-left corner. Both places accept the usual slot
   rule: image URL, emoji, or a built-in icon name.
   ========================================================================== */
import { pic } from "./util.js";

export const DEFAULT_LOGO = {
  src: "assets/img/logo.png",   // "" = no site-wide logo
  width: 84                            // px — the overlay / badge box width
};

/** The logo this sheet should show: its own meta.logo, else the site's. */
export const resolveLogo = (meta, cfg) =>
  (meta && meta.logo !== undefined) ? (meta.logo || "") : ((cfg && cfg.src) || "");

/** The fixed top-corner overlay used by templates without a native slot. */
export function logoOverlay(v, width){
  if (!v) return "";
  return `<div class="site-logo" style="--lw:${Number(width) || DEFAULT_LOGO.width}px">${pic(v, "site-logo-img", "site-logo-emoji")}</div>`;
}
