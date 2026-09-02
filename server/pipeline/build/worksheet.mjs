/* ============================================================================
   build/worksheet.mjs — questions + worksheet + summary → the student worksheet
   ----------------------------------------------------------------------------
   Which section renderer each question kind gets, and why:

     complete      fill-blank   the text already carries "_____" runs, which is
                                exactly what the renderer turns into blanks
     true_false    fill-blank   statement + a single blank to write صح / خطأ in
     multiple_choice  note      one card each: question, lettered options, and a
                                line for the answer. The `choose` renderer is
                                picture-based and would print a placeholder box
                                next to every text option
     short_answer  note         question + writing lines

   The vocabulary glossary, an application task and the closing blocks come from
   the worksheets collection; the warm-up comes from the summary.
   ========================================================================== */
import { sample, sampleInOrder, pick } from "../rng.mjs";
import {
  answerParts, blankCount, difficultyLabel, optionLabel, TRUE_FALSE_CHOICES,
  infoRows, studentBar, selfAssessmentSection, signaturesSection, accentFor
} from "./common.mjs";

export const type = "worksheet";
export const template = "worksheet";
export const label = "ورقة عمل الطالب";
export const describes = "ورقة عمل مطبوعة: أسئلة مختارة بالبذرة + مفردات + تطبيق + تقويم ذاتي";

export const defaultCounts = {
  multiple_choice: 3,
  true_false: 4,
  complete: 4,
  short_answer: 2,
  goals: null,       // null = every goal; 0 would mean "none"
  vocabulary: 6
};

/* ------------------------------------------------------------------ pieces -- */

/**
 * The word bank. Long answers ("بداياتها حيث ارتبطت بصدور الصحف…") make useless
 * chips, and a bank that only covers half the blanks misleads more than it
 * helps — so a question contributes only when every one of its answers is short
 * and there is one per blank.
 */
function wordBankFor(questions){
  const bank = [];
  for (const q of questions){
    const parts = answerParts(q);
    const blanks = blankCount(q) || 1;
    if (!parts.length || parts.length !== blanks) continue;
    if (parts.some(p => p.length > 22)) continue;
    bank.push(...parts);
  }
  const unique = [...new Set(bank)];
  return unique.length >= 3 ? unique : [];
}

function completeSection(questions, rng, number){
  if (!questions.length) return null;
  const bank = wordBankFor(questions);

  return {
    type: "fill-blank",
    number,
    span: 2,
    color: "sky",
    title: "أكمل الفراغ",
    titleIcon: "puzzle",
    instruction: bank.length
      ? "أكمل العبارات التالية بالكلمة المناسبة من الصندوق."
      : "أكمل العبارات التالية بما يناسبها.",
    wordBank: bank.length ? sample(bank, 0, rng) : [],
    items: questions.map(q => ({ icon: "pencil", text: q.question, qid: q.id, kind: q.kind }))
  };
}

/**
 * True/false stays one grouped card — four of them as separate cards would eat
 * the sheet — but each statement keeps its own id, so the blank a student
 * writes صح or خطأ into is still an identified answer.
 */
function trueFalseSection(questions, number){
  if (!questions.length) return null;

  return {
    type: "fill-blank",
    number,
    span: 2,
    color: "teal",
    title: "صح أو خطأ",
    titleIcon: "clipboard-check",
    instruction: `اكتب (${TRUE_FALSE_CHOICES[0]}) أمام العبارة الصحيحة و(${TRUE_FALSE_CHOICES[1]}) أمام العبارة الخاطئة.`,
    wordBank: [],
    items: questions.map(q => ({ icon: "check", text: `${q.question}  ( ___ )`, qid: q.id, kind: q.kind }))
  };
}

/**
 * Multiple choice as a question card, not a note: the options are tickable
 * circles rather than a bulleted list to read, which is both what a printed
 * worksheet wants and what makes the choice collectable on screen.
 *
 * The submitted value is the option TEXT, not its index — the letters are
 * presentation, and an answer that reads "الجملة الاسمية" survives a re-render
 * that happens to letter the options differently.
 */
