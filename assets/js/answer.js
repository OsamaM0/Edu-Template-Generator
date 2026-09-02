/* ============================================================================
   answer.js — the layer that turns a rendered sheet into a submission
   ----------------------------------------------------------------------------
   Loaded ONLY on a sheet issued to a student (window.EDU_ANSWER is present).
   Everywhere else this file is not shipped at all, so a printed classroom
   worksheet stays exactly what it was.

   It does not re-render anything. The sheet is already on the page, complete
   with the controls each question kind needs — options to tick, blanks to type
   in, lines to write on — and every question carries data-qid. So the whole job
   is: read that markup back as {question_id: answer}, and post it once.

   Reading the DOM rather than keeping a parallel model is deliberate. The
   student's answer IS what is on the sheet; a model kept beside it can drift
   from what they can see, and on a sheet that can only be submitted once,
   drifting by one answer is not a small bug.

   The correct answers are NOT here and never arrive. Grading happens on the
   server against a key stored beside the assignment, which is what stops the
   page being an answer sheet with the answers in view-source.
   ========================================================================== */

const cfg = window.EDU_ANSWER || null;

/* ------------------------------------------------------------------ styles -- */

/* Injected rather than added to the stylesheets: only an issued sheet has a
   submit bar, and the print CSS should not have to know this exists. */
const CSS = `
.ans-bar{
  position:fixed; inset-inline:0; bottom:0; z-index:60;
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:10px 18px;
  background:rgba(255,255,255,.97);
  border-top:1.6px solid #dbe6f2;
  box-shadow:0 -6px 22px rgba(31,58,94,.10);
  font-family:inherit;
}
.ans-bar .who{font-weight:800; font-size:13px; color:#22344d;}
.ans-bar .who small{display:block; font-weight:600; font-size:11px; color:#8fa6bd;}
.ans-progress{flex:1; min-width:150px; max-width:320px;}
.ans-progress .track{height:8px; background:#e9eff7; border-radius:99px; overflow:hidden;}
.ans-progress .track span{display:block; height:100%; width:0; background:#2e9e9e; border-radius:99px; transition:width .2s;}
.ans-progress .lbl{font-size:11.5px; color:#5b7189; margin-top:3px;}
.ans-send{
  border:none; border-radius:10px; cursor:pointer;
  background:#1f6f8b; color:#fff;
  font:inherit; font-weight:800; font-size:13.5px;
  padding:9px 26px;
  transition:.15s;
}
.ans-send:hover:not(:disabled){background:#175a72;}
.ans-send:disabled{opacity:.55; cursor:not-allowed;}
.ans-note{font-size:11.5px; color:#8fa6bd; width:100%;}
.ans-note.is-error{color:#d9534f; font-weight:700;}
body.has-ans-bar{padding-bottom:96px;}

.ans-done{
  position:fixed; inset:0; z-index:120;
  display:grid; place-items:center; padding:22px;
  background:rgba(238,243,249,.97);
  overflow:auto;
}
.ans-done .box{
  background:#fff; border-radius:18px; max-width:520px; width:100%;
  box-shadow:0 12px 40px rgba(31,58,94,.16);
  padding:30px 28px; text-align:center;
}
.ans-done .ic{font-size:46px;}
.ans-done h1{font-size:21px; margin:10px 0 6px; color:#22344d;}
.ans-done p{font-size:14px; color:#5b7189; line-height:1.8;}
.ans-done .pc{font-size:40px; font-weight:800; color:#1f6f8b; margin:12px 0 2px;}
.ans-goals{margin-top:18px; text-align:start; display:flex; flex-direction:column; gap:9px;}
.ans-goal{font-size:12.5px;}
.ans-goal .row{display:flex; justify-content:space-between; gap:10px; margin-bottom:3px;}
.ans-goal .row b{color:#22344d;}
.ans-goal .track{height:7px; background:#e9eff7; border-radius:99px; overflow:hidden;}
.ans-goal .track span{display:block; height:100%; border-radius:99px;}
.ans-verdict{
  display:inline-block; margin:6px 0 2px;
  background:#1f6f8b; color:#fff; border-radius:999px;
  padding:6px 22px 7px; font-size:17px; font-weight:800;
}
.ans-tips{margin-top:14px; text-align:start; display:flex; flex-direction:column; gap:6px;}
.ans-tips li{
  position:relative; list-style:none; padding-inline-start:14px;
  font-size:12.5px; font-weight:700; line-height:1.7; color:#33475c;
}
.ans-tips li::before{
  content:""; position:absolute; inset-inline-start:0; top:8px;
  width:6px; height:6px; border-radius:50%; background:#2e9e9e;
}
.ans-done .go{
  display:inline-block; margin-top:20px;
  background:#2e9e9e; color:#fff; text-decoration:none;
  border-radius:10px; padding:9px 24px; font-weight:800; font-size:13.5px;
}
@media print{ .ans-bar, .ans-done{display:none !important;} body.has-ans-bar{padding-bottom:0;} }
`;

