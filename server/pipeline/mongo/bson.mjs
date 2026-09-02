/* ============================================================================
   bson.mjs — the slice of BSON this extension actually needs
   ----------------------------------------------------------------------------
   The project ships with no npm dependencies (see Dockerfile), and the driver
   would be the only one. What we do with Mongo is narrow — a handshake, a SCRAM
   exchange and `find` — so the wire format is implemented here instead.

   Encoded:  null, bool, number (int32 / int64 / double), string, Date, RegExp,
             BigInt, Buffer, Binary, ObjectId, array, object.
   Decoded:  the above plus timestamp, decimal128, min/max key, code, symbol,
             undefined and DBPointer, so a document from an unknown writer never
             throws — worst case a field arrives as a descriptive placeholder.

   Numbers come back as JS numbers. int64 values beyond Number.MAX_SAFE_INTEGER
   keep their precision as BigInt rather than silently rounding.
   ========================================================================== */

/* ------------------------------------------------------------------ types -- */

export class ObjectId {
  constructor(value){
    if (value == null){
      this.buffer = Buffer.alloc(12);
    } else if (Buffer.isBuffer(value)){
      this.buffer = Buffer.from(value.subarray(0, 12));
    } else if (typeof value === "string" && /^[0-9a-f]{24}$/i.test(value)){
      this.buffer = Buffer.from(value, "hex");
    } else {
      throw new TypeError("ObjectId takes 12 bytes or a 24-character hex string.");
    }
  }
  toHexString(){ return this.buffer.toString("hex"); }
  toString(){ return this.toHexString(); }
  toJSON(){ return this.toHexString(); }
  get [Symbol.toStringTag](){ return "ObjectId"; }
}

export class Binary {
  constructor(buffer, subType = 0){
    this.buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    this.subType = subType;
  }
  toString(enc = "base64"){ return this.buffer.toString(enc); }
  toJSON(){ return { $binary: this.buffer.toString("base64"), $type: this.subType }; }
}

export class Timestamp {
  constructor(low, high){ this.low = low >>> 0; this.high = high >>> 0; }
  toJSON(){ return { $timestamp: { t: this.high, i: this.low } }; }
}

/* ------------------------------------------------------------------ read -- */

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** Decode one BSON document starting at `offset`. */
export function deserialize(buf, offset = 0){
  const size = buf.readInt32LE(offset);
  if (size < 5 || offset + size > buf.length){
    throw new RangeError(`BSON document claims ${size} bytes, ${buf.length - offset} available.`);
  }
  return readDocument(buf, offset, offset + size, false);
}

function readDocument(buf, start, end, asArray){
  const out = asArray ? [] : {};
  let i = start + 4;

  while (i < end - 1){
    const type = buf[i++];
    const nameEnd = buf.indexOf(0, i);
    if (nameEnd < 0 || nameEnd >= end) throw new RangeError("Unterminated BSON field name.");
    const name = buf.toString("utf8", i, nameEnd);
    i = nameEnd + 1;

    const read = readValue(buf, i, type, end);
    if (asArray) out.push(read.value); else out[name] = read.value;
    i = read.next;
  }
  return out;
}

function readValue(buf, i, type, end){
  switch (type){
    case 0x01: return { value: buf.readDoubleLE(i), next: i + 8 };

    case 0x02: case 0x0D: case 0x0E: {          // string / code / symbol
      const len = buf.readInt32LE(i);
      return { value: buf.toString("utf8", i + 4, i + 4 + len - 1), next: i + 4 + len };
    }

    case 0x03: case 0x04: {                     // document / array
      const len = buf.readInt32LE(i);
      return { value: readDocument(buf, i, i + len, type === 0x04), next: i + len };
    }

    case 0x05: {                                // binary
      const len = buf.readInt32LE(i);
      const sub = buf[i + 4];
      // Subtype 2 carries a second, redundant length prefix.
      const from = sub === 0x02 ? i + 9 : i + 5;
      const to   = i + 5 + len;
      return { value: new Binary(Buffer.from(buf.subarray(from, to)), sub), next: to };
    }

    case 0x06: case 0x0A: return { value: null, next: i };           // undefined / null
    case 0x07: return { value: new ObjectId(buf.subarray(i, i + 12)), next: i + 12 };
    case 0x08: return { value: buf[i] === 1, next: i + 1 };
    case 0x09: return { value: new Date(Number(buf.readBigInt64LE(i))), next: i + 8 };

    case 0x0B: {                                // regex: two cstrings
      const pEnd = buf.indexOf(0, i);
      const fEnd = buf.indexOf(0, pEnd + 1);
      const source = buf.toString("utf8", i, pEnd);
      const flags  = buf.toString("utf8", pEnd + 1, fEnd).replace(/[^gimsuy]/g, "");
      let value;
      try { value = new RegExp(source, flags); } catch { value = { $regex: source, $options: flags }; }
      return { value, next: fEnd + 1 };
    }

    case 0x0C: {                                // DBPointer (deprecated)
      const len = buf.readInt32LE(i);
      const ns  = buf.toString("utf8", i + 4, i + 4 + len - 1);
      const id  = new ObjectId(buf.subarray(i + 4 + len, i + 4 + len + 12));
      return { value: { $ref: ns, $id: id }, next: i + 4 + len + 12 };
    }

    case 0x0F: {                                // code with scope
      const total = buf.readInt32LE(i);
      const cLen  = buf.readInt32LE(i + 4);
      const code  = buf.toString("utf8", i + 8, i + 8 + cLen - 1);
      const sOff  = i + 8 + cLen;
      const sLen  = buf.readInt32LE(sOff);
      return { value: { $code: code, $scope: readDocument(buf, sOff, sOff + sLen, false) }, next: i + total };
    }

    case 0x10: return { value: buf.readInt32LE(i), next: i + 4 };
    case 0x11: return { value: new Timestamp(buf.readUInt32LE(i), buf.readUInt32LE(i + 4)), next: i + 8 };

    case 0x12: {                                // int64 — precision beats type purity
      const n = buf.readBigInt64LE(i);
      const safe = n >= -9007199254740991n && n <= 9007199254740991n;
      return { value: safe ? Number(n) : n, next: i + 8 };
    }

    case 0x13: return { value: { $numberDecimal: decimalToString(buf.subarray(i, i + 16)) }, next: i + 16 };
    case 0xFF: return { value: { $minKey: 1 }, next: i };
    case 0x7F: return { value: { $maxKey: 1 }, next: i };

    default:
      throw new TypeError(`Unsupported BSON type 0x${type.toString(16)} at byte ${i} (document ends at ${end}).`);
  }
}

