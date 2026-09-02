/* ============================================================================
   store/documents.mjs — every sheet this platform has generated
   ----------------------------------------------------------------------------
   The page cache keeps the HTML; this keeps the RECORD. They are not the same
   thing and must not share a lifetime: a cached page is evicted when the
   directory outgrows its limit, and "which exam did we give in October, and
   what was on it" has to survive that.

   `_id` is the page key, which is derived from the request — so rebuilding the
   same document updates one record and bumps `rebuild_count` instead of growing
   the collection.

   `questions[]` is the exam AS PRINTED, with the key it is graded against,
   embedded rather than referenced. It is written once, read whole, and never
   queried across documents — which is exactly the subdocument case.
   ========================================================================== */
import { store, db, now, COLLECTIONS } from "./index.mjs";

const C = COLLECTIONS.documents;

const text = v => (v == null ? "" : String(v).trim());
const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };

/** A school or a teacher, as the caller named them — or null for neither. */
const party = p => (p && text(p.id || p.name)) ? { id: text(p.id), name: text(p.name) } : null;

/**
 * The day the sheet was sat, from either shape it arrives in: the parsed object
 * the builder produced, or the flat string the canonical request hashes it as.
 * Taking the string for an object is what used to file every record with an
 * empty date.
 */
const examDateOf = v => {
  if (!v) return null;
  if (typeof v === "object") return { iso: v.iso || null, text: text(v.text || v.iso) };
  const s = text(v);
  return s ? { iso: /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null, text: s } : null;
};

/* ------------------------------------------------------------------ write -- */

/**
 * Record a built document.
 *
 * @param {object} input
 *   key        the page key — the record's _id
 *   built      what buildDocument() returned (answerKey, scoring, goals, …)
 *   request    the canonical build request
 *   meta       the cache sidecar: builtAt, bytes, …
 *   pageUrl    the signed /t/<key> URL, when one was minted
 *   school     where it was built for, as the caller named it — a snapshot
 *   teacher    who asked for it, as the caller named them — a snapshot
 * @returns {Promise<string>} the page key
 */
export async function record(input){
  const key = text(input.key);
  if (!key) throw new Error("A document record needs its page key.");

  const built = input.built || {};
  const request = input.request || {};
  const meta = input.meta || {};
  const at = now();

  const answerKey = built.answerKey || [];
  const examDate = examDateOf(built.examDate || request.examDate);
  const student = request.student || built.student || null;

  /* $set for what this build determines, $setOnInsert for what only the first
     one does, $inc for the counter — so a rebuild updates in place and the
     record keeps the day it first appeared. */
  const document = {
    type: text(request.type || built.type),
    document_idx: text(request.documentIdx || built.documentIdx),
    lesson_title: text(input.lessonTitle || meta.lessonTitle),
    title: text(built.title || request.title),
    subject: text(input.subject) || null,
    seed: text(request.seed != null ? request.seed : built.seed),
    scoring: built.scoring || "mastery",
    theme: text(request.theme) || null,
    color: text(built.color || request.color) || null,
    counts: built.counts || request.counts || {},
    request,

    /* Only a personalised copy names a student, and it is a SNAPSHOT of what
       the partner platform sent — never a reference to a roster we do not own. */
    student: student && text(student.id)
      ? { id: text(student.id), name: text(student.name),
          classroom: text(student.classroom), section: text(student.section) }
      : null,

    /* Printed in the header, so kept with the record for the same reason the
       student is: "which school got this sheet, and who set it" has to survive
       the page cache being swept. Snapshots — nothing here is looked up. */
    school: party(input.school || request.school),

    exam_date: examDate,

    /* The questions as printed, in order, with their key. */
    questions: answerKey.map((q, i) => ({
      question_id: text(q.question_id),
      position: int(q.position) || i + 1,
      kind: text(q.kind),
      question: text(q.question),
      choices: q.choices || [],
      answer_key: Number.isInteger(q.answer_key) ? q.answer_key : null,
      answer: text(q.answer),
      answer_parts: q.answer_parts || [],
      difficulty: int(q.difficulty) || 1,
      goal_id: text(q.goal_id),
      goal_text: text(q.goal_text),
      style: text(q.style) || null,
      max_points: q.max_points == null ? null : int(q.max_points)
    })),

    goals: built.goals || [],
    question_count: answerKey.length,
    goal_count: (built.goals || []).length,
    cache_version: text(meta.cacheVersion || meta.version),
    bytes: int(meta.bytes) || 0,
    page_url: text(input.pageUrl),
    built_by: party(input.teacher || request.teacher),
    built_at: text(meta.builtAt) || at,
    status: "built",
    updated_at: at
  };

  await store().updateOne(C, { _id: key }, {
    $set: document,
    $setOnInsert: { _id: key, created_at: at, serve_count: 0, last_served_at: null },
    $inc: { rebuild_count: 1 }
  }, { db: db(), upsert: true });

  return key;
}

/**
 * Is there a record under this page key?
 *
 * Asked before anything files itself against a document: a page cached by an
 * older build has no record here, and a dangling reference must not be the
 * reason a student's submission fails to save.
 */
export async function exists(key){
  if (!text(key)) return false;
  return (await store().countDocuments(C, { _id: text(key) }, { db: db() })) > 0;
}

/**
 * A page was served. Fire-and-forget: it is a usage counter, and a request must
 * never fail because a counter could not be incremented.
 */
export function touchServed(key){
  store().updateOne(C, { _id: text(key) },
    { $inc: { serve_count: 1 }, $set: { last_served_at: now() } }, { db: db() })
    .catch(() => { /* a counter is not worth a failed page */ });
}

/** The page left the cache. The record stays — that is the whole point of it. */
export async function markEvicted(key, status = "evicted"){
  await store().updateOne(C, { _id: text(key) },
    { $set: { status, updated_at: now() } }, { db: db() });
}

/* ------------------------------------------------------------------- read -- */

export async function get(key){
  return store().findOne(C, { _id: text(key) }, { db: db() });
}

/** The exam as printed: the questions and the key they are graded against. */
export async function questions(key){
  const document = await store().findOne(C, { _id: text(key) },
    { db: db(), projection: { questions: 1 } });
  return (document && document.questions) || [];
}

export async function list(filter = {}){
  const query = {};
  if (filter.type) query.type = filter.type;
  if (filter.documentIdx || filter.document_idx) query.document_idx = String(filter.documentIdx || filter.document_idx);
  if (filter.studentId || filter.student_id) query["student.id"] = String(filter.studentId || filter.student_id);
  if (filter.status) query.status = filter.status;

  return store().find(C, query, {
    db: db(),
    sort: { built_at: -1 },
    limit: Math.min(Number(filter.limit) || 100, 1000),
    /* The questions are the bulk of a document and nobody lists them; the
       catalogue view is a hundred rows of metadata, not a hundred exams. */
    projection: { questions: 0, request: 0, goals: 0 }
  });
}

export async function stats(){
  const c = store();
  const byType = await c.aggregate(C, [
    { $group: { _id: "$type", n: { $sum: 1 } } },
    { $sort: { n: -1 } }
  ], { db: db() });

  const served = await c.aggregate(C, [
    { $group: { _id: null, total: { $sum: "$serve_count" } } }
  ], { db: db() });

  return {
    documents: await c.countDocuments(C, {}, { db: db() }),
    built: await c.countDocuments(C, { status: "built" }, { db: db() }),
    evicted: await c.countDocuments(C, { status: { $ne: "built" } }, { db: db() }),
    served: (served[0] && served[0].total) || 0,
    byType: byType.map(t => ({ type: t._id, n: t.n }))
  };
}
