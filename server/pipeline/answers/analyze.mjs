/* ============================================================================
   answers/analyze.mjs — graded answers → what the student actually understands
   ----------------------------------------------------------------------------
   A score out of ten tells a teacher nothing they can act on. A lesson has
   goals; every question was written to test one of them; so the useful unit of
   analysis is the goal, not the sheet:

     goal_3 · 2 من 3 صحيحة · 67% · يحتاج مراجعة
              "راجع أمثلة إضافية على: يميّز بين الجملة الاسمية والفعلية"

   Two decisions worth knowing about:

   · UNANSWERED COUNTS AS WRONG in the percentage. A goal is either
     demonstrated or it is not, and a blank demonstrates nothing — but the
     unanswered tally is reported separately so a teacher can tell "got it
     wrong" from "ran out of time".

   · GOALS WITH NO QUESTIONS ARE STILL LISTED, at percentage null. If lesson 5
     has five goals and the sheet only reached four of them, the report has to
     say which one went untested rather than quietly showing a four-goal lesson.

   NOT EVERY SHEET IS READ THIS WAY. A survey — learning-pattern — has no right
   answers to be correct about, so it is scored as a profile instead: points per
   learning style, and the dominant one. analyze() dispatches on the
   assignment's `scoring` field; the other half lives in profile.mjs and returns
   the same top-level shape, so the report page and the dashboard read either
   without knowing which they were handed.
   ========================================================================== */

/* profile.mjs imports arabicCount from here, so these two modules form a cycle.
   Both sides only reach across inside function bodies and both exports are
   hoisted function declarations, so neither is ever read before it exists. */
import { analyzeProfile } from "./profile.mjs";

/* ------------------------------------------------------------------ bands -- */

/**
 * The mastery bands. Ordered high to low; the first `min` a percentage clears
 * is the band. The wording is what appears on the student's report, so it is
 * addressed to the student — "أتقنت", not "the student has mastered".
 */
export const BANDS = [
  { level: "mastered",   label: "متقن",          min: 90, color: "#1f9d61",
    verdict: "أتقنت هذا الهدف تماماً",
    /* `verdict` opens the sentence and is where the goal gets NAMED — advice
       that says "راجع الدرس" is something nobody can act on, and one that says
       "راجع «تمييز الجملة الاسمية من الفعلية»" is a task. `%s` in the advice is
       the back-reference to it, so the goal is not repeated twice in one line. */
    advice: "انتقل إلى تطبيقات أعمق على %s، وساعد زملاءك في شرحه." },
  { level: "proficient", label: "جيد جداً",       min: 75, color: "#4ba36a",
    verdict: "فهمك لهذا الهدف جيد جداً",
    advice: "راجع الأسئلة التي أخطأت فيها في %s فقط، وستصل إلى الإتقان الكامل." },
  { level: "developing", label: "مقبول",          min: 60, color: "#d8a11e",
    verdict: "فهمك لهذا الهدف في طريقه إلى الاكتمال",
    advice: "أعد قراءة الجزء الخاص بـ%s في الدرس، وحلّ تمرينين إضافيين عليه." },
  { level: "weak",       label: "يحتاج دعم",      min: 40, color: "#e07b39",
    verdict: "ما زلت تحتاج إلى دراسة هذا الهدف",
    advice: "ادرس %s من جديد مع معلمك، ثم أعد حل أسئلته كاملة." },
  { level: "not-met",    label: "لم يتحقق",       min: 0,  color: "#d9534f",
    verdict: "لم تتحقق من هذا الهدف بعد",
    advice: "ابدأ %s من الأساس: اقرأ الشرح، اطلب مثالاً من معلمك، ثم تدرّب عليه." }
];

/** The band a percentage falls in. A goal with no questions has no band. */
export const bandFor = percentage => {
  if (percentage == null) return null;
  return BANDS.find(b => percentage >= b.min) || BANDS[BANDS.length - 1];
};

const pct = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null);

/* ------------------------------------------------------------- per goal -- */

/**
 * The per-goal roll-up.
 *
 * @param {Array}  graded  rows from grade.gradeAll().questions
 * @param {Array}  goals   the lesson's goals (build/common lessonGoals)
 * @returns {object} goal_id → { percentage, correct, wrong, total, … }
 */
