/* ============================================================================
   server/pipeline — document pipeline
   ----------------------------------------------------------------------------
   A unified endpoint that turns a lesson stored in MongoDB into a finished,
   cached web page:

     POST /api/pipeline/document   { type, document_idx, seed }  →  { url, … }
     GET  /t/<key>               the page that produced

   The core engine is untouched. server.mjs hands every request to pipelineRoute()
   first; it answers only for /api/pipeline/* and /t/*, and returns false for
   everything else so the core router carries on exactly as before. Removing
   this extension is deleting the folder and the two lines that call it.

   What lives where:
     config.mjs      environment settings for this extension only
     answers/        issued sheets, grading, per-goal analysis, delivery
     mongo/          a small BSON + OP_MSG + SCRAM client (the project has no
                     npm dependencies, and this is not a reason to add one)
     source.mjs      document_idx → one normalized lesson from three collections
                     (read only — the generator's database, never written to)
     store/          ../store — where everything this platform produces is written
     rng.mjs         the seed: same seed, same questions
     build/          one module per document type → core-template JSON
     cache.mjs       build once, serve from disk thereafter
     routes.mjs      the HTTP surface
   ========================================================================== */
import config, { configProblems } from "./config.mjs";
import { ensureIndexes, writable as storeWritable } from "../store/index.mjs";

export { pipelineRoute, pipelineOpenPath } from "./routes.mjs";
export * as store from "../store/index.mjs";
export { default as config } from "./config.mjs";
export { loadLesson, ping, closeMongo } from "./source.mjs";
export { buildDocument, knownTypes, typeDocs } from "./build/index.mjs";
export * as cache from "./cache.mjs";

/* Say at boot what would otherwise only surface on the first request. Errors do
   not stop the server: the core render API works with the extension broken, and
   a half-serving box is easier to diagnose than one that refuses to start. */
if (config.enabled){
  const { errors, warnings } = configProblems();
  for (const e of errors)   console.error(`[pipeline] config error: ${e}`);
  for (const w of warnings) console.warn(`[pipeline] warning: ${w}`);

  /* Declare the indexes the results database needs, in the background.

     On boot rather than by hand, so a fresh deployment, a restored dump and a
     developer's laptop all end up with the same query plans. In the background,
     so a slow or unreachable database delays nothing. A failure is logged
     inside ensureIndexes() and never thrown — missing indexes make queries
     slow, and a slow dashboard beats a server that will not start. */
  if (storeWritable()) ensureIndexes().catch(() => { /* already reported */ });
}
