/* ============================================================================
   store/assignments.mjs — issued links, their sittings, and their history
   ----------------------------------------------------------------------------
   One record per sheet handed to one student, once. The lifecycle only ever
   moves forward:

     issued ──open──▶ issued ──submit──▶ submitted     (link dead)
        └───────────revoke / expire────▶ revoked / expired

   Nothing here reopens a dead link. "Give the student another go" means issuing
   a NEW assignment, which mints a new id and a new token — so an old link that
   leaks is worth nothing, and every attempt is its own record with its own
   result instead of one record quietly overwritten.

   THE STUDENT IS A SNAPSHOT. `student: {id, name, classroom, section}` is what
   the partner platform sent when the sheet was issued, embedded on the record.
   There is no student collection to join to and there should not be: a sheet
   issued last term must keep the name it was printed with, whatever the roster
   says today.

   THIS COLLECTION HOLDS THE ANSWER KEY AND THE LINK TOKEN. It is the reason the
   Mongo user for this database should not be shared with anything that only
   needs to read results.
   ========================================================================== */
import { store, db, now, newId, COLLECTIONS } from "./index.mjs";

const C = COLLECTIONS.assignments;
const GROUPS = COLLECTIONS.groups;
const EVENTS = COLLECTIONS.linkEvents;

const text = v => (v == null ? "" : String(v).trim());
const nullable = v => { const s = text(v); return s === "" ? null : s; };

/** One person, as the partner platform described them. Nothing is looked up. */
const snapshotStudent = student => (student && text(student.id || student.name))
  ? {
      id: text(student.id),
      name: text(student.name),
      classroom: text(student.classroom),
      section: text(student.section)
    }
  : null;

/** A school or a teacher, as the partner platform named them. Nothing is looked up. */
const snapshotParty = party => (party && text(party.id || party.name))
  ? { id: text(party.id), name: text(party.name) }
  : null;

/* ------------------------------------------------------------- the sitting -- */

/**
 * Make sure the group a sheet names exists, and fill in what this sheet knows
 * about it. Called on every issue, so a sitting grows its details from the
 * first sheet filed under it and nobody has to create one first.
 *
 * The classroom, the school and the teacher it carries are snapshots too —
 * whatever the caller sent, kept as sent.
 */
export async function ensureGroup(group, context = {}){
  const id = text(group && group.id);
  if (!id) return null;

  const at = now();

  await store().updateOne(GROUPS, { _id: id }, {
    $set: {
      name: text(group.name) || undefined,
      document_idx: text(context.documentIdx) || undefined,
      type: text(context.type) || undefined,
      seed: text(context.seed) || undefined,
      exam_date: context.examDate
        ? { iso: context.examDate.iso || null, text: text(context.examDate.text || context.examDate.iso) }
        : undefined,
      classroom: context.classroom || undefined,
      school: context.school || undefined,
      teacher: context.teacher || undefined,
      updated_at: at
    },
    $setOnInsert: { _id: id, status: "open", closed_at: null, closed_reason: "", created_at: at }
  }, { db: db(), upsert: true });

  return id;
}

export async function closeGroup(groupId, reason){
  const result = await store().updateOne(GROUPS, { _id: text(groupId) }, {
    $set: { status: "closed", closed_at: now(), closed_reason: text(reason), updated_at: now() }
  }, { db: db(), upsert: false });
  return result.matched > 0;
}

export async function getGroup(groupId){
  return store().findOne(GROUPS, { _id: text(groupId) }, { db: db() });
}

/**
 * The group index the dashboard opens with: one row per sitting, with the
 * counts that make it worth clicking into.
 *
 * An aggregation over assignments rather than a read of `groups`, because the
 * counts are the point and they live on the links, not on the sitting.
 */
export async function listGroups(filter = {}){
  const match = { group_id: { $ne: null } };
  if (filter.documentIdx || filter.document_idx) match.document_idx = String(filter.documentIdx || filter.document_idx);

  const rows = await store().aggregate(C, [
    { $match: match },
    { $group: {
      _id: "$group_id",
      group_name: { $last: "$group.name" },
      document_idx: { $first: "$document_idx" },
      lesson_title: { $last: "$lesson_title" },
      type: { $last: "$type" },
      issued: { $sum: 1 },
      submitted: { $sum: { $cond: [{ $eq: ["$status", "submitted"] }, 1, 0] } },
      pending: { $sum: { $cond: [{ $eq: ["$status", "issued"] }, 1, 0] } },
      closed: { $sum: { $cond: [{ $in: ["$status", ["revoked", "expired"]] }, 1, 0] } },
      students: { $addToSet: "$student.id" },
      created_at: { $min: "$created_at" },
      last_activity: { $max: { $ifNull: ["$submitted_at", { $ifNull: ["$opened_at", "$created_at"] }] } }
    } },
    { $project: {
      _id: 0, group_id: "$_id", group_name: 1, document_idx: 1, lesson_title: 1, type: 1,
      issued: 1, submitted: 1, pending: 1, closed: 1,
      students: { $size: "$students" },
      submission_rate: {
        $cond: [{ $gt: ["$issued", 0] },
          { $round: [{ $multiply: [{ $divide: ["$submitted", "$issued"] }, 100] }, 1] }, 0]
      },
      created_at: 1, last_activity: 1
    } },
    { $sort: { last_activity: -1 } }
  ], { db: db() });

  return rows;
}

