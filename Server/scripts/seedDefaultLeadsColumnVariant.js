// Seeds a default "leads" column layout for every active staff member who
// doesn't already have one of their own (confirmed 2026-08, mother's exact
// requested column set/order — see her list). user_variants is per-user
// (no shared/org-wide layout concept exists), so this is a one-time bulk
// seed rather than a code change; staff who've already customized their
// own default are left untouched.
//
// Usage:
//   node scripts/seedDefaultLeadsColumnVariant.js          — dry run (counts only)
//   node scripts/seedDefaultLeadsColumnVariant.js --apply  — actually inserts
require('dotenv').config();
const { Pool } = require('pg');

const apply = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || /railway|rlwy/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
});

// Explicit order, left-to-right, exactly as given (confirmed 2026-08).
// "Source (all)"/"Campaign (all)" expand to every field in that family —
// confirmed correct. "Status" (leadStatus) added back in — not on her
// original list, but confirmed to keep; placed next to Lead ID, its
// natural catalog position.
const KEEP_ORDER = [
  'studentId', 'leadId', 'leadStatus', 'createdAt', 'updatedAt', 'age', 'fullName', 'stoneTier', 'riskScore',
  'destinationCountry', 'budget',
  'source', 'sourceDetail', 'leadSource', 'referralSource',           // "Source (all)"
  'campaignType', 'campaignName', 'campaignStart', 'campaignEnd',     // "Campaign (all)"
  'studyPlans', 'ultimateObjective', 'timeline', 'residency', 'schoolAttended', 'yearOfBirth',
  'closeDate', 'confidence', 'actualCloseDate', 'cancellationDate',
  'counselor', 'presales',
  'personCreatedAt', 'personAssignedIn', 'personAssignedOut', 'assignedIn', 'assignedOut',
  'orderPhase',
];

(async () => {
  const catalogRes = await pool.query(`SELECT field_name FROM permission_fields WHERE column_width IS NOT NULL`);
  const allFields = catalogRes.rows.map(r => r.field_name);
  const missing = KEEP_ORDER.filter(k => !allFields.includes(k));
  if (missing.length) {
    console.error('These KEEP_ORDER keys do not exist in the catalog — aborting:', missing);
    process.exit(1);
  }

  const columnOrder = [...KEEP_ORDER, ...allFields.filter(k => !KEEP_ORDER.includes(k))];
  const columnVisibility = {};
  allFields.forEach(k => { if (!KEEP_ORDER.includes(k)) columnVisibility[k] = false; });

  const config = { columnOrder, columnVisibility, columnSizing: {} };

  const staffRes = await pool.query(`
    SELECT s.id, s.full_name FROM staff s
     WHERE s.is_active = true
       AND NOT EXISTS (SELECT 1 FROM user_variants uv WHERE uv.staff_id = s.id AND uv.page = 'leads')
     ORDER BY s.full_name
  `);
  console.log(`${staffRes.rows.length} active staff with no existing 'leads' variant.`);
  console.log(`Keeping ${KEEP_ORDER.length} of ${allFields.length} columns visible.`);

  if (!apply) {
    console.log('Dry run — pass --apply to actually create the variant for each of them.');
    console.log('Sample recipient:', staffRes.rows[0]?.full_name);
    await pool.end();
    return;
  }

  let created = 0;
  for (const s of staffRes.rows) {
    await pool.query(
      `INSERT INTO user_variants (staff_id, page, name, config, is_default)
       VALUES ($1, 'leads', 'Default', $2, true)`,
      [s.id, JSON.stringify(config)]
    );
    created++;
  }
  console.log(`Created ${created} default variants.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
