require('dotenv').config();
const p = require('./src/services/db');
p.query("DELETE FROM students WHERE unique_id LIKE 'WISE-DN-%'")
  .then(r => { console.log('Deleted', r.rowCount); p.end(); });
