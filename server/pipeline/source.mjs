/* ============================================================================
   source.mjs — one document_idx in, one normalized lesson out
   ----------------------------------------------------------------------------
   The three collections hold three halves of the same lesson:

     questions   questions.{multiple_choice, short_answer, complete, true_false}
                 plus learning_goals and the per-goal grouping
     worksheets  worksheet.{goals, applications, vocabulary, teacher_guidelines,
                 structured_goals, goal_based_activities}
     summaries   summary.{opening, summary, ending}

   Builders should never have to know that, or to guard every field access, so
   this module reads all three in parallel and returns a predictable shape:
   arrays are always arrays, strings are always strings, missing is empty.

   A lesson is memoized briefly (EDU_PIPELINE_DOC_TTL_MIN): a page is usually
   built once and then served from the page cache, but a burst of first-time
   requests for the same lesson should still hit the database once.

   READ ONLY, AND ON PURPOSE. These three collections are the generator's
   output, not ours. Nothing in this file writes, and the deployment's Mongo
   user should hold `read` on this database and `readWrite` only on the one
   server/store owns. A bug here cannot damage the lessons.

   The connection itself belongs to server/store — one socket, two databases —
   so reading a lesson and recording a result do not each open their own.
   ========================================================================== */
import config, { configProblems } from "./config.mjs";
import { subjectLabel, subjectFromDocuments } from "./subject.mjs";
import { mongo as sharedClient, settings as storeSettings } from "../store/index.mjs";

/* --------------------------------------------------------------- the client -- */

/**
 * The shared connection, opened on first use so an unreachable database cannot
 * stop the server booting.
 *
 * Owned by server/store rather than by this file: the same socket carries the
 * lesson reads below and the result writes over in the other database, and two
 * clients to one server would be two authentications and two idle sockets for
 * no benefit.
 */
export function mongo(){
  // No committed fallback to hide behind: say which variable is missing.
  const { errors } = configProblems();
  if (errors.length){
    throw Object.assign(new Error(errors[0]), { status: 503, code: "not-configured" });
  }
  return sharedClient();
}

export async function ping(){
  return mongo().ping();
}

export { close as closeMongo } from "../store/index.mjs";

/* -------------------------------------------------------------- normalizing -- */

const str = v => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const arr = v => (Array.isArray(v) ? v.filter(x => x != null) : []);
const strings = v => arr(v).map(str).filter(Boolean);
const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };

/**
 * The short prefix a generated question id carries, so an id says which kind it
 * belongs to at a glance: "mc_3", "tf_1".
 */
const KIND_PREFIX = {
  multiple_choice: "mc", true_false: "tf", complete: "cp", short_answer: "sa"
};

/** Question objects arrive with a few field spellings; settle on one. */
function normQuestion(q, kind, index){
  if (!q || typeof q !== "object") return null;
  const text = str(q.question || q.text || q.prompt);
  if (!text) return null;

  return {
    /* The identity a submitted answer is filed under. Stored ids win so a
       lesson that already numbers its questions keeps that numbering; the
       fallback is derived from kind + position, which is stable for as long as
       the lesson document is, and that is what makes {question_id: answer}
       meaningful after the page has been rebuilt. */
    id: str(q.id || q.question_id || q.questionId || q.qid) || `${KIND_PREFIX[kind] || "q"}_${index + 1}`,
    kind,
    index,
    question: text,
    choices: strings(q.choices || q.options),
    answerKey: int(q.answer_key != null ? q.answer_key : q.answerKey),
    answer: str(q.answer || q.model_answer),
    difficulty: int(q.difficulty) || 1,
    goalId: str(q.goal_id || q.goalId),
    targetGoal: str(q.target_goal || q.targetGoal)
  };
}

/**
 * A kind's questions, with ids guaranteed distinct. A lesson that supplies its
 * own ids may repeat one; two questions sharing an id would silently collapse
 * into a single answer slot, so a repeat is suffixed rather than trusted.
 */
function normList(list, kind, seen){
  const out = [];
  for (const [i, raw] of arr(list).entries()){
    const q = normQuestion(raw, kind, i);
    if (!q) continue;
    if (seen.has(q.id)){
      let n = 2;
      while (seen.has(`${q.id}_${n}`)) n++;
      q.id = `${q.id}_${n}`;
    }
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

function normVocabulary(list){
  return arr(list).map(v => {
    if (typeof v === "string") return { term: str(v), definition: "" };
    return { term: str(v.term || v.word), definition: str(v.definition || v.meaning) };
  }).filter(v => v.term);
}

function normStructuredGoals(list){
  return arr(list).map((g, i) => ({
    id: str(g.id) || String(i + 1),
    text: str(g.text || g.goal),
    priority: int(g.priority) || 1,
    activities: strings(g.activities),
    assessmentMethods: strings(g.assessment_methods || g.assessmentMethods)
  })).filter(g => g.text);
}

function normLearningGoals(list){
  return arr(list).map((g, i) => ({
    id: str(g.id) || `goal_${i + 1}`,
    text: str(g.text),
    priority: int(g.priority) || 1,
    cognitiveLevel: str(g.cognitive_level || g.cognitiveLevel)
  })).filter(g => g.text);
}

/* ------------------------------------------------------------------- lookup -- */

/**
 * document_idx is stored as a string ("43617"), but callers pass whatever the
 * URL gave them. Match either representation rather than making that the
 * caller's problem.
 */
function idxFilter(documentIdx){
  const s = String(documentIdx).trim();
  const n = Number(s);
  const values = Number.isFinite(n) && s !== "" ? [s, n] : [s];
  return { document_idx: { $in: values } };
}

/* -------------------------------------------------------------------- cache -- */

const memo = new Map();   // documentIdx -> { at, lesson }

function memoGet(key){
  const hit = memo.get(key);
  if (!hit) return null;
  if (config.docTtlMs > 0 && Date.now() - hit.at > config.docTtlMs){
    memo.delete(key);
    return null;
  }
  return hit.lesson;
}

function memoSet(key, lesson){
  if (memo.size > 200) memo.delete(memo.keys().next().value);
  memo.set(key, { at: Date.now(), lesson });
}

export const clearLessonCache = () => memo.clear();

/* -------------------------------------------------------------------- fetch -- */

/**
 * Read a lesson. Missing collections are not an error on their own — a lesson
 * with questions but no worksheet still makes a perfectly good card deck — so
 * `found` reports what was actually there and the builder decides.
 *
 * @param {string|number} documentIdx
 * @param {{fresh?:boolean}} opts  fresh skips the memo, not the source order
 */
export async function loadLesson(documentIdx, opts = {}){
  const key = String(documentIdx).trim();
  if (!key) throw Object.assign(new Error("document_idx is required."), { status: 400, code: "missing-document-idx" });

  if (!opts.fresh){
    const hit = memoGet(key);
    if (hit) return hit;
  }

  const lesson = await loadFromMongo(key);
  memoSet(key, lesson);
  return lesson;
}

/** The lesson as the three collections hold it. */
async function loadFromMongo(key){
  const db = storeSettings.lessonDb || config.db;
  const filter = idxFilter(key);
  const c = mongo();

  const [questionsDoc, worksheetDoc, summaryDoc] = await Promise.all([
    c.findOne(config.collections.questions,  filter, { db }),
    c.findOne(config.collections.worksheets, filter, { db }),
    c.findOne(config.collections.summaries,  filter, { db })
  ]);

  if (!questionsDoc && !worksheetDoc && !summaryDoc){
    throw Object.assign(
      new Error(`No lesson found for document_idx "${key}".`),
      { status: 404, code: "lesson-not-found" }
    );
  }

  const anyDoc = questionsDoc || worksheetDoc || summaryDoc;
  const q = (questionsDoc && questionsDoc.questions) || {};
  const w = (worksheetDoc && worksheetDoc.worksheet) || {};
  const s = (summaryDoc && summaryDoc.summary) || {};

  // Goals appear in three places with the same content; prefer the richest.
  const goals = strings(w.goals).length ? strings(w.goals)
    : strings(anyDoc.goals).length ? strings(anyDoc.goals)
    : normLearningGoals(q.learning_goals).map(g => g.text);

  // One set across all four kinds: ids identify a question within the lesson,
  // not within its kind, because that is the scope a submitted answer uses.
  const seenIds = new Set();

  const title = str(anyDoc.filename) || `درس ${key}`;
  const subject = subjectFromDocuments([questionsDoc, worksheetDoc, summaryDoc], title);

  const lesson = {
    documentIdx: str(anyDoc.document_idx) || key,
    documentUuid: str(anyDoc.document_uuid),
    customId: str(anyDoc.custom_id),
    title,
    generatedAt: str(anyDoc.generated_at),

    goals,
    learningGoals: normLearningGoals(q.learning_goals),

    questions: {
      multipleChoice: normList(q.multiple_choice, "multiple_choice", seenIds),
      trueFalse:      normList(q.true_false,      "true_false",      seenIds),
      complete:       normList(q.complete,        "complete",        seenIds),
      shortAnswer:    normList(q.short_answer,    "short_answer",    seenIds)
    },

    worksheet: {
      applications:      strings(w.applications),
      vocabulary:        normVocabulary(w.vocabulary),
      teacherGuidelines: strings(w.teacher_guidelines),
      structuredGoals:   normStructuredGoals(w.structured_goals),
      goalActivities:    (w.goal_based_activities && typeof w.goal_based_activities === "object")
        ? Object.fromEntries(Object.entries(w.goal_based_activities).map(([k, v]) => [k, strings(v)]))
        : {}
    },

    summary: {
      opening: str(s.opening),
      body: str(s.summary),
      ending: str(s.ending)
    },

    /* What the documents call it, and what a sheet prints for it. Both, because
       the raw value is what /api/pipeline/lesson/:idx is for — seeing why a sheet
       says what it says without opening the database. */
    subject,
    subjectName: subjectLabel(subject),
    keyTopics: strings((q._metadata && q._metadata.content_analysis && q._metadata.content_analysis.key_topics) ||
                       (w._metadata && w._metadata.content_analysis && w._metadata.content_analysis.key_topics)),

    found: {
      questions: !!questionsDoc,
      worksheet: !!worksheetDoc,
      summary:   !!summaryDoc
    }
  };

  lesson.questionCount =
    lesson.questions.multipleChoice.length + lesson.questions.trueFalse.length +
    lesson.questions.complete.length + lesson.questions.shortAnswer.length;

  return lesson;
}
