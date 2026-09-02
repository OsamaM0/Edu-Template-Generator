# The render API

[← README](../README.md) · [Lifecycle](LIFECYCLE.md) · [Templates](TEMPLATES.md) · [JSON](JSON.md) · [Render API](API.md) · [Pipeline](PIPELINE.md) · [Database](DATABASE.md) · [Deploy](DEPLOY.md) · [Extending](EXTENDING.md)

Send worksheet JSON, get back a finished HTML page with that data already rendered into it.

The server is `server/server.mjs` — **Node ≥ 18, zero dependencies, no build step**. It also serves
the static site, so one process covers both the API and the browser app.

```bash
npm start                     # → http://localhost:8138
docker compose up             # the same thing, in a container
```

| Variable | Default | What it does |
|---|---|---|
| `PORT` / `EDU_PORT` | `8138` | listen port |
| `EDU_HOST` | `0.0.0.0` | bind address |
| `EDU_API_KEY` | *(empty)* | when set, every `/api/*` and `/s/*` request needs `X-Api-Key` |
| `EDU_CORS_ORIGIN` | `*` | value of `Access-Control-Allow-Origin` |
| `EDU_MAX_BODY` | `4000000` | request body ceiling in bytes |
| `EDU_SHEET_TTL_MIN` | `1440` | how long a stored sheet lives (minutes) |
| `EDU_MAX_SHEETS` | `500` | how many stored sheets are kept (oldest evicted) |

---

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `POST` | `/api/render` | **`text/html`** — the page, filled with your data |
| `GET` | `/api/render?data=<base64url>` | the same page, from a link or an `<iframe>` |
| `POST` | `/api/sheets` | `201` + `{ id, url, embedUrl, imageUrl, apiUrl, expiresAt }` |
| `GET` | `/s/:id` | the stored sheet as a page |
| `GET` | `/api/sheets/:id` | the stored JSON back |
| `DELETE` | `/api/sheets/:id` | drops it before it expires |
| `GET` | `/api/lessons/:id` | alias of the above; also reads `data/lessons/<id>.json` |
| `POST` | `/api/validate` | `{ valid, template, errors, warnings }` — no rendering |
| `GET` | `/api/templates` | the six templates and the blocks each accepts |
| `GET` | `/api/health` | `{ ok, version, templates, storedSheets, uptimeSeconds, authRequired }` |

There is also an extension on top of this API — **[the pipeline](PIPELINE.md)** — which takes a
`document_idx` instead of a payload, reads the lesson from MongoDB, and returns the URL of a
finished page it has cached: `POST /api/pipeline/document`, served at `/t/:key`. It lives entirely in
`server/pipeline/` and changes nothing here.

Errors are always JSON:

```json
{ "error": { "code": "invalid-worksheet", "message": "The payload cannot be rendered.", "detail": "…" } }
```

`400` bad JSON · `401` bad key · `404` unknown id · `405` wrong method · `413` body too large ·
`422` payload can't render · `500` unexpected.

---

## `POST /api/render`

The one you'll use. Two accepted body shapes:

**1. the worksheet object itself**

```http
POST /api/render HTTP/1.1
Content-Type: application/json

{ "meta": { "template": "worksheet", "title": "…" }, "sections": [ … ] }
```

**2. an envelope, when you want to pass options in the body**

```json
{
  "options": { "theme": "kid", "standalone": true, "interactive": false },
  "data":    { "meta": { … }, "sections": [ … ] }
}
```

`data` may also be spelled `worksheet`, `lesson`, or `sheet`.

The response is a complete `text/html` document — `Content-Type: text/html; charset=utf-8`, plus
`X-Edu-Template` and `X-Edu-Theme` headers telling you what it decided to render.

### Options

Every option works **in the body** (`options.*`) and **in the query string**; the query wins, so one
saved request can be re-aimed from the URL alone.

