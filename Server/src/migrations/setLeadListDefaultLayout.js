// server/src/migrations/setLeadListDefaultLayout.js
//
// FINAL Leads-list column layout (user-approved sequence, 2026-07-11). One step:
//   1. ENSURE the 4 assignment columns exist (they live only in order_assignments;
//      surfaced per lead by searchLeads): Case Officer, Quality, Tech Support,
//      Business Development.
//   2. REMOVE the eliminated Sr. Counselor column.
//   3. APPLY the approved order (column_order) + grouping (category) to all 74
//      Leads-list columns. `category` drives the collapsible groups in the Column
//      Settings page; `column_order` drives the left-to-right table sequence.
//
// This supersedes the interim addCaseOfficerToColumnCatalog / addRecipientPositionColumns
// migrations — it is the single catalog step for the PROD cutover.
//
// SAFETY: localhost-guarded, transaction-wrapped, idempotent.
//   --reset removes the 4 assignment columns and restores Sr. Counselor. (It does
//   NOT restore the pre-existing order/category of the other columns — the forward
//   layout is the intended state; re-run forward to re-apply.)
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/setLeadListDefaultLayout.js
//   node src/migrations/setLeadListDefaultLayout.js --reset
//   (append --allow-remote at the PROD cutover)

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
// Saved per-role layouts (column_config screen='leads%') OVERRIDE the catalog
// default. After the column set changes they are stale, so by default we clear
// them so every role falls back to this new default. Pass --keep-saved to leave
// existing per-role customisations in place (they will be a stale hybrid).
const KEEP_SAVED   = ARGS.includes('--keep-saved');

// Assignment columns that must exist (order_assignments-only positions). Their
// order/category are set by LAYOUT below; width/label seed a fresh INSERT.
const ENSURE = [
  { field: 'caseOfficer',         label: 'Case Officer',         width: 140 },
  { field: 'quality',             label: 'Quality',              width: 130 },
  { field: 'techSupport',         label: 'Tech Support',         width: 130 },
  { field: 'businessDevelopment', label: 'Business Development', width: 160 },
];
const REMOVE = { field: 'seniorCounselor', label: 'Sr. Counselor', width: 130, order: 21, category: 'other' };

// Approved layout: field → { order (left-to-right), category (Column-Settings group) }.
const LAYOUT = [
  { field:'studentId', order:1, category:'Identification and Contact' },
  { field:'fullName', order:2, category:'Identification and Contact' },
  { field:'stoneTier', order:3, category:'Identification and Contact' },
  { field:'riskScore', order:4, category:'Identification and Contact' },
  { field:'leadId', order:5, category:'Identification and Contact' },
  { field:'leadStatus', order:6, category:'Identification and Contact' },
  { field:'createdAt', order:7, category:'Identification and Contact' },
  { field:'updatedAt', order:8, category:'Identification and Contact' },
  { field:'email', order:9, category:'Identification and Contact' },
  { field:'phone', order:10, category:'Identification and Contact' },
  { field:'preferredSocial', order:11, category:'Identification and Contact' },
  { field:'interaction', order:12, category:'Identification and Contact' },
  { field:'ultimateObjective', order:13, category:'Study Index' },
  { field:'destinationCountry', order:14, category:'Study Index' },
  { field:'targetInstitution', order:15, category:'Study Index' },
  { field:'studyPlans', order:16, category:'Study Index' },
  { field:'studyPlanGap', order:17, category:'Study Index' },
  { field:'immigrationHistory', order:18, category:'Study Index' },
  { field:'degreeLevel', order:19, category:'Study Index' },
  { field:'major', order:20, category:'Study Index' },
  { field:'timeline', order:21, category:'Study Index' },
  { field:'intake', order:22, category:'Study Index' },
  { field:'rationale', order:23, category:'Study Index' },
  { field:'gpa', order:24, category:'Study Index' },
  { field:'englishLevel', order:25, category:'Study Index' },
  { field:'budget', order:26, category:'Study Index' },
  { field:'scholarshipDemand', order:27, category:'Study Index' },
  { field:'sponsorIncome', order:28, category:'Study Index' },
  { field:'incomeEvidence', order:29, category:'Study Index' },
  { field:'ward', order:30, category:'Personal history' },
  { field:'residency', order:31, category:'Personal history' },
  { field:'schoolAttended', order:32, category:'Personal history' },
  { field:'yearOfBirth', order:33, category:'Personal history' },
  { field:'age', order:34, category:'Personal history' },
  { field:'socialConsent', order:35, category:'Consent' },
  { field:'oceanExtraversion', order:36, category:'Personality test' },
  { field:'oceanAgreeableness', order:37, category:'Personality test' },
  { field:'oceanConscientiousness', order:38, category:'Personality test' },
  { field:'oceanNeuroticism', order:39, category:'Personality test' },
  { field:'oceanOpenness', order:40, category:'Personality test' },
  { field:'personCreatedAt', order:41, category:'Key Dates' },
  { field:'personUpdatedAt', order:42, category:'Key Dates' },
  { field:'personAssignedIn', order:43, category:'Key Dates' },
  { field:'personAssignedOut', order:44, category:'Key Dates' },
  { field:'assignedIn', order:45, category:'Key Dates' },
  { field:'assignedOut', order:46, category:'Key Dates' },
  { field:'closeDate', order:47, category:'Key Dates' },
  { field:'confidence', order:48, category:'Key Dates' },
  { field:'actualCloseDate', order:49, category:'Key Dates' },
  { field:'cancellationDate', order:50, category:'Key Dates' },
  { field:'businessDevelopment', order:51, category:'StudyLink Staff' },
  { field:'marketingStaff', order:52, category:'StudyLink Staff' },
  { field:'counselor', order:53, category:'StudyLink Staff' },
  { field:'presales', order:54, category:'StudyLink Staff' },
  { field:'quality', order:55, category:'StudyLink Staff' },
  { field:'techSupport', order:56, category:'StudyLink Staff' },
  { field:'caseOfficer', order:57, category:'StudyLink Staff' },
  { field:'campaignType', order:58, category:'Marketing research' },
  { field:'campaignName', order:59, category:'Marketing research' },
  { field:'campaignStart', order:60, category:'Marketing research' },
  { field:'campaignEnd', order:61, category:'Marketing research' },
  { field:'source', order:62, category:'Marketing research' },
  { field:'sourceDetail', order:63, category:'Marketing research' },
  { field:'leadSource', order:64, category:'Marketing research' },
  { field:'referralSource', order:65, category:'Marketing research' },
  { field:'motherFullName', order:66, category:'Family contacts' },
  { field:'motherEmail', order:67, category:'Family contacts' },
  { field:'motherPhone', order:68, category:'Family contacts' },
  { field:'motherContactMedium', order:69, category:'Family contacts' },
  { field:'fatherFullName', order:70, category:'Family contacts' },
  { field:'fatherEmail', order:71, category:'Family contacts' },
  { field:'fatherPhone', order:72, category:'Family contacts' },
  { field:'fatherContactMedium', order:73, category:'Family contacts' },
  { field:'orderPhase', order:74, category:'Sales Order' },
];

