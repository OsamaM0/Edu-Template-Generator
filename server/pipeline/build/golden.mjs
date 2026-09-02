/* ============================================================================
   build/golden.mjs — the golden-minutes card for one session
   ----------------------------------------------------------------------------
   A one-page teacher card: what the first five minutes look like, what the last
   five look like, and what to decide afterwards. The skeleton is fixed — it is
   a school instrument, not generated content — but the four slots that should
   be about THIS lesson are filled from the data:

     · the opening question          a question drawn by the seed
     · the learning outcome          the lesson's first goal
     · the launch task               one of the worksheet applications
     · the check question            a different question, drawn separately

   Blank rows are intentional: the teacher writes the class in by hand. The
   three the caller can name — `school`, `teacher` and `exam_date` — arrive
   printed instead, so a card handed out to a whole department already carries
   the same header on every copy.
   ========================================================================== */
import { pick, sample } from "../rng.mjs";
import { subjectLabel, accentFor, chunkText, studentLabel } from "./common.mjs";

export const type = "golden-minutes";
export const template = "golden-minutes";
export const label = "بطاقة الدقائق الذهبية";
export const describes = "بطاقة الحصة: أول خمس دقائق وآخر خمس دقائق وقرار المعلم، بأسئلة ومهام من الدرس";

export const defaultCounts = { goals: 1 };

export function build(lesson, ctx){
  const allQuestions = [
    ...lesson.questions.multipleChoice,
    ...lesson.questions.shortAnswer,
    ...lesson.questions.trueFalse
  ];

  // Two separate draws, then de-duplicated: the opener and the check should not
  // be the same question on a card that is read top to bottom.
  const drawn = sample(allQuestions, 2, ctx.stream("session-questions"));
  const opener = drawn[0] || null;
  const check = drawn[1] || drawn[0] || null;

  const outcome = lesson.goals[0] || "";
  const launch = pick(lesson.worksheet.applications, ctx.stream("launch"));
  const exit = pick(lesson.worksheet.applications.filter(a => a !== launch), ctx.stream("exit")) || launch;
  const bigIdea = chunkText(lesson.summary.opening || lesson.summary.body, 160)[0] || "";

  const data = {
    meta: {
      template: "golden-minutes",
      age: ctx.theme,
      color: accentFor(lesson.documentIdx),
      title: "بطاقة الدقائق الذهبية للحصة",
      pageTitle: `الدقائق الذهبية — ${lesson.title}`,
      org: { title: "", subtitle: "" },
      // Decoration slots take emoji, not icon names: the golden-minutes CSS
      // only sizes .pic-emoji in the deco spots, so a built-in icon would
      // render at its full default size and swamp the card.
      art: "🌿",
      titleDeco: "🌿",
      footer: "🤍"
    },

    session: {
      number: 1, title: "بيانات الحصة", color: "teal",
      rows: [
        { icon: "school",   label: "اسم المدرسة",              value: (ctx.school && ctx.school.name) || "" },
        ...(ctx.student ? [{ icon: "id", label: "الطالب", value: studentLabel(ctx.student) }] : []),
        // The long form: this row asks for the weekday as well as the date.
        { icon: "calendar", label: "اليوم والتاريخ",           value: ctx.examDate ? ctx.examDate.long : "" },
        { icon: "book",     label: "المادة والصف",             value: subjectLabel(lesson.subject) },
        { icon: "clock",    label: "مدة الحصة",                value: "45 دقيقة" },
        { icon: "target",   label: "عنوان الدرس",              value: lesson.title },
        { icon: "bulb",     label: "ناتج التعلم الأساسي",       value: outcome },
        { icon: "brain",    label: "المعرفة السابقة المطلوبة",  value: "", wide: true },
        { icon: "question", label: "سؤال بداية الحصة",          value: opener ? opener.question : "", wide: true }
      ]
    },

    firstFive: {
      number: 2, title: "أول خمس دقائق", color: "teal",
      items: [
        { icon: "clipboard", label: "الدقيقة الأولى",  text: "الاستعداد وتهيئة البيئة الصفية" },
        { icon: "question",  label: "الدقيقة الثانية", text: opener ? opener.question : "سؤال محفز" },
        { icon: "brain",     label: "الدقيقة الثالثة", text: "استدعاء المعرفة السابقة" },
        { icon: "star",      label: "الدقيقة الرابعة", text: outcome || "ناتج التعلم",
          sub: "في نهاية الحصة سأستطيع أن..." },
        { icon: "rocket",    label: "الدقيقة الخامسة", text: launch || "مهمة الانطلاق" }
      ]
    },

    readiness: {
      number: 3, title: "مؤشر جاهزية الطلاب", color: "green", deco: "🤍🌿",
      items: [
        { icon: "check",   text: "جاهزون لبدء الدرس" },
        { icon: "refresh", text: "يحتاجون إلى مراجعة سريعة" },
        { icon: "level",   text: "تفاوت واضح في المعرفة السابقة" },
        { icon: "pencil",  text: "البيانات غير كافية" }
      ]
    },

    lastFive: {
      number: 4, title: "آخر خمس دقائق", color: "green",
      items: [
        { icon: "bulb",   text: bigIdea || "تلخيص الفكرة الرئيسة" },
        { icon: "search", text: check ? check.question : "سؤال تحقق" },
        { icon: "timer",  text: exit || "تطبيق سريع" },
        { icon: "pencil", text: "بطاقة خروج: ما الذي تعلمته؟ وما الذي ما زال غامضاً؟" },
        { icon: "next",   text: "الخطوة القادمة" }
      ]
    },

    decision: {
      number: 5, title: "قرار المعلم بعد الحصة", color: "green",
      items: [
        { icon: "target",  text: "متابعة الخطة كما هي" },
        { icon: "refresh", text: "إعادة التدريس بأسلوب مختلف" },
        { icon: "users",   text: "تقديم دعم إضافي لبعض الطلاب" },
        { icon: "star",    text: "توسيع التعلم للطلاب المتقنين" }
      ]
    },

    note: { number: 6, title: "ملاحظة سريعة", color: "teal", text: "", lines: 3, deco: "🌿" },

    teacher: {
      number: 7, title: "اسم المعلم", color: "teal", icon: "user",
      name: (ctx.teacher && ctx.teacher.name) || "",
      fields: [
        { label: "التوقيع", value: "" },
        { label: "التاريخ", value: ctx.examDate ? ctx.examDate.text : "" }
      ]
    },

    visitor: { title: "ملاحظة الزائر (عند وجود زيارة)", icon: "clipboard", text: "", lines: 2, color: "teal" }
  };

  return {
    data,
    title: data.meta.pageTitle,
    used: {
      opener: opener ? 1 : 0,
      check: check ? 1 : 0,
      applications: [launch, exit].filter(Boolean).length,
      goals: outcome ? 1 : 0
    }
  };
}
