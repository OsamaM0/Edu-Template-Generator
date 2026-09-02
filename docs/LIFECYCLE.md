# The lifecycle

Everything this project does is one pipeline with nine stages. Not every sheet travels the whole
way — a printed classroom worksheet stops at stage 4, a lesson plan never had questions to grade —
but the stages always run in this order, and each one has exactly one input, one output, and one
place in the code.

Read this page first. Every other document in `docs/` is the detail of one stage.

```
  ┌───────────────────────────────────────────────────────────────────────────┐
  │  0  SOURCE          a lesson, wherever it lives                           │
  │                     data/lessons/*.json   ·   MongoDB rows                │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  document_idx + type + seed
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  1  BUILD           lesson  →  sheet JSON  (+ answer key, kept server-side)│
  │                     server/pipeline/build/                                 │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  core-template JSON
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  2  RENDER          sheet JSON  →  one self-contained A4 HTML page         │
  │                     server/render-page.mjs  ·  assets/js/templates/        │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  html
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  3  PUBLISH         cache under a derived key, serve it signed             │
  │                     server/pipeline/cache.mjs   →   GET /t/<key>           │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │
                   ┌──────────────┴───────────────┐
                   │                              │
        (print / present / embed)       (answerable + student_id)
                   │                              │
                   ▼                              ▼
  ┌────────────────────────────┐  ┌───────────────────────────────────────────┐
  │  4  USE                    │  │  4′ ISSUE   one link, one student, once    │
  │     print · present · embed│  │     answers/store.mjs  →  GET /a/<id>?t=   │
  └────────────────────────────┘  └───────────────┬───────────────────────────┘
                                                  │  the student ticks the sheet
  ┌───────────────────────────────────────────────▼───────────────────────────┐
  │  5  ANSWER          the page reads itself back and posts once              │
  │                     assets/js/answer.js  →  POST /api/pipeline/submit      │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  {question_id: answer}
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  6  GRADE           each answer against the stored key                     │
  │                     answers/grade.mjs                                      │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  graded rows
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  7  ANALYSE         graded rows  →  what it means                          │
  │                     mastery  → answers/analyze.mjs   (per lesson goal)     │
  │                     profile  → answers/profile.mjs   (per learning style)  │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  the analysis JSON
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  8  DELIVER         file  ·  stdout  ·  your backend                       │
  │                     answers/deliver.mjs                                    │
  └───────────────────────────────┬───────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────▼───────────────────────────────────────────┐
  │  9  READ            report page · result JSON · class dashboard            │
  │                     answers/report.mjs · answers/dashboard.mjs             │
  └───────────────────────────────────────────────────────────────────────────┘
```

---

## 0 · Source — where a lesson comes from

| | |
|---|---|
| **Input** | nothing — this is the origin |
| **Output** | a lesson: a title, a subject, goals, questions, a summary |
| **Code** | `data/lessons/*.json` · `server/pipeline/source.mjs` |

There are two sources and they never mix in one request:

**Static.** A JSON file in `data/lessons/<id>.json`, already in core-template shape. It skips
stages 0–1 entirely: `index.html?lesson=<id>` fetches it and renders it in the browser. This is the
whole product if you have no database — any static host will serve it.

**Database.** Rows in three MongoDB collections (`questions`, `worksheets`, `summaries`), joined on
a `document_idx`. `source.mjs` reads all three, normalises the spelling differences between them,
and hands stage 1 one lesson object. A collection with no row for that `document_idx` is not an
error: the sheet is built from what exists and the response says what was missing in `warnings`.

