// server/src/services/deepCleanseService.js
// ---------------------------------------------------------------------------
// Schema-adaptive "deep cleanse" core. Works on BOTH the OLD (pre-restructure)
// schema and the NEW (person/lead split) schema by DETECTING the live schema at
// runtime via information_schema — no hard-coded table/column assumptions.
//
//   OLD schema:  students (PK `unique_id`) conflates person + engagement.
//                Children key off the student id. NO `leads` / `duplicate_reviews`.
//   NEW schema:  students (PK `student_id`) = person; `leads` (person_id) =
//                engagement; `duplicate_reviews` present.
//
// SAFETY: this module never deletes unless the caller passes { apply: true }.
// Default is a DRY-RUN preview (per-table counts only). It is meant to run on
// PROD via an Admin-gated route — the operator must take a DB backup first.
// All deletes are transactional (BEGIN/COMMIT, ROLLBACK on any error).
// ---------------------------------------------------------------------------

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Candidate person-keyed child relationships. A relationship is used ONLY if its
// table AND column both exist in the live DB, so `leads` simply vanishes on the
// old schema. Some of these (e.g. audit_log) are intentionally NOT FK-enforced,
// which is why we keep an explicit list rather than auto-discovering FKs.
// `leads` is marked so it can be ordered LAST among children (its own child rows
// — notes/docs/audit keyed by lead_id — are removed via the student-id deletes
// above it, so the lead rows are then free to go).
const CHILD_CANDIDATES = [
  { table: 'audit_log',         col: 'student_id' },
  { table: 'documents',         col: 'student_id' },
  { table: 'student_notes',     col: 'student_id' },
  { table: 'lead_events',       col: 'student_id' },
  { table: 'event_attendees',   col: 'student_unique_id' },
  { table: 'event_desk_visits', col: 'student_unique_id' },
  { table: 'leads',             col: 'person_id', isLeads: true }, // new schema only
];

// duplicate_reviews is handled separately on a TARGETED delete (it references a
// student id), but it is EXCLUDED from the orphan sweep: its incoming_uid points
// at a parked, deliberately-not-yet-created person, so "not in students" is
// normal there — not an orphan.

async function tableExists(client, table) {
  const r = await client.query(`SELECT to_regclass('public.' || $1) AS t`, [table]);
  return !!r.rows[0].t;
}

async function columnExists(client, table, col) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, col]
  );
  return r.rowCount > 0;
}

// Inspect the live DB and build the cascade plan. Cheap (a handful of catalog
// lookups); run once per preview/delete.
async function detectSchema(client) {
  const newPk = await columnExists(client, 'students', 'student_id');
  const studentPk = newPk ? 'student_id' : 'unique_id';

  const children = [];
  for (const c of CHILD_CANDIDATES) {
    if ((await tableExists(client, c.table)) && (await columnExists(client, c.table, c.col))) {
      children.push(c);
    }
  }
  const hasLeads = await tableExists(client, 'leads');
  const hasDuplicateReviews = await tableExists(client, 'duplicate_reviews');

  return { schema: hasLeads ? 'new' : 'old', studentPk, children, hasLeads, hasDuplicateReviews };
}

function normalizeIds(studentIds) {
  return [...new Set((studentIds || []).map(s => String(s).trim()).filter(Boolean))];
}

// DRY-RUN: per-table row counts that WOULD be deleted for the given student ids.
async function previewByIds(studentIds) {
  const ids = normalizeIds(studentIds);
  if (!ids.length) return { schema: null, ids: [], counts: {}, students: 0 };

  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const counts = {};
    for (const c of plan.children) {
      const r = await client.query(`SELECT count(*)::int AS n FROM ${c.table} WHERE ${c.col} = ANY($1)`, [ids]);
      counts[c.table] = r.rows[0].n;
    }
    if (plan.hasDuplicateReviews) {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM duplicate_reviews
          WHERE incoming_uid = ANY($1) OR matched_ids && $1::text[]`, [ids]
      );
      counts.duplicate_reviews = r.rows[0].n;
    }
    const sr = await client.query(`SELECT count(*)::int AS n FROM students WHERE ${plan.studentPk} = ANY($1)`, [ids]);
    return { schema: plan.schema, studentPk: plan.studentPk, ids, counts, students: sr.rows[0].n };
  } finally {
    client.release();
  }
}

// CASCADE DELETE the given students + all dependents, FK-safe order, in a
// transaction. Returns the preview when apply!==true (no writes).
async function deleteByIds(studentIds, { apply = false } = {}) {
  const preview = await previewByIds(studentIds);
  if (!apply) return { applied: false, ...preview };
  if (!preview.ids.length) return { applied: false, reason: 'no_ids', ...preview };

  const ids = preview.ids;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await detectSchema(client);
    const deleted = {};

    // Person-keyed children first, with `leads` last among them (so lead-keyed
    // child rows are already gone before the lead rows themselves).
    const ordered = [...plan.children].sort((a, b) => (a.isLeads ? 1 : 0) - (b.isLeads ? 1 : 0));
    for (const c of ordered) {
      const r = await client.query(`DELETE FROM ${c.table} WHERE ${c.col} = ANY($1)`, [ids]);
      deleted[c.table] = r.rowCount;
    }
    if (plan.hasDuplicateReviews) {
      const r = await client.query(
        `DELETE FROM duplicate_reviews WHERE incoming_uid = ANY($1) OR matched_ids && $1::text[]`, [ids]
      );
      deleted.duplicate_reviews = r.rowCount;
    }
    const sr = await client.query(`DELETE FROM students WHERE ${plan.studentPk} = ANY($1)`, [ids]);
    deleted.students = sr.rowCount;

    await client.query('COMMIT');
    return { applied: true, schema: plan.schema, deleted, ids };
  } catch (err) {
    await client.query('ROLLBACK');
    return { applied: false, error: err.message, ids };
  } finally {
    client.release();
  }
}

// ── Orphan sweep ───────────────────────────────────────────────────────────
// Child rows whose student key no longer matches any students row (left behind
// by past deletions). Uses the DETECTED students PK, so it's correct on either
// schema. duplicate_reviews is deliberately NOT swept (parked persons).
async function findOrphans() {
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const counts = {};
    let total = 0;
    for (const c of plan.children) {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM ${c.table} x
          WHERE x.${c.col} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM students s WHERE s.${plan.studentPk} = x.${c.col})`
      );
      counts[c.table] = r.rows[0].n;
      total += r.rows[0].n;
    }
    return { schema: plan.schema, counts, total };
  } finally {
    client.release();
  }
}

