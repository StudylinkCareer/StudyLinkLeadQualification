// server/src/services/fixEpochDates.js
//
// Updates leads whose created_at is stuck on 1970-01-01 (Unix epoch) to a
// meaningful default. The default is set to ONE DAY BEFORE the earliest
// real (non-epoch) created_at in the students table — preserving temporal
// ordering so the epoch-dated leads sort cleanly to the top of "oldest".
//
// USAGE:
//   node fixEpochDates.js              (DRY RUN — shows the plan, no writes)
//   node fixEpochDates.js --commit     (Actually performs the update)

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./db');

const COMMIT     = process.argv.includes('--commit');
const EPOCH_DATE = '1970-01-01';

async function main() {
  console.log(`\n🛠  Fix epoch dates — mode: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  // 1. Count affected rows (NULL or epoch)
  const { rows: [affected] } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM students
     WHERE created_at IS NULL OR DATE(created_at) = $1`,
    [EPOCH_DATE]
  );

  // 2. Find the earliest real (non-epoch, non-null) date
  const { rows: [earliest] } = await pool.query(
    `SELECT MIN(created_at) AS earliest
     FROM students
     WHERE created_at IS NOT NULL AND DATE(created_at) <> $1`,
    [EPOCH_DATE]
  );

  console.log(`Leads with NULL or epoch created_at:   ${affected.total}`);

  if (affected.total === 0) {
    console.log('✅ Nothing to update.\n');
    return pool.end();
  }

  if (!earliest.earliest) {
    console.log(`❌ No real (non-epoch) created_at dates found anywhere — aborting.`);
    console.log(`   Run with a fixed date if needed.\n`);
    return pool.end();
  }

  const earliestIso = (earliest.earliest instanceof Date
    ? earliest.earliest
    : new Date(earliest.earliest)
  ).toISOString().slice(0, 10);

  // Compute one day before
  const newDate = new Date(earliestIso + 'T00:00:00Z');
  newDate.setUTCDate(newDate.getUTCDate() - 1);
  const newIso = newDate.toISOString().slice(0, 10);

  console.log(`Earliest real created_at:              ${earliestIso}`);
  console.log(`Will set epoch leads to (earliest -1): ${newIso}\n`);

  if (!COMMIT) {
    console.log('💡  Dry run only. Re-run with --commit to apply.\n');
    return pool.end();
  }

  const result = await pool.query(
    `UPDATE students
     SET created_at = $1, updated_at = NOW()
     WHERE created_at IS NULL OR DATE(created_at) = $2`,
    [newIso, EPOCH_DATE]
  );

  console.log(`✅ Updated ${result.rowCount} leads to ${newIso}.\n`);
  await pool.end();
}

main().catch(e => { console.error(e); pool.end().finally(() => process.exit(1)); });
