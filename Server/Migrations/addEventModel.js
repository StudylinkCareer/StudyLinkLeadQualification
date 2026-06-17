// server/src/migrations/addEventModel.js
// Run once: node src/migrations/addEventModel.js
//
// FOUNDATION for the redesigned event/attribution model. Additive + reversible:
//   • new tables: events, lead_events, partners
//   • new student columns (student info + "heard about StudyLink" + database_source)
//   • seeded lookups: event_group, event_type (per group), channel, database_source
//   • deactivates (does NOT drop) the superseded taxonomy lookups
//
// Nothing is dropped here. Deprecated columns (mkt_channel, mkt_type,
// campaign_type, school_event) are left in place until the ETL step.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Reference data to seed ───────────────────────────────────
const EVENT_GROUPS = ['StudyLink', 'Partner', 'School tour'];
const EVENT_TYPES = {
  'StudyLink':   ['School outreach session', 'Business seminar', 'Lunch & learn session', 'Exhibition / Fair'],
  'Partner':     ['Business seminars', 'Education workshops', 'Language workshops'],
  'School tour': ['HTV school tour'],
};
const CHANNELS = ['Facebook', 'Zalo', 'Google', 'Tik Tok', 'Instagram', 'StudyLink Hotline', 'Email', 'Digital'];
const DATABASE_SOURCES = ['YOOTEDU', 'WISE'];

// ── New student columns ──────────────────────────────────────
const STUDENT_COLUMNS = [
  ['major',            'VARCHAR(200)'],   // intended major
  ['school_attended',  'VARCHAR(200)'],   // school they attend
  ['ward',             'VARCHAR(200)'],   // where they live
  ['sl_heard_type',    'VARCHAR(20)'],    // how heard about StudyLink: Channel | Referral
  ['sl_channel',       'VARCHAR(100)'],   //   when Channel
  ['sl_referral_kind', 'VARCHAR(20)'],    //   when Referral: Sub-agent | Partner | Ex-client
  ['sl_referral_who',  'VARCHAR(200)'],   //   selected name (sub-agent/partner) or free text (ex-client)
  ['database_source',  'VARCHAR(100)'],   // purchased leads: YOOTEDU | WISE
];

// ── Idempotent lookup seeding (SELECT-then-INSERT) ───────────
async function seedLookup(client, category, code, subcategory, sort) {
  const hit = await client.query(
    `SELECT id FROM lookup_values
      WHERE category = $1 AND COALESCE(subcategory, '') = COALESCE($2, '') AND code = $3`,
    [category, subcategory, code]
  );
  if (hit.rowCount > 0) {
    await client.query(
      `UPDATE lookup_values SET is_active = true, sort_order = $1 WHERE id = $2`,
      [sort, hit.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $4, $5, true)`,
      [category, subcategory, code, code, sort]
    );
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. events — the session catalog
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id          SERIAL PRIMARY KEY,
        event_group VARCHAR(50)  NOT NULL,
        event_type  VARCHAR(100) NOT NULL,
        name        VARCHAR(200) NOT NULL,
        start_date  DATE,
        end_date    DATE,
        meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (event_group, event_type, name)
      )
    `);

    // 2. partners — separate selectable list (sub-agents already exist)
    await client.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL UNIQUE,
        phone      VARCHAR(50),
        email      VARCHAR(200),
        notes      TEXT,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 3. lead_events — one row per (student × event)
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_events (
        id               SERIAL PRIMARY KEY,
        student_id       VARCHAR(20) NOT NULL REFERENCES students(unique_id) ON DELETE CASCADE,
        event_id         INTEGER     NOT NULL REFERENCES events(id)          ON DELETE CASCADE,
        status           VARCHAR(20),               -- Confirmed | Uncertain | Declined
        ev_heard_type    VARCHAR(20),               -- Channel | Referral
        ev_channel       VARCHAR(100),
        ev_referral_kind VARCHAR(20),               -- Sub-agent | Partner | Ex-client
        ev_referral_who  VARCHAR(200),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (student_id, event_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_events_student ON lead_events(student_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_events_event   ON lead_events(event_id)`);
    console.log('✓ tables ensured: events, partners, lead_events');

    // 4. student columns
    for (const [col, type] of STUDENT_COLUMNS) {
      await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }
    console.log(`✓ students: ${STUDENT_COLUMNS.length} columns ensured`);

    // 5. seed lookups
    for (let i = 0; i < EVENT_GROUPS.length; i++) {
      await seedLookup(client, 'event_group', EVENT_GROUPS[i], null, i);
    }
    for (const [group, types] of Object.entries(EVENT_TYPES)) {
      for (let i = 0; i < types.length; i++) await seedLookup(client, 'event_type', types[i], group, i);
    }
    for (let i = 0; i < CHANNELS.length; i++)         await seedLookup(client, 'channel', CHANNELS[i], null, i);
    for (let i = 0; i < DATABASE_SOURCES.length; i++) await seedLookup(client, 'database_source', DATABASE_SOURCES[i], null, i);
    console.log('✓ lookups seeded: event_group, event_type, channel, database_source');

    // 6. deactivate superseded lookups (kept, not deleted)
    const dead = await client.query(
      `UPDATE lookup_values SET is_active = false
        WHERE category IN ('marketing_category', 'marketing_subcategory', 'marketing_channel', 'client_type')
          AND is_active = true`
    );
    console.log(`✓ deactivated ${dead.rowCount} superseded lookup rows`);

    await client.query('COMMIT');
    console.log('\n✓ Event-model foundation complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
