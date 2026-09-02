/* ============================================================================
   client.mjs — a small MongoDB client: OP_MSG over TCP, SCRAM auth, read and write
   ----------------------------------------------------------------------------
   Enough of the protocol to read and write documents on a replica-set member or
   a standalone server, and nothing more. No pooling beyond one lazily-opened
   socket, no topology discovery, no change streams, no transactions.

   The connection is opened on first use and reused. If it drops, the next
   call opens a new one — the extension only ever reads, so a retry is safe.

     const client = new MongoClient("mongodb://user:pass@host:27017/db?authSource=admin");
     const docs = await client.find("questions", { document_idx: "43617" }, { limit: 1 });
   ========================================================================== */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

import { serialize, deserialize, toPlain } from "./bson.mjs";

const OP_MSG = 2013;
const HEADER_BYTES = 16;

/* ------------------------------------------------------------------- URI -- */

/**
 * Parse a mongodb:// URI. mongodb+srv:// is rejected rather than half-supported:
 * it needs DNS SRV/TXT resolution and always implies TLS.
 */
export function parseUri(uri){
  const raw = String(uri || "").trim();
  if (!raw) throw new Error("Mongo URI is empty.");
  if (raw.startsWith("mongodb+srv://")){
    throw new Error("mongodb+srv:// is not supported here — use mongodb:// with an explicit host:port.");
  }
  if (!raw.startsWith("mongodb://")) throw new Error(`Not a mongodb:// URI: ${raw.slice(0, 24)}…`);

  const rest = raw.slice("mongodb://".length);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const tail = slash === -1 ? "" : rest.slice(slash + 1);

  const at = authority.lastIndexOf("@");
  const credentials = at === -1 ? "" : authority.slice(0, at);
  const hostPart = at === -1 ? authority : authority.slice(at + 1);

  let username = "", password = "";
  if (credentials){
    const colon = credentials.indexOf(":");
    username = decodeURIComponent(colon === -1 ? credentials : credentials.slice(0, colon));
    password = colon === -1 ? "" : decodeURIComponent(credentials.slice(colon + 1));
  }

  // First host wins: this client speaks to one node, not a replica set.
  const first = hostPart.split(",")[0].trim();
  const portAt = first.lastIndexOf(":");
  const host = portAt === -1 ? first : first.slice(0, portAt);
  const port = portAt === -1 ? 27017 : Number(first.slice(portAt + 1)) || 27017;

  const q = tail.indexOf("?");
  const database = decodeURIComponent(q === -1 ? tail : tail.slice(0, q)) || "test";
  const params = new URLSearchParams(q === -1 ? "" : tail.slice(q + 1));

  return {
    host, port, username, password, database,
    authSource: params.get("authSource") || database || "admin",
    tls: /^(true|1)$/i.test(params.get("tls") || params.get("ssl") || ""),
    replicaSet: params.get("replicaSet") || null,
    // Everything the driver would let you tune, kept to what we use.
    connectTimeoutMS: Number(params.get("connectTimeoutMS")) || 10_000,
    socketTimeoutMS: Number(params.get("socketTimeoutMS")) || 20_000
  };
}

/* ------------------------------------------------------------ connection -- */

class Connection {
  constructor(options){
    this.options = options;
    this.socket = null;
    this.requestId = 1;
    this.pending = new Map();
    this.chunks = [];
    this.buffered = 0;
    this.closed = false;
  }

  /* -- framing ------------------------------------------------------------ */

  /** Collect bytes until a whole wire message is present, then dispatch it. */
  onData(chunk){
    this.chunks.push(chunk);
    this.buffered += chunk.length;

    while (this.buffered >= HEADER_BYTES){
      const head = this.peek(HEADER_BYTES);
      const length = head.readInt32LE(0);

      if (length < HEADER_BYTES || length > 48_000_000){
        return this.destroy(new Error(`Mongo sent a ${length}-byte frame; refusing it.`));
      }
      if (this.buffered < length) return;

      const message = this.take(length);
      try { this.dispatch(message); }
      catch (err){ return this.destroy(err); }
    }
  }

