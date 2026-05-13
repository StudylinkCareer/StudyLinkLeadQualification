// migrate_field_permissions.js
// ---------------------------------------------------------------------------
// PHASE 1.5 of role-based access control work (Item 2).
//
// What this does (all in one go):
//   1. Creates `permission_fields` — catalog of every Lead field, tagged with
//      its category (personal_contact / financial / scoring / campaign / other).
//   2. Creates `role_field_permissions` — per-role × per-field matrix, with
//      separate list_permission and detail_permission columns. Values are
//      one of: 'edit' | 'view' | 'view_masked' | 'none'.
//   3. Seeds both with the rules agreed in the matrix.
//   4. Updates `role_permissions` (Phase 1 table) for two items:
//      - Item 6: Director's delete permission goes from 'none' → 'all'.
//      - Item 7: adds a new 'assign' operation for all four roles.
//
// SAFETY:
//   - All CREATE TABLE statements use IF NOT EXISTS.
//   - All seed INSERTs use ON CONFLICT DO NOTHING (won't overwrite admin edits).
//   - The Director delete UPDATE is *conditional* — it only fires if the row
//     is still at the original Phase 1 seed value (`updated_by = 'system_seed'`).
//     Once an admin edits that row via the future settings page, this script
//     will leave it alone.
//   - Safe to re-run.
//
// HOW TO RUN:
//   Place this file in Server/src/services/ alongside migrate_role_permissions.js.
//   From any directory, in PowerShell:
//       node C:\Users\rhod_\Documents\StudyLinkLeadQualification\Server\src\services\migrate_field_permissions.js
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set.');
  console.error('   Check that Server/.env exists and contains DATABASE_URL=...');
  process.exit(1);
}

const pool = require('./db');

// ─── Field-to-category mapping ────────────────────────────────────────────
// Each Lead field tagged with a category. Anything not in this map would
// default to 'other'.
//
// Family contacts (mother_*, father_*) are categorized as personal_contact
// per the agreed treatment — same masking rules as email/phone.
// ──────────────────────────────────────────────────────────────────────────
const FIELDS = {
  // ─ personal_contact (most sensitive — masked for most roles) ─────────
  fullName:               'personal_contact',
  email:                  'personal_contact',
  phone:                  'personal_contact',
  hiddenPhoneCountryCode: 'personal_contact',
  contactMedium1:         'personal_contact',
  phoneCountryCode1:      'personal_contact',
  contactDetail1:         'personal_contact',
  contactMedium2:         'personal_contact',
  phoneCountryCode2:      'personal_contact',
  contactDetail2:         'personal_contact',
  yearOfBirth:            'personal_contact',
  residency:              'personal_contact',
  preferredSocial:        'personal_contact',
  socialConsent:          'personal_contact',
  facebookProfile:        'personal_contact',
  headshotUrl:            'personal_contact',
  qrCodeImageUrl:         'personal_contact',
  // Family contacts (per agreed spec — treated same as personal)
  motherEmail:            'personal_contact',
  motherFullName:         'personal_contact',
  motherPhoneCountryCode: 'personal_contact',
  motherPhone:            'personal_contact',
  motherContactMedium:    'personal_contact',
  motherContactCC:        'personal_contact',
  motherContactDetail:    'personal_contact',
  fatherEmail:            'personal_contact',
  fatherFullName:         'personal_contact',
  fatherPhoneCountryCode: 'personal_contact',
  fatherPhone:            'personal_contact',
  fatherContactMedium:    'personal_contact',
  fatherContactCC:        'personal_contact',
  fatherContactDetail:    'personal_contact',

  // ─ financial ────────────────────────────────────────────────────────
  budget:                 'financial',
  scholarshipDemand:      'financial',
  sponsorIncome:          'financial',
  incomeEvidence:         'financial',

  // ─ scoring (Stone Tier / Risk Score / OCEAN) ────────────────────────
  stoneTier:              'scoring',
  riskScore:              'scoring',
  oceanExtraversion:      'scoring',
  oceanAgreeableness:     'scoring',
  oceanConscientiousness: 'scoring',
  oceanNeuroticism:       'scoring',
  oceanOpenness:          'scoring',
  // oceanQ1..oceanQ15 added programmatically below

  // ─ campaign ──────────────────────────────────────────────────────────
  campaignType:           'campaign',
  campaignName:           'campaign',
  campaignStart:          'campaign',
  campaignEnd:            'campaign',
  leadSource:             'campaign',
  referralSource:         'campaign',
  schoolEvent:            'campaign',

  // ─ other (catch-all) ────────────────────────────────────────────────
  uniqueId:               'other',
  studyPlans:             'other',
  interaction:            'other',
  destinationCountry:     'other',
  timeline:               'other',
  processApplication:     'other',
  englishLevel:           'other',
  gpa:                    'other',
  immigrationHistory:     'other',
  studyPlanGap:           'other',
  ultimateObjective:      'other',
  leadStatus:             'other',
  closeDate:              'other',
  confidence:             'other',
  counselor:              'other',
  seniorCounselor:        'other',
  presales:               'other',
  marketingStaff:         'other',
  status:                 'other',
  createdAt:              'other',
  updatedAt:              'other',
  counselingNotes:        'other',
  caseOfficerNotes:       'other',
  managementNotes:        'other',
};

