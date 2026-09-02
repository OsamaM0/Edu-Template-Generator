/* ============================================================================
   subject.mjs — what "المادة" says on a sheet
   ----------------------------------------------------------------------------
   The lesson documents name their subject in whatever the generating pipeline
   happened to write: "science", "Digital Skills", "علوم", "العلوم - ثاني
   ابتدائي", sometimes only "general", sometimes nowhere at all. A sheet has one
   line for it, so everything that has to read those values reads them here —
   source.mjs when it picks a value out of the documents, the builders when they
   print one.

     subjectLabel(value)     the Arabic label to print, "" when there is nothing
     subjectFromText(text)   a subject recognized inside a filename or a title
     isGenericSubject(value) "general" / "عام" — a value worth looking past

   What this replaces was a seventeen-key English lookup returning "" for
   everything else, so a database that says "علوم" or "المهارات الرقمية" — which
   is most of them — printed nothing, and the placeholder "general" was the one
   value that ever came through, as "عام". Three things fix that: aliases in both
   languages, a normalizer so spelling variants land on the same entry, and a
   pass-through that prints an unrecognized subject instead of dropping it.
   ========================================================================== */

/* --------------------------------------------------------------- normalize -- */

/**
 * A value reduced to the form the tables are keyed by: no diacritics, no
 * tatweel, alef/ya/ta-marbuta spellings unified, punctuation and underscores
 * flattened to single spaces, latin lowercased.
 *
 *   "العُلوم_الشرعيّة"  →  "العلوم الشرعيه"
 *   "Digital-Skills"     →  "digital skills"
 */
