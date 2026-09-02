/* ============================================================================
   answers/group.mjs — many students, one lesson, one picture
   ----------------------------------------------------------------------------
   An assignment answers "what does THIS student not understand". A teacher
   standing in front of a class needs the other question: what did the CLASS not
   understand, and who in it needs help first.

   The unit that answers it is the GROUP. Every issued sheet may carry a group
   id — a lesson id, a class code, a term, anything the caller uses to mean
   "these sheets belong together" — and that id is what everything here reads:

     issue  → assignment.group.id
     submit → the result saved under that assignment
     GET    → every record with that group id, and every result they produced

   Three deliberate decisions:

   · A GROUP IS NOT A REGISTERED THING. It is whatever string the caller sent,
     and it is discovered by reading the assignment records rather than created
     first. Issuing a class stays the same one call it always was.

   · UNSUBMITTED STUDENTS STAY IN THE PICTURE, at percentage null. A dashboard
     that quietly drops the eleven students who did not answer and reports an
     average over the four who did is worse than no dashboard.

   · EVERY NUMBER KEEPS ITS WAY BACK. Each student row carries the links to
     their own report, their own result JSON and their own answers, so the
     class-level claim "six students missed goal 3" is one click from the six
     sheets that say so.
   ========================================================================== */
import { BANDS, bandFor, arabicCount } from "./analyze.mjs";
import * as store from "./store.mjs";
import { readResult } from "./deliver.mjs";

/* ------------------------------------------------------------------- maths -- */

const pct = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null);

const mean = list =>
  (list.length ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(1)) : null);

