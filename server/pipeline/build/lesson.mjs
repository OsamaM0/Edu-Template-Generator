/* ============================================================================
   build/lesson.mjs — worksheets + summary → a differentiated lesson plan
   ----------------------------------------------------------------------------
   The worksheets collection already holds a teacher's view of the lesson —
   structured_goals with their own activities and assessment_methods, plus
   applications, vocabulary and teacher_guidelines. What it does not hold is the
   differentiation: nothing in the data says which activity suits which group.

   That is derived from `priority`, the one signal the data does carry. Goals
   are ordered by it, their activities are dealt into three columns in that
   order, and the fundamental work lands with the group that needs it while the
   extension work lands with the group ready for it. The group descriptions
   themselves are pedagogy, not data, and are written here.
   ========================================================================== */
import { sample, sampleInOrder, shuffle, pick } from "../rng.mjs";
import {
  subjectRow, accentFor, chunkText, summaryParts, difficultyLabel, studentRows,
  schoolRow, teacherRow, examDateRow
} from "./common.mjs";

export const type = "lesson-plan";
export const template = "differentiated-lesson";
export const label = "خطة درس وفق التعليم المتمايز";
export const describes = "خطة درس للمعلم: أهداف وأنشطة وتقويم موزعة على ثلاث مجموعات، من بيانات ورقة العمل والملخص";

export const defaultCounts = {
  goals: null,          // every goal — a plan should not hide objectives
  vocabulary: 6,
  guidelines: 6,
  short_answer: 3       // used as the assessment examples
};

const LEVELS = [
  { level: "basic",    name: "المجموعة الأساسية",  icon: "user",       colTitle: "أنشطة المجموعة الأساسية",  assTitle: "تقويم المجموعة الأساسية",  exIcon: "user" },
  { level: "middle",   name: "المجموعة المتوسطة",  icon: "users",      colTitle: "أنشطة المجموعة المتوسطة",  assTitle: "تقويم المجموعة المتوسطة",  exIcon: "users" },
  { level: "advanced", name: "المجموعة المتقدمة",  icon: "user-check", colTitle: "أنشطة المجموعة المتقدمة",  assTitle: "تقويم المجموعة المتقدمة",  exIcon: "trophy" }
];

const GROUP_TRAITS = {
  basic: [
    "تمتلك استعداداً منخفضاً وتحتاج إلى دعم مستمر.",
    "تحتاج إلى تبسيط المفاهيم وتقديمها في خطوات واضحة.",
    "تستفيد من الأمثلة المباشرة والنماذج المحلولة."
  ],
  middle: [
    "تمتلك استعداداً متوسطاً وتحتاج إلى توجيه جزئي.",
    "تستفيد من العمل التعاوني ومناقشة الأقران.",
    "تحتاج إلى أنشطة تطبيقية متدرجة الصعوبة."
  ],
  advanced: [
    "تمتلك استعداداً مرتفعاً وتسعى إلى التحدي.",
    "تستفيد من المهام المفتوحة والبحث المستقل.",
    "تحتاج إلى أنشطة إثرائية وأسئلة عالية الرتبة."
  ]
};

/* ------------------------------------------------------------- distribution -- */

/** Deal a list into `n` columns, in order, as evenly as the length allows. */
function deal(items, n){
  const columns = Array.from({ length: n }, () => []);
  if (!items.length) return columns;

  const per = Math.ceil(items.length / n);
  items.forEach((item, i) => {
    columns[Math.min(n - 1, Math.floor(i / per))].push(item);
  });

  // A short list would otherwise leave the last columns empty; spread instead.
  if (columns.some(c => !c.length)){
    columns.forEach(c => { c.length = 0; });
    items.forEach((item, i) => columns[i % n].push(item));
  }
  return columns;
}

