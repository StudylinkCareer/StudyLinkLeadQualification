// server/src/migrations/addWeeklyRecommendations.js
// Run once: node src/migrations/addWeeklyRecommendations.js
//
// Creates the table that backs the Weekly Status Report "Recommendations"
// panel. One row per (week, view-scope). scope_key is derived server-side
// from the report view (all / groups / selected:… / individual:… / the
// viewer's own name for non-managers) so each distinct view keeps its own
// notes for a given week.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS weekly_recommendations (
        week_start  DATE         NOT NULL,
        scope_key   VARCHAR(200) NOT NULL,
        content     TEXT         NOT NULL DEFAULT '',
        updated_by  VARCHAR(200),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (week_start, scope_key)
      )
    `);
    console.log('✓ weekly_recommendations table ready');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
