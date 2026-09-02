/* ============================================================================
   sign.mjs — signed page links
   ----------------------------------------------------------------------------
   A page key is DERIVED from the request: <type>-<document_idx>-<seed>-<hash>.
   That is what makes the cache work, but it also means the key is not a secret.
   Anyone who knows a document_idx can compute the key for it, so an unsigned
   /t/<key> is effectively an open listing of every lesson in the database.

   With EDU_PIPELINE_PAGE_SECRET set, a link only opens if it carries an HMAC of
   its own key:

     /t/worksheet-43617-7-2204f3296d?e=1771234567&t=<base64url HMAC>

   The signature covers the key AND the expiry, so neither can be edited without
   invalidating the other. EDU_PIPELINE_LINK_TTL_MIN=0 issues links that do not
   expire; any positive value stamps `e` and the page stops opening after it.

   With no secret set, nothing is signed and pages stay open — the right default
   for a machine on a private network, the wrong one for a public host, which is
   why the deployed compose file sets a secret.
   ========================================================================== */
import crypto from "node:crypto";

import config from "./config.mjs";

export const signingEnabled = () => !!config.pageSecret;

/** HMAC over "<key>.<expiry>" — 0 for a link that never expires. */
const hmac = (key, expiry) =>
  crypto.createHmac("sha256", config.pageSecret)
    .update(`${key}.${expiry || 0}`)
    .digest("base64url");

/** Length-independent comparison, so a wrong guess leaks nothing by timing. */
function sameSecret(a, b){
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * The query parameters that make a link openable, or null when signing is off.
 * @returns {{t:string, e?:number}|null}
 */
export function pageToken(key){
  if (!config.pageSecret) return null;

  const expiry = config.linkTtlMs
    ? Math.floor((Date.now() + config.linkTtlMs) / 1000)
    : 0;

  return expiry ? { t: hmac(key, expiry), e: expiry } : { t: hmac(key, 0) };
}

/**
 * @returns {{ok:true} | {ok:false, reason:"missing"|"expired"|"invalid"}}
 */
export function verifyPageToken(key, token, expiry){
  if (!config.pageSecret) return { ok: true };
  if (!token) return { ok: false, reason: "missing" };

  let stamp = 0;
  if (expiry != null && expiry !== ""){
    stamp = Number(expiry);
    if (!Number.isFinite(stamp) || stamp < 0) return { ok: false, reason: "invalid" };
    if (stamp && stamp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  }

  return sameSecret(token, hmac(key, stamp))
    ? { ok: true }
    : { ok: false, reason: "invalid" };
}

/** Build "/t/<key>?t=…&e=…&embed=1" with the token first, extras appended. */
export function pageUrl(origin, prefix, key, extra){
  const params = new URLSearchParams();
  const token = pageToken(key);

  if (token){
    params.set("t", token.t);
    if (token.e) params.set("e", String(token.e));
  }
  for (const [k, v] of Object.entries(extra || {})) params.set(k, String(v));

  const query = params.toString();
  return `${origin}${prefix}/${key}${query ? `?${query}` : ""}`;
}
