/* ============================================================================
   answers/report.mjs — the analysis, as a page a teacher can read or print
   ----------------------------------------------------------------------------
   Self-contained on purpose: no stylesheet links, no scripts, no fonts that
   have to load. The same file is written to the output directory, served from
   /api/pipeline/report/<id>, and mailed around as an attachment, and it has to
   look the same in all three — including on a machine that has never seen this
   server.

   What the page is FOR decides its order. A teacher opens it to answer one
   question — what does this student still not understand — so the goals come
   first, weakest at the top, each with the sentence that says what to do about
   it. The question-by-question table is underneath for when they want to check
   a specific answer, and the raw JSON is at the bottom for when they don't
   trust either.

   A SURVEY IS THE SAME PAGE with three words changed. learning-pattern is
   scored as a profile, not marked (answers/profile.mjs), so its "goals" are
   learning styles, its percentages are affinities rather than marks, and its
   statements have no model answer to print. The analysis carries
   `scoring: "profile"` and every block below branches on that one field — the
   layout, the CSS and the print rules stay shared, because a teacher reading
   both should not have to learn two pages.
   ========================================================================== */
import { BANDS } from "./analyze.mjs";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** JSON safe to sit inside a <script> / <pre> block. */
const jsonForPage = v => JSON.stringify(v, null, 2)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const KIND_LABEL = {
  multiple_choice: "اختيار من متعدد",
  true_false: "صح أو خطأ",
  complete: "أكمل الفراغ",
  short_answer: "إجابة قصيرة",
  scale: "عبارة على مقياس"
};

/** Is this the analysis of a survey rather than of a marked sheet? */
const isProfile = analysis => analysis && analysis.scoring === "profile";

/** A percentage as text, or a dash where there is nothing to report. */
const num = v => (v == null ? "—" : `${v}%`);

