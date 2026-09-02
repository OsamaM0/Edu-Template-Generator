#!/usr/bin/env node
/* ============================================================================
   tools/store.mjs — the results database, from the command line
   ----------------------------------------------------------------------------
     node tools/store.mjs check                 can this connection read and write?
     node tools/store.mjs indexes               declare the indexes; list them
     node tools/store.mjs stats                 document counts, per collection
     node tools/store.mjs import-files          pull the old JSON files in
     node tools/store.mjs expire                close links whose time has passed
     node tools/store.mjs find <collection> [filter] [limit]

   `check` is the one to run first on a new deployment. It attempts a real
   write, because a Mongo user with `read` where `readWrite` was meant connects
   perfectly and then refuses every submission — and finding that out from a
   student's failed exam is the worst possible time.

   Everything honours EDU_PIPELINE_MONGO_URI and EDU_STORE_DB; --uri and --db
   override them for one run.
   ========================================================================== */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { settings, store, stats, checkAccess, ensureIndexes, close, db, ALL } from "../server/store/index.mjs";
import { assignments, results } from "../server/store/repo.mjs";
import config from "../server/pipeline/config.mjs";

/* ------------------------------------------------------------------ args -- */

const argv = process.argv.slice(2);
const command = (argv[0] || "help").toLowerCase();
const flags = new Set(argv.filter(a => a.startsWith("--")));

/* --uri and --db take a value, so each and the token after it are removed
   before what is left is treated as the command's own arguments. */
const positional = [];
for (let i = 1; i < argv.length; i++){
  if (argv[i] === "--uri"){ settings.uri = argv[++i] || settings.uri; continue; }
  if (argv[i] === "--db"){ settings.db = argv[++i] || settings.db; continue; }
  if (argv[i].startsWith("--")) continue;
  positional.push(argv[i]);
}

const say = (...parts) => console.log(...parts);
const bar = () => say("─".repeat(66));
const line = (label, value) => say(`  ${String(label).padEnd(24)} ${value}`);

/** The URI with its password removed — safe to print. */
const safeUri = uri => String(uri || "(not set)").replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");

/* -------------------------------------------------------------- commands -- */

