/* ============================================================================
   templates/index.js — the template registry + detection
   ----------------------------------------------------------------------------
   A template owns a WHOLE SHEET (masthead, body, footer). A section owns one
   card inside the worksheet template. Adding a template:

     1. create templates/my-template.js exporting
          template  "my-template"                  (the meta.template value)
          render    (data, ctx) => html            (required)
          wire      (app, data) => {onResize?}     (optional)
          reset     (app) => void                  (optional)
     2. import it below and add it to MODULES.
   ========================================================================== */
import * as worksheet    from "./worksheet.js";
import * as cardQuestion from "./interactive-card.js";
import * as cardAnswer   from "./interactive-card-answers.js";
import * as diffLesson   from "./differentiated-lesson.js";
import * as goldenMin    from "./golden-minutes.js";
import * as learnPattern from "./learning-pattern.js";

const MODULES = [worksheet, cardQuestion, cardAnswer, diffLesson, goldenMin, learnPattern];

const REGISTRY = Object.fromEntries(MODULES.map(m => [m.template, m]));

/** Spelling variants the endpoint may send for the same template. */
const ALIASES = {
  "worksheet": "worksheet",
  "work-sheet": "worksheet",
  "sheet": "worksheet",

  "interactive-card": "interactive-card",
  "interactive-cards": "interactive-card",
  "interactive-review-card": "interactive-card",
  "review-card": "interactive-card",
  "cards": "interactive-card",
  "question-card": "interactive-card",
  "questions": "interactive-card",

  "interactive-card-answers": "interactive-card-answers",
  "interactive-card-answer": "interactive-card-answers",
  "interactive-review-card-answer": "interactive-card-answers",
  "answer-card": "interactive-card-answers",
  "answer-cards": "interactive-card-answers",
  "answers": "interactive-card-answers",

  "differentiated-lesson": "differentiated-lesson",
  "differentiated-lesson-plan": "differentiated-lesson",
  "differentiated": "differentiated-lesson",
  "diff-lesson": "differentiated-lesson",
  "lesson-plan": "differentiated-lesson",
  "lessonplan": "differentiated-lesson",

  "golden-minutes": "golden-minutes",
  "golden-minutes-card": "golden-minutes",
  "golden-minute": "golden-minutes",
  "golden-card": "golden-minutes",
  "golden": "golden-minutes",
  "gold-minutes": "golden-minutes",
  "minutes-card": "golden-minutes",

  "learning-pattern": "learning-pattern",
  "learning-patterns": "learning-pattern",
  "learning-style": "learning-pattern",
  "learning-styles": "learning-pattern",
  "learning-pattern-survey": "learning-pattern",
  "learning-styles-survey": "learning-pattern",
  "style-survey": "learning-pattern",
  "pattern-survey": "learning-pattern",
  "vark": "learning-pattern"
};

export const normTemplate = t => ALIASES[String(t || "").toLowerCase().trim().replace(/_/g, "-")] || null;

/**
 * Which template renders this payload?
 *   1. meta.template / meta.type / top-level template — explicit, wins.
 *   2. a `cards` array -> question or answer cards, told apart by whether the
 *      cards carry answer-side fields (note / skill / score).
 *   3. leveled `groups` + `activities` blocks -> differentiated lesson plan.
 *   4. `firstFive` + `lastFive` blocks -> golden-minutes card.
 *   5. a `questions` + `styles` pair -> the learning-pattern survey.
 *   6. anything else -> worksheet.
 */
export function detect(data){
  const meta = (data && data.meta) || {};
  const explicit = normTemplate(meta.template || meta.type || (data && data.template));
  if (explicit) return explicit;

  const cards = data && data.cards;
  if (Array.isArray(cards) && cards.length){
    const answerish = cards.some(c => c && (c.note || c.skill || c.score || c.answer));
    return answerish ? "interactive-card-answers" : "interactive-card";
  }

  if (data && data.groups && Array.isArray(data.groups.items) &&
      data.activities && Array.isArray(data.activities.columns)){
    return "differentiated-lesson";
  }

  if (data && data.firstFive && data.lastFive){
    return "golden-minutes";
  }

  if (data && Array.isArray(data.questions) && data.questions.length &&
      Array.isArray(data.styles) && data.styles.length){
    return "learning-pattern";
  }

  return "worksheet";
}

export const forTemplate = name => REGISTRY[name] || worksheet;

export const knownTemplates = () => Object.keys(REGISTRY);
