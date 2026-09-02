# Extending it

[← README](../README.md) · [Lifecycle](LIFECYCLE.md) · [Templates](TEMPLATES.md) · [JSON](JSON.md) · [Render API](API.md) · [Pipeline](PIPELINE.md) · [Database](DATABASE.md) · [Deploy](DEPLOY.md) · [Extending](EXTENDING.md)

Three sizes of change, from smallest to largest:

| you want | you touch |
|---|---|
| [a new sheet](#creating-a-new-worksheet) | one JSON file |
| [a new activity type](#a-new-activity-type) inside a worksheet | one module in `assets/js/sections/` |
| [a new template](#a-new-template) — a whole sheet | one module in `assets/js/templates/` + one CSS file |
| [a new document type](#adding-a-document-type) the pipeline can build | one module in `server/pipeline/build/` |

Nothing here needs a build step. Add the file, add one line to the index, reload.

---

## Project structure

Four things live at the root: the two pages a browser opens, the one file you configure, and the
Docker recipe. Everything else is grouped by role.

```
index.html               the worksheet page
embed.html               same engine, chrome stripped, for <iframe> embedding
config.js                ← the only file you edit per environment
package.json             npm scripts (start / dev / pack-lessons / docker:*)
Dockerfile               the runtime image — Node + this tree, no build step
docker-compose.yml       docker compose up → http://localhost:8138
env.example              copy to .env — API key, MongoDB, the page-signing secret
assets/
  css/
    base.css             tokens, reset, page shell, loading/error states, toolbar
    layout.css           hero, student bar, card grid, card chrome, footer
    sections.css         one block per section type
    theme-pro.css        the professional theme (scoped to [data-theme="pro"])
    print.css            single-A4-page print rules (media="print")
    present.css          presentation / board mode — the dark stage and its slides
    template-cards.css   both interactive-card templates (pro base + kid overrides)
    template-diff-lesson.css  the differentiated-lesson template (pro base + kid overrides)
    template-golden-minutes.css  the golden-minutes card (pro base + kid overrides)
    template-learning-pattern.css  the learning-styles survey (pro base + kid overrides)
  js/
    main.js              entry point: boot, states, toolbar, public API
    loader.js            URL → lesson JSON (API / static / inline)
    render.js            dispatcher: pick template → set theme → render → wire
    answer.js            issued sheets only: collect {question_id: answer} and submit once
    theme.js             palettes, age/theme + color/accent vocabulary
    logo.js              the fixed site-wide school logo (config.js → logo)
    icons.js             built-in line-art SVG icon set
    card.js              shared worksheet card chrome
    blocks.js            hero, student bar, info, warmup, objectives, footer
    util.js              escaping, the image-slot rule, small helpers
    present.js           presentation mode: cards moved onto a full-screen stage, F5 / 🎬
    to-image.js          save-as-image: capture the sheet as an A4 JPG (all templates)
    vendor/html2canvas.min.js  the capture library, loaded lazily on first use
    embed.js             iframe height/ready/error messages
    iframe-resizer.js    drop-in script for the HOST page
    guard.js             anti-clone guard: blocks file:// and foreign domains
    protect.js           optional right-click / copy deterrents
    pack.js              encrypted .wsx lesson container (browser + Node)
    templates/
      index.js           the template registry + detection
      worksheet.js
      interactive-card.js
      interactive-card-answers.js
      differentiated-lesson.js
      golden-minutes.js
      learning-pattern.js
      card-head.js       masthead/footer pieces shared by both card templates
    sections/            activity types INSIDE the worksheet template
      index.js           the section registry
      choose.js  fill-blank.js  matching.js  classify.js  drawing.js
      homework.js  self-assessment.js  signatures.js  note.js
      question.js        one identified question — answerable on screen and on paper
  img/favicon.svg
  img/logo.png    placeholder crest — replace it with your own; it is the
                         ONE logo every template shows, and the default the
                         pipeline stamps on generated sheets (EDU_PIPELINE_LOGO)
data/lessons/
  _starter-template.json                    copy this to start a new worksheet
  science-g2-living-creatures-needs.json    worksheet
  science-g1-plant-parts.json               worksheet
  physics-g9-newton-laws.json               worksheet, pro
  arabic-g5-sentence-types-cards.json       interactive-card
  digital-g7-cyber-safety-answers.json      interactive-card-answers
  math-g7-linear-equations-diff.json        differentiated-lesson, pro
  golden-minutes-card.json                  golden-minutes (empty, ready to fill)
  learning-pattern-survey.json              learning-pattern (16 statements, 4 styles)
  *.wsx                                     the same lessons, encrypted (tools/pack-lessons.mjs)
server/                                     the render API — Node ≥ 18, zero dependencies
  server.mjs               routes + static hosting: npm start
  render-page.mjs          worksheet JSON → a complete HTML page, rendered in Node
  pipeline/                  document pipeline — the unified endpoint (docs/PIPELINE.md)
    config.mjs               its own settings — every credential from the environment
    index.mjs                what the extension exports — the two lines server.mjs calls
    env.mjs                  loads .env, so npm start and compose behave alike
    sign.mjs                 HMAC-signed /t/<key> links
    mongo/                   a small BSON + OP_MSG + SCRAM client, so the tree stays dependency-free
    source.mjs               document_idx → one normalized lesson from three collections
    subject.mjs              the المادة line: whatever the database stored → the Arabic label
    rng.mjs                  the seed: same seed, same questions
    build/                   one module per document type → core-template JSON
    cache.mjs                build a page once, serve it from disk thereafter
    answers/                 issued sheets, grading, analysis, delivery
      store.mjs                one issued sheet, one student, one submission
      grade.mjs                one submitted answer against one key row
      analyze.mjs              graded answers → mastery, per lesson goal
      profile.mjs              graded answers → a profile, per category (surveys)
      deliver.mjs              file · stdout · your backend
      report.mjs               the analysis as a page a teacher can read
      group.mjs / dashboard.mjs  the same, over a whole class
    routes.mjs               /api/pipeline/* · /t/<key> · /a/<assignment>
examples/
  embed-example.html                        a demo HOST page — how a customer embeds a worksheet
  group-dashboard.http                      the group/dashboard calls, runnable, with their responses
docs/
  LIFECYCLE.md                              the nine stages, end to end — start here
  TEMPLATES.md                              the six templates, presenting, printing
  JSON.md                                   every field of every template
  API.md                                    the render API reference
  PIPELINE.md                               MongoDB → cached page → graded sheet
  DEPLOY.md                                 Docker, environment, logo, protection
  EXTENDING.md                              this file
  postman/
    EduWebTemplateGenerator.*.json          the render API — collection + environment
    Pipeline.*.json                         the pipeline — collection + environment
tools/
  pack-lessons.mjs                          encrypt lessons: node tools/pack-lessons.mjs
  make-postman.mjs                          regenerate the Postman collection from data/lessons/
  make-pipeline-postman.mjs                 regenerate the pipeline Postman collection
previews/                                   the screenshots used in the README
```

| npm script | Does |
|---|---|
| `npm start` | serve the site + API on `:8138` |
| `npm run dev` | the same, restarting on file changes (`node --watch`) |
| `npm run health` | print `/api/health` from a running server |
| `npm run pack-lessons` | encrypt `data/lessons/*.json` → `.wsx` |
| `npm run make-postman` | regenerate the render-API Postman collection from the real lessons |
| `npm run make-pipeline-postman` | regenerate the pipeline Postman collection |
| `npm run docker:build` · `docker:up` · `docker:down` · `docker:logs` | the compose lifecycle |

Two levels of plug-in:

- **`templates/*.js`** own a whole sheet (masthead → body → footer).
- **`sections/*.js`** own one activity card inside the worksheet template, markup **and**
  interactivity together.

Either way, adding one means adding one file and one registry line — nothing else changes.

---

---

## Creating a new worksheet

1. Copy `data/lessons/_starter-template.json` → `data/lessons/<subject>-<grade>-<topic>.json`.
2. Edit texts, icons/image links, and the section list (add/remove/reorder freely).
3. Open `index.html?lesson=<subject>-<grade>-<topic>`.

The filename **is** the lesson id.

## A new activity type

1. Create `assets/js/sections/my-type.js`:
   ```js
   export const type = "my-type";
   export function render(sec){ return `…html…`; }       // required
   export function wire(cardEl){ /* listeners */ }       // optional
   export function reset(cardEl){ /* clear answers */ }  // optional
   ```
2. Import it in `assets/js/sections/index.js` and add it to the `MODULES` array.
3. Style it in `assets/css/sections.css`.

## A new template

1. Create `assets/js/templates/my-template.js`:
   ```js
   export const template = "my-template";
   export function render(data, ctx){ return `…html…`; } // required
   export function wire(app, data){ return { onResize: [] }; }  // optional
   export function reset(app){ /* clear answers */ }            // optional
   ```
2. Import it in `assets/js/templates/index.js`, add it to `MODULES`, and add any spelling
   variants to `ALIASES`.
3. Style it (scope your rules to `.page[data-template="my-template"]`).

Write the professional look unscoped and the kid look under `[data-theme="playful"]` — the higher
specificity means kid always wins, whatever the file order.

---

## Adding a document type

A *type* is what the pipeline can build from a lesson; a *template* is what draws it. Several types
can share one template (`summary` and `worksheet` both draw as `worksheet`).

1. Create `server/pipeline/build/my-type.mjs` exporting:

   | export | | |
   |---|---|---|
   | `type` | `"my-type"` | the API value |
   | `template` | `"worksheet"` | which core template renders it |
   | `label` | Arabic name | shown by `GET /api/pipeline/types` |
   | `describes` | one line | also for `/types` |
   | `defaultCounts` | `{ questions: 5 }` | `null` = take everything, `0` = none |
   | `scoring` | `"mastery"` (default) or `"profile"` | how a submission is read |
   | `build` | `(lesson, ctx) => ({ data, title, used })` | the work |

2. Import it in `server/pipeline/build/index.mjs` and add it to `MODULES`.

`ctx.stream(label)` hands the builder a generator seeded by **both** the request seed and the label,
so `seed=7` draws the same true/false questions no matter how many multiple-choice questions were
drawn first. Without that, adding one card to a deck would silently reshuffle every later draw.

### Making it answerable

Return a `questions` array from `build()` and the generic key builder derives the answer key from it
— model answers, lesson goals and all. That is what `worksheet`, `cards` and `summary` do.

If your questions have no model answer and no lesson goal — a survey, a self-report, a rating —
return an `answerKey` of your own instead, plus `goals` for whatever the categories are, and set
`scoring = "profile"`. `build/learning-pattern.mjs` is the worked example: its "goals" are learning
styles, its key rows are `kind: "scale"`, and `answers/profile.mjs` reads them.

Either way the rest of the pipeline — issuing, the single-use link, grading, delivery, the report
page, the class dashboard — needs no change.
