/* ============================================================================
   answers/profile.mjs — submitted survey → the student's learning profile
   ----------------------------------------------------------------------------
   The counterpart of analyze.mjs. A worksheet is read as MASTERY: every
   question has a right answer, and the useful unit is the lesson goal. A survey
   cannot be read that way — a statement has no right answer at all — so it is
   read as a PROFILE:

     score(style) = Σ points of the statements that feed it
     verdict      = the single highest style
                  · a tie between two or more   -> متوازن
                  · nothing ticked at all       -> غير محدد

   That is the rule the source instrument encodes, and it used to live in the
   browser, on the sheet, marking itself. It lives here now for the same reason
   every other key lives here: a sheet that carries its own marking is a sheet
   whose result can be read — or changed — before it is submitted.

   THE OUTPUT SHAPE IS THE SAME as analyze.mjs produces. `overall`, `goals`,
   `questions` and `report` all exist and mean the analogous thing, because the
   report page, the group dashboard and the exports read them by name and a
   survey should not need a special case in any of them. One style is one
   "goal"; a style's percentage is its affinity, not a mark. The parts that only
   a survey has — the dominant style, the advice — are in `profile`.
   ========================================================================== */
import { PALETTES } from "../../../assets/js/theme.js";
import { arabicCount } from "./analyze.mjs";

/* ------------------------------------------------------------------ bands -- */

/**
 * How strongly one style came through, as a share of the points it could have
 * scored. These are DESCRIPTIONS, not marks: "ضعيف" here means "this is not how
 * you prefer to learn", which is a finding, not a failing.
 */
export const STRENGTH = [
  { level: "dominant",  label: "نمط قوي جداً", min: 80, color: "#1f9d61" },
  { level: "strong",    label: "نمط قوي",      min: 65, color: "#4ba36a" },
  { level: "moderate",  label: "نمط متوسط",    min: 50, color: "#d8a11e" },
  { level: "light",     label: "نمط خفيف",     min: 35, color: "#e07b39" },
  { level: "weak",      label: "نمط ضعيف",     min: 0,  color: "#8fa6bd" }
];

export const strengthFor = percentage => {
  if (percentage == null) return null;
  return STRENGTH.find(b => percentage >= b.min) || STRENGTH[STRENGTH.length - 1];
};

const pct = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null);

/** A style's own color as a hex value: a palette name, a hex, or the band's. */
function styleColor(style, band){
  const name = String((style && style.color) || "").trim().toLowerCase();
  if (PALETTES[name]) return PALETTES[name].main;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(name)) return name;
  return band ? band.color : "#8fa6bd";
}

/* ------------------------------------------------------------- per style -- */

/**
 * The per-style roll-up, in the shape byGoal() returns.
 *
 * @param {Array}  graded   rows from grade.gradeAll().questions
 * @param {object} meta     the assignment's stored profile: {scale, top, styles, verdict}
 * @returns {object} goal_id → { percentage, score, total, … }
 */
export function byStyle(graded, meta){
  const styles = (meta && meta.styles) || [];
  const out = {};

  /* Seed from the instrument, so a style whose statements were all skipped is
     present at 0 rather than missing. Order follows the instrument. */
  for (const s of styles){
    out[`style:${s.key}`] = {
      goal_id: `style:${s.key}`,
      goal_text: s.label || s.key,
      style: s.key,
      cognitive_level: "",
      priority: 1,
      total: 0, correct: 0, wrong: 0, unanswered: 0, needs_review: 0,
      points: 0,
      max_points: 0,
      percentage: null,
      score: 0,
      question_ids: []
    };
  }

  for (const q of graded){
    const id = q.goal_id || `style:${q.style || "unassigned"}`;
    if (!out[id]){
      out[id] = {
        goal_id: id,
        goal_text: q.goal_text || "",
        style: q.style || "",
        cognitive_level: "",
        priority: 1,
        total: 0, correct: 0, wrong: 0, unanswered: 0, needs_review: 0,
        points: 0,
        max_points: 0,
        percentage: null,
        score: 0,
        question_ids: []
      };
    }
    const g = out[id];
    if (!g.goal_text && q.goal_text) g.goal_text = q.goal_text;

    g.total++;
    g.question_ids.push(q.question_id);
    g.points += q.points || 0;
    g.max_points += q.max_points || 0;

    /* "correct" is "responded" on a survey — grade.mjs says so, and the word is
       kept only because every reader of this map already knows it by that
       name. A skipped statement contributes no points, which is the whole of
       its effect on the profile. */
    if (!q.answered) g.unanswered++;
    if (q.correct) g.correct++;
    else g.wrong++;
  }

  for (const g of Object.values(out)){
    g.percentage = pct(g.points, g.max_points);
    g.score = g.points;
    g.score_percentage = g.percentage;

    const style = styles.find(s => s.key === g.style) || null;
    const band = strengthFor(g.percentage);
    g.mastery = band ? band.level : "untested";
    g.mastery_label = band ? band.label : "لم يُقس";
    g.color = styleColor(style, band);
    g.description = (style && style.description) || "";
    g.tips = (style && style.tips) || [];
    g.recommendation = recommendStyle(g, band);
  }

  return out;
}

