/* ============================================================================
   config.mjs — settings for the document pipeline only
   ----------------------------------------------------------------------------
   Nothing here touches the core engine. Every value comes from the environment,
   so the extension can be pointed at another database, secured, disabled, or
   given a different cache location without editing code.

   NO CREDENTIAL HAS A DEFAULT. The connection string and the signing secret are
   read from the environment or they are absent, and the extension says so
   plainly rather than falling back to something committed. Put them in .env
   (copy env.example) or in the deployment's own secret store.

     EDU_PIPELINE                 "0" disables the extension entirely  (default on)
     EDU_PIPELINE_MONGO_URI       mongodb:// connection string         (required)
     EDU_PIPELINE_DB              database name                        (default ai)
     EDU_PIPELINE_PAGE_SECRET     HMAC secret for /t/<key> links       (recommended)
     EDU_PIPELINE_LINK_TTL_MIN    signed-link lifetime, 0 = forever    (default 0)
     EDU_PIPELINE_CACHE_DIR       built pages on disk       (default data/cache)
     EDU_PIPELINE_CACHE_TTL_MIN   0 = keep forever                     (default 0)
     EDU_PIPELINE_CACHE_MAX       most pages kept on disk              (default 2000)
     EDU_PIPELINE_DOC_TTL_MIN     how long a Mongo read is reused      (default 10)
     EDU_PIPELINE_MEM_PAGES       pages held in memory                 (default 64)
     EDU_PIPELINE_PUBLIC_PAGES    "0" makes /t/* need the API key too  (default 1)
     EDU_PIPELINE_DEBUG_JSON      "1" prints the raw analysis JSON at the bottom
                                  of the report and dashboard pages   (default OFF)
     EDU_PIPELINE_STUDENT_RESULTS "1" lets a student see their own mark the
                                  moment they submit                  (default OFF)

   Answer sheets, results and where they go:
     EDU_PIPELINE_ASSIGN_DIR      issued sheets on disk  (default data/assignments)
     EDU_PIPELINE_ASSIGN_TTL_MIN  how long a student link lives, 0 = forever (default 0)
     EDU_PIPELINE_OUTPUT_DIR      submitted results      (default data/output)
     EDU_PIPELINE_SAVE_RESULTS    "0" stops writing result files       (default 1)
     EDU_PIPELINE_PRINT_RESULTS   "0" stops logging results to stdout  (default 1)
     EDU_PIPELINE_SUBMIT_ENDPOINT   POST the raw answers here, when set
     EDU_PIPELINE_ANALYSIS_ENDPOINT POST the full analysis here, when set
     EDU_PIPELINE_BACKEND_TOKEN     bearer token for both                (optional)
     EDU_PIPELINE_BACKEND_HEADER    header carrying it   (default Authorization)
     EDU_PIPELINE_BACKEND_TIMEOUT_MS how long to wait for the backend   (default 8000)

   Where results are WRITTEN is server/store's business, not this file's:
     EDU_STORE / EDU_STORE_DB       (default on, database "activities")
   ========================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";

// First import in the extension: fills process.env from .env before anything —
// including server.mjs's own top-level EDU_* reads — looks at it.
import "./env.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const num = (name, fallback) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) ? n : fallback;
};

const off = v => v != null && /^(0|false|no|off)$/i.test(String(v));
const str = name => (process.env[name] || "").trim();

/* The opposite default to off(). Used for the two switches below, which are
   production-safe when absent: an unset variable must mean "do not expose it",
   not "expose it", so a deployment that has never heard of them is closed. */
const on = v => v != null && /^(1|true|yes|on)$/i.test(String(v).trim());