  peek(n){
    if (this.chunks.length > 1){
      this.chunks = [Buffer.concat(this.chunks, this.buffered)];
    }
    return this.chunks[0].subarray(0, n);
  }

  take(n){
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.buffered);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;
    return out;
  }

  dispatch(message){
    const responseTo = message.readInt32LE(8);
    const opCode = message.readInt32LE(12);
    const waiter = this.pending.get(responseTo);
    if (!waiter) return;                       // late answer to a timed-out call
    this.pending.delete(responseTo);

    if (opCode !== OP_MSG){
      return waiter.reject(new Error(`Expected OP_MSG (2013), got opcode ${opCode}.`));
    }

    // flagBits(4) then sections. Only the kind-0 body section is ever needed.
    let i = HEADER_BYTES + 4;
    let body = null;
    while (i < message.length){
      const kind = message[i++];
      if (kind === 0){
        const size = message.readInt32LE(i);
        body = deserialize(message, i);
        i += size;
      } else if (kind === 1){
        i += message.readInt32LE(i);           // document sequence — not used
      } else {
        return waiter.reject(new Error(`Unknown OP_MSG section kind ${kind}.`));
      }
    }

    if (!body) return waiter.reject(new Error("OP_MSG carried no body section."));
    waiter.resolve(body);
  }

  /* -- sending ------------------------------------------------------------ */

  send(command, timeoutMs){
    return new Promise((resolve, reject) => {
      if (this.closed || !this.socket){
        return reject(new Error("Mongo connection is not open."));
      }

      const body = serialize(command);
      const id = this.requestId++;

      const message = Buffer.allocUnsafe(HEADER_BYTES + 4 + 1 + body.length);
      message.writeInt32LE(message.length, 0);
      message.writeInt32LE(id, 4);
      message.writeInt32LE(0, 8);
      message.writeInt32LE(OP_MSG, 12);
      message.writeUInt32LE(0, HEADER_BYTES);     // flagBits: none
      message[HEADER_BYTES + 4] = 0;              // section kind 0 (body)
      body.copy(message, HEADER_BYTES + 5);

      const timer = setTimeout(() => {
        this.pending.delete(id);
        const name = Object.keys(command)[0];
        reject(new Error(`Mongo command "${name}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject:  e => { clearTimeout(timer); reject(e); }
      });

      this.socket.write(message, err => { if (err){ this.pending.delete(id); clearTimeout(timer); reject(err); } });
    });
  }

  destroy(err){
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()){
      waiter.reject(err || new Error("Mongo connection closed."));
    }
    this.pending.clear();
    try { this.socket && this.socket.destroy(); } catch { /* already gone */ }
  }
}

/* ------------------------------------------------------------------ SCRAM -- */

/** SCRAM usernames escape "=" and "," so the comma-separated payload stays parseable. */
const scramName = u => String(u).replace(/=/g, "=3D").replace(/,/g, "=2C");

const parsePayload = s => Object.fromEntries(
  String(s).split(",").filter(Boolean).map(p => {
    const eq = p.indexOf("=");
    return [p.slice(0, eq), p.slice(eq + 1)];
  })
);

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const xor  = (a, b) => Buffer.from(a.map((byte, i) => byte ^ b[i]));

async function authenticate(conn, { username, password, authSource }, timeoutMs){
  const nonce = crypto.randomBytes(24).toString("base64");
  const firstBare = `n=${scramName(username)},r=${nonce}`;

  const start = await conn.send({
    saslStart: 1,
    mechanism: "SCRAM-SHA-256",
    payload: Buffer.from(`n,,${firstBare}`, "utf8"),
    options: { skipEmptyExchange: true },
    $db: authSource
  }, timeoutMs);
  assertOk(start, "saslStart");

  const serverFirst = start.payload.buffer.toString("utf8");
  const fields = parsePayload(serverFirst);

  if (!String(fields.r || "").startsWith(nonce)){
    throw new Error("SCRAM: the server nonce does not extend ours — refusing to continue.");
  }

  // SCRAM-SHA-256 hashes the password as-is; SASLprep only matters for
  // non-ASCII secrets, which this deployment does not use.
  const salted = crypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(fields.s, "base64"),
    Number(fields.i),
    32, "sha256"
  );

  const clientKey = hmac(salted, "Client Key");
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const withoutProof = `c=biws,r=${fields.r}`;
  const authMessage = `${firstBare},${serverFirst},${withoutProof}`;
  const proof = xor(clientKey, hmac(storedKey, authMessage));

  const cont = await conn.send({
    saslContinue: 1,
    conversationId: start.conversationId,
    payload: Buffer.from(`${withoutProof},p=${proof.toString("base64")}`, "utf8"),
    $db: authSource
  }, timeoutMs);
  assertOk(cont, "saslContinue");

  // Prove the server knew the password too, not just that it accepted ours.
  const serverKey = hmac(salted, "Server Key");
  const expected = hmac(serverKey, authMessage).toString("base64");
  const got = parsePayload(cont.payload.buffer.toString("utf8")).v;
  if (got !== expected) throw new Error("SCRAM: server signature mismatch — the endpoint is not who it claims to be.");

  // Older servers want one more empty round before they call it done.
  if (!cont.done){
    const final = await conn.send({
      saslContinue: 1,
      conversationId: start.conversationId,
      payload: Buffer.alloc(0),
      $db: authSource
    }, timeoutMs);
    assertOk(final, "saslContinue");
  }
}

/* ----------------------------------------------------------------- client -- */

function assertOk(reply, what){
  if (reply && (reply.ok === 1 || reply.ok === true)) return reply;
  const message = (reply && (reply.errmsg || reply.$err)) || "unknown error";
  const code = reply && reply.code;
  throw Object.assign(new Error(`Mongo ${what} failed: ${message}${code ? ` (code ${code})` : ""}`), { mongoCode: code });
}

export class MongoClient {
  constructor(uri, overrides = {}){
    this.options = Object.assign(parseUri(uri), overrides);
    this.conn = null;
    this.connecting = null;
  }

  get database(){ return this.options.database; }

  /** One connection, opened once. Concurrent callers share the same attempt. */
  async connection(){
    if (this.conn && !this.conn.closed) return this.conn;
    if (this.connecting) return this.connecting;

    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async open(){
    const o = this.options;
    const conn = new Connection(o);

    await new Promise((resolve, reject) => {
      const settle = err => {
        clearTimeout(timer);
        socket.removeListener("error", onError);
        err ? reject(err) : resolve();
      };
      const onError = err => settle(err);

      const socket = o.tls
        ? tls.connect({ host: o.host, port: o.port, servername: o.host })
        : net.connect({ host: o.host, port: o.port });

      const timer = setTimeout(
        () => { socket.destroy(); settle(new Error(`Mongo connect to ${o.host}:${o.port} timed out after ${o.connectTimeoutMS}ms.`)); },
        o.connectTimeoutMS
      );

      socket.once("error", onError);
      socket.once(o.tls ? "secureConnect" : "connect", () => {
        socket.setNoDelay(true);
        settle(null);
      });

      conn.socket = socket;
    });

    conn.socket.on("data",  c   => conn.onData(c));
    conn.socket.on("error", err => conn.destroy(err));
    conn.socket.on("close", ()  => conn.destroy(new Error("Mongo closed the connection.")));

    // The handshake doubles as a liveness check and tells the server who we are.
    assertOk(await conn.send({
      hello: 1,
      client: {
        driver: { name: "edu-pipeline-minimal", version: "1.0.0" },
        os: { type: process.platform },
        application: { name: "EduWebTemplateGenerator" }
      },
      $db: o.authSource
    }, o.connectTimeoutMS), "hello");

    if (o.username) await authenticate(conn, o, o.connectTimeoutMS);

    this.conn = conn;
    return conn;
  }

  /** Run a command, reopening the socket once if it died between calls. */
  async command(command, { db, timeoutMs } = {}){
    const payload = Object.assign({}, command, { $db: db || this.options.database });
    const budget = timeoutMs || this.options.socketTimeoutMS;

    for (let attempt = 0; attempt < 2; attempt++){
      const conn = await this.connection();
      try {
        return assertOk(await conn.send(payload, budget), Object.keys(command)[0]);
      } catch (err){
        // A dead socket is worth one silent retry; a rejected command is not.
        const stale = conn.closed && attempt === 0;
        if (!stale) throw err;
        this.conn = null;
      }
    }
    throw new Error("Mongo command failed after reconnecting.");
  }

  /**
   * find, with the cursor drained. Returns plain JSON-safe objects.
   * @param {string} collection
   * @param {object} filter
   * @param {{limit?:number, projection?:object, sort?:object, db?:string, batchSize?:number}} opts
   */
  async find(collection, filter = {}, opts = {}){
    const db = opts.db || this.options.database;
    const command = { find: collection, filter };
    if (opts.projection) command.projection = opts.projection;
    if (opts.sort)       command.sort = opts.sort;
    if (opts.limit)      command.limit = opts.limit;
    if (opts.batchSize)  command.batchSize = opts.batchSize;

    const first = await this.command(command, { db });
    const docs = [...(first.cursor.firstBatch || [])];

    let cursorId = first.cursor.id;
    while (cursorId && String(cursorId) !== "0" && (!opts.limit || docs.length < opts.limit)){
      const more = await this.command(
        { getMore: cursorId, collection, batchSize: opts.batchSize || 100 }, { db }
      );
      docs.push(...(more.cursor.nextBatch || []));
      cursorId = more.cursor.id;
      if (!more.cursor.nextBatch || !more.cursor.nextBatch.length) break;
    }

    // Leaving a live cursor open would hold server resources until it times out.
    if (cursorId && String(cursorId) !== "0"){
      try { await this.command({ killCursors: collection, cursors: [cursorId] }, { db }); }
      catch { /* best effort — the server reaps it anyway */ }
    }

    return docs.map(toPlain);
  }

  /** The first match, or null. */
  async findOne(collection, filter = {}, opts = {}){
    const [doc] = await this.find(collection, filter, Object.assign({}, opts, { limit: 1 }));
    return doc || null;
  }


  /* ------------------------------------------------------------- writing -- */

  /*
   * The write commands, in the same style as find(): one method per thing the
   * application actually does, each one a thin wrapper over command().
   *
   * WRITE ERRORS ARE NOT PROTOCOL ERRORS. Mongo answers { ok: 1, writeErrors:
   * [...] } for a document it refused — a duplicate key, a failed validator —
   * so assertOk() lets it through and every method below has to look. Silently
   * returning "fine" for a write that did not happen is the one failure mode
   * this whole layer exists to prevent.
   */

  /** Turn a reply's writeErrors into a thrown error, or return the reply. */
  static assertWrite(reply, what){
    const errors = reply.writeErrors || (reply.writeConcernError ? [reply.writeConcernError] : null);
    if (errors && errors.length){
      const first = errors[0];
      throw Object.assign(
        new Error(`Mongo ${what} refused the document: ${first.errmsg || first.errInfo || "unknown reason"}`),
        { code: first.code, mongoWriteErrors: errors }
      );
    }
    return reply;
  }

  /** Insert one document. Its _id is returned, generated or given. */
  async insertOne(collection, document, opts = {}){
    const reply = await this.command({ insert: collection, documents: [document] }, { db: opts.db });
    MongoClient.assertWrite(reply, "insert");
    return document._id;
  }

  /** Insert many in one round trip. Ordered, so the first failure stops the rest. */
  async insertMany(collection, documents, opts = {}){
    if (!documents.length) return 0;
    const reply = await this.command(
      { insert: collection, documents, ordered: opts.ordered !== false }, { db: opts.db });
    MongoClient.assertWrite(reply, "insert");
    return reply.n || 0;
  }

  /**
   * Update one document. `update` is a full update document ({$set: …}), not a
   * replacement — a bare object would silently drop every field it omits.
   *
   * @returns {Promise<{matched:number, modified:number, upsertedId:any}>}
   */
  async updateOne(collection, filter, update, opts = {}){
    const reply = await this.command({
      update: collection,
      updates: [{ q: filter, u: update, upsert: !!opts.upsert, multi: false }]
    }, { db: opts.db });
    MongoClient.assertWrite(reply, "update");

    return {
      matched: reply.n || 0,
      modified: reply.nModified || 0,
      upsertedId: (reply.upserted && reply.upserted[0] && reply.upserted[0]._id) || null
    };
  }

  /** Replace one whole document, or insert it when there is none. */
  async replaceOne(collection, filter, document, opts = {}){
    const reply = await this.command({
      update: collection,
      updates: [{ q: filter, u: document, upsert: opts.upsert !== false, multi: false }]
    }, { db: opts.db });
    MongoClient.assertWrite(reply, "replace");

    return {
      matched: reply.n || 0,
      modified: reply.nModified || 0,
      upsertedId: (reply.upserted && reply.upserted[0] && reply.upserted[0]._id) || null
    };
  }

  async updateMany(collection, filter, update, opts = {}){
    const reply = await this.command({
      update: collection, updates: [{ q: filter, u: update, upsert: false, multi: true }]
    }, { db: opts.db });
    MongoClient.assertWrite(reply, "update");
    return { matched: reply.n || 0, modified: reply.nModified || 0 };
  }

  async deleteOne(collection, filter, opts = {}){
    const reply = await this.command(
      { delete: collection, deletes: [{ q: filter, limit: 1 }] }, { db: opts.db });
    MongoClient.assertWrite(reply, "delete");
    return reply.n || 0;
  }

  async deleteMany(collection, filter, opts = {}){
    const reply = await this.command(
      { delete: collection, deletes: [{ q: filter, limit: 0 }] }, { db: opts.db });
    MongoClient.assertWrite(reply, "delete");
    return reply.n || 0;
  }

  /* ------------------------------------------------------------- reading -- */

  async countDocuments(collection, filter = {}, opts = {}){
    const reply = await this.command({ count: collection, query: filter }, { db: opts.db });
    return reply.n || 0;
  }

  /** An aggregation, cursor drained the same way find() drains its own. */
  async aggregate(collection, pipeline, opts = {}){
    const db = opts.db || this.options.database;
    const first = await this.command(
      { aggregate: collection, pipeline, cursor: { batchSize: opts.batchSize || 100 } }, { db });

    const docs = [...(first.cursor.firstBatch || [])];
    let cursorId = first.cursor.id;

    while (cursorId && String(cursorId) !== "0"){
      const more = await this.command(
        { getMore: cursorId, collection, batchSize: opts.batchSize || 100 }, { db });
      docs.push(...(more.cursor.nextBatch || []));
      cursorId = more.cursor.id;
      if (!more.cursor.nextBatch || !more.cursor.nextBatch.length) break;
    }

    if (cursorId && String(cursorId) !== "0"){
      try { await this.command({ killCursors: collection, cursors: [cursorId] }, { db }); }
      catch { /* the server reaps it anyway */ }
    }

    return docs.map(toPlain);
  }

  /* --------------------------------------------------------------- setup -- */

  /**
   * Declare indexes. Idempotent: an index that already exists with the same
   * shape is a no-op, which is what makes "ensure indexes on boot" safe to run
   * on every start rather than once by hand.
   */
  async createIndexes(collection, indexes, opts = {}){
    if (!indexes.length) return 0;
    const reply = await this.command({ createIndexes: collection, indexes }, { db: opts.db });
    return reply.numIndexesAfter || 0;
  }

  async listIndexes(collection, opts = {}){
    try {
      const reply = await this.command({ listIndexes: collection }, { db: opts.db });
      return (reply.cursor.firstBatch || []).map(i => i.name);
    } catch {
      return [];   // no such collection yet — no indexes is the honest answer
    }
  }

  async listCollections(db){
    const reply = await this.command({ listCollections: 1, nameOnly: true }, { db: db || this.options.database });
    return (reply.cursor.firstBatch || []).map(c => c.name);
  }

  async ping(){
    await this.command({ ping: 1 }, { db: this.options.authSource });
    return true;
  }

  close(){
    if (this.conn) this.conn.destroy(new Error("Client closed."));
    this.conn = null;
  }
}
