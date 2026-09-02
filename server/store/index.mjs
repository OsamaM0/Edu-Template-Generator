/* ============================================================================
   server/store — everything this platform creates, in MongoDB
   ----------------------------------------------------------------------------
   ONE connection, TWO databases, and the difference between them matters:

     ai            the generator's lessons — questions, worksheets, summaries.
                   READ ONLY. Not ours, never written to.
     activities    documents, assignments, links, submissions, analyses.
                   OURS. Everything this platform produces lands here.

   Splitting them is what lets the Mongo user hold `read` on one and
   `readWrite` on the other, so a bug in this code cannot corrupt the
   generator's output. The credentials say so out loud:

     db.createUser({ user: "edu-app", pwd: "…", roles: [
       { role: "readWrite", db: "activities" },
       { role: "read",      db: "ai" } ] })

   NO ROSTER LIVES HERE. Schools, teachers, classes and students belong to the
   partner platform; they arrive as parameters and are stored as snapshots on
   the records we own. See collections.mjs for why that is the right record
   rather than a shortcut.

   Environment:
     EDU_PIPELINE_MONGO_URI   the connection                        (required)
     EDU_PIPELINE_DB          the lessons database        (default ai)
     EDU_STORE_DB             the database we write       (default activities)
     EDU_STORE                "0" turns writing off entirely      (default on)

   Structure:
     collections.mjs   the collection names and their indexes
     documents.mjs     generated sheets and the questions they printed
     assignments.mjs   issued links, their groups, and their status history
     results.mjs       submissions, analyses, backend deliveries
     audit.mjs         what the system did
   ========================================================================== */
import crypto from "node:crypto";

/* Fills process.env from .env before the settings below read it. Shared with
   the pipeline and idempotent, so whichever loads first wins. */
import "../pipeline/env.mjs";

import { MongoClient } from "../pipeline/mongo/client.mjs";
import { ALL, INDEXES } from "./collections.mjs";

const off = v => v != null && /^(0|false|no|off)$/i.test(String(v));
const str = name => (process.env[name] || "").trim();

export const settings = {
  enabled: !off(process.env.EDU_STORE),
  uri: str("EDU_PIPELINE_MONGO_URI"),
  /** Ours, read-write. */
  db: str("EDU_STORE_DB") || "activities",
  /** The generator's, read-only — named here so one client serves both. */
  lessonDb: process.env.EDU_PIPELINE_DB || "ai"
};

/* -------------------------------------------------------------- utilities -- */

/** ISO-8601 UTC. Stored as a string, so a dump reads the same as an API response. */
export const now = () => new Date().toISOString();

/**
 * A new `_id`. URL-safe and random rather than an ObjectId: several of these
 * ids travel through a path segment, and one that needs escaping is one that
 * eventually will not be.
 */
export const newId = (prefix = "") =>
  (prefix ? `${prefix}_` : "") + crypto.randomBytes(12).toString("base64url");

/**
 * A STABLE id derived from what it identifies, for embedded rows that are
 * rewritten whenever their parent is. Two re-grades of one sheet produce the
 * same goal ids, so a diff of the two says what changed rather than that
 * everything did.
 */
export const derivedId = (...parts) =>
  crypto.createHash("sha1").update(parts.map(p => String(p == null ? "" : p)).join(" ")).digest("base64url").slice(0, 22);

/* ----------------------------------------------------------- the client -- */

let client = null;
let indexesReady = null;

/**
 * The shared connection. Opened on first use so an unreachable database cannot
 * stop the server booting — the static site and the render API do not need it.
 *
 * The SAME client serves the lessons database. One socket, two `$db` values;
 * the caller says which by passing `{ db }`.
 */
export function mongo(){
  if (client) return client;

  if (!settings.uri){
    throw Object.assign(
      new Error("EDU_PIPELINE_MONGO_URI is not set — there is no database to read or write."),
      { status: 503, code: "not-configured" }
    );
  }
  client = new MongoClient(settings.uri);
  return client;
}

/** True when writing is switched on and configured. Never throws. */
export const writable = () => settings.enabled && !!settings.uri;

/** host:port from the connection string, with the credentials left out. */
function endpoint(){
  const match = /^mongodb:\/\/(?:[^@]*@)?([^/?]+)/.exec(settings.uri || "");
  return match ? match[1] : "the configured host";
}

/**
 * Why an error happened, in words.
 *
 * Node throws an AggregateError when a host resolves to several addresses and
 * every one of them fails — ::1 and 127.0.0.1 for "localhost" being the usual
 * pair. Its own `message` is EMPTY; the reasons are in `.errors`. Logging
 * `err.message` for one of those prints "could not connect:" and stops, which
 * is how a misconfigured URI turns into a silent boot.
 */
export function reason(err){
  if (!err) return "unknown error";
  if (err.message) return err.message;

  if (Array.isArray(err.errors) && err.errors.length){
    const seen = [...new Set(err.errors.map(e => e && (e.message || e.code)).filter(Boolean))];
    if (seen.length) return seen.join("; ");
  }
  return err.code ? String(err.code) : String(err);
}

/**
 * The two failures a deployment actually hits, each said in a way an operator
 * can act on. Everything else is passed through untouched.
 *
 * Raw, both surface as a 500: one carrying the internal query, the other
 * carrying nothing at all. Neither is any use to the teacher who sees it or to
 * whoever has to fix it.
 */
