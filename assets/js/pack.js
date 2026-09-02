/* ============================================================================
   pack.js — encrypted lesson container (.wsx)
   ----------------------------------------------------------------------------
   Turns a worksheet object into an opaque binary blob and back:

     bytes = "WSX1" + 12-byte IV + AES-256-GCM ciphertext of the JSON

   The key is derived (SHA-256) from SEED below, which ships inside this file —
   so this is OBFUSCATION, not secrecy: it stops people from reading
   data/lessons/*.json off the server or out of the network tab, and any copy
   of the .wsx files is useless without also lifting the engine code. Someone
   who reads this source can decrypt. That trade-off is inherent to a static
   site; for real secrecy serve lessons from an API behind auth (config.apiBase).

   Runs in the browser AND in Node ≥18 (tools/pack-lessons.mjs imports it),
   so keep it free of DOM and node: imports.

   If you change SEED, re-run tools/pack-lessons.mjs — old .wsx files stop
   decrypting.
   ========================================================================== */

/* Split so the seed never appears as one greppable string in the bundle. */
const SEED = ["Pipeline", "Plus", "::", "wsx", "::", "9f2", "b7c", "41"].join("");

const MAGIC = new Uint8Array([0x57, 0x53, 0x58, 0x31]);   // "WSX1"
const IV_LEN = 12;

function subtle(){
  const c = globalThis.crypto;
  if (!c || !c.subtle){
    // Browsers only expose WebCrypto in secure contexts (https / localhost).
    throw new Error("WebCrypto unavailable — packed lessons need HTTPS or localhost");
  }
  return c;
}

async function deriveKey(usage){
  const c = subtle();
  const bits = await c.subtle.digest("SHA-256", new TextEncoder().encode(SEED));
  return c.subtle.importKey("raw", bits, "AES-GCM", false, [usage]);
}

/** Worksheet object -> .wsx bytes. Used by tools/pack-lessons.mjs. */
export async function pack(obj){
  const c = subtle();
  const iv = c.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey("encrypt");
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));

  const out = new Uint8Array(MAGIC.length + IV_LEN + cipher.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(cipher, MAGIC.length + IV_LEN);
  return out;
}

/** .wsx bytes (ArrayBuffer or Uint8Array) -> worksheet object. */
export async function unpack(buf){
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  for (let i = 0; i < MAGIC.length; i++){
    if (b[i] !== MAGIC[i]) throw new Error("Not a WSX1 container");
  }
  if (b.length < MAGIC.length + IV_LEN + 17) throw new Error("Truncated WSX1 container");

  const iv = b.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const cipher = b.subarray(MAGIC.length + IV_LEN);
  const key = await deriveKey("decrypt");

  let plain;
  try {
    plain = await subtle().subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  } catch {
    throw new Error("WSX1 decrypt failed — seed mismatch or corrupted file");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
