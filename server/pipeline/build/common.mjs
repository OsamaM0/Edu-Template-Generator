/* ============================================================================
   common.mjs — vocabulary shared by every builder
   ----------------------------------------------------------------------------
   Arabic labels, the meta/header blocks, and the two bits of parsing the raw
   data forces on us: model answers (each question kind stores its answer
   differently) and the summary, which arrives as one long markdown line.

   Icon names here must exist in assets/js/icons.js — an unknown name falls
   through to util.pic() and renders as a grey placeholder box.
   ========================================================================== */
import { PALETTES } from "../../../assets/js/theme.js";

/* ------------------------------------------------------------------ labels -- */

export const DIFFICULTY = { 1: "سهل", 2: "متوسط", 3: "صعب", 4: "متقدم" };

export const COGNITIVE = {
  remember: "تذكّر", understand: "فهم", apply: "تطبيق",
  analyze: "تحليل", analyse: "تحليل", evaluate: "تقويم", create: "إبداع"
};

export const KIND = {
  multiple_choice: { label: "اختيار من متعدد", icon: "list",             short: "اختيار" },
  true_false:      { label: "صح أو خطأ",       icon: "clipboard-check",  short: "صح/خطأ" },
  complete:        { label: "أكمل الفراغ",     icon: "puzzle",           short: "إكمال" },
  short_answer:    { label: "إجابة قصيرة",     icon: "notebook",         short: "قصيرة" }
};

export const TRUE_FALSE_CHOICES = ["صح", "خطأ"];

export const difficultyLabel = d => DIFFICULTY[d] || DIFFICULTY[1];
export const cognitiveLabel = c => COGNITIVE[String(c || "").toLowerCase()] || "";
export const kindOf = k => KIND[k] || KIND.short_answer;

/* ../subject.mjs — which read a subject out of the lesson documents and mapped
   it to an Arabic label — is NO LONGER PART OF WHAT A SHEET PRINTS, and this
   file no longer re-exports it. المادة now shows the subject the CALLER named
   (see subjectName / subjectRow below).

   The module is still live: source.mjs uses it to give each lesson its derived
   `subject` / `subjectName`, which /api/pipeline/lesson/:idx returns and which
   the document record files when a caller named no subject of its own. */

/* ------------------------------------------------------------------ answers -- */

/**
 * The model answer, whatever kind the question is.
 *   multiple_choice  answer_key indexes choices[]
 *   true_false       answer_key indexes ["صح","خطأ"] — 0 is صح
 *   complete         answer is the word(s) that fill the blanks
 *   short_answer     answer is the expected response
 */
export function answerText(q){
  if (!q) return "";
  if (q.kind === "multiple_choice"){
    const i = q.answerKey;
    return (Number.isInteger(i) && q.choices[i]) || q.answer || "";
  }
  if (q.kind === "true_false"){
    return TRUE_FALSE_CHOICES[q.answerKey === 1 ? 1 : 0];
  }
  return q.answer || "";
}

/** The letter shown beside a multiple-choice option, in Arabic ordering. */
const OPTION_LETTERS = ["أ", "ب", "ج", "د", "هـ", "و"];
export const optionLabel = (choice, i) => `${OPTION_LETTERS[i] || i + 1}. ${choice}`;

/** "أ. مرحلة البدايات" — how the answer is written on an answer sheet. */
export function answerWithLetter(q){
  if (q.kind === "multiple_choice" && Number.isInteger(q.answerKey) && q.choices[q.answerKey]){
    return optionLabel(q.choices[q.answerKey], q.answerKey);
  }
  return answerText(q);
}

/** complete-type answers are stored as "وسيلة, ثقافة" — one per blank. */
export const answerParts = q => String(answerText(q) || "")
  .split(/\s*[,،]\s*/).map(s => s.trim()).filter(Boolean);

/** How many blanks a complete-type question actually has. */
export const blankCount = q => (String(q.question || "").match(/_{3,}/g) || []).length;

/* ------------------------------------------------------------------ summary -- */