const median = list => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return Number((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
};

/**
 * A band's shape for a percentage.
 *
 * A null percentage means two different things depending on what is being
 * banded, and the label has to say which: a STUDENT with no percentage did not
 * hand in, a GOAL with no percentage was never asked about.
 */
const banded = (percentage, blank = "لم يُسلَّم") => {
  const band = bandFor(percentage);
  return band
    ? { mastery: band.level, mastery_label: band.label, color: band.color }
    : { mastery: "untested", mastery_label: blank, color: "#8fa6bd" };
};

/* -------------------------------------------------------------- collecting -- */

/**
 * Every sheet issued under one group id, and every result they produced.
 *
 * Results are read for submitted records only — the rest have none by
 * definition — and a missing result file is not an error: the record still
 * counts as submitted, it simply contributes no numbers (participation reports
 * it as `missing_results`).
 *
 * @returns {Promise<{records:Array, results:Map<string,object>}>}
 */
export async function collect(groupId, filter = {}){
  const records = await store.list({ ...filter, groupId });

  const results = new Map();
  await Promise.all(
    records
      .filter(r => r.status === store.STATUS.SUBMITTED)
      .map(async r => {
        const analysis = await readResult(r.id);
        if (analysis) results.set(r.id, analysis);
      })
  );

  return { records, results };
}

/**
 * The groups that exist, most recently active first — worked out from the
 * records, because nothing registers a group in advance.
 */
export async function listGroups(filter = {}){
  const records = (await store.list(filter)).filter(r => r.groupId);
  const groups = new Map();

  for (const r of records){
    let g = groups.get(r.groupId);
    if (!g){
      g = {
        group_id: r.groupId,
        group_name: (r.group && r.group.name) || "",
        lessons: new Set(),
        lesson_titles: new Set(),
        types: new Set(),
        studentKeys: new Set(),
        issued: 0, submitted: 0, pending: 0, closed: 0,
        created_at: r.createdAt,
        last_activity: r.submittedAt || r.openedAt || r.createdAt
      };
      groups.set(r.groupId, g);
    }

    if (!g.group_name && r.group && r.group.name) g.group_name = r.group.name;
    g.lessons.add(String(r.documentIdx));
    if (r.lessonTitle) g.lesson_titles.add(r.lessonTitle);
    g.types.add(r.type);
    g.studentKeys.add(r.studentId || r.id);

    g.issued++;
    if (r.status === store.STATUS.SUBMITTED) g.submitted++;
    else if (r.status === store.STATUS.ISSUED) g.pending++;
    else g.closed++;

    if (String(r.createdAt) < String(g.created_at)) g.created_at = r.createdAt;
    const touched = r.submittedAt || r.openedAt || r.createdAt;
    if (String(touched) > String(g.last_activity)) g.last_activity = touched;
  }

  return [...groups.values()]
    .map(g => ({
      group_id: g.group_id,
      group_name: g.group_name,
      lessons: [...g.lessons],
      lesson_titles: [...g.lesson_titles],
      types: [...g.types],
      students: g.studentKeys.size,
      issued: g.issued,
      submitted: g.submitted,
      pending: g.pending,
      closed: g.closed,
      submission_rate: pct(g.submitted, g.issued),
      created_at: g.created_at,
      last_activity: g.last_activity
    }))
    .sort((a, b) => String(b.last_activity).localeCompare(String(a.last_activity)));
}

/* ------------------------------------------------------------- per student -- */

/**
 * One row per issued sheet. A student who has not answered is a row too — with
 * their link still on it, which is the thing a teacher actually wants to do
 * about them.
 */
function studentRow(record, analysis, links){
  const base = {
    assignment_id: record.id,
    status: record.status,
    student: record.student || { id: record.studentId || "", name: "", classroom: "", section: "" },
    student_id: record.studentId || "",
    student_name: (record.student && record.student.name) || "",
    classroom: (record.student && record.student.classroom) || "",
    section: (record.student && record.student.section) || "",
    type: record.type,
    document_idx: record.documentIdx,
    lesson_title: record.lessonTitle,
    seed: record.seed,
    question_count: (record.answerKey || []).length,
    issued_at: record.createdAt,
    opened_at: record.openedAt,
    submitted_at: record.submittedAt,
    ...links(record)
  };

  if (!analysis){
    return {
      ...base,
      ...banded(null),
      answered: false,
      percentage: null, score_percentage: null,
      correct: 0, wrong: 0, total: 0, unanswered: 0, needs_review: 0,
      weakest_goals: [],
      headline: record.status === store.STATUS.ISSUED
        ? "لم يسلّم بعد — رابطه ما زال صالحاً."
        : `الرابط ${record.status === store.STATUS.REVOKED ? "مُلغى" : "منتهٍ"} دون تسليم.`,
      next_step: ""
    };
  }

  const summary = analysis.overall;
  const goals = Object.values(analysis.goals || {});

  /* A survey is not banded. "متقن"/"لم يتحقق" describe how much of a lesson a
     student has learnt, and a learning-styles questionnaire measures nothing of
     the sort — so a profile row shows what the sheet FOUND (the dominant style)
     where a marked row shows how well it went. */
  const profile = analysis.scoring === "profile";
  const verdict = profile ? ((analysis.profile || {}).verdict || {}) : null;

  return {
    ...base,
    ...(profile
      ? {
          mastery: summary.mastery,
          mastery_label: summary.mastery_label,
          color: verdict.color || "#1f6f8b"
        }
      : banded(summary.percentage)),
    scoring: profile ? "profile" : "mastery",
    answered: true,
    percentage: summary.percentage,
    score_percentage: summary.score_percentage,
    correct: summary.correct,
    wrong: summary.wrong,
    total: summary.total,
    unanswered: summary.unanswered,
    needs_review: summary.needs_review,
    /* The three goals this student is furthest from — the reason the row is
       worth opening, shown without having to open it. On a survey the same slot
       carries the STRONGEST styles instead: it is the finding, and a survey has
       no goal anyone is behind on. */
    weakest_goals: profile
      ? goals
          .filter(g => g.percentage != null)
          .sort((a, b) => b.percentage - a.percentage)
          .slice(0, 3)
          .map(g => ({ goal_id: g.goal_id, goal_text: g.goal_text, percentage: g.percentage }))
      : goals
          .filter(g => g.total > 0 && g.percentage < 60)
          .sort((a, b) => a.percentage - b.percentage)
          .slice(0, 3)
          .map(g => ({ goal_id: g.goal_id, goal_text: g.goal_text, percentage: g.percentage })),
    headline: (analysis.report && analysis.report.headline) || "",
    next_step: (analysis.report && analysis.report.next_steps && analysis.report.next_steps[0]) || ""
  };
}

/* ---------------------------------------------------------------- per goal -- */

/**
 * The class's grip on each goal.
 *
 * Two percentages, because they answer different questions:
 * `average_percentage` is the mean of what the students scored (how the class
 * did), `class_percentage` pools every answer to that goal (how the goal
 * itself fared). They part company when one student answered far more of a
 * goal's questions than another, and a teacher reading both learns something.
 */
function goalRollup(analyses){
  const goals = new Map();

  for (const analysis of analyses){
    for (const g of Object.values(analysis.goals || {})){
      let row = goals.get(g.goal_id);
      if (!row){
        row = {
          goal_id: g.goal_id,
          goal_text: g.goal_text || "",
          cognitive_level: g.cognitive_level || "",
          students: 0, tested_students: 0,
          correct: 0, total: 0, unanswered: 0, needs_review: 0,
          mastered: 0, proficient: 0, struggling: 0,
          percentages: [],
          students_needing_work: []
        };
        goals.set(g.goal_id, row);
      }
      if (!row.goal_text && g.goal_text) row.goal_text = g.goal_text;

      row.students++;
      if (!g.total) continue;               // the sheet never tested this student on it

      row.tested_students++;
      row.correct += g.correct;
      row.total += g.total;
      row.unanswered += g.unanswered || 0;
      row.needs_review += g.needs_review || 0;
      row.percentages.push(g.percentage);

      if (g.percentage >= 90) row.mastered++;
      else if (g.percentage >= 75) row.proficient++;

      if (g.percentage < 60){
        row.struggling++;
        row.students_needing_work.push({
          assignment_id: analysis.assignment_id,
          student_id: (analysis.student && analysis.student.id) || "",
          student_name: (analysis.student && analysis.student.name) || "",
          percentage: g.percentage
        });
      }
    }
  }

  return [...goals.values()]
    .map(row => {
      const { percentages, ...rest } = row;
      const average = mean(percentages);
      return {
        ...rest,
        average_percentage: average,
        class_percentage: pct(row.correct, row.total),
        median_percentage: median(percentages),
        ...banded(average, "لم يُختبر"),
        students_needing_work: row.students_needing_work.sort((a, b) => a.percentage - b.percentage),
        recommendation: goalAdvice(row, average)
      };
    })
    .sort((a, b) => {
      if (a.tested_students === 0 && b.tested_students !== 0) return 1;
      if (b.tested_students === 0 && a.tested_students !== 0) return -1;
      return (a.average_percentage ?? 101) - (b.average_percentage ?? 101);
    });
}

/** What to do about a goal — addressed to the teacher, not to a student. */
function goalAdvice(row, average){
  const named = row.goal_text ? `«${row.goal_text}»` : "هذا الهدف";
  const strugglers = arabicCount(row.struggling, "طالب واحد", "طالبان", "طلاب");

  if (!row.tested_students){
    return `لم تختبر أي ورقة في هذه المجموعة ${named} — أضف أسئلة عليه قبل الحكم على تحقّقه.`;
  }
  if (average >= 90){
    return `${named}: أتقنته المجموعة (${average}%). انتقل إلى تطبيقات أعمق، واستعن بالمتقنين في شرحه لزملائهم.`;
  }
  if (average >= 75){
    return `${named}: فهم المجموعة له جيد جداً (${average}%). ${row.struggling ? `راجعه مع ${strugglers} فقط.` : "مراجعة سريعة تكفي."}`;
  }
  if (average >= 60){
    return `${named}: المجموعة قريبة من الإتقان (${average}%). خصّص له تمريناً صفياً واحداً، و${strugglers} يحتاجون متابعة فردية.`;
  }
  return `${named}: لم يتحقق للمجموعة (${average}%) — ${strugglers} تحت 60%. أعد شرحه للصف كاملاً قبل الانتقال إلى ما بعده.`;
}

/* ------------------------------------------------------------ per question -- */

/**
 * The same question across every sheet that asked it. A question a fifth of the
 * class got right is either a hard question or a badly worded one, and either
 * way the teacher should see it before the next lesson.
 *
 * Keyed by question id, not by position: two students with different seeds get
 * different questions, and pooling by position would compare unrelated things.
 */
function questionRollup(analyses){
  const questions = new Map();

  for (const analysis of analyses){
    for (const q of analysis.questions || []){
      let row = questions.get(q.question_id);
      if (!row){
        row = {
          question_id: q.question_id,
          question: q.question,
          kind: q.kind,
          goal_id: q.goal_id || "",
          goal_text: q.goal_text || "",
          difficulty: q.difficulty || "",
          correct_answer: q.correct_answer,
          asked: 0, correct: 0, wrong: 0, unanswered: 0, needs_review: 0,
          wrongAnswers: []
        };
        questions.set(q.question_id, row);
      }

      row.asked++;
      if (q.correct) row.correct++;
      else row.wrong++;

      if (!q.answered) row.unanswered++;
      else if (!q.correct && q.student_answer){
        /* What they said instead. A wrong answer several students gave is a
           misconception with a name, which beats the count of failures. */
        row.wrongAnswers.push(q.student_answer);
      }
      if (q.needs_review) row.needs_review++;
    }
  }

  return [...questions.values()]
    .map(({ wrongAnswers, ...row }) => ({
      ...row,
      success_rate: pct(row.correct, row.asked),
      common_wrong_answers: topAnswers(wrongAnswers)
    }))
    .sort((a, b) => (a.success_rate ?? 101) - (b.success_rate ?? 101));
}

/** The wrong answers more than one student gave, commonest first. */
function topAnswers(list){
  const counts = new Map();
  for (const answer of list){
    const key = String(answer).trim();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([answer, count]) => ({ answer, count }));
}

/* -------------------------------------------------------------- the whole -- */

/** How many students landed in each mastery band — the shape of the class. */
function distribution(rows){
  const answered = rows.filter(r => r.answered);
  return BANDS.map(band => {
    const count = answered.filter(r => r.mastery === band.level).length;
    return {
      level: band.level, label: band.label, color: band.color,
      count, percentage: pct(count, answered.length)
    };
  });
}

/**
 * The written read of the class. Same rule as the per-student report: the prose
 * never says anything the numbers do not.
 */
function writeGroupReport({ group, participation, overall, goals, questions, students }){
  const who = group.name ? `«${group.name}»` : `المجموعة ${group.id}`;

  const headline = participation.submitted === 0
    ? `${who}: صدرت ${arabicCount(participation.issued, "ورقة واحدة", "ورقتان", "أوراق")} ولم تُسلَّم أي ورقة بعد.`
    : `${who}: سلّم ${participation.submitted} من ${participation.issued} — متوسط المجموعة ${overall.average_percentage}% (${overall.mastery_label}).`;

  const lines = [headline];
  if (participation.submitted === 0 || overall.answered_students === 0){
    return { headline, lines, next_steps: [] };
  }

  const tested = goals.filter(g => g.tested_students > 0);
  const strong = tested.filter(g => g.average_percentage >= 75);
  const weak = tested.filter(g => g.average_percentage < 60);
  const untested = goals.filter(g => g.tested_students === 0);

  lines.push(
    strong.length
      ? `أهداف أتقنتها المجموعة: ${strong.map(g => g.goal_text || g.goal_id).join("، ")}.`
      : "لم يبلغ أي هدف مستوى الإتقان على مستوى المجموعة."
  );

  if (weak.length){
    lines.push(`أهداف تحتاج إعادة شرح للصف: ${weak.map(g => `${g.goal_text || g.goal_id} (${g.average_percentage}%)`).join("، ")}.`);
  }

  const needSupport = students.filter(s => s.answered && s.percentage < 60);
  if (needSupport.length){
    lines.push(`${arabicCount(needSupport.length, "طالب واحد", "طالبان", "طلاب")} تحت 60%: ${needSupport.map(s => s.student_name || s.student_id).join("، ")} — متابعة فردية.`);
  }

  const hardest = questions.filter(q => q.asked > 1 && q.success_rate != null && q.success_rate < 50).slice(0, 3);
  if (hardest.length){
    lines.push(`أصعب الأسئلة: ${hardest.map(q => `«${String(q.question).slice(0, 60)}» (${q.success_rate}%)`).join("، ")}.`);
  }

  if (participation.pending){
    lines.push(`${arabicCount(participation.pending, "ورقة واحدة", "ورقتان", "أوراق")} لم تُسلَّم بعد — روابطها ما زالت صالحة في جدول الطلاب.`);
  }
  if (overall.needs_review){
    lines.push(`${arabicCount(overall.needs_review, "إجابة واحدة", "إجابتان", "إجابات")} مفتوحة صُحّحت آلياً وتحتاج نظرة المعلم.`);
  }
  if (untested.length){
    lines.push(`${untested.length} من أهداف الدرس لم تختبرها أوراق هذه المجموعة: ${untested.map(g => g.goal_text || g.goal_id).join("، ")}.`);
  }

  return {
    headline,
    lines,
    // The action list: what to do with the class, then who to sit with.
    next_steps: [
      ...tested.filter(g => g.average_percentage < 75).slice(0, 4).map(g => g.recommendation),
      ...needSupport.slice(0, 4).map(s =>
        `تابع ${s.student_name || s.student_id} فردياً (${s.percentage}%): ${s.weakest_goals.map(g => g.goal_text || g.goal_id).join("، ") || "راجع تقريره الكامل"}.`)
    ]
  };
}

/**
 * The whole picture for one group.
 *
 * @param {object} input
 *   groupId  the id every record was issued under
 *   records  the assignment records (collect())
 *   results  assignment_id → analysis (collect())
 *   links    record → the URLs that record's own report lives at
 * @returns {object} the JSON the dashboard renders and the API returns
 */
export function analyseGroup({ groupId, records, results, links, generatedAt }){
  const named = records.find(r => r.group && r.group.name);
  const group = { id: groupId, name: (named && named.group.name) || "" };

  /* The sitting's own header. Read off the sheets rather than stored on the
     group: the records ARE the group here, and the first one that names a
     school is as authoritative as anything else would be. */
  const school = (records.find(r => r.school && r.school.name) || {}).school || null;
  const teacher = (records.find(r => r.teacher && r.teacher.name) || {}).teacher || null;

  const students = records.map(r => studentRow(r, results.get(r.id) || null, links));
  const analyses = records.map(r => results.get(r.id)).filter(Boolean);
  const answered = students.filter(s => s.answered);
  const percentages = answered.map(s => s.percentage).filter(p => p != null);

  const submitted = records.filter(r => r.status === store.STATUS.SUBMITTED);
  const participation = {
    issued: records.length,
    students: new Set(records.map(r => r.studentId || r.id)).size,
    opened: records.filter(r => r.openedAt).length,
    submitted: submitted.length,
    pending: records.filter(r => r.status === store.STATUS.ISSUED).length,
    revoked: records.filter(r => r.status === store.STATUS.REVOKED).length,
    missing_results: submitted.filter(r => !results.has(r.id)).length,
    submission_rate: pct(submitted.length, records.length)
  };

  const average = mean(percentages);
  const overall = {
    answered_students: answered.length,
    average_percentage: average,
    median_percentage: median(percentages),
    highest_percentage: percentages.length ? Math.max(...percentages) : null,
    lowest_percentage: percentages.length ? Math.min(...percentages) : null,
    total_questions: answered.reduce((n, s) => n + s.total, 0),
    total_correct: answered.reduce((n, s) => n + s.correct, 0),
    unanswered: answered.reduce((n, s) => n + s.unanswered, 0),
    needs_review: answered.reduce((n, s) => n + s.needs_review, 0),
    ...banded(average)
  };

  /* One group usually means one lesson, but nothing stops a caller from
     grouping a whole unit — so what it spans is reported, not assumed. */
  const lessons = [];
  for (const r of records){
    const found = lessons.find(l => l.document_idx === r.documentIdx && l.type === r.type);
    if (found) found.sheets++;
    else lessons.push({ document_idx: r.documentIdx, lesson_title: r.lessonTitle, type: r.type, sheets: 1 });
  }

  const goals = goalRollup(analyses);
  const questions = questionRollup(analyses);

  return {
    schema: "pipeline.group-analysis/1",
    group,
    school,
    teacher,
    generated_at: generatedAt || new Date().toISOString(),
    lessons,
    participation,
    overall,
    distribution: distribution(students),
    goals,
    questions,
    /* Weakest-first is the reading order everywhere else in this file; the
       student table is the one place a teacher also wants the top of the
       class, so it goes by score and the unanswered sink to the bottom. */
    students: [...students].sort((a, b) => {
      if (a.answered !== b.answered) return a.answered ? -1 : 1;
      return (b.percentage ?? -1) - (a.percentage ?? -1);
    }),
    report: writeGroupReport({ group, participation, overall, goals, questions, students })
  };
}

/**
 * Everything the group answered, exactly as it arrived, with the graded reading
 * of it beside it. This is the "give me all the answers of this group" call —
 * analyseGroup() above says what they MEAN, this says what was SAID.
 */
export function groupAnswers({ groupId, records, results, links }){
  const named = records.find(r => r.group && r.group.name);

  const submissions = records
    .filter(r => results.has(r.id))
    .map(r => {
      const analysis = results.get(r.id);
      return {
        assignment_id: r.id,
        student: analysis.student,
        document_idx: analysis.document_idx,
        lesson_title: analysis.lesson_title,
        type: analysis.type,
        seed: analysis.seed,
        issued_at: r.createdAt,
        submitted_at: analysis.submitted_at,
        overall: analysis.overall,
        /* Raw first: {question_id: answer}, exactly what the student's browser
           sent. A re-grade has to be able to start from this. */
        answers: analysis.answers,
        questions: (analysis.questions || []).map(q => ({
          question_id: q.question_id,
          position: q.position,
          kind: q.kind,
          question: q.question,
          goal_id: q.goal_id,
          goal_text: q.goal_text,
          student_answer: q.student_answer,
          correct_answer: q.correct_answer,
          answered: q.answered,
          correct: q.correct,
          score: q.score,
          needs_review: q.needs_review,
          detail: q.detail
        })),
        goals: analysis.goals,
        report: analysis.report,
        ...links(r)
      };
    });

  return {
    schema: "pipeline.group-answers/1",
    group: { id: groupId, name: (named && named.group.name) || "" },
    generated_at: new Date().toISOString(),
    issued: records.length,
    submitted: submissions.length,
    /* Who still owes an answer, with the link that is still theirs to use —
       "all the answers" is only honest if it says whose are missing. */
    pending: records
      .filter(r => r.status === store.STATUS.ISSUED)
      .map(r => ({
        assignment_id: r.id,
        student: r.student,
        issued_at: r.createdAt,
        opened_at: r.openedAt,
        ...links(r)
      })),
    submissions
  };
}
