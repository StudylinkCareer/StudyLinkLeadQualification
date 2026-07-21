// Throwaway connectivity check for DATABASE_URL. Read-only — prints the DB
// host (never the password) so you can confirm you're pointed at the DB you
// think you are, then runs one harmless query.
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set in the environment.');
  process.exit(1);
}

console.log('Connecting to host:', url.replace(/.*@/, '').split('/')[0]);

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const r = await pool.query('SELECT NOW() AS db_time, (SELECT COUNT(*) FROM students) AS student_count');
  console.log(r.rows[0]);
  await pool.end();
})().catch((e) => {
  console.error('Connection failed:', e.message);
  process.exit(1);
});
