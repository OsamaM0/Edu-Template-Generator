/* ============================================================================
   answers/dashboard.mjs — the group analysis, as one page a teacher can act on
   ----------------------------------------------------------------------------
   The per-student report (report.mjs) answers "what does this one student not
   understand". This page answers the other question a teacher has, in the order
   they ask it:

     1. did they answer at all          participation, before any average
     2. how did the class do            one number, and the spread behind it
     3. what did the CLASS not get      goals, weakest first — reteach this
     4. which questions failed          the items themselves, hardest first
     5. who needs me, and where is it   every student, with a link to the sheet

   Section 5 is the point of the page. Every class-level claim above it is a
   summary of individual sheets, so the summary has to end where those sheets
   are: each row carries the student's own report, their result JSON and the
   answer link if they still owe one. Nothing here is a dead end.

   Self-contained, like report.mjs — no stylesheet links, no scripts, no fonts
   that have to load. The same file works served, saved and mailed.
   ========================================================================== */
import { arabicCount } from "./analyze.mjs";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** JSON safe to sit inside a <pre> block. */
const jsonForPage = v => JSON.stringify(v, null, 2)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const KIND_LABEL = {
  multiple_choice: "اختيار من متعدد",
  true_false: "صح أو خطأ",
  complete: "أكمل الفراغ",
  short_answer: "إجابة قصيرة"
};

const num = v => (v == null ? "—" : `${v}%`);

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

/** A link, or plain text when there is no URL — the table must never break. */
const link = (href, text, cls) =>
  (href ? `<a class="${cls || "lnk"}" href="${esc(href)}">${esc(text)}</a>` : `<span class="muted">${esc(text)}</span>`);

/* ------------------------------------------------------------------ pieces -- */

/** The headline tile: the class average, and the word that average means. */
function averageTile(overall){
  const shown = overall.average_percentage == null ? 0 : overall.average_percentage;

  return `<div class="score" style="--band:${overall.color}">
    <div class="dial" style="--p:${shown}">
      <span class="dial-v">${overall.average_percentage == null ? "—" : shown}<small>%</small></span>
    </div>
    <div class="score-tx">
      <strong>${esc(overall.mastery_label)}</strong>
      <span>متوسط ${arabicCount(overall.answered_students, "ورقة واحدة", "ورقتين", "أوراق")} مسلَّمة</span>
      <span class="spread">الوسيط ${num(overall.median_percentage)} · الأعلى ${num(overall.highest_percentage)} · الأدنى ${num(overall.lowest_percentage)}</span>
    </div>
  </div>`;
}

/** Participation first: an average over four of fifteen sheets means little. */
const participationChips = (p, overall) => `<div class="chips">
  ${[
    ["سُلِّمت", p.submitted, "#1f9d61"],
    ["لم تُسلَّم", p.pending, "#d8a11e"],
    ["فُتحت", p.opened, "#2e9e9e"],
    ["طلاب", p.students, "#4a627e"],
    ["تحتاج مراجعة", overall.needs_review, "#e07b39"]
  ].map(([label, value, color]) => `
    <span class="chip" style="--c:${color}"><b>${value}</b> ${esc(label)}</span>`).join("")}
</div>`;

/** The spread of the class across the mastery bands, as one stacked bar. */
function distributionBar(distribution, answered){
  if (!answered) return "";

  const segments = distribution.filter(d => d.count > 0).map(d => `
    <span class="seg" style="width:${d.percentage}%; background:${d.color}"
          title="${esc(d.label)}: ${d.count}"></span>`).join("");

  const keys = distribution.map(d => `
    <span class="key ${d.count ? "" : "off"}"><i style="background:${d.color}"></i>${esc(d.label)} <b>${d.count}</b></span>`).join("");

  return `<div class="dist">
    <div class="dist-bar">${segments}</div>
    <div class="dist-keys">${keys}</div>
  </div>`;
}

