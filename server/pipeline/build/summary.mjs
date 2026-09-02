/* ============================================================================
   build/summary.mjs — the summaries collection → a printable revision sheet
   ----------------------------------------------------------------------------
   summary.summary arrives as one long markdown line, not as paragraphs:

     "### ملخص الدرس … 1. **المرحلة الأولى (1343هـ):** بدأت مع … 2. **المرحلة الثانية…"

   summaryParts() finds the numbered points inside it, and each becomes its own
   card. A summary with no numbering is split at sentence ends instead, so a
   free-form paragraph still fills several readable cards rather than one wall
   of text.

   This is the one document type that needs no questions at all — a lesson with
   only a summary row still produces a complete sheet.
   ========================================================================== */
import { sample, sampleInOrder } from "../rng.mjs";
import {
  summaryParts, chunkText, infoRows, studentBar,
  selfAssessmentSection, accentFor
} from "./common.mjs";

export const type = "summary";
export const template = "worksheet";
export const label = "ملخص الدرس";
export const describes = "ورقة ملخص للمراجعة: النقاط الرئيسة والمفردات والتطبيقات وسؤال مراجعة";

export const defaultCounts = {
  points: null,       // every point in the summary
  vocabulary: 8,
  goals: null,
  applications: 4,
  short_answer: 2
};

export function build(lesson, ctx){
  const counts = ctx.counts;
  const parsed = summaryParts(lesson.summary.body);

  const points = sampleInOrder(parsed.points, counts.points, ctx.stream("points"));
  const vocab = sample(lesson.worksheet.vocabulary, counts.vocabulary, ctx.stream("vocabulary"));
  const goals = sampleInOrder(lesson.goals, counts.goals, ctx.stream("goals"));
  const applications = sampleInOrder(lesson.worksheet.applications, counts.applications, ctx.stream("applications"));
  const review = sample(lesson.questions.shortAnswer, counts.short_answer, ctx.stream("short_answer"));

  const sections = [];
  let n = 0;

  // The intro sentence that precedes the numbered points, when there is one.
  if (parsed.intro && parsed.points.length){
    sections.push({
      type: "note", number: ++n, span: 2, color: "sky",
      title: "الفكرة العامة", titleIcon: "bulb",
      text: parsed.intro
    });
  }

  if (points.length){
    for (const point of points){
      sections.push({
        type: "note", number: ++n, color: "blue",
        title: point.title || `النقطة ${n}`, titleIcon: "book",
        text: point.text
      });
    }
  } else {
    // No numbering to key off — fall back to sentence-sized chunks.
    for (const chunk of chunkText(parsed.intro || lesson.summary.body, 380)){
      sections.push({
        type: "note", number: ++n, span: 2, color: "blue",
        title: `الملخص (${n})`, titleIcon: "book",
        text: chunk
      });
    }
  }

  if (vocab.length){
    sections.push({
      type: "note", number: ++n, span: 2, color: "orange",
      title: "المفردات الأساسية", titleIcon: "key",
      items: vocab.map(v => (v.definition ? `${v.term}: ${v.definition}` : v.term))
    });
  }

  if (applications.length){
    sections.push({
      type: "note", number: ++n, span: 2, color: "teal",
      title: "تطبيقات على الدرس", titleIcon: "rocket",
      items: applications
    });
  }

  if (lesson.summary.ending){
    sections.push({
      type: "note", number: ++n, span: 2, color: "green",
      title: "الخلاصة", titleIcon: "check",
      text: lesson.summary.ending
    });
  }

  for (const q of review){
    sections.push({
      type: "note", number: ++n, color: "purple",
      title: "سؤال مراجعة", titleIcon: "question",
      text: q.question,
      lines: 3
    });
  }

  sections.push(selfAssessmentSection());

  const data = {
    meta: {
      template: "worksheet",
      age: ctx.theme,
      color: accentFor(lesson.documentIdx),
      badge: "ملخص الدرس",
      title: lesson.title,
      pageTitle: `ملخص — ${lesson.title}`
    },
    studentBar: studentBar(ctx.student, ctx.examDate),
    info: {
      color: "yellow",
      rows: infoRows(lesson, [
        { icon: "list", label: "عدد النقاط", value: points.length ? String(points.length) : "" }
      ], ctx)
    },
    sections
  };

  if (lesson.summary.opening){
    data.warmup = { title: "مدخل الدرس", titleIcon: "bulb", color: "orange", text: lesson.summary.opening };
  }

  if (goals.length){
    data.objectives = { title: "أهداف التعلم", titleIcon: "target", color: "green", items: goals };
  }

  return {
    data,
    title: data.meta.pageTitle,
    used: {
      points: points.length,
      vocabulary: vocab.length,
      applications: applications.length,
      short_answer: review.length,
      goals: goals.length
    }
  };
}
