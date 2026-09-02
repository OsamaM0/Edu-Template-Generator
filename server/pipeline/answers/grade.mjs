/* ============================================================================
   answers/grade.mjs — one submitted answer against one key row
   ----------------------------------------------------------------------------
   Arabic is written more than one way and students type it the way they write
   it: with or without tashkeel, أ / إ / ا, ة / ه, ى / ي. Comparing raw strings
   would mark "الجملة الاسميه" wrong for a spelling difference the teacher would
   not even notice, so every comparison happens on a folded form.

   What each kind is graded on:
     multiple_choice   the chosen option — by text, by index, or by its letter
     true_false        صح / خطأ, however it was expressed (true, 1, ✓, …)
     complete          each blank separately; the mark needs all of them
     short_answer      overlap with the model answer, and it says so
     scale             a point on a scale — a survey statement, which has no
                       right answer at all (learning-pattern)

   Short answers are the honest limit of automatic grading. They are scored by
   how much of the model answer a student reproduced, and anything in the middle
   band comes back flagged for review rather than quietly counted — a report
   that hides its own uncertainty is worse than one that admits it.
   ========================================================================== */
import { TRUE_FALSE_CHOICES } from "../build/common.mjs";

/* --------------------------------------------------------------- normalize -- */

/** Tashkeel, tatweel and the marks that never change a word's identity. */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * Fold a string to what it MEANS: same letters, same order, nothing else.
 * Used for every comparison in this file and nowhere else — what the student
 * actually typed is always reported back unfolded.
 */
export function fold(input){
  return String(input == null ? "" : input)
    .replace(DIACRITICS, "")
    .replace(/[إأآٱا]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئء]/g, "ء")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))   // Arabic-Indic digits
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const same = (a, b) => {
  const x = fold(a), y = fold(b);
  return x !== "" && x === y;
};

/** Arabic option letters, so "أ" or "ب." submitted alone still resolves. */
const LETTERS = ["أ", "ب", "ج", "د", "هـ", "و"];

/** Content words — the short connectives carry no evidence of understanding. */
const STOP = new Set([
  "في", "من", "الى", "على", "عن", "مع", "او", "و", "ثم", "هو", "هي", "هذا", "هذه",
  "ذلك", "التي", "الذي", "ان", "انه", "كان", "قد", "لا", "ما", "كل", "بين", "به",
  "له", "عند", "حيث", "حتى", "لكن", "اي", "the", "a", "an", "of", "to", "and", "is"
]);

const contentWords = s => fold(s).split(" ").filter(w => w.length > 1 && !STOP.has(w));

/* --------------------------------------------------------------- per-kind -- */

/**
 * Which option a submitted multiple-choice answer refers to.
 * Accepts the option text, a 0-based index, a 1-based position, or the Arabic
 * letter — with or without the "أ. " prefix the sheet prints.
 * @returns {number} index into choices, or -1
 */
export function resolveChoice(submitted, choices){
  const list = choices || [];
  const raw = String(submitted == null ? "" : submitted).trim();
  if (!raw || !list.length) return -1;

  const exact = list.findIndex(c => same(c, raw));
  if (exact >= 0) return exact;

  // "أ. الجملة الاسمية" — strip the printed label and try the text again.
  const labelled = raw.replace(/^\s*(?:[ء-ي]|[a-z]|\d{1,2})\s*[.．)\-–]\s*/i, "");
  if (labelled !== raw){
    const hit = list.findIndex(c => same(c, labelled));
    if (hit >= 0) return hit;
  }

  // A bare letter, "أ" or "ب".
  const letter = LETTERS.indexOf(raw.replace(/[.．)\s]/g, ""));
  if (letter >= 0 && letter < list.length) return letter;

  // A bare number: 0-based first (that is what the data uses), then 1-based.
  if (/^\d{1,2}$/.test(raw)){
    const n = Number(raw);
    if (n >= 0 && n < list.length) return n;
    if (n - 1 >= 0 && n - 1 < list.length) return n - 1;
  }
  return -1;
}

