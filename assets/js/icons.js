/* ============================================================================
   icons.js — built-in line-art icon set
   ----------------------------------------------------------------------------
   Extends the placeholder rule with a fourth option: a NAME from this registry
   renders as inline SVG line art that inherits the card color via currentColor.

     "icon": "puzzle"     -> the line-art puzzle icon   (this file)
     "icon": "🧩"          -> the emoji itself
     "icon": "img/x.png"  -> an <img>
     "icon": ""           -> dashed placeholder box

   All icons are drawn on a 24×24 grid, stroked, never filled — so one icon
   works on white, on a tint, and in both themes.
   ========================================================================== */

const P = {
  /* --- people & places --- */
  user:        `<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"/>`,
  users:       `<circle cx="9" cy="8.5" r="3"/><path d="M3 19.5c0-3.2 2.7-4.9 6-4.9s6 1.7 6 4.9"/><path d="M16.4 6.7a3 3 0 0 1 0 5.6"/><path d="M18.2 14.8c1.9.7 2.8 2.1 2.8 4.3"/>`,
  "user-check":`<circle cx="10" cy="8" r="3.4"/><path d="M3.5 19.6c0-3.4 2.9-5.3 6.5-5.3 1.1 0 2.1.2 3 .5"/><path d="m14.8 17.4 2 2 3.7-3.7"/>`,
  school:      `<path d="M3 20.5V10l9-5.2 9 5.2v10.5"/><path d="M9.3 20.5v-5.2h5.4v5.2"/><path d="M12 3v2"/><path d="M3 20.5h18"/>`,
  /* an ID card: portrait on the right (RTL reading), record lines on the left */
  id:          `<rect x="2.8" y="5" width="18.4" height="14" rx="2.4"/><circle cx="16.6" cy="10.4" r="2.1"/><path d="M13.2 16.4c0-1.7 1.5-2.7 3.4-2.7s3.4 1 3.4 2.7"/><path d="M4.6 9.6h6M4.6 12.6h6M4.6 15.6h4"/>`,

  /* --- objects --- */
  book:        `<path d="M12 6.6C10.2 5.1 7.9 4.3 5 4.3v12.9c2.9 0 5.2.8 7 2.3 1.8-1.5 4.1-2.3 7-2.3V4.3c-2.9 0-5.2.8-7 2.3z"/><path d="M12 6.6v12.9"/>`,
  cards:       `<rect x="7.5" y="3.5" width="12" height="14.5" rx="2.2"/><path d="M4.5 6.6v11.9A2.9 2.9 0 0 0 7.4 21.4h9"/>`,
  clipboard:   `<rect x="5" y="4.6" width="14" height="16" rx="2.2"/><path d="M9 4.6v-1A1.1 1.1 0 0 1 10.1 2.5h3.8A1.1 1.1 0 0 1 15 3.6v1z"/><path d="M8.6 10.2h6.8M8.6 14h4.6"/>`,
  "clipboard-check": `<rect x="5" y="4.6" width="14" height="16" rx="2.2"/><path d="M9 4.6v-1A1.1 1.1 0 0 1 10.1 2.5h3.8A1.1 1.1 0 0 1 15 3.6v1z"/><path d="m8.4 10.6 1.6 1.6 3.1-3.1"/><path d="m8.6 15.4 3 3M11.6 15.4l-3 3"/>`,
  list:        `<rect x="3.6" y="4" width="16.8" height="16" rx="2.4"/><circle cx="8" cy="9" r="1.3"/><circle cx="8" cy="14.4" r="1.3"/><path d="M11.6 9h5.2M11.6 14.4h4"/>`,
  /* two interlocking pieces: offset rounded squares joined by tab arcs */
  puzzle:      `<rect x="3.8" y="4.6" width="7.8" height="7.8" rx="1.5"/><rect x="12.4" y="11.6" width="7.8" height="7.8" rx="1.5"/><path d="M11.6 8.9a1.65 1.65 0 0 1 0 3.3"/><path d="M16.3 11.6a1.65 1.65 0 0 0-3.3 0"/>`,
  funnel:      `<path d="M3.4 5.2h17.2l-6.6 7.7v6.6l-4-2.3v-4.3z"/>`,
  notebook:    `<rect x="5" y="3.4" width="14" height="17.2" rx="2.2"/><path d="M8.6 3.4v17.2"/><path d="M11.6 7.8h4.4M11.6 11.6h4.4M11.6 15.4h2.8"/>`,
  search:      `<circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4.6 4.6"/>`,
  trophy:      `<path d="M8 3.6h8V9a4 4 0 0 1-8 0z"/><path d="M8 5.2H5.4v1.3A3.4 3.4 0 0 0 8.8 9.9"/><path d="M16 5.2h2.6v1.3a3.4 3.4 0 0 1-3.4 3.4"/><path d="M12 13v3.2"/><path d="M9.6 16.4h4.8v4H9.6z"/><path d="M8 20.4h8"/>`,
  pencil:      `<path d="m15.4 4.4 4.2 4.2-10.2 10.2-5.2 1 1-5.2z"/><path d="m13.4 6.4 4.2 4.2"/>`,
  key:         `<circle cx="7.6" cy="12" r="3.8"/><path d="M11.4 12h9.2"/><path d="M18.4 12v3.2M15.4 12v2.4"/>`,
  calendar:    `<rect x="3.5" y="5" width="17" height="15.4" rx="2.2"/><path d="M3.5 9.6h17M8 3.4v3.2M16 3.4v3.2"/>`,

  /* --- security --- */
  lock:        `<rect x="4.6" y="10" width="14.8" height="10.4" rx="2.4"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/><circle cx="12" cy="15.2" r="1.3"/>`,
  "lock-open": `<rect x="4.6" y="10" width="14.8" height="10.4" rx="2.4"/><path d="M8 10V7.6a4 4 0 0 1 7.6-1.7"/><circle cx="12" cy="15.2" r="1.3"/>`,
  shield:      `<path d="M12 3 5 5.8v5.5c0 4.2 2.9 7.7 7 9.4 4.1-1.7 7-5.2 7-9.4V5.8z"/>`,
  "shield-check": `<path d="M12 3 5 5.8v5.5c0 4.2 2.9 7.7 7 9.4 4.1-1.7 7-5.2 7-9.4V5.8z"/><path d="m9 11.8 2.2 2.2 4-4.2"/>`,
  globe:       `<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.2 2.4 3.3 5.3 3.3 8.4S14.2 18 12 20.4C9.8 18 8.7 15.1 8.7 12S9.8 6 12 3.6"/>`,
  /* a browser window carrying a warning mark */
  "link-alert":`<rect x="2.8" y="4.6" width="18.4" height="14.8" rx="2.4"/><path d="M2.8 8.8h18.4"/><circle cx="5.8" cy="6.7" r=".7"/><circle cx="8.1" cy="6.7" r=".7"/><path d="M12 11.4v3.4"/><circle cx="12" cy="17.1" r="1"/>`,
  "phone-lock":`<rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M10.4 5.4h3.2"/><rect x="9.5" y="11.2" width="5" height="4.2" rx="1.1"/><path d="M10.7 11.2v-1a1.3 1.3 0 0 1 2.6 0v1"/>`,
  computer:    `<rect x="3" y="4.6" width="18" height="11.4" rx="2.2"/><path d="M8.6 20.4h6.8M12 16v4.4"/>`,

  /* --- time & thinking (golden-minutes card) --- */
  clock:       `<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.9"/>`,
  timer:       `<circle cx="12" cy="13.6" r="6.9"/><path d="M12 10.6v3l2.1 1.3"/><path d="M10 3.4h4M12 3.4v3.3"/><path d="m18.1 8.2 1.5-1.5"/>`,
  bulb:        `<path d="M12 3.4a5.7 5.7 0 0 1 3.3 10.3c-.6.5-1 1.1-1 1.9v.6h-4.6v-.6c0-.8-.4-1.4-1-1.9A5.7 5.7 0 0 1 12 3.4z"/><path d="M9.9 19.2h4.2M10.8 21.3h2.4"/>`,
  brain:       `<path d="M8.4 20.6v-3a7 7 0 1 1 8.5-9.4l1.7 3.8h-1.8v2.2a1.9 1.9 0 0 1-1.9 1.9h-1.5v4.5"/><path d="M10.4 8.6a2.1 2.1 0 0 1 3.6-1.5"/>`,
  question:    `<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.7a2.4 2.4 0 1 1 3.8 2c-.8.6-1.5 1.1-1.5 2.1v.2"/><circle cx="12" cy="16.8" r=".8"/>`,
  rocket:      `<path d="M12 3.5c2.7 1.8 4.1 4.5 4.1 7.9l-1.6 4.4H9.5l-1.6-4.4c0-3.4 1.4-6.1 4.1-7.9z"/><circle cx="12" cy="9.8" r="1.6"/><path d="M7.9 11.4 5.6 14v2.9l2.7-1.2M16.1 11.4l2.3 2.6v2.9l-2.7-1.2"/><path d="M12 17.6v2.9"/>`,
  refresh:     `<path d="M4.9 12a7.1 7.1 0 0 1 12.1-5"/><path d="M17.3 3.5v3.5h-3.5"/><path d="M19.1 12a7.1 7.1 0 0 1-12.1 5"/><path d="M6.7 20.5V17h3.5"/>`,
  next:        `<path d="m11.2 7.4-4.6 4.6 4.6 4.6"/><path d="m17.6 7.4-4.6 4.6 4.6 4.6"/>`,

  /* --- the senses (learning-pattern survey) --- */
  eye:         `<path d="M2.6 12S6.3 5.9 12 5.9 21.4 12 21.4 12 17.7 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.9"/>`,
  ear:         `<path d="M7.2 10.4a4.8 4.8 0 1 1 9.6 0c0 2.6-1.7 3.9-3 5-1 .9-1.4 1.6-1.4 2.7a2.2 2.2 0 0 1-4.4 0"/><path d="M10.6 10.6a1.6 1.6 0 0 1 3.2 0c0 1.1-.9 1.7-1.6 2.4"/>`,
  hand:        `<path d="M9.4 11.6V5.8a1.5 1.5 0 0 1 3 0v5"/><path d="M12.4 10.8V4.9a1.5 1.5 0 0 1 3 0v5.9"/><path d="M15.4 11V7a1.5 1.5 0 0 1 3 0v7.2a6.2 6.2 0 0 1-6.2 6.2h-.7a5.3 5.3 0 0 1-4.1-2l-2.6-3.2a1.5 1.5 0 0 1 2.3-1.9l2.1 2.5"/>`,

  /* --- abstract --- */
  target:      `<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.1"/>`,
  level:       `<path d="M5 20.4v-4.8M10 20.4V9.2M15 20.4v-7.6M20 20.4V4.8"/>`,
  upload:      `<path d="M12 3.4v10.2"/><path d="m8 7.4 4-4 4 4"/><path d="M4.6 14.8v3.6a2.2 2.2 0 0 0 2.2 2.2h10.4a2.2 2.2 0 0 0 2.2-2.2v-3.6"/>`,
  star:        `<path d="m12 3.4 2.5 5.3 5.7.7-4.2 4 1.1 5.8L12 16.4 6.9 19.2 8 13.4l-4.2-4 5.7-.7z"/>`,
  heart:       `<path d="M12 20 4.9 12.9a4.3 4.3 0 0 1 6-6.1l1.1 1 1.1-1a4.3 4.3 0 0 1 6 6.1z"/>`,
  leaf:        `<path d="M20.4 3.6C10 3.6 3.8 8.3 3.8 15a5.2 5.2 0 0 0 5.2 5.2c6.8 0 11.4-6.2 11.4-16.6"/><path d="M4.4 19.8C8 15.2 12.2 12.6 16.8 11"/>`,
  check:       `<circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.2 2.5 2.5 4.7-5"/>`,
  scissors:    `<circle cx="6.2" cy="6.2" r="2.4"/><circle cx="6.2" cy="17.8" r="2.4"/><path d="M8.3 7.8 20 18.4M8.3 16.2 20 5.6"/>`
};

export const hasIcon = name => Object.prototype.hasOwnProperty.call(P, name);

/** Inline SVG for a registry name. Inherits color via currentColor. */
export function icon(name, cls){
  if (!hasIcon(name)) return "";
  return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

export const iconNames = () => Object.keys(P);
