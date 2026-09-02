/* ============================================================================
   build/learning-pattern.mjs — the learning-styles questionnaire
   ----------------------------------------------------------------------------
   A one-page VARK survey. Unlike the other builders the CONTENT is fixed — the
   statements, the scale, the four styles and their advice are a standard
   instrument, not something to generate from a lesson. The instrument ships as
   data/lessons/learning-pattern-survey.json (also the bundled static demo), and
   this builder is what stamps a copy of it for one lesson and one student:

     · the accent color        the lesson's stable accent, like every type
     · the student row         pre-filled when the request names a student
     · the statement count     count.questions draws N statements PER STYLE,
                               so no style can vanish from its own survey

   IT IS AN ANSWERABLE TYPE, like a worksheet or a card deck. Every statement
   is a question with an id, and the built document carries an answer key, so
   `student_id` issues a link, the student ticks the sheet, and submitting it
   is graded, saved, reported and delivered by exactly the same machinery.

   What differs is the SHAPE of the marking, and that is one field:

     scoring = "profile"

   A statement has no right answer. It has a point on a scale, and that point
   feeds the style the statement belongs to. So instead of a mastery key the
   document carries a PROFILE: the scale, the styles, and the advice each style
   comes with. answers/profile.mjs is what reads it — see analyze().

   The advice text (`verdict`, and each style's description and tips) is
   deliberately NOT sent to the browser. It is the reading of the answers, and
   the sheet is the question half; it travels with the assignment record and
   surfaces in the report the student is shown after submitting.
   ========================================================================== */
import { readFile } from "node:fs/promises";
import { sampleInOrder } from "../rng.mjs";
import { accentFor, studentLabel, schoolRow, teacherRow, examDateLabel } from "./common.mjs";

const BASE = JSON.parse(await readFile(
  new URL("../../../data/lessons/learning-pattern-survey.json", import.meta.url), "utf8"
));

export const type = "learning-pattern";
export const template = "learning-pattern";
export const label = "استبيان أنماط التعلم";
export const describes = "استبيان تحديد أنماط التعلم: بصري، سماعي، حركي، قراءة/كتابة — يُحلّ ويُسلَّم مثل أي ورقة";

/**
 * How a submission of this type is read.
 *   "mastery"  correct / wrong against a lesson's goals   (every other type)
 *   "profile"  points on a scale, summed per learning style
 */
export const scoring = "profile";

/** Statements drawn per style. null = the whole instrument, unshuffled. */
export const defaultCounts = { questions: null };

/** Where a style's score is filed, so the per-goal roll-up reads as per-style. */
export const goalIdFor = key => `style:${key}`;

