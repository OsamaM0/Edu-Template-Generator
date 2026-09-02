/* ============================================================================
   EduWebTemplateGenerator — site configuration
   ----------------------------------------------------------------------------
   The ONLY file you edit when moving between environments (local / staging /
   production). Loaded as a plain script before the app modules, so no build
   step and no JS knowledge is needed to change it.
   ========================================================================== */
window.EDU_CONFIG = {

  /* --- Where lesson JSON comes from ---------------------------------------
     apiBase = ""   -> static mode: read data/lessons/<id>.json  (works on any
                       static host: GitHub Pages, Netlify, nginx, IIS…)
     apiBase = url  -> API mode: GET <apiBase>/lessons/<id>
     Static mode is also the automatic fallback if the API request fails. */
  apiBase: "",

  /* Templates. {base} = apiBase, {id} = the sanitized lesson id from the URL. */
  apiPath:    "{base}/lessons/{id}",
  lessonPath: "data/lessons/{id}.json",

  /* Try the static file when the API errors out (404 / offline / CORS). */
  fallbackToStatic: true,

  /* --- URL contract --------------------------------------------------------
     index.html?lesson=<id>     the lesson id (aliases below also accepted)
     index.html?theme=pro       force a theme, overrides the JSON
     index.html?toolbar=0|1     show/hide the floating toolbar             */
  lessonParams: ["lesson", "lessonId", "id", "l"],

  /* Used when the URL carries no lesson id at all. */
  defaultLesson: "science-g2-living-creatures-needs",

  /* --- API plumbing --------------------------------------------------------
     Extra headers sent in API mode (e.g. {"X-Api-Key": "…"}). Never put a
     secret here — anything in this file is public. Prefer a per-tenant token
     appended to apiBase, or an API that only serves published lessons. */
  requestHeaders: {},
  credentials: "same-origin",   // "include" if your API sets cookies cross-site

  /* Some APIs wrap the payload: {"data": {...}} or {"worksheet": {...}}.
     List the keys to unwrap, in order. Set to [] if your API returns the
     worksheet object directly. */
  unwrapKeys: ["data", "worksheet", "lesson", "result"],

  /* --- Fixed school logo ---------------------------------------------------
     ONE logo, ONE place, EVERY template. Each sheet shows it in its fixed
     logo spot: the golden-minutes badge box, the card templates' logo slot,
     the lesson-plan masthead corner, and a top-corner stamp on worksheets.
     To change the logo everywhere, replace assets/img/logo.png with
     your own file — or point src at another path / full URL / emoji.
     src: "" turns the logo off. A lesson can still override per sheet with
     meta.logo (and meta.logo: "" hides it on that sheet only). */
  logo: {
    src: "assets/img/logo.png",
    width: 84                // px — the worksheet-stamp / badge box width
  },

  /* --- Behaviour ----------------------------------------------------------- */
  allowInlineData: true,   // accept ?data=<base64-json> (handy for previews)
  allowSrcParam: true,     // accept ?src=<url> (back-compat with the prototype)
  showToolbar: "auto",     // "auto" = shown standalone, hidden inside an iframe
  cache: "no-store",       // fetch cache mode: "no-store" | "default"

  /* Footer strip of the playful theme. [] hides it. */
  footerDecor: ["🌼", "🌱", "🌸", "🍀", "🌷"],

  /* --- Content protection --------------------------------------------------
     Raises the effort needed to clone a worksheet. This is deterrence, not
     DRM — content a browser can show can always be extracted by a determined
     person (screenshots, print to PDF, devtools). What it does stop:
       · opening a "Save page as…" copy from disk        (blockFileProtocol)
       · re-hosting the files on another domain           (allowedHosts)
       · reading lesson JSON off the server / network tab (packedLessons)
       · casual right-click / select / copy in embeds     (deterrents)
     Details + deploy steps: README → "Content protection".                  */
  protection: {
    enabled: true,
    allowedHosts: [],          // e.g. ["example.com"] also allows subdomains; [] = any host
    allowLocalhost: true,      // keep local dev working even with allowedHosts set
    blockFileProtocol: true,   // refuse to run from file:// (saved copies)
    embedOnly: false,          // true = only render inside an iframe
    homeUrl: "",               // "official site" link shown on the block screen
    deterrents: "embed",       // right-click/copy blocking: true | false | "embed"
    packedLessons: true        // load encrypted .wsx files (run tools/pack-lessons.mjs)
  }
};
