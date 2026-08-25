// Makes the Leads-LIST default (what "All leads" shows with no personal
// saved variant) company-wide, mirroring Hong Ha's (CEO, staff_id looked up
// below) personal "Default" user_variants view from 2026-08-19, plus this
// week's two extra moves (Name after Sales ID + Lead ID; Last Note after
// Age — neither existed in her original saved config, since Last Note
// didn't exist yet and the Name move is new).
//
// Two things happen, deliberately kept in ONE migration since they're the
// same request ("mirror the global default to her view + this week's
// changes") and share the same computed final order:
//
//   1. permission_fields.column_order — renumbered to her order, with
//      fullName moved after leadId and lastNoteAt inserted after age.
//   2. role_field_permissions — for every one of the ~37 fields her saved
//      columnVisibility marks hidden (email, phone, family contacts,
//      OCEAN, a handful of others), list_permission is set to 'none' for
//      EVERY role, company-wide. detail_permission is deliberately left
//      ALONE on any row that already exists — confirmed against prod that
//      email/phone already carry 'view_masked' detail rules for many
//      roles, and blindly overwriting detail_permission would silently
//      strip that masking on the Lead detail page. Only brand-new rows
//      (no existing permission at all for that role+field) get
//      detail_permission='edit', matching today's fallback default
//      exactly — so nothing about the detail page changes for anyone,
//      only the list.
//
// Also updates Hong Ha's own variant (found by CEO position + page='leads'
// + name='Default' + is_default=true, not a hardcoded id) so her personal
// view picks up the same two moves and stays consistent with the new
// global default instead of drifting from it.
//
// Idempotent: recomputes from the CURRENT variant config each run.
// Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/syncGlobalLeadsDefault.js
//   PROD: node src/migrations/syncGlobalLeadsDefault.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

function moveAfter(list, moving, anchor) {
  const withoutMoving = list.filter((f) => f !== moving);
  const anchorIdx = withoutMoving.indexOf(anchor);
  if (anchorIdx === -1) throw new Error(`Anchor field "${anchor}" not found`);
  withoutMoving.splice(anchorIdx + 1, 0, moving);
  return withoutMoving;
}

(async () => {
  console.log('Target DB host: ' + host);

  const variantRes = await pool.query(
    `SELECT uv.id, uv.config
       FROM user_variants uv
       JOIN staff s ON s.id = uv.staff_id
      WHERE s.position = 'CEO' AND uv.page = 'leads' AND uv.name = 'Default' AND uv.is_default = true
      LIMIT 1`
  );
  if (variantRes.rowCount === 0) {
    console.error('Could not find the CEO\'s "Default" leads variant — aborting, nothing changed.');
    process.exit(1);
  }
  const variantId = variantRes.rows[0].id;
  const cfg = variantRes.rows[0].config;
  const baseOrder = cfg.columnOrder;
  const hiddenFields = Object.entries(cfg.columnVisibility || {})
    .filter(([, visible]) => visible === false)
    .map(([field]) => field);
  console.log(`Found variant id=${variantId}: ${baseOrder.length} columns in saved order, ${hiddenFields.length} marked hidden.`);

  // Catalog fields the saved variant predates (e.g. lastNoteAt, added this
  // week) — append before the two explicit moves below reposition them.
  const catalogRes = await pool.query(`SELECT field_name FROM permission_fields WHERE column_width IS NOT NULL`);
  const allFields = catalogRes.rows.map((r) => r.field_name);
  let finalOrder = [...baseOrder];
  for (const f of allFields) if (!finalOrder.includes(f)) finalOrder.push(f);
  const droppedFromCatalog = baseOrder.filter((f) => !allFields.includes(f));
  if (droppedFromCatalog.length) console.log('Fields in the saved variant no longer in the catalog (skipped):', droppedFromCatalog);
  finalOrder = finalOrder.filter((f) => allFields.includes(f));

  // This week's two explicit moves.
  finalOrder = moveAfter(finalOrder, 'lastNoteAt', 'age');
  finalOrder = moveAfter(finalOrder, 'fullName', 'leadId');

  console.log(`Final order: ${finalOrder.length} columns. First 10:`, finalOrder.slice(0, 10));

  // ── 1. Renumber permission_fields.column_order ──────────────────────
  await pool.query('BEGIN');
  try {
    for (let i = 0; i < finalOrder.length; i++) {
      await pool.query(`UPDATE permission_fields SET column_order = $1 WHERE field_name = $2`, [i + 1, finalOrder[i]]);
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
  console.log(`[1] Renumbered ${finalOrder.length} permission_fields rows.`);

  // ── 2. Hide the ~37 fields from the LIST, for every role, company-wide ──
  const rolesRes = await pool.query(`SELECT DISTINCT role FROM role_permissions`);
  const roles = rolesRes.rows.map((r) => r.role);
  console.log(`Applying list_permission='none' for ${hiddenFields.length} fields x ${roles.length} roles = ${hiddenFields.length * roles.length} combinations...`);

  const upd = await pool.query(
    `INSERT INTO role_field_permissions (role, resource, field_name, list_permission, detail_permission, updated_by)
     SELECT r, 'leads', f, 'none', 'edit', 'migration:syncGlobalLeadsDefault'
       FROM unnest($1::text[]) AS r
       CROSS JOIN unnest($2::text[]) AS f
     ON CONFLICT (role, field_name) DO UPDATE
       SET list_permission = 'none', updated_by = EXCLUDED.updated_by
     RETURNING role, field_name`,
    [roles, hiddenFields]
  );
  console.log(`[2] Upserted ${upd.rowCount} role_field_permissions rows (list_permission='none'). detail_permission left untouched on any row that already existed.`);

  // ── 3. Sync Hong Ha's own variant to the same two moves ─────────────
  const newVariantConfig = { ...cfg, columnOrder: finalOrder };
  await pool.query(`UPDATE user_variants SET config = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(newVariantConfig), variantId]);
  console.log(`[3] Synced variant id=${variantId}'s columnOrder to the same final order (columnVisibility/columnSizing untouched).`);

  // ── Verification ──────────────────────────────────────────────────
  const check = await pool.query(
    `SELECT field_name, label, column_order FROM permission_fields WHERE column_width IS NOT NULL ORDER BY column_order LIMIT 10`
  );
  console.log('\nFirst 10 columns of the new global default:');
  check.rows.forEach((r) => console.log(`  ${r.column_order} ${r.field_name} (${r.label})`));

  const hiddenCheck = await pool.query(
    `SELECT COUNT(DISTINCT field_name)::int AS fields, COUNT(*)::int AS rows
       FROM role_field_permissions WHERE list_permission = 'none' AND resource = 'leads'`
  );
  console.log('\nFields now hidden from the list company-wide:', hiddenCheck.rows[0].fields, '| total role_field_permissions rows with list=none:', hiddenCheck.rows[0].rows);

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