| Option | Query | Default | Effect |
|---|---|---|---|
| `theme` | `?theme=` / `?age=` | from the JSON | `pro` (formal) or `kid` (playful). Aliases: `professional`, `teen`, `adult` / `kids`, `child`, `playful`, `fun` |
| `standalone` | `?standalone=1` | `false` | inline every stylesheet + the favicon, so the file survives on its own (email it, archive it, feed it to a PDF converter) |
| `interactive` | `?interactive=0` | `true` | `false` ships **no JavaScript at all** — static markup only |
| `toolbar` | `?toolbar=0` | `true` | the floating 🎬 🖨️ 🖼️ 🎨 🔄 toolbar |
| `embed` | `?embed=1` | `false` | drops the outer page chrome for `<iframe>` use (also turns the toolbar off unless you ask for it) |
| `title` | `?title=` | from the JSON | overrides `<title>` |
| `download` | `?download=`*name* | *(off)* | adds `Content-Disposition: attachment`, so the browser saves the file instead of showing it |
| `autoImage` | `?image=1` | `false` | once painted, the page downloads itself as an A4 JPG — the hook for headless pipelines |
| `autoPrint` | `?print=1` | `false` | once painted, opens the print dialog |

> **`standalone: true` + `interactive: false`** is the combination for archiving or PDF conversion:
> one self-contained HTML file, no server, no scripts, and it still prints on one A4 page.
> Keep `interactive: true` when a human will fill the sheet in — drawing canvases, matching lines
> and answer fields all need the app.

**Asset URLs.** A rendered page can end up anywhere — `/s/<id>`, a download, another host — so every
relative asset reference (stylesheets, scripts, the school logo, and a relative `meta.logo`) is
rewritten to an absolute URL pointing back at this server. `standalone: true` inlines the CSS and the
favicon; the logo stays a URL, so a fully offline archive should use an emoji or a `data:` URI for
`meta.logo`. Behind a reverse proxy, forward `X-Forwarded-Proto` and `X-Forwarded-Host` — those
headers are what the absolute URLs are built from.

### Examples

```bash
# the page, straight to a file
curl -X POST http://localhost:8138/api/render \
     -H "Content-Type: application/json" \
     -d @data/lessons/math-g7-linear-equations-diff.json \
     -o lesson.html

# kid theme, self-contained, no JavaScript
curl -X POST "http://localhost:8138/api/render?theme=kid&standalone=1&interactive=0" \
     -H "Content-Type: application/json" \
     -d @worksheet.json -o worksheet.html

# ready to iframe
curl -X POST "http://localhost:8138/api/render?embed=1" ...
```

```js
// Node / any backend
const res  = await fetch("http://localhost:8138/api/render?theme=pro", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(worksheet)
});
const html = await res.text();          // ← the finished page
```

```python
import requests
html = requests.post("http://localhost:8138/api/render",
                     json={"options": {"theme": "kid"}, "data": worksheet}).text
```

---

## `GET /api/render?data=<base64url>`

The same renderer behind a plain link, for `<iframe src="…">` and previews. The payload is the
worksheet JSON, base64url-encoded. Browsers cap URLs at a few thousand characters — **use `POST`
for anything sizeable**, or store the sheet once and link to `/s/:id`.

```js
const b64 = Buffer.from(JSON.stringify(worksheet)).toString("base64url");
const src = `http://localhost:8138/api/render?data=${b64}&embed=1`;
```

---

## `POST /api/sheets` — store once, link many times

When the page has to be opened more than once (a link in an email, an `<iframe>` in your LMS, a
headless browser that will screenshot it), store the payload and hand out the URL.

```bash
curl -X POST http://localhost:8138/api/sheets \
     -H "Content-Type: application/json" -d @worksheet.json
