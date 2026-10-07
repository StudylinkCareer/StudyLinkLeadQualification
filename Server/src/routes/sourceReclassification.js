// server/src/routes/sourceReclassification.js
// ─────────────────────────────────────────────────────────────────────
// Manual reclassification tool for the ~100+ legacy free-text values still
// sitting in students.source_detail / students.referral_source after the
// Source of Lead restructure (see the plan). The spec calls this a manual,
// human-paced job — this turns "someone edits rows in SQL" into a bounded,
// auditable admin task instead.
//   GET  /api/source-reclassification/legacy-values
//        -> distinct values still found in source_detail/referral_source,
//           each with a student count + a few samples.
//   POST /api/source-reclassification/assign
//        -> bulk-reassigns every student currently holding one legacy value
//           to one of the 5 fixed Source-of-Lead buckets (+ sub-field),
//           logged to source_reclassification_log. Idempotent: after this
//           runs, the reassigned students no longer hold the old legacy
//           string in that column, so re-running the same assign is a no-op.
// Manager/Admin/Director only — same gate as referenceData.js.
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const { isManagerOrAdmin } = require('../utils/authProfiles');
function requireRole(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (!isManagerOrAdmin(req.session.staffRole)) return res.status(403).json({ success: false, error: 'Insufficient role' });
  next();
}

const COLUMNS = new Set(['source_detail', 'referral_source']);
const SAMPLE_LIMIT = 5;

// ── GET /legacy-values ────────────────────────────────────────────────
// One row per distinct (column, value) still in use, with a count and a
// few sample students so a reviewer can tell what the value actually means.
router.get('/legacy-values', requireRole, async (req, res) => {
  try {
    const out = [];
    for (const column of COLUMNS) {
      // Grouped and matched on btrim() throughout (list here, WHERE in /assign) so a
      // value shown with N samples is exactly the set /assign will reassign — no
      // "ABC" vs " ABC" split that would let one Apply silently touch students the
      // admin never reviewed. One query per column (not per distinct value): with
      // "~100+" legacy values expected, per-value round trips would make this page
      // slow every time it's opened during the manual reclassification pass.
      //
      // Also selects the row's own `source` column (pre-restructure, this held a
      // second, independent fact — e.g. source='WISE' + source_detail='<specific
      // partner school>' — that Phase 2's merge deliberately did NOT fold into
      // source_detail whenever source_detail was already non-empty, to avoid
      // clobbering it). Without surfacing it here, a reviewer reassigning a
      // source_detail legacy value has no way to see that co-occurring `source`
      // fact at all, and it would silently disappear the moment they hit Apply
      // (Apply overwrites this same column, but never touches `source` itself —
      // it's simply left orphaned and pointing at a bucket the new value no
      // longer matches). Surfacing it as `sourceBreakdown` lets a reviewer copy
      // that fact into `targetSourceDetail` if it's still worth keeping.
      // Skips students already handled (a log entry for this value whose target
      // matches their current Source of Lead, since detail text is often kept
      // as-is) and students still tagged Event/Campaign (handled separately).
      const { rows } = await pool.query(
        `SELECT s.student_id, s.full_name, btrim(s.${column}) AS value, s.source, s.created_at
           FROM students s
          WHERE s.${column} IS NOT NULL AND btrim(s.${column}) <> ''
            AND s.lead_source IS DISTINCT FROM 'Event/Campaign'
            AND NOT EXISTS (
                  SELECT 1 FROM source_reclassification_log l
                   WHERE l.source_column = $1 AND l.target_lead_source = s.lead_source
                     AND btrim(s.${column}) IN (btrim(l.legacy_value), btrim(COALESCE(l.target_source_detail, ''))))
          ORDER BY s.created_at DESC`,
        [column]
      );
      const byValue = new Map();
      for (const r of rows) {
        if (!byValue.has(r.value)) byValue.set(r.value, []);
        byValue.get(r.value).push(r);
      }
      for (const [value, group] of byValue) {
        const sourceCounts = new Map();
        for (const r of group) {
          const key = (r.source || '').trim() || null; // null = no co-occurring source value
          sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
        }
        const sourceBreakdown = [...sourceCounts.entries()]
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count);
        out.push({
          column,
          value,
          count: group.length,
          samples: group.slice(0, SAMPLE_LIMIT).map((s) => ({ studentId: s.student_id, fullName: s.full_name })),
          // Present only when at least one row actually has a non-empty `source`
          // — most legacy values will have none, and the UI shouldn't clutter
          // those with a breakdown of just `[{ source: null, count: N }]`.
          sourceBreakdown: sourceBreakdown.some((s) => s.source) ? sourceBreakdown : null,
        });
      }
    }
    out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    // Already-reclassified values (both columns cleared for every student that had
    // them) still show progress: how many distinct values have been handled so far.
    const done = await pool.query(`SELECT COUNT(DISTINCT (source_column, legacy_value)) AS n FROM source_reclassification_log`);
    res.json({ success: true, data: { values: out, reclassifiedCount: Number(done.rows[0].n) } });
  } catch (err) {
    console.error('[sourceReclassification] legacy-values failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load legacy values' });
  }
});

