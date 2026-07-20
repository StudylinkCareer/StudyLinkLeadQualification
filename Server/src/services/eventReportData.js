// server/src/services/eventReportData.js
// ---------------------------------------------------------------------------
// Gathers the full dataset for an event's AI-generated report: attendance,
// desk visits (rep engagement rating + the desk note text), per-student
// qualification, and the missed-engagement control. Pure read. The structured
// payload it returns feeds BOTH the report generator (LLM narrative) and the
// Excel writer (data columns) — see eventReportGenerator.js / eventReportExcel.js.
// ---------------------------------------------------------------------------

const pool = require('./db');

async function gatherEventReportData(eventId) {
  const ev = (await pool.query(
    `SELECT id, name, start_date, end_date FROM events WHERE id = $1`, [eventId]
  )).rows[0];
  if (!ev) throw new Error('Event not found');

  // Registered + checked-in (attended_at set = checked in at the door).
  const attendees = (await pool.query(
    `SELECT student_unique_id, registered_at, attended_at
       FROM event_attendees WHERE event_id = $1`, [eventId]
  )).rows;

  // Desk visits: engagement rating + the stamped desk-note text, per institution.
  const visits = (await pool.query(
    `SELECT dv.student_unique_id, dv.institution_id, i.name AS institution_name,
            dv.rep_rating, dv.visited_at, n.content AS note_text
       FROM event_desk_visits dv
       LEFT JOIN institutions   i ON i.id = dv.institution_id
       LEFT JOIN student_notes  n ON n.id = dv.note_id
      WHERE dv.event_id = $1
      ORDER BY dv.student_unique_id, dv.rep_rating DESC NULLS LAST, dv.visited_at`, [eventId]
  )).rows;

  // Qualification for every person who registered or visited a desk.
  const ids = [...new Set([
    ...attendees.map(a => a.student_unique_id),
    ...visits.map(v => v.student_unique_id),
  ])].filter(Boolean);
  const students = ids.length ? (await pool.query(
    `SELECT student_id, full_name, stone_tier, risk_score, budget, gpa, major, english_level,
            scholarship_demand, ultimate_objective, destination_country
       FROM students WHERE student_id = ANY($1)`, [ids]
  )).rows : [];

  // ── Shape it ──
  const studentMap = {};
  for (const s of students) {
    studentMap[s.student_id] = {
      studentId: s.student_id, fullName: s.full_name,
      stone: s.stone_tier, riskScore: s.risk_score, budget: s.budget,
      gpa: s.gpa, major: s.major, english: s.english_level,
      scholarshipDemand: s.scholarship_demand, objective: s.ultimate_objective,
      destination: s.destination_country,
      checkedIn: false, checkedInAt: null,
    };
  }
  const ensure = (id) => (studentMap[id] = studentMap[id] || { studentId: id, fullName: null, checkedIn: false, checkedInAt: null });

  const attendedIds = new Set();
  for (const a of attendees) {
    const s = ensure(a.student_unique_id);
    if (a.attended_at) { s.checkedIn = true; s.checkedInAt = a.attended_at; attendedIds.add(a.student_unique_id); }
  }

  const deskVisits = visits.map(v => ({
    studentId: v.student_unique_id,
    studentName: studentMap[v.student_unique_id]?.fullName || null,
    institutionId: v.institution_id,
    institutionName: v.institution_name || '(unknown)',
    repRating: v.rep_rating,               // 1..10 or null
    noteText: (v.note_text || '').trim() || null,
    visitedAt: v.visited_at,
  }));

  const visitedIds = new Set(visits.map(v => v.student_unique_id).filter(Boolean));

  // Control: checked in but never scanned at a desk; scanned but never checked in.
  const checkedInNotScanned = [...attendedIds].filter(id => !visitedIds.has(id))
    .map(id => studentMap[id]).filter(Boolean);
  const scannedNotCheckedIn = [...visitedIds].filter(id => !attendedIds.has(id))
    .map(id => studentMap[id]).filter(Boolean);

  return {
    event: {
      id: ev.id, name: ev.name,
      startDate: ev.start_date, endDate: ev.end_date,
    },
    counts: {
      registered: attendees.length,
      attended: attendedIds.size,
      deskVisits: deskVisits.length,
      distinctStudentsAtDesks: visitedIds.size,
      institutions: new Set(visits.map(v => v.institution_id)).size,
      checkedInNotScanned: checkedInNotScanned.length,
      scannedNotCheckedIn: scannedNotCheckedIn.length,
    },
    students: studentMap,          // keyed by studentId
    deskVisits,                    // flat list, rating-desc within student
    missedEngagement: { checkedInNotScanned, scannedNotCheckedIn },
  };
}

module.exports = { gatherEventReportData };