export function byGoal(graded, goals){
  const out = {};

  /* Seed from the lesson's own goal list first, so an untested goal is present
     with total 0 rather than missing. Order follows the lesson, not the sheet. */
  for (const g of goals || []){
    out[g.id] = {
      goal_id: g.id,
      goal_text: g.text || "",
      cognitive_level: g.cognitiveLevel || "",
      priority: g.priority || 1,
      total: 0, correct: 0, wrong: 0, unanswered: 0, needs_review: 0,
      percentage: null,
      score: 0,
      question_ids: []
    };
  }

  for (const q of graded){
    const id = q.goal_id || "unassigned";
    if (!out[id]){
      out[id] = {
        goal_id: id,
        goal_text: q.goal_text || "",
        cognitive_level: "",
        priority: 1,
        total: 0, correct: 0, wrong: 0, unanswered: 0, needs_review: 0,
        percentage: null,
        score: 0,
        question_ids: []
      };
    }
    const g = out[id];
    if (!g.goal_text && q.goal_text) g.goal_text = q.goal_text;

    g.total++;
    g.question_ids.push(q.question_id);
    g.score += q.score || 0;
    if (q.needs_review) g.needs_review++;

    if (!q.answered) g.unanswered++;
    if (q.correct) g.correct++;
    else g.wrong++;              // an unanswered question is also a wrong one
  }

  for (const g of Object.values(out)){
    g.percentage = pct(g.correct, g.total);
    // The partial-credit view: blanks half-filled, short answers half-right.
    g.score_percentage = pct(g.score, g.total);
    g.score = Number(g.score.toFixed(2));

    const band = bandFor(g.percentage);
    g.mastery = band ? band.level : "untested";
    g.mastery_label = band ? band.label : "لم يُختبر";
    g.color = band ? band.color : "#8fa6bd";
    g.recommendation = recommend(g, band);
  }

  return out;
}

/**
 * The sentence a student is meant to read and act on.
 * It names the goal, because "you scored 40%" is not actionable and
 * "you still need to work on telling nominal from verbal sentences" is.
 */
export function recommend(goal, band){
  const named = goal.goal_text ? `«${goal.goal_text}»` : "هذا الهدف";

  if (!band){
    return `لم تتضمن الورقة أسئلة على ${named} — اطلب من معلمك تمريناً عليه للتأكد من إتقانه.`;
  }

  // The goal is named in the opening clause, so a list of recommendations is
  // readable top to bottom without having to reach the end of each sentence.
  const head = `${band.verdict.replace("هذا الهدف", named)} (${goal.correct} من ${goal.total} — ${goal.percentage}%).`;
  const body = band.advice.replace("%s", "هذا الهدف");
  const review = goal.needs_review
    ? ` ${arabicCount(goal.needs_review, "إجابة واحدة", "إجابتان", "إجابات")} تحتاج مراجعة المعلم لأنها مفتوحة.`
    : "";

  return `${head} ${body}${review}`;
}

/**
 * Arabic counts one, two, and many differently, and a report that says
 * "1 سؤالاً" reads like a machine wrote it. The caller supplies all three forms
 * already inflected — gender travels with the noun, and guessing it here would
 * get half of them wrong.
 *
 *   arabicCount(1, "سؤالاً واحداً", "سؤالين", "أسئلة")  →  "سؤالاً واحداً"
 *   arabicCount(4, …)                                   →  "4 أسئلة"
 *   arabicCount(17, …)                                  →  "17 سؤالاً"
 */