```

```json
{
  "id": "J1EKhnqzvlrK",
  "template": "interactive-card",
  "url":      "http://localhost:8138/s/J1EKhnqzvlrK",
  "embedUrl": "http://localhost:8138/s/J1EKhnqzvlrK?embed=1",
  "imageUrl": "http://localhost:8138/s/J1EKhnqzvlrK?image=1",
  "apiUrl":   "http://localhost:8138/api/sheets/J1EKhnqzvlrK",
  "createdAt": "2026-08-12T21:42:00.000Z",
  "expiresAt": "2026-08-13T21:42:00.000Z",
  "warnings": []
}
```

Every render option works on `/s/:id` as a query parameter, so one stored sheet serves the printable
page, the embed, and the image job:

```
/s/J1EKhnqzvlrK                    the page
/s/J1EKhnqzvlrK?embed=1            for an iframe
/s/J1EKhnqzvlrK?theme=kid          same content, playful look
/s/J1EKhnqzvlrK?image=1            page downloads itself as an A4 JPG
/s/J1EKhnqzvlrK?print=1            page opens the print dialog
```

**Storage is in memory and expires** (`EDU_SHEET_TTL_MIN`, 24h by default; a restart clears it).
It is a short-lived render job, not a content store. Lessons that must outlive the process belong in
`data/lessons/<id>.json` and are addressed with `index.html?lesson=<id>`.

---

## `POST /api/validate`

Structural check without rendering — useful in an AI generation loop, before you show anything.

```json
{
  "valid": true,
  "template": "differentiated-lesson",
  "errors": [],
  "warnings": ["No \"meta\" block — the sheet renders with default title and colors."]
}
```

Returns `200` when valid, `422` when not. `errors` block rendering; `warnings` never do.

---

## Getting a PNG/JPG or a PDF

Rendering happens in the browser's layout engine, so images and PDFs come from a browser — the API
gives you the page and the trigger:

```js
// Puppeteer / Playwright — image
const { id } = await (await fetch(`${API}/api/sheets`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(worksheet)
})).json();

const page = await browser.newPage();
await page.goto(`${API}/s/${id}?image=1&toolbar=0`);      // downloads the A4 JPG itself
await page.waitForFunction(() => document.documentElement.dataset.eduImage === "done");