// Distinct missing-student keys (the orphan "owners") with per-key row counts —
// drives the selectable list. Aggregated across all child tables.
async function findOrphanKeys({ limit = 2000 } = {}) {
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const byKey = new Map();
    for (const c of plan.children) {
      const r = await client.query(
        `SELECT x.${c.col} AS id, count(*)::int AS n FROM ${c.table} x
          WHERE x.${c.col} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM students s WHERE s.${plan.studentPk} = x.${c.col})
          GROUP BY x.${c.col}`
      );
      for (const row of r.rows) {
        const e = byKey.get(row.id) || { id: row.id, total: 0, tables: {} };
        e.tables[c.table] = row.n; e.total += row.n;
        byKey.set(row.id, e);
      }
    }
    const keys = [...byKey.values()].sort((a, b) => b.total - a.total).slice(0, limit);
    return { schema: plan.schema, count: byKey.size, keys };
  } finally {
    client.release();
  }
}

// Purge orphaned child rows. If `ids` (missing-student keys) is given, scope the
// purge to those owners; otherwise purge ALL orphans. Transactional; returns the
// (optionally scoped) count when apply!==true.
async function purgeOrphans({ apply = false, ids = null } = {}) {
  const keys = (Array.isArray(ids) && ids.length) ? [...new Set(ids.map(String))] : null;
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const cond = (c) =>
      `x.${c.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM students s WHERE s.${plan.studentPk} = x.${c.col})`
      + (keys ? ` AND x.${c.col} = ANY($1)` : '');
    const params = keys ? [keys] : [];

    const counts = {}; let total = 0;
    for (const c of plan.children) {
      const r = await client.query(`SELECT count(*)::int AS n FROM ${c.table} x WHERE ${cond(c)}`, params);
      counts[c.table] = r.rows[0].n; total += r.rows[0].n;
    }
    if (!apply) return { applied: false, schema: plan.schema, counts, total, scoped: !!keys };
    if (total === 0) return { applied: false, reason: 'nothing_to_purge', counts, total };

    await client.query('BEGIN');
    const purged = {};
    const ordered = [...plan.children].sort((a, b) => (a.isLeads ? 1 : 0) - (b.isLeads ? 1 : 0));
    for (const c of ordered) {
      const r = await client.query(`DELETE FROM ${c.table} x WHERE ${cond(c)}`, params);
      purged[c.table] = r.rowCount;
    }
    await client.query('COMMIT');
    return { applied: true, schema: plan.schema, purged, scoped: !!keys };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { applied: false, error: err.message };
  } finally {
    client.release();
  }
}

// ── Pattern match (drives "bulk test-data" + targeted pattern purge) ────────
// Returns students whose id matches a SQL LIKE pattern (e.g. 'TEST-UPLOAD-%').
// Caller feeds the resulting ids into previewByIds / deleteByIds.
async function findByPattern(pattern) {
  const p = String(pattern || '').trim();
  if (!p) return { schema: null, pattern: p, matches: [] };
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const r = await client.query(
      `SELECT ${plan.studentPk} AS id, full_name AS name
         FROM students WHERE ${plan.studentPk} LIKE $1
        ORDER BY ${plan.studentPk}`,
      [p]
    );
    return { schema: plan.schema, pattern: p, matches: r.rows };
  } finally {
    client.release();
  }
}

// ── Duplicate detection (by email or phone) ────────────────────────────────
// Groups persons sharing a normalized email/phone. Read-only — resolution is by
// deleting the unwanted member(s) via deleteByIds (auto-merge is a later add).
async function findDuplicates({ by = 'email' } = {}) {
  const col = by === 'phone' ? 'phone' : 'email';
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const r = await client.query(
      `SELECT lower(btrim(${col})) AS keyval,
              array_agg(${plan.studentPk} ORDER BY ${plan.studentPk}) AS ids,
              array_agg(COALESCE(full_name, '') ORDER BY ${plan.studentPk}) AS names,
              count(*)::int AS n
         FROM students
        WHERE ${col} IS NOT NULL AND btrim(${col}) <> ''
        GROUP BY lower(btrim(${col}))
       HAVING count(*) > 1
        ORDER BY count(*) DESC, keyval`
    );
    return { schema: plan.schema, by: col, groups: r.rows };
  } finally {
    client.release();
  }
}

// Convenience: detect schema with its own connection (for the UI status call).
async function schemaInfo() {
  const client = await pool.connect();
  try { return await detectSchema(client); }
  finally { client.release(); }
}

module.exports = {
  detectSchema, schemaInfo, normalizeIds, pool,
  previewByIds, deleteByIds,        // targeted (by id) — also the engine for pattern/dedupe
  findOrphans, findOrphanKeys, purgeOrphans,  // orphan sweep (+ selectable missing-student keys + scoped purge)
  findByPattern,                    // pattern → ids (test-data bulk purge)
  findDuplicates,                   // dedupe detection (resolve via deleteByIds)
};
