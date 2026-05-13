// Server/src/services/simplify_field_permissions.js
//
// Migration: collapse the 5-category whitelist into "only contact details are
// restricted, everything else open to all roles."
//
// What this script does:
//   1. Moves 9 fields out of `personal_contact` into `other` (names, demographics,
//      flags, image URLs — things that aren't actually phone/email/social).
//   2. Resets the 9 moved fields' permissions to view/edit for all roles.
//   3. Fixes Admin's list permission on remaining personal_contact fields
//      (was 'view', now 'view_masked' so contact info is masked for ALL roles in
//      the list — matches the stated rule).
//   4. Opens up `financial`, `scoring`, `campaign` categories to view/edit for
//      all roles (they previously had per-category restrictions; now only
//      personal_contact stays locked down).
//
// Idempotent: re-running produces no further changes.
// Only touches rows where updated_by = 'system_seed', so any admin edits via a
// future Phase 5 UI are preserved.
//
// Final state:
//   - personal_contact (22 fields): masked in list for all roles; edit in
//     detail for Counselor (own) and Director; masked in detail for Manager and Admin.
//   - other / financial / scoring / campaign: view in list, edit in detail, all roles.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Fields to move OUT of personal_contact → into 'other'.
// These are not actually contact details: names, year-of-birth, residency
// province, preference flags, image URLs.
const FIELDS_TO_MOVE = [
  'fullName',
  'motherFullName',
  'fatherFullName',
  'yearOfBirth',
  'residency',
  'preferredSocial',
  'socialConsent',
  'headshotUrl',
  'qrCodeImageUrl',
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('═'.repeat(60));
    console.log('Permission simplification migration');
    console.log('═'.repeat(60));

    // ─── 0. Pre-flight: show what we're starting with ──────────
    const before = await client.query(`
      SELECT pf.category, COUNT(*) AS field_count
      FROM permission_fields pf
      GROUP BY pf.category
      ORDER BY pf.category
    `);
    console.log('\nBefore — fields per category:');
    before.rows.forEach(r => console.log(`  ${r.category.padEnd(20)} ${r.field_count}`));

    await client.query('BEGIN');

    // ─── 1. Recategorize the 9 fields → 'other' ─────────────────
    // permission_fields has no audit columns; only `category` is updated here.
    const move = await client.query(
      `UPDATE permission_fields
       SET category = 'other'
       WHERE field_name = ANY($1) AND category <> 'other'`,
      [FIELDS_TO_MOVE]
    );
    console.log(`\n[1] Recategorized ${move.rowCount} field(s) → 'other'`);

    // ─── 2. Reset those 9 fields' permissions to view/edit for all roles ──
    const reset = await client.query(
      `UPDATE role_field_permissions
       SET list_permission = 'view',
           detail_permission = 'edit'
       WHERE field_name = ANY($1)
         AND updated_by = 'system_seed'
         AND (list_permission <> 'view' OR detail_permission <> 'edit')`,
      [FIELDS_TO_MOVE]
    );
    console.log(`[2] Reset ${reset.rowCount} permission row(s) for moved fields`);

    // ─── 3. Admin list permission for personal_contact: view → view_masked ──
    // User spec: "Masked values in the Leads list for all roles" — so Admin's
    // current `view` needs to become `view_masked` to match the others.
    const adminMask = await client.query(
      `UPDATE role_field_permissions rfp
       SET list_permission = 'view_masked'
       FROM permission_fields pf
       WHERE rfp.field_name = pf.field_name
         AND pf.category = 'personal_contact'
         AND rfp.role = 'Admin'
         AND rfp.list_permission = 'view'
         AND rfp.updated_by = 'system_seed'`
    );
    console.log(`[3] Updated ${adminMask.rowCount} Admin row(s) on personal_contact: view → view_masked`);

    // ─── 4. Open up financial / scoring / campaign categories ─────
    // User decision: "only contact is restricted, everything else open to all."
    // Set all rows in these 3 categories to view (list) + edit (detail).
    const openUp = await client.query(
      `UPDATE role_field_permissions rfp
       SET list_permission = 'view',
           detail_permission = 'edit'
       FROM permission_fields pf
       WHERE rfp.field_name = pf.field_name
         AND pf.category IN ('financial', 'scoring', 'campaign')
         AND rfp.updated_by = 'system_seed'
         AND (rfp.list_permission <> 'view' OR rfp.detail_permission <> 'edit')`
    );
    console.log(`[4] Updated ${openUp.rowCount} permission row(s) in financial / scoring / campaign categories`);

    await client.query('COMMIT');

    // ─── 5. Post-flight verification ──────────────────────────
    const after = await client.query(`
      SELECT pf.category, COUNT(*) AS field_count
      FROM permission_fields pf
      GROUP BY pf.category
      ORDER BY pf.category
    `);
    console.log('\nAfter — fields per category:');
    after.rows.forEach(r => console.log(`  ${r.category.padEnd(20)} ${r.field_count}`));

    // Sanity check: every non-contact category should now be 100% view/edit
    const sanity = await client.query(`
      SELECT pf.category,
             COUNT(*) FILTER (WHERE rfp.list_permission   = 'view') AS list_view,
             COUNT(*) FILTER (WHERE rfp.detail_permission = 'edit') AS detail_edit,
             COUNT(*) AS total
      FROM permission_fields pf
      JOIN role_field_permissions rfp ON pf.field_name = rfp.field_name
      WHERE pf.category <> 'personal_contact'
      GROUP BY pf.category
      ORDER BY pf.category
    `);
    console.log('\nNon-contact categories (expect list_view = detail_edit = total):');
    sanity.rows.forEach(r =>
      console.log(`  ${r.category.padEnd(20)} list_view=${r.list_view}  detail_edit=${r.detail_edit}  total=${r.total}`)
    );

    // personal_contact final rules per role
    const contactRules = await client.query(`
      SELECT rfp.role,
             rfp.list_permission,
             rfp.detail_permission,
             COUNT(*) AS field_count
      FROM permission_fields pf
      JOIN role_field_permissions rfp ON pf.field_name = rfp.field_name
      WHERE pf.category = 'personal_contact'
      GROUP BY rfp.role, rfp.list_permission, rfp.detail_permission
      ORDER BY rfp.role
    `);
    console.log('\npersonal_contact rules by role:');
    contactRules.rows.forEach(r =>
      console.log(`  ${r.role.padEnd(12)} list=${r.list_permission.padEnd(12)} detail=${r.detail_permission.padEnd(12)} fields=${r.field_count}`)
    );

    console.log('\n✓ Migration complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Migration failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