export function build(lesson, ctx){
  const data = structuredClone(BASE);

  data.meta.age = ctx.theme;
  data.meta.color = accentFor(lesson.documentIdx);

  // A trimmed survey keeps the same NUMBER of statements for every style —
  // the verdict compares scores across styles, and unequal ceilings would tilt
  // it — and each style draws from its own stream, so asking for fewer visual
  // statements cannot reshuffle the auditory ones.
  const perStyle = ctx.counts.questions;
  if (perStyle != null){
    const keep = new Set();
    for (const s of data.styles){
      const pool = data.questions.filter(q => q.style === s.key);
      sampleInOrder(pool, perStyle, ctx.stream(`statements:${s.key}`)).forEach(q => keep.add(q));
    }
    data.questions = data.questions.filter(q => keep.has(q));
  }

  // The identity row: pre-filled when the sheet is issued to somebody, dotted
  // lines otherwise. A filled value renders as text, not as an editable line.
  const fields = data.student.fields;
  const set = (labelText, value) => {
    const f = fields.find(x => x.label === labelText);
    if (f && value) f.value = value;
  };

  if (ctx.student){
    set("اسم الطالب", studentLabel(ctx.student));
    set("الصف", ctx.student.classroom);
    if (ctx.student.id){
      fields.splice(1, 0, { icon: "id", label: "رقم الطالب", value: ctx.student.id });
    }
  }

  /* The instrument carries name / class / date and nothing else, so a school
     and a teacher are ADDED rather than filled — and only when the request
     named them, because an empty row here is a line a student would try to
     write on. They go above the date, where a header reads top-down. */
  const dateAt = fields.findIndex(x => x.label === "التاريخ");
  const heading = [
    ...(ctx.school ? [schoolRow(ctx.school)] : []),
    ...(ctx.teacher ? [teacherRow(ctx.teacher)] : [])
  ];
  if (heading.length) fields.splice(dateAt === -1 ? fields.length : dateAt, 0, ...heading);

  /* The date row the instrument already carries, filled when the request named
     a day. The label follows suit: a survey sat on a fixed date is a sitting,
     not a page someone dates by hand. */
  if (ctx.examDate){
    const dateField = fields.find(x => x.label === "التاريخ");
    if (dateField){
      dateField.value = ctx.examDate.text;
      dateField.label = examDateLabel(ctx.examDate);
    } else {
      fields.push({ icon: "calendar", label: examDateLabel(ctx.examDate), value: ctx.examDate.text });
    }
  }

  const scale = readScale(data);
  const top = scale.reduce((m, s) => Math.max(m, s.value), 0);

  /* The advice half of the instrument stays on the server. The sheet needs the
     statements and the scale; what a score MEANS belongs to the report. */
  const verdict = data.verdict;
  delete data.verdict;

  const styles = data.styles.map(s => {
    const count = data.questions.filter(q => q.style === s.key).length;
    return {
      key: s.key,
      label: s.label || s.key,
      icon: s.icon || "",
      color: s.color || "",
      description: s.description || "",
      tips: Array.isArray(s.tips) ? s.tips : [],
      count,
      max: count * top
    };
  });

  return {
    data,
    title: data.meta.pageTitle || data.meta.title,

    /* The key this sheet is graded against. Built here rather than by
       common.answerKeyFor(), which derives a model answer and a lesson goal —
       neither of which a survey statement has. build/index.mjs takes whichever
       the builder provides. */
    answerKey: data.questions.map((q, i) => ({
      question_id: q.id,
      position: i + 1,
      kind: "scale",
      question: q.text,
      // The labels, in sheet order, so a submitted label resolves to its points
      // and publicQuestions() can tell the page what the choices were.
      choices: scale.map(s => s.label),
      scale,
      max_points: top,
      style: q.style,
      // A style IS the goal a statement is evidence for, which is what lets the
      // per-goal report, the group dashboard and the exports read a survey
      // without a special case in any of them.
      goal_id: goalIdFor(q.style),
      goal_text: (styles.find(s => s.key === q.style) || {}).label || q.style,
      answer_key: null,
      answer: "",
      answer_parts: [],
      blanks: 0,
      difficulty: 1,
      difficulty_label: "",
      cognitive_level: ""
    })),

    /* Everything answers/profile.mjs needs to turn ticks into a result. Stored
       with the assignment, so a sheet is always scored against the instrument
       it was actually printed from. */
    profile: { scale, top, styles, verdict: verdict || {} },

    /* The "goals" of this document, in the shape the report and the dashboard
       already read: one per style. */
    goals: styles.map(s => ({
      id: goalIdFor(s.key),
      text: s.label,
      priority: 1,
      cognitiveLevel: ""
    })),

    used: {
      statements: data.questions.length,
      styles: styles.length
    }
  };
}

/** The point scale: `[{label, value}]`, highest first, as the sheet reads it. */
function readScale(data){
  const raw = (data.intro && data.intro.scale) || data.scale;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((o, i) => (o && typeof o === "object")
    ? { label: String(o.label == null ? "" : o.label), value: Number(o.value != null ? o.value : raw.length - i) }
    : { label: String(o), value: raw.length - i });
}