function translate(err){
  if (!err) return err;

  /* Cannot reach it. */
  if (UNREACHABLE.has(err.code) || (Array.isArray(err.errors) && err.errors.some(e => e && UNREACHABLE.has(e.code)))){
    return Object.assign(
      new Error(`Cannot reach MongoDB at ${endpoint()} (${reason(err)}).`),
      {
        status: 503,
        code: "store-unreachable",
        detail: "Check EDU_PIPELINE_MONGO_URI, that the server is running, and that this host can " +
          "reach it. Run 'npm run store:check' to confirm.",
        cause: err
      }
    );
  }

  /* Reached it, but the user may not write. A failed command carries mongoCode
     (assertOk); a refused write carries code (assertWrite). Missing either one
     is how this ends up surfacing as a raw 500 again. */
  const mongoCode = err.mongoCode != null ? err.mongoCode : err.code;
  if (mongoCode !== 13) return err;

  return Object.assign(
    new Error(`The database user cannot write to "${settings.db}". Pages still build and serve, but nothing can be issued to a student or stored.`),
    {
      status: 503,
      code: "store-not-writable",
      detail: `Grant it the role: db.grantRolesToUser("<user>", [ { role: "readWrite", db: "${settings.db}" } ]). ` +
        "Run 'npm run store:check' to confirm. The original error is in the server log.",
      cause: err
    }
  );
}

/** The connection-level failures worth naming rather than passing through raw. */
const UNREACHABLE = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN"
]);

/*
 * Every repository method goes through store(), and every one of them can hit
 * that authorisation failure. Wrapping the client once here beats a try/catch
 * at each of the sixty-odd call sites, and means a new repository method cannot
 * forget to do it.
 */
function guard(client){
  return new Proxy(client, {
    get(target, property){
      const value = target[property];
      if (typeof value !== "function") return value;

      return function (...args){
        try {
          const out = value.apply(target, args);
          // Async methods reject rather than throw; catch both shapes.
          return (out && typeof out.then === "function")
            ? out.catch(err => { throw translate(err); })
            : out;
        } catch (err){
          throw translate(err);
        }
      };
    }
  });
}

let guarded = null;
let guardedFor = null;   // the client it wraps, so a reopen rebuilds the wrapper

/**
 * The store, or a thrown 503. Every repository starts here, so "the database is
 * off" and "the database will not take writes" are each one message in one
 * place rather than a check per call site.
 */
export function store(){
  if (!settings.enabled){
    throw Object.assign(new Error("The store is disabled (EDU_STORE=0)."),
      { status: 503, code: "store-disabled" });
  }
  const client = mongo();
  if (guardedFor !== client){
    guarded = guard(client);
    guardedFor = client;
  }
  return guarded;
}

/** Where a repository writes. Passed to every command so nothing guesses. */
export const db = () => settings.db;

export function close(){
  if (client) client.close();
  client = null;
  guarded = null;
  guardedFor = null;
  indexesReady = null;
}

/* ------------------------------------------------------------- the setup -- */

/**
 * Declare every index the collections need.
 *
 * Run once per process, lazily, and memoized as a promise so a burst of first
 * requests waits on one pass rather than racing eight createIndexes commands.
 * Idempotent on the server, so running it on every boot is free after the
 * first — which is what makes it safe to do automatically instead of asking
 * someone to remember.
 *
 * A failure is logged and NOT thrown: missing indexes make queries slow, and a
 * slow dashboard is better than a server that will not serve.
 */
export function ensureIndexes(){
  if (indexesReady) return indexesReady;

  indexesReady = (async () => {
    const c = store();
    const created = {};

    for (const [collection, indexes] of Object.entries(INDEXES)){
      try {
        created[collection] = await c.createIndexes(collection, indexes, { db: settings.db });
      } catch (err){
        console.warn(`[store] could not create indexes on ${collection}: ${reason(err)}`);
        created[collection] = null;
      }
    }
    return created;
  })().catch(err => {
    console.warn(`[store] index setup failed: ${reason(err)}`);
    indexesReady = null;              // let a later call try again
    return {};
  });

  return indexesReady;
}

/* ------------------------------------------------------------------ facts -- */

/** Document counts and where they live — what /api/pipeline/store reports. */
export async function stats(){
  if (!settings.enabled) return { enabled: false, database: settings.db, collections: {} };

  try {
    const c = store();
    const collections = {};
    for (const name of ALL) collections[name] = await c.countDocuments(name, {}, { db: settings.db });

    return {
      enabled: true,
      ok: true,
      driver: "mongodb",
      database: settings.db,
      lessonDatabase: settings.lessonDb,
      documents: Object.values(collections).reduce((a, b) => a + b, 0),
      collections
    };
  } catch (err){
    return { enabled: true, ok: false, database: settings.db, error: reason(err), collections: {} };
  }
}

/**
 * Can this connection actually do its job?
 *
 * Reported separately from "is the server up" because the failure this is
 * really looking for is the one that has already happened once: a user with
 * `read` where `readWrite` was meant, which pings perfectly and then refuses
 * every write. Checked by attempting one, in a collection nothing reads.
 */
export async function checkAccess(){
  const out = { connected: false, canRead: false, canWrite: false };

  try {
    const c = store();
    await c.ping();
    out.connected = true;

    await c.countDocuments("assignments", {}, { db: settings.db });
    out.canRead = true;

    const probe = `__access_probe_${crypto.randomBytes(4).toString("hex")}`;
    await c.insertOne("__access", { _id: probe, at: now() }, { db: settings.db });
    await c.deleteOne("__access", { _id: probe }, { db: settings.db });
    out.canWrite = true;

  } catch (err){
    out.error = reason(err);
    if (err.code === "store-not-writable" || err.mongoCode === 13){
      out.hint = `The Mongo user needs { role: "readWrite", db: "${settings.db}" }. ` +
        "Reading lessons only needs `read` on the lessons database; writing results needs readWrite on this one.";
    }
  }

  return out;
}

export { COLLECTIONS, INDEXES, ALL } from "./collections.mjs";
