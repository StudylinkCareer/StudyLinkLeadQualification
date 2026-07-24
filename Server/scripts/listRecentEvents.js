// Read-only — lists the 10 most recent events with their id, so you can pick
// the right one to pass into diagnoseEventContracted.js.
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set in the environment.');
  process.exit(1);
}
console.log('Connecting to host:', url.replace(/.*@/, '').split('/')[0]);

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

pool.query('SELECT id, name, start_date FROM events ORDER BY start_date DESC LIMIT 10')
  .then((r) => { console.table(r.rows); return pool.end(); })
  .catch((e) => { console.error('Query failed:', e.message); process.exit(1); });
