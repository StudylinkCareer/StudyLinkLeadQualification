// server/src/services/eventReportExcel.js
// ---------------------------------------------------------------------------
// Writes the 5-sheet event report workbook from the gathered data + the LLM
// narrative. Deterministic: data columns come from eventReportData; narrative
// columns (reasons / rationale / advisory / recommended path) come from the
// generator and are left blank if not supplied (so it's testable without the LLM).
// Sheets & columns mirror the original "Event Report" Excel.
// ---------------------------------------------------------------------------

const ExcelJS = require('exceljs');

const HEAD = { bold: true, color: { argb: 'FFFFFFFF' } };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = HEAD; c.fill = HEAD_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
  });
  row.height = 20;
}
function addSheet(wb, name, columns) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns;
  styleHeader(ws.getRow(1));
  return ws;
}
const eng = (v) => (v == null || v === '' ? '-' : String(v));

// narrative shape (all optional):
//   deskReasons: { [`${studentId}|${institutionId}`]: [r1, r2, r3] }
//   contract:    [{ studentId, callPriority, potential, rationale }]  (order = priority)
//   advisory:    { [studentId]: { primaryObjective, interests:[..3], countries:[..3], recommendedPath } }
function buildEventReportWorkbook(data, narrative = {}) {
  const N = narrative || {};
  const deskReasons = N.deskReasons || {};
  const contract    = Array.isArray(N.contract) ? N.contract : [];
  const advisory    = N.advisory || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'StudyLink'; wb.created = new Date(0);

  const sName = (id) => data.students[id]?.fullName || id;
  const reasonsFor = (sid, iid) => deskReasons[`${sid}|${iid}`] || [];

  // ── 1. By Institution ── students ranked per institution by engagement.
  const byInst = addSheet(wb, 'By Institution', [
    { header: 'Institution', key: 'inst', width: 34 },
    { header: 'Rank', key: 'rank', width: 6 },
    { header: 'Student', key: 'student', width: 24 },
    { header: 'Student ID', key: 'sid', width: 14 },
    { header: 'Engagement', key: 'eng', width: 11 },
    { header: 'Reason 1', key: 'r1', width: 60 },
    { header: 'Reason 2', key: 'r2', width: 60 },
    { header: 'Reason 3', key: 'r3', width: 60 },
  ]);
  const byInstitution = {};
  for (const v of data.deskVisits) (byInstitution[v.institutionName] ||= []).push(v);
  for (const instName of Object.keys(byInstitution).sort()) {
    const visits = byInstitution[instName].slice().sort(rankByEngagement);
    visits.forEach((v, i) => {
      const r = reasonsFor(v.studentId, v.institutionId);
      byInst.addRow({ inst: instName, rank: i + 1, student: sName(v.studentId), sid: v.studentId,
        eng: eng(v.repRating), r1: r[0] || '', r2: r[1] || '', r3: r[2] || '' });
    });
  }

  // ── 2. By Student ── each student's desks ranked by engagement.
  const byStu = addSheet(wb, 'By Student', [
    { header: 'Student', key: 'student', width: 24 },
    { header: 'Student ID', key: 'sid', width: 14 },
    { header: 'Rank', key: 'rank', width: 6 },
    { header: 'Institution', key: 'inst', width: 34 },
    { header: 'Engagement', key: 'eng', width: 11 },
    { header: 'Reason 1', key: 'r1', width: 60 },
    { header: 'Reason 2', key: 'r2', width: 60 },
    { header: 'Reason 3', key: 'r3', width: 60 },
  ]);
  const byStudent = {};
  for (const v of data.deskVisits) (byStudent[v.studentId] ||= []).push(v);
  for (const sid of Object.keys(byStudent).sort((a, b) => sName(a).localeCompare(sName(b)))) {
    const visits = byStudent[sid].slice().sort(rankByEngagement);
    visits.forEach((v, i) => {
      const r = reasonsFor(v.studentId, v.institutionId);
      byStu.addRow({ student: sName(sid), sid, rank: i + 1, inst: v.institutionName,
        eng: eng(v.repRating), r1: r[0] || '', r2: r[1] || '', r3: r[2] || '' });
    });
  }

  // ── 3. Contract potential ── LLM-ranked; falls back to stone/risk order.
  const cp = addSheet(wb, 'Contract potential', [
    { header: 'Priority', key: 'prio', width: 8 },
    { header: 'Call priority', key: 'call', width: 11 },
    { header: 'Student', key: 'student', width: 24 },
    { header: 'Student ID', key: 'sid', width: 14 },
    { header: 'Stone', key: 'stone', width: 10 },
    { header: 'Risk score', key: 'risk', width: 10 },
    { header: 'Finance', key: 'fin', width: 22 },
    { header: 'Academics', key: 'acad', width: 22 },
    { header: 'English', key: 'eng', width: 12 },
    { header: 'Scholarship demand', key: 'sch', width: 18 },
    { header: 'Potential (1-10)', key: 'pot', width: 14 },
    { header: 'One-line rationale', key: 'rat', width: 80 },
  ]);
  contract.forEach((row, i) => {
    const s = data.students[row.studentId] || {};
    cp.addRow({ prio: i + 1, call: row.callPriority ?? i + 1, student: s.fullName || row.studentId,
      sid: row.studentId, stone: s.stone || '', risk: s.riskScore ?? '',
      fin: s.budget || '', acad: [s.gpa, s.major].filter(Boolean).join('; '),
      eng: s.english || '', sch: s.scholarshipDemand || '',
      pot: row.potential ?? '', rat: row.rationale || '' });
  });

  // ── 4. Student advisory ── per-student recommended path.
  const adv = addSheet(wb, 'Student advisory', [
    { header: 'Student', key: 'student', width: 24 },
    { header: 'Student ID', key: 'sid', width: 14 },
    { header: 'Primary objective', key: 'obj', width: 24 },
    { header: 'Study interest 1', key: 'i1', width: 40 },
    { header: 'Study interest 2', key: 'i2', width: 40 },
    { header: 'Study interest 3', key: 'i3', width: 40 },
    { header: 'Country 1', key: 'c1', width: 26 },
    { header: 'Country 2', key: 'c2', width: 26 },
    { header: 'Country 3', key: 'c3', width: 26 },
    { header: 'Recommended path', key: 'path', width: 90 },
  ]);
  for (const sid of Object.keys(advisory)) {
    const a = advisory[sid] || {}; const s = data.students[sid] || {};
    const it = a.interests || []; const co = a.countries || [];
    adv.addRow({ student: s.fullName || sid, sid, obj: a.primaryObjective || s.objective || '',
      i1: it[0] || '', i2: it[1] || '', i3: it[2] || '',
      c1: co[0] || s.destination || '', c2: co[1] || '', c3: co[2] || '',
      path: a.recommendedPath || '' });
  }

  // ── 5. Missed engagement (control) ── pure data.
  const me = data.missedEngagement;
  const meWs = wb.addWorksheet('Missed engagement (control)');
  meWs.addRow([`Control: ${me.checkedInNotScanned.length} checked-in students were never engaged at any desk; `
    + `${me.scannedNotCheckedIn.length} reached desks without passing check-in.`]);
  meWs.addRow([]);
  meWs.addRow([`CHECKED IN — NEVER SCANNED AT ANY DESK (${me.checkedInNotScanned.length})`]);
  const meCols = ['Student ID', 'Student', 'Stone', 'Budget', 'English', 'GPA', 'Scholarship demand', 'Objective', 'Destination'];
  styleHeader(meWs.addRow(meCols));
  me.checkedInNotScanned.forEach(s => meWs.addRow([s.studentId, s.fullName, s.stone, s.budget, s.english, s.gpa, s.scholarshipDemand, s.objective, s.destination]));
  meWs.addRow([]);
  meWs.addRow([`SCANNED AT A DESK — NO CHECK-IN (${me.scannedNotCheckedIn.length})`]);
  styleHeader(meWs.addRow(meCols));
  me.scannedNotCheckedIn.forEach(s => meWs.addRow([s.studentId, s.fullName, s.stone, s.budget, s.english, s.gpa, s.scholarshipDemand, s.objective, s.destination]));

  return wb;
}

// Rated desks first (higher rating = better rank); unrated desks last.
function rankByEngagement(a, b) {
  const ra = a.repRating == null ? -1 : a.repRating;
  const rb = b.repRating == null ? -1 : b.repRating;
  return rb - ra;
}

async function workbookToBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildEventReportWorkbook, workbookToBuffer };
