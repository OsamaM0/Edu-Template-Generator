/* ============================================================================
   theme.js — color palettes + the active theme/accent state
   ----------------------------------------------------------------------------
   Two themes from one JSON:
     playful — per-section colors from PALETTES, emoji icons visible
     pro     — every card uses the single accent color, emoji icons hidden by CSS
   ========================================================================== */
import { mixWhite } from "./util.js";

export const PALETTES = {
  blue:   { main:"#3d87d6", tint:"#e4f0fb" },
  sky:    { main:"#3aa3d4", tint:"#e3f4fb" },
  green:  { main:"#58a846", tint:"#eaf6e4" },
  orange: { main:"#f39c2d", tint:"#fdf1dd" },
  yellow: { main:"#e8a921", tint:"#fdf6e0" },
  purple: { main:"#8a5fc0", tint:"#f1eafa" },
  pink:   { main:"#e2607b", tint:"#fce9ed" },
  red:    { main:"#e05252", tint:"#fdeaea" },
  teal:   { main:"#17a08f", tint:"#e0f5f1" }
};

/** Colors handed out, in order, to sections that don't name one. */
const COLOR_CYCLE = ["blue", "sky", "purple", "orange", "teal", "pink", "green", "yellow"];

const DEFAULT_ACCENT = "#33608d";

/* --- active state -------------------------------------------------------- */
let THEME  = "playful";
let ACCENT = { main: DEFAULT_ACCENT, tint: mixWhite(DEFAULT_ACCENT, 0.10) };

export const getTheme  = () => THEME;
export const getAccent = () => ACCENT;

/* --- age / theme vocabulary ------------------------------------------------
   The endpoint may send either wording; both resolve to the same two looks.
     pro     ← pro professional simple minimal formal plain mono teen adult
     playful ← kid kids child children playful fun primary junior  (default)   */
const PRO_ALIASES = ["pro", "professional", "simple", "minimal", "formal", "plain", "mono", "teen", "adult", "senior"];
const KID_ALIASES = ["kid", "kids", "child", "children", "playful", "fun", "primary", "junior", "young"];

export const normTheme = t => {
  const v = String(t || "").toLowerCase().trim();
  if (PRO_ALIASES.includes(v)) return "pro";
  if (KID_ALIASES.includes(v)) return "playful";
  return "playful";
};

/** meta.accent accepts a palette name ("teal") or a hex ("#33608d"). */
export function resolveAccent(a){
  if (a && PALETTES[a]) return { ...PALETTES[a] };
  if (typeof a === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a.trim())){
    const h = a.trim();
    return { main: h, tint: mixWhite(h, 0.10) };
  }
  return { main: DEFAULT_ACCENT, tint: mixWhite(DEFAULT_ACCENT, 0.10) };
}

export function setTheme(theme, accent){
  THEME  = normTheme(theme);
  ACCENT = resolveAccent(accent);
  return { theme: THEME, accent: ACCENT };
}

/** Read the age/theme + color/accent pair out of a meta block, honoring both
    vocabularies. `forced` (from ?theme= / ?age= / the toolbar) always wins. */
export function themeFromMeta(meta, forced){
  const m = meta || {};
  return {
    theme:  forced || m.age || m.theme,
    accent: m.color != null && m.color !== "" ? m.color : m.accent
  };
}

/** Raw palette lookup: named color, else the next color in the cycle. */
export const pal = (name, i) => PALETTES[name] || PALETTES[COLOR_CYCLE[(i || 0) % COLOR_CYCLE.length]];

/** Theme-aware palette — what every renderer should call.
    In "pro", per-section colors are deliberately ignored. */
export const tpal = (name, i) => (THEME === "pro" ? ACCENT : pal(name, i));