function injectStyles(){
  const el = document.createElement("style");
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------- collecting -- */

const text = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

/**
 * One question's answer, read off the sheet.
 *
 * The order of these checks is the order of specificity, not preference: a
 * selected option is unambiguous, blanks are the whole answer when there are
 * any, and writing lines are the fallback for everything open-ended. A question
 * the student has not touched returns "" — not null, not missing — so the
 * submitted object always has one entry per question and the server can tell
 * "left blank" apart from "never asked".
 */
function readAnswer(el){
  // .lp-opt.on is the learning-pattern scale cell: same idea, different sheet.
  const selected = el.querySelector(".qz-opt.sel, .ic-opt.sel, .opt.sel, .lp-opt.on");
  if (selected){
    // data-value is the option's own text, not its printed letter: an answer
    // that reads "الجملة الاسمية" survives a re-render that letters the
    // options differently, where "أ" would quietly become wrong.
    return selected.dataset.value != null
      ? selected.dataset.value
      : text(selected.querySelector(".tx, .sl") || selected);
  }

  const blanks = [...el.querySelectorAll(".blank")];
  if (blanks.length){
    const values = blanks.map(text);
    // One blank is a string; several are a list, which is how the key is stored.
    return values.length === 1 ? values[0] : values;
  }

  /* Nothing ticked, nothing in a blank — but a student may have written the
     answer on the line instead of choosing an option, and the grader matches
     option text as readily as an index. Reading it is strictly better than
     discarding it. */
  const lines = [...el.querySelectorAll(".wline")].map(text).filter(Boolean);
  if (lines.length) return lines.join(" ");

  const input = el.querySelector("input[type=text], textarea");
  if (input) return input.value.trim();

  return "";
}

const hasContent = v => Array.isArray(v) ? v.some(x => String(x).trim() !== "") : String(v == null ? "" : v).trim() !== "";

/** Every identified question on the page, in document order. */
const questionEls = () => [...document.querySelectorAll("#app [data-qid]")]
  .filter(el => el.dataset.qid);

function collect(){
  const answers = {};

  /* The server's question list is the authority on what this sheet asked. A
     question whose markup is missing (a template that dropped it, a section
     that failed to render) is still submitted, as empty — silently shrinking
     the submission would silently shrink the analysis with it. */
  for (const q of (cfg.questions || [])) answers[q.question_id] = "";

  for (const el of questionEls()){
    answers[el.dataset.qid] = readAnswer(el);
  }
  return answers;
}

/* ------------------------------------------------------------------- bar -- */

let bar, sendBtn, fill, label, note;

function buildBar(){
  bar = document.createElement("div");
  bar.className = "ans-bar no-print";

  const student = cfg.student || {};
  const who = student.name || (student.id ? `الطالب ${student.id}` : "ورقة عمل");
  const sub = [student.id && `رقم ${student.id}`, student.classroom].filter(Boolean).join(" · ");

  bar.innerHTML = `
    <div class="who">${escapeHtml(who)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</div>
    <div class="ans-progress">
      <div class="track"><span></span></div>
      <div class="lbl"></div>
    </div>
    <button class="ans-send" type="button">تسليم الإجابات</button>
    <div class="ans-note">يمكنك التسليم مرة واحدة فقط — راجع إجاباتك قبل الإرسال.</div>`;

  document.body.appendChild(bar);
  document.body.classList.add("has-ans-bar");

  sendBtn = bar.querySelector(".ans-send");
  fill = bar.querySelector(".track span");
  label = bar.querySelector(".lbl");
  note = bar.querySelector(".ans-note");

  sendBtn.addEventListener("click", submit);
}

const escapeHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function refreshProgress(){
  const total = (cfg.questions || []).length || questionEls().length;
  const answers = collect();
  const done = Object.values(answers).filter(hasContent).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  fill.style.width = `${pct}%`;
  label.textContent = `${done} من ${total} سؤالاً تمت الإجابة عليه`;
  return { done, total };
}

/* ---------------------------------------------------------------- submit -- */

let sending = false;

async function submit(){
  if (sending) return;

  const { done, total } = refreshProgress();
  if (done < total){
    const ok = window.confirm(
      `لم تجب على ${total - done} من الأسئلة. التسليم نهائي ولا يمكن التعديل بعده.\nهل تريد التسليم الآن؟`);
    if (!ok) return;
  } else if (!window.confirm("سيتم تسليم إجاباتك نهائياً. هل أنت متأكد؟")){
    return;
  }

  sending = true;
  sendBtn.disabled = true;
  sendBtn.textContent = "جارٍ التسليم…";
  note.classList.remove("is-error");
  note.textContent = "لا تغلق الصفحة حتى يكتمل التسليم.";

  try {
    const res = await fetch(cfg.submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignment_id: cfg.assignmentId,
        token: cfg.token,
        answers: collect()
      })
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok){
      throw new Error((body.error && body.error.message) || `تعذّر التسليم (${res.status})`);
    }
    showDone(body);

  } catch (err){
    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = "إعادة المحاولة";
    note.classList.add("is-error");
    note.textContent = `${err.message} — إجاباتك ما زالت على الصفحة، حاول مرة أخرى.`;
    console.error("[edu] submit failed:", err);
  }
}