/** صح / خطأ from whatever the student or the client sent. @returns 0 | 1 | -1 */
export function resolveTrueFalse(submitted){
  const raw = String(submitted == null ? "" : submitted).trim();
  if (!raw) return -1;

  const folded = fold(raw);
  if (/^(صح|صحيح|نعم|true|t|yes|y|1)$/.test(folded) || /^[✓√]$/.test(raw)) return 0;
  if (/^(خطا|غير صحيح|خاطء|لا|false|f|no|n|0)$/.test(folded) || /^[✗×x]$/i.test(raw)) return 1;

  if (same(raw, TRUE_FALSE_CHOICES[0])) return 0;
  if (same(raw, TRUE_FALSE_CHOICES[1])) return 1;
  return -1;
}

/**
 * Which point of a scale a submitted survey answer refers to.
 *
 * The sheet submits the point's LABEL ("أحيانًا") because that is what the
 * student ticked and what survives a re-render — but a client integrating
 * directly is likelier to send the number, so both are accepted, plus the
 * 1-based position as a last resort.
 *
 * @returns {{label:string, value:number}|null}
 */
export function resolveScalePoint(submitted, scale){
  const points = Array.isArray(scale) ? scale : [];
  const raw = String(submitted == null ? "" : submitted).trim();
  if (!raw || !points.length) return null;

  const byLabel = points.find(p => same(p.label, raw));
  if (byLabel) return byLabel;

  if (/^-?\d+(\.\d+)?$/.test(raw)){
    const n = Number(raw);
    const byValue = points.find(p => Number(p.value) === n);
    if (byValue) return byValue;
    // A 1-based position, in the order the scale is printed.
    if (Number.isInteger(n) && n >= 1 && n <= points.length) return points[n - 1];
  }
  return null;
}

/** The blanks of a complete-type answer, as the student wrote them. */
const submittedParts = submitted =>
  (Array.isArray(submitted) ? submitted : String(submitted == null ? "" : submitted).split(/\s*[,،]\s*/))
    .map(s => String(s == null ? "" : s).trim())
    .filter(Boolean);

/* ------------------------------------------------------------------ grade -- */

/** How sure the grade is. Only short answers are ever anything but "exact". */
export const CONFIDENCE = { EXACT: "exact", HEURISTIC: "heuristic", NONE: "none" };

/** A short answer is credited above this, and flagged for review above REVIEW. */
const SHORT_PASS = 0.6;
const SHORT_REVIEW = 0.3;

/**
 * @param {object} key       one row of the answer key (build/common answerKeyFor)
 * @param {*}      submitted whatever the student sent for that question id
 * @returns {object} the graded row
 */
