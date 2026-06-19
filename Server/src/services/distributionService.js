// Server/src/services/distributionService.js
//
// The lead-distribution engine.
//
// What it does, in one pass per office:
//   1. ELIGIBILITY  — pulls the counsellors who currently cover the office
//                     (live from staff_office_assignments JOIN staff, honouring
//                     effective dates + is_active + distribution_enabled). Names
//                     are read live, so a rename/deactivation flows through.
//   2. STRATA       — orders the pool so high stone-tiers go first (untiered
//                     mass-upload leads all sit in one bucket). This spreads the
//                     good leads evenly before the rest fill in.
//   3. BALANCE      — assigns each lead to the eligible counsellor with the
//                     lowest NORMALISED load (active-in-office count ÷ weight).
//                     Weight is per-office, so Da Nang's 1.5 person trends to
//                     1.5× a peer; Hanoi's 1.5/0.5 split lands 75/25.
//   4. TRANCHE CAP  — each counsellor takes at most round(perHead × weight)
//                     leads this run (default perHead = 50). The rest stay in
//                     the pool for the next release.
//   5. CAPACITY     — a counsellor at their global capacity_cap is skipped.
//   6. WRITE + LOG  — sets students.counselor (live name) + distribution_status
//                     ='assigned', and writes one lead_distribution_log row per
//                     assignment (the "why did I get this lead" trail).
//
// Pass dryRun: true to compute the split WITHOUT writing — that's the preview.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Stone-tier processing priority (higher = distributed first so it spreads).
// Anything not listed (incl. NULL / '' from mass uploads) gets 0 = processed last.
const TIER_PRIORITY = { Diamond: 5, Sapphire: 4, Ruby: 3, Agate: 2, Quartz: 1 };
const tierRank = (t) => TIER_PRIORITY[(t || '').trim()] || 0;

// What counts as a counsellor's current "active" workload. Tunable in one place.
// Default: leads still marked status='Active' (deactivated/closed leads flip status).
const ACTIVE_STATUS_SQL = `COALESCE(status,'Active') = 'Active'`;

// ── Eligible counsellors currently covering an office ───────────────
async function getEligibleCounsellors(client, office) {
  const { rows } = await client.query(
    `SELECT s.id, s.full_name, s.capacity_cap, soa.weight
       FROM staff_office_assignments soa
       JOIN staff s ON s.id = soa.staff_id
      WHERE soa.office = $1
        AND soa.effective_from <= CURRENT_DATE
        AND (soa.effective_to IS NULL OR soa.effective_to >= CURRENT_DATE)
        AND s.is_active = TRUE
        AND s.distribution_enabled = TRUE`,
    [office]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    weight: Number(r.weight),
    capacityCap: r.capacity_cap == null ? null : Number(r.capacity_cap),
  }));
}

// Current active counts keyed by counsellor name.
//   inOffice = active leads they already hold IN this office (balancing base)
//   global   = active leads they hold across ALL offices (capacity-cap base)
async function getActiveCounts(client, office, names) {
  if (names.length === 0) return { inOffice: {}, global: {} };
  const inOffice = {};
  const global = {};
  const a = await client.query(
    `SELECT counselor, COUNT(*)::int AS cnt
       FROM students
      WHERE office = $1 AND counselor = ANY($2) AND ${ACTIVE_STATUS_SQL}
      GROUP BY counselor`,
    [office, names]
  );
  a.rows.forEach((r) => { inOffice[r.counselor] = r.cnt; });
  const g = await client.query(
    `SELECT counselor, COUNT(*)::int AS cnt
       FROM students
      WHERE counselor = ANY($1) AND ${ACTIVE_STATUS_SQL}
      GROUP BY counselor`,
    [names]
  );
  g.rows.forEach((r) => { global[r.counselor] = r.cnt; });
  return { inOffice, global };
}