export function normalizeSubject(value){
  return String(value == null ? "" : value)
    .replace(/[ً-ْٰـ]/g, "")                    // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و").replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const isArabicWord = w => /^[؀-ۿ]/.test(w);

/** "الدراسات الاجتماعيه" → "دراسات اجتماعيه" — the same subject, said barely. */
const stripAl = s => s.split(" ")
  .map(w => (isArabicWord(w) && w.length > 4 ? w.replace(/^ال/, "") : w)).join(" ");

/** …and back, because a document may write it either way. */
const addAl = s => s.split(" ")
  .map(w => (isArabicWord(w) && w.length > 2 && !w.startsWith("ال") ? `ال${w}` : w)).join(" ");

/* ------------------------------------------------------------- the subjects -- */

/**
 * [what a sheet prints, ...what a document might call it].
 *
 * Aliases are matched after normalizeSubject(), and each one is also stored with
 * and without the Arabic definite article, so "علوم", "العلوم" and "Science" are
 * one entry. Order matters only for scanning free text — see SCAN.
 */
const SUBJECTS = [
  ["اللغة العربية",       "arabic", "arabic language", "language arts", "عربي", "لغة عربية",
                           "لغتي", "لغتي الجميلة", "لغتي الخالدة", "نحو", "بلاغة", "إملاء", "قواعد"],
  ["الأدب",               "literature", "أدب", "نصوص"],
  ["اللغة الإنجليزية",    "english", "english language", "efl", "esl", "إنجليزي", "لغة إنجليزية"],
  ["الرياضيات",           "math", "maths", "mathematics", "رياضيات"],
  ["العلوم",              "science", "sciences", "general science", "natural science", "علوم"],
  ["الفيزياء",            "physics", "فيزياء"],
  ["الكيمياء",            "chemistry", "كيمياء"],
  ["الأحياء",             "biology", "life science", "أحياء"],
  ["علوم الأرض",          "earth science", "geology", "جيولوجيا", "علوم أرض"],
  ["علم البيئة",          "environmental science", "ecology", "بيئة", "علوم بيئية"],
  ["التاريخ",             "history", "تاريخ"],
  ["الجغرافيا",           "geography", "جغرافيا"],
  ["الدراسات الاجتماعية", "social", "social studies", "social science", "civics", "citizenship",
                           "اجتماعيات", "دراسات اجتماعية", "وطنية", "تربية وطنية", "مواطنة"],
  ["العلوم الشرعية",      "religion", "islamic", "islamic studies", "islamic education", "sharia",
                           "علوم شرعية", "شرعي", "دين", "تربية دينية", "تربية إسلامية",
                           "دراسات إسلامية"],
  ["القرآن الكريم",       "quran", "قرآن", "تلاوة", "تجويد"],
  ["الحديث",              "hadith", "حديث"],
  ["الفقه",               "fiqh", "فقه"],
  ["التوحيد",             "tawhid", "tawheed", "توحيد", "عقيدة"],
  ["الحاسب",              "computer", "computer science", "computing", "informatics", "حاسب",
                           "حاسب آلي", "علوم حاسب"],
  ["المهارات الرقمية",    "digital", "digital skills", "ict", "مهارات رقمية", "تقنية رقمية"],
  ["التقنية",             "technology", "tech", "engineering", "تقنية", "هندسة"],
  ["التربية الفنية",      "art", "arts", "fine arts", "فنية", "تربية فنية", "رسم"],
  ["التربية الموسيقية",   "music", "موسيقى", "تربية موسيقية"],
  ["التربية البدنية",     "pe", "physical education", "sport", "sports", "بدنية",
                           "تربية بدنية", "رياضة"],
  ["التربية الصحية",      "health", "health education", "صحية", "تربية صحية", "صحة"],
  ["التربية الأسرية",     "family", "family education", "home economics", "أسرية", "تربية أسرية"],
  ["المهارات الحياتية",   "life skills", "مهارات حياتية"],
  ["مهارات التفكير",      "thinking skills", "critical thinking", "تفكير", "مهارات تفكير"],
  ["الاقتصاد",            "economics", "business", "اقتصاد"],
  ["الفلسفة",             "philosophy", "فلسفة"],
  ["علم النفس",           "psychology", "علم نفس"],
  ["الإحصاء",             "statistics", "إحصاء"],
  ["عام",                 "general", "عام"]
];

/** Every spelling that resolves: normalized alias → the label to print. */
const LOOKUP = new Map();
for (const [label, ...aliases] of SUBJECTS){
  for (const alias of [label, ...aliases]){
    const n = normalizeSubject(alias);
    if (!n) continue;
    for (const form of new Set([n, stripAl(n), addAl(n)])){
      if (!LOOKUP.has(form)) LOOKUP.set(form, label);
    }
  }
}

/**
 * The same aliases, longest first, for reading a subject out of free text: a
 * filename that says "العلوم الشرعية" must not be answered with "العلوم".
 * Short latin aliases are dropped here — "pe" or "art" inside an English
 * filename means nothing — while Arabic ones are kept, since that is exactly
 * how a filename names its subject.
 */
const SCAN = [...LOOKUP.entries()]
  .filter(([alias, label]) => label !== "عام" && (isArabicWord(alias) || alias.length > 4))
  .sort((a, b) => b[0].length - a[0].length);

/** Values that name no subject: worth looking past before settling for one. */
const GENERIC = new Set([
  "general", "other", "others", "unknown", "none", "n/a", "misc", "miscellaneous",
  "عام", "عامة", "أخرى", "غير محدد", "غير معروف", "متنوع", "متنوعة"
].map(normalizeSubject));

export const isGenericSubject = value => {
  const n = normalizeSubject(value);
  return n === "" || GENERIC.has(n);
};

/* ---------------------------------------------------------------- the label -- */

/** How a value is printed when nothing recognizes it: tidied, but still itself. */
const asWritten = value => String(value == null ? "" : value)
  .replace(/_+/g, " ").replace(/\s+/g, " ").trim();

const hasArabic = v => /[؀-ۿ]/.test(String(v == null ? "" : v));

/** The same words, article and spelling aside: "علوم" and "العلوم", not "دين". */
const sameWords = (normalized, label) =>
  stripAl(normalized) === stripAl(normalizeSubject(label));

/**
 * Which of the two to print when a value matched a table entry.
 *
 * A synonym in Arabic is not an improvement on what the database said: a lesson
 * filed under "التربية الإسلامية" should print that, not this table's "العلوم
 * الشرعية". So an Arabic value only takes the table's label when the label is
 * the same words — "علوم" gains its article and nothing else. Latin values have
 * no such claim: they exist to be translated.
 */
const preferred = (value, normalized, label) =>
  (hasArabic(value) && !sameWords(normalized, label)) ? asWritten(value) : label;

/**
 * The Arabic label for whatever the documents called the subject.
 *
 *   "science"               → "العلوم"
 *   "علوم"                  → "العلوم"
 *   "Digital Skills"        → "المهارات الرقمية"
 *   "علوم - ثاني ابتدائي"   → "العلوم"
 *   "الغذاء والتغذية"       → "الغذاء والتغذية"   (unknown here, printed as sent)
 *   ""                      → ""
 */
export function subjectLabel(value){
  const n = normalizeSubject(value);
  if (!n) return "";

  const exact = LOOKUP.get(n);
  if (exact) return preferred(value, n, exact);

  /* "علوم — الصف الثاني", "Science / Grade 2": a subject with its grade stapled
     on. Try each piece before giving up on the whole. */
  for (const part of String(value).split(/[-–—/|,،:؛]+/)){
    const pn = normalizeSubject(part);
    const hit = LOOKUP.get(pn);
    if (hit) return preferred(part, pn, hit);
  }

  /* Still nothing: a subject named inside a longer phrase, e.g. "منهج العلوم". */
  const found = subjectFromText(value);
  if (found) return found;

  /* An unrecognized subject is still the right answer — print it. This is what
     keeps a curriculum this table has never heard of off the "عام" fallback. */
  return asWritten(value);
}

/**
 * The subject named somewhere inside a filename or a lesson title, or "".
 * Whole words only: "الرياضيات" is found in "الرياضيات - سادس", but not inside
 * a longer word that merely starts the same way.
 */
export function subjectFromText(text){
  const padded = ` ${normalizeSubject(text)} `;
  if (padded.trim() === "") return "";
  for (const [alias, label] of SCAN){
    if (padded.includes(` ${alias} `)) return label;
  }
  return "";
}

/* ------------------------------------------------------- out of a document -- */

/**
 * The keys a lesson document may carry its subject under. Pipelines have
 * written all of these, and nothing is gained by guessing which one a given
 * database uses — so the document is searched for any of them.
 */
const SUBJECT_KEYS = /^(subject|subject_area|subject_name|subject_field|subjectarea|subjectname|material|material_name|course|course_name|discipline|curriculum_subject|madda|mada|المادة)$/i;

/**
 * Branches holding lesson content rather than metadata. Skipped so the search
 * stays cheap and cannot mistake a field inside a question for the lesson's own
 * subject.
 */
const NOT_METADATA = new Set([
  "multiple_choice", "true_false", "complete", "short_answer",
  "learning_goals", "structured_goals", "goal_based_activities",
  "vocabulary", "applications", "teacher_guidelines", "goals"
]);

/**
 * Every subject-ish string in a document, in the order the walk meets them.
 * The subject sits at `_metadata.content_analysis.subject_area` in the
 * documents this was written against, but it has also arrived at the top level
 * and a nesting deeper — so the walk decides, not a hard-coded path.
 */
function collectSubjects(node, out = [], depth = 0){
  if (!node || typeof node !== "object" || depth > 6 || out.length >= 10) return out;
  if (Array.isArray(node)){
    for (const v of node) collectSubjects(v, out, depth + 1);
    return out;
  }
  for (const [key, value] of Object.entries(node)){
    if (NOT_METADATA.has(key)) continue;
    if (typeof value === "string"){
      const s = value.trim();
      if (s && SUBJECT_KEYS.test(key)) out.push(s);
    } else {
      collectSubjects(value, out, depth + 1);
    }
  }
  return out;
}

/**
 * This lesson's subject, as its documents have it — raw, for subjectLabel().
 *
 * A real subject beats a placeholder: a document whose metadata says only
 * "general" but whose filename says "علوم - ثاني ابتدائي" is a science lesson,
 * and printing "عام" — which is what happened before — throws away the one
 * place that said so. The placeholder is still the answer when it is genuinely
 * all there is.
 *
 * @param {object[]} docs   the lesson's documents, most authoritative first
 * @param {string} title    the filename, read only when the documents say nothing
 */
export function subjectFromDocuments(docs, title = ""){
  const found = (docs || []).filter(Boolean).flatMap(d => collectSubjects(d));
  return found.find(v => !isGenericSubject(v)) || subjectFromText(title) || found[0] || "";
}

export default subjectLabel;