export function arabicCount(n, one, two, few){
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${n} ${few}`;
  // Above ten the counted noun goes back to the singular in Arabic.
  return `${n} ${one.split(/\s+/)[0]}`;
}

/* --------------------------------------------------------------- overall -- */

export function overall(graded){
  const total = graded.length;
  const correct = graded.filter(q => q.correct).length;
  const unanswered = graded.filter(q => !q.answered).length;
  const score = graded.reduce((sum, q) => sum + (q.score || 0), 0);
  const percentage = pct(correct, total);
  const band = bandFor(percentage);

  return {
    total,
    correct,
    wrong: total - correct,
    unanswered,
    needs_review: graded.filter(q => q.needs_review).length,
    percentage,
    score: Number(score.toFixed(2)),
    score_percentage: pct(score, total),
    mastery: band ? band.level : "untested",
    mastery_label: band ? band.label : "لم يُختبر"
  };
}

/* ---------------------------------------------------------------- report -- */

/** Goals ordered the way a teacher reads them: weakest first, untested last. */
const weakestFirst = goals => [...goals].sort((a, b) => {
  if (a.total === 0 && b.total !== 0) return 1;
  if (b.total === 0 && a.total !== 0) return -1;
  return (a.percentage ?? 101) - (b.percentage ?? 101);
});

/**
 * The written report: what went well, what did not, and what to do next.
 * Assembled from the same numbers the JSON carries — the prose never says
 * anything the data does not.
 */
export function writeReport(summary, goalMap, student){
  const goals = Object.values(goalMap);
  const tested = goals.filter(g => g.total > 0);
  const untested = goals.filter(g => g.total === 0);

  const strong = tested.filter(g => g.percentage >= 75);
  const weak = weakestFirst(tested.filter(g => g.percentage < 60));
  const middling = tested.filter(g => g.percentage >= 60 && g.percentage < 75);

  const who = (student && student.name) ? student.name : "الطالب";
  const band = bandFor(summary.percentage);

  const headline = summary.total === 0
    ? `لم تُسجَّل أي إجابات لـ${who}.`
    : `${who}: ${summary.correct} إجابة صحيحة من ${summary.total} — ${summary.percentage}% (${summary.mastery_label}).`;

  const lines = [headline];

  if (summary.total > 0){
    lines.push(
      strong.length
        ? `أتقن ${strong.length} من ${tested.length} أهداف: ${strong.map(g => g.goal_text || g.goal_id).join("، ")}.`
        : `لم يصل أي هدف إلى مستوى الإتقان في هذه الورقة.`
    );

    if (weak.length){
      lines.push(`يحتاج إلى دراسة إضافية في: ${weak.map(g => g.goal_text || g.goal_id).join("، ")}.`);
    }
    if (middling.length){
      lines.push(`قريب من الإتقان في: ${middling.map(g => g.goal_text || g.goal_id).join("، ")} — مراجعة قصيرة تكفي.`);
    }
    if (summary.unanswered){
      lines.push(`ترك ${arabicCount(summary.unanswered, "سؤالاً واحداً", "سؤالين", "أسئلة")} دون إجابة؛ تأكد من أن السبب ليس ضيق الوقت.`);
    }
    if (summary.needs_review){
      lines.push(`${arabicCount(summary.needs_review, "إجابة واحدة", "إجابتان", "إجابات")} مفتوحة صُحّحت آلياً وتحتاج نظرة من المعلم.`);
    }
    if (untested.length){
      lines.push(`لم تختبر هذه الورقة ${untested.length} من أهداف الدرس: ${untested.map(g => g.goal_text || g.goal_id).join("، ")}.`);
    }
  }

  return {
    headline,
    verdict: band ? band.verdict : "لم يُختبر",
    mastery: summary.mastery,
    summary: lines.join(" "),
    lines,
    strengths: strong.map(g => ({ goal_id: g.goal_id, goal_text: g.goal_text, percentage: g.percentage })),
    needs_work: weak.map(g => ({
      goal_id: g.goal_id, goal_text: g.goal_text, percentage: g.percentage,
      recommendation: g.recommendation
    })),
    untested: untested.map(g => ({ goal_id: g.goal_id, goal_text: g.goal_text })),
    // The action list, weakest goal first — this is the part a teacher hands over.
    next_steps: weakestFirst(tested).slice(0, 5).map(g => g.recommendation)
  };
}

/* ----------------------------------------------------------------- whole -- */

/**
 * The complete analysis for one submission.
 *
 * @param {object} input
 *   assignment   the issued-sheet record
 *   graded       grade.gradeAll() output
 *   goals        the lesson's goals
 *   answers      exactly what the student sent, {question_id: answer}
 * @returns {object} the JSON that is saved, printed and posted to the backend
 */
export function analyze({ assignment, graded, goals, answers, submittedAt }){
  /* A survey is scored, not marked. The builder said so when the document was
     built (build/index.mjs `scoring`), and the assignment carries the
     instrument it was printed from. */
  if (assignment.scoring === "profile"){
    return analyzeProfile({ assignment, graded, answers, submittedAt });
  }

  const questions = graded.questions;
  const summary = overall(questions);
  const goalMap = byGoal(questions, goals);

  return {
    schema: "pipeline.analysis/1",
    scoring: "mastery",
    assignment_id: assignment.id,
    document_idx: assignment.documentIdx,
    lesson_title: assignment.lessonTitle,
    type: assignment.type,
    seed: assignment.seed,
    student: assignment.student,
    /* The sitting this sheet belonged to, copied onto the analysis rather than
       joined back to the record: a saved result is read on its own — printed,
       filed, sent to the partner platform — and it should say which school and
       which teacher it came from without a lookup. */
    school: assignment.school || null,
    teacher: assignment.teacher || null,
    exam_date: assignment.examDate || null,
    /* Carried into the saved result, not only into the assignment record: the
       group roll-up reads results, and a result that did not know which class
       it belonged to would have to be joined back to its record to find out. */
    group: assignment.group || null,
    group_id: assignment.groupId || "",
    submitted_at: submittedAt,
    issued_at: assignment.createdAt,

    /* Exactly what arrived, untouched — the record of what the student said is
       separate from our reading of it, and a re-grade must be able to start
       from the original. */
    answers,

    overall: summary,
    goals: goalMap,
    questions,
    report: writeReport(summary, goalMap, assignment.student),
    unmatched_answers: graded.extra
  };
}