// ── POST /assign ──────────────────────────────────────────────────────
// Body: { column: 'source_detail'|'referral_source', value: <legacy string>,
//         targetLeadSource: <source_of_lead code>, targetSource?: <sub-value code>,
//         targetSourceDetail?: <typed text — partner name / referrer name> }
router.post('/assign', requireRole, async (req, res) => {
  const { column, value } = req.body || {};
  const targetLeadSource = (req.body.targetLeadSource || '').trim();
  const targetSource = (req.body.targetSource || '').trim() || null;
  const targetSourceDetail = (req.body.targetSourceDetail || '').trim() || null;

  if (!COLUMNS.has(column)) return res.status(400).json({ success: false, error: 'Invalid column' });
  if (!value || !String(value).trim()) return res.status(400).json({ success: false, error: 'value is required' });
  if (!targetLeadSource) return res.status(400).json({ success: false, error: 'targetLeadSource is required' });

  try {
    const sol = await pool.query(
      `SELECT 1 FROM lookup_values WHERE category='source_of_lead' AND code=$1 AND is_active=true`,
      [targetLeadSource]);
    if (!sol.rowCount) return res.status(400).json({ success: false, error: 'Unknown or inactive targetLeadSource' });

    if (targetSource) {
      const isB2b = targetLeadSource === 'B2B referrals';
      const check = await pool.query(
        isB2b
          ? `SELECT 1 FROM lookup_values WHERE category='b2b_type' AND code=$1 AND is_active=true`
          : `SELECT 1 FROM lookup_values WHERE category='source' AND subcategory=$2 AND code=$1 AND is_active=true`,
        isB2b ? [targetSource] : [targetSource, targetLeadSource]
      );
      if (!check.rowCount) return res.status(400).json({ success: false, error: 'Unknown or inactive targetSource for that Source of Lead' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Whichever column held the legacy value gets overwritten with the new
      // sub-field text (or cleared) — that's what makes re-running this a no-op.
      const upd = await client.query(
        `UPDATE students SET lead_source=$1, source=$2, ${column}=$3, updated_at=now()
          WHERE btrim(${column}) = $4 AND lead_source IS DISTINCT FROM 'Event/Campaign'`,
        // referral_source is NOT NULL DEFAULT '' on students.
        [targetLeadSource, targetSource, targetSourceDetail ?? (column === 'referral_source' ? '' : null), String(value).trim()]
      );
      await client.query(
        `INSERT INTO source_reclassification_log
           (source_column, legacy_value, target_lead_source, target_source, target_source_detail, leads_affected, applied_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [column, value, targetLeadSource, targetSource, targetSourceDetail, upd.rowCount,
         req.session.staffName || req.session.staffEmail || 'unknown']
      );
      await client.query('COMMIT');
      res.json({ success: true, data: { studentsAffected: upd.rowCount } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[sourceReclassification] assign failed:', err);
    res.status(500).json({ success: false, error: 'Failed to reassign' });
  }
});

module.exports = router;
