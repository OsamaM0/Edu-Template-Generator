/* ============================================================================
   answers/deliver.mjs — what happens to a result once it exists
   ----------------------------------------------------------------------------
   Four destinations, and none of them is allowed to lose the work:

     1. the database           submissions / submission_answers / analyses /
                               analysis_goals — the record of what happened,
                               written first because it is the one that is
                               queried later
     2. the output directory   <id>.json and <id>.html, a human-readable copy
     3. stdout                 the analysis, printed, for a deployment that has
                               no backend yet and is watching the logs
     4. the backend            POSTed to EDU_PIPELINE_SUBMIT_ENDPOINT and
                               EDU_PIPELINE_ANALYSIS_ENDPOINT when they are set

   The order matters. The result is stored before the network is touched, so a
   backend that is down, slow, or not configured yet costs the school nothing:
   the work is saved and can be replayed later. A failed POST is REPORTED, in
   the submit response and in the log, and never turned into a failed
   submission — the student has already answered, and telling them their work
   did not save because an internal service was unreachable would be a lie.

   Every POST is also recorded in `deliveries`, successful or not, which is what
   makes "replay everything that never reached the backend" a query rather than
   a log-grep.

   Until the endpoints are configured this module prints and saves, which is
   exactly what "for now print the values" asks for. Setting the two variables
   is the only change needed to start delivering.
   ========================================================================== */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import config from "../config.mjs";
import { results } from "../../store/repo.mjs";
import { renderReport } from "./report.mjs";

/* ------------------------------------------------------------------- files -- */

/** File names are ids, which are already restricted to a safe alphabet. */
const safe = id => String(id).replace(/[^A-Za-z0-9_-]/g, "");

/**
 * Write the result where a human can find it: the analysis as JSON and the same
 * analysis as a page. Returns the paths, or the error, but never throws — a
 * read-only disk must not swallow a submission.
 */
export async function saveResult(analysis, context = {}){
  const stored = await store(analysis, context);

  if (!config.saveResults) return { ...stored, saved: false, reason: "disabled" };

  const id = safe(analysis.assignment_id);
  const jsonPath = path.join(config.outputDir, `${id}.json`);
  const htmlPath = path.join(config.outputDir, `${id}.html`);

  try {
    await mkdir(config.outputDir, { recursive: true });
    await writeFile(jsonPath, JSON.stringify(analysis, null, 2), "utf8");
    await writeFile(htmlPath, renderReport(analysis), "utf8");
    return { ...stored, saved: true, json: jsonPath, html: htmlPath, dir: config.outputDir };
  } catch (err){
    console.error("[pipeline] could not write the result file:", err.message);
    return { ...stored, saved: false, error: err.message, dir: config.outputDir };
  }
}

/**
 * The result, in the database: the submission as it arrived, one row per
 * answer, the analysis, and the per-goal breakdown.
 *
 * Failing to store is loud but not fatal. The student has already answered and
 * the link is already closed; turning a storage outage into a lost submission
 * would be the worse of the two failures, and the analysis is still returned,
 * printed and delivered from memory.
 */
async function store(analysis, context = {}){
  try {
    const { submissionId, analysisId, revision } = await results.save(analysis, context);
    return { stored: true, submission_id: submissionId, analysis_id: analysisId, revision };
  } catch (err){
    console.error("[pipeline] could not store the result:", err.message);
    return { stored: false, store_error: err.message };
  }
}

/* ----------------------------------------------------------------- reading -- */

/* The last results, in memory, in front of the files. A teacher opening the
   report seconds after the student submitted is the common case, and it should
   not depend on the disk having been writable. */
const recent = new Map();

function remember(analysis){
  recent.delete(analysis.assignment_id);
  recent.set(analysis.assignment_id, analysis);
  while (recent.size > 200) recent.delete(recent.keys().next().value);
  return analysis;
}

