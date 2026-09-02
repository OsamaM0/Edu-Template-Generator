/* ============================================================================
   store/results.mjs — what the student answered, and what we concluded
   ----------------------------------------------------------------------------
   Two collections, deliberately separate:

     submissions   the payload exactly as it arrived — EVIDENCE
     analyses      the marks, the bands and the written report — INTERPRETATION

   `submissions.answers` is never rewritten. Everything in `analyses` is
   rewritten whole by a re-grade, which bumps `revision`. Keeping the two in one
   document would make "re-grade last term with the corrected answer key" a
   data-loss operation, and that is the one operation this split exists for.

   Within each, the detail is embedded: `submissions.marks[]` is one entry per
   question, `analyses.goals[]` one per learning goal, `analyses.styles[]` one
   per learning style on a survey. They are written together, read together, and
   only ever aggregated with their parent in scope — the subdocument case.

   Cross-document questions ("which question did the class get wrong") are
   aggregations over the embedded arrays, which is what $unwind is for. They run
   over one class's worth of submissions, not the whole term.
   ========================================================================== */
import { store, db, now, newId, derivedId, COLLECTIONS } from "./index.mjs";
import { exists as documentExists } from "./documents.mjs";

const SUBMISSIONS = COLLECTIONS.submissions;
const ANALYSES = COLLECTIONS.analyses;
const DELIVERIES = COLLECTIONS.deliveries;

const text = v => (v == null ? "" : String(v).trim());
const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const real = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* ------------------------------------------------------------------ write -- */

/**
 * Store one graded submission, whole.
 *
 * Idempotent per assignment: a re-grade replaces the analysis and bumps
 * `revision` rather than filing a second result nobody can tell apart from the
 * first. The submission itself is upserted on the same key and its `answers`
 * are written once — a re-grade re-reads them, it does not resend them.
 *
 * @param {object} analysis  what analyze() returned — the whole object
 * @param {object} [context] ip, userAgent, durationSec, source
 * @returns {Promise<{submissionId, analysisId, revision}>}
 */
