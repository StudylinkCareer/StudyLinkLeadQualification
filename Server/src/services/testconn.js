require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 1,
});
pool.query('SELECT NOW()')
  .then(r => { console.log('✅ Connected:', r.rows[0]); return pool.end(); })
  .catch(e => { console.error('❌ Failed:', e.message); return pool.end(); });