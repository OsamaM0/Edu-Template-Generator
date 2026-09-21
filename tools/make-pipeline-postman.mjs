/* ============================================================================
   make-pipeline-postman.mjs — the Postman collection for the pipeline endpoint
   ----------------------------------------------------------------------------
   The unified endpoint takes a document type, a document_idx and a seed and
   returns the URL of a finished, cached page. This collection is runnable top
   to bottom: the first build captures the page key and its signed URL into
   collection variables, and every later request reuses them — so "open the
   page", "read its data" and "drop it from the cache" all just work.

     node tools/make-pipeline-postman.mjs

   Writes docs/postman/Pipeline.postman_collection.json
      and docs/postman/Pipeline.postman_environment.json

   Companion to make-postman.mjs (the core render API). Kept separate because
   the extension is separate — see docs/PIPELINE-API.md.
   ========================================================================== */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT  = path.join(ROOT, "docs", "postman");

const json = v => JSON.stringify(v, null, 2);

/* --- request helpers -------------------------------------------------------- */

const raw = body => ({ mode: "raw", raw: json(body), options: { raw: { language: "json" } } });

const url = (pathStr, query) => {
  const u = {
    raw: `{{baseUrl}}${pathStr}${query && query.length ? "?" + query.map(q => `${q.key}=${q.value}`).join("&") : ""}`,
    host: ["{{baseUrl}}"],
    path: pathStr.replace(/^\//, "").split("/")
  };
  if (query && query.length) u.query = query;
  return u;
};

const test = lines => ({ listen: "test", script: { type: "text/javascript", exec: lines } });

function req({ name, method = "GET", path: p, rawUrl, query, body, description, tests, auth }) {
  const request = {
    method,
    header: body ? [{ key: "Content-Type", value: "application/json" }] : [],
    url: rawUrl || url(p, query),
    description
  };
  if (auth) request.auth = auth;
  const item = { name, request };
  if (body) item.request.body = raw(body);
  if (tests) item.event = [test(tests)];
  return item;
}

const NOAUTH = { type: "noauth" };

/* --- reusable test snippets ------------------------------------------------- */

/** Every build response: capture the key and the SIGNED url for later requests. */
const BUILD_TESTS = [
  "pm.test(\"built (200 cached, or 201 fresh)\", () => {",
  "  pm.expect([200, 201]).to.include(pm.response.code);",
  "});",
  "const b = pm.response.json();",
  "pm.test(\"carries a key and a page url\", () => {",
  "  pm.expect(b).to.have.property(\"key\");",
  "  pm.expect(b).to.have.property(\"url\");",
  "});",
  "// The url is already signed when the server has EDU_PIPELINE_PAGE_SECRET set —",
  "// store it whole so \"Open the page\" needs no token wrangling.",
  "pm.collectionVariables.set(\"docKey\", b.key);",
  "pm.collectionVariables.set(\"pageUrl\", b.url);",
  "console.log(b.type, \"| key:\", b.key, \"| cached:\", b.cached, \"| used:\", JSON.stringify(b.used));",
  "console.log(\"page:\", b.url);",
  "if (b.warnings) console.log(\"warnings:\", b.warnings.join(\" | \"));"
];

/** A rendered page came back. */
const PAGE_TESTS = [
  "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
  "pm.test(\"an HTML page, built by this extension\", () => {",
  "  pm.expect(pm.response.headers.get(\"Content-Type\")).to.include(\"text/html\");",
  "  pm.expect(pm.response.text()).to.include(\"<div class=\\\"page\\\"\");",
  "  pm.expect(pm.response.headers.get(\"X-Pipeline-Key\")).to.be.a(\"string\");",
  "});"
];

/* --- example request bodies ------------------------------------------------- */

const BODY = extra => Object.assign({ type: "worksheet", document_idx: "{{documentIdx}}", seed: "{{seed}}" }, extra);

/* --- the collection --------------------------------------------------------- */

const collection = {
  info: {
    _postman_id: "d5a9f4c1-7b28-4e63-9a0f-6c1e2b8d4a37",
    name: "Pipeline — Unified document endpoint",
    description: [
      "نقطة نهاية واحدة: تعطيها نوع المستند و `document_idx` وبذرة عشوائية، فتقرأ الدرس من",
      "MongoDB وتعيد رابط صفحة جاهزة ومخزّنة. اطلبها ثانيةً بنفس المدخلات فتحصل على الرابط",
      "نفسه بلا إعادة بناء.",
      "",
      "One endpoint: give it a document type, a `document_idx` and a seed; it reads the",
      "lesson from the generator's MongoDB and returns the URL of a finished, cached page.",
      "Ask again with the same inputs and you get the same URL, unbuilt.",
      "",
      "**Two databases, one server.** Lessons are read from the generator's (`ai`) and never",
      "written to; everything this platform produces — documents, links, answers, analyses —",
      "is written to its own (`activities`). Run `npm run store:check` first: it verifies the",
      "Mongo user can actually WRITE, which a `read`-only user fails only at submission time.",
      "",
      "**No roster is stored.** `student_id`, `student_name`, `group_id` and the rest arrive as",
      "parameters from the calling platform and are kept as snapshots on what is issued.",
      "Folder *9 · The store* reads back what this service does own.",
      "",
      "**Runnable in order.** The first build under *2 · Build a document* stores the page",
      "`key` and its signed `url` in collection variables, and everything after reuses them.",
      "",
      "**Variables** — `baseUrl` (default `http://localhost:8138`), `apiKey` (required when the",
      "server runs with `EDU_API_KEY`), `documentIdx`, `seed`; `docKey` and `pageUrl` are filled",
      "automatically by any build request.",
      "",
      "**Security** — `apiKey` is sent on every `/api/*` call. Page links are signed when the",
      "server sets `EDU_PIPELINE_PAGE_SECRET`, so open pages through the captured `pageUrl`, not by",
      "hand. See the *8 · Security* folder.",
      "",
      "**ورقة الطالب** — أرسل `student_id` فتحصل مع الورقة على رابط يُفتح مرة واحدة، يُصحَّح عند التسليم ويُحلَّل لكل هدف. المجلّد السادس يمشي الدورة كاملة.",
      "",
      "**المجموعة** — أضِف `group_id` فتصبح أوراق الصف كلها مجموعة واحدة: نداء واحد يصدرها كلها، و `/api/pipeline/group/<id>/dashboard` لوحة تحليل الصف كاملًا مع ملخص كل طالب ورابط إجاباته. المجلّد السابع.",
      "",
      "Full documentation: `docs/PIPELINE-API.md`."
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },

  auth: {
    type: "apikey",
    apikey: [
      { key: "key", value: "X-Api-Key", type: "string" },
      { key: "value", value: "{{apiKey}}", type: "string" },
      { key: "in", value: "header", type: "string" }
    ]
  },

  variable: [
    { key: "baseUrl", value: "http://localhost:8138", type: "string" },
    { key: "apiKey", value: "", type: "string" },
    { key: "documentIdx", value: "43617", type: "string" },
    { key: "seed", value: "7", type: "string" },
    { key: "color", value: "teal", type: "string" },
    { key: "docKey", value: "", type: "string" },
    { key: "pageUrl", value: "", type: "string" },
    { key: "studentId", value: "STU-1042", type: "string" },
    { key: "studentName", value: "أحمد بن سالم", type: "string" },
    { key: "assignmentId", value: "", type: "string" },
    { key: "assignmentToken", value: "", type: "string" },
    { key: "answerUrl", value: "", type: "string" },
    { key: "questionIds", value: "", type: "string" },
    { key: "groupId", value: "lesson-43617-oct", type: "string" },
    { key: "groupName", value: "الخامس/ب — أنواع الجملة", type: "string" },
    { key: "examDate", value: "2026-09-15", type: "string" },
    { key: "schoolName", value: "ثانوية الأمير محمد", type: "string" },
    { key: "teacherName", value: "أ. سارة الحارثي", type: "string" },
    { key: "subjectName", value: "المهارات الرقمية", type: "string" }
  ],

  item: [
    /* -------------------------------------------------------- 1. health/types */
    {
      name: "1 · الحالة والأنواع — Health & types",
      description: "هل الإضافة تعمل، وهل قاعدة البيانات متصلة، وما أنواع المستندات المتاحة.",
      item: [
        req({
          name: "GET /api/pipeline/health",
          path: "/api/pipeline/health",
          description: [
            "حالة الإضافة وقاعدة البيانات والتخزين المؤقت، وأي إعدادات ناقصة.",
            "يبلّغ عن وجود المفاتيح لا عن قيمها.",
            "",
            "503 إن لم يُضبط `EDU_PIPELINE_MONGO_URI`."
          ].join("\n"),
          tests: [
            "pm.test(\"the extension answers\", () => {",
            "  pm.expect(pm.response.json().extension).to.eql(\"pipeline\");",
            "});",
            "const h = pm.response.json();",
            "console.log(\"security:\", JSON.stringify(h.security));",
            "console.log(\"database:\", JSON.stringify(h.database), \"| cache pages:\", h.cache && h.cache.pages);",
            "if (h.warnings) console.log(\"warnings:\", h.warnings.join(\" | \"));"
          ]
        }),
        req({
          name: "GET /api/pipeline/types",
          path: "/api/pipeline/types",
          description: "أنواع المستندات السبعة، والقالب الذي يصيّره كلٌّ منها، وأسماء الأعداد (counts) التي يقبلها.",
          tests: [
            "pm.test(\"seven document types\", () => {",
            "  pm.expect(pm.response.json().types).to.have.lengthOf(7);",
            "});",
            "console.log(pm.response.json().types.map(t => t.type + \" → \" + t.template).join(\"\\n\"));"
          ]
        })
      ]
    },

    /* -------------------------------------------------------- 2. build a doc */
    {
      name: "2 · توليد مستند — Build a document",
      description: [
        "النوع + `document_idx` + البذرة ⇒ رابط صفحة مخزّنة.",
        "",
        "أول طلب هنا (ورقة العمل، POST) هو المرساة: يخزّن `docKey` و `pageUrl` لبقية المجموعة.",
        "كل طلب توليد لاحق يحدّثهما، فتفتح دائمًا آخر ما بنيته."
      ].join("\n"),
      item: [
        req({
          name: "POST /api/pipeline/document — ورقة عمل (المرساة)",
          method: "POST",
          path: "/api/pipeline/document",
          body: BODY(),
          description: [
            "الشكل الأساسي للطلب: `{ type, document_idx, seed }`.",
            "",
            "يعيد `url` (موقّع)، و `embedUrl`/`printUrl`/`imageUrl`/`downloadUrl`، و `dataUrl`،",
            "مع `used` (كم سؤالًا من كل نوع رُسم) و `sources` (أي المجموعات وُجدت).",
            "",
            "201 عند البناء لأول مرة، و 200 عند الإرجاع من التخزين المؤقت."
          ].join("\n"),
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=cards — بطاقات أسئلة",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "cards" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" }
          ],
          description: "بطاقات مراجعة قابلة للقص، سؤال في كل بطاقة. البذرة تحدّد أي الأسئلة تُختار.",
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=answers — مفتاح الإجابة (نفس البذرة)",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "answers" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" }
          ],
          description: [
            "مفتاح الإجابة المطابق لبطاقات الأسئلة بنفس البذرة — نفس الأسئلة، نفس الترتيب.",
            "",
            "`answers` تسحب من نفس مجاري البذرة التي تسحب منها `cards`، فـ `seed` واحد يعطيك",
            "الدفتر ومفتاحه."
          ].join("\n"),
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=lesson-plan — خطة درس متمايزة",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "lesson-plan" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" }
          ],
          description: "خطة درس للمعلّم: ثلاث مجموعات حسب الأولوية، أنشطة وتقويم متمايز، من بيانات ورقة العمل والملخّص.",
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=golden-minutes — بطاقة الدقائق الذهبية",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "golden-minutes" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" }
          ],
          description: "بطاقة الحصة: أول خمس دقائق وآخر خمس دقائق وقرار المعلّم، بسؤال ومهمة من الدرس.",
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=summary — ملخّص الدرس",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "summary" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" }
          ],
          description: "ورقة مراجعة: نصّ الملخّص مقسّمًا إلى بطاقات، مع المفردات والتطبيقات وسؤال مراجعة.",
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=learning-pattern — استبيان أنماط التعلم",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "learning-pattern" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" }
          ],
          description: [
            "استبيان تحديد أنماط التعلم (بصري، سماعي، حركي، قراءة/كتابة) — يصحّح نفسه في المتصفح.",
            "",
            "العبارات أداة قياس ثابتة لا تُولَّد من الدرس؛ الدرس يمنح الورقة لونها الثابت،",
            "و `student` يعبّئ صف بيانات الطالب. `count.questions=N` يسحب N عبارات **لكل نمط**",
            "حتى تبقى السقوف متساوية بين الأنماط الأربعة.",
            "",
            "الأسماء البديلة: `learning-styles` · `style-survey` · `vark`."
          ].join("\n"),
          tests: BUILD_TESTS
        }),
        req({
          name: "POST /api/pipeline/document — أعداد مخصّصة (counts)",
          method: "POST",
          path: "/api/pipeline/document",
          body: BODY({
            type: "cards",
            counts: { multiple_choice: 5, true_false: 0, complete: 0, short_answer: 0 }
          }),
          description: [
            "`counts` يتحكّم بكم يُسحب من كل نوع. `0` يعني \"لا شيء\"، وطلب أكثر من المتوفّر يعطيك المتوفّر كلّه.",
            "",
            "على الرابط استخدم `count.multiple_choice=5` — الأسماء نفسها التي يعرضها `/types`."
          ].join("\n"),
          tests: BUILD_TESTS.concat([
            "pm.test(\"only the requested kind was drawn\", () => {",
            "  const used = pm.response.json().used;",
            "  pm.expect(used.multiple_choice).to.eql(5);",
            "  pm.expect(used.true_false || 0).to.eql(0);",
            "});"
          ])
        }),
        req({
          name: "GET ?exam_date=… — تاريخ الاختبار على الورقة",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "worksheet" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" },
            { key: "exam_date", value: "{{examDate}}", description: "2026-09-15 — أو أي نص يُطبع كما هو" }
          ],
          description: [
            "كل قالب يحمل خانة تاريخ، وكانت تُطبع فارغة ليكتبها أحدهم بخطّ اليد.",
            "`exam_date` يملؤها، فيصل الصفّ كلّه بأوراق متفقة على موعد الجلسة.",
            "",
            "**تاريخ يبدأ بالسنة** (`2026-09-15` أو `2026/9/5` أو طابع ISO كامل) يُقرأ ويُطبع",
            "بالعربية: *15 سبتمبر 2026*. أي شيء آخر يُطبع **كما أُرسل**، فـ `الأسبوع الرابع`",
            "جوابٌ صالح أيضًا. الصيغ التي تبدأ باليوم (`15/09/2026`) لا تُقرأ: معناها يختلف",
            "باختلاف البلد، وورقة تطبع اليوم الخطأ بصمت أسوأ من ورقة تطبع النص كما هو.",
            "",
            "التاريخ المُعبّأ يُطبع نصًّا مقفلًا لا سطرًا قابلًا للكتابة: جلسة لها موعد",
            "لا يصحّ أن تعود موسومة بموعد آخر. بلا `exam_date` تبقى الخانة فارغة كما كانت.",
            "",
            "**جزء من مفتاح التخزين**: الورقة نفسها في يومين ورقتان. الرد يعيده في",
            "`exam_date` (اليوم بصيغة ISO) و `exam_date_text` (ما تُظهره الورقة).",
            "",
            "مرادفات: `date` · `exam_day` · `test_date` · `sitting_date`."
          ].join("\n"),
          tests: BUILD_TESTS.concat([
            "pm.test(\"the date came back both ways\", () => {",
            "  pm.expect(b.exam_date).to.be.a(\"string\").and.not.empty;",
            "  pm.expect(b.exam_date_text).to.be.a(\"string\").and.not.empty;",
            "});",
            "console.log(\"exam date:\", b.exam_date, \"→\", b.exam_date_text);"
          ])
        }),
        req({
          name: "GET ?school=…&teacher=… — المدرسة والمعلم على الترويسة",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "worksheet" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" },
            { key: "school", value: "{{schoolName}}", description: "اسم المدرسة — يُطبع في خانة المدرسة" },
            { key: "teacher", value: "{{teacherName}}", description: "اسم المعلم — يُطبع في خانة المعلم" }
          ],
          description: [
            "ترويسة كل ورقة تحمل خانتي **المدرسة** و **المعلم / المعلمة**، وكانتا تُطبعان",
            "فارغتين ليكتبهما أحدهم. `school` و `teacher` يملآنهما، تمامًا كما يملأ",
            "`exam_date` خانة التاريخ.",
            "",
            "**القيمة المجرّدة هي الاسم** لا المعرّف — عكس `student` — لأن لا كشف مدارس",
            "ولا كشف معلمين في هذه القاعدة: المدارس والمعلمون والصفوف تخصّ المنصّة",
            "المستدعية وتصل كمعاملات، والاسم هو النصف الذي يُطبع. أرسل المعرّف أيضًا",
            "(`school_id` و `teacher_id`) فيُحفظ ويعود كما أُرسل بلا بحث عنه.",
            "",
            "ثلاث صيغ كالطالب: `?school=…` أو `?school_id=…&school_name=…` أو",
            "`{ \"school\": { \"id\": …, \"name\": … } }`.",
            "",
            "**جزء من مفتاح التخزين**: مدرستان لا تتقاسمان صفحة واحدة. ما يُرسَل يُحفظ",
            "على الورقة المُصدَرة وعلى سجلّ المستند وعلى التحليل، ويظهر في تقرير الطالب",
            "وفي لوحة المجموعة. بلا معاملات تبقى الخانتان فارغتين قابلتين للكتابة كما كانتا."
          ].join("\n"),
          tests: BUILD_TESTS.concat([
            "pm.test(\"the header came back\", () => {",
            "  pm.expect(b.school.name).to.be.a(\"string\").and.not.empty;",
            "  pm.expect(b.teacher.name).to.be.a(\"string\").and.not.empty;",
            "});",
            "console.log(\"header:\", b.school.name, \"·\", b.teacher.name);"
          ])
        }),
        req({
          name: "GET ?subject=… — المادة على الترويسة",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "worksheet" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" },
            { key: "subject", value: "{{subjectName}}", description: "اسم المادة — يُطبع في خانة المادة" }
          ],
          description: [
            "خانة **المادة** تُطبع ما ترسله المنصّة، لا ما تستنتجه القاعدة.",
            "",
            "كانت تُشتقّ من وثائق الدرس — `_metadata.content_analysis.subject_area` وما",
            "شابهه — ثم تُترجم عبر جدول تسميات. كان ذلك تخمينًا هذا الخادم أسوأ من يقوم",
            "به، ويخطئ بما يكفي ليكون مشكلة. المنصّة المستدعية تعرف المادة يقينًا،",
            "فترسلها بجانب رقم الدرس وتُطبع كما أُرسلت.",
            "",
            "**القيمة المجرّدة هي الاسم** كالمدرسة والمعلم. ثلاث صيغ: `?subject=…` أو",
            "`?subject_id=…&subject_name=…` أو `{ \"subject\": { \"id\": …, \"name\": … } }`.",
            "",
            "**بلا `subject` تبقى الخانة فارغة وقابلة للكتابة** — سطر يكتبه المعلم، تمامًا",
            "كخانة المدرسة. ولا تعود إلى القاعدة إطلاقًا.",
            "",
            "**جزء من مفتاح التخزين**: مادتان لا تتقاسمان صفحة واحدة. تُحفظ على الورقة",
            "المُصدَرة وعلى سجلّ المستند، وتُطبع على نسخة الطالب في `/a/<id>` كما طُبعت",
            "على نسخة المعلم."
          ].join("\n"),
          tests: BUILD_TESTS.concat([
            "pm.test(\"the subject came back as sent\", () => {",
            "  pm.expect(b.subject.name).to.eql(pm.variables.get(\"subjectName\"));",
            "});",
            "console.log(\"subject:\", b.subject.name);"
          ])
        }),
        req({
          name: "GET ?type=worksheet&theme=playful — نمط مختلف",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "worksheet" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" },
            { key: "theme", value: "playful", description: "playful | pro — يتجاوز الافتراضي pro" }
          ],
          description: "النمط جزء من الصفحة، فله مفتاح تخزين خاص به. `playful` نمط مرح ملوّن، `pro` احترافي هادئ.",
          tests: BUILD_TESTS
        }),
        req({
          name: "GET ?type=cards&color=teal — اللون الرئيسي",
          path: "/api/pipeline/document",
          query: [
            { key: "type", value: "cards" },
            { key: "document_idx", value: "{{documentIdx}}" },
            { key: "seed", value: "{{seed}}" },
            { key: "color", value: "{{color}}", description: "اسم لون (teal, blue, purple…) أو hex مثل #177a6c" }
          ],
          description: [
            "`color` يحدّد اللون الرئيسي للصفحة، متجاوزًا لون الدرس الثابت.",
            "",
            "يقبل أسماء الألوان (blue · sky · green · orange · yellow · purple · pink · red · teal)",
            "أو قيمة hex مثل `#177a6c`. لونٌ غير صالح يُتجاهَل مع ملاحظة، ويبقى لون الدرس.",
            "",
            "اللون جزء من مفتاح التخزين، فلكل لون صفحته المخزّنة."
          ].join("\n"),
          tests: BUILD_TESTS.concat([
            "pm.test(\"the color was applied\", () => {",
            "  pm.expect(pm.response.json().color).to.eql(pm.collectionVariables.get(\"color\"));",
            "});"
          ])
        }),
        req({
          name: "POST /api/pipeline/document?format=html — الصفحة مباشرةً",
          method: "POST",
          path: "/api/pipeline/document",
          query: [{ key: "format", value: "html", description: "json (افتراضي) | html | redirect" }],
          body: BODY({ type: "cards" }),
          description: [
            "`format=html` يعيد صفحة HTML بدل وصفها بـ JSON — بناء ومعاينة في طلب واحد.",
            "",
            "(`format=redirect` يعيد 302 إلى رابط الصفحة الموقّع؛ يتبعه Postman تلقائيًا.)"
          ].join("\n"),
          tests: PAGE_TESTS
        })
      ]
    },

    /* --------------------------------------------------------- 3. page & data */
    {
      name: "3 · الصفحة وبياناتها — The page & its data",
      description: "افتح الصفحة المبنيّة، واقرأ الـ JSON الذي صُيّرت منه، وسجلّها ووصفها.",
      item: [
        req({
          name: "GET {{pageUrl}} — الصفحة الموقّعة",
          rawUrl: "{{pageUrl}}",
          description: [
            "الصفحة نفسها، عبر الرابط الموقّع الذي التقطه آخر طلب توليد.",
            "",
            "افتح تبويب **Preview** لرؤيتها كما في المتصفح. الترويسة `X-Pipeline-Key` تؤكّد المفتاح المخدوم."
          ].join("\n"),
          tests: PAGE_TESTS
        }),
        req({
          name: "GET {{pageUrl}}&embed=1 — نسخة التضمين",
          rawUrl: "{{pageUrl}}&embed=1",
          description: [
            "نفس الرابط الموقّع مع `&embed=1`: تُبنى نسخة التضمين تحت مفتاحها وتُخدَم.",
            "",
            "التوقيع يغطّي المفتاح الأصلي في المسار، فإضافة معاملات العرض إليه مسموحة."
          ].join("\n"),
          tests: PAGE_TESTS.concat([
            "pm.test(\"embedded chrome\", () => pm.expect(pm.response.text()).to.include(\"data-embed=\\\"1\\\"\"));"
          ])
        }),
        req({
          name: "GET {{pageUrl}}&download=1 — تنزيل كملف",
          rawUrl: "{{pageUrl}}&download=1",
          description: "يضيف `Content-Disposition: attachment` فيحفظ المتصفح الملف. الأسماء العربية مدعومة (RFC 5987).",
          tests: [
            "pm.test(\"served as a download\", () => {",
            "  pm.expect(pm.response.headers.get(\"Content-Disposition\")).to.include(\"attachment\");",
            "});"
          ]
        }),
        req({
          name: "GET /api/pipeline/document/{{docKey}} — سجلّ الصفحة",
          path: "/api/pipeline/document/{{docKey}}",
          description: "ماذا بُني تحت هذا المفتاح: النوع والقالب والبذرة و `used` و `sources` وروابط الصفحة الموقّعة.",
          tests: [
            "pm.test(\"the record comes back\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json().key).to.eql(pm.collectionVariables.get(\"docKey\"));",
            "});"
          ]
        }),
        req({
          name: "GET /api/pipeline/data/{{docKey}} — بيانات ورقة العمل",
          path: "/api/pipeline/data/{{docKey}}",
          description: "الـ JSON الذي صُيّرت منه الصفحة — نفس ما يقبله `POST /api/render` في الواجهة الأساسية.",
          tests: [
            "pm.test(\"worksheet JSON\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json()).to.have.property(\"meta\");",
            "});"
          ]
        })
      ]
    },

    /* ------------------------------------------------------- 4. inspect lesson */
    {
      name: "4 · الدرس الخام — Inspect the lesson",
      description: "الدرس بعد التوحيد من المجموعات الثلاث — للفحص وبناء الطلبات.",
      item: [
        req({
          name: "GET /api/pipeline/lesson/{{documentIdx}}",
          path: "/api/pipeline/lesson/{{documentIdx}}",
          description: [
            "الدرس المُوحّد: الأهداف والأسئلة (مبوّبة) والمفردات والتطبيقات والملخّص، مع `found` لأي",
            "المجموعات وُجدت و `questionCount` لإجمالي الأسئلة المتاحة.",
            "",
            "لا يبني صفحة ولا يستهلك التخزين — نافذة على البيانات فقط."
          ].join("\n"),
          tests: [
            "pm.test(\"lesson resolved\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json()).to.have.property(\"found\");",
            "});",
            "const l = pm.response.json();",
            "console.log(l.title, \"| questions:\", l.questionCount, \"| found:\", JSON.stringify(l.found));"
          ]
        })
      ]
    },

    /* ---------------------------------------------------------- 5. cache admin */
    {
      name: "5 · التخزين المؤقت — Cache",
      description: "ماذا هو مخزّن، وكيف تُسقط صفحة أو تُفرغ الكل. المفاتيح مشتقّة، فالحذف يعني إعادة البناء عند الطلب التالي.",
      item: [
        req({
          name: "GET /api/pipeline/cache — القائمة والإحصاءات",
          path: "/api/pipeline/cache",
          description: "عدد الصفحات وحجمها ومكان المجلّد، مع قائمة بما بُني.",
          tests: [
            "pm.test(\"cache stats\", () => pm.response.to.have.status(200));",
            "console.log(\"pages:\", pm.response.json().pages && pm.response.json().pages.length);"
          ]
        }),
        req({
          name: "DELETE /api/pipeline/document/{{docKey}} — أسقط صفحة",
          method: "DELETE",
          path: "/api/pipeline/document/{{docKey}}",
          description: "يحذف الصفحة المخزّنة. الطلب التالي بنفس المدخلات يعيد بناءها بالمفتاح نفسه.",
          tests: [
            "pm.test(\"deleted (or already gone)\", () => {",
            "  pm.expect([200, 404]).to.include(pm.response.code);",
            "});"
          ]
        }),
        req({
          name: "DELETE /api/pipeline/cache — أفرغ الكل",
          method: "DELETE",
          path: "/api/pipeline/cache",
          description: "يمسح كل الصفحات المبنيّة وذاكرة الدروس. يعيد عدد ما حُذف.",
          tests: [
            "pm.test(\"cleared\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json()).to.have.property(\"cleared\");",
            "});"
          ]
        })
      ]
    },

    /* --------------------------------------------------- 6. answer & analyse */
    {
      name: "6 · ورقة الطالب والتحليل — Issue, answer, analyse",
      description: [
        "دورة حياة ورقة تُسلَّم لطالب بعينه: إصدار رابط يُفتح مرة واحدة، تسليم الإجابات",
        "على شكل `{question_id: answer}`، ثم تحليل يربط كل سؤال بهدفه ويعطي نسبة تحقّق",
        "لكل هدف مع توصية مكتوبة.",
        "",
        "**Runnable in order.** الطلب الأول يخزّن `assignmentId` و `answerUrl` و",
        "`assignmentToken`، وما بعده يستعملها. التسليم يُبطل الرابط — أعد تشغيل المجلّد",
        "من أوله للحصول على رابط جديد.",
        "",
        "`/submit` و `/result` و `/report` لا تطلب `X-Api-Key`: الطالب لا يملكها، ويثبت",
        "هويته بالرمز `t` الذي في رابطه."
      ].join("\n"),
      item: [
        req({
          name: "POST /api/pipeline/assign — إصدار رابط لطالب",
          method: "POST",
          path: "/api/pipeline/assign",
          body: {
            type: "worksheet",
            document_idx: "{{documentIdx}}",
            seed: "{{seed}}",
            group_id: "{{groupId}}",
            group_name: "{{groupName}}",
            school: "{{schoolName}}",
            teacher: "{{teacherName}}",
            student: { id: "{{studentId}}", name: "{{studentName}}", classroom: "الخامس/ب" }
          },
          description: [
            "يبني الورقة، يطبع اسم الطالب ورقمه عليها، ويصدر رابطًا يُفتح مرة واحدة.",
            "",
            "كل استدعاء يصدر رابطًا **جديدًا** برقم ورمز جديدين — وهذا هو المقصود:",
            "«محاولة أخرى» تعني إصدارًا جديدًا، لا إحياء رابط مستهلك.",
            "",
            "`group_id` يودع هذه الورقة في مجموعة — وهو ما تقرؤه لوحة التحليل في",
            "المجلّد السابع. لا يظهر على الصفحة ولا يدخل في مفتاح التخزين المؤقت.",
            "",
            "الشيء نفسه يحدث تلقائيًا إذا أرسلت `student_id` إلى `/document`،",
            "فتحصل على نسخة الطباعة ورابط الطالب في ردٍّ واحد. `assign=0` يلغي ذلك."
          ].join("\n"),
          tests: [
            "pm.test(\"201 issued\", () => pm.response.to.have.status(201));",
            "const b = pm.response.json();",
            "pm.test(\"carries a single-use answer link\", () => {",
            "  pm.expect(b).to.have.property(\"assignment_id\");",
            "  pm.expect(b.answer_url).to.include(\"/a/\");",
            "  pm.expect(b.status).to.eql(\"issued\");",
            "});",
            "pm.collectionVariables.set(\"assignmentId\", b.assignment_id);",
            "pm.collectionVariables.set(\"answerUrl\", b.answer_url);",
            "pm.collectionVariables.set(\"assignmentToken\", new URL(b.answer_url).searchParams.get(\"t\"));",
            "console.log(b.question_count, \"questions ·\", b.goal_count, \"goals\");",
            "console.log(\"student link:\", b.answer_url);"
          ]
        }),
        req({
          name: "GET /a/:id — الورقة كما يراها الطالب",
          rawUrl: { raw: "{{answerUrl}}", host: ["{{answerUrl}}"] },
          auth: NOAUTH,
          description: [
            "الصفحة القابلة للحل. تحمل معرّف كل سؤال (`data-qid`) وطبقة `answer.js`",
            "التي تجمع الإجابات وترسلها.",
            "",
            "**لا تحمل الإجابات النموذجية.** مفتاح التصحيح يبقى على الخادم بجانب الإصدار،",
            "فالصفحة التي بيد الطالب لا تعرف الإجابة الصحيحة.",
            "",
            "فتحها يُسجَّل (`opened_at`) ولا يستهلكها — الاستهلاك يحدث عند التسليم وحده."
          ].join("\n"),
          tests: [
            "pm.test(\"200, and answerable\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.text()).to.include(\"window.EDU_ANSWER\");",
            "  pm.expect(pm.response.text()).to.include(\"data-qid=\");",
            "});",
            "const ids = [...pm.response.text().matchAll(/data-qid=\"([^\"]+)\"/g)].map(m => m[1]);",
            "pm.collectionVariables.set(\"questionIds\", JSON.stringify(ids));",
            "console.log(\"question ids on the sheet:\", ids.join(\" \"));"
          ]
        }),
        req({
          name: "POST /api/pipeline/submit — تسليم الإجابات",
          method: "POST",
          path: "/api/pipeline/submit",
          auth: NOAUTH,
          body: {
            assignment_id: "{{assignmentId}}",
            token: "{{assignmentToken}}",
            answers: { mc_1: "الجملة الاسمية", tf_1: "خطأ", cp_1: "الفعلية" }
          },
          description: [
            "`{ assignment_id, token, answers }` حيث `answers` هو `{question_id: answer}`.",
            "استبدل الأمثلة بالمعرّفات التي طبعها الطلب السابق في `questionIds`.",
            "",
            "الإجابة تُقبل بأي صياغة معقولة: نص الخيار أو حرفه أو رقمه، و«صح/خطأ» أو",
            "`true/false`، والتشكيل وهمزات الألف والتاء المربوطة لا تُفشل المطابقة.",
            "",
            "يعيد التحليل كاملًا: نسبة لكل هدف، وتقرير مكتوب، ونتيجة الإرسال إلى الخلفية.",
            "**ويُبطل الرابط** — الطلب التالي على نفس الرابط يعود بـ 410."
          ].join("\n"),
          tests: [
            "pm.test(\"201 graded\", () => pm.response.to.have.status(201));",
            "const b = pm.response.json();",
            "pm.test(\"per-goal analysis came back\", () => {",
            "  pm.expect(b.overall).to.have.property(\"percentage\");",
            "  pm.expect(Object.keys(b.goals).length).to.be.above(0);",
            "});",
            "console.log(b.overall.correct + \"/\" + b.overall.total, \"·\", b.overall.percentage + \"%\", \"·\", b.overall.mastery_label);",
            "Object.values(b.goals).forEach(g =>",
            "  console.log(g.goal_id, g.percentage + \"%\", g.correct + \"/\" + g.total, g.goal_text));",
            "console.log(\"report:\", b.report.summary);",
            "console.log(\"saved to:\", b.output && b.output.json);",
            "console.log(\"backend:\", JSON.stringify(b.delivery));"
          ]
        }),
        req({
          name: "GET /a/:id — بعد التسليم (يُتوقّع 410)",
          rawUrl: { raw: "{{answerUrl}}", host: ["{{answerUrl}}"] },
          auth: NOAUTH,
          description: [
            "الرابط استُهلك. يعود بصفحة عربية تشرح ذلك، لا برسالة خطأ JSON —",
            "من يفتحه طالب ضغط رابطًا، لا برنامج يقرأ ردًّا.",
            "",
            "لإعطاء الطالب محاولة أخرى: أعد `POST /assign`، فيصدر رابط جديد."
          ].join("\n"),
          tests: [
            "pm.test(\"the link is spent\", () => pm.response.to.have.status(410));"
          ]
        }),
        req({
          name: "GET /api/pipeline/result/:id — التحليل JSON",
          path: "/api/pipeline/result/{{assignmentId}}",
          query: [{ key: "t", value: "{{assignmentToken}}" }],
          auth: NOAUTH,
          description: [
            "التحليل المحفوظ. يقرؤه صاحب `X-Api-Key` أو حامل رمز الإصدار نفسه —",
            "وهذا ما يجعل متصفح الطالب قادرًا على فتح تقريره مباشرة بعد التسليم.",
            "",
            "الشكل: `goals[goal_id] = { percentage, correct, wrong, total, mastery, recommendation }`."
          ].join("\n"),
          tests: [
            "pm.test(\"200 with the goal breakdown\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json()).to.have.property(\"goals\");",
            "});"
          ]
        }),
        req({
          name: "GET /api/pipeline/report/:id — صفحة التحليل",
          path: "/api/pipeline/report/{{assignmentId}}",
          query: [{ key: "t", value: "{{assignmentToken}}" }],
          auth: NOAUTH,
          description: [
            "التحليل نفسه كصفحة HTML قائمة بذاتها: نسبة عامة، ثم الأهداف من الأضعف",
            "إلى الأقوى مع توصية لكل هدف، ثم الإجابات سؤالًا بسؤال. صالحة للطباعة.",
            "",
            "تُكتب النسخة نفسها في `EDU_PIPELINE_OUTPUT_DIR` عند كل تسليم."
          ].join("\n"),
          tests: [
            "pm.test(\"an analysis page\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.text()).to.include(\"تحليل نتائج\");",
            "});"
          ]
        }),
        req({
          name: "GET /api/pipeline/assignments — ما صدر لهذا الطالب",
          path: "/api/pipeline/assignments",
          query: [{ key: "student_id", value: "{{studentId}}" }],
          description: "كل ما صدر لطالب، الأحدث أولًا: الحالة، وقت الفتح، وقت التسليم، وروابط النتيجة.",
          tests: [
            "pm.test(\"200\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "console.log(b.count, \"assignments\");",
            "b.assignments.slice(0, 5).forEach(a =>",
            "  console.log(a.assignment_id, a.status, a.type, a.submitted_at || \"—\"));"
          ]
        }),
        req({
          name: "DELETE /api/pipeline/assignment/:id — إلغاء رابط",
          method: "DELETE",
          path: "/api/pipeline/assignment/{{assignmentId}}",
          query: [{ key: "reason", value: "issued to the wrong student" }],
          description: [
            "يُبطل رابطًا لم يُسلَّم بعد — أُرسل لطالب خطأ، أو أُلغي الاختبار.",
            "",
            "الرابط المُسلَّم أصلًا يبقى مُسلَّمًا: نتيجته محفوظة ولا يُمسّ."
          ].join("\n"),
          tests: [
            "pm.test(\"200\", () => pm.response.to.have.status(200));",
            "console.log(pm.response.json().note);"
          ]
        })
      ]
    },

    /* ---------------------------------------------------------------- 7. group */
    {
      name: "7 · المجموعة ولوحة التحليل — Group & dashboard",
      description: [
        "`group_id` واحد يجمع أوراق صف كامل. أضِفه عند الإصدار، فتقرأ كل نقاط النهاية",
        "هنا كل ما صدر تحته: من سلّم، متوسط المجموعة، الأهداف التي تحتاج إعادة شرح،",
        "الأسئلة التي سقطت، ثم ملخص كل طالب ومعه رابط إجاباته الكاملة.",
        "",
        "**المعرّف حرّ**: رقم درس، رمز صف، جلسة اختبار، فصل دراسي — لا شيء يسجّله مسبقًا،",
        "والمجموعة تُكتشف من الأوراق التي تحمله.",
        "",
        "**ليس جزءًا من مفتاح التخزين المؤقت**: لا يغيّر شيئًا على الصفحة المطبوعة،",
        "فصفّان يحلّان الدرس نفسه يتشاركان النسخة المبنيّة نفسها.",
        "",
        "لا تُخزَّن اللوحة مؤقتًا: الأرقام تتغيّر مع كل تسليم، ولوحة متأخّرة بتسليمٍ واحد",
        "لوحة يتوقّف المعلم عن تصديقها."
      ].join("\n"),
      item: [
        req({
          name: "POST /api/pipeline/assign — إصدار صف كامل بمجموعة واحدة",
          method: "POST",
          path: "/api/pipeline/assign",
          body: {
            type: "worksheet",
            document_idx: "{{documentIdx}}",
            seed: "{{seed}}",
            group_id: "{{groupId}}",
            group_name: "{{groupName}}",
            students: [
              { id: "STU-1042", name: "أحمد بن سالم", classroom: "الخامس/ب" },
              { id: "STU-1043", name: "سارة الحارثي", classroom: "الخامس/ب" },
              { id: "STU-1044", name: "خالد العامري", classroom: "الخامس/ب" }
            ]
          },
          description: [
            "مصفوفة `students` تصدر رابطًا لكل طالب، كلها تحت `group_id` واحد.",
            "",
            "صفٌّ فيه سطر لا يسمّي أحدًا **يُبلَّغ عنه ولا يُفشل الطلب**: كشف منسوخ من جدول",
            "فيه أسطر فارغة، وإسقاط تسعة وثلاثين رابطًا بسبب الأربعين خيارٌ خاطئ.",
            "انظر `skipped` في الرد.",
            "",
            "200 طالبًا كحدٍّ أقصى للنداء الواحد؛ الصف الأكبر عدة نداءات بالمعرّف نفسه —",
            "تقع كلها في المجموعة نفسها. البناء يجري ورقةً بعد ورقة لا دفعةً واحدة.",
            "",
            "الإصدار فرديًا يعطي النتيجة نفسها: نادِ `/assign` ثلاثين مرة بالمعرّف نفسه."
          ].join("\n"),
          tests: [
            "pm.test(\"201 issued\", () => pm.response.to.have.status(201));",
            "const b = pm.response.json();",
            "pm.test(\"one link per student, all in one group\", () => {",
            "  pm.expect(b.issued).to.be.above(0);",
            "  pm.expect(b.assignments[0].group_id).to.eql(b.group.id);",
            "  pm.expect(b.dashboard_url).to.include(\"/dashboard\");",
            "});",
            "pm.collectionVariables.set(\"groupId\", b.group.id);",
            "b.assignments.forEach(a => console.log(a.student.name, \"→\", a.answer_url));",
            "if (b.skipped) console.log(\"skipped:\", JSON.stringify(b.skipped));",
            "console.log(\"dashboard:\", b.dashboard_url);"
          ]
        }),
        req({
          name: "POST /api/pipeline/batch — كشف طلاب ← قائمة روابط اختبار",
          method: "POST",
          path: "/api/pipeline/batch",
          body: {
            type: "worksheet",
            document_idx: "{{documentIdx}}",
            seed: "{{seed}}",
            exam_date: "{{examDate}}",
            school: "{{schoolName}}",
            teacher: "{{teacherName}}",
            group_id: "{{groupId}}",
            group_name: "{{groupName}}",
            unique_seed: true,
            students: [
              "STU-1042",
              { id: "STU-1043", name: "سارة الحارثي", classroom: "الخامس/ب" },
              { id: "STU-1044", name: "خالد العامري", classroom: "الخامس/ب", exam_date: "2026-09-22", seed: 12 }
            ]
          },
          description: [
            "`‎/assign` يصدر رابطًا **واحدًا** ثم نمت فيه مصفوفة `students` تسهيلًا.",
            "`‎/batch` معكوسه: الكشف هو المقصود، فهو مطلوب، ولا حاجة إلى طالب في أعلى الطلب،",
            "والرد **يبدأ بمصفوفة `links` مسطّحة** — سطر لكل طالب، فيه رابط الاختبار مباشرة.",
            "هذا هو الشكل الذي يُدمج في رسالة أو يُكتب في نظام آخر بلا تنقيب.",
            "",
            "**سطر الكشف** إمّا رقم طالب مجرّد أو كائن. الكائن يسمّي الطالب",
            "(`id` و `name` و `classroom` و `section`) وقد يعيد توجيه الطلب **لهذا الطالب وحده**:",
            "`seed` (سحبة خاصة به) و `exam_date` (موعد بديل) و `document_idx` و `type`.",
            "",
            "**`unique_seed`** يعطي كل طالب سحبته الخاصة من الدرس نفسه — لا ورقتان في القاعة",
            "بالأسئلة نفسها. البذرة مشتقّة من `seed` النداء وهوية الطالب لا من عشوائيّة، فالنداء",
            "**قابل للإعادة**: تكراره يعيد لكل طالب الورقة التي بيده لا ورقة جديدة.",
            "",
            "**النجاح الجزئي نجاح**: سطر لا يسمّي أحدًا يُبلَّغ عنه في `skipped` وتعود بقيّة",
            "الروابط. `ok: false` فقط حين لا يمكن إصدار أي رابط (422).",
            "",
            "**الأرقام وحدها** تمرّ عبر الاستعلام: `?students=STU-1042,STU-1043`.",
            "",
            "200 طالبًا كحدٍّ أقصى للنداء الواحد (`EDU_PIPELINE_ROSTER_LIMIT`)."
          ].join("\n"),
          tests: [
            "pm.test(\"201 issued\", () => pm.response.to.have.status(201));",
            "const b = pm.response.json();",
            "pm.test(\"a flat link per student\", () => {",
            "  pm.expect(b.issued).to.be.above(0);",
            "  pm.expect(b.links).to.be.an(\"array\").with.lengthOf(b.issued);",
            "  pm.expect(b.links[0]).to.have.property(\"exam_url\");",
            "  pm.expect(b.links[0]).to.have.property(\"student_id\");",
            "});",
            "pm.test(\"every sheet carries the exam date\", () => {",
            "  pm.expect(b.exam_date).to.be.a(\"string\").and.not.empty;",
            "});",
            "pm.test(\"unique_seed gave each student their own draw\", () => {",
            "  const seeds = new Set(b.links.map(l => l.seed));",
            "  pm.expect(seeds.size).to.eql(b.links.length);",
            "});",
            "pm.collectionVariables.set(\"groupId\", b.group.id);",
            "b.links.forEach(l => console.log(l.student_id, l.student_name, \"→\", l.exam_url));",
            "if (b.skipped) console.log(\"skipped:\", JSON.stringify(b.skipped));",
            "console.log(\"dashboard:\", b.dashboard_url);"
          ]
        }),
        req({
          name: "GET /api/pipeline/groups — المجموعات الموجودة",
          path: "/api/pipeline/groups",
          description: [
            "المجموعات التي صدرت أوراق تحتها، الأحدث نشاطًا أولًا: عدد الطلاب،",
            "كم سلّم، نسبة التسليم، والدروس التي تغطّيها المجموعة.",
            "",
            "`?document_idx=` و `?status=` يضيّقان القائمة."
          ].join("\n"),
          tests: [
            "pm.test(\"200\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "console.log(b.count, \"groups\");",
            "b.groups.slice(0, 5).forEach(g =>",
            "  console.log(g.group_id, \"|\", g.submitted + \"/\" + g.issued, \"سلّموا |\", g.group_name));"
          ]
        }),
        req({
          name: "GET /api/pipeline/group/:id — التحليل الكامل JSON",
          path: "/api/pipeline/group/{{groupId}}",
          description: [
            "تحليل المجموعة كاملًا: `participation` قبل أي متوسط، ثم `overall`،",
            "ثم `goals` من الأضعف إلى الأقوى، ثم `questions` من الأصعب، ثم `students`.",
            "",
            "**الطلاب الذين لم يسلّموا يبقون في الصورة** بـ `percentage: null` —",
            "لوحة تُسقط من لم يسلّم وتحسب متوسط الباقين أسوأ من لا لوحة.",
            "",
            "**كل رقم يحتفظ بطريق العودة**: كل صف طالب يحمل `report_url` و `result_url`،",
            "و `goals[].students_needing_work` يسمّي من هم دون 60% عند الهدف نفسه."
          ].join("\n"),
          tests: [
            "pm.test(\"200 with the group roll-up\", () => {",
            "  pm.response.to.have.status(200);",
            "  const b = pm.response.json();",
            "  pm.expect(b.schema).to.eql(\"pipeline.group-analysis/1\");",
            "  pm.expect(b).to.have.property(\"participation\");",
            "  pm.expect(b).to.have.property(\"students\");",
            "});",
            "const b = pm.response.json();",
            "console.log(b.report.headline);",
            "console.log(\"سلّم\", b.participation.submitted + \"/\" + b.participation.issued,",
            "  \"| متوسط\", b.overall.average_percentage + \"%\", \"|\", b.overall.mastery_label);",
            "b.goals.forEach(g => console.log(\" هدف\", g.goal_id, String(g.average_percentage) + \"%\",",
            "  \"دون 60%:\", g.struggling, \"|\", g.goal_text));",
            "b.questions.slice(0, 3).forEach(q => console.log(\" أصعب:\", q.success_rate + \"%\", q.question));",
            "b.students.forEach(s => console.log(\" \", s.student_name || s.student_id,",
            "  s.answered ? s.percentage + \"% \" + s.mastery_label : \"لم يسلّم\", \"→\", s.report_url));",
            "b.report.next_steps.forEach(t => console.log(\" ⇦\", t));"
          ]
        }),
        req({
          name: "GET /api/pipeline/group/:id/dashboard — اللوحة كصفحة",
          path: "/api/pipeline/group/{{groupId}}/dashboard",
          description: [
            "التحليل نفسه كصفحة HTML قائمة بذاتها وصالحة للطباعة، مرتّبة بترتيب أسئلة",
            "المعلم: هل سلّموا أصلًا ← كيف كان أداء الصف ← ما الذي لم يفهمه الصف ←",
            "أي الأسئلة سقطت ← من يحتاجني، وأين ورقته.",
            "",
            "القسم الأخير هو المقصود: جدول بكل طالب، وكل صف يقود إلى تقريره الكامل",
            "وإجاباته. لا شيء في الصفحة طريق مسدود.",
            "",
            "افتحها بـ **Send** ثم `Preview` في بوستمان، أو انسخ الرابط إلى المتصفح."
          ].join("\n"),
          tests: [
            "pm.test(\"a dashboard page\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.headers.get(\"Content-Type\")).to.include(\"text/html\");",
            "  pm.expect(pm.response.text()).to.include(\"لوحة تحليل المجموعة\");",
            "  pm.expect(pm.response.text()).to.include(\"ملخص الطلاب\");",
            "});"
          ]
        }),
        req({
          name: "GET /api/pipeline/group/:id/answers — كل إجابات المجموعة",
          path: "/api/pipeline/group/{{groupId}}/answers",
          description: [
            "كل ما أرسله كل طالب في المجموعة: `answers` كما وصلت حرفيًا",
            "(`{question_id: answer}`) ثم قراءتها المصحَّحة سؤالًا بسؤال بجانبها.",
            "",
            "منفصلة عن التحليل عمدًا: اللوحة هي ما **تعنيه** إجابات الصف، وهذه هي ما",
            "**قاله** الصف — ومن يصدّر الإجابات إلى نظامه لا ينبغي أن ينزّل التحليل معها.",
            "",
            "`pending` جزء من العقد: «كل الإجابات» لا تكون صادقة ما لم تقل إجابات مَن",
            "الناقصة. `?student_id=` يقصرها على طالب واحد."
          ].join("\n"),
          tests: [
            "pm.test(\"200 with raw + graded answers\", () => {",
            "  pm.response.to.have.status(200);",
            "  const b = pm.response.json();",
            "  pm.expect(b.schema).to.eql(\"pipeline.group-answers/1\");",
            "  pm.expect(b).to.have.property(\"submissions\");",
            "  pm.expect(b).to.have.property(\"pending\");",
            "});",
            "const b = pm.response.json();",
            "console.log(b.submitted, \"سلّموا ·\", b.pending.length, \"لم يسلّموا\");",
            "b.submissions.forEach(s => {",
            "  console.log(\"—\", s.student.name, s.overall.percentage + \"%\");",
            "  console.log(\"  raw:\", JSON.stringify(s.answers));",
            "  s.questions.filter(q => !q.correct).forEach(q =>",
            "    console.log(\"   ✗\", q.question, \"| أجاب:\", q.student_answer || \"—\", \"| الصواب:\", q.correct_answer));",
            "});",
            "b.pending.forEach(p => console.log(\"⏳\", p.student && p.student.name, p.answer_url));"
          ]
        }),
        req({
          name: "GET /api/pipeline/assignments?group_id — سجلات المجموعة الخام",
          path: "/api/pipeline/assignments",
          query: [{ key: "group_id", value: "{{groupId}}" }],
          description: "الأوراق نفسها لا تحليلها: الحالة، وقت الفتح، وقت التسليم، والروابط. يقبل `status=` و `document_idx=` أيضًا.",
          tests: [
            "pm.test(\"200\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "console.log(b.count, \"assignments in this group\");",
            "b.assignments.forEach(a => console.log(a.status.padEnd(10), a.student && a.student.name, a.assignment_id));"
          ]
        }),
        req({
          name: "DELETE /api/pipeline/group/:id — إغلاق المجموعة",
          method: "DELETE",
          path: "/api/pipeline/group/{{groupId}}",
          query: [{ key: "reason", value: "انتهى وقت الاختبار" }],
          description: [
            "يُبطل كل رابط لم يُسلَّم بعد، ولا يمسّ ورقة سُلِّمت.",
            "",
            "«انتهى الاختبار» يجب ألّا تمتدّ إلى عمل سلّمه طالب: نتائج المسلَّمين تبقى",
            "مقروءة واللوحة تظل تعرضها، وتنتقل الأوراق المُبطلة من `pending` إلى `revoked`.",
            "",
            "**آخر طلب في المجلّد**: تشغيله يبطل الروابط التي أصدرها الطلب الأول."
          ].join("\n"),
          tests: [
            "pm.test(\"200\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "console.log(\"revoked:\", b.revoked, \"| kept (submitted):\", b.kept);"
          ]
        })
      ]
    },

    /* -------------------------------------------------------------- 8. security */
    {
      name: "8 · الأمان — Security",
      description: [
        "ضابطان مستقلّان: `EDU_API_KEY` لمن يبني، و `EDU_PIPELINE_PAGE_SECRET` لمن يقرأ الصفحة.",
        "",
        "الطلبان أدناه يوضّحان الرفض. نتيجتهما تتبع إعداد الخادم:",
        "401 عندما يكون الضابط مفعّلًا، ونجاح عندما لا يكون."
      ].join("\n"),
      item: [
        req({
          name: "POST /api/pipeline/document — بلا مفتاح (يُتوقّع 401)",
          method: "POST",
          path: "/api/pipeline/document",
          auth: NOAUTH,
          body: BODY({ type: "cards" }),
          description: "بلا ترويسة `X-Api-Key`. يرفض الخادم كل `/api/*` بـ 401 حين يكون `EDU_API_KEY` مضبوطًا.",
          tests: [
            "pm.test(\"blocked when a key is configured\", () => {",
            "  pm.expect([401, 201, 200]).to.include(pm.response.code);",
            "  if (pm.response.code === 401) pm.expect(pm.response.json().error.code).to.eql(\"unauthorized\");",
            "  else console.log(\"note: server has no EDU_API_KEY set — the build succeeded.\");",
            "});"
          ]
        }),
        req({
          name: "GET /t/{{docKey}} — بلا توقيع (يُتوقّع 401)",
          path: "/t/{{docKey}}",
          auth: NOAUTH,
          description: [
            "الرابط بلا التوقيع `?t=…`. مفتاح الصفحة مشتقّ من `document_idx` ويمكن تخمينه،",
            "لذا تُرفض الصفحة غير الموقّعة بـ 401 حين يكون `EDU_PIPELINE_PAGE_SECRET` مضبوطًا.",
            "",
            "قارنها بطلب \"الصفحة الموقّعة\" في المجلّد 3 الذي يمرّ."
          ].join("\n"),
          tests: [
            "pm.test(\"unsigned link refused when signing is on\", () => {",
            "  pm.expect([401, 200]).to.include(pm.response.code);",
            "  if (pm.response.code === 401) pm.expect(pm.response.json().error.code).to.be.oneOf([\"invalid-link\", \"unauthorized\"]);",
            "  else console.log(\"note: server has no EDU_PIPELINE_PAGE_SECRET set — pages are open.\");",
            "});"
          ]
        })
      ]
    },
    {
      name: "9 · المخزن — The store",
      description: [
        "قاعدتان على خادم MongoDB واحد:",
        "",
        "- **قاعدة المولّد** (`ai`) — الأسئلة وأوراق العمل والملخّصات. **قراءة فقط**، لا يكتب فيها شيء.",
        "- **قاعدة المنصّة** (`activities`) — كل مستند وُلّد ومفتاح إجابته، وكل رابط صدر وحالته،",
        "  وكل إجابة وتحليل عاد. **قراءة وكتابة**.",
        "",
        "الفصل بينهما هو ما يسمح لمستخدم واحد في MongoDB أن يملك `read` على الأولى",
        "و `readWrite` على الثانية، فلا يستطيع خطأ في هذا الكود أن يفسد مخرجات المولّد.",
        "",
        "**لا يُحفظ هنا أي سجل للمدارس أو المعلمين أو الفصول أو الطلاب.** هذه تخصّ المنصّة",
        "التي تنادي هذه الخدمة: تصل كمعاملات في الطلب، وتُحفظ كلقطة (snapshot) على ما نُصدره —",
        "فورقةٌ صدرت الفصل الماضي تحتفظ بالاسم الذي طُبع عليها مهما تغيّر السجل بعد ذلك.",
        "",
        "Two databases on one MongoDB server; nothing here is the authority on who anyone is.",
        "Collections, indexes and the Mongo user this needs: `docs/DATABASE.md`."
      ].join("\n"),
      item: [
        req({
          name: "GET /api/pipeline/store — ما بداخل المخزن",
          path: "/api/pipeline/store",
          description: [
            "عدد المستندات في كل مجموعة، ومعه فحص صلاحيات حيّ: هل يستطيع هذا الاتصال",
            "أن يقرأ، وأن **يكتب**؟",
            "",
            "المستخدم الذي يملك `read` بدل `readWrite` يتصل بنجاح ويقدّم الصفحات،",
            "ثم يرفض كل تسليم. لذلك يُجرَّب هنا كتابةٌ حقيقية بدل الاكتفاء بالاتصال."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "pm.test(\"the store is reachable\", () => pm.expect(b.ok).to.eql(true));",
            "pm.test(\"and writable — not read-only by mistake\", () => {",
            "  pm.expect(b.access.canRead, \"can read\").to.eql(true);",
            "  pm.expect(b.access.canWrite, \"can write — see docs/DATABASE.md for the role to grant\").to.eql(true);",
            "});",
            "console.log(b.database, \"|\", b.documents, \"documents |\", JSON.stringify(b.collections));"
          ]
        }),
        req({
          name: "GET /api/pipeline/documents — ما وُلّد حتى الآن",
          path: "/api/pipeline/documents",
          query: [{ key: "document_idx", value: "{{documentIdx}}" }],
          description: [
            "سجلّ كل مستند بُني: نوعه وبذرته وعدد أسئلته وكم مرّة قُدّم.",
            "",
            "يبقى بعد خروج الصفحة من التخزين المؤقت — فالسؤال «أي اختبار أعطينا الصف",
            "في أكتوبر» يجب أن ينجو من كنس الكاش."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const rows = pm.response.json().documents;",
            "pm.test(\"the list carries no answer key\", () => {",
            "  rows.forEach(r => pm.expect(r.questions, \"questions must not be in a list response\").to.be.undefined);",
            "});",
            "console.log(rows.map(r => r.type + \" · \" + r.id + \" · served \" + r.serve_count + \"×\").join(\"\\n\"));"
          ]
        }),
        req({
          name: "GET /api/pipeline/documents/:key/questions — الاختبار كما طُبع",
          path: "/api/pipeline/documents/{{docKey}}/questions",
          description: [
            "الأسئلة التي سُحبت فعلًا لهذه الصفحة، بترتيبها ومفتاح إجابتها.",
            "",
            "يبقى صحيحًا حتى لو أُعيد توليد الدرس أو عُدّل بعدها — فهذه هي الورقة",
            "التي أمسكها الطالب."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "pm.test(\"the questions were recorded with their key\", () => {",
            "  pm.expect(b.questions).to.be.an(\"array\").that.is.not.empty;",
            "  pm.expect(b.questions[0]).to.have.property(\"question_id\");",
            "});",
            "console.log(b.questions.length, \"questions ·\", b.document.type, \"· seed\", b.document.seed);"
          ]
        }),
        req({
          name: "GET /api/pipeline/links — لوحة الروابط",
          path: "/api/pipeline/links",
          query: [{ key: "group_id", value: "{{groupId}}" }],
          description: [
            "كل رابط صدر وحالته: أُصدر، فُتح، سُلّم، أُلغي، أو انتهت صلاحيته —",
            "مع درجة الطالب حين يكون قد سلّم.",
            "",
            "بلا مفتاح إجابة وبلا رمز الرابط: هذه لوحة يقرأها إنسان، لا نسخة من السجل."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const rows = pm.response.json().links;",
            "pm.test(\"neither the token nor the key leaks into the board\", () => {",
            "  rows.forEach(r => {",
            "    pm.expect(r.token, \"token\").to.be.undefined;",
            "    pm.expect(r.answer_key, \"answer_key\").to.be.undefined;",
            "  });",
            "});",
            "console.log(rows.map(r => (r.student_name || r.student_id) + \" · \" + r.effective_status +",
            "  (r.percentage == null ? \"\" : \" · \" + r.percentage + \"%\")).join(\"\\n\"));"
          ]
        }),
        req({
          name: "GET /api/pipeline/students/:id/results — سجلّ الطالب",
          path: "/api/pipeline/students/{{studentId}}/results",
          description: [
            "كل ورقة جلس لها هذا الطالب: الدرجة والإتقان وتاريخ التسليم.",
            "",
            "المعرّف هنا هو معرّف **منصّة الشريك** — لا يوجد سجل طلاب في هذه القاعدة،",
            "وإنما نتائج مُودعة تحت المعرّف الذي أرسلته المنصّة عند الإصدار."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "if (!b.results.length) console.log(\"note:\", b.note || \"no results under this id yet\");",
            "else console.log(b.results.map(r => r.lesson_title + \" · \" + r.overall.percentage + \"%\").join(\"\\n\"));"
          ]
        }),
        req({
          name: "GET /api/pipeline/analytics/questions — أصعب الأسئلة",
          path: "/api/pipeline/analytics/questions",
          query: [{ key: "document_idx", value: "{{documentIdx}}" }],
          description: [
            "تحليل المفردات: أي سؤال أخطأ فيه الطلاب، عبر كل التسليمات لا ورقة واحدة.",
            "الأصعب أولًا."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const rows = pm.response.json().questions;",
            "console.log(rows.slice(0, 10).map(r => r.question_id + \" · \" + r.correct_pct + \"% · \" +",
            "  r.correct + \"/\" + r.answered_by).join(\"\\n\"));"
          ]
        }),
        req({
          name: "GET /api/pipeline/analytics/goals — ما يحتاج إعادة تدريس",
          path: "/api/pipeline/analytics/goals",
          query: [{ key: "group_id", value: "{{groupId}}" }],
          description: [
            "متوسط إتقان كل هدف في المجموعة، وعدد الطلاب المتعثّرين فيه — الأضعف أولًا.",
            "",
            "هذا هو الصف الذي يتصرّف المعلم بناءً عليه."
          ].join("\n"),
          tests: [
            "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
            "const rows = pm.response.json().goals;",
            "console.log(rows.map(r => r.avg_percentage + \"% · \" + r.struggling + \" struggling · \" +",
            "  r.goal_text).join(\"\\n\"));"
          ]
        }),
        req({
          name: "GET /api/pipeline/schools — (يُتوقّع 404) لا سجل للمدارس هنا",
          path: "/api/pipeline/schools",
          description: [
            "متعمَّد. المدارس والمعلمون والفصول والطلاب ليست ملكًا لهذه الخدمة:",
            "تصل كمعاملات في الطلب وتُحفظ كلقطة على ما نُصدره.",
            "",
            "لو كان هنا سجلّ طلاب لوجب مزامنته، ولكان اسم الطالب على ورقةٍ قديمة",
            "يتغيّر كلما تغيّر السجل — وهو ما لا يجوز أن يحدث."
          ].join("\n"),
          tests: [
            "pm.test(\"404 — the roster is not this service's to keep\", () => {",
            "  pm.response.to.have.status(404);",
            "});"
          ]
        })
      ]
    }
  ]
};

const environment = {
  id: "a1c7e3d9-2f64-4b80-9e15-7d3a6c0b8e42",
  name: "Pipeline — Local",
  values: [
    { key: "baseUrl", value: "http://localhost:8138", type: "default", enabled: true },
    { key: "apiKey", value: "", type: "secret", enabled: true },
    { key: "documentIdx", value: "43617", type: "default", enabled: true },
    { key: "seed", value: "7", type: "default", enabled: true },
    { key: "color", value: "teal", type: "default", enabled: true },
    { key: "docKey", value: "", type: "default", enabled: true },
    { key: "pageUrl", value: "", type: "default", enabled: true },
    { key: "studentId", value: "STU-1042", type: "default", enabled: true },
    { key: "studentName", value: "أحمد بن سالم", type: "default", enabled: true },
    { key: "assignmentId", value: "", type: "default", enabled: true },
    { key: "assignmentToken", value: "", type: "secret", enabled: true },
    { key: "answerUrl", value: "", type: "default", enabled: true },
    { key: "questionIds", value: "", type: "default", enabled: true },
    { key: "groupId", value: "lesson-43617-oct", type: "default", enabled: true },
    { key: "groupName", value: "الخامس/ب — أنواع الجملة", type: "default", enabled: true }
  ],
  _postman_variable_scope: "environment"
};

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "Pipeline.postman_collection.json"), json(collection) + "\n", "utf8");
await writeFile(path.join(OUT, "Pipeline.postman_environment.json"), json(environment) + "\n", "utf8");

const count = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`wrote docs/postman/ — ${collection.item.length} folders, ${count} requests`);