export const config = {
  enabled: !off(process.env.EDU_PIPELINE),

  mongoUri: str("EDU_PIPELINE_MONGO_URI"),
  db: process.env.EDU_PIPELINE_DB || "ai",

  /** Where each part of a generated document comes from. */
  collections: {
    questions:  process.env.EDU_PIPELINE_COL_QUESTIONS  || "questions",
    worksheets: process.env.EDU_PIPELINE_COL_WORKSHEETS || "worksheets",
    summaries:  process.env.EDU_PIPELINE_COL_SUMMARIES  || "summaries"
  },

  /** Signed /t/<key> links. Empty = unsigned, which leaves pages open. */
  pageSecret: str("EDU_PIPELINE_PAGE_SECRET"),
  linkTtlMs: num("EDU_PIPELINE_LINK_TTL_MIN", 0) * 60_000,
  publicPages: !off(process.env.EDU_PIPELINE_PUBLIC_PAGES),

  cacheDir: process.env.EDU_PIPELINE_CACHE_DIR || path.join(ROOT, "data", "cache"),
  cacheTtlMs: num("EDU_PIPELINE_CACHE_TTL_MIN", 0) * 60_000,   // 0 → never expires
  cacheMax: num("EDU_PIPELINE_CACHE_MAX", 2000),
  memoryPages: num("EDU_PIPELINE_MEM_PAGES", 64),

  /** A lesson's Mongo documents rarely change; re-reading them per request would not pay. */
  docTtlMs: num("EDU_PIPELINE_DOC_TTL_MIN", 10) * 60_000,

  /* --- issued sheets and their results ------------------------------------ */

  /** One record per sheet handed to a student: the key it is graded against. */
  assignDir: process.env.EDU_PIPELINE_ASSIGN_DIR || path.join(ROOT, "data", "assignments"),
  assignTtlMs: num("EDU_PIPELINE_ASSIGN_TTL_MIN", 0) * 60_000,   // 0 → until submitted

  /** Where a submitted result lands: the analysis JSON and its report page. */
  outputDir: process.env.EDU_PIPELINE_OUTPUT_DIR || path.join(ROOT, "data", "output"),
  saveResults: !off(process.env.EDU_PIPELINE_SAVE_RESULTS),
  printResults: !off(process.env.EDU_PIPELINE_PRINT_RESULTS),

  /**
   * The backend this server reports to. Unset means "nowhere": results are
   * saved and logged and the submission still succeeds, which is the state a
   * deployment is in until the endpoints exist.
   */
  submitEndpoint: str("EDU_PIPELINE_SUBMIT_ENDPOINT"),
  analysisEndpoint: str("EDU_PIPELINE_ANALYSIS_ENDPOINT"),
  backendToken: str("EDU_PIPELINE_BACKEND_TOKEN"),
  backendHeader: process.env.EDU_PIPELINE_BACKEND_HEADER || "Authorization",
  backendTimeoutMs: num("EDU_PIPELINE_BACKEND_TIMEOUT_MS", 8000),

  /* --- what a page is allowed to show --------------------------------------
     Both default OFF, because both are things production should not be doing
     and an unset variable is what production looks like. */

  /**
   * The raw analysis JSON, in a <details> block at the bottom of the report and
   * the group dashboard. Written for debugging — it is the whole analysis, every
   * question and every model answer, sitting in view-source — so it belongs on a
   * developer's machine and nowhere a parent or a student can reach.
   */
  debugJson: on(process.env.EDU_PIPELINE_DEBUG_JSON),

  /**
   * Whether a student sees their own mark the instant they submit.
   *
   * Off: the submit response carries the receipt and nothing else — no score, no
   * per-goal bars, no report link — so answer.js has nothing to paint and shows
   * the thank-you panel alone. The result is still graded, stored and delivered
   * exactly as before; only the STUDENT's copy is withheld, and the teacher's
   * /report and /result are untouched.
   */
  showStudentResults: on(process.env.EDU_PIPELINE_STUDENT_RESULTS),

  /** Route prefixes owned by this extension. */
  apiPrefix: "/api/pipeline",
  pagePrefix: "/t",
  answerPrefix: "/a"
};

/* --------------------------------------------------------- cache exposure -- */

/*
 * The site root and the application directory are the same folder, and the core
 * serves that folder statically. A cache living inside it is therefore reachable
 * as a plain file — /data/cache/<key>.html would hand out any page
 * without its signature, which makes signing pointless.
 *
 * So work out whether the cache is under the served root, and if it is, publish
 * the URL prefix that routes.mjs must claim and refuse.
 */
{
  /** The URL a directory would be reachable at, or null when it is outside. */
  const urlPrefixOf = dir => {
    const rel = path.relative(ROOT, dir);
    const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    return inside ? `/${rel.split(path.sep).join("/")}/` : null;
  };

  config.cacheUrlPrefix = urlPrefixOf(config.cacheDir);
  config.cacheUnderSiteRoot = !!config.cacheUrlPrefix;

  /* Assignments hold answer keys and results hold graded work — both are worse
     to leak than a cached page. routes.mjs refuses every one of these prefixes;
     the list is here so adding a directory cannot forget to add its guard. */
  config.privateUrlPrefixes = [
    config.cacheUrlPrefix,
    urlPrefixOf(config.assignDir),
    urlPrefixOf(config.outputDir)
  ].filter(Boolean);
}

/**
 * What is missing before this extension can serve anything, and what is merely
 * unwise. Surfaced by /api/pipeline/health and logged once at boot, so a
 * misconfigured deployment says so instead of failing on the first request.
 */
export function configProblems(){
  const errors = [];
  const warnings = [];

  /* Everything needs it now — the lessons are read through it and the results
     are written through it. Without it the extension has no store at all. */
  if (!config.mongoUri){
    errors.push("EDU_PIPELINE_MONGO_URI is not set — there is no database to read lessons from or write results to. Put it in .env (copy env.example).");
  } else if (!/^mongodb:\/\//.test(config.mongoUri)){
    errors.push("EDU_PIPELINE_MONGO_URI must start with mongodb:// (mongodb+srv:// is not supported).");
  }

  if (!config.pageSecret){
    warnings.push("EDU_PIPELINE_PAGE_SECRET is not set — /t/<key> links are unsigned. Page keys are derived from the document_idx, so anyone can compute them.");
  } else if (config.pageSecret.length < 24){
    warnings.push("EDU_PIPELINE_PAGE_SECRET is shorter than 24 characters — use a long random value.");
  }

  if (!process.env.EDU_API_KEY){
    warnings.push("EDU_API_KEY is not set — /api/* is open to anyone who can reach the port.");
  }

  if (config.cacheUnderSiteRoot && config.pageSecret){
    warnings.push(`The page cache sits inside the served site root (${config.cacheUrlPrefix}). Requests for it are refused, but set EDU_PIPELINE_CACHE_DIR to a path outside the site so the files are not there to serve at all.`);
  }

  /* Results are written to MongoDB now, but the output directory still gets a
     readable copy of every one, and the assignments directory may still hold
     records from before the database. Both are graded student work on disk. */
  for (const [name, dir, variable] of [
    ["The results directory", config.outputDir, "EDU_PIPELINE_OUTPUT_DIR"],
    ["The pre-database assignments directory", config.assignDir, "EDU_PIPELINE_ASSIGN_DIR"]
  ]){
    const rel = path.relative(ROOT, dir);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)){
      warnings.push(`${name} sits inside the served site root (${dir}). Requests for that path are refused, but set ${variable} to a directory outside the site.`);
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}

export default config;