/* ---------------------------------------------------- record ⇄ document ---- */

/** A stored document → the assignment record the pipeline passes around. */
export function toRecord(doc){
  if (!doc) return null;
  return {
    schema: "pipeline.assignment/1",
    id: doc._id,
    token: doc.token,
    status: doc.status,

    student: doc.student || null,
    studentId: (doc.student && doc.student.id) || "",
    group: doc.group || null,
    groupId: doc.group_id || "",
    school: doc.school || null,
    teacher: doc.teacher || null,
    teacherId: (doc.teacher && doc.teacher.id) || "",

    examDate: doc.exam_date || null,

    type: doc.type,
    documentIdx: doc.document_idx,
    lessonTitle: doc.lesson_title || "",
    title: doc.title || "",
    seed: doc.seed,
    pageKey: doc.document_id || "",
    request: doc.request || {},

    answerKey: doc.answer_key || [],
    goals: doc.goals || [],

    scoring: doc.scoring || "mastery",
    profile: doc.profile || null,

    createdAt: doc.created_at,
    expiresAt: doc.expires_at || null,
    openedAt: doc.opened_at || null,
    submittedAt: doc.submitted_at || null,
    revokedAt: doc.revoked_at || null,
    revokedReason: doc.revoked_reason || "",
    attempts: Number(doc.attempts) || 0
  };
}

/** …and back. */
function toDocument(record){
  return {
    _id: record.id,
    token: record.token,
    status: record.status,

    group_id: nullable(record.groupId),
    document_id: nullable(record.pageKey),
    document_idx: text(record.documentIdx),

    /* Snapshots, all four. Whatever the partner platform sent, kept as sent. */
    student: snapshotStudent(record.student),
    group: record.group ? { id: text(record.group.id), name: text(record.group.name) } : null,
    school: snapshotParty(record.school),
    teacher: snapshotParty(record.teacher)
      || (record.teacherId ? { id: text(record.teacherId), name: "" } : null),

    lesson_title: text(record.lessonTitle),
    title: text(record.title),
    type: text(record.type),
    scoring: record.scoring === "profile" ? "profile" : "mastery",
    seed: record.seed,
    exam_date: record.examDate || null,

    answer_key: record.answerKey || [],
    goals: record.goals || [],
    profile: record.profile || null,
    request: record.request || null,
    question_count: (record.answerKey || []).length,
    goal_count: (record.goals || []).length,

    attempts: Number(record.attempts) || 0,
    created_at: record.createdAt,
    expires_at: record.expiresAt || null,
    opened_at: record.openedAt || null,
    submitted_at: record.submittedAt || null,
    revoked_at: record.revokedAt || null,
    revoked_reason: text(record.revokedReason),
    updated_at: now()
  };
}

/* ------------------------------------------------------------------ write -- */

/**
 * Write an assignment record, new or changed. One entry point for both, because
 * the caller — answers/store.mjs — persists a whole record either way, and a
 * replace is the honest expression of that.
 */
export async function put(record, options = {}){
  const c = store();

  if (record.group && record.group.id){
    await ensureGroup(record.group, {
      documentIdx: record.documentIdx,
      type: record.type,
      seed: record.seed,
      examDate: record.examDate,
      school: snapshotParty(record.school),
      teacher: snapshotParty(record.teacher),
      classroom: options.classroom || null
    });
  }

  const existing = await c.findOne(C, { _id: record.id },
    { db: db(), projection: { status: 1, created_at: 1 } });

  const document = toDocument(record);
  if (existing && existing.created_at) document.created_at = existing.created_at;

  await c.replaceOne(C, { _id: record.id }, document, { db: db(), upsert: true });

  if (options.event){
    await logEvent({
      assignmentId: record.id,
      event: options.event,
      statusBefore: existing ? existing.status : "",
      statusAfter: record.status,
      reason: options.reason,
      ip: options.ip,
      userAgent: options.userAgent,
      detail: options.detail
    });
  }

  return record;
}

export async function remove(id){
  const c = store();
  await c.deleteMany(EVENTS, { assignment_id: text(id) }, { db: db() });
  return (await c.deleteOne(C, { _id: text(id) }, { db: db() })) > 0;
}

/* ------------------------------------------------------------------- read -- */