const choiceSection = (q, number) => ({
  type: "question",
  number,
  color: "blue",
  title: "اختر الإجابة الصحيحة",
  titleIcon: "list",
  instruction: `المستوى: ${difficultyLabel(q.difficulty)}`,
  questionId: q.id,
  kind: q.kind,
  text: q.question,
  options: q.choices.map((choice, i) => ({ label: optionLabel(choice, i), value: choice })),
  lines: 0
});

const shortAnswerSection = (q, number) => ({
  type: "question",
  number,
  color: "purple",
  title: "أجب بإيجاز",
  titleIcon: "notebook",
  instruction: `المستوى: ${difficultyLabel(q.difficulty)}`,
  questionId: q.id,
  kind: q.kind,
  text: q.question,
  lines: 3
});

const glossarySection = (vocabulary, number) => ({
  type: "note",
  number,
  span: 2,
  color: "orange",
  title: "المفردات الأساسية",
  titleIcon: "book",
  instruction: "راجع معاني المصطلحات قبل الإجابة.",
  items: vocabulary.map(v => (v.definition ? `${v.term}: ${v.definition}` : v.term))
});

const applicationSection = (task, number) => ({
  type: "homework",
  number,
  span: 2,
  color: "pink",
  title: "نشاط تطبيقي",
  titleIcon: "rocket",
  icon: "rocket",
  text: task,
  lines: 4
});

/* ------------------------------------------------------------------- build -- */

export function build(lesson, ctx){
  const counts = ctx.counts;

  const complete = sample(lesson.questions.complete,      counts.complete,        ctx.stream("complete"));
  const trueFalse = sample(lesson.questions.trueFalse,    counts.true_false,      ctx.stream("true_false"));
  const choices  = sample(lesson.questions.multipleChoice, counts.multiple_choice, ctx.stream("multiple_choice"));
  const shorts   = sample(lesson.questions.shortAnswer,   counts.short_answer,    ctx.stream("short_answer"));
  const vocab    = sample(lesson.worksheet.vocabulary,    counts.vocabulary,      ctx.stream("vocabulary"));
  const goals    = sampleInOrder(lesson.goals,            counts.goals,           ctx.stream("goals"));
  const task     = pick(lesson.worksheet.applications, ctx.stream("application"));

  const sections = [];
  let n = 0;
  const add = section => { if (section) sections.push(section); };

  add(completeSection(complete, ctx.stream("word-bank"), ++n));
  add(trueFalseSection(trueFalse, ++n));
  for (const q of choices) add(choiceSection(q, ++n));
  for (const q of shorts)  add(shortAnswerSection(q, ++n));
  if (vocab.length) add(glossarySection(vocab, ++n));
  if (task) add(applicationSection(task, ++n));

  add(selfAssessmentSection());
  add(signaturesSection());

  const data = {
    meta: {
      template: "worksheet",
      age: ctx.theme,
      color: accentFor(lesson.documentIdx),
      badge: "ورقة عمل",
      title: lesson.title,
      pageTitle: `ورقة عمل — ${lesson.title}`
    },
    studentBar: studentBar(ctx.student, ctx.examDate),
    info: {
      color: "yellow",
      rows: infoRows(lesson, [
        { icon: "list", label: "عدد الأنشطة", value: String(sections.length) }
      ], ctx)
    },
    sections
  };

  if (lesson.summary.opening){
    data.warmup = {
      title: "تهيئة",
      titleIcon: "bulb",
      color: "orange",
      text: lesson.summary.opening
    };
  }

  if (goals.length){
    data.objectives = {
      title: "أهداف التعلم",
      titleIcon: "target",
      color: "green",
      items: goals
    };
  }

  return {
    data,
    title: data.meta.pageTitle,
    /* The questions this sheet actually asked, in the order the sections put
       them. build/index.mjs turns them into the answer key, so the key can
       never describe a draw the sheet did not make. */
    questions: [...complete, ...trueFalse, ...choices, ...shorts],
    used: {
      multiple_choice: choices.length,
      true_false: trueFalse.length,
      complete: complete.length,
      short_answer: shorts.length,
      vocabulary: vocab.length,
      goals: goals.length
    }
  };
}