export async function save(analysis, context = {}){
  const c = store();
  const at = now();

  const assignmentId = text(analysis.assignment_id);
  if (!assignmentId) throw new Error("An analysis must name the assignment it came from.");

  /* Snapshots, not references. The student on a result is the student as the
     sheet was issued to, and stays that way whatever the partner's roster does.
     The school, the teacher and the day it was sat are kept on the same terms:
     a result is read on its own — exported, printed, sent on — and should not
     need a join to say where it came from. */
  const student = analysis.student || null;
  const studentId = text(student && student.id) || null;
  const groupId = text(analysis.group_id) || null;
  const school = analysis.school || null;
  const teacher = analysis.teacher || null;
  const examDate = analysis.exam_date || null;

  /* The page the student answered, when it was recorded. Guarded rather than
     assumed: a submission must never fail because the document it came from
     predates the store. */
  const pageKey = text(analysis.page_key);
  const documentId = pageKey && (await documentExists(pageKey)) ? pageKey : null;

  const questions = analysis.questions || [];

  /* --- the evidence --- */
  const existingSubmission = await c.findOne(SUBMISSIONS, { assignment_id: assignmentId },
    { db: db(), projection: { _id: 1, created_at: 1 } });
  const submissionId = existingSubmission ? existingSubmission._id : newId("sub");

  await c.replaceOne(SUBMISSIONS, { assignment_id: assignmentId }, {
    _id: submissionId,
    assignment_id: assignmentId,
    document_id: documentId,
    document_idx: text(analysis.document_idx),
    student,
    school,
    teacher,
    exam_date: examDate,
    group_id: groupId,
    group: analysis.group || null,

    /* Exactly the object the sheet POSTed: {question_id: answer}. */
    answers: analysis.answers || {},
    answer_count: Object.keys(analysis.answers || {}).length,
    unmatched: analysis.unmatched_answers || [],

    /* One entry per question, as marked. Embedded because it is written with
       the submission, read with it, and aggregated only within a class. */
    marks: questions.map((q, i) => ({
      id: derivedId(submissionId, q.question_id || i),
      question_id: text(q.question_id),
      position: int(q.position) || i + 1,
      kind: text(q.kind),
      question: text(q.question),
      goal_id: text(q.goal_id),
      goal_text: text(q.goal_text),
      difficulty: int(q.difficulty) || 1,
      student_answer: text(q.student_answer),
      correct_answer: text(q.correct_answer),
      chosen_index: int(q.chosen_index),
      answered: !!q.answered,
      correct: !!q.correct,
      score: real(q.score) || 0,
      confidence: text(q.confidence),
      needs_review: !!q.needs_review,
      points: int(q.points),
      max_points: int(q.max_points),
      chosen_label: text(q.chosen_label),
      style: text(q.style) || null,
      detail: text(q.detail)
    })),

    source: context.source || "web",
    duration_sec: int(context.durationSec),
    ip: text(context.ip),
    user_agent: text(context.userAgent).slice(0, 300),
    submitted_at: text(analysis.submitted_at) || at,
    created_at: (existingSubmission && existingSubmission.created_at) || at
  }, { db: db(), upsert: true });

  /* --- the interpretation --- */
  const prior = await c.findOne(ANALYSES, { assignment_id: assignmentId },
    { db: db(), projection: { _id: 1, created_at: 1, revision: 1 } });
  const analysisId = prior ? prior._id : newId("ana");
  const revision = prior ? Number(prior.revision || 1) + 1 : 1;

  const overall = analysis.overall || {};
  const report = analysis.report || {};

  await c.replaceOne(ANALYSES, { assignment_id: assignmentId }, {
    _id: analysisId,
    submission_id: submissionId,
    assignment_id: assignmentId,
    document_id: documentId,
    document_idx: text(analysis.document_idx),
    student,
    school,
    teacher,
    exam_date: examDate,
    group_id: groupId,
    group: analysis.group || null,
    lesson_title: text(analysis.lesson_title),
    type: text(analysis.type),
    scoring: analysis.scoring === "profile" ? "profile" : "mastery",
    schema: text(analysis.schema) || "pipeline.analysis/1",

    /* The numbers a dashboard sorts on, at the top level so it can sort on them
       without pulling the whole analysis back. */
    overall: {
      total: int(overall.total) || 0,
      correct: int(overall.correct) || 0,
      wrong: int(overall.wrong) || 0,
      unanswered: int(overall.unanswered) || 0,
      needs_review: int(overall.needs_review) || 0,
      percentage: real(overall.percentage),
      score: real(overall.score) || 0,
      score_percentage: real(overall.score_percentage),
      points: int(overall.points),
      max_points: int(overall.max_points),
      mastery: text(overall.mastery),
      mastery_label: text(overall.mastery_label)
    },

    /* Per goal — the row a teacher acts on. `percentage: null` means the goal
       went UNTESTED, which is a different fact from scoring zero. */
    goals: Object.values(analysis.goals || {}).map((g, i) => ({
      id: derivedId(analysisId, g.goal_id || i),
      goal_id: text(g.goal_id),
      goal_text: text(g.goal_text),
      cognitive_level: text(g.cognitive_level),
      priority: int(g.priority) || 1,
      position: i,
      total: int(g.total) || 0,
      correct: int(g.correct) || 0,
      wrong: int(g.wrong) || 0,
      unanswered: int(g.unanswered) || 0,
      needs_review: int(g.needs_review) || 0,
      percentage: real(g.percentage),
      score: real(g.score) || 0,
      mastery: text(g.mastery),
      mastery_label: text(g.mastery_label),
      recommendation: text(g.recommendation),
      question_ids: g.question_ids || []
    })),

    /* Per style — what a survey has where an exam has goals. Kept in its own
       field so the two are never averaged together by accident. */
    styles: analysis.profile
      ? (analysis.profile.styles || []).map((s, i) => ({
          style_key: text(s.key),
          label: text(s.label),
          points: int(s.points) || 0,
          max_points: int(s.max_points) || 0,
          percentage: real(s.percentage),
          strength: text(s.strength),
          strength_label: text(s.strength_label),
          is_dominant: ((analysis.profile.verdict || {}).styles || [])
            .some(w => text(w.key) === text(s.key)),
          position: i,
          color: text(s.color),
          description: text(s.description),
          tips: s.tips || []
        }))
      : null,
    profile_verdict: (analysis.profile && analysis.profile.verdict) || null,

    report,
    /* The whole analysis as it is served and posted onward. The fields above
       are an index over it, not a second copy. */
    payload: analysis,

    revision,
    submitted_at: text(analysis.submitted_at),
    created_at: (prior && prior.created_at) || at,
    updated_at: at
  }, { db: db(), upsert: true });

  return { submissionId, analysisId, revision };
}

/* ------------------------------------------------------------------- read -- */

/** The stored analysis for one assignment, exactly as it was saved. */
export async function analysisFor(assignmentId){
  const doc = await store().findOne(ANALYSES, { assignment_id: text(assignmentId) },
    { db: db(), projection: { payload: 1 } });
  return (doc && doc.payload) || null;
}

/** Several at once — what a group dashboard needs, in one query instead of N. */
export async function analysesFor(assignmentIds){
  const ids = (assignmentIds || []).map(text).filter(Boolean);
  if (!ids.length) return {};

  const docs = await store().find(ANALYSES, { assignment_id: { $in: ids } },
    { db: db(), projection: { assignment_id: 1, payload: 1 }, limit: ids.length });

  const out = {};
  for (const doc of docs) out[doc.assignment_id] = doc.payload;
  return out;
}

