/* ============================================================================
   store/audit.mjs — who did what
   ----------------------------------------------------------------------------
   One generic record for every action worth being able to answer for later: a
   document built, a class issued, a sitting closed. Generic on purpose — a
   collection per action would be twenty collections nobody queries, and the
   question actually asked is always "what happened to THIS thing", which is one
   index on (entity_type, entity_id).

   Never throws. An audit record is worth less than the request it would
   otherwise fail, so a write that cannot happen is a warning on the log and
   nothing more.
   ========================================================================== */
import { store, db, now, newId, COLLECTIONS } from "./index.mjs";

const C = COLLECTIONS.audit;
const text = v => (v == null ? "" : String(v).trim());

/**
 * @param {object} entry
 *   action      "document.build", "assignment.issue", "group.close", …
 *   entityType  documents | assignments | groups | submissions | …
 *   entityId    the record it happened to
 *   actorType   system | teacher | student | api | tool
 *   actor       the caller as the partner platform described them — a snapshot
 */
export async function log(entry){
  try {
    await store().insertOne(C, {
      _id: newId("aud"),
      at: entry.at || now(),
      actor_type: text(entry.actorType) || "system",
      actor_id: text(entry.actorId),
      actor: entry.actor || null,
      action: text(entry.action),
      entity_type: text(entry.entityType),
      entity_id: text(entry.entityId),
      ip: text(entry.ip),
      detail: entry.detail || null
    }, { db: db() });
    return true;
  } catch (err){
    console.warn(`[store] audit not recorded: ${err.message}`);
    return false;
  }
}

/** The history of one thing, oldest first — which is how a story reads. */
export async function history(entityType, entityId, limit = 100){
  return store().find(C, { entity_type: text(entityType), entity_id: text(entityId) },
    { db: db(), sort: { at: 1 }, limit: Math.min(Number(limit) || 100, 1000) });
}

/** The tail of the log, newest first, optionally narrowed to one action. */
export async function recent(filter = {}){
  const query = {};
  if (filter.action) query.action = filter.action;
  if (filter.actorType) query.actor_type = filter.actorType;
  if (filter.entityType) query.entity_type = filter.entityType;

  return store().find(C, query,
    { db: db(), sort: { at: -1 }, limit: Math.min(Number(filter.limit) || 100, 1000) });
}