function hostOf(url) { const m = /@([^:@/]+)(?::\d+)?\//.exec(url || ''); return m ? m[1] : '(unparseable)'; }

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${RESET ? 'RESET' : 'APPLY final layout'}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  const exists = async (f) => (await client.query(`SELECT id FROM permission_fields WHERE resource='leads' AND field_name=$1 LIMIT 1`, [f])).rows[0];
  try {
    await client.query('BEGIN');
    if (!(await client.query(`SELECT to_regclass('public.permission_fields') AS t`)).rows[0].t) throw new Error('permission_fields missing.');

    if (RESET) {
      const del = await client.query(`DELETE FROM permission_fields WHERE resource='leads' AND field_name = ANY($1)`, [ENSURE.map(e => e.field)]);
      console.log(`removed ${del.rowCount} assignment column(s)`);
      if (!(await exists(REMOVE.field))) {
        await client.query(`INSERT INTO permission_fields (resource, field_name, category, label, column_width, column_order) VALUES ('leads',$1,$2,$3,$4,$5)`,
          [REMOVE.field, REMOVE.category, REMOVE.label, REMOVE.width, REMOVE.order]);
        console.log(`restored ${REMOVE.field}`);
      }
    } else {
      // 1. Ensure the 4 assignment columns exist (INSERT missing; order/category set in step 3).
      for (const e of ENSURE) {
        if (!(await exists(e.field))) {
          const spec = LAYOUT.find(l => l.field === e.field);
          await client.query(`INSERT INTO permission_fields (resource, field_name, category, label, column_width, column_order) VALUES ('leads',$1,$2,$3,$4,$5)`,
            [e.field, spec.category, e.label, e.width, spec.order]);
          console.log(`+ inserted ${e.field}`);
        }
      }
      // 2. Remove Sr. Counselor.
      const del = await client.query(`DELETE FROM permission_fields WHERE resource='leads' AND field_name=$1`, [REMOVE.field]);
      console.log(`- removed ${REMOVE.field}: ${del.rowCount} row(s)`);
      // 3. Apply order + category to all 74.
      const missing = [];
      for (const l of LAYOUT) {
        const r = await client.query(`UPDATE permission_fields SET column_order=$1, category=$2 WHERE resource='leads' AND field_name=$3`,
          [l.order, l.category, l.field]);
        if (r.rowCount === 0) missing.push(l.field);
      }
      if (missing.length) throw new Error(`Layout references fields not in catalog: ${missing.join(', ')}`);
      console.log(`applied order + category to ${LAYOUT.length} columns`);
      // 4. Clear stale saved per-role layouts so the new default takes effect for all.
      if (!KEEP_SAVED && (await client.query(`SELECT to_regclass('public.column_config') t`)).rows[0].t) {
        const cc = await client.query(`DELETE FROM column_config WHERE screen LIKE 'leads%'`);
        console.log(`cleared ${cc.rowCount} saved per-role layout(s) (use --keep-saved to preserve)`);
      }
    }

    // Verify
    const sn = await exists(REMOVE.field);
    const ens = new Set((await client.query(`SELECT field_name FROM permission_fields WHERE resource='leads' AND field_name = ANY($1)`, [ENSURE.map(e => e.field)])).rows.map(r => r.field_name));
    const ok = RESET ? (ens.size === 0 && !!sn) : (ens.size === ENSURE.length && !sn);
    console.log(`\nVerification — assignment cols present: ${ens.size}/${ENSURE.length} | Sr.Counselor present: ${!!sn}`);
    if (!ok) throw new Error('Verification failed — rolling back.');

    await client.query('COMMIT');
    console.log(`\nCOMMITTED. Restart the backend (feed change) + refresh so the frontend re-fetches /api/staff/columns.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — no changes made:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });
