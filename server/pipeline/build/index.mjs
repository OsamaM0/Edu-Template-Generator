/* ============================================================================
   build/index.mjs — the document-type registry
   ----------------------------------------------------------------------------
   One `type` value in, one core-template payload out. Adding a type is the same
   shape as adding a template to the engine:

     1. create build/my-type.mjs exporting
          type           "my-type"                  the API value
          template       "worksheet"                which core template renders it
          label          Arabic name for /api/pipeline/types
          describes      one line, also for /types
          defaultCounts  { <what it draws>: n }     null = take everything, 0 = none
          build          (lesson, ctx) => { data, title, used }
     2. import it below and add it to MODULES.

   ctx.stream(label) hands the builder a generator seeded by BOTH the request
   seed and the label, so `seed=7` draws the same true/false questions no matter
   how many multiple-choice questions were drawn first. Without that, adding one
   card to a deck would silently reshuffle every later draw.
   ========================================================================== */
import * as worksheet from "./worksheet.mjs";
import * as cards     from "./cards.mjs";
import * as answers   from "./answers.mjs";
import * as lesson    from "./lesson.mjs";
import * as golden    from "./golden.mjs";
import * as summary   from "./summary.mjs";
import * as styles    from "./learning-pattern.mjs";

import { streamFor, seedFrom } from "../rng.mjs";
import { normalizeColor, PALETTE_NAMES, normalizeStudent, normalizeSchool, normalizeTeacher,
  normalizeSubjectParam, normalizeExamDate, answerKeyFor, lessonGoals } from "./common.mjs";

const MODULES = [worksheet, cards, answers, lesson, golden, summary, styles];

const REGISTRY = Object.fromEntries(MODULES.map(m => [m.type, m]));

/** Spellings a caller may reasonably send for the same document type. */
const ALIASES = {
  "worksheet": "worksheet", "sheet": "worksheet", "work-sheet": "worksheet",
  "student-worksheet": "worksheet", "exercise": "worksheet",

  "cards": "cards", "card": "cards", "questions": "cards", "question": "cards",
  "question-cards": "cards", "review-cards": "cards", "interactive-card": "cards",
  "interactive-cards": "cards", "quiz": "cards",

  "answers": "answers", "answer": "answers", "answer-key": "answers",
  "answer-cards": "answers", "interactive-card-answers": "answers", "key": "answers",

  "lesson-plan": "lesson-plan", "lesson": "lesson-plan", "plan": "lesson-plan",
  "differentiated-lesson": "lesson-plan", "differentiated": "lesson-plan",
  "diff-lesson": "lesson-plan", "lessonplan": "lesson-plan",

  "golden-minutes": "golden-minutes", "golden": "golden-minutes",
  "golden-card": "golden-minutes", "minutes": "golden-minutes",
  "golden-minute": "golden-minutes", "minutes-card": "golden-minutes",

  "summary": "summary", "lesson-summary": "summary", "recap": "summary",
  "revision": "summary", "summaries": "summary",

  "learning-pattern": "learning-pattern", "learning-patterns": "learning-pattern",
  "learning-style": "learning-pattern", "learning-styles": "learning-pattern",
  "style-survey": "learning-pattern", "styles-survey": "learning-pattern",
  "vark": "learning-pattern", "survey": "learning-pattern"
};

export const normType = t =>
  ALIASES[String(t || "").toLowerCase().trim().replace(/[_\s]+/g, "-")] || null;

export const knownTypes = () => Object.keys(REGISTRY);

export const typeDocs = () => MODULES.map(m => ({
  type: m.type,
  template: m.template,
  label: m.label,
  describes: m.describes,
  counts: m.defaultCounts || {},
  aliases: Object.entries(ALIASES).filter(([a, t]) => t === m.type && a !== m.type).map(([a]) => a)
}));

/* ------------------------------------------------------------------ counts -- */

/**
 * Merge caller-supplied counts over the type's defaults. Unknown keys are
 * dropped rather than passed through: a typo like `mcq=5` should not look as
 * if it worked.
 *
 * null / undefined / "" mean "not specified", NOT zero. That distinction is
 * load-bearing: a default of `null` means "take everything" (see rng.sample),
 * and the resolved counts are stored in the cache sidecar and fed back through
 * here whenever a page is rebuilt from its key — an answer sheet, ?embed=1,
 * /data/<key>. Reading a stored `goals: null` as `Number(null) === 0` would
 * silently turn "every goal" into "no goals" on the second render, and the
 * rebuilt sheet would quietly differ from the one that was cached.
 */
export function resolveCounts(builder, requested){
  const defaults = builder.defaultCounts || {};
  const out = { ...defaults };
  const ignored = [];

  for (const [key, value] of Object.entries(requested || {})){
    const name = String(key).toLowerCase().replace(/[-\s]+/g, "_");
    if (!(name in defaults)){ ignored.push(key); continue; }
    if (value == null || value === "") continue;      // absent, so the default stands
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    out[name] = Math.min(Math.trunc(n), 100);
  }

  return { counts: out, ignored };
}

/* ------------------------------------------------------------------- build -- */

/**
 * @param {object} lesson    from source.loadLesson()
 * @param {{type:string, seed?:any, counts?:object, theme?:string}} request
 * @returns {{data, title, type, template, seed, counts, used, warnings}}
 */
