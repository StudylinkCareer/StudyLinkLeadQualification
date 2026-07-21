// Throwaway seed script for LOCAL DEV ONLY. Your schema-only DB clone has zero
// rows, so you can't even log in yet. This inserts:
//   - one test staff login (position/role both in EVENT_REPORT_PROFILES, so
//     you can confirm the Event Report gating works) - idempotent, safe to
//     run repeatedly
//   - one test Exhibition/Fair event (name configurable - see Usage - so you
//     can create a second/third event for testing Compare mode)
//   - N test students registered for it (Confirmed + attended), so the
//     source-breakdown table on the new Event Report page has something real
//     to render instead of an empty state
// Hard localhost-only guard - refuses to run anywhere else, no --allow-remote
// escape hatch, since this is dev-convenience data that must never touch a
// real database.
//
// Usage:
//   node scripts/seedLocalDevData.js                          -> "Test Event (Local)", 1 student
//   node scripts/seedLocalDevData.js "Test Event 2 (Local)" 3  -> named event, 3 students
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('Refusing to run: DATABASE_URL is not localhost. This script is for local dev seeding only.');
  process.exit(1);
}

const TEST_EMAIL = 'test@studylink.local';
const TEST_PASSWORD = 'test1234';
const eventName = process.argv[2] || 'Test Event (Local)';
const studentCount = Math.max(1, parseInt(process.argv[3], 10) || 1);

const pool = new Pool({ connectionString: url, ssl: false });

(async () => {
  const passwordHash = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');

  await pool.query(
    `INSERT INTO staff (full_name, email, position, role, password_hash, is_active)
     VALUES ('Test Admin', $1, 'CEO', 'Director', $2, true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, position = EXCLUDED.position, role = EXCLUDED.role`,
    [TEST_EMAIL, passwordHash]
  );
  console.log(`Staff login ready: ${TEST_EMAIL} / ${TEST_PASSWORD}`);

  const ev = await pool.query(
    `INSERT INTO events (event_group, event_type, name, start_date, end_date, is_active)
     VALUES ('Exhibition / Fair', 'Exhibition / Fair', $1, CURRENT_DATE, CURRENT_DATE, true)
     ON CONFLICT (event_group, event_type, name) DO UPDATE SET is_active = true
     RETURNING id`,
    [eventName]
  );
  const eventId = ev.rows[0].id;
  console.log(`Test event ready: "${eventName}" id=${eventId}`);

  const SOURCES = ['Facebook', 'Zalo', 'TikTok', 'Website'];
  // Includes a null so some students land on 'Unscored' (no assessment done
  // yet) — a real case the tier pie charts/fallback label need to handle.
  const STONE_TIERS = ['Diamond', 'Ruby', 'Sapphire', 'Agate', 'Quartz', null];
  const COUNSELORS = ['Nguyễn Thị Mỹ Ly', 'Trần Văn Phúc', 'Lê Thành Vinh', null]; // null -> tests the '(unassigned)' fallback

  for (let i = 0; i < studentCount; i++) {
    const studentId = `LOCALTEST${String(Date.now()).slice(-6)}${i}`;
    const source = SOURCES[i % SOURCES.length];
    const stoneTier = STONE_TIERS[i % STONE_TIERS.length];
    const counselor = COUNSELORS[i % COUNSELORS.length];
    // Vary confirm/attend a little across students so percentages aren't a
    // trivial 100% flat line when studentCount > 1.
    const status = i % 3 === 2 ? 'Uncertain' : 'Confirmed';
    const attended = i % 4 !== 3;

    await pool.query(
      `INSERT INTO students (student_id, full_name, email, phone, referral_source, source_unverified, lead_source, source, stone_tier)
       VALUES ($1, $2, $3, '0900000000', 'Test', false, $4, $5, $6)`,
      [studentId, `Nguyễn Test Student ${i + 1}`, `test.student${i}.${Date.now()}@studylink.local`, source, source, stoneTier]
    );

    await pool.query(
      `INSERT INTO lead_events (student_id, event_id, source_of_lead, source, source_detail, source_unverified, status, ev_heard_type, ev_channel, created_at, updated_at)
       VALUES ($1, $2, 'Databases', $3, null, false, $4, 'Channel', $5, NOW(), NOW())`,
      [studentId, eventId, source, status, source]
    );

    await pool.query(
      `INSERT INTO event_attendees (event_id, student_unique_id, registered_at, attended_at, attendance_token)
       VALUES ($1, $2, NOW(), $3, $4)`,
      [eventId, studentId, attended ? new Date() : null, crypto.randomUUID()]
    );

    // A leads row is what the Event Report's counselor column actually joins
    // against (eventSourceBreakdown.js's LATERAL join to `leads`) - without
    // this, every seeded student would show '(unassigned)' regardless of
    // what's intended here.
    await pool.query(
      `INSERT INTO leads (person_id, lead_status, counselor, created_at, updated_at)
       VALUES ($1, 'New', $2, NOW(), NOW())`,
      [studentId, counselor]
    );
  }
  console.log(`${studentCount} test student(s) registered for "${eventName}" (with varied stone tiers + counselors)`);

  await pool.query(`INSERT INTO event_institutions (event_id, institution_id, desk_token, desk_pin, is_active)
    SELECT $1, id, $2, '0000', true FROM institutions LIMIT 1`, [eventId, crypto.randomUUID()])
    .catch(() => console.log('(skipped event_institutions - no institutions rows to reference, fine for basic testing)'));

  await pool.end();
  console.log('\nDone. Log into the LM console locally with the credentials above.');
})().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
