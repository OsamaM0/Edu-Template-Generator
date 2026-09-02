/* ============================================================================
   build/answers.mjs — questions → the model-answer key
   ----------------------------------------------------------------------------
   Deliberately draws with the same stream labels and the same default counts as
   build/cards.mjs, so `type=answers&seed=7` is the answer key for the deck that
   `type=cards&seed=7` produced. Change the draw in one file and you must change
   it in the other.
   ========================================================================== */
import { sample, sampleInOrder } from "../rng.mjs";
import { interleave } from "./cards.mjs";
import {
  kindOf, answerWithLetter, answerText, difficultyLabel, cognitiveLabel,
  optionLabel, subjectLabel, accentFor, subtitleFor, studentLabel, schoolRow, examDateRow
} from "./common.mjs";

export const type = "answers";
export const template = "interactive-card-answers";
export const label = "بطاقات الإجابات النموذجية";
export const describes = "مفتاح الإجابة المطابق لبطاقات الأسئلة بنفس البذرة، مع الهدف المستهدف والمهارة والدرجة";

/**
 * Draw from the SAME named streams as the cards deck. Without this the two
 * types would seed independently and `answers&seed=7` would answer questions
 * that `cards&seed=7` never asked.
 */
export const streamNamespace = "cards";

/** Must match cards.mjs — the two sheets are two halves of one thing. */
export const defaultCounts = {
  multiple_choice: 3,
  true_false: 2,
  complete: 2,
  short_answer: 1,
  goals: 4
};

/* ------------------------------------------------------------------ mapping -- */

/** The cognitive level the lesson recorded for this question's goal. */
function skillFor(lesson, q){
  const goal = lesson.learningGoals.find(g => g.id === q.goalId);
  return cognitiveLabel(goal && goal.cognitiveLevel) || kindOf(q.kind).short;
}

function answerCard(lesson, q, i){
  const kind = kindOf(q.kind);

  const card = {
    number: i + 1,
    icon: kind.icon,
    title: kind.label,
    lead: q.question
  };

  if (q.kind === "multiple_choice"){
    // The whole option list, with the key marked — an answer sheet is read
    // beside the question sheet, so the distractors have to be visible too.
    card.bullets = q.choices.map((choice, idx) =>
      `${idx === q.answerKey ? "✓ " : ""}${optionLabel(choice, idx)}`);
    card.text = `الإجابة الصحيحة: ${answerWithLetter(q)}`;
  } else if (q.kind === "true_false"){
    card.text = `الإجابة الصحيحة: ${answerText(q)}`;
  } else {
    card.text = answerText(q) ? `الإجابة: ${answerText(q)}` : "";
  }

  if (q.targetGoal){
    card.note = { title: "الهدف المستهدف", text: q.targetGoal };
  }

  card.skill = { label: "المهارة", value: skillFor(lesson, q) };
  card.score = { label: "المستوى", value: difficultyLabel(q.difficulty) };

  return card;
}

/** The level printed on the meta bar: whichever difficulty appears most. */
function dominantDifficulty(questions){
  if (!questions.length) return "";
  const tally = new Map();
  for (const q of questions) tally.set(q.difficulty, (tally.get(q.difficulty) || 0) + 1);
  const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return difficultyLabel(best[0]);
}

/* -------------------------------------------------------------------- build -- */

export function build(lesson, ctx){
  const counts = ctx.counts;

  const picked = interleave([
    sample(lesson.questions.multipleChoice, counts.multiple_choice, ctx.stream("multiple_choice")),
    sample(lesson.questions.trueFalse,      counts.true_false,      ctx.stream("true_false")),
    sample(lesson.questions.complete,       counts.complete,        ctx.stream("complete")),
    sample(lesson.questions.shortAnswer,    counts.short_answer,    ctx.stream("short_answer"))
  ]);

  const goals = sampleInOrder(lesson.goals, counts.goals, ctx.stream("goals"));
  const cards = picked.map((q, i) => answerCard(lesson, q, i));

  const metaBar = [
    { icon: "cards",  label: "عدد البطاقات", value: `${cards.length} بطاقة` },
    { icon: "level",  label: "المستوى",      value: dominantDifficulty(picked) },
    { icon: "target", label: "الأهداف",      value: goals.length ? `${goals.length} أهداف` : "" },
    schoolRow(ctx.school),
    { icon: "id",     label: "الطالب",       value: studentLabel(ctx.student) },
    ...examDateRow(ctx.examDate),
    { icon: "clock",  label: "زمن النشاط",   value: "45 دقيقة" }
  ].filter(chip => chip.editable || chip.value !== "");

  const data = {
    meta: {
      template: "interactive-card-answers",
      age: ctx.theme,
      color: accentFor(lesson.documentIdx),
      badge: "بطاقات الإجابة النموذجية",
      subtitle: subtitleFor(lesson),
      lessonLabel: "الدرس",
      lessonTitle: lesson.title,
      pageTitle: `بطاقات الإجابة — ${lesson.title}`
    },
    subject: {
      icon: "book",
      title: subjectLabel(lesson.subject) || "الدرس",
      subtitle: lesson.title
    },
    metaBar,
    cards,
    footer: {
      items: [
        { icon: "check", text: "مفتاح الإجابة — للمعلم" },
        { icon: "leaf",  text: lesson.title }
      ]
    }
  };

  return {
    data,
    title: data.meta.pageTitle,
    questions: picked,
    used: picked.reduce((acc, q) => { acc[q.kind] = (acc[q.kind] || 0) + 1; return acc; }, {})
  };
}
