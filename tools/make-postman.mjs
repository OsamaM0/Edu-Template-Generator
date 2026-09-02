/* ============================================================================
   make-postman.mjs — regenerate the Postman collection from the real lessons
   ----------------------------------------------------------------------------
   Every request body in the collection is an actual file from data/lessons/,
   so the examples cannot drift away from what the engine renders.

     node tools/make-postman.mjs

   Writes docs/postman/EduWebTemplateGenerator.postman_collection.json
      and docs/postman/EduWebTemplateGenerator.postman_environment.json
   ========================================================================== */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT  = path.join(ROOT, "docs", "postman");

const lesson = async id => JSON.parse(await readFile(path.join(ROOT, "data", "lessons", `${id}.json`), "utf8"));

const WORKSHEET = await lesson("science-g2-living-creatures-needs");
const CARDS     = await lesson("arabic-g5-sentence-types-cards");
const ANSWERS   = await lesson("digital-g7-cyber-safety-answers");
const PLAN      = await lesson("math-g7-linear-equations-diff");
const SURVEY    = await lesson("learning-pattern-survey");
const GOLDEN    = await lesson("golden-minutes-card");

/* A deliberately tiny sheet — small enough to travel in a URL. */
const TINY = {
  meta: { template: "worksheet", age: "kid", color: "green", badge: "ورقة عمل", title: "جمع الأعداد" },
  sections: [
    { type: "note", title: "تدرب", color: "green", text: "اجمع الأعداد التالية: 3 + 4 = ___" }
  ]
};

/* --- builders --------------------------------------------------------------- */

const json = v => JSON.stringify(v, null, 2);

const raw = body => ({
  mode: "raw",
  raw: json(body),
  options: { raw: { language: "json" } }
});

