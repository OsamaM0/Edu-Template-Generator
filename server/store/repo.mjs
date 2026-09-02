/* ============================================================================
   store/repo.mjs — one namespace per area of the database
   ----------------------------------------------------------------------------
   Import the area, not the collection:

     import { assignments, results } from "../store/repo.mjs";
     const record = await assignments.get(id);

   These four modules are the only code in the project that builds a Mongo
   query. Everything above them passes whole objects around — an assignment
   record, an analysis — and never a filter or a projection.

   There is no roster namespace, and that is the point: schools, teachers,
   classes and students belong to the partner platform, arrive as parameters,
   and are stored as snapshots on the records here. See collections.mjs.
   ========================================================================== */
export * as documents from "./documents.mjs";
export * as assignments from "./assignments.mjs";
export * as results from "./results.mjs";
export * as audit from "./audit.mjs";