const COMMANDS = {

  /**
   * The deployment check. Connection, read, write — in that order, because each
   * one failing means something different and the difference is the whole point.
   */
  async check(){
    say("");
    line("uri", safeUri(settings.uri));
    line("lessons database", `${settings.lessonDb}  (read only)`);
    line("results database", `${settings.db}  (read/write)`);
    bar();

    const access = await checkAccess();
    line("connected", access.connected ? "yes" : "NO");
    line("can read", access.canRead ? "yes" : "NO");
    line("can write", access.canWrite ? "yes" : "NO");

    if (access.error) line("error", access.error);
    if (access.hint){
      say("");
      say(access.hint);
    }

    say("");

    /* Two failures, two different things to go and do. Telling someone to grant
       a role when the host is simply unreachable sends them to the wrong
       machine, so the advice follows what actually failed. */
    if (access.canWrite){
      say("Good — this connection can do everything the platform needs.");
    } else if (!access.connected){
      say("Nothing else can be checked until this connects. Confirm that:");
      say("");
      say("  · EDU_PIPELINE_MONGO_URI names the right host and port");
      say("  · mongod is running there, and this machine can reach it");
      say("  · a tunnel or firewall is not in the way — the URI above says where it looked");
      process.exitCode = 1;
    } else {
      say("Connected, but this user may not write. The platform can build and serve");
      say("pages; it cannot issue a link to a student or store a result.");
      say("");
      say("  use admin");
      say("  db.grantRolesToUser(\"<user>\", [ { role: \"readWrite\", db: \"" + settings.db + "\" } ])");
      process.exitCode = 1;
    }
    say("");
  },

  /** Declare every index the collections need, then show what is there. */
  async indexes(){
    say(`Declaring indexes on ${settings.db}…`);
    const created = await ensureIndexes();
    bar();

    const c = store();
    for (const collection of ALL){
      const names = await c.listIndexes(collection, { db: db() });
      const status = created[collection] == null ? "(failed)" : "";
      say(`  ${collection.padEnd(16)} ${names.join(", ") || "(none yet)"} ${status}`.trimEnd());
    }
  },

  async stats(){
    const s = await stats();
    if (!s.ok){
      say(`Store unavailable: ${s.error || "disabled"}`);
      process.exitCode = 1;
      return;
    }

    say(`${s.database} on ${safeUri(settings.uri)}  ·  ${s.documents} documents`);
    bar();
    const width = Math.max(...Object.keys(s.collections).map(k => k.length));
    for (const [name, n] of Object.entries(s.collections)){
      if (n || !flags.has("--used")) line(name.padEnd(width), String(n).padStart(6));
    }
  },

  /**
   * Bring the file-based era in: data/assignments/<id>.json became the
   * assignments collection, data/output/<id>.json became submissions and
   * analyses. Safe to run twice — every write is keyed on the id the file
   * carries, so a second run updates rather than duplicates.
   */
  async "import-files"(){
    let links = 0, imported = 0, skipped = 0;

    for (const [dir, kind] of [[config.assignDir, "assignment"], [config.outputDir, "result"]]){
      let files = [];
      try { files = (await readdir(dir)).filter(f => f.endsWith(".json")); }
      catch { say(`  ${dir} — nothing to import`); continue; }

      for (const file of files){
        let payload;
        try { payload = JSON.parse(await readFile(path.join(dir, file), "utf8")); }
        catch { skipped++; continue; }

        try {
          if (kind === "assignment" && payload.id && payload.token){
            await assignments.put(payload, { event: "issued", reason: "imported from file" });
            links++;
          } else if (kind === "result" && payload.assignment_id){
            await results.save(payload, { source: "import" });
            imported++;
          } else {
            skipped++;
          }
        } catch (err){
          say(`  ${file}: ${err.message}`);
          skipped++;
        }
      }
      say(`  ${dir} — ${files.length} files`);
    }

    bar();
    say(`Imported ${links} assignments and ${imported} results. Skipped ${skipped}.`);
    say("The files are left where they are — delete them once you are satisfied.");
  },

  /** Close the links whose moment has passed, so a dashboard stops calling them live. */
  async expire(){
    const n = await assignments.expireOverdue();
    say(n ? `Closed ${n} overdue link${n === 1 ? "" : "s"}.` : "Nothing was overdue.");
  },

  /** A read-only look at one collection. Writing is what the API is for. */
  async find(){
    const [collection, filterText, limitText] = positional;
    if (!collection){
      say(`Give it a collection: ${ALL.join(", ")}`);
      return;
    }
    if (!ALL.includes(collection)){
      say(`"${collection}" is not one of this database's collections: ${ALL.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    let filter = {};
    if (filterText){
      try { filter = JSON.parse(filterText); }
      catch { say(`The filter must be JSON: '{"status":"submitted"}'`); process.exitCode = 1; return; }
    }

    const rows = await store().find(collection, filter, {
      db: db(),
      limit: Math.min(Number(limitText) || 10, 200),
      sort: { _id: -1 }
    });

    if (!rows.length) return say("(nothing matched)");
    say(JSON.stringify(rows, null, 2));
    say(`${rows.length} document${rows.length === 1 ? "" : "s"}`);
  },

  async help(){
    say(String.raw`
  node tools/store.mjs <command> [--uri <uri>] [--db <name>]

    check                    can this connection read AND write? run this first
    indexes                  declare the indexes the collections need
    stats [--used]           document counts per collection
    import-files             read data/assignments and data/output into Mongo
    expire                   close links whose time has passed
    find <collection> [filter] [limit]
                             a read-only look, e.g.
                             find assignments '{"status":"issued"}' 5

  Results database: ${settings.db}
  Lessons database: ${settings.lessonDb}  (read only)
  Connection:       ${safeUri(settings.uri)}
`);
  }
};

/* ------------------------------------------------------------------- run -- */

const run = COMMANDS[command] || COMMANDS.help;

try {
  await run();
} catch (err){
  console.error(`\n${err.message}`);
  if (err.code === 13){
    console.error(`\nThat is a permissions error. Run \`node tools/store.mjs check\` for what to grant.`);
  }
  process.exitCode = 1;
} finally {
  close();
}