/** The sentence a student reads about one of their styles. */
export function recommendStyle(style, band){
  const named = style.goal_text ? `«${style.goal_text}»` : "هذا النمط";

  if (!band || style.percentage == null){
    return `لم تتضمن الاستبانة عبارات على ${named}.`;
  }
  const head = `${named}: ${style.points} من ${style.max_points} نقطة (${style.percentage}%) — ${band.label}.`;
  const body = style.description ? ` ${style.description}` : "";
  const tip = style.tips && style.tips.length ? ` جرّب: ${style.tips[0]}` : "";
  return `${head}${body}${tip}`;
}

/* --------------------------------------------------------------- verdict -- */

/**
 * The dominant style, a tie, or nothing answered yet — the one rule the source
 * instrument encodes.
 *
 * Compared on POINTS, not on percentage, and the builder guarantees every style
 * the same number of statements for exactly that reason: an unequal ceiling
 * would make "highest score" and "strongest preference" two different answers.
 */
export function verdictOf(styleMap, meta){
  const rows = Object.values(styleMap).filter(s => s.max_points > 0);
  const advice = (meta && meta.verdict) || {};
  const top = rows.reduce((m, s) => Math.max(m, s.points), 0);

  if (top <= 0){
    const none = advice.undecided || advice.undefined || {};
    return {
      kind: "none",
      label: none.label || "غير محدد",
      description: none.description || "لم تُسجَّل أي إجابة، فلا يمكن تحديد نمط.",
      tips: none.tips || [],
      styles: [],
      points: 0
    };
  }

  const winners = rows.filter(s => s.points === top);

  if (winners.length > 1){
    const balanced = advice.balanced || {};
    return {
      kind: "balanced",
      label: balanced.label || "متوازن",
      description: balanced.description || "",
      tips: balanced.tips || [],
      styles: winners.map(w => ({ key: w.style, label: w.goal_text, percentage: w.percentage })),
      points: top
    };
  }

  const w = winners[0];
  return {
    kind: "single",
    key: w.style,
    label: w.goal_text,
    description: w.description || "",
    tips: w.tips || [],
    color: w.color,
    percentage: w.percentage,
    styles: [{ key: w.style, label: w.goal_text, percentage: w.percentage }],
    points: top
  };
}

/* --------------------------------------------------------------- overall -- */

/**
 * The sheet-level numbers, in the shape overall() returns.
 *
 * `percentage` is the DOMINANT STYLE'S affinity, not a mark — it is the number
 * a progress bar should show, and the only sheet-wide number a survey has that
 * means anything. `correct` is how many statements got a usable answer, which
 * is what the submit bar was counting while the student worked.
 */
export function overallProfile(graded, verdict){
  const total = graded.length;
  const answered = graded.filter(q => q.correct).length;
  const unanswered = graded.filter(q => !q.answered).length;
  const points = graded.reduce((sum, q) => sum + (q.points || 0), 0);
  const maxPoints = graded.reduce((sum, q) => sum + (q.max_points || 0), 0);

  return {
    scoring: "profile",
    total,
    answered,
    correct: answered,
    wrong: total - answered,
    unanswered,
    needs_review: 0,
    points,
    max_points: maxPoints,
    percentage: verdict.percentage != null ? verdict.percentage : pct(points, maxPoints),
    completion: pct(answered, total),
    score: points,
    score_percentage: pct(points, maxPoints),
    // What the sheet FOUND, where a worksheet puts what it measured.
    mastery: verdict.kind === "single" ? `style:${verdict.key}` : verdict.kind,
    mastery_label: verdict.label
  };
}

/* ---------------------------------------------------------------- report -- */

const strongestFirst = rows => [...rows].sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1));