export function buildDocument(lesson, request){
  const type = normType(request.type);
  if (!type){
    throw Object.assign(
      new Error(`Unknown document type "${request.type}". Known: ${knownTypes().join(", ")}.`),
      { status: 400, code: "unknown-type" }
    );
  }

  const builder = REGISTRY[type];
  const seed = seedFrom(request.seed);
  const { counts, ignored } = resolveCounts(builder, request.counts);

  // Types that must draw identically share a namespace (answers ← cards).
  const namespace = builder.streamNamespace || type;

  const ctx = {
    seed,
    counts,
    theme: request.theme || "pro",
    // Who the sheet is for, or null for a blank classroom copy. Every builder
    // reads the same object, which is what makes student_id behave the same way
    // on every document type.
    student: normalizeStudent(request.student),
    // Who the sheet is issued under. Both are printed where the template
    // already had a blank line for them, so naming them fills the header
    // instead of leaving it to be written in by hand.
    school: normalizeSchool(request.school),
    teacher: normalizeTeacher(request.teacher),
    // The subject, from the request and from nowhere else. It fills the المادة
    // line every template carries; unnamed, that line stays blank and editable
    // rather than falling back to a value guessed out of the lesson documents
    // (see build/common.subjectRow).
    subject: normalizeSubjectParam(request.subject),
    // The day the sheet is sat, or null. Every builder fills its own date
    // field from this one object, so exam_date reads the same on a worksheet,
    // a card deck, a golden-minutes card and a survey.
    examDate: normalizeExamDate(request.examDate),
    // Label the stream so each draw is independent of the ones before it.
    stream: label => streamFor(seed, `${namespace}:${label}`)
  };

  const out = builder.build(lesson, ctx);
  const warnings = [];

  // The main color: the caller's choice wins over the lesson's stable accent.
  const color = normalizeColor(request.color);
  if (color) out.data.meta.color = color;
  else if (request.color) {
    warnings.push(`Ignored color "${request.color}". Use a palette name (${PALETTE_NAMES.join(", ")}) or a hex value like #177a6c.`);
  }

  if (ignored.length){
    warnings.push(`Ignored unknown count(s): ${ignored.join(", ")}. This type accepts: ${Object.keys(builder.defaultCounts || {}).join(", ") || "none"}.`);
  }
  if (!lesson.found.questions && ["worksheet", "cards", "answers"].includes(type)){
    warnings.push(`No "${lesson.documentIdx}" row in the questions collection — the sheet was built without questions.`);
  }
  if (!lesson.found.worksheet && ["lesson-plan", "worksheet"].includes(type)){
    warnings.push(`No "${lesson.documentIdx}" row in the worksheets collection — goals, applications and vocabulary are missing.`);
  }
  if (!lesson.found.summary && ["summary", "golden-minutes"].includes(type)){
    warnings.push(`No "${lesson.documentIdx}" row in the summaries collection — the sheet was built without the summary text.`);
  }

  /* The key for THIS draw. Built from the questions the builder says it used,
     so it cannot drift from the sheet; empty for types that ask nothing
     (a lesson plan, a golden-minutes card), which is why answerable is a
     property of the built document rather than of the request.

     A builder may hand back a key of its own instead. learning-pattern does:
     its statements have no model answer and no lesson goal, so the generic
     derivation has nothing to work from — but it is still an answerable sheet,
     and issuing, submitting, grading and reporting are the same for it as for
     every other type. See build/learning-pattern.mjs. */
  const answerKey = out.answerKey || answerKeyFor(lesson, out.questions || []);

  /* How that key is read when a submission arrives. "mastery" is correct or
     wrong against the lesson's goals; "profile" is points on a scale summed
     per style. The builder decides; answers/analyze.mjs dispatches on it. */
  const scoring = builder.scoring || "mastery";

  if (ctx.student) out.data.meta.student = ctx.student;

  /* Echoed onto the payload for the same reason the student is: /data/<key>
     and everything downstream should be able to read who the sheet was issued
     under without parsing it back out of the header row it was printed into. */
  if (ctx.school) out.data.meta.school = ctx.school;
  if (ctx.teacher) out.data.meta.teacher = ctx.teacher;

  /* Same reason again: the subject was printed into the المادة row, and
     /data/<key> should read back what it said without parsing that row. */
  if (ctx.subject) out.data.meta.subject = ctx.subject;

  /* The date the page was stamped with, echoed onto the payload so /data/<key>
     and every consumer downstream can read it back without re-parsing the row
     it was printed into. */
  if (ctx.examDate) out.data.meta.examDate = ctx.examDate;

  return {
    data: out.data,
    title: out.title,
    type,
    template: builder.template,
    seed,
    counts,
    color: out.data.meta.color,
    used: out.used || {},
    student: ctx.student,
    school: ctx.school,
    teacher: ctx.teacher,
    subject: ctx.subject,
    examDate: ctx.examDate,
    answerKey,
    scoring,
    /* What a "profile" score means: the scale, the styles and the advice each
       one carries. null for every mastery type. Stored with the assignment so
       a sheet is always read against the instrument it was printed from. */
    profile: out.profile || null,
    // A survey's goals are its styles, so the builder names them; everything
    // else takes the lesson's own.
    goals: out.goals || lessonGoals(lesson),
    answerable: answerKey.length > 0,
    warnings
  };
}