const url = (pathStr, query) => {
  const u = {
    raw: `{{baseUrl}}${pathStr}${query && query.length ? "?" + query.map(q => `${q.key}=${q.value}`).join("&") : ""}`,
    host: ["{{baseUrl}}"],
    path: pathStr.replace(/^\//, "").split("/")
  };
  if (query && query.length) u.query = query;
  return u;
};

const HTML_TESTS = [
  "pm.test(\"200 OK\", () => pm.response.to.have.status(200));",
  "pm.test(\"an HTML page came back\", () => {",
  "  pm.expect(pm.response.headers.get(\"Content-Type\")).to.include(\"text/html\");",
  "  pm.expect(pm.response.text()).to.include(\"<div class=\\\"page\\\"\");",
  "});",
  "console.log(\"template:\", pm.response.headers.get(\"X-Edu-Template\"),",
  "            \"| theme:\", pm.response.headers.get(\"X-Edu-Theme\"));"
];

const test = lines => ({ listen: "test", script: { type: "text/javascript", exec: lines } });

function req({ name, method = "GET", path: p, query, body, description, tests, headers }) {
  const item = {
    name,
    request: {
      method,
      header: headers || (body ? [{ key: "Content-Type", value: "application/json" }] : []),
      url: url(p, query),
      description
    }
  };
  if (body) item.request.body = raw(body);
  if (tests) item.event = [test(tests)];
  return item;
}

/* --- the collection --------------------------------------------------------- */

const collection = {
  info: {
    _postman_id: "b7e1c0a2-4f3d-4e7a-9c21-ed0a1f6c5d10",
    name: "EduWebTemplateGenerator — Render API",
    description: [
      "أرسل بيانات ورقة العمل (JSON) واستقبل صفحة HTML جاهزة ومعبّأة بالبيانات.",
      "",
      "Send worksheet JSON, get back a finished HTML page filled with that data.",
      "",
      "**Start the server**: `npm start` → http://localhost:8138",
      "",
      "**Variables**: `baseUrl` (default `http://localhost:8138`), `apiKey` (only needed when the",
      "server runs with `EDU_API_KEY` set), `sheetId` (filled automatically by *Store a sheet*).",
      "",
      "Full documentation: `docs/API.md`."
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
    { key: "apiKey",  value: "", type: "string" },
    { key: "sheetId", value: "", type: "string" }
  ],

  item: [
    /* ---------------------------------------------------------------- 1. meta */
    {
      name: "1 · الحالة والقوالب — Health & templates",
      description: "فحص سريع للخادم ومعرفة القوالب المتاحة وما يقبله كل قالب.",
      item: [
        req({
          name: "GET /api/health",
          path: "/api/health",
          description: "هل الخادم يعمل؟ يعيد الإصدار وقائمة القوالب وعدد الصفحات المخزنة.",
          tests: [
            "pm.test(\"the server is up\", () => pm.response.to.have.status(200));",
            "pm.test(\"every template is registered\", () => {",
            "  pm.expect(pm.response.json().templates).to.include.members([",
            "    \"worksheet\", \"interactive-card\", \"interactive-card-answers\",",
            "    \"differentiated-lesson\", \"golden-minutes\", \"learning-pattern\"",
            "  ]);",
            "});"
          ]
        }),
        req({
          name: "GET /api/templates",
          path: "/api/templates",
          description: "القوالب الأربعة، وأسماؤها البديلة، والكتل (blocks) التي يقبلها كل قالب — نقطة البداية لأي مولّد محتوى آلي."
        })
      ]
    },

    /* ------------------------------------------------------------ 2. validate */
    {
      name: "2 · التحقق — Validate",
      description: "تحقق من صحة البنية قبل التصيير. مفيد داخل حلقة توليد آلي (AI) قبل عرض أي شيء.",
      item: [
        req({
          name: "POST /api/validate — بيانات صحيحة",
          method: "POST",
          path: "/api/validate",
          body: PLAN,
          description: "يعيد 200 مع القالب المكتشَف وأي ملاحظات (warnings) لا تمنع التصيير.",
          tests: [
            "pm.test(\"valid\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json().valid).to.be.true;",
            "  pm.expect(pm.response.json().template).to.eql(\"differentiated-lesson\");",
            "});"
          ]
        }),
        req({
          name: "POST /api/validate — بيانات ناقصة (422)",
          method: "POST",
          path: "/api/validate",
          body: { meta: { template: "interactive-card", title: "بطاقات بلا محتوى" } },
          description: "قالب البطاقات بلا مصفوفة cards ⇒ 422 مع رسالة الخطأ. الأخطاء تمنع التصيير، والملاحظات لا تمنعه.",
          tests: [
            "pm.test(\"rejected with a reason\", () => {",
            "  pm.response.to.have.status(422);",
            "  pm.expect(pm.response.json().errors[0]).to.include(\"cards\");",
            "});"
          ]
        })
      ]
    },

    /* -------------------------------------------------------------- 3. render */
    {
      name: "3 · التصيير — Render a page",
      description: [
        "الطلب الأساسي: ترسل JSON وتستقبل صفحة HTML كاملة ومعبّأة.",
        "",
        "الاستجابة `text/html`، مع ترويستين تخبرانك بما تم تصييره:",
        "`X-Edu-Template` و `X-Edu-Theme`.",
        "",
        "في Postman استخدم تبويب **Preview** لرؤية الصفحة كما تظهر في المتصفح."
      ].join("\n"),
      item: [
        req({
          name: "POST /api/render — ورقة عمل (worksheet)",
          method: "POST",
          path: "/api/render",
          body: WORKSHEET,
          description: "ورقة عمل الطالب كاملة. الجسم هنا هو كائن ورقة العمل مباشرة، بلا أي غلاف.",
          tests: HTML_TESTS.concat([
            "pm.test(\"rendered as a worksheet\", () => {",
            "  pm.expect(pm.response.headers.get(\"X-Edu-Template\")).to.eql(\"worksheet\");",
            "});"
          ])
        }),
        req({
          name: "POST /api/render?theme=pro — نفس البيانات بالنمط الاحترافي",
          method: "POST",
          path: "/api/render",
          query: [{ key: "theme", value: "pro", description: "pro | kid — يتجاوز ما في meta.age" }],
          body: WORKSHEET,
          description: [
            "نفس بيانات الطلب السابق تمامًا، بمظهر مختلف.",
            "",
            "هذا الدرس مكتوب بـ `meta.age: \"kid\"`، و`?theme=pro` يتجاوزه:",
            "لون واحد، بلا إيموجي، وخطوط أهدأ — للمرحلة المتوسطة والثانوية."
          ].join("\n"),
          tests: HTML_TESTS.concat([
            "pm.test(\"the URL overrode the JSON\", () => {",
            "  pm.expect(pm.response.headers.get(\"X-Edu-Theme\")).to.eql(\"pro\");",
            "});"
          ])
        }),
        req({
          name: "POST /api/render — خطة درس متمايزة (differentiated-lesson)",
          method: "POST",
          path: "/api/render",
          body: PLAN,
          description: "خطة درس وفق التعليم المتمايز: الأهداف والاستراتيجيات والوسائل والواجب، ثم المجموعات والأنشطة والتقويم المتمايز.",
          tests: HTML_TESTS
        }),
        req({
          name: "POST /api/render — بطاقات أسئلة (interactive-card)",
          method: "POST",
          path: "/api/render",
          body: CARDS,
          description: "بطاقات مراجعة قابلة للقص، مع خطوط القص والمقص.",
          tests: HTML_TESTS
        }),
        req({
          name: "POST /api/render — بطاقات الإجابات (interactive-card-answers)",
          method: "POST",
          path: "/api/render",
          body: ANSWERS,
          description: "بطاقات الإجابات النموذجية المقابلة لبطاقات الأسئلة.",
          tests: HTML_TESTS
        }),
        req({
          name: "POST /api/render — بطاقة الدقائق الذهبية (golden-minutes)",
          method: "POST",
          path: "/api/render",
          body: GOLDEN,
          description: "بطاقة الحصة للمعلّم: بيانات الحصة، أول خمس دقائق وآخر خمس دقائق، مؤشر الجاهزية، وقرار المعلم بعد الحصة.",
          tests: HTML_TESTS.concat([
            "pm.test(\"rendered as a golden-minutes card\", () => {",
            "  pm.expect(pm.response.headers.get(\"X-Edu-Template\")).to.eql(\"golden-minutes\");",
            "});"
          ])
        }),
        req({
          name: "POST /api/render — استبيان أنماط التعلم (learning-pattern)",
          method: "POST",
          path: "/api/render",
          body: SURVEY,
          description: "استبيان تحديد أنماط التعلم (بصري، سماعي، حركي، قراءة/كتابة). يصحّح نفسه: كل عبارة تغذّي نمطها، والنتيجة تُعاد قراءتها مع كل اختيار.",
          tests: HTML_TESTS.concat([
            "pm.test(\"rendered as a learning-pattern survey\", () => {",
            "  pm.expect(pm.response.headers.get(\"X-Edu-Template\")).to.eql(\"learning-pattern\");",
            "});"
          ])
        }),
        req({
          name: "POST /api/render — غلاف بخيارات (options + data)",
          method: "POST",
          path: "/api/render",
          body: {
            options: { theme: "kid", standalone: true, interactive: false, toolbar: false },
            data: PLAN
          },
          description: [
            "الشكل الثاني للجسم: `{ options, data }` — لتمرير الخيارات داخل الجسم بدل الرابط.",
            "",
            "`standalone: true` يُضمّن كل ملفات CSS داخل الصفحة، و`interactive: false` يحذف",
            "الجافاسكربت بالكامل ⇒ ملف واحد مستقل تمامًا، مناسب للأرشفة أو التحويل إلى PDF.",
            "",
            "(`data` يقبل أيضًا الأسماء: worksheet / lesson / sheet)"
          ].join("\n"),
          tests: HTML_TESTS.concat([
            "pm.test(\"self-contained: no script tags, CSS inlined\", () => {",
            "  pm.expect(pm.response.text()).to.not.include(\"<script\");",
            "  pm.expect(pm.response.text()).to.include(\"<style>\");",
            "});"
          ])
        }),
        req({
          name: "POST /api/render?embed=1 — للتضمين داخل iframe",
          method: "POST",
          path: "/api/render",
          query: [
            { key: "embed", value: "1", description: "يزيل إطار الصفحة الخارجي" },
            { key: "toolbar", value: "0", description: "إخفاء شريط الأدوات العائم" }
          ],
          body: CARDS,
          description: "نسخة نظيفة بلا زخرفة خارجية، تُوضع مباشرة داخل `<iframe>` في نظامك.",
          tests: HTML_TESTS
        }),
        req({
          name: "POST /api/render?download=… — تنزيل كملف",
          method: "POST",
          path: "/api/render",
          query: [{ key: "download", value: "lesson-plan", description: "اسم الملف (بدون امتداد)" }],
          body: PLAN,
          description: "يضيف ترويسة `Content-Disposition: attachment` فيحفظ المتصفح الملف بدل عرضه. الأسماء العربية مدعومة (RFC 5987).",
          tests: [
            "pm.test(\"served as a download\", () => {",
            "  pm.expect(pm.response.headers.get(\"Content-Disposition\")).to.include(\"attachment\");",
            "});"
          ]
        }),
        req({
          name: "GET /api/render?data=… — صفحة من رابط مباشر",
          path: "/api/render",
          query: [
            { key: "data", value: Buffer.from(JSON.stringify(TINY), "utf8").toString("base64url"), description: "ورقة العمل مُرمّزة base64url" },
            { key: "embed", value: "1" }
          ],
          description: [
            "نفس المُصيِّر خلف رابط عادي — للمعاينات و`<iframe src=…>`.",
            "",
            "الرابط محدود الطول في المتصفحات، فاستخدم POST لأي حجم حقيقي،",
            "أو خزّن الصفحة مرة واحدة عبر `POST /api/sheets` واربط `/s/:id`."
          ].join("\n"),
          tests: HTML_TESTS
        })
      ]
    },

    /* -------------------------------------------------------------- 4. sheets */
    {
      name: "4 · صفحات مخزّنة — Stored sheets",
      description: [
        "خزّن البيانات مرة واحدة واحصل على رابط يمكن فتحه أكثر من مرة:",
        "رابط في بريد، أو `<iframe>` في منصتك، أو متصفح آلي يلتقط صورة.",
        "",
        "التخزين في الذاكرة ومؤقّت (24 ساعة افتراضيًا، ويُمسح عند إعادة تشغيل الخادم).",
        "الدروس الدائمة مكانها `data/lessons/<id>.json`."
      ].join("\n"),
      item: [
        req({
          name: "POST /api/sheets — خزّن واحصل على رابط",
          method: "POST",
          path: "/api/sheets",
          body: PLAN,
          description: "يعيد 201 مع `id` وروابط جاهزة: الصفحة، التضمين، الصورة، وبيانات الـ JSON. يحفظ السكربت قيمة `sheetId` تلقائيًا لبقية الطلبات.",
          tests: [
            "pm.test(\"stored\", () => pm.response.to.have.status(201));",
            "const body = pm.response.json();",
            "pm.collectionVariables.set(\"sheetId\", body.id);",
            "console.log(\"page:\", body.url, \"\\nembed:\", body.embedUrl, \"\\nimage:\", body.imageUrl);"
          ]
        }),
        req({
          name: "GET /s/{{sheetId}} — الصفحة المخزّنة",
          path: "/s/{{sheetId}}",
          description: "الصفحة نفسها. كل خيارات التصيير تعمل هنا كمعاملات رابط: `?theme=kid` · `?embed=1` · `?print=1` · `?image=1`.",
          tests: HTML_TESTS
        }),
        req({
          name: "GET /s/{{sheetId}}?theme=kid&embed=1",
          path: "/s/{{sheetId}}",
          query: [{ key: "theme", value: "kid" }, { key: "embed", value: "1" }],
          description: "نفس الصفحة المخزّنة بمظهر ومقاس مختلفين — بلا إعادة إرسال البيانات.",
          tests: HTML_TESTS
        }),
        req({
          name: "GET /s/{{sheetId}}?image=1 — صفحة تحفظ نفسها كصورة",
          path: "/s/{{sheetId}}",
          query: [{ key: "image", value: "1" }, { key: "toolbar", value: "0" }],
          description: [
            "الصفحة تُنزّل نفسها صورة A4 بدقة عالية بمجرد اكتمال العرض.",
            "",
            "هذا هو الخطاف المخصص للمتصفح الآلي (Puppeteer / Playwright):",
            "انتظر `document.documentElement.dataset.eduImage === \"done\"`."
          ].join("\n"),
          tests: HTML_TESTS
        }),
        req({
          name: "GET /api/sheets/{{sheetId}} — استرجاع الـ JSON",
          path: "/api/sheets/{{sheetId}}",
          description: "البيانات كما أُرسلت.",
          tests: [
            "pm.test(\"the payload comes back\", () => {",
            "  pm.response.to.have.status(200);",
            "  pm.expect(pm.response.json()).to.have.property(\"meta\");",
            "});"
          ]
        }),
        req({
          name: "DELETE /api/sheets/{{sheetId}} — حذف مبكر",
          method: "DELETE",
          path: "/api/sheets/{{sheetId}}",
          description: "يحذف الصفحة المخزّنة قبل انتهاء صلاحيتها."
        })
      ]
    },

    /* ------------------------------------------------------- 5. static lessons */
    {
      name: "5 · الدروس الثابتة — Static lessons",
      description: "الدروس المحفوظة في `data/lessons/`. تعمل بلا خادم أيضًا عبر `index.html?lesson=<id>`.",
      item: [
        req({
          name: "GET /api/lessons/:id",
          path: "/api/lessons/science-g2-living-creatures-needs",
          description: "يقرأ `data/lessons/<id>.json`. مع ضبط `apiBase: \"/api\"` في config.js يصبح هذا مصدر الدروس للتطبيق في المتصفح.",
          tests: [
            "pm.test(\"lesson found\", () => pm.response.to.have.status(200));"
          ]
        }),
        req({
          name: "GET /index.html?lesson=:id — التطبيق نفسه",
          path: "/index.html",
          query: [{ key: "lesson", value: "math-g7-linear-equations-diff" }, { key: "theme", value: "pro" }],
          description: "الخادم يقدّم الموقع الثابت أيضًا، فلا حاجة لتشغيل خادم آخر أثناء التطوير."
        })
      ]
    }
  ]
};

const environment = {
  id: "3f2a6b18-9c4e-4a51-8d77-2b0c9e4a7f31",
  name: "EduWebTemplateGenerator — Local",
  values: [
    { key: "baseUrl", value: "http://localhost:8138", type: "default", enabled: true },
    { key: "apiKey",  value: "", type: "secret", enabled: true },
    { key: "sheetId", value: "", type: "default", enabled: true }
  ],
  _postman_variable_scope: "environment"
};

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "EduWebTemplateGenerator.postman_collection.json"), json(collection) + "\n", "utf8");
await writeFile(path.join(OUT, "EduWebTemplateGenerator.postman_environment.json"), json(environment) + "\n", "utf8");

const count = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`wrote docs/postman/ — ${collection.item.length} folders, ${count} requests`);