/**
 * The written result: which style came out on top, what that means, and what to
 * do about it. Assembled from the same numbers the JSON carries.
 */
export function writeProfileReport(summary, styleMap, verdict, student){
  const rows = strongestFirst(Object.values(styleMap).filter(s => s.max_points > 0));
  const who = (student && student.name) ? student.name : "الطالب";

  const headline = summary.answered === 0
    ? `لم يجب ${who} عن أي عبارة، فلا يمكن تحديد نمط التعلم.`
    : verdict.kind === "balanced"
      ? `${who}: نمط تعلم متوازن — تتساوى عنده ${verdict.styles.map(s => `«${s.label}»`).join(" و")}.`
      : `${who}: نمط التعلم الغالب هو «${verdict.label}» (${verdict.percentage}%).`;

  const lines = [headline];

  if (summary.answered > 0){
    if (verdict.description) lines.push(verdict.description);

    const ordered = rows.map(s => `${s.goal_text} ${s.percentage}%`).join(" · ");
    lines.push(`الترتيب الكامل: ${ordered}.`);

    const weak = rows.filter(s => s.percentage != null && s.percentage < 50);
    if (weak.length){
      lines.push(`الأقل تفضيلاً: ${weak.map(s => s.goal_text).join("، ")} — لا يعني ضعفاً، بل أن هذه القنوات تحتاج دعماً إضافياً عند استخدامها.`);
    }
    if (summary.unanswered){
      lines.push(`ترك ${arabicCount(summary.unanswered, "عبارة واحدة", "عبارتين", "عبارات")} دون إجابة؛ النتيجة أدق كلما اكتملت الإجابات.`);
    }
  }

  return {
    headline,
    verdict: verdict.label,
    mastery: summary.mastery,
    summary: lines.join(" "),
    lines,
    // The teaching actions, strongest channel first — this is the part a
    // teacher hands over.
    strengths: rows.filter(s => s.percentage >= 65)
      .map(s => ({ goal_id: s.goal_id, goal_text: s.goal_text, percentage: s.percentage })),
    needs_work: rows.filter(s => s.percentage != null && s.percentage < 50)
      .map(s => ({
        goal_id: s.goal_id, goal_text: s.goal_text, percentage: s.percentage,
        recommendation: s.recommendation
      })),
    untested: [],
    next_steps: (verdict.tips && verdict.tips.length ? verdict.tips : rows.flatMap(s => s.tips || [])).slice(0, 5)
  };
}

/* ----------------------------------------------------------------- whole -- */

/**
 * The complete analysis for one submitted survey. Same call signature and same
 * top-level keys as analyze(); analyze() dispatches here on the assignment's
 * `scoring` field.
 */
export function analyzeProfile({ assignment, graded, answers, submittedAt }){
  const meta = assignment.profile || { styles: [], scale: [], verdict: {} };
  const questions = graded.questions;

  const styleMap = byStyle(questions, meta);
  const verdict = verdictOf(styleMap, meta);
  const summary = overallProfile(questions, verdict);

  return {
    schema: "pipeline.analysis/1",
    scoring: "profile",
    assignment_id: assignment.id,
    document_idx: assignment.documentIdx,
    lesson_title: assignment.lessonTitle,
    type: assignment.type,
    seed: assignment.seed,
    student: assignment.student,
    // Same three as the mastery analysis, for the same reason — see analyze().
    school: assignment.school || null,
    teacher: assignment.teacher || null,
    exam_date: assignment.examDate || null,
    group: assignment.group || null,
    group_id: assignment.groupId || "",
    submitted_at: submittedAt,
    issued_at: assignment.createdAt,

    answers,

    overall: summary,
    // One style per entry, under the key the rest of the system calls a goal.
    goals: styleMap,
    questions,

    /* The survey-only half: the dominant style, its advice, and the scale the
       sheet was answered on. */
    profile: {
      verdict,
      scale: meta.scale || [],
      styles: strongestFirst(Object.values(styleMap).filter(s => s.max_points > 0)).map(s => ({
        key: s.style,
        label: s.goal_text,
        points: s.points,
        max_points: s.max_points,
        percentage: s.percentage,
        strength: s.mastery,
        strength_label: s.mastery_label,
        color: s.color,
        description: s.description,
        tips: s.tips
      }))
    },

    report: writeProfileReport(summary, styleMap, verdict, assignment.student),
    unmatched_answers: graded.extra
  };
}
