// scripts/normalizeBlankLeadStatus.js
// ─────────────────────────────────────────────────────────────────────
// One-off data fix: every lead whose `lead_status` is blank/NULL is really
// a NEW lead — the whole app already DISPLAYS blank as "New" (the `|| 'New'`
// fallback in Dashboard.jsx / LeadDetail.jsx). This makes STORAGE match that
// display so the leads count correctly in reporting (status whitelist includes
// 'New') instead of falling through the blank gap.
//
// Scope: leads.lead_status IS NULL OR TRIM(lead_status) = ''  →  'New'.
// Owners/phases are left untouched (these already have a counsellor + phase).
//
// Going forward, a genuinely status-less lead is handled by PHASE (routed to
// Pool, kept off counsellor lists) — not by a blank-status reporting rule.
//
// Each change is written to audit_log (change_source='data_cleanup').
//
// Usage:
//   node scripts/normalizeBlankLeadStatus.js            # dry-run (default)
//   node scripts/normalizeBlankLeadStatus.js --apply    # commit the update
//
// Safe to re-run: once applied, a second run finds 0 rows.
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const SELECT = `
    SELECT l.lead_id, l.person_id, COALESCE(s.order_phase,'(null)') AS phase
      FROM leads l
      JOIN students s ON s.student_id = l.person_id
     WHERE l.lead_status IS NULL OR TRIM(l.lead_status) = ''
     ORDER BY s.order_phase, l.lead_id`;

  const rows = (await pool.query(SELECT)).rows;

  // Breakdown by phase, so it's clear where they land.
  const byPhase = rows.reduce((m, r) => (m[r.phase] = (m[r.phase] || 0) + 1, m), {});
  console.log(`\nBlank/NULL lead_status leads found: ${rows.length}`);
  Object.entries(byPhase).forEach(([p, n]) => console.log(`   ${p.padEnd(14)} ${n}`));

  if (rows.length === 0) {
    console.log('\nNothing to do — no blank statuses remain.');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — no changes written. Re-run with --apply to set these to "New".');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `UPDATE leads SET lead_status = 'New', updated_at = NOW() WHERE lead_id = $1`,
        [r.lead_id]);
      await client.query(
        `INSERT INTO audit_log
           (student_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
         VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
        [r.person_id, 'cleanup_script', 'leadStatus', '(blank)', 'New', 'data_cleanup']);
    }
    await client.query('COMMIT');
    console.log(`\n✓ ${rows.length} lead(s) set to "New" and logged to audit_log.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nFAILED — rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
