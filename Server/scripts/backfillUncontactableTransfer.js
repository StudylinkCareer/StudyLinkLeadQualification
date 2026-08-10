// scripts/backfillUncontactableTransfer.js
// ─────────────────────────────────────────────────────────────────────
// One-time backfill for the Uncontactable → Pre-sales auto-transfer
// (see services/uncontactableTransfer.js). That feature only checks a
// lead the moment a NEW counselor note lands on it — leads that already
// met the 3-distinct-khung-giờ-KBM condition BEFORE the feature shipped
// would never get caught unless someone happens to log another
// qualifying note. This walks every currently 'Not contactable' lead
// with an assigned counselor and runs the exact same checkAndTransfer()
// used live, so the backfill is 100% consistent with the real feature —
// same round-robin, same rules, no separate logic to keep in sync.
//
// Usage:
//   node scripts/backfillUncontactableTransfer.js            # dry-run, prints who WOULD transfer
//   node scripts/backfillUncontactableTransfer.js --apply    # actually performs the transfers
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const { isCallNote, classifyKbm } = require('../src/services/callClassification');
const { slotOf } = require('../src/services/callSlots');

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const client = await pool.connect();
  try {
    const leadsRes = await client.query(
      `SELECT lead_id, person_id AS student_id, counselor
         FROM leads
        WHERE lead_status = 'Not contactable' AND COALESCE(btrim(counselor), '') <> ''
        ORDER BY lead_id`
    );
    console.log(`${leadsRes.rowCount} lead(s) currently 'Not contactable' with a counselor assigned.\n`);

    // One batched query for every candidate lead's notes instead of one
    // query per lead (491 leads x a remote round-trip to Railway was
    // timing out — this is the same qualification check checkAndTransfer()
    // uses, just fetched in bulk for the dry-run report).
    const leadIds = leadsRes.rows.map((l) => l.lead_id);
    const notesByLead = new Map();
    if (leadIds.length) {
      const noteRes = await client.query(
        `SELECT lead_id, author_name, content, contact_platform, call_answered, created_at
           FROM student_notes WHERE lead_id = ANY($1)`,
        [leadIds]
      );
      for (const n of noteRes.rows) {
        if (!notesByLead.has(n.lead_id)) notesByLead.set(n.lead_id, []);
        notesByLead.get(n.lead_id).push(n);
      }
    }

    let qualifying = [];
    for (const lead of leadsRes.rows) {
      const notes = (notesByLead.get(lead.lead_id) || []).filter((n) => n.author_name === lead.counselor);
      const kbmNotes = notes.filter((n) => isCallNote(n) && classifyKbm(n));
      const slots = new Set(kbmNotes.map((n) => slotOf(n.created_at)));
      if (slots.has(1) && slots.has(2) && slots.has(3)) {
        qualifying.push({ leadId: lead.lead_id, studentId: lead.student_id, counselor: lead.counselor, kbmCount: kbmNotes.length });
      }
    }

    console.log(`${qualifying.length} lead(s) qualify (KBM calls covering all 3 khung giờ):`);
    console.log('─'.repeat(70));
    for (const q of qualifying) {
      console.log(`  lead ${q.leadId} (${q.studentId}) — counselor: ${q.counselor}, ${q.kbmCount} KBM calls`);
    }
    console.log('─'.repeat(70));

    if (!APPLY) {
      console.log('\nDry-run — re-run with --apply to actually transfer these leads.');
      console.log('(Round-robin recipients aren\'t previewed here — each transfer affects');
      console.log(' who\'s "next", so the real order only resolves when --apply runs them in sequence.)');
      return;
    }

    if (!qualifying.length) { console.log('\nNothing to transfer.'); return; }

    // Run for real, one at a time, in the same order shown above — reuses
    // the live service so this is exactly the same code path a real note
    // save would trigger.
    const { checkAndTransfer } = require('../src/services/uncontactableTransfer');
    let done = 0, skipped = 0;
    for (const q of qualifying) {
      const result = await checkAndTransfer(q.leadId);
      if (result.transferred) {
        console.log(`  ✓ lead ${q.leadId} → ${result.to}`);
        done++;
      } else {
        console.log(`  – lead ${q.leadId} skipped (${result.reason})`);
        skipped++;
      }
    }
    console.log(`\n✓ ${done} transferred, ${skipped} skipped.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
