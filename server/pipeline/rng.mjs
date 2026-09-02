/* ============================================================================
   rng.mjs — the seed
   ----------------------------------------------------------------------------
   The endpoint promises that the same seed gives the same sheet and a different
   seed gives a different one. Math.random() cannot do that, so picking is done
   with a small seeded generator instead.

   Two properties the caller depends on:
     · same (seed, lesson, type) → byte-identical page, which is what makes the
       page cache correct rather than merely fast;
     · a seed change reshuffles every draw, not just the first, so sheet 2 does
       not open with the same three questions as sheet 1.
   ========================================================================== */

/** Hash any seed value — "3", 3, "spring-term" — into a 32-bit integer. */
export function seedFrom(value){
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(Math.trunc(value)) >>> 0;

  const s = String(value);
  const n = Number(s);
  if (s.trim() !== "" && Number.isFinite(n)) return Math.abs(Math.trunc(n)) >>> 0;

  // FNV-1a, so word seeds are spread instead of clustering on short strings.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, and good enough for choosing questions. */
export function makeRng(seed){
  let a = (seedFrom(seed) + 0x6d2b79f5) >>> 0;
  return function next(){
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator whose stream depends on the seed AND on which draw this is. */
export const streamFor = (seed, label) => makeRng(`${seedFrom(seed)}::${label}`);

/** Fisher–Yates on a copy. */
export function shuffle(list, rng){
  const out = [...(list || [])];
  for (let i = out.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Take up to `count` items, chosen by the seed.
 *
 *   null / undefined   no limit asked for — take everything
 *   0                  take none, because "count.true_false=0" can only mean
 *                      "leave true/false out"
 *   n                  up to n, or the whole pool if it holds fewer
 *
 * Defaults that mean "everything" therefore use null, never 0.
 */
export function sample(list, count, rng){
  const pool = (list || []).filter(Boolean);
  if (!pool.length) return [];
  if (count == null) return shuffle(pool, rng);
  if (count <= 0) return [];
  if (count >= pool.length) return shuffle(pool, rng);
  return shuffle(pool, rng).slice(0, count);
}

/**
 * Same as sample(), but the result keeps the order it had in the source array.
 * Used where the original sequence carries meaning (goals, ordered activities).
 *
 * The indices are shuffled directly rather than passed through sample(): its
 * filter(Boolean) would treat index 0 as empty and the first item could never
 * be picked.
 */
export function sampleInOrder(list, count, rng){
  const pool = (list || []).filter(Boolean);
  if (count == null || count >= pool.length) return pool;
  if (count <= 0) return [];

  const keep = new Set(shuffle(pool.map((_, i) => i), rng).slice(0, count));
  return pool.filter((_, i) => keep.has(i));
}

/** One item, or null for an empty list. */
export const pick = (list, rng) => {
  const pool = (list || []).filter(Boolean);
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
};