export async function submissionFor(assignmentId){
  return store().findOne(SUBMISSIONS, { assignment_id: text(assignmentId) }, { db: db() });
}

/** One student's history, newest first. */
export async function studentResults(studentId, limit = 50){
  return store().find(ANALYSES, { "student.id": text(studentId) }, {
    db: db(),
    sort: { submitted_at: -1 },
    limit: Math.min(Number(limit) || 50, 500),
    projection: { payload: 0, goals: 0, styles: 0, report: 0 }
  });
}

/**
 * Which goal the class is weakest on — the row that says what to reteach.
 * $unwind over the embedded goals, grouped across the sitting.
 */
export async function goalMastery(groupId){
  return store().aggregate(ANALYSES, [
    { $match: { group_id: text(groupId) } },
    { $unwind: "$goals" },
    { $match: { "goals.total": { $gt: 0 } } },
    { $group: {
      _id: "$goals.goal_id",
      goal_text: { $last: "$goals.goal_text" },
      students: { $sum: 1 },
      avg_percentage: { $avg: "$goals.percentage" },
      struggling: { $sum: { $cond: [{ $lt: ["$goals.percentage", 60] }, 1, 0] } }
    } },
    { $project: {
      _id: 0, goal_id: "$_id", goal_text: 1, students: 1,
      avg_percentage: { $round: ["$avg_percentage", 1] }, struggling: 1
    } },
    { $sort: { avg_percentage: 1 } }
  ], { db: db() });
}

/** Item analysis: which question was got wrong, and by how many. */
export async function questionDifficulty(filter = {}){
  const match = {};
  if (filter.documentIdx || filter.document_idx) match.document_idx = String(filter.documentIdx || filter.document_idx);
  if (filter.groupId || filter.group_id) match.group_id = String(filter.groupId || filter.group_id);

  return store().aggregate(SUBMISSIONS, [
    { $match: match },
    { $unwind: "$marks" },
    { $group: {
      _id: { question_id: "$marks.question_id", document_idx: "$document_idx" },
      question: { $last: "$marks.question" },
      kind: { $last: "$marks.kind" },
      goal_id: { $last: "$marks.goal_id" },
      answered_by: { $sum: 1 },
      correct: { $sum: { $cond: ["$marks.correct", 1, 0] } },
      unanswered: { $sum: { $cond: ["$marks.answered", 0, 1] } }
    } },
    { $project: {
      _id: 0,
      question_id: "$_id.question_id",
      document_idx: "$_id.document_idx",
      question: 1, kind: 1, goal_id: 1, answered_by: 1, correct: 1, unanswered: 1,
      correct_pct: {
        $cond: [{ $gt: ["$answered_by", 0] },
          { $round: [{ $multiply: [{ $divide: ["$correct", "$answered_by"] }, 100] }, 1] }, 0]
      }
    } },
    { $sort: { correct_pct: 1 } }
  ], { db: db() });
}

/* ------------------------------------------------------------- deliveries -- */

/**
 * Record one POST to the partner's backend, successful or not. This is the
 * replay list: a delivery that failed is a record here and a submission that
 * still succeeded, which is the only acceptable order of those two facts.
 */
export async function recordDelivery(input){
  try {
    await store().insertOne(DELIVERIES, {
      _id: newId("dlv"),
      analysis_id: input.analysisId || null,
      assignment_id: input.assignmentId || null,
      kind: input.kind === "submit" ? "submit" : "analysis",
      endpoint: text(input.endpoint),
      ok: !!input.ok,
      status_code: int(input.status),
      duration_ms: int(input.ms),
      error: text(input.error),
      response: text(input.response).slice(0, 500),
      attempt: int(input.attempt) || 1,
      attempted_at: now()
    }, { db: db() });
    return true;
  } catch (err){
    console.warn(`[store] delivery not recorded: ${err.message}`);
    return false;
  }
}

/**
 * Deliveries that have never succeeded — what a retry job would work through.
 * Grouped by (analysis, kind) so one endpoint that eventually accepted a result
 * does not keep appearing because its first attempt failed.
 */
export async function failedDeliveries(limit = 100){
  return store().aggregate(DELIVERIES, [
    { $sort: { attempted_at: -1 } },
    { $group: {
      _id: { analysis_id: "$analysis_id", kind: "$kind" },
      ever_ok: { $max: { $cond: ["$ok", 1, 0] } },
      last: { $first: "$$ROOT" }
    } },
    { $match: { ever_ok: 0 } },
    { $replaceRoot: { newRoot: "$last" } },
    { $sort: { attempted_at: -1 } },
    { $limit: Math.min(Number(limit) || 100, 1000) }
  ], { db: db() });
}