export async function get(id){
  return toRecord(await store().findOne(C, { _id: text(id) }, { db: db() }));
}

/**
 * Every assignment, newest first, narrowed by whatever the caller named.
 * Bounded — a term's worth of assignments is not a useful answer to anything.
 */
export async function list(filter = {}){
  const query = {};
  if (filter.studentId || filter.student_id) query["student.id"] = String(filter.studentId || filter.student_id);
  if (filter.groupId || filter.group_id) query.group_id = String(filter.groupId || filter.group_id);
  if (filter.documentIdx || filter.document_idx) query.document_idx = String(filter.documentIdx || filter.document_idx);
  if (filter.status) query.status = filter.status;
  if (filter.type) query.type = filter.type;

  const docs = await store().find(C, query, {
    db: db(),
    sort: { created_at: -1 },
    limit: Math.min(Number(filter.limit) || 500, 5000)
  });
  return docs.map(toRecord);
}

/**
 * The link board: status, student and result in one row — and never the answer
 * key or the token, which is why this is its own query rather than list() with
 * the caller trusted to drop fields.
 */
export async function board(filter = {}){
  const match = {};
  if (filter.groupId || filter.group_id) match.group_id = String(filter.groupId || filter.group_id);
  if (filter.studentId || filter.student_id) match["student.id"] = String(filter.studentId || filter.student_id);
  if (filter.documentIdx || filter.document_idx) match.document_idx = String(filter.documentIdx || filter.document_idx);
  if (filter.status) match.status = filter.status;

  return store().aggregate(C, [
    { $match: match },
    { $sort: { created_at: -1 } },
    { $limit: Math.min(Number(filter.limit) || 200, 2000) },
    { $lookup: {
      from: COLLECTIONS.analyses, localField: "_id", foreignField: "assignment_id", as: "result" } },
    { $project: {
      _id: 0,
      assignment_id: "$_id",
      status: 1,
      /* An expiry that has passed but was never swept still reads as "issued"
         on the record; the board is where a human looks, so it says expired. */
      effective_status: {
        $cond: [
          { $and: [{ $eq: ["$status", "issued"] },
                   { $ne: ["$expires_at", null] },
                   { $lte: ["$expires_at", now()] }] },
          "expired", "$status"
        ]
      },
      group_id: 1,
      group_name: "$group.name",
      student_id: "$student.id",
      student_name: "$student.name",
      classroom: "$student.classroom",
      document_idx: 1, lesson_title: 1, type: 1, scoring: 1,
      exam_date: 1, attempts: 1,
      created_at: 1, opened_at: 1, submitted_at: 1, revoked_at: 1, expires_at: 1,
      percentage: { $first: "$result.overall.percentage" },
      mastery: { $first: "$result.overall.mastery" },
      mastery_label: { $first: "$result.overall.mastery_label" }
    } }
  ], { db: db() });
}

/**
 * Close the links whose moment has passed.
 *
 * Nothing calls this on a timer: openable() computes the status at open time
 * anyway, so a student is never let in by a stale record. This exists so a
 * dashboard reads "expired" rather than "issued" for a link nobody will use.
 *
 * @returns {Promise<number>} how many were closed
 */
export async function expireOverdue(){
  const at = now();
  const c = store();

  const overdue = await c.find(C,
    { status: "issued", expires_at: { $ne: null, $lte: at } },
    { db: db(), projection: { _id: 1 }, limit: 1000 });

  if (!overdue.length) return 0;

  await c.updateMany(C, { _id: { $in: overdue.map(d => d._id) } },
    { $set: { status: "expired", updated_at: at } }, { db: db() });

  await c.insertMany(EVENTS, overdue.map(d => ({
    _id: newId("lev"),
    assignment_id: d._id,
    event: "expired",
    status_before: "issued",
    status_after: "expired",
    reason: "ttl reached",
    at
  })), { db: db() });

  return overdue.length;
}

/* ----------------------------------------------------------------- events -- */

/**
 * One line of a link's history. Never throws: an audit record is worth less
 * than the request it would otherwise fail.
 */
export async function logEvent(input){
  try {
    await store().insertOne(EVENTS, {
      _id: newId("lev"),
      assignment_id: text(input.assignmentId),
      event: text(input.event),
      status_before: text(input.statusBefore),
      status_after: text(input.statusAfter),
      reason: text(input.reason),
      ip: text(input.ip),
      user_agent: text(input.userAgent).slice(0, 300),
      detail: input.detail || null,
      at: input.at || now()
    }, { db: db() });
    return true;
  } catch (err){
    console.warn(`[store] link event not recorded: ${err.message}`);
    return false;
  }
}

export async function events(assignmentId){
  return store().find(EVENTS, { assignment_id: text(assignmentId) },
    { db: db(), sort: { at: 1 }, limit: 200 });
}