→ [`docs/JSON.md`](JSON.md) for the static shape · [`docs/PIPELINE.md`](PIPELINE.md#the-lesson-source)
for the collections.

---

## 1 · Build — lesson → sheet

| | |
|---|---|
| **Input** | one lesson + `{type, seed, counts, theme, color, student, group}` |
| **Output** | `{data, title, answerKey, scoring, profile, goals, used, warnings}` |
| **Code** | `server/pipeline/build/index.mjs` and one module per type |
| **Entry** | `POST /api/pipeline/document` |

A **type** is what you asked for; a **template** is what draws it. Seven types map onto six
templates:

| type | template | answerable |
|---|---|---|
| `worksheet` | `worksheet` | yes |
| `cards` | `interactive-card` | yes |
| `answers` | `interactive-card-answers` | no — it *is* the answers |
| `lesson-plan` | `differentiated-lesson` | no |
| `golden-minutes` | `golden-minutes` | no |
| `summary` | `worksheet` | yes |
| `learning-pattern` | `learning-pattern` | yes |

**The seed is the contract.** The same `document_idx` + `type` + `seed` + `counts` always draws the
same questions in the same order. Each draw takes its own labelled stream, so asking for one more
multiple-choice question cannot reshuffle the true/false ones.

**The answer key never leaves this stage.** The builder produces two things: the `data` that becomes
the page, and the `answerKey` that stays on the server. The page carries question *ids* and option
*text*; it never carries which option is right. That is what stops a sheet being an answer key one
"view source" away.

**Two ways a sheet is read.** The builder declares it as `scoring`:

- `"mastery"` — every question has a right answer and the useful unit is the lesson goal.
  This is every type but one.
- `"profile"` — points on a scale, summed per category. `learning-pattern` only. The instrument it
  was printed from travels with it, so the sheet is always scored against what it actually said.

→ [`docs/PIPELINE.md`](PIPELINE.md#endpoints) · [`docs/EXTENDING.md`](EXTENDING.md#adding-a-document-type)

---

## 2 · Render — sheet JSON → HTML

| | |
|---|---|
| **Input** | core-template JSON |
| **Output** | one self-contained HTML page, one A4 sheet |
| **Code** | `server/render-page.mjs` (server) · `assets/js/render.js` (browser) |
| **Entry** | `POST /api/render` — usable on its own, with no database anywhere |

`meta.template` picks the module in `assets/js/templates/`; the module's `render(data)` returns the
markup and its `wire(app)` attaches the behaviour. The same modules run in the browser and in Node,
because they are plain ES modules with no build step.

Stage 2 is the one stage you can use entirely on its own: `POST /api/render` with any core-template
JSON gives you back the finished page, no lesson id and no database involved.

→ [`docs/API.md`](API.md) · [`docs/TEMPLATES.md`](TEMPLATES.md)

---

## 3 · Publish — cache and serve

| | |
|---|---|
| **Input** | the rendered page + the canonical request |
| **Output** | a stable URL: `GET /t/<key>` |
| **Code** | `server/pipeline/cache.mjs` · `server/pipeline/sign.mjs` |

The key is *derived* from the request, not random — so two callers asking for the same sheet get the
same key and the same URL, and the second one is served off disk. `EDU_PIPELINE_PAGE_SECRET` signs
the link; without it the key is computable from the `document_idx` and the page is effectively
public.

Because the key is derived, it is exactly the wrong thing to hand one student. That is stage 4′.

---

## 4 · Use — print, present, embed

| | |
|---|---|
| **Input** | the page |
| **Output** | paper · a classroom screen · an `<iframe>` in someone else's site |
| **Code** | `assets/css/print.css` · `assets/js/present.js` · `assets/js/embed.js` |

Every template prints to exactly one A4 page. Presentation mode does not re-render anything: it
*moves* the live card onto a slide stage and moves it back on exit, so every answer already typed
survives the trip.

→ [`docs/TEMPLATES.md`](TEMPLATES.md#presentation-mode) · [`docs/DEPLOY.md`](DEPLOY.md#embedding-in-another-site)

---

## 4′ · Issue — one link, one student, once

| | |
|---|---|
| **Input** | an answerable built document + a `student_id` (and optionally a `group_id`) |
| **Output** | an assignment record + `answer_url`, `report_url`, `result_url` |
| **Stored** | `assignments` + `link_events` (+ `groups`) in MongoDB |
| **Code** | `server/pipeline/answers/store.mjs` → `server/store/assignments.mjs` |
| **Entry** | `POST /api/pipeline/assign` |

An assignment sits *in front of* the cached page. Its id is random, not derived; it names one
student; it carries the answer key, the goals and the scoring mode; and it has a lifecycle:

```
  issued ──open──▶ issued ──submit──▶ submitted   (link dead)
     └─────────── revoke / expire ──▶ revoked     (link dead)
```

Nothing reopens a dead link. "Give the student another go" means issuing a *new* assignment, which
mints a new id and a new token — so a leaked old link is worth nothing, and every attempt is its own
record with its own result instead of one record quietly overwritten.

A type that asks nothing (a lesson plan, a golden-minutes card) returns **no** link and says why in
`warnings`. That is not an error: generating a lesson plan for a named student is a perfectly good
thing to do, there is simply nothing to submit.

**The student is a snapshot, not a lookup.** `student_id` and `student_name` arrive on the request
from the platform that calls this one, and are stored *on the assignment* exactly as sent. There is
no roster here to join to, deliberately: a sheet issued last term must keep the name that was
printed on it after the student is renamed, moved or removed.

`school`, `teacher` and `exam_date` travel the same way and are kept on the same terms — printed
on the sheet, stored on the assignment, copied onto the analysis, so a result read months later
still says which school it came from, who set it and when it was sat.

Every transition is also written to `link_events` — including refused attempts to open a dead
link, with the reason. That is the record that answers "the student says it did not work".

→ [`docs/PIPELINE.md`](PIPELINE.md#answer-sheets) · [`docs/DATABASE.md`](DATABASE.md#distribution)

---

## 5 · Answer — the page reads itself back

| | |
|---|---|
| **Input** | what the student did to the sheet |
| **Output** | `{question_id: answer}`, posted once |
| **Code** | `assets/js/answer.js` |
| **Entry** | `POST /api/pipeline/submit` |

`answer.js` ships **only** on an issued sheet. It does not re-render anything: the sheet is already
on the page with the controls each question kind needs, and every question carries `data-qid`. The
whole job is to read that markup back.

Reading the DOM rather than keeping a parallel model is deliberate — the student's answer *is* what
is on the sheet, and on a sheet that can be submitted once, a model that drifts by one answer is not
a small bug.

What it reads, in order of specificity:

| on the sheet | read as |
|---|---|
| a selected option (`.qz-opt.sel`, `.ic-opt.sel`, `.opt.sel`, `.lp-opt.on`) | the option's own text, from `data-value` |
| filled blanks (`.blank`) | one string, or a list when there are several |
| writing lines (`.wline`) | the text, joined |
| an untouched question | `""` — not missing, so "left blank" is distinguishable from "never asked" |

The correct answers are not here and never arrive.

---

## 6 · Grade — each answer against the key

| | |
|---|---|
| **Input** | the stored answer key + what the student sent |
| **Output** | one graded row per question |
| **Code** | `server/pipeline/answers/grade.mjs` |

Arabic is written more than one way and students type it the way they write it, so every comparison
happens on a folded form: no tashkeel, `أ إ آ ا` → `ا`, `ة` → `ه`, `ى` → `ي`.

| kind | graded on |
|---|---|
| `multiple_choice` | the chosen option — by text, by index, or by its Arabic letter |
| `true_false` | صح / خطأ, however it was expressed (`true`, `1`, `✓`, …) |
| `complete` | each blank separately; the mark needs all of them |
| `short_answer` | overlap with the model answer — and it says how sure it is |
| `scale` | which point of the scale was ticked, and what that point is worth |

Short answers are the honest limit of automatic grading: anything in the middle band comes back
flagged `needs_review` rather than quietly counted.

`scale` is the survey kind, and it is the one with **no right answer at all**. `correct` on a scale
row means *responded*; the number that carries the meaning is `points`.

---

## 7 · Analyse — what it means

| | |
|---|---|
| **Input** | the graded rows + the lesson's goals (or the survey's styles) |
| **Output** | `overall`, `goals`, `questions`, `report` — and `profile` on a survey |
| **Code** | `answers/analyze.mjs` (mastery) · `answers/profile.mjs` (profile) |

`analyze()` dispatches on the assignment's `scoring` field. Both paths return the **same top-level
shape**, so the report page, the dashboard and the exports read either without knowing which they
were handed.

### mastery — `answers/analyze.mjs`

A score out of ten tells a teacher nothing they can act on. A lesson has goals, every question was
written to test one, so the unit of analysis is the goal:

```
goal_3 · 2 من 3 صحيحة · 67% · يحتاج مراجعة
         "راجع أمثلة إضافية على: يميّز بين الجملة الاسمية والفعلية"
```

Two decisions worth knowing: **unanswered counts as wrong** in the percentage (a blank demonstrates
nothing) but is tallied separately; and **goals with no questions are still listed**, at percentage
`null`, so a sheet that missed a goal says so.

### profile — `answers/profile.mjs`

A survey statement has no right answer, so it is scored, not marked:

| | |
|---|---|
| score of a style | Σ points of the statements that feed it |
| the verdict | the single highest style |
| a tie between two or more | `verdict.balanced` — "متوازن" |
| nothing ticked at all | `verdict.undecided` — "غير محدد" |

One style occupies the slot a lesson goal occupies (`goal_id: "style:visual"`), and a style's
percentage is its **affinity**, not a mark. `overall.percentage` is the dominant style's affinity.
A skipped statement still counts against its style's ceiling — a survey where skipping raises your
score is a broken survey.

The comparison is on **points**, not percentages, which is why the builder gives every style the
same number of statements: an unequal ceiling would make "highest score" and "strongest preference"
two different answers.

---

## 8 · Deliver — where the result goes

| | |
|---|---|
| **Input** | the analysis |
| **Output** | database records, a file, a log line, and an HTTP POST |
| **Stored** | `submissions` + `analyses` (+ `deliveries`) in MongoDB |
| **Code** | `server/pipeline/answers/deliver.mjs` → `server/store/results.mjs` |

Four destinations, in this order, and the order matters:

1. **MongoDB** — `submissions` (what arrived, untouched, plus one mark per question) and
   `analyses` (what it means, per goal). Written first, because it is the one that gets queried.
2. **The output directory** — `<id>.json` and `<id>.html`, a readable copy for a human with SSH.
3. **stdout** — a summary line and the full JSON, for a deployment with no backend yet.
4. **Your backend** — `EDU_PIPELINE_SUBMIT_ENDPOINT` gets what the student answered,
   `EDU_PIPELINE_ANALYSIS_ENDPOINT` gets what it means. Both optional, both posted in parallel,
   and both recorded in `deliveries` whether they succeed or not.

The result is stored before the network is touched, so a backend that is down costs the school
nothing. A failed POST is *reported* — in the submit response and in the log — and never turned into
a failed submission: the student has already answered, and telling them their work did not save
because an internal service was unreachable would be a lie.

`submissions.answers` is **evidence** and is never rewritten. Everything in `analyses` is
**interpretation** and is replaced whole by a re-grade, which bumps `revision`. That split is what
makes "re-grade last term against the corrected key" a safe operation rather than a destructive one.

---

## 9 · Read — the result, for a person

| | |
|---|---|
| **Input** | the stored analysis |
| **Output** | a page a teacher reads, or JSON a system consumes |
| **Code** | `answers/report.mjs` · `answers/dashboard.mjs` · `answers/group.mjs` |

| what | where |
|---|---|
| the student's own result | shown in the browser the moment they submit |
| the teacher's report page | `GET /api/pipeline/report/<id>` |
| the analysis as JSON | `GET /api/pipeline/result/<id>` |
| the whole class | `GET /api/pipeline/group/<id>/dashboard` |
| everything the class sent | `GET /api/pipeline/group/<id>/answers` |

The report page is self-contained — no stylesheet links, no scripts, no fonts that have to load —
because the same file is served from the API, written to the output directory and mailed around as
an attachment, and has to look the same in all three.

A survey renders the *same page* with three words changed: its "goals" are learning styles, its
percentages are affinities, and its fourth column holds what a tick was worth instead of a model
answer. A teacher reading both should not have to learn two pages.

→ [`docs/PIPELINE.md`](PIPELINE.md#groups)

---

## Where a request can stop

| you called | it stops at |
|---|---|
| `POST /api/render` | 2 — you get the page back, nothing is stored |
| `POST /api/pipeline/document` | 3 — you get a URL |
| `POST /api/pipeline/document` on a type that asks nothing | 3, with a `warnings` line saying no link was issued |
| `POST /api/pipeline/assign` | 4′ — you get one link per student |
| the student submits | 8 — and 9 is available from then on |
| `index.html?lesson=<id>` | 2, in the browser, from a static file |
