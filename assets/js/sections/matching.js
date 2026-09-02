/* ============================================================================
   matching — connect the two columns with SVG lines.
   Pick one item from each column to draw a line; double-click an item to
   remove its line. Lines are re-drawn on resize (see the returned onResize).
   ========================================================================== */
import { esc, pic } from "../util.js";
import { cardHead, instr, hint } from "../card.js";

export const type = "matching";

const LINE_COLORS = ["#3d87d6", "#f39c2d", "#58a846", "#8a5fc0", "#e2607b", "#17a08f"];

export function render(sec){
  const needs = (sec.needs || []).map(n => `
    <div class="m-item m-need" role="button" tabindex="0">
      <span class="need-pill">${n.icon ? pic(n.icon) + " " : ""}${esc(n.label || "")}</span>
      <span class="dot"></span>
    </div>`).join("");

  const creatures = (sec.creatures || []).map(c => `
    <div class="m-item m-crt" role="button" tabindex="0">
      <span class="dot"></span>
      <span class="m-creature">
        <span class="pv">${pic(c.image)}</span>
        ${c.label ? `<span class="sl">${esc(c.label)}</span>` : ""}
      </span>
    </div>`).join("");

  return `${cardHead(sec)}${instr(sec)}
    <div class="match-wrap" data-w="match">
      <svg class="match-svg" aria-hidden="true"></svg>
      <div class="match-cols">
        <div class="match-col">${needs}</div>
        <div class="match-col">${creatures}</div>
      </div>
    </div>
    ${hint("اضغط عنصراً من كل عمود لرسم خط التوصيل.")}`;
}

export function wire(card){
  const redraws = [];

  card.querySelectorAll('[data-w="match"]').forEach(w => {
    const svg   = w.querySelector(".match-svg");
    const needs = [...w.querySelectorAll(".m-need")];
    const crts  = [...w.querySelectorAll(".m-crt")];

    let pairs = [];                    // [{ n, c, color }]
    let pickN = null, pickC = null, ci = 0;

    // Dot center in the wrapper's own (unscaled) coordinate space.
    // getBoundingClientRect returns SCALED pixels, but the SVG viewBox is in
    // layout pixels — in presentation mode the card is CSS-transformed, so we
    // divide the deltas by the live scale factor or the lines land off-target.
    const center = el => {
      const dot = el.querySelector(".dot").getBoundingClientRect();
      const box = w.getBoundingClientRect();
      const k = w.offsetWidth ? box.width / w.offsetWidth : 1;
      return {
        x: (dot.left + dot.width / 2 - box.left) / k,
        y: (dot.top + dot.height / 2 - box.top) / k
      };
    };

    const redraw = () => {
      svg.setAttribute("viewBox", `0 0 ${w.clientWidth} ${w.clientHeight}`);
      svg.innerHTML = pairs.map(p => {
        const a = center(p.n), b = center(p.c);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${p.color}" stroke-width="2.5" stroke-linecap="round"/>`;
      }).join("");
    };
    redraws.push(redraw);

    const tryPair = () => {
      if (!pickN || !pickC) return;
      pairs = pairs.filter(p => p.n !== pickN && p.c !== pickC);   // one line per item
      pairs.push({ n: pickN, c: pickC, color: LINE_COLORS[ci++ % LINE_COLORS.length] });
      pickN.classList.remove("pick"); pickC.classList.remove("pick");
      pickN = pickC = null;
      redraw();
    };

    const picker = (el, isNeed) => {
      const cur = isNeed ? pickN : pickC;
      if (cur === el){ el.classList.remove("pick"); isNeed ? (pickN = null) : (pickC = null); return; }
      if (cur) cur.classList.remove("pick");
      el.classList.add("pick");
      isNeed ? (pickN = el) : (pickC = el);
      tryPair();
    };

    needs.forEach(el => el.addEventListener("click", () => picker(el, true)));
    crts .forEach(el => el.addEventListener("click", () => picker(el, false)));

    [...needs, ...crts].forEach(el => {
      el.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter"){ e.preventDefault(); picker(el, el.classList.contains("m-need")); }
      });
      el.addEventListener("dblclick", () => {
        pairs = pairs.filter(p => p.n !== el && p.c !== el);
        redraw();
      });
    });

    w._reset = () => {
      pairs = []; pickN = pickC = null;
      [...needs, ...crts].forEach(el => el.classList.remove("pick"));
      redraw();
    };
  });

  // render.js collects these and fires them on window resize / print.
  return { onResize: () => redraws.forEach(fn => fn()) };
}

export function reset(card){
  card.querySelectorAll('[data-w="match"]').forEach(w => w._reset && w._reset());
}