// …or a PDF, one A4 page, print CSS applied
await page.goto(`${API}/s/${id}?toolbar=0`);
await page.pdf({ path: "sheet.pdf", format: "A4", printBackground: true });
```

`document.documentElement.dataset.eduImage === "done"` is the signal that the JPG finished.

---

## Authentication

Set `EDU_API_KEY` and every `/api/*` and `/s/*` request must carry it:

```
X-Api-Key: your-key
Authorization: Bearer your-key      # also accepted
```

Four paths are deliberately outside the gate:

| Path | Why |
|---|---|
| `GET /api/health` | so a load balancer or `HEALTHCHECK` can probe it without the key |
| `GET /a/:id?t=…` | a student's own answer sheet |
| `POST /api/pipeline/submit` | that student submitting it |
| `GET /api/pipeline/result/:id` · `/report/:id` | the result that submission produced |

The last three are reached by a browser holding a single-use link and nothing else, so they
authenticate against that link's own token instead — they are not unauthenticated. See
[the pipeline → Security](PIPELINE.md#security).

The key is checked on the server, so it never reaches `config.js` — never put a secret in that file,
it ships to the browser.

### The content-protection settings do not apply here

`config.js → protection` (domain lock, `file://` block, right-click deterrents, packed `.wsx`
lessons) guards the **browser app**. A page you asked the API to render is yours to place wherever
you like, so it ships without those guards. Protect the API instead — `EDU_API_KEY`, your own
gateway, or simply not exposing the port.

---

## Deploying

The server is a plain Node HTTP app; put it behind nginx/IIS/Caddy as usual, or run it on any host
that speaks Node ≥ 18. It honours `X-Forwarded-Proto` and `X-Forwarded-Host`, so the URLs it hands
back (`url`, `embedUrl`, the asset links inside the page) stay correct behind a reverse proxy.

If you only need the browser app and no API, nothing changed: the site is still a folder of static
files you can drop on any static host.

Docker, the environment file, the logo, embedding and content protection are in
[DEPLOY.md](DEPLOY.md).

---

## The URL contract

| Parameter | Meaning |
|---|---|
| `?lesson=<id>` | **The main one.** Aliases: `lessonId`, `id`, `l`. |
| `?age=kid` \| `pro` | Overrides `meta.age` / `meta.theme`. `?theme=` is the same knob. |
| `?toolbar=0` \| `1` | Show/hide the floating toolbar (default: shown standalone, hidden in an iframe) |
| `?embed=1` | Strip the page chrome on `index.html` (what `embed.html` does by default) |
| `?src=<url>` | Load an explicit JSON URL instead of a lesson id |
| `?data=<base64>` | Inline base64-encoded UTF-8 JSON — no server file needed, useful for previews |
| `?image=1` | Save the sheet as an A4 JPG as soon as it is painted (automation hook) |
| `?print=1` | Open the print dialog as soon as it is painted |

Lesson ids are restricted to `A–Z a–z 0–9 _ -` (max 80 chars) because they become part of a file
path. Anything else is rejected **before** a request is made.

---

---

## `config.js`

```js
window.EDU_CONFIG = {
  apiBase: "",                              // "" = static mode
  apiPath:    "{base}/lessons/{id}",
  lessonPath: "data/lessons/{id}.json",
  fallbackToStatic: true,
  defaultLesson: "science-g2-living-creatures-needs",
  unwrapKeys: ["data", "worksheet", "lesson", "result"]
};
```

**Static mode** (`apiBase: ""`) — `?lesson=abc` reads `data/lessons/abc.json`. Works on any static
host with zero backend.

**API mode** — set `apiBase: "https://api.example.com"` and `?lesson=abc` calls
`GET https://api.example.com/lessons/abc`. If the call fails (404, offline, CORS) and
`fallbackToStatic` is on, the static file is tried next, so the site keeps working during a backend
outage. `unwrapKeys` handles APIs that wrap the payload in `{"data": {...}}`.

The API must return the same worksheet JSON shape documented below, and must send
`Access-Control-Allow-Origin` for the site's domain. The bundled server already speaks this contract
— point `apiBase` at `"/api"` and `?lesson=<id>` is served by `GET /api/lessons/<id>`.

This is the **pull** direction (the browser asks for a lesson by id). For the **push** direction —
your backend sends the data and receives a finished page — see the [render API](API.md) above.

> `config.js` is public — every browser downloads it. Never put a secret in it. If lessons need to
> be access-controlled, enforce that on the API with a session cookie (`credentials: "include"`),
> not with a key in this file.

---

---

## JS API

```js
EduWorksheet.load("science-g1-plant-parts");  // swap lessons without a page reload
EduWorksheet.render(jsonObject, { theme });   // render an object directly (e.g. from an AI generator)
EduWorksheet.setTheme("pro");
EduWorksheet.reset();                         // clear every student answer
EduWorksheet.print();
EduWorksheet.toImage();                       // download the sheet as an A4 JPG

EduWorksheet.data;                            // the worksheet JSON on screen
EduWorksheet.theme;                           // "pro" | "playful", as currently rendered
EduWorksheet.config;                          // the resolved config.js object
```

Presentation mode has the same surface — see
[Presentation mode](TEMPLATES.md#presentation-mode):

```js
EduWorksheet.present();        EduWorksheet.exitPresent();   EduWorksheet.togglePresent();
EduWorksheet.nextSlide();      EduWorksheet.prevSlide();     EduWorksheet.goToSlide(2);
EduWorksheet.presenting;       // true while the stage is open
```

`window.renderWorksheet(obj)` still works as an alias for `EduWorksheet.render`.

A page produced by `POST /api/render` carries its payload in `window.EDU_DATA` (and its render
options in `window.EDU_OPTIONS`). The loader reads that before anything else, so the page needs no
second request — set `window.EDU_DATA` yourself if you are printing the JSON into your own template.

---