// Add oceanQ1..oceanQ15 to scoring category
for (let i = 1; i <= 15; i++) {
  FIELDS[`oceanQ${i}`] = 'scoring';
}

// ─── The permission matrix ──────────────────────────────────────────────
// For each (category, role), [list_permission, detail_permission].
//
// Counselor detail = 'edit' assumes they're assigned — the resource-level
// rule (view_detail = 'own', scope) prevents them reaching detail for
// unassigned leads in the first place.
//
// NOTE: the system uses "Counselor" (one L) in the DB, matching the
// existing role values in role_permissions and the staff table.
// ────────────────────────────────────────────────────────────────────────
const MATRIX = {
  personal_contact: {
    Counselor: ['view_masked', 'edit'],
    Manager:   ['view_masked', 'view_masked'],
    Director:  ['view_masked', 'edit'],
    Admin:     ['view',        'view_masked'],
  },
  financial: {
    Counselor: ['view_masked', 'edit'],
    Manager:   ['view_masked', 'view'],
    Director:  ['view',        'edit'],
    Admin:     ['view_masked', 'edit'],
  },
  scoring: {
    Counselor: ['view', 'edit'],
    Manager:   ['view', 'view'],
    Director:  ['view', 'edit'],
    Admin:     ['view', 'view'],
  },
  campaign: {
    Counselor: ['view', 'edit'],
    Manager:   ['view', 'view'],
    Director:  ['view', 'edit'],
    Admin:     ['view', 'view'],
  },
  other: {
    Counselor: ['view', 'edit'],
    Manager:   ['view', 'edit'],
    Director:  ['view', 'edit'],
    Admin:     ['view', 'edit'],
  },
};

const ROLES = ['Admin', 'Manager', 'Director', 'Counselor'];

