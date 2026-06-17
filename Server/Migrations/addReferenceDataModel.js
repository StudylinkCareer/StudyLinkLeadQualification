// server/src/migrations/addReferenceDataModel.js
// Run from Server\ :  node src/migrations/addReferenceDataModel.js
//
// R1 foundation for the Source-of-Lead → Source model. Additive + idempotent
// (safe to re-run; supersedes the first draft).
//
//   Lookups seeded:
//     source_of_lead   — 5 categories, each with a `mode`:
//                        Databases/On-line=list, Event/Campaign=events,
//                        B2B referrals=b2b, Personal referrals=list_freetext
//     source           — lists for Databases, On-line, Personal referrals
//     b2b_type         — Subagents / Partners / School Outreach
//     b2b_party        — parties per b2b_type (seeded from subagents/partners)
//     attendance_status— Confirmed / Uncertain / Declined
//
//   Columns:
//     students:    source, source_detail(200), source_unverified
//     lead_events: source_of_lead, source, source_detail(200), source_unverified
//                  (status + event_id already exist; old ev_* left deprecated)
//
// Event/Campaign Sources come from Marketing Events (R2). lead_source already
// exists and becomes "Source of Lead".

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const SOURCE_OF_LEAD = [
  { code: 'Databases',          mode: 'list' },
  { code: 'On-line',            mode: 'list' },
  { code: 'Event/Campaign',     mode: 'events' },
  { code: 'B2B referrals',      mode: 'b2b' },
  { code: 'Personal referrals', mode: 'list_freetext' },
];
const SOURCE = {
  'Databases':          ['WISE', 'YootEdu'],
  'On-line':            ['FB Ad', 'Zalo', 'ZNS', 'Google Ad', 'LadiPage', 'Tik Tok Ad', 'Email', 'eBook FB', 'eBook Web'],
  'Personal referrals': ['Walk-in', 'Ex-client', 'Staff'],
};
const B2B_TYPE = ['Subagents', 'Partners', 'School Outreach'];
const ATTENDANCE_STATUS = ['Confirmed', 'Uncertain', 'Declined'];

async function seed(client, category, code, subcategory, sort, meta) {
  const hit = await client.query(
    `SELECT id FROM lookup_values
      WHERE category=$1 AND COALESCE(subcategory,'')=COALESCE($2,'') AND code=$3`,
    [category, subcategory, code]
  );
  if (hit.rowCount > 0) {
    await client.query(
      `UPDATE lookup_values SET is_active=true, sort_order=$1, meta=COALESCE(meta,'{}'::jsonb)||$2::jsonb WHERE id=$3`,
      [sort, JSON.stringify(meta || {}), hit.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active, meta)
       VALUES ($1,$2,$3,$4,$4,$5,true,$6::jsonb)`,
      [category, subcategory, code, code, sort, JSON.stringify(meta || {})]
    );
  }
}

async function tableExists(client, name) {
  const r = await client.query(`SELECT to_regclass($1) AS t`, [name]);
  return !!r.rows[0].t;
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // columns (widen source_detail to 200; ALTER TYPE is a no-op if already 200)
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS source            VARCHAR(200)`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS source_detail     VARCHAR(200)`);
    await client.query(`ALTER TABLE students ALTER COLUMN source_detail TYPE VARCHAR(200)`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS source_unverified BOOLEAN NOT NULL DEFAULT false`);

    await client.query(`ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS source_of_lead    VARCHAR(100)`);
    await client.query(`ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS source            VARCHAR(200)`);
    await client.query(`ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS source_detail     VARCHAR(200)`);
    await client.query(`ALTER TABLE lead_events ALTER COLUMN source_detail TYPE VARCHAR(200)`);
    await client.query(`ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS source_unverified BOOLEAN NOT NULL DEFAULT false`);
    console.log('✓ columns ensured on students + lead_events');

    // lookups
    for (let i = 0; i < SOURCE_OF_LEAD.length; i++) {
      await seed(client, 'source_of_lead', SOURCE_OF_LEAD[i].code, null, i, { mode: SOURCE_OF_LEAD[i].mode });
    }
    for (const [parent, list] of Object.entries(SOURCE)) {
      for (let i = 0; i < list.length; i++) await seed(client, 'source', list[i], parent, i, {});
    }
    for (let i = 0; i < B2B_TYPE.length; i++) await seed(client, 'b2b_type', B2B_TYPE[i], null, i, {});
    for (let i = 0; i < ATTENDANCE_STATUS.length; i++) await seed(client, 'attendance_status', ATTENDANCE_STATUS[i], null, i, {});
    console.log('✓ lookups seeded: source_of_lead, source, b2b_type, attendance_status');

    // b2b_party seeded from existing subagents/partners names
    let parties = 0;
    if (await tableExists(client, 'subagents')) {
      const r = await client.query(`SELECT name FROM subagents WHERE is_active=true ORDER BY name`);
      for (let i = 0; i < r.rows.length; i++) { await seed(client, 'b2b_party', r.rows[i].name, 'Subagents', i, {}); parties++; }
    }
    if (await tableExists(client, 'partners')) {
      const r = await client.query(`SELECT name FROM partners WHERE is_active=true ORDER BY name`);
      for (let i = 0; i < r.rows.length; i++) { await seed(client, 'b2b_party', r.rows[i].name, 'Partners', i, {}); parties++; }
    }
    console.log(`✓ b2b_party seeded: ${parties} parties (School Outreach starts empty)`);

    // retire unused lookups
    const dead = await client.query(
      `UPDATE lookup_values SET is_active=false WHERE category IN ('channel','client_type') AND is_active=true`
    );
    console.log(`✓ deactivated ${dead.rowCount} unused lookup rows`);

    await client.query('COMMIT');
    console.log('\n✓ R1 foundation complete (B2B = type + party)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