// ── Core: release one tranche for one office ────────────────────────
// opts: { office, perHead = 50, source = 'upload', assignedBy = 'system', dryRun = false }
async function releaseTranche(opts) {
  const {
    office,
    perHead = 50,
    source = 'upload',
    assignedBy = 'system',
    dryRun = false,
  } = opts;

  if (!office) throw new Error('office is required');

  const client = await pool.connect();
  try {
    const counsellors = await getEligibleCounsellors(client, office);
    if (counsellors.length === 0) {
      return { office, released: 0, leftInPool: null,
        message: `No active counsellors currently cover "${office}".`, perCounsellor: [] };
    }

    const names = counsellors.map((c) => c.name);
    const { inOffice, global } = await getActiveCounts(client, office, names);

    // Pool for this office, ordered tier-high-first then oldest-first.
    const poolRes = await client.query(
      `SELECT unique_id, stone_tier, prev_counselor, created_at
         FROM students
        WHERE office = $1 AND distribution_status = 'pool'`,
      [office]
    );
    const poolLeads = poolRes.rows
      .map((r) => ({ uniqueId: r.unique_id, tier: r.stone_tier || null, prevCounsellor: r.prev_counselor || null, createdAt: r.created_at }))
      .sort((a, b) =>
        tierRank(b.tier) - tierRank(a.tier) ||
        new Date(a.createdAt) - new Date(b.createdAt) ||
        String(a.uniqueId).localeCompare(String(b.uniqueId))
      );

    // Per-counsellor run state.
    const state = counsellors.map((c) => ({
      ...c,
      base: inOffice[c.name] || 0,        // active-in-office at start
      globalBase: global[c.name] || 0,    // active-everywhere at start
      runCap: Math.round(perHead * c.weight),
      taken: 0,
    }));

    const assignments = [];
    for (const lead of poolLeads) {
      // Candidates: not at run cap, and not at global capacity cap.
      const candidates = state.filter((s) =>
        s.taken < s.runCap &&
        (s.capacityCap == null || (s.globalBase + s.taken) < s.capacityCap)
      );
      if (candidates.length === 0) break; // tranche full / everyone capped

      // Lowest normalised load wins; tie-break on fewer taken, then name.
      candidates.sort((a, b) => {
        const la = (a.base + a.taken) / a.weight;
        const lb = (b.base + b.taken) / b.weight;
        return la - lb || a.taken - b.taken || a.name.localeCompare(b.name);
      });
      const pick = candidates[0];
      const normLoad = (pick.base + pick.taken) / pick.weight;
      pick.taken += 1;
      assignments.push({
        uniqueId: lead.uniqueId,
        tier: lead.tier,
        prevCounsellor: lead.prevCounsellor,
        counsellor: pick.name,
        weight: pick.weight,
        normalizedLoad: Number(normLoad.toFixed(3)),
      });
    }

    const summary = {
      office,
      poolSize: poolLeads.length,
      released: assignments.length,
      leftInPool: poolLeads.length - assignments.length,
      dryRun,
      perCounsellor: state.map((s) => ({ name: s.name, weight: s.weight, assigned: s.taken })),
      tierMix: assignments.reduce((m, a) => {
        const k = a.tier || '(untiered)';
        m[k] = (m[k] || 0) + 1; return m;
      }, {}),
    };

    if (dryRun || assignments.length === 0) {
      return summary;
    }

    // ── Commit: assign + log, atomically ──
    const batchId = `${office.replace(/\s+/g, '')}-${Date.now()}`;
    await client.query('BEGIN');
    try {
      for (const a of assignments) {
        await client.query(
          `UPDATE students
              SET counselor = $1, distribution_status = 'assigned', prev_counselor = NULL, updated_at = NOW()
            WHERE unique_id = $2`,
          [a.counsellor, a.uniqueId]
        );
        await client.query(
          `INSERT INTO lead_distribution_log
             (unique_id, office, stone_tier, counselor, weight_at_assign,
              normalized_load, source, batch_id, assigned_by, from_counselor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [a.uniqueId, office, a.tier, a.counsellor, a.weight,
           a.normalizedLoad, (a.prevCounsellor ? 'reassign' : source), batchId, assignedBy, a.prevCounsellor || null]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    summary.batchId = batchId;
    return summary;
  } finally {
    client.release();
  }
}

// ── Reassignment: push a departing counsellor's open leads back to pool ──
// They keep their office + tier, so the next releaseTranche redistributes them
// (with source='reassign'). Returns how many were recalled.
async function recallCounsellorLeads(counsellorName, { dryRun = false } = {}) {
  const client = await pool.connect();
  try {
    const sel = await client.query(
      `SELECT unique_id, office FROM students
        WHERE counselor = $1 AND ${ACTIVE_STATUS_SQL}`,
      [counsellorName]
    );
    if (dryRun) return { counsellor: counsellorName, wouldRecall: sel.rowCount, dryRun: true };
    const upd = await client.query(
      `UPDATE students
          SET distribution_status = 'review', prev_counselor = counselor, counselor = '', updated_at = NOW()
        WHERE counselor = $1 AND ${ACTIVE_STATUS_SQL}`,
      [counsellorName]
    );
    return { counsellor: counsellorName, recalled: upd.rowCount };
  } finally {
    client.release();
  }
}

// ── Pool snapshot for dashboards / before a release ──
async function getPoolSummary() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT COALESCE(office,'(untagged)') AS office,
              COALESCE(NULLIF(stone_tier,''),'(untiered)') AS tier,
              COUNT(*)::int AS cnt
         FROM students
        WHERE distribution_status = 'pool'
        GROUP BY 1, 2
        ORDER BY 1, 2`
    );
    return rows;
  } finally {
    client.release();
  }
}

module.exports = { releaseTranche, recallCounsellorLeads, getPoolSummary, getEligibleCounsellors };