// camelCase → Title Case (for human-readable labels in admin UI later)
function toLabel(s) {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

async function migrate() {
  try {
    // ─── 1. Create new tables ─────────────────────────────────────────
    console.log('Creating permission_fields and role_field_permissions tables...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS permission_fields (
        id          SERIAL       PRIMARY KEY,
        resource    VARCHAR(50)  NOT NULL,
        field_name  VARCHAR(100) NOT NULL,
        category    VARCHAR(50)  NOT NULL,
        label       VARCHAR(200),
        UNIQUE (resource, field_name)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_field_permissions (
        id                 SERIAL       PRIMARY KEY,
        role               VARCHAR(50)  NOT NULL,
        resource           VARCHAR(50)  NOT NULL,
        field_name         VARCHAR(100) NOT NULL,
        list_permission    VARCHAR(20)  NOT NULL DEFAULT 'view',
        detail_permission  VARCHAR(20)  NOT NULL DEFAULT 'edit',
        updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_by         VARCHAR(255),
        UNIQUE (role, resource, field_name)
      );
    `);

    // ─── 2. Seed field catalog ────────────────────────────────────────
    console.log('Seeding field catalog (permission_fields)...');
    for (const [fieldName, category] of Object.entries(FIELDS)) {
      await pool.query(
        `INSERT INTO permission_fields (resource, field_name, category, label)
         VALUES ('leads', $1, $2, $3)
         ON CONFLICT (resource, field_name) DO NOTHING`,
        [fieldName, category, toLabel(fieldName)]
      );
    }

    // ─── 3. Seed role × field permission matrix ───────────────────────
    console.log('Seeding role × field permission matrix...');
    for (const [fieldName, category] of Object.entries(FIELDS)) {
      const categoryRules = MATRIX[category];
      for (const role of ROLES) {
        const [listPerm, detailPerm] = categoryRules[role];
        await pool.query(
          `INSERT INTO role_field_permissions
             (role, resource, field_name, list_permission, detail_permission, updated_by)
           VALUES ($1, 'leads', $2, $3, $4, 'system_seed')
           ON CONFLICT (role, resource, field_name) DO NOTHING`,
          [role, fieldName, listPerm, detailPerm]
        );
      }
    }

    // ─── 4a. Item 6 — Director's delete permission: none → all ────────
    // Conditional: only update if row still has the original Phase 1 seed
    // value. If admin has manually changed it, we leave it alone.
    console.log("Updating Director's delete permission (item 6)...");
    const upd = await pool.query(`
      UPDATE role_permissions
      SET scope = 'all',
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'system_seed_v2'
      WHERE role = 'Director'
        AND resource = 'leads'
        AND operation = 'delete'
        AND updated_by = 'system_seed'
    `);
    console.log(`   ${upd.rowCount} row updated.`);

    // ─── 4b. Item 7 — New 'assign' operation ──────────────────────────
    console.log("Adding 'assign' operation rules (item 7)...");
    const assignRows = [
      ['Admin',     'all'],
      ['Manager',   'all'],
      ['Director',  'all'],
      ['Counselor', 'own'],
    ];
    for (const [role, scope] of assignRows) {
      await pool.query(
        `INSERT INTO role_permissions (role, resource, operation, scope, updated_by)
         VALUES ($1, 'leads', 'assign', $2, 'system_seed')
         ON CONFLICT (role, resource, operation) DO NOTHING`,
        [role, scope]
      );
    }

    // ─── 5. Verification report ───────────────────────────────────────
    console.log('');
    console.log('✅ Migration complete.');
    console.log('');

    // Counts by category
    const { rows: catCounts } = await pool.query(`
      SELECT category, COUNT(*)::int AS fields
      FROM permission_fields
      WHERE resource = 'leads'
      GROUP BY category
      ORDER BY category
    `);
    console.log('Fields cataloged by category:');
    console.table(catCounts);

    // Sample rows — one field per category
    const { rows: sample } = await pool.query(`
      SELECT
        rfp.role,
        pf.category,
        rfp.field_name,
        rfp.list_permission AS list,
        rfp.detail_permission AS detail
      FROM role_field_permissions rfp
      JOIN permission_fields pf
        ON pf.field_name = rfp.field_name AND pf.resource = rfp.resource
      WHERE rfp.resource = 'leads'
        AND rfp.field_name IN ('email', 'budget', 'stoneTier', 'campaignName', 'studyPlans')
      ORDER BY pf.category, rfp.role
    `);
    console.log('Sample rows (one field per category × each role):');
    console.table(sample);

    // Updated role_permissions for delete and assign
    const { rows: rp } = await pool.query(`
      SELECT role, operation, scope
      FROM role_permissions
      WHERE resource = 'leads' AND operation IN ('delete', 'assign')
      ORDER BY
        CASE operation WHEN 'delete' THEN 1 WHEN 'assign' THEN 2 END,
        CASE role
          WHEN 'Admin' THEN 1
          WHEN 'Manager' THEN 2
          WHEN 'Director' THEN 3
          WHEN 'Counselor' THEN 4
        END
    `);
    console.log('Updated role_permissions (delete + new assign):');
    console.table(rp);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
