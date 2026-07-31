// Read-only — exports Full Name + Notes for students who visited specific
// institution booths at an event, one CSV per institution. No phone/email.
//
// "Notes" here is the desk rep's stamped note segment(s) for THAT specific
// institution — student_notes.content is consolidated per (student, event)
// and can contain segments from several institutions if the student visited
// more than one booth, so this parses out and keeps only the segment(s)
// whose header says "· <InstitutionName>", to avoid leaking one school's
// remarks into another school's export.
//
// Usage: node scripts/exportInstitutionVisitors.js <eventId> <deskPin1> <deskPin2> ...
// Example: node scripts/exportInstitutionVisitors.js 36 0829 2015 0434
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set in the environment.'); process.exit(1); }
console.log('Connecting to host:', url.replace(/.*@/, '').split('/')[0]);

const eventId = parseInt(process.argv[2], 10);
const deskPins = process.argv.slice(3);
if (isNaN(eventId) || !deskPins.length) {
  console.error('Usage: node scripts/exportInstitutionVisitors.js <eventId> <deskPin1> [deskPin2] ...');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Splits a consolidated student_notes.content into { header, body } segments,
// matching eventDesk.js's stampLine format: "[YYYY-MM-DD HH:MM] Rep · Institution".
function splitSegments(content) {
  if (!content) return [];
  const parts = content.split(/\n\n(?=\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

(async () => {
  const evRes = await pool.query('SELECT id, name FROM events WHERE id = $1', [eventId]);
  if (!evRes.rows.length) { console.error('No event with id', eventId); process.exit(1); }
  console.log(`Event: ${evRes.rows[0].name} (id ${eventId})`);

  for (const pin of deskPins) {
    const eiRes = await pool.query(
      `SELECT ei.institution_id, i.name AS institution_name
         FROM event_institutions ei JOIN institutions i ON i.id = ei.institution_id
        WHERE ei.event_id = $1 AND ei.desk_pin = $2`,
      [eventId, pin]
    );
    if (!eiRes.rows.length) { console.warn(`⚠ No institution found for desk_pin ${pin} on event ${eventId} — skipping.`); continue; }
    const { institution_id: institutionId, institution_name: institutionName } = eiRes.rows[0];

    const visitRes = await pool.query(
      `SELECT DISTINCT ON (v.student_unique_id) v.student_unique_id, s.full_name, v.note_id
         FROM event_desk_visits v
         JOIN students s ON s.student_id = v.student_unique_id
        WHERE v.event_id = $1 AND v.institution_id = $2
        ORDER BY v.student_unique_id, v.visited_at DESC`,
      [eventId, institutionId]
    );

    const noteIds = [...new Set(visitRes.rows.map((r) => r.note_id).filter(Boolean))];
    const notesById = new Map();
    if (noteIds.length) {
      const notesRes = await pool.query(`SELECT id, content FROM student_notes WHERE id = ANY($1)`, [noteIds]);
      for (const r of notesRes.rows) notesById.set(r.id, r.content);
    }

    const rows = visitRes.rows.map((v) => {
      const content = notesById.get(v.note_id) || '';
      const segments = splitSegments(content).filter((seg) => seg.includes(`· ${institutionName}`));
      const notes = (segments.length ? segments : [content]).join('\n---\n').trim();
      return { fullName: v.full_name, notes };
    });

    const outDir = path.join(__dirname, 'output'); // gitignored — real student PII, never commit
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `visitors_${institutionName.replace(/[^a-z0-9]+/gi, '_')}_event${eventId}.csv`);
    const csv = [
      ['Full Name', 'Notes'].map(csvCell).join(','),
      ...rows.map((r) => [r.fullName, r.notes].map(csvCell).join(',')),
    ].join('\n');
    fs.writeFileSync(outPath, '﻿' + csv, 'utf8');
    console.log(`✓ ${institutionName} (PIN ${pin}): ${rows.length} student(s) -> ${outPath}`);
  }

  await pool.end();
})().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
