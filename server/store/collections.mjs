/* ============================================================================
   store/collections.mjs — the shape of the `activities` database
   ----------------------------------------------------------------------------
   Eight collections, and a deliberate absence.

   WHAT IS NOT HERE: schools, teachers, classrooms, students. None of them are
   ours. They belong to the partner platform, they arrive as parameters on the
   request that asks for a sheet, and they are stored as SNAPSHOTS embedded on
   the records below — `student: {id, name, classroom}` on the assignment that
   was issued, not a row in a roster we would then have to keep in step.

   That is not a shortcut. A sheet issued last term must keep the name that was
   printed on it even after the student is renamed, moved or removed, so the
   snapshot is the correct record and a foreign key would be the wrong one. And
   a roster we do not own is a roster we cannot keep true.

   WHAT IS HERE is everything this platform itself produces:

     documents     every sheet generated, with its questions AS PRINTED
     assignments   every link handed out: token, status, answer key
     link_events   every status change, and every refused open
     submissions   the answers exactly as they arrived
     analyses      what those answers mean
     groups        one sitting — the only grouping we own
     deliveries    every POST to the partner's backend, ok or not
     audit_log     what the system did

   Reading, and reading only, from the OTHER database (`ai`): questions,
   worksheets, summaries — the generator's lessons. That connection stays
   read-only, and nothing in this file touches it.
   ========================================================================== */

/** The collection names, in one place so a typo is a missing import. */
export const COLLECTIONS = {
  documents: "documents",
  assignments: "assignments",
  linkEvents: "link_events",
  submissions: "submissions",
  analyses: "analyses",
  groups: "groups",
  deliveries: "deliveries",
  audit: "audit_log"
};

/**
 * The indexes each collection needs, and why.
 *
 * Declared rather than created by hand so a fresh deployment, a restored dump
 * and a developer's laptop all end up with the same query plans. Applied on
 * boot by store.ensureIndexes(); createIndexes is idempotent, so an index that
 * already exists costs one round trip and changes nothing.
 *
 * `unique` is used where it is a RULE, not an optimisation: one submission per
 * assignment, one analysis per assignment. A second one could only be a bug or
 * a re-grade, and a re-grade replaces rather than appends.
 */
export const INDEXES = {

  [COLLECTIONS.documents]: [
    // "what have we built for this lesson" — the catalogue view
    { key: { document_idx: 1, type: 1 }, name: "lesson_type" },
    // the admin list, newest first
    { key: { built_at: -1 }, name: "built_at" },
    // "which sheets were personalised for this student"
    { key: { "student.id": 1 }, name: "student", sparse: true }
  ],

  [COLLECTIONS.assignments]: [
    // the dashboard's main query: one class, split by status
    { key: { group_id: 1, status: 1 }, name: "group_status" },
    // "what has this student been given", newest first
    { key: { "student.id": 1, created_at: -1 }, name: "student_recent" },
    // "who sat this lesson"
    { key: { document_idx: 1, created_at: -1 }, name: "lesson_recent" },
    // the link board, and the sweep that closes overdue links
    { key: { status: 1, created_at: -1 }, name: "status_recent" },
    { key: { expires_at: 1 }, name: "expiry", sparse: true }
  ],

  [COLLECTIONS.linkEvents]: [
    // one link's history, in order — the support question
    { key: { assignment_id: 1, at: 1 }, name: "assignment_at" },
    { key: { at: -1 }, name: "recent" }
  ],

  [COLLECTIONS.submissions]: [
    // The rule, not an optimisation: a link is single-use, so a second
    // submission for one assignment could only be a bug.
    { key: { assignment_id: 1 }, name: "assignment", unique: true },
    { key: { "student.id": 1, submitted_at: -1 }, name: "student_recent" },
    { key: { group_id: 1, submitted_at: -1 }, name: "group_recent" }
  ],

  [COLLECTIONS.analyses]: [
    { key: { assignment_id: 1 }, name: "assignment", unique: true },
    { key: { group_id: 1, created_at: -1 }, name: "group_recent" },
    { key: { "student.id": 1, created_at: -1 }, name: "student_recent" },
    // the item analysis and the goal roll-up both start here
    { key: { document_idx: 1, created_at: -1 }, name: "lesson_recent" }
  ],

  [COLLECTIONS.groups]: [
    { key: { document_idx: 1 }, name: "lesson" },
    { key: { updated_at: -1 }, name: "recent" }
  ],

  [COLLECTIONS.deliveries]: [
    { key: { analysis_id: 1 }, name: "analysis" },
    // the replay list: what never reached the backend
    { key: { ok: 1, attempted_at: -1 }, name: "outcome" }
  ],

  [COLLECTIONS.audit]: [
    { key: { entity_type: 1, entity_id: 1, at: -1 }, name: "entity" },
    { key: { at: -1 }, name: "recent" }
  ]
};

/** Every collection name, for the stats and setup commands. */
export const ALL = Object.values(COLLECTIONS);