export function gradeOne(key, submitted){
  const answered = Array.isArray(submitted)
    ? submitted.some(v => String(v == null ? "" : v).trim() !== "")
    : String(submitted == null ? "" : submitted).trim() !== "";

  const base = {
    question_id: key.question_id,
    position: key.position,
    kind: key.kind,
    question: key.question,
    goal_id: key.goal_id,
    goal_text: key.goal_text,
    difficulty: key.difficulty,
    student_answer: Array.isArray(submitted) ? submitted.join("، ") : (submitted == null ? "" : String(submitted)),
    correct_answer: key.answer,
    answered,
    correct: false,
    score: 0,
    confidence: CONFIDENCE.EXACT,
    needs_review: false,
    detail: ""
  };

  /* A scale row carries its ceiling and its style whether or not it was
     answered. A skipped statement still counts against the style it belonged
     to — dropping it would shrink that style'"'"'s maximum, and a survey where
     skipping raises your score is a broken survey. */
  if (key.kind === "scale"){
    base.points = 0;
    base.max_points = Number(key.max_points) || 0;
    base.chosen_label = "";
    base.style = key.style || "";
  }

  if (!answered){
    return { ...base, confidence: CONFIDENCE.NONE, detail: "لم تتم الإجابة" };
  }

  switch (key.kind){
    case "multiple_choice": {
      const chosen = resolveChoice(submitted, key.choices);
      const correct = chosen >= 0 && chosen === key.answer_key;
      return {
        ...base,
        chosen_index: chosen,
        correct,
        score: correct ? 1 : 0,
        detail: chosen < 0 ? "إجابة غير مطابقة لأي خيار" : ""
      };
    }

    case "true_false": {
      const chosen = resolveTrueFalse(submitted);
      const expected = key.answer_key === 1 ? 1 : 0;
      const correct = chosen >= 0 && chosen === expected;
      return {
        ...base,
        chosen_index: chosen,
        correct,
        score: correct ? 1 : 0,
        detail: chosen < 0 ? "إجابة غير مفهومة — اكتب صح أو خطأ" : ""
      };
    }

    case "complete": {
      const expected = (key.answer_parts && key.answer_parts.length)
        ? key.answer_parts
        : (key.answer ? [key.answer] : []);

      if (!expected.length){
        return { ...base, confidence: CONFIDENCE.NONE, needs_review: true,
          detail: "لا توجد إجابة نموذجية لهذا السؤال" };
      }

      /* Each expected blank is matched against the answer in the same position
         first — order is how the sentence reads — and only then against any
         unclaimed one, so two blanks filled in the wrong order still score
         partially instead of scoring zero twice. */
      const given = submittedParts(submitted);
      const claimed = new Set();
      let hits = 0;

      expected.forEach((want, i) => {
        if (!claimed.has(i) && given[i] != null && same(given[i], want)){
          claimed.add(i); hits++; return;
        }
        const loose = given.findIndex((g, j) => !claimed.has(j) && same(g, want));
        if (loose >= 0){ claimed.add(loose); hits++; }
      });

      return {
        ...base,
        correct: hits === expected.length,
        score: Number((hits / expected.length).toFixed(3)),
        blanks: expected.length,
        blanks_correct: hits,
        detail: hits && hits < expected.length ? `${hits} من ${expected.length} فراغات صحيحة` : ""
      };
    }

    case "scale": {
      /* A survey statement has no right answer, so "correct" here means
         RESPONDED: a tick that resolves to a point on the scale is a usable
         data point, and one that does not is not. The number that carries the
         meaning is `points`, and answers/profile.mjs is what sums it per
         style — this function's job is only to read one tick honestly. */
      const point = resolveScalePoint(submitted, key.scale);
      const top = Number(key.max_points) || 0;

      return {
        ...base,
        correct: !!point,
        score: point && top ? Number((point.value / top).toFixed(3)) : 0,
        points: point ? point.value : 0,
        max_points: top,
        chosen_label: point ? point.label : "",
        style: key.style || "",
        detail: point ? "" : "إجابة غير مطابقة لأي درجة من المقياس"
      };
    }

    default: {
      // short_answer, and any kind added later without a rule of its own.
      const model = contentWords(key.answer);
      if (!model.length){
        return { ...base, confidence: CONFIDENCE.NONE, needs_review: true,
          detail: "لا توجد إجابة نموذجية للمقارنة" };
      }

      const given = new Set(contentWords(base.student_answer));
      const score = model.filter(w => given.has(w)).length / model.length;

      return {
        ...base,
        correct: score >= SHORT_PASS,
        score: Number(score.toFixed(3)),
        confidence: CONFIDENCE.HEURISTIC,
        needs_review: score >= SHORT_REVIEW && score < SHORT_PASS,
        detail: score >= SHORT_PASS
          ? "تطابق مقبول مع الإجابة النموذجية"
          : score >= SHORT_REVIEW
            ? "إجابة جزئية — تحتاج مراجعة المعلم"
            : "لا تتضمن العناصر الأساسية للإجابة النموذجية"
      };
    }
  }
}

/**
 * Grade a whole submission.
 * The key drives the loop, not the submitted object: a question the student
 * skipped still has to appear in the result, and an answer sent for a question
 * this sheet never asked is reported as extra rather than graded.
 */
export function gradeAll(answerKey, answers){
  const submitted = (answers && typeof answers === "object" && !Array.isArray(answers)) ? answers : {};
  const known = new Set(answerKey.map(k => k.question_id));

  return {
    questions: answerKey.map(k => gradeOne(k, submitted[k.question_id])),
    extra: Object.keys(submitted).filter(id => !known.has(id))
  };
}