/** Arabic-friendly date, with the ISO stamp kept as the machine-readable one. */
function when(iso){
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ pieces -- */

/** The headline tile: one number, and the word that number means. */
function scoreTile(analysis){
  const overall = analysis.overall;
  const shown = overall.percentage == null ? 0 : overall.percentage;

  /* On a survey the dial shows the DOMINANT STYLE's affinity and takes that
     style's colour — there is no mastery band to fall in, and painting a survey
     red for a low number would be reading a preference as a failure. */
  const profile = isProfile(analysis);
  const verdict = profile ? ((analysis.profile || {}).verdict || {}) : null;
  const band = profile
    ? { color: verdict.color || "#1f6f8b", label: verdict.label || "غير محدد" }
    : (BANDS.find(b => overall.percentage != null && overall.percentage >= b.min) || BANDS[BANDS.length - 1]);

  const sub = profile
    ? `${overall.answered} عبارة مُجابة من ${overall.total}`
    : `${overall.correct} إجابة صحيحة من ${overall.total}`;

  return `<div class="score" style="--band:${band.color}">
    <div class="dial" style="--p:${shown}">
      <span class="dial-v">${overall.percentage == null ? "—" : shown}<small>%</small></span>
    </div>
    <div class="score-tx">
      <strong>${esc(band.label)}</strong>
      <span>${esc(sub)}</span>
    </div>
  </div>`;
}

const statChips = analysis => {
  const o = analysis.overall;
  const rows = isProfile(analysis)
    ? [
        ["عبارة مُجابة", o.answered, "#1f9d61"],
        ["بدون إجابة", o.unanswered, "#8fa6bd"],
        ["نقطة", o.points, "#1f6f8b"],
        ["من أصل", o.max_points, "#8fa6bd"]
      ]
    : [
        ["صحيحة", o.correct, "#1f9d61"],
        ["خاطئة", o.wrong - o.unanswered, "#d9534f"],
        ["بدون إجابة", o.unanswered, "#8fa6bd"],
        ["تحتاج مراجعة", o.needs_review, "#d8a11e"]
      ];

  return `<div class="chips">
    ${rows.map(([label, value, color]) => `
      <span class="chip" style="--c:${color}"><b>${value}</b> ${esc(label)}</span>`).join("")}
  </div>`;
};

/**
 * Goals, weakest first — the order a teacher reads them in, because the weakest
 * goal is the one they have to act on.
 *
 * A survey's styles are ordered the other way round, STRONGEST first: nothing
 * there needs acting on, and the finding is which channel reaches this student
 * best. Same markup, opposite sort, because they answer opposite questions.
 */
function goalRows(goals, profile){
  const ordered = [...goals].sort((a, b) => {
    if (profile) return (b.percentage ?? -1) - (a.percentage ?? -1);
    if (a.total === 0 && b.total !== 0) return 1;
    if (b.total === 0 && a.total !== 0) return -1;
    return (a.percentage ?? 101) - (b.percentage ?? 101);
  });

  return ordered.map(g => `
    <article class="goal" style="--c:${g.color}">
      <header>
        <span class="badge">${esc(g.mastery_label)}</span>
        <h3>${esc(g.goal_text || g.goal_id)}</h3>
        <span class="gid">${esc(g.goal_id)}</span>
      </header>

      <div class="bar" role="img" aria-label="${num(g.percentage)}">
        <span style="width:${g.percentage == null ? 0 : g.percentage}%"></span>
      </div>

      <div class="goal-nums">
        <span class="pc">${num(g.percentage)}</span>
        ${profile
          ? `<span>النقاط: <b>${g.points}</b> من <b>${g.max_points}</b></span>
             <span>العبارات: <b>${g.total}</b></span>`
          : `<span>صحيحة: <b>${g.correct}</b></span>
             <span>خاطئة: <b>${g.wrong}</b></span>
             <span>الأسئلة: <b>${g.total}</b></span>`}
        ${g.unanswered ? `<span>بدون إجابة: <b>${g.unanswered}</b></span>` : ""}
      </div>

      <p class="advice">${esc(g.recommendation)}</p>
    </article>`).join("");
}

/**
 * One row per question. The mark says what happened, not just right/wrong.
 *
 * On a survey the fourth column cannot hold a model answer — there is none — so
 * it holds what the tick was WORTH, which is the number the profile was built
 * from and the only thing worth checking a statement against.
 */
function questionRows(questions, profile){
  return questions.map(q => {
    const mark = !q.answered ? ["skip", "بدون إجابة"]
      : profile ? ["ok", "مُسجَّلة"]
      : q.correct ? ["ok", "صحيحة"]
      : q.needs_review ? ["review", "تحتاج مراجعة"]
      : ["no", "خاطئة"];

    /* data-label repeats the column heading on every cell — invisible while
       this is a table, and what the cell is labelled with on a phone, where the
       row becomes a card and the <thead> is gone. The survey and the marked
       sheet head two of these columns differently, so the labels follow the
       same `profile` switch the headings do. */
    return `<tr class="is-${mark[0]}">
      <td class="n">${q.position}</td>
      <td class="q" data-label="${profile ? "العبارة" : "السؤال"}">
        ${esc(q.question)}
        <span class="meta">${esc(KIND_LABEL[q.kind] || q.kind)}${q.goal_text ? ` · ${esc(q.goal_text)}` : ""}</span>
      </td>
      <td data-label="${profile ? "استجابة الطالب" : "إجابة الطالب"}">${esc(q.student_answer) || "<i>—</i>"}</td>
      <td class="key" data-label="${profile ? "النقاط" : "الإجابة النموذجية"}">${profile
        ? (q.answered ? `${q.points} / ${q.max_points}` : "<i>—</i>")
        : (esc(q.correct_answer) || "<i>—</i>")}</td>
      <td class="mark" data-label="النتيجة"><span class="pill">${esc(mark[1])}</span>${q.detail ? `<span class="why">${esc(q.detail)}</span>` : ""}</td>
    </tr>`;
  }).join("");
}

/* -------------------------------------------------------------------- page -- */

/**
 * @param {object} analysis  the object from analyze()
 * @returns {string} a complete, standalone HTML document
 */
export function renderReport(analysis){
  const s = analysis.student || {};
  const who = s.name || (s.id ? `الطالب ${s.id}` : "الطالب");
  const goals = Object.values(analysis.goals || {});
  // A survey renames a few things and reverses one sort; everything else is shared.
  const profile = isProfile(analysis);
  const report = analysis.report || {};

  const identity = [
    ["الطالب", s.name],
    ["رقم الطالب", s.id],
    ["الصف", s.classroom],
    // Only present when the request that issued the sheet named them, which is
    // why every row here is dropped rather than printed empty.
    ["المدرسة", analysis.school && analysis.school.name],
    ["المعلم / المعلمة", analysis.teacher && analysis.teacher.name],
    ["الدرس", analysis.lesson_title],
    ["رقم الدرس", analysis.document_idx],
    ["تاريخ الاختبار", analysis.exam_date && (analysis.exam_date.text || analysis.exam_date.iso)],
    ["تاريخ التسليم", when(analysis.submitted_at)]
  ].filter(([, v]) => v != null && v !== "" && v !== "—");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تحليل نتائج — ${esc(who)}</title>
<meta name="generator" content="EduWebTemplateGenerator · pipeline">
<style>
  *{box-sizing:border-box; margin:0; padding:0;}
  body{
    font-family:"Cairo","Segoe UI",system-ui,sans-serif;
    background:#eef3f9; color:#22344d; line-height:1.7;
    padding:22px 14px 60px;
    /* iOS Safari inflates text in landscape unless told not to. */
    -webkit-text-size-adjust:100%;
  }
  .sheet{max-width:940px; margin:0 auto; background:#fff; border-radius:18px;
    box-shadow:0 10px 34px rgba(31,58,94,.10); overflow:hidden;}

  /* --- head --- */
  .head{background:linear-gradient(135deg,#1f6f8b,#2e9e9e); color:#fff; padding:22px 26px;}
  .head h1{font-size:22px; font-weight:800;}
  .head p{opacity:.9; font-size:13.5px; margin-top:3px;}
  .id-grid{display:flex; flex-wrap:wrap; gap:8px; margin-top:14px;}
  .id-grid div{background:rgba(255,255,255,.16); border-radius:9px; padding:5px 12px; font-size:12.5px;}
  .id-grid b{font-weight:800;}

  /* --- overall --- */
  .top{display:flex; flex-wrap:wrap; gap:20px; align-items:center;
    padding:20px 26px; border-bottom:1px solid #e6eef7;}
  .score{display:flex; align-items:center; gap:14px;}
  .dial{
    position:relative;
    width:104px; height:104px; border-radius:50%; display:grid; place-items:center;
    background:conic-gradient(var(--band) calc(var(--p)*1%), #e6eef7 0);
    flex:0 0 auto;
  }
  .dial::before{content:""; position:absolute; width:78px; height:78px; border-radius:50%; background:#fff;}
  .dial-v{position:relative; font-size:25px; font-weight:800; color:var(--band);}
  .dial-v small{font-size:13px; font-weight:700;}
  .score-tx{display:flex; flex-direction:column;}
  .score-tx strong{font-size:19px; color:var(--band);}
  .score-tx span{font-size:13.5px; color:#5b7189;}
  .chips{display:flex; flex-wrap:wrap; gap:8px; margin-inline-start:auto;}
  .chip{border:1.6px solid var(--c); color:var(--c); border-radius:999px;
    padding:3px 13px; font-size:12.5px; font-weight:700;}
  .chip b{font-weight:800; font-size:14px;}

  /* --- sections --- */
  section{padding:20px 26px; border-bottom:1px solid #e6eef7;}
  section > h2{font-size:16px; font-weight:800; color:#1f6f8b; margin-bottom:12px;
    display:flex; align-items:center; gap:8px;}
  section > h2::before{content:""; width:5px; height:17px; border-radius:3px; background:#2e9e9e;}

  /* --- narrative --- */
  .story li{margin:0 0 6px 0; font-size:14px; list-style:none; padding-inline-start:20px; position:relative;}
  .story li::before{content:"◂"; position:absolute; inset-inline-start:4px; color:#2e9e9e;}
  .steps{margin-top:12px; background:#f5faf8; border:1.4px solid #cfe8e0;
    border-radius:12px; padding:12px 16px;}
  .steps h3{font-size:14px; color:#1f6f8b; margin-bottom:6px;}
  .steps ol{padding-inline-start:20px; font-size:13.5px;}
  .steps li{margin-bottom:5px;}

  /* --- goals --- */
  .goals{display:flex; flex-direction:column; gap:12px;}
  .goal{border:1.5px solid #e4edf6; border-inline-start:5px solid var(--c);
    border-radius:12px; padding:12px 15px; background:#fcfdff;}
  .goal header{display:flex; align-items:center; gap:9px; flex-wrap:wrap;}
  .goal h3{font-size:14.5px; font-weight:700; flex:1; min-width:200px;}
  .badge{background:var(--c); color:#fff; font-size:11.5px; font-weight:800;
    border-radius:999px; padding:2px 11px;}
  .gid{font-size:11px; color:#8fa6bd; font-family:ui-monospace,monospace;}
  .bar{height:9px; background:#e9eff7; border-radius:99px; overflow:hidden; margin:9px 0 7px;}
  .bar span{display:block; height:100%; background:var(--c); border-radius:99px;}
  .goal-nums{display:flex; flex-wrap:wrap; gap:14px; font-size:12.5px; color:#5b7189;}
  .goal-nums b{color:#22344d; font-weight:800;}
  .goal-nums .pc{font-weight:800; color:var(--c); font-size:15px;}
  .advice{font-size:13px; color:#3d5470; margin-top:8px;
    background:#fff; border:1px dashed #dbe6f2; border-radius:9px; padding:8px 11px;}

  /* --- questions --- */
  /* A five-column table has nowhere to go on a narrow screen: it scrolls inside
     this box rather than pushing the whole page sideways. Below 640px it stops
     being a table altogether — see the phone rules at the end. */
  .scroll{overflow-x:auto;}
  table{width:100%; border-collapse:collapse; font-size:12.8px;}
  th,td{padding:8px 9px; text-align:right; vertical-align:top; border-bottom:1px solid #eef3f9;}
  th{background:#f6f9fd; font-weight:800; font-size:12px; color:#4a627e;}
  td.n{color:#8fa6bd; font-weight:800; width:34px;}
  td.q{max-width:330px;}
  td.q .meta{display:block; font-size:11px; color:#8fa6bd; margin-top:2px;}
  td.key{color:#1f9d61; font-weight:700;}
  .pill{display:inline-block; border-radius:999px; padding:1px 10px; font-size:11.5px; font-weight:800; white-space:nowrap;}
  .why{display:block; font-size:11px; color:#8fa6bd; margin-top:3px;}
  tr.is-ok .pill{background:#e6f7ee; color:#1f9d61;}
  tr.is-no .pill{background:#fdeceb; color:#d9534f;}
  tr.is-review .pill{background:#fdf5e2; color:#b58412;}
  tr.is-skip .pill{background:#eef2f7; color:#7b8ea5;}

  /* --- raw --- */
  details{padding:16px 26px;}
  summary{cursor:pointer; font-size:13px; font-weight:700; color:#4a627e;}
  pre{margin-top:10px; background:#12212f; color:#cfe3f5; border-radius:11px;
    padding:14px; overflow:auto; font-size:11.5px; line-height:1.6; direction:ltr; text-align:left;}

  .foot{padding:14px 26px; font-size:11.5px; color:#8fa6bd; text-align:center;}

  @media print{
    body{background:#fff; padding:0;}
    .sheet{box-shadow:none; border-radius:0;}
    details{display:none;}
    .goal{break-inside:avoid;} tr{break-inside:avoid;}
  }
  /* --- tablets --- */
  @media (max-width:760px){
    .top{flex-direction:column; align-items:stretch;}
    .score{flex-wrap:wrap;}
    .chips{margin-inline-start:0;}
  }

  /* --- phones -------------------------------------------------------------
     The question table becomes one card per question: <thead> goes away and
     every cell is labelled from its own data-label. Five columns do not fit a
     phone, and scrolling sideways would hide the question the other columns
     are about. Only cells carrying a data-label get a heading. */
  @media (max-width:640px){
    body{padding:10px 8px 40px;}
    .sheet{border-radius:13px;}

    .head{padding:16px 15px;}
    .head h1{font-size:18px; line-height:1.45;}
    .head p{font-size:13px;}
    .id-grid{gap:6px; margin-top:11px;}
    .id-grid div{font-size:11.5px; padding:4px 9px;}

    .top,section,details,.foot{padding-inline:15px;}
    .top{padding-block:16px; gap:14px;}
    .dial{width:88px; height:88px;}
    .dial::before{width:66px; height:66px;}
    .dial-v{font-size:21px;}
    .chip{padding:2px 10px; font-size:12px;}

    .goal{padding:11px 12px;}
    /* 200px of forced minimum pushed the card wider than the screen. */
    .goal h3{min-width:0;}
    .goal-nums{gap:6px 12px;}
    .gid{overflow-wrap:anywhere;}

    /* the table → one card per question */
    .scroll{overflow-x:visible;}
    thead{display:none;}
    table,tbody,tr,td{display:block; width:auto;}
    table{font-size:13px;}
    tr{border:1.5px solid #e4edf6; border-radius:12px; padding:9px 12px; margin-bottom:10px;}
    tr.is-ok{border-inline-start:4px solid #1f9d61;}
    tr.is-no{border-inline-start:4px solid #d9534f;}
    tr.is-review{border-inline-start:4px solid #d8a11e;}
    tr.is-skip{border-inline-start:4px solid #b9c6d6;}
    td{border:0; padding:4px 0; display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px;}
    td::before{content:attr(data-label); flex:0 0 7.5em; color:#8fa6bd; font-size:11.5px; font-weight:800;}
    td:not([data-label])::before{display:none;}
    td > .meta, td > .why{flex:0 0 100%;}
    td.n{width:auto; padding-bottom:2px; gap:4px;}
    /* display, because the rule above hid every label-less cell's ::before. */
    td.n::before{content:"#"; display:inline; flex:0 0 auto;}
    td.q,td.key{max-width:none;}
  }
</style>
</head>
<body>
<div class="sheet">

  <div class="head">
    <h1>${profile ? "أنماط تعلّم" : "تحليل نتائج"} ${esc(who)}</h1>
    <p>${esc(analysis.lesson_title || "")}</p>
    <div class="id-grid">
      ${identity.map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join("")}
    </div>
  </div>

  <div class="top">
    ${scoreTile(analysis)}
    ${statChips(analysis)}
  </div>

  <section>
    <h2>الخلاصة</h2>
    <ul class="story">
      ${(report.lines || []).map(l => `<li>${esc(l)}</li>`).join("")}
    </ul>
    ${(report.next_steps || []).length ? `
    <div class="steps">
      <h3>ما الذي يجب فعله الآن</h3>
      <ol>${report.next_steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
    </div>` : ""}
  </section>

  <section>
    <h2>${profile ? `أنماط التعلم (${goals.length})` : `تحقّق الأهداف (${goals.length})`}</h2>
    <div class="goals">${goalRows(goals, profile)}</div>
  </section>

  <section>
    <h2>${profile
      ? `الاستجابات عبارةً بعبارة (${(analysis.questions || []).length})`
      : `الإجابات سؤالاً بسؤال (${(analysis.questions || []).length})`}</h2>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>#</th>
          <th>${profile ? "العبارة" : "السؤال"}</th>
          <th>${profile ? "استجابة الطالب" : "إجابة الطالب"}</th>
          <th>${profile ? "النقاط" : "الإجابة النموذجية"}</th>
          <th>النتيجة</th>
        </tr></thead>
        <tbody>${questionRows(analysis.questions || [], profile)}</tbody>
      </table>
    </div>
  </section>

  <details>
    <summary>البيانات الكاملة (JSON)</summary>
    <pre>${esc(jsonForPage(analysis))}</pre>
  </details>

  <div class="foot">
    ${esc(analysis.assignment_id)} · ${profile
      ? "استبيان تقريري — لا توجد إجابات صحيحة أو خاطئة، والنتيجة تصف تفضيلاً لا مستوى"
      : "تم التحليل آلياً — الإجابات المفتوحة تحتاج مراجعة المعلم"}
  </div>
</div>
</body>
</html>
`;
}

/**
 * The page shown when a link is dead: submitted, revoked, or expired.
 * Deliberately a full, calm page rather than a JSON error — the person reading
 * it is a student who clicked a link, not a client parsing a response.
 */
export function renderClosedPage(status, message, detail){
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>الرابط غير متاح</title>
<style>
  body{font-family:"Cairo","Segoe UI",system-ui,sans-serif; background:#eef3f9; color:#22344d;
    display:grid; place-items:center; min-height:100vh; margin:0; padding:24px;}
  .box{background:#fff; border-radius:18px; box-shadow:0 10px 34px rgba(31,58,94,.10);
    max-width:460px; padding:34px 30px; text-align:center;}
  .ic{font-size:44px;}
  h1{font-size:20px; margin:12px 0 8px;}
  p{font-size:14px; color:#5b7189; line-height:1.8;}
  code{display:block; margin-top:14px; font-size:11.5px; color:#8fa6bd;}
</style>
</head>
<body>
  <div class="box">
    <div class="ic">${status === 410 ? "✅" : "🔗"}</div>
    <h1>${status === 410 ? "انتهت صلاحية هذا الرابط" : "الرابط غير صالح"}</h1>
    <p>${esc(message)}</p>
    ${detail ? `<code>${esc(detail)}</code>` : ""}
  </div>
</body>
</html>
`;
}