/** Goals, weakest first — the reteaching list. */
function goalCards(goals){
  if (!goals.length) return `<p class="empty">لا توجد أهداف بعد — لم تُسلَّم أي ورقة في هذه المجموعة.</p>`;

  return goals.map(g => `
    <article class="goal" style="--c:${g.color}">
      <header>
        <span class="badge">${esc(g.mastery_label)}</span>
        <h3>${esc(g.goal_text || g.goal_id)}</h3>
        <span class="gid">${esc(g.goal_id)}</span>
      </header>

      <div class="bar" role="img" aria-label="${num(g.average_percentage)}">
        <span style="width:${g.average_percentage == null ? 0 : g.average_percentage}%"></span>
      </div>

      <div class="goal-nums">
        <span class="pc">${num(g.average_percentage)}</span>
        <span>أتقنه: <b>${g.mastered}</b></span>
        <span>جيد جداً: <b>${g.proficient}</b></span>
        <span>يحتاج دعماً: <b>${g.struggling}</b></span>
        <span>اختُبر عليه: <b>${g.tested_students}</b></span>
        <span>إجابات صحيحة: <b>${g.correct}/${g.total}</b></span>
      </div>

      ${g.students_needing_work.length ? `
      <div class="who">
        <span>تحت 60%:</span>
        ${g.students_needing_work.map(s => `
          <span class="who-tag">${esc(s.student_name || s.student_id || s.assignment_id)} <b>${s.percentage}%</b></span>`).join("")}
      </div>` : ""}

      <p class="advice">${esc(g.recommendation)}</p>
    </article>`).join("");
}

/** The questions themselves, hardest first — only those more than one student saw. */
function questionRows(questions){
  if (!questions.length) return `<tr><td colspan="6" class="empty">لا توجد إجابات بعد.</td></tr>`;

  return questions.map(q => {
    const rate = q.success_rate == null ? 0 : q.success_rate;
    const tone = rate >= 75 ? "ok" : rate >= 50 ? "mid" : "no";

    /* data-label repeats the column heading on every cell. It is invisible while
       this is a table, and it is what the cell is labelled with on a phone,
       where the row becomes a card and the <thead> is gone. */
    return `<tr class="is-${tone}">
      <td class="q" data-label="السؤال">
        ${esc(q.question)}
        <span class="meta">${esc(KIND_LABEL[q.kind] || q.kind)}${q.goal_text ? ` · ${esc(q.goal_text)}` : ""}</span>
      </td>
      <td class="key" data-label="الإجابة النموذجية">${esc(q.correct_answer) || "—"}</td>
      <td class="rate" data-label="نسبة النجاح">
        <span class="mini"><span style="width:${rate}%"></span></span>
        <b>${num(q.success_rate)}</b>
      </td>
      <td data-label="صحيحة">${q.correct}/${q.asked}</td>
      <td data-label="بدون إجابة">${q.unanswered || "—"}</td>
      <td class="wrongs" data-label="أشهر الأخطاء">${
        q.common_wrong_answers.length
          ? q.common_wrong_answers.map(w => `<span class="wa">${esc(w.answer)} <b>×${w.count}</b></span>`).join("")
          : "<span class=\"muted\">—</span>"
      }</td>
    </tr>`;
  }).join("");
}

/**
 * The summary this whole page exists to end on: every student, their score, and
 * the links back to the sheet the score came from.
 */
function studentRows(students){
  if (!students.length) return `<tr><td colspan="7" class="empty">لم تصدر أي ورقة في هذه المجموعة.</td></tr>`;

  return students.map((s, i) => {
    const who = s.student_name || s.student_id || s.assignment_id;
    const weak = s.weakest_goals.map(g => esc(g.goal_text || g.goal_id)).join("، ");

    return `<tr class="${s.answered ? "" : "pending"}">
      <td class="n">${i + 1}</td>
      <td class="who-cell" data-label="الطالب">
        <b>${esc(who)}</b>
        <span class="meta">${esc([s.student_id, s.classroom, s.section].filter(Boolean).join(" · "))}</span>
      </td>
      <td class="pc-cell" style="--c:${s.color}" data-label="النتيجة">
        ${s.answered ? `<span class="pc">${num(s.percentage)}</span>` : `<span class="muted">—</span>`}
        <span class="pill" style="background:${s.color}">${esc(s.mastery_label)}</span>
      </td>
      <td data-label="صحيحة">${s.answered ? `${s.correct}/${s.total}` : "—"}</td>
      <td data-label="بدون إجابة">${s.answered ? (s.unanswered || "0") : "—"}</td>
      <td class="weak" data-label="أهداف تحت 60%">${weak || `<span class="muted">${esc(s.answered ? "لا أهداف دون 60%" : s.headline)}</span>`}</td>
      <td class="links" data-label="الإجابات الكاملة">
        ${
          /* A sheet that was never submitted has no report to open — offering
             one would be a link to a 404. What that row needs is the student's
             own link, which is still live. */
          s.answered
            ? `${link(s.report_url, "التقرير الكامل", "lnk main")}${link(s.result_url, "JSON", "lnk")}`
            : (s.status === "issued"
                ? link(s.answer_url, "رابط الطالب — لم يُستعمل", "lnk warn")
                : `<span class="muted">${esc(s.headline)}</span>`)
        }
        <span class="aid">${esc(s.assignment_id)}</span>
      </td>
    </tr>`;
  }).join("");
}

