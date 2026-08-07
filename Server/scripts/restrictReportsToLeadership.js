// scripts/restrictReportsToLeadership.js
// ─────────────────────────────────────────────────────────────────────
// Per direct request: restrict the entire `reports` resource (Weekly,
// Monthly, Activity Report — every operation under resource='reports',
// not just 'view') to CEO / COO / Director / Manager. Admin is exempt
// on purpose — it's the IT team's own technical role, not a business
// position, and stripping it would lock IT out of their own tooling.
//
// Every other role currently holding some reports.* permission (Counselor,
// Pre-Sales, Lead roles, Staff Counsellor/Pre-sales/Case Officer, Manager
// Business Development/Products/Technical Support, Staff Data Quality/
// Technical Support) has those rows set to scope='none'. Rows are UPDATEd
// in place (not deleted) — matches the existing convention where 'none'
// is a normal, explicit scope value (see e.g. leads.delete = 'none' for
// most roles), not the absence of a row.
//
// Usage:
//   node scripts/restrictReportsToLeadership.js            # dry-run, prints planned diff
//   node scripts/restrictReportsToLeadership.js --apply     # commits
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

// Roles that keep whatever reports.* access they currently have.
const EXEMPT_ROLES = ['CEO', 'COO', 'Director', 'Manager', 'Admin'];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const client = await pool.connect();
  try {
    const toRestrict = await client.query(
      `SELECT role, operation, scope FROM role_permissions
        WHERE resource = 'reports' AND role != ALL($1) AND scope != 'none'
        ORDER BY role, operation`,
      [EXEMPT_ROLES]
    );

    console.log(`Roles kept as-is (exempt): ${EXEMPT_ROLES.join(', ')}\n`);
    console.log('Rows being restricted to scope=none:');
    console.log('─'.repeat(70));
    for (const r of toRestrict.rows) {
      console.log(`  ${r.role.padEnd(30)} reports.${r.operation.padEnd(10)} ${r.scope} → none`);
    }
    console.log('─'.repeat(70));
    console.log(`${toRestrict.rowCount} row(s) would change.\n`);

    if (!APPLY) {
      console.log('Dry-run — re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE role_permissions
          SET scope = 'none', updated_by = 'restrict_reports_to_leadership'
        WHERE resource = 'reports' AND role != ALL($1) AND scope != 'none'`,
      [EXEMPT_ROLES]
    );
    await client.query('COMMIT');
    console.log(`✓ ${result.rowCount} row(s) updated.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Failed, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