/** Activities and assessment methods, ordered by how fundamental their goal is. */
function byPriority(structuredGoals, key){
  return [...structuredGoals]
    .sort((a, b) => a.priority - b.priority)
    .flatMap(g => g[key]);
}

/* -------------------------------------------------------------------- build -- */

export function build(lesson, ctx){
  const counts = ctx.counts;
  const w = lesson.worksheet;

  const structured = w.structuredGoals.length
    ? w.structuredGoals
    : lesson.goals.map((text, i) => ({ id: String(i + 1), text, priority: 1, activities: [], assessmentMethods: [] }));

  const goals = sampleInOrder(structured, counts.goals, ctx.stream("goals"));
  const vocab = sample(w.vocabulary, counts.vocabulary, ctx.stream("vocabulary"));
  const guidelines = sampleInOrder(w.teacherGuidelines, counts.guidelines, ctx.stream("guidelines"));
  const applications = shuffle(w.applications, ctx.stream("applications"));
  const examples = sample(lesson.questions.shortAnswer, counts.short_answer, ctx.stream("short_answer"));

  // Anything the goals did not supply falls back to the per-goal activity map.
  const activityPool = byPriority(goals, "activities");
  const fallbackPool = Object.values(w.goalActivities).flat();
  const activities = deal(activityPool.length ? activityPool : fallbackPool, 3);
  const assessments = deal(byPriority(goals, "assessmentMethods"), 3);

  const summary = summaryParts(lesson.summary.body);

  /* --- goals card: split by priority so the plan shows what is core --------- */
  const core = goals.filter(g => g.priority <= 1).map(g => g.text);
  const extension = goals.filter(g => g.priority > 1).map(g => g.text);
  const goalGroups = [];
  if (core.length) goalGroups.push({ icon: "target", title: "أهداف أساسية", items: core });
  if (extension.length) goalGroups.push({ icon: "star", title: "أهداف داعمة", items: extension });
  if (!goalGroups.length) goalGroups.push({ icon: "target", title: "أهداف الدرس", items: goals.map(g => g.text) });

  const data = {
    meta: {
      template: "differentiated-lesson",
      age: ctx.theme,
      color: accentFor(lesson.documentIdx),
      title: `درس: ${lesson.title}`,
      subtitle: "وفق التعليم المتمايز",
      banner: "تعليم يتنوع ليلبي احتياجات كل متعلم .. ويقود إلى تعلم فعّال",
      pageTitle: `خطة درس — ${lesson.title}`,
      art: "book"
    },

    info: [
      { icon: "book",     label: "الموضوع",         value: lesson.title },
      { icon: "calendar", label: "الزمن",           value: "حصة واحدة (45 دقيقة)" },
      // "الزمن" above is how long the lesson runs; this is the day it runs on.
      ...examDateRow(ctx.examDate),
      /* A plan is printed as values, not as lines to write on, so these appear
         only when the request named them. The subject joins them for exactly
         that reason: it comes from the request now, and a plan with no subject
         named is a plan with no المادة row rather than one printing a dash. */
      ...(ctx.subject ? [subjectRow(ctx.subject)] : []),
      ...(ctx.school ? [schoolRow(ctx.school)] : []),
      ...(ctx.teacher ? [teacherRow(ctx.teacher)] : []),
      // A plan issued for one student names them; a class plan says "طلاب الصف".
      ...(ctx.student
        ? studentRows(ctx.student).map(r => ({ ...r, editable: false }))
        : [{ icon: "target", label: "الفئة المستهدفة", value: "طلاب الصف" }])
    ],

    goals: { title: "الأهداف", icon: "target", color: "green", groups: goalGroups },

    groups: {
      title: "تقسيم المجموعات وفق التعليم المتمايز",
      icon: "users",
      items: LEVELS.map(l => ({ level: l.level, name: l.name, icon: l.icon, items: GROUP_TRAITS[l.level] }))
    },

    activities: {
      title: "الأنشطة التعليمية المتمايزة (25 دقيقة)",
      icon: "puzzle",
      color: "purple",
      columns: LEVELS.map((l, i) => {
        const column = { level: l.level, title: l.colTitle, titleIcon: l.icon, items: activities[i] };
        const task = applications[i % Math.max(1, applications.length)];
        if (task) column.example = { icon: l.exIcon, label: "تطبيق:", text: task };
        return column;
      })
    },

    assessment: {
      title: "التقويم المتمايز (10 دقائق)",
      icon: "clipboard-check",
      color: "teal",
      columns: LEVELS.map((l, i) => {
        const column = {
          level: l.level,
          title: l.assTitle,
          icon: l.icon,
          text: assessments[i].join(" ")
        };
        const q = examples[i];
        if (q) column.example = { label: `سؤال (${difficultyLabel(q.difficulty)}):`, text: q.question };
        return column;
      })
    },

    closing: [
      {
        icon: "check", title: "الخاتمة (5 دقائق)", deco: "star", color: "teal",
        items: [
          "مراجعة سريعة لأهم النقاط.",
          "ربط الدرس بالهدف الرئيس.",
          "تقدير جهود المتعلمين وتشجيعهم."
        ],
        note: lesson.summary.ending ? chunkText(lesson.summary.ending, 240)[0] : ""
      },
      {
        icon: "users", title: "دعم إضافي للمتعثرين", deco: "leaf", color: "blue",
        items: [
          "إعادة الشرح بأسلوب مبسط ومخططات توضيحية.",
          "العمل الموجّه مع المعلم في مجموعة صغيرة.",
          "وقت إضافي وممارسة مصحوبة بتغذية راجعة."
        ]
      },
      {
        icon: "star", title: "إثراء للمتقدمين", deco: "trophy", color: "red",
        items: [
          "مهام بحثية مفتوحة حول موضوع الدرس.",
          "أسئلة تحليلية وتقويمية عالية الرتبة.",
          "عرض تقديمي قصير أمام الزملاء."
        ]
      }
    ]
  };

  if (guidelines.length){
    data.strategies = {
      title: "توجيهات المعلم واستراتيجيات التدريس",
      icon: "puzzle",
      color: "teal",
      items: guidelines
    };
  }

  if (vocab.length){
    data.tools = {
      title: "المفاهيم والمصطلحات",
      icon: "book",
      color: "blue",
      items: vocab.map(v => (v.definition ? `${v.term}: ${v.definition}` : v.term))
    };
  }

  if (applications.length){
    // Differentiated homework: the same task pool, one task per group.
    data.homework = {
      title: "الواجب المنزلي المتمايز",
      icon: "notebook",
      color: "yellow",
      items: [...LEVELS].reverse().map((l, i) => ({
        level: l.level,
        icon: l.icon,
        label: l.name,
        text: applications[(applications.length - 1 - i + applications.length) % applications.length]
      }))
    };
  }

  const intro = lesson.summary.opening || summary.intro;
  if (intro){
    data.intro = {
      title: "تمهيد (5 دقائق)",
      icon: "star",
      color: "yellow",
      art: "bulb",
      text: chunkText(intro, 320)[0]
    };

    // The hook goes in the highlighted banner, which is sized for a short line
    // (the core template uses it for formulas). A long question would turn the
    // card into a wall of white-on-color text, so only short ones qualify.
    const hooks = [...lesson.questions.multipleChoice, ...lesson.questions.shortAnswer]
      .filter(q => q.question.length <= 90);
    const opener = pick(hooks, ctx.stream("opener"));
    if (opener) data.intro.equation = opener.question;
  }

  return {
    data,
    title: data.meta.pageTitle,
    used: {
      goals: goals.length,
      activities: activities.flat().length,
      assessments: assessments.flat().length,
      vocabulary: vocab.length,
      guidelines: guidelines.length,
      applications: applications.length
    }
  };
}