/* ------------------------------------------------------------------ done -- */

/** One labelled bar per goal (or, on a survey, per learning style). */
const barsHtml = rows => rows.length
  ? `<div class="ans-goals">${rows.map(g => `
      <div class="ans-goal">
        <div class="row"><b>${escapeHtml(g.label)}</b><span>${g.percentage}%</span></div>
        <div class="track"><span style="width:${g.percentage}%;background:${escapeHtml(g.color || "#2e9e9e")}"></span></div>
      </div>`).join("")}</div>`
  : "";

/**
 * The headline half of the panel, which is the one thing that differs between
 * a marked sheet and a survey.
 *
 * A worksheet answers "how much of this did you get right"; a survey answers
 * "which way do you learn". Showing a percentage-correct for a survey would be
 * meaningless at best and discouraging at worst, so it gets its finding — the
 * dominant style, what it means, and what to try — instead of a mark.
 */
function resultHtml(result){
  const profile = result && result.profile;

  if (profile && profile.verdict){
    const v = profile.verdict;
    const tips = (v.tips || []).slice(0, 4);
    return `
      <div class="ans-verdict">${escapeHtml(v.label || "")}</div>
      ${v.description ? `<p>${escapeHtml(v.description)}</p>` : ""}
      ${barsHtml((profile.styles || []).map(s => ({
        label: s.label, percentage: s.percentage, color: s.color
      })))}
      ${tips.length ? `<ul class="ans-tips">${tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}`;
  }

  const o = (result && result.overall) || {};
  const goals = Object.values((result && result.goals) || {}).filter(g => g.total > 0);

  return `
    ${o.total ? `
      <div class="pc">${o.percentage}%</div>
      <p>${o.correct} إجابة صحيحة من ${o.total} — ${escapeHtml(o.mastery_label || "")}</p>` : ""}
    ${barsHtml(goals.map(g => ({
      label: g.goal_text || g.goal_id, percentage: g.percentage, color: g.color
    })))}`;
}

/**
 * What the student sees afterwards. Their own result, per goal, in the same
 * words the teacher's report uses — the point of grading this way is that the
 * student learns which goal to go back to, not just what they scored.
 */
function showDone(result){
  const panel = document.createElement("div");
  panel.className = "ans-done no-print";
  panel.innerHTML = `
    <div class="box">
      <div class="ic">✅</div>
      <h1>تم تسليم إجاباتك</h1>
      <p>${escapeHtml((result && result.message) || "شكراً لك. لم يعد هذا الرابط صالحاً للاستخدام مرة أخرى.")}</p>
      ${resultHtml(result)}
      ${result && result.report_url
        ? `<a class="go" href="${escapeHtml(result.report_url)}">عرض التحليل الكامل</a>` : ""}
    </div>`;

  document.body.appendChild(panel);
  if (bar) bar.remove();
  document.body.classList.remove("has-ans-bar");

  // Nothing on the sheet may change after it has been sent.
  document.querySelectorAll("#app [contenteditable]").forEach(el => el.setAttribute("contenteditable", "false"));
  document.querySelectorAll("#app input").forEach(el => { el.readOnly = true; });
  const toolbar = document.getElementById("toolbar");
  const reset = document.getElementById("btn-reset");
  if (reset) reset.remove();
  if (toolbar) toolbar.style.bottom = "18px";
}

/* ------------------------------------------------------------------ boot -- */

function start(){
  injectStyles();
  buildBar();
  refreshProgress();

  /* One listener, on the document, for every way an answer can change: option
     clicks (which announce themselves), typing into a blank or a line, and the
     toolbar's reset. Re-rendering the sheet — a theme toggle — replaces the
     markup wholesale, and the delegated listener survives that where a
     per-element one would not. */
  document.addEventListener("edu:answer", refreshProgress);
  document.addEventListener("input", refreshProgress);
  document.addEventListener("edu:rendered", refreshProgress);
  document.addEventListener("click", () => setTimeout(refreshProgress, 0));

  // A half-answered sheet that is closed by accident cannot be recovered — the
  // link is single-use — so leaving is worth one confirmation.
  window.addEventListener("beforeunload", e => {
    if (sending) return;
    const { done } = refreshProgress();
    if (!done) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

if (cfg && cfg.submitUrl){
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
} else {
  console.warn("[edu] answer.js loaded without window.EDU_ANSWER — nothing to submit to.");
}