/* -------------------------------------------------------------------- page -- */

/**
 * @param {object} analysis  the object from group.analyseGroup()
 * @returns {string} a complete, standalone HTML document
 */
export function renderDashboard(analysis){
  const g = analysis.group || {};
  const title = g.name || g.id;
  const p = analysis.participation;
  const overall = analysis.overall;
  const report = analysis.report || {};

  const identity = [
    ["المجموعة", g.name],
    ["معرّف المجموعة", g.id],
    // Dropped when the sheets were issued without them, like every row here.
    ["المدرسة", analysis.school && analysis.school.name],
    ["المعلم / المعلمة", analysis.teacher && analysis.teacher.name],
    ["الدروس", (analysis.lessons || []).map(l => l.lesson_title || l.document_idx).join("، ")],
    ["الأوراق", `${p.submitted} مسلَّمة من ${p.issued}`],
    ["نسبة التسليم", num(p.submission_rate)],
    ["تاريخ التقرير", when(analysis.generated_at)]
  ].filter(([, v]) => v != null && v !== "" && v !== "—");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>لوحة تحليل المجموعة — ${esc(title)}</title>
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
  .sheet{max-width:1140px; margin:0 auto; background:#fff; border-radius:18px;
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
    position:relative; width:104px; height:104px; border-radius:50%;
    display:grid; place-items:center; flex:0 0 auto;
    background:conic-gradient(var(--band) calc(var(--p)*1%), #e6eef7 0);
  }
  .dial::before{content:""; position:absolute; width:78px; height:78px; border-radius:50%; background:#fff;}
  .dial-v{position:relative; font-size:25px; font-weight:800; color:var(--band);}
  .dial-v small{font-size:13px; font-weight:700;}
  .score-tx{display:flex; flex-direction:column;}
  .score-tx strong{font-size:19px; color:var(--band);}
  .score-tx span{font-size:13.5px; color:#5b7189;}
  .score-tx .spread{font-size:12px; color:#8fa6bd;}
  .chips{display:flex; flex-wrap:wrap; gap:8px; margin-inline-start:auto;}
  .chip{border:1.6px solid var(--c); color:var(--c); border-radius:999px;
    padding:3px 13px; font-size:12.5px; font-weight:700;}
  .chip b{font-weight:800; font-size:14px;}

  /* --- distribution --- */
  .dist{padding:16px 26px; border-bottom:1px solid #e6eef7;}
  .dist-bar{display:flex; height:16px; border-radius:99px; overflow:hidden; background:#e9eff7;}
  .dist-bar .seg{display:block; height:100%;}
  .dist-keys{display:flex; flex-wrap:wrap; gap:14px; margin-top:9px; font-size:12.5px; color:#5b7189;}
  .dist-keys .key{display:flex; align-items:center; gap:6px;}
  .dist-keys .key.off{opacity:.4;}
  .dist-keys i{width:11px; height:11px; border-radius:3px; display:inline-block;}
  .dist-keys b{color:#22344d; font-weight:800;}

  /* --- sections --- */
  section{padding:20px 26px; border-bottom:1px solid #e6eef7;}
  section > h2{font-size:16px; font-weight:800; color:#1f6f8b; margin-bottom:4px;
    display:flex; align-items:center; gap:8px;}
  section > h2::before{content:""; width:5px; height:17px; border-radius:3px; background:#2e9e9e;}
  section > .sub{font-size:12.5px; color:#8fa6bd; margin:0 0 12px 13px;}

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
  .who{display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:9px; font-size:12px; color:#8fa6bd;}
  .who-tag{background:#fdeceb; color:#b0403c; border-radius:999px; padding:1px 10px; font-weight:700;}
  .advice{font-size:13px; color:#3d5470; margin-top:8px;
    background:#fff; border:1px dashed #dbe6f2; border-radius:9px; padding:8px 11px;}

  /* --- tables --- */
  .scroll{overflow-x:auto;}
  table{width:100%; border-collapse:collapse; font-size:12.8px;}
  th,td{padding:8px 9px; text-align:right; vertical-align:top; border-bottom:1px solid #eef3f9;}
  th{background:#f6f9fd; font-weight:800; font-size:12px; color:#4a627e; white-space:nowrap;}
  td.n{color:#8fa6bd; font-weight:800; width:34px;}
  td.q{max-width:340px;}
  td.q .meta, .who-cell .meta{display:block; font-size:11px; color:#8fa6bd; margin-top:2px;}
  td.key{color:#1f9d61; font-weight:700; max-width:160px;}
  .muted{color:#8fa6bd;}
  .empty{color:#8fa6bd; font-size:13px; padding:14px 0; text-align:center;}

  /* questions */
  .rate{white-space:nowrap;}
  .mini{display:inline-block; width:56px; height:7px; background:#e9eff7;
    border-radius:99px; overflow:hidden; vertical-align:middle; margin-inline-start:6px;}
  .mini span{display:block; height:100%; border-radius:99px; background:currentColor;}
  tr.is-ok .mini{color:#1f9d61;} tr.is-mid .mini{color:#d8a11e;} tr.is-no .mini{color:#d9534f;}
  tr.is-ok .rate b{color:#1f9d61;} tr.is-mid .rate b{color:#b58412;} tr.is-no .rate b{color:#d9534f;}
  .wrongs{max-width:210px;}
  .wa{display:inline-block; background:#fdeceb; color:#b0403c; border-radius:7px;
    padding:1px 8px; margin:0 0 3px 3px; font-size:11.5px;}

  /* students */
  .who-cell b{font-size:13.5px;}
  .pc-cell{white-space:nowrap;}
  .pc-cell .pc{font-weight:800; font-size:15px; color:var(--c); margin-inline-end:6px;}
  .pill{display:inline-block; color:#fff; border-radius:999px; padding:1px 10px;
    font-size:11px; font-weight:800; white-space:nowrap;}
  tr.pending{background:#fcfdff;}
  .weak{max-width:230px; color:#b0403c;}
  .links{white-space:nowrap;}
  .lnk{display:inline-block; border:1.3px solid #cfe0ef; color:#1f6f8b; border-radius:8px;
    padding:1px 9px; margin:0 0 3px 3px; font-size:11.5px; font-weight:700; text-decoration:none;}
  .lnk.main{background:#1f6f8b; border-color:#1f6f8b; color:#fff;}
  .lnk.warn{background:#fdf5e2; border-color:#e9d59a; color:#8a6a12;}
  .aid{display:block; font-size:10px; color:#c3d1e0; font-family:ui-monospace,monospace; margin-top:2px;}

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
    .lnk{border:0; padding:0; color:#1f6f8b; background:none;}
  }
  /* --- tablets ------------------------------------------------------------
     The headline row stops being a row: the dial and the chips each get the
     full width rather than being squeezed into one line. */
  @media (max-width:760px){
    .top{flex-direction:column; align-items:stretch;}
    .score{flex-wrap:wrap;}
    .chips{margin-inline-start:0;}
  }

  /* --- phones -------------------------------------------------------------
     Below 640px the two wide tables stop being tables. Six and seven columns
     do not fit a phone, and a table that scrolls sideways is a table nobody
     reads: every horizontal scroll hides the student's name, which is the one
     column every other column is about.

     So each row becomes a card, <thead> goes away, and every cell is labelled
     from its own data-label — the column heading, carried on the cell. Nothing
     is dropped and nothing has to be read by scrolling sideways.

     Only cells that carry a data-label get a heading, so the "nothing here
     yet" rows stay plain sentences. */
  @media (max-width:640px){
    body{padding:10px 8px 40px;}
    .sheet{border-radius:13px;}

    .head{padding:16px 15px;}
    .head h1{font-size:18px; line-height:1.45;}
    .head p{font-size:13px;}
    .id-grid{gap:6px; margin-top:11px;}
    .id-grid div{font-size:11.5px; padding:4px 9px;}

    .top,.dist,section,details,.foot{padding-inline:15px;}
    .top{padding-block:16px; gap:14px;}
    .dial{width:88px; height:88px;}
    .dial::before{width:66px; height:66px;}
    .dial-v{font-size:21px;}
    .chip{padding:2px 10px; font-size:12px;}
    .dist-keys{gap:8px 12px;}

    .goal{padding:11px 12px;}
    /* 200px of forced minimum pushed the card wider than the screen. */
    .goal h3{min-width:0;}
    .goal-nums{gap:6px 12px;}
    .gid,.aid{overflow-wrap:anywhere;}

    /* tables → one card per row */
    .scroll{overflow-x:visible;}
    thead{display:none;}
    table,tbody,tr,td{display:block; width:auto;}
    table{font-size:13px;}
    tr{border:1.5px solid #e4edf6; border-radius:12px; padding:9px 12px; margin-bottom:10px;}
    tr.is-ok{border-inline-start:4px solid #1f9d61;}
    tr.is-mid{border-inline-start:4px solid #d8a11e;}
    tr.is-no{border-inline-start:4px solid #d9534f;}
    td{border:0; padding:4px 0; display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px;}
    td::before{content:attr(data-label); flex:0 0 7.5em; color:#8fa6bd; font-size:11.5px; font-weight:800;}
    td:not([data-label])::before{display:none;}
    /* the sub-lines keep a line of their own inside the card */
    td > .meta, td > .aid{flex:0 0 100%;}
    td.n{width:auto; padding-bottom:2px; gap:4px;}
    /* display, because the rule above hid every label-less cell's ::before. */
    td.n::before{content:"#"; display:inline; flex:0 0 auto;}
    td.q,td.key,.weak,.wrongs,.links,.rate,.pc-cell{max-width:none; white-space:normal;}
    .lnk,.wa{margin:2px 0 0 4px;}
    .empty{text-align:start; padding:6px 0;}
  }
</style>
</head>
<body>
<div class="sheet">

  <div class="head">
    <h1>لوحة تحليل المجموعة — ${esc(title)}</h1>
    <p>${esc(report.headline || "")}</p>
    <div class="id-grid">
      ${identity.map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join("")}
    </div>
  </div>

  <div class="top">
    ${averageTile(overall)}
    ${participationChips(p, overall)}
  </div>

  ${distributionBar(analysis.distribution || [], overall.answered_students)}

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
    <h2>تحقّق الأهداف على مستوى المجموعة (${(analysis.goals || []).length})</h2>
    <p class="sub">من الأضعف إلى الأقوى — الأول في القائمة هو ما يحتاج إعادة شرح للصف.</p>
    <div class="goals">${goalCards(analysis.goals || [])}</div>
  </section>

  <section>
    <h2>الأسئلة من الأصعب إلى الأسهل (${(analysis.questions || []).length})</h2>
    <p class="sub">نسبة النجاح لكل سؤال عبر أوراق المجموعة، وأكثر الإجابات الخاطئة تكراراً.</p>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>السؤال</th><th>الإجابة النموذجية</th><th>نسبة النجاح</th>
          <th>صحيحة</th><th>بدون إجابة</th><th>أشهر الأخطاء</th>
        </tr></thead>
        <tbody>${questionRows(analysis.questions || [])}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>ملخص الطلاب (${(analysis.students || []).length})</h2>
    <p class="sub">كل صف يقود إلى ورقته: «التقرير الكامل» هو تحليل الطالب سؤالاً بسؤال، و«JSON» هو الإجابات كما وصلت.</p>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>#</th><th>الطالب</th><th>النتيجة</th><th>صحيحة</th>
          <th>بدون إجابة</th><th>أهداف تحت 60%</th><th>الإجابات الكاملة</th>
        </tr></thead>
        <tbody>${studentRows(analysis.students || [])}</tbody>
      </table>
    </div>
  </section>

  <details>
    <summary>البيانات الكاملة (JSON)</summary>
    <pre>${esc(jsonForPage(analysis))}</pre>
  </details>

  <div class="foot">
    ${esc(g.id)} · ${p.issued} ورقة · ${p.submitted} تسليماً · تم التحليل آلياً — الإجابات المفتوحة تحتاج مراجعة المعلم
  </div>
</div>
</body>
</html>
`;
}