/** Decimal128 is never used by this data; keep the bytes rather than lose them. */
const decimalToString = bytes => `0x${Buffer.from(bytes).toString("hex")}`;

/* ----------------------------------------------------------------- write -- */

/** Encode a plain object as a BSON document. */
export function serialize(doc){
  return encodeDocument(doc, false);
}

function encodeDocument(doc, asArray){
  const parts = [];
  const entries = asArray
    ? doc.map((v, idx) => [String(idx), v])
    : Object.entries(doc);

  for (const [key, value] of entries){
    if (value === undefined) continue;      // Mongo has no "undefined" to send
    parts.push(encodeField(key, value));
  }

  const body = Buffer.concat(parts);
  const out  = Buffer.allocUnsafe(body.length + 5);
  out.writeInt32LE(out.length, 0);
  body.copy(out, 4);
  out[out.length - 1] = 0;
  return out;
}

const cstring = s => {
  const b = Buffer.from(String(s), "utf8");
  if (b.includes(0)) throw new TypeError(`BSON key "${s}" contains a null byte.`);
  return Buffer.concat([b, Buffer.from([0])]);
};

const header = (type, key) => Buffer.concat([Buffer.from([type]), cstring(key)]);

function encodeField(key, value){
  if (value === null) return header(0x0A, key);

  switch (typeof value){
    case "boolean":
      return Buffer.concat([header(0x08, key), Buffer.from([value ? 1 : 0])]);

    case "string": {
      const s = Buffer.from(value, "utf8");
      const b = Buffer.allocUnsafe(s.length + 5);
      b.writeInt32LE(s.length + 1, 0);
      s.copy(b, 4);
      b[b.length - 1] = 0;
      return Buffer.concat([header(0x02, key), b]);
    }

    case "number": {
      if (Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX){
        const b = Buffer.allocUnsafe(4); b.writeInt32LE(value, 0);
        return Buffer.concat([header(0x10, key), b]);
      }
      if (Number.isInteger(value) && Number.isSafeInteger(value)){
        const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt(value), 0);
        return Buffer.concat([header(0x12, key), b]);
      }
      const b = Buffer.allocUnsafe(8); b.writeDoubleLE(value, 0);
      return Buffer.concat([header(0x01, key), b]);
    }

    case "bigint": {
      const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(value, 0);
      return Buffer.concat([header(0x12, key), b]);
    }
  }

  if (value instanceof ObjectId) return Buffer.concat([header(0x07, key), value.buffer]);

  if (value instanceof Date){
    const b = Buffer.allocUnsafe(8); b.writeBigInt64LE(BigInt(value.getTime()), 0);
    return Buffer.concat([header(0x09, key), b]);
  }

  if (Buffer.isBuffer(value) || value instanceof Binary){
    const bin = value instanceof Binary ? value : new Binary(value, 0);
    const head = Buffer.allocUnsafe(5);
    head.writeInt32LE(bin.buffer.length, 0);
    head[4] = bin.subType;
    return Buffer.concat([header(0x05, key), head, bin.buffer]);
  }

  if (value instanceof RegExp){
    const flags = value.flags.split("").filter(f => "imsux".includes(f)).sort().join("");
    return Buffer.concat([header(0x0B, key), cstring(value.source), cstring(flags)]);
  }

  if (Array.isArray(value)) return Buffer.concat([header(0x04, key), encodeDocument(value, true)]);

  if (typeof value === "object") return Buffer.concat([header(0x03, key), encodeDocument(value, false)]);

  throw new TypeError(`Cannot encode ${typeof value} at key "${key}".`);
}

/* ------------------------------------------------------------------ plain -- */

/**
 * Strip the BSON wrappers so the result is ordinary JSON: ObjectId and Binary
 * become strings, Date becomes an ISO string, BigInt becomes a string. The
 * templates only ever read plain values, and a rendered page has to be
 * JSON.stringify-able for window.EDU_DATA.
 */
export function toPlain(value){
  if (value == null) return value;
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Binary) return value.toString("base64");
  if (value instanceof Timestamp) return value.toJSON();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof RegExp) return value.source;
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object"){
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}
