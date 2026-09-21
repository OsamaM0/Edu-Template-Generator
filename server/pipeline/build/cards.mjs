/* ============================================================================
   build/cards.mjs — questions → printable cut-out question cards
   ----------------------------------------------------------------------------
   The interactive-card template is the natural home for text questions: it has
   real option rows with radio buttons, inline blanks, and writing lines, so
   every kind maps onto it without compromise.

   The draw is a mix rather than "the first eight": the seed picks from each
   kind separately, then the kinds are interleaved so a deck never opens with
   four true/false cards in a row.
   ========================================================================== */
import { sample, sampleInOrder } from "../rng.mjs";
import { kindOf, TRUE_FALSE_CHOICES, accentFor, subtitleFor, pad2, studentRows, studentLabel,
  schoolRow, teacherRow, examDateRow } from "./common.mjs";

export const type = "cards";
export const template = "interactive-card";
export const label = "بطاقات أسئلة تفاعلية";
export const describes = "بطاقات مراجعة قابلة للقص، سؤال في كل بطاقة، تُحل على الشاشة أو بعد الطباعة";

export const defaultCounts = {
  multiple_choice: 3,
  true_false: 2,
  complete: 2,
  short_answer: 1,
  goals: 4
};

/* -------------------------------------------------------------------- card -- */

function toCard(q, i){
  const kind = kindOf(q.kind);
  const base = {
    number: pad2(i + 1),
    tag: kind.label,
    icon: kind.icon,
    question: q.question,
    // Carried through to the markup as data-qid, so a deck answered on screen
    // reports the same {question_id: answer} a worksheet does.
    questionId: q.id,
    kind: q.kind
  };

  switch (q.kind){
    case "multiple_choice":
      // The options ARE the answer control — a writing line under them is noise.
      return { ...base, options: q.choices, answerLabel: "", lines: 0 };

    case "true_false":
      return { ...base, options: TRUE_FALSE_CHOICES, answerLabel: "", lines: 0 };

    case "complete":
      // The text already carries "_____" runs; blanks() makes them typeable.
      return { ...base, answerLabel: "", lines: 0 };

    default:
      return { ...base, answerLabel: "إجابتك", lines: 2 };
  }
}

/**
 * Round-robin across the kinds so the deck alternates instead of arriving in
 * blocks. Group order is kept, so the deck opens with a multiple-choice card.
 * Kinds that run out drop off the rotation; the inputs are not mutated.
 */
export function interleave(groups){
  const queues = groups.map(g => [...g]).filter(g => g.length);
  const out = [];

  while (queues.length){
    for (const queue of queues) out.push(queue.shift());
    for (let i = queues.length - 1; i >= 0; i--) if (!queues[i].length) queues.splice(i, 1);
  }
  return out;
}

/* ------------------------------------------------------------------- build -- */

export function build(lesson, ctx){
  const counts = ctx.counts;

  const picked = interleave([
    sample(lesson.questions.multipleChoice, counts.multiple_choice, ctx.stream("multiple_choice")),
    sample(lesson.questions.trueFalse,      counts.true_false,      ctx.stream("true_false")),
    sample(lesson.questions.complete,       counts.complete,        ctx.stream("complete")),
    sample(lesson.questions.shortAnswer,    counts.short_answer,    ctx.stream("short_answer"))
  ]);

  const goals = sampleInOrder(lesson.goals, counts.goals, ctx.stream("goals"));
  const cards = picked.map(toCard);

  const data = {
    meta: {
      template: "interactive-card",
      age: ctx.theme,
      color: accentFor(lesson.documentIdx),
      badge: "بطاقات مراجعة تفاعلية",
      subtitle: subtitleFor(lesson, ctx),
      lessonLabel: "عنوان الدرس",
      lessonTitle: lesson.title,
      pageTitle: `بطاقات مراجعة — ${lesson.title}`
    },
    /* What the sheet knows is printed; the rest stays an editable line for
       somebody to fill on screen or in print. A deck issued to one student
       names them, and school / teacher follow whatever the request said. */
    identity: ctx.student ? [
      ...studentRows(ctx.student),
      schoolRow(ctx.school),
      ...(ctx.teacher ? [teacherRow(ctx.teacher)] : []),
      ...examDateRow(ctx.examDate)
    ] : [
      teacherRow(ctx.teacher),
      schoolRow(ctx.school),
      { icon: "users",  label: "الصف",             value: "", editable: true },
      ...examDateRow(ctx.examDate)
    ],
    counter: {
      label: "عدد البطاقات",
      value: String(cards.length),
      unit: cards.length === 1 ? "بطاقة" : "بطاقات",
      icon: "cards"
    },
    cards,
    footer: {
      items: [
        { icon: "star", text: studentLabel(ctx.student) || "راجع بتركيز .. وأتقن الدرس" },
        { icon: "leaf", text: lesson.title }
      ]
    }
  };

  if (goals.length){
    data.objectives = { title: "أهداف الدرس", icon: "target", items: goals };
  }

  return {
    data,
    title: data.meta.pageTitle,
    questions: picked,
    used: countByKind(picked)
  };
}

export const countByKind = list => list.reduce((acc, q) => {
  acc[q.kind] = (acc[q.kind] || 0) + 1;
  return acc;
}, {});
