/* ============================================================================
   signatures — teacher / principal blocks. No card head by design.
   ========================================================================== */
import { esc, pic } from "../util.js";

export const type = "signatures";

export function render(sec){
  const entries = (sec.entries || []).map(e => `
    <div class="sig-item">
      <span class="sig-role">${esc(e.role || "")}</span>
      <div class="sig-row">
        ${e.icon ? `<span class="ic">${pic(e.icon)}</span>` : ""}
        <span class="sig-name">${esc(e.name || "")}</span>
        <span class="sig-line"></span>
      </div>
    </div>`).join("");

  return `<div class="sig-list">${entries}</div>`;
}
