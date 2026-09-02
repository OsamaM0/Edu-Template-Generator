/* ============================================================================
   drawing — free-drawing canvas (4 pens + clear) with labeled answer lines.
   ========================================================================== */
import { esc, pic, wline } from "../util.js";
import { cardHead, instr } from "../card.js";

export const type = "drawing";

const PENS = ["#3a4a63", "#e05252", "#3d87d6", "#58a846"];

export function render(sec){
  const labels = (sec.labels || []).map(l => `
    <div class="draw-label"><span>${esc(l)}:</span>${wline()}</div>`).join("");

  const pens = PENS.map((c, i) =>
    `<span class="pen ${i === 0 ? "sel" : ""}" data-pen="${c}" style="background:${c}" role="button" tabindex="0" aria-label="قلم"></span>`
  ).join("");

  return `${cardHead(sec)}${instr(sec)}
    <div class="draw-zone" data-w="draw">
      <canvas></canvas>
      ${sec.deco ? `<span class="draw-deco">${pic(sec.deco)}</span>` : ""}
    </div>
    <div class="draw-tools no-print">
      ${pens}
      <button class="clear-btn" type="button">🧽 مسح</button>
    </div>
    ${labels ? `<div class="draw-labels">${labels}</div>` : ""}`;
}

export function wire(card){
  const resizers = [];

  card.querySelectorAll('[data-w="draw"]').forEach(zone => {
    const canvas = zone.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    let pen = PENS[0], down = false;

    /** How much the card is visually magnified right now (1 on the sheet,
        ~3–4 while it is on the presentation stage). */
    const visualScale = () => {
      const r = zone.getBoundingClientRect();
      return zone.offsetWidth ? r.width / zone.offsetWidth : 1;
    };

    // Size the backing store to devicePixelRatio × the current visual scale, so
    // strokes stay crisp both on the sheet and blown up on a classroom board.
    // setTransform (not scale) because this runs again on every resize.
    function fit(){
      const dpr = (window.devicePixelRatio || 1) * visualScale();
      const w = zone.clientWidth, h = zone.clientHeight;
      if (!w || !h) return;

      // Preserve whatever is already drawn across the resize. drawImage onto a
      // scratch canvas rather than getImageData — a readback would force the
      // 2d context into software mode and make drawing laggy.
      let prev = null;
      if (canvas.width && canvas.height){
        prev = document.createElement("canvas");
        prev.width = canvas.width;
        prev.height = canvas.height;
        prev.getContext("2d").drawImage(canvas, 0, 0);
      }

      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      if (prev) ctx.drawImage(prev, 0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.5;
    }
    fit();
    resizers.push(fit);

    // getBoundingClientRect is in SCREEN pixels; the canvas draws in LAYOUT
    // pixels. On the presentation stage the card is CSS-scaled, so divide the
    // offset back down or the stroke lands away from the pointer.
    const at = e => {
      const r = canvas.getBoundingClientRect();
      const k = canvas.offsetWidth ? r.width / canvas.offsetWidth : 1;
      return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    };

    canvas.addEventListener("pointerdown", e => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      const p = at(e);
      ctx.strokeStyle = pen;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener("pointermove", e => {
      if (!down) return;
      const p = at(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(ev =>
      canvas.addEventListener(ev, () => { down = false; }));

    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);

    const tools = zone.parentElement.querySelector(".draw-tools");
    if (tools){
      tools.querySelectorAll(".pen").forEach(p => {
        const choose = () => {
          tools.querySelectorAll(".pen").forEach(x => x.classList.remove("sel"));
          p.classList.add("sel");
          pen = p.dataset.pen;
        };
        p.addEventListener("click", choose);
        p.addEventListener("keydown", e => {
          if (e.key === " " || e.key === "Enter"){ e.preventDefault(); choose(); }
        });
      });
      const btn = tools.querySelector(".clear-btn");
      if (btn) btn.addEventListener("click", clear);
    }

    zone._clear = clear;
  });

  return { onResize: () => resizers.forEach(fn => fn()) };
}

export function reset(card){
  card.querySelectorAll('[data-w="draw"]').forEach(z => z._clear && z._clear());
  card.querySelectorAll(".wline").forEach(l => { l.textContent = ""; });
}
