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

// ── Search (drives "bulk test-data" + targeted purge selection) ─────────────
// Case-insensitive, partial-word search across the student id, full name, email
// and phone — no wildcards required. The user can type "joyce", "20260617",
// "@gmail" or "0915" and get hits. If they DO include SQL wildcards (% or _) the
// term is used verbatim (advanced patterns like 'TEST-UPLOAD-%' still work);
// otherwise it's auto-wrapped to %term% so any substring matches. Caller feeds
// the resulting ids into previewByIds / deleteByIds.
async function findByPattern(pattern, { limit = 500 } = {}) {
  const raw = String(pattern || '').trim();
  if (!raw) return { schema: null, pattern: raw, matches: [] };
  const q = /[%_]/.test(raw) ? raw : `%${raw}%`;
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    const r = await client.query(
      `SELECT ${plan.studentPk} AS id, full_name AS name, email, phone
         FROM students
        WHERE ${plan.studentPk}::text ILIKE $1
           OR full_name ILIKE $1
           OR email     ILIKE $1
           OR phone     ILIKE $1
        ORDER BY full_name NULLS LAST, ${plan.studentPk}
        LIMIT $2`,
      [q, limit]
    );
    return { schema: plan.schema, pattern: raw, matches: r.rows };
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

// ── Lead-level (single-Lead) delete ─────────────────────────────────────────
// Removes a SPECIFIC lead (engagement) WITHOUT touching its Sales record, the
// other leads on that record, or Sales-level children. Only rows tied to THIS
// lead_id go: the `leads` row itself, plus audit_log / documents / student_notes
// / phase_transfer_exceptions rows carrying that lead_id. Rows with a NULL lead_id
// (Sales-level notes/docs), lead_events, order_assignments and the students row
// are all left intact — so a Sales record with several leads keeps the rest, and
// if this was its last active lead the connected-unit model just auto-Pools it.
const LEAD_CHILD_CANDIDATES = [
  { table: 'audit_log',                 col: 'lead_id' },
  { table: 'documents',                 col: 'lead_id' },
  { table: 'student_notes',             col: 'lead_id' },
  { table: 'phase_transfer_exceptions', col: 'lead_id' },
];

// Lead ids are integer/bigint PKs — keep only positive-integer strings.
function normalizeLeadIds(leadIds) {
  return [...new Set((leadIds || []).map(s => String(s).trim()).filter(s => /^\d+$/.test(s)))];
}

async function detectLeadPlan(client) {
  const hasLeads = await tableExists(client, 'leads');
  const children = [];
  if (hasLeads) {
    for (const c of LEAD_CHILD_CANDIDATES) {
      if ((await tableExists(client, c.table)) && (await columnExists(client, c.table, c.col))) children.push(c);
    }
  }
  return { hasLeads, children };
}

// DRY-RUN: per-table lead-scoped row counts that WOULD be deleted for these leads.
async function previewByLeadIds(leadIds) {
  const ids = normalizeLeadIds(leadIds);
  if (!ids.length) return { ids: [], counts: {}, leads: 0 };
  const client = await pool.connect();
  try {
    const plan = await detectLeadPlan(client);
    if (!plan.hasLeads) return { ids, counts: {}, leads: 0, reason: 'no_leads_table' };
    const counts = {};
    for (const c of plan.children) {
      const r = await client.query(`SELECT count(*)::int AS n FROM ${c.table} WHERE ${c.col} = ANY($1::bigint[])`, [ids]);
      counts[c.table] = r.rows[0].n;
    }
    const lr = await client.query(`SELECT count(*)::int AS n FROM leads WHERE lead_id = ANY($1::bigint[])`, [ids]);
    return { ids, counts, leads: lr.rows[0].n };
  } finally {
    client.release();
  }
}

// DELETE the given leads + their lead-scoped children, transactionally. Children
// first, then the lead rows. Returns the preview when apply!==true (no writes).
async function deleteByLeadIds(leadIds, { apply = false } = {}) {
  const preview = await previewByLeadIds(leadIds);
  if (!apply) return { applied: false, ...preview };
  if (!preview.ids.length) return { applied: false, reason: 'no_ids', ...preview };
  if (preview.leads === 0) return { applied: false, reason: 'no_matching_leads', ...preview };

  const ids = preview.ids;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await detectLeadPlan(client);
    const deleted = {};
    for (const c of plan.children) {
      const r = await client.query(`DELETE FROM ${c.table} WHERE ${c.col} = ANY($1::bigint[])`, [ids]);
      deleted[c.table] = r.rowCount;
    }
    const lr = await client.query(`DELETE FROM leads WHERE lead_id = ANY($1::bigint[])`, [ids]);
    deleted.leads = lr.rowCount;
    await client.query('COMMIT');
    return { applied: true, deleted, ids };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return { applied: false, error: err.message, ids };
  } finally {
    client.release();
  }
}

// Search LEADS (not Sales records) — joins each lead to its Sales record for the
// person's name/email/phone, plus the lead's own id, Sales id and status. Same
// substring/wildcard behaviour as findByPattern. New schema only (leads table).
async function findLeadsByPattern(pattern, { limit = 500 } = {}) {
  const raw = String(pattern || '').trim();
  if (!raw) return { pattern: raw, matches: [] };
  const q = /[%_]/.test(raw) ? raw : `%${raw}%`;
  const client = await pool.connect();
  try {
    const plan = await detectSchema(client);
    if (plan.schema !== 'new') return { pattern: raw, matches: [], reason: 'no_leads_schema' };
    const r = await client.query(
      `SELECT l.lead_id AS lead_id, l.person_id AS student_id, l.lead_status AS status,
              s.full_name AS name, s.email, s.phone
         FROM leads l
         LEFT JOIN students s ON s.${plan.studentPk} = l.person_id
        WHERE l.lead_id::text ILIKE $1
           OR l.person_id::text ILIKE $1
           OR s.full_name ILIKE $1
           OR s.email     ILIKE $1
           OR s.phone     ILIKE $1
        ORDER BY s.full_name NULLS LAST, l.lead_id
        LIMIT $2`,
      [q, limit]
    );
    return { pattern: raw, matches: r.rows };
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
  previewByIds, deleteByIds,        // targeted (by Sales id) — also the engine for pattern/dedupe
  previewByLeadIds, deleteByLeadIds, findLeadsByPattern,  // lead-level (single Lead) delete + search
  findOrphans, findOrphanKeys, purgeOrphans,  // orphan sweep (+ selectable missing-student keys + scoped purge)
  findByPattern,                    // pattern → ids (test-data bulk purge)
  findDuplicates,                   // dedupe detection (resolve via deleteByIds)
};