/** Drop markdown syntax but keep every word — the templates escape, not parse. */
export const stripMarkdown = s => String(s == null ? "" : s)
  .replace(/^#{1,6}\s*/gm, "")
  .replace(/\*\*(.+?)\*\*/g, "$1")
  .replace(/__(.+?)__/g, "$1")
  .replace(/[*_`>]/g, "")
  .replace(/\s+/g, " ")
  .trim();

/**
 * Split the summary into an intro and its numbered points.
 * The text arrives as a single line — "### ملخص … 1. **الأولى:** … 2. **الثانية:** …" —
 * so points are found by their "N. **" markers rather than by line breaks.
 * A summary with no such markers comes back as intro only, which is correct.
 */
export function summaryParts(raw){
  const text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return { intro: "", points: [] };

  let marks = [...text.matchAll(/(?:^|\s)(\d{1,2})\.\s+(?=\*\*)/g)];
  // Fall back to bare "N. " only when the numbering is unambiguous (1, 2, 3 …),
  // so "(سورة محمد: 9)" or a stray decimal cannot split a sentence in half.
  if (marks.length < 2){
    const bare = [...text.matchAll(/(?:^|\s)(\d{1,2})\.\s+/g)];
    const sequential = bare.length >= 2 && bare.every((m, i) => Number(m[1]) === i + 1);
    marks = sequential ? bare : [];
  }

  if (!marks.length) return { intro: stripMarkdown(text), points: [] };

  const intro = stripMarkdown(text.slice(0, marks[0].index));
  const points = marks.map((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const chunk = text.slice(from, to).trim();

    // "**المرحلة الأولى (1343هـ):** بدأت مع…" → title + body
    const titled = chunk.match(/^\*\*(.+?)\*\*\s*[:：]?\s*([\s\S]*)$/);
    if (titled) return { title: stripMarkdown(titled[1]).replace(/[:：]\s*$/, ""), text: stripMarkdown(titled[2]) };

    const colon = chunk.match(/^([^:：]{2,60})[:：]\s*([\s\S]+)$/);
    if (colon) return { title: stripMarkdown(colon[1]), text: stripMarkdown(colon[2]) };

    return { title: "", text: stripMarkdown(chunk) };
  }).filter(p => p.title || p.text);

  return { intro, points };
}

/**
 * Break a long paragraph into readable chunks at sentence ends, so a summary
 * fills several cards instead of one unreadable block.
 */
export function chunkText(text, maxChars = 420){
  const clean = stripMarkdown(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.split(/(?<=[.!؟])\s+/);
  const out = [];
  let buf = "";

  for (const s of sentences){
    if (buf && (buf.length + s.length + 1) > maxChars){ out.push(buf.trim()); buf = ""; }
    buf += (buf ? " " : "") + s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* --------------------------------------------------------------------- meta -- */

export const PALETTE_NAMES = Object.keys(PALETTES);

/**
 * A stable accent per lesson: two different lessons look different, the same
 * lesson always looks the same. Derived from document_idx only — never from the
 * seed, so re-rolling the questions does not repaint the sheet. Overridden when
 * the request names a color (see normalizeColor / the `color` parameter).
 */
export function accentFor(documentIdx){
  const s = String(documentIdx || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return PALETTE_NAMES[h % PALETTE_NAMES.length];
}

/**
 * A caller-supplied main color: a palette name (blue, teal, …) or a hex value
 * (#177a6c / #abc). Anything else returns null so the lesson's own accent stands.
 */
export function normalizeColor(input){
  if (input == null || input === "") return null;
  const s = String(input).trim().toLowerCase().replace(/^%23/, "#");
  if (PALETTES[s]) return s;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return s;
  return null;
}

/* ----------------------------------------------------------------- subject -- */

/**
 * The subject — المادة — as the CALLER named it.
 *
 * This is the one header field that is deliberately NOT derived from the lesson
 * documents. The value that used to fill المادة was guessed out of whatever
 * subject-ish metadata those documents happened to carry, mapped through an
 * Arabic label table: right often enough to be trusted, and wrong often enough
 * to be a problem. The platform asking for the sheet knows the subject for
 * certain, so it sends it beside the lesson id and we print that.
 *
 * A snapshot, like the school and the teacher: printed as sent, never looked up
 * (see normalizeSchool). Sent as `?subject=العلوم`, as
 * `?subject_id=…&subject_name=…`, or as `{ "subject": { "id": …, "name": … } }`
 * — a bare `?subject=` is the NAME, because the name is the half that reaches
 * the page.
 *
 *   { id, name }
 */
export const normalizeSubjectParam = input => party(input);

/**
 * What the المادة line shows, or "" when the request named no subject.
 *
 * Reads ctx.subject — the caller's — and NEVER lesson.subject, which is the
 * database's own derived guess and is no longer printed anywhere.
 */
export function subjectName(ctx){
  return (ctx && ctx.subject && ctx.subject.name) || "";
}

/**
 * The المادة row: filled and fixed when the request named a subject, blank and
 * editable when it did not — the same rule schoolRow and teacherRow follow, so
 * a classroom copy is still a line somebody writes on.
 */
export const subjectRow = (subject, extra = {}) => ({
  icon: "level",
  label: "المادة",
  value: (subject && subject.name) || "",
  editable: !(subject && subject.name),
  ...extra
});

/** The subtitle every generated sheet carries: the subject (no internal id). */
export function subtitleFor(lesson, ctx){
  return subjectName(ctx);
}

/**
 * The info rows shown on a worksheet or lesson-plan header.
 *   · the lesson title — editable, so a teacher can correct it
 *   · the subject, school and teacher — printed when the caller named them, blank
 *     and editable when they did not (see subjectRow / schoolRow / teacherRow)
 * The internal document_idx is deliberately NOT shown; it is plumbing, not a
 * field a teacher cares about. Editable rows are kept even when empty (they are
 * meant to be filled); non-editable rows are dropped when they have no value.
 *
 * `ctx` is the build context — the same object every builder already holds —
 * so one call picks up the student, the school and the teacher together.
 */
export function infoRows(lesson, extra = [], ctx = {}){
  const rows = [
    { icon: "book",   label: "عنوان الدرس",        value: lesson.title,                       editable: true },
    subjectRow(ctx.subject),
    schoolRow(ctx.school),
    teacherRow(ctx.teacher),
    ...studentRows(ctx.student),
    { icon: "target", label: "عدد الأهداف",        value: lesson.goals.length ? `${lesson.goals.length} أهداف` : "" },
    ...extra
  ];
  return rows.filter(r => r.editable || (r.value !== "" && r.value != null));
}

/* ------------------------------------------------------------------ student -- */

/**
 * The student a sheet is issued to, or null for a blank classroom copy.
 *
 * Every builder takes the same object, so `student_id` behaves identically on a
 * worksheet, a card deck, an answer key and a lesson plan: the id is what the
 * result is filed under, the name is what the sheet shows.
 *
 *   { id, name, classroom, section }
 */
export function normalizeStudent(input){
  if (!input) return null;
  const id = String(input.id == null ? "" : input.id).trim();
  const name = String(input.name == null ? "" : input.name).trim();
  if (!id && !name) return null;
  return {
    id,
    name,
    classroom: String(input.classroom == null ? "" : input.classroom).trim(),
    section: String(input.section == null ? "" : input.section).trim()
  };
}

/**
 * The group a sheet belongs to, or null when it belongs to nothing.
 *
 * A group id is whatever the caller uses to mean "these sheets go together" —
 * a lesson id, a class code, an exam session, a term. Nothing here validates it
 * against a list, because there is no list: the group is discovered by reading
 * the sheets that carry it (see answers/group.mjs).
 *
 * Trimmed to the filesystem-safe alphabet ids already use, because the id
 * arrives from a URL and is compared against stored records.
 *
 *   { id, name }
 */
export function normalizeGroup(input){
  if (!input) return null;

  const raw = typeof input === "object" ? input : { id: input };
  const id = String(raw.id == null ? "" : raw.id).trim();
  if (!id) return null;

  return {
    id: id.slice(0, 64),
    name: String(raw.name == null ? "" : raw.name).trim().slice(0, 120)
  };
}

/** How the student is labelled on a sheet — the name if known, else the id. */
export const studentLabel = student =>
  (student && (student.name || (student.id ? `رقم ${student.id}` : ""))) || "";

/**
 * The identity rows a personalised sheet carries. A blank sheet keeps its
 * editable placeholders; an issued one arrives already filled in, and the id
 * row is printed so a paper copy can still be matched back to a record.
 */
export function studentRows(student){
  if (!student) return [];
  const rows = [];
  if (student.name) rows.push({ icon: "user", label: "اسم الطالب / الطالبة", value: student.name });
  if (student.id)   rows.push({ icon: "id",   label: "رقم الطالب", value: student.id });
  if (student.classroom) rows.push({ icon: "users", label: "الصف", value: student.classroom });
  if (student.section)   rows.push({ icon: "users", label: "الشعبة", value: student.section });
  return rows;
}

/* --------------------------------------------------------- school & teacher -- */

/**
 * The school and the teacher a sheet is issued under, or null for neither.
 *
 * Snapshots, exactly like the student: they arrive from the partner platform as
 * parameters, are printed as sent, and are never looked up — there is no school
 * list and no teacher list in this database, deliberately (see store/repo.mjs).
 *
 * That is also why a bare `?school=` and `?teacher=` are read as the NAME while
 * a bare `?student=` is read as an id: the name is the half that goes on the
 * page, and an id nothing can resolve would print as nothing. Send both with
 * `school_id` / `school_name`, or as `{ "school": { "id": …, "name": … } }`.
 *
 *   { id, name }
 */
function party(input){
  if (input == null) return null;

  const raw = (typeof input === "object" && !Array.isArray(input)) ? input : { name: input };
  const id = String(raw.id == null ? "" : raw.id).trim().slice(0, 64);
  const name = String(raw.name == null ? "" : raw.name).trim().slice(0, 120);

  return (id || name) ? { id, name } : null;
}

export const normalizeSchool = input => party(input);
export const normalizeTeacher = input => party(input);

/**
 * The school row, and the teacher row.
 *
 * Filled and fixed when the request named one, blank and editable when it did
 * not — the same rule the student rows follow. A classroom copy therefore looks
 * exactly as it always has: an empty line somebody writes on.
 */
export const schoolRow = (school, extra = {}) => ({
  icon: "school",
  label: "المدرسة",
  value: (school && school.name) || "",
  editable: !(school && school.name),
  ...extra
});

export const teacherRow = (teacher, extra = {}) => ({
  icon: "user",
  label: "المعلم / المعلمة",
  value: (teacher && teacher.name) || "",
  editable: !(teacher && teacher.name),
  ...extra
});

/* ---------------------------------------------------------------- exam date -- */

/**
 * The day the sheet is sat, or null when the caller named none.
 *
 * Every template already carries a date field; until now it was always printed
 * empty for someone to write in by hand. `exam_date` is what fills it, so a
 * whole class receives sheets that agree on when the exam is.
 *
 * Two shapes go in and one comes out:
 *   "2026-09-15" / "2026/09/15" / an ISO timestamp   a real day, formatted
 *   anything else ("الأسبوع الرابع")             printed verbatim
 *
 * Only unambiguous, year-first dates are parsed. "05/09/2026" is a different
 * day in Riyadh than it is in New York, and a sheet that quietly prints the
 * wrong one is worse than a sheet that prints the string it was handed.
 *
 *   { iso, text, long }
 *     iso   "2026-09-15", or "" for free text  — the machine-readable half
 *     text  "15 سبتمبر 2026"                 — what a date field shows
 *     long  "الثلاثاء، 15 سبتمبر 2026"        — for a "اليوم والتاريخ" row
 */
export function normalizeExamDate(input){
  if (input == null) return null;

  /* Idempotent. A page rebuilt from its cache sidecar hands the already-parsed
     date straight back through here, and re-parsing "[object Object]" would
     print that on the sheet. */
  if (typeof input === "object" && !Array.isArray(input)){
    if (input.iso || input.text) return { iso: input.iso || "", text: input.text || input.iso || "", long: input.long || input.text || "" };
    return null;
  }

  const raw = String(input).trim().slice(0, 80);
  if (!raw) return null;

  const day = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]|$)/);
  if (!day) return { iso: "", text: raw, long: raw };

  const [, y, m, d] = day;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // Fixed to UTC on purpose: the caller sent a calendar day, not an instant,
  // and rendering it in the server's zone would slide it by one either way.
  const at = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return { iso: "", text: raw, long: raw };

  const arabic = opts => {
    try { return at.toLocaleDateString("ar", { timeZone: "UTC", ...opts }); }
    catch { return iso; }
  };

  return {
    iso,
    text: arabic({ year: "numeric", month: "long", day: "numeric" }),
    long: arabic({ weekday: "long", year: "numeric", month: "long", day: "numeric" })
  };
}

/** A date field says what it holds: a blank line is "التاريخ", a filled one names the exam. */
export const examDateLabel = examDate => (examDate ? "تاريخ الاختبار" : "التاريخ");

/** The row a template adds only when a date was actually supplied. */
export const examDateRow = (examDate, extra = {}) =>
  (examDate ? [{ icon: "calendar", label: "تاريخ الاختبار", value: examDate.text, ...extra }] : []);

/**
 * The fields a student fills in at the top of a worksheet. When the sheet is
 * issued to somebody the known fields arrive pre-filled and locked — a graded
 * sheet must not be re-labelled with another name after the fact.
 */
export const studentBar = (student, examDate) => {
  const s = student || null;
  const when = examDate || null;
  const bar = [
    { icon: "user",     label: "اسم الطالب / الطالبة", value: (s && s.name) || "", locked: !!(s && s.name) },
    { icon: "users",    label: "الصف",                 value: (s && s.classroom) || "", locked: !!(s && s.classroom) },
    /* Blank and writable for a classroom copy, filled and locked once the
       request names the day: a sitting that has a date should not be able to
       come back stamped with another one. */
    { icon: "calendar", label: examDateLabel(when),     value: (when && when.text) || "", locked: !!when }
  ];
  if (s && s.id) bar.splice(1, 0, { icon: "id", label: "رقم الطالب", value: s.id, locked: true });
  return bar;
};

export const signaturesSection = () => ({
  type: "signatures",
  color: "blue",
  entries: [
    { icon: "pencil", role: "المعلم / المعلمة", name: "" },
    { icon: "pencil", role: "ولي الأمر", name: "" }
  ]
});

export const selfAssessmentSection = () => ({
  type: "self-assessment",
  color: "purple",
  title: "تقييم ذاتي",
  titleIcon: "star",
  prompt: "حدّد ما يعبّر عن مدى فهمك للدرس:",
  options: [
    { icon: "check",    label: "أتقنت الدرس",     color: "green" },
    { icon: "refresh",  label: "أحتاج مراجعة",     color: "yellow" },
    { icon: "question", label: "أحتاج مساعدة",     color: "red" }
  ]
});

/* ---------------------------------------------------------------- numbering -- */

/** "01", "02" … — the card templates print the number as written. */
export const pad2 = n => String(n).padStart(2, "0");

/* -------------------------------------------------------------------- goals -- */

/**
 * Which goal a question is evidence for.
 *
 * The lesson data records that link three ways and none of them is guaranteed:
 * `goal_id` pointing at learning_goals, a `target_goal` written out in full, or
 * nothing at all. Analysis groups by goal, so every question has to land
 * somewhere — an unattributed one lands in a bucket of its own rather than
 * being dropped, because "we asked three questions nobody can map to a goal" is
 * information the teacher wants, not a rounding error.
 */
export const UNASSIGNED_GOAL = "unassigned";

/** Fold a goal sentence to a comparison key — same text, different spacing. */
const goalKey = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The goals a lesson declares, in one list, whichever collection carried them.
 * learningGoals is richest (id + cognitive level); structuredGoals and the
 * plain `goals` strings fill in when it is absent.
 */
export function lessonGoals(lesson){
  if (lesson.learningGoals && lesson.learningGoals.length){
    return lesson.learningGoals.map(g => ({
      id: g.id, text: g.text, priority: g.priority, cognitiveLevel: g.cognitiveLevel
    }));
  }
  const structured = (lesson.worksheet && lesson.worksheet.structuredGoals) || [];
  if (structured.length){
    return structured.map(g => ({ id: g.id, text: g.text, priority: g.priority, cognitiveLevel: "" }));
  }
  return (lesson.goals || []).map((text, i) => ({
    id: `goal_${i + 1}`, text, priority: 1, cognitiveLevel: ""
  }));
}

/** goal id → goal, plus goal text → goal, so either link in the data resolves. */
export function goalIndex(lesson){
  const goals = lessonGoals(lesson);
  const byId = new Map();
  const byText = new Map();
  for (const g of goals){
    if (g.id) byId.set(String(g.id), g);
    if (g.text) byText.set(goalKey(g.text), g);
  }
  return { goals, byId, byText };
}

/**
 * The goal one question belongs to. Never null: an unmappable question gets the
 * shared UNASSIGNED_GOAL entry, and its own `target_goal` text when it has one,
 * so the report can still say what was being asked about.
 */
export function goalForQuestion(index, q){
  if (q.goalId && index.byId.has(q.goalId)) return index.byId.get(q.goalId);
  if (q.targetGoal){
    const hit = index.byText.get(goalKey(q.targetGoal));
    if (hit) return hit;
    return { id: q.goalId || UNASSIGNED_GOAL, text: q.targetGoal, priority: 1, cognitiveLevel: "" };
  }
  if (q.goalId) return { id: q.goalId, text: "", priority: 1, cognitiveLevel: "" };
  return { id: UNASSIGNED_GOAL, text: "أسئلة غير مرتبطة بهدف محدد", priority: 1, cognitiveLevel: "" };
}

/* ---------------------------------------------------------------- answer key -- */

/**
 * One row of the key a submission is graded against.
 *
 * This is the ONLY place the correct answer is written down for a sheet, and it
 * never travels to the browser — the built page carries question ids and option
 * text, the key stays on the server beside the assignment. Deriving it here,
 * from the same question objects the builder rendered, is what guarantees the
 * key describes the sheet the student actually saw.
 */
export function answerKeyFor(lesson, questions){
  const index = goalIndex(lesson);

  return (questions || []).filter(Boolean).map((q, position) => {
    const goal = goalForQuestion(index, q);
    return {
      question_id: q.id,
      position: position + 1,
      kind: q.kind,
      question: q.question,
      choices: q.choices || [],
      answer_key: Number.isInteger(q.answerKey) ? q.answerKey : null,
      answer: answerText(q),
      answer_parts: q.kind === "complete" ? answerParts(q) : [],
      blanks: q.kind === "complete" ? (blankCount(q) || 1) : 0,
      difficulty: q.difficulty,
      difficulty_label: difficultyLabel(q.difficulty),
      goal_id: goal.id || UNASSIGNED_GOAL,
      goal_text: goal.text || "",
      cognitive_level: goal.cognitiveLevel || ""
    };
  });
}

/**
 * What the page may know about its own questions: identity, kind and options —
 * never the answer. Sent to the browser so the answer layer can collect
 * {question_id: answer} without the key being one "view source" away.
 */
export const publicQuestions = answerKey => answerKey.map(k => ({
  question_id: k.question_id,
  position: k.position,
  kind: k.kind,
  choices: k.choices,
  blanks: k.blanks,
  goal_id: k.goal_id
}));