/** The stored analysis for one assignment, or null. */
export async function readResult(assignmentId){
  const id = safe(assignmentId);
  if (!id) return null;

  const hot = recent.get(id);
  if (hot) return hot;

  /* The database first: it is the store, and a result written before the output
     directory existed (or after it was cleaned up) is still there. The file is
     the fallback, which is also what reads results written by an older build. */
  try {
    const stored = await results.analysisFor(id);
    if (stored) return remember(stored);
  } catch { /* fall through to the file */ }

  try {
    return remember(JSON.parse(await readFile(path.join(config.outputDir, `${id}.json`), "utf8")));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ stdout -- */

/**
 * The result, on the log. Two shapes on purpose: a summary line a human reads
 * while watching a deployment, and the full JSON a script can grep out of the
 * logs before any backend exists.
 */
export function printResult(analysis){
  if (!config.printResults) return;

  const s = analysis.student || {};
  const o = analysis.overall;

  console.log("");
  console.log("═".repeat(72));
  console.log(`[pipeline] result · ${s.name || s.id || "student"} · lesson ${analysis.document_idx}${analysis.group_id ? ` · group ${analysis.group_id}` : ""} · ${analysis.assignment_id}`);
  console.log(`         ${o.correct}/${o.total} correct · ${o.percentage}% · ${o.mastery} · ${o.unanswered} unanswered`);

  for (const g of Object.values(analysis.goals || {})){
    const bar = g.percentage == null ? "—" : `${String(g.percentage).padStart(5)}%`;
    console.log(`         ${String(g.goal_id).padEnd(14)} ${bar}  ${g.correct}/${g.total}  ${g.goal_text || ""}`.trimEnd());
  }

  console.log(`         ${analysis.report.summary}`);
  console.log("─".repeat(72));
  console.log(JSON.stringify(analysis));
  console.log("═".repeat(72));
  console.log("");
}

/* ----------------------------------------------------------------- backend -- */

/** The headers a configured backend gets. The token is optional. */
function backendHeaders(){
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (config.backendToken){
    const name = config.backendHeader || "Authorization";
    headers[name] = /^authorization$/i.test(name)
      ? `Bearer ${config.backendToken}`
      : config.backendToken;
  }
  return headers;
}

/**
 * POST one payload to one endpoint. Bounded by its own timeout so a backend
 * that accepts the connection and then hangs cannot hold the student's browser
 * open until it gives up.
 *
 * @returns {Promise<{endpoint, ok, status?, error?, ms}>} — never rejects
 */
async function post(endpoint, payload){
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.backendTimeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify(payload),
      signal: abort.signal
    });

    // The body is read so the connection can be reused, and so a 4xx says why.
    const text = await res.text().catch(() => "");
    const out = {
      endpoint, ok: res.ok, status: res.status, ms: Date.now() - started,
      response: text.slice(0, 500) || undefined
    };
    if (!res.ok) console.error(`[pipeline] backend ${endpoint} answered ${res.status}: ${text.slice(0, 200)}`);
    return out;

  } catch (err){
    const reason = err.name === "AbortError"
      ? `timed out after ${config.backendTimeoutMs}ms`
      : err.message;
    console.error(`[pipeline] backend ${endpoint} failed: ${reason}`);
    return { endpoint, ok: false, error: reason, ms: Date.now() - started };

  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send the result onward, if there is anywhere to send it.
 *
 * The two endpoints carry two different things and a backend may want either or
 * both: the SUBMIT endpoint gets what the student answered, the ANALYSIS
 * endpoint gets what it means. Both are posted in parallel — neither is
 * downstream of the other.
 *
 * @returns {Promise<{configured:boolean, deliveries:Array}>}
 */
export async function deliver(analysis, stored = {}){
  const jobs = [];

  /* Every attempt is recorded whether or not it worked, so a backend that was
     down for an hour leaves a list to replay rather than a gap. */
  const record = (kind, outcome) => {
    results.recordDelivery({
      ...outcome, kind,
      analysisId: stored.analysis_id || null,
      assignmentId: analysis.assignment_id
    }).catch(() => { /* recording a delivery must never fail a submission */ });
    return outcome;
  };

  if (config.submitEndpoint){
    jobs.push(post(config.submitEndpoint, {
      schema: "pipeline.submission/1",
      assignment_id: analysis.assignment_id,
      student_id: (analysis.student && analysis.student.id) || null,
      student: analysis.student,
      group_id: analysis.group_id || null,
      group: analysis.group || null,
      document_idx: analysis.document_idx,
      lesson_title: analysis.lesson_title,
      type: analysis.type,
      seed: analysis.seed,
      submitted_at: analysis.submitted_at,
      answers: analysis.answers
    }).then(out => record("submit", out)));
  }

  if (config.analysisEndpoint){
    jobs.push(post(config.analysisEndpoint, analysis).then(out => record("analysis", out)));
  }

  if (!jobs.length){
    return {
      configured: false,
      deliveries: [],
      note: "No backend endpoint is configured — the result was saved and logged only. Set EDU_PIPELINE_SUBMIT_ENDPOINT and/or EDU_PIPELINE_ANALYSIS_ENDPOINT to forward it."
    };
  }

  return { configured: true, deliveries: await Promise.all(jobs) };
}

/**
 * Everything that happens after a submission is graded: file, log, backend.
 * Called once, from the submit handler, after the link has already been closed.
 */
export async function publish(analysis, context = {}){
  remember(analysis);                    // before the store, so a failed write still serves
  const saved = await saveResult(analysis, context);
  printResult(analysis);
  const delivery = await deliver(analysis, saved);
  return { output: saved, delivery };
}
