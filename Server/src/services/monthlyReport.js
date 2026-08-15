// Server/src/services/monthlyReport.js
// ─────────────────────────────────────────────────────────────────────
// Sales + Marketing Monthly Report — see the approved plan for full context.
// Mirrors reportController.js's patterns (VN month boundaries, isCall(),
// the meetings/leadsOut/monthlyTargets query shapes) but lives in its own
// service file rather than further growing reportController.js.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
const { classifyCalls, isCallNote } = require('./callClassification');
const eventBudget = require('./eventBudget');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const VN_MS = 7 * 60 * 60 * 1000;
const vnMidnightUTC = (y, m, d) => new Date(Date.UTC(y, m, d) - VN_MS);

// 'YYYY-MM' -> date-only bounds (for DATE columns like actual_close_date) and
// ISO timestamp bounds (for TIMESTAMPTZ columns like created_at/changed_at).
function monthBounds(monthLabel) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthLabel || '');
  if (!m) throw new Error('month must be YYYY-MM');
  const y = Number(m[1]), mo0 = Number(m[2]) - 1;
  const start = vnMidnightUTC(y, mo0, 1);
  const end = vnMidnightUTC(y, mo0 + 1, 1);
  const nextY = mo0 === 11 ? y + 1 : y;
  const nextM = mo0 === 11 ? 1 : mo0 + 2;
  return {
    monthDate: `${m[1]}-${m[2]}-01`,
    nextMonthDate: `${nextY}-${String(nextM).padStart(2, '0')}-01`,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

// isCallNote / classifyKbm now live in callClassification.js (unified
// New/Ongoing/KBM rule shared with Weekly Report and the Call Targets
// "actual" figure — confirmed 2026-08). Imported above.

const CASE_TYPES = ['Du học', 'Du học hè', 'Thị thực Du lịch', 'Thị thực Khác'];

async function getCounselorStaff() {
  const r = await pool.query(
    `SELECT id, full_name, COALESCE(target, 0) AS fallback_target, COALESCE(call_target, 0) AS fallback_call_target
       FROM staff
      WHERE position ILIKE '%counsel%' AND is_active = true
        AND COALESCE(staff_type, 'permanent') <> 'event'`
  );
  return r.rows;
}

async function getPresalesStaff() {
  const r = await pool.query(
    `SELECT id, full_name, COALESCE(call_target, 0) AS fallback_call_target
       FROM staff
      WHERE position ILIKE '%pre%sale%' AND is_active = true
        AND COALESCE(staff_type, 'permanent') <> 'event'`
  );
  return r.rows;
}

// Call Target override lookup for a set of staff ids, for the given month —
// mirrors overrideByStaffId's Contract-Target pattern below exactly, just
// against call_targets/staff.call_target (Staff Targets page, second grid)
// instead of monthly_targets/staff.target. Fully replaces the old per-
// weekday formula — no fallback to it; an unconfigured staffer just shows 0.
async function getCallTargetOverrides(staffIds, monthDate) {
  if (!staffIds.length) return new Map();
  const rows = (await pool.query(
    `SELECT staff_id, target FROM call_targets WHERE staff_id = ANY($1) AND month = $2`,
    [staffIds, monthDate]
  )).rows;
  return new Map(rows.map((r) => [r.staff_id, r.target]));
}

// Ex-client sources are per-person free text in source_detail (the specific
// past client's name) — that would fragment Contract Resources into one
// bucket per name instead of one meaningful "Ex-client" bucket, per mom's
// request to collapse them.
function isExClientSource(source) {
  return /^ex[\s-]?client(s)?$/i.test((source || '').trim());
}

// Source label for a Contracted lead — adapted from eventSourceBreakdown.js's
// resolveSourceLabel(), simplified since a contract isn't necessarily tied to
// a specific event registration (lead_events row may not exist at all).
// "Events" mode is still collapsed to its lookup category label rather than
// leaking a literal event name, for the same reason as the Event Report fix.
function resolveContractSourceLabel(row) {
  if (row.sol_mode === 'events') return row.sol_label || 'Event/Campaign';
  if (isExClientSource(row.source)) return 'Ex-Client';
  const s = [row.source, row.source_detail].filter(Boolean).join(' - ');
  return s || '(Unknown / not recorded)';
}

// getSalesMonthlyReport(monthLabel) -> { month, teamPerformance, contractResources, presalesReport }
async function getSalesMonthlyReport(monthLabel) {
  const { monthDate, nextMonthDate, startISO, endISO } = monthBounds(monthLabel);

  const counselors = await getCounselorStaff();
  const presales = await getPresalesStaff();
  const counselorNames = counselors.map((c) => c.full_name);
  const presalesNames = presales.map((p) => p.full_name);

  // ── Team Performance / Convert Rate (per counselor) ──
  const contractedRows = counselorNames.length ? (await pool.query(
    `SELECT lead_id, counselor, case_type, is_out_of_system
       FROM leads
      WHERE actual_close_date >= $1 AND actual_close_date < $2
        AND counselor = ANY($3)`,
    [monthDate, nextMonthDate, counselorNames]
  )).rows : [];

  // Name/source lookup for every contracted lead this month — computed once
  // here, up front, so both the per-counselor drill-down detail below AND
  // Contract Resources further down can reuse it without a second query.
  const contractedLeadIds = contractedRows.map((r) => r.lead_id);
  const sourceRows = contractedLeadIds.length ? (await pool.query(
    `SELECT l.lead_id, s.student_id, s.full_name, s.source, s.source_detail, s.lead_source,
            solv.meta->>'mode' AS sol_mode, COALESCE(solv.label_vi, solv.label_en, solv.code) AS sol_label
       FROM leads l
       JOIN students s ON s.student_id = l.person_id
       LEFT JOIN lookup_values solv ON solv.category = 'source_of_lead' AND solv.code = s.lead_source
      WHERE l.lead_id = ANY($1)`,
    [contractedLeadIds]
  )).rows : [];
  const sourceInfoByLead = new Map(sourceRows.map((r) => [r.lead_id, {
    studentId: r.student_id, fullName: r.full_name, sourceLabel: resolveContractSourceLabel(r),
  }]));

  // "Total leads" is a CURRENT-value count (counselor = X today), not a full
  // historical reconstruction — matches how contractedBuckets()/monthlyTargets()
  // elsewhere in this codebase already scope by current assignment, not audit
  // history. A lead reassigned away from this counselor won't count here.
  const leadCountRows = counselorNames.length ? (await pool.query(
    `SELECT counselor, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE assigned_in >= $1 AND assigned_in < $2)::int AS new_this_month
       FROM leads
      WHERE counselor = ANY($3)
      GROUP BY counselor`,
    [monthDate, nextMonthDate, counselorNames]
  )).rows : [];
  const leadCountByName = new Map(leadCountRows.map((r) => [r.counselor, r]));

  const staffIds = counselors.map((c) => c.id);
  const overrideRows = staffIds.length ? (await pool.query(
    `SELECT staff_id, target FROM monthly_targets WHERE staff_id = ANY($1) AND month = $2`,
    [staffIds, monthDate]
  )).rows : [];
  const overrideByStaffId = new Map(overrideRows.map((r) => [r.staff_id, r.target]));
  const callTargetOverrideByStaffId = await getCallTargetOverrides(staffIds, monthDate);

  // Calls + Basic/Final Counselling Letter counts, per counselor. Calls use
  // the unified New/Ongoing/KBM classification (confirmed 2026-08, New
  // scoped per staff member as of 2026-08) — same rule Weekly Report and
  // the Call Targets "actual" figure use, so all three agree. History (any
  // author, before this month) is needed so classifyCalls can tell whether
  // THIS counselor already reached this lead before this month — a lead
  // first reached by someone else (e.g. Presales) is still New to them.
  // Letters are counted by topic — same two topic strings Weekly Report's
  // lettersFor() already uses.
  const counselorNoteRows = counselorNames.length ? (await pool.query(
    `SELECT author_name, student_id, contact_platform, content, topic, created_at, call_answered
       FROM student_notes
      WHERE author_name = ANY($1) AND created_at >= $2 AND created_at < $3`,
    [counselorNames, startISO, endISO]
  )).rows : [];
  const counselorCallStudentIds = [...new Set(counselorNoteRows.filter(isCallNote).map((n) => n.student_id))];
  const counselorHistRows = counselorCallStudentIds.length ? (await pool.query(
    `SELECT student_id, author_name, contact_platform, content, created_at, call_answered
       FROM student_notes WHERE student_id = ANY($1) AND created_at < $2`,
    [counselorCallStudentIds, startISO]
  )).rows : [];
  const counselorClassified = classifyCalls(counselorNoteRows, counselorHistRows);
  const newByCounselor = new Map(), ongoingByCounselor = new Map(), kbmByCounselor = new Map();
  for (const it of counselorClassified.newItems)     newByCounselor.set(it.note.author_name, (newByCounselor.get(it.note.author_name) || 0) + 1);
  for (const it of counselorClassified.ongoingItems) ongoingByCounselor.set(it.note.author_name, (ongoingByCounselor.get(it.note.author_name) || 0) + 1);
  for (const it of counselorClassified.kbmItems)     kbmByCounselor.set(it.note.author_name, (kbmByCounselor.get(it.note.author_name) || 0) + 1);

  const basicLettersByCounselor = new Map();
  const finalLettersByCounselor = new Map();
  for (const n of counselorNoteRows) {
    if (n.topic === 'Basic Counselling Letter') basicLettersByCounselor.set(n.author_name, (basicLettersByCounselor.get(n.author_name) || 0) + 1);
    if (n.topic === 'Final Counselling Letter') finalLettersByCounselor.set(n.author_name, (finalLettersByCounselor.get(n.author_name) || 0) + 1);
  }

  const contractedByCounselor = new Map();
  for (const row of contractedRows) {
    if (!contractedByCounselor.has(row.counselor)) contractedByCounselor.set(row.counselor, []);
    contractedByCounselor.get(row.counselor).push(row);
  }

  const teamPerformance = counselors.map((c) => {
    const contracted = contractedByCounselor.get(c.full_name) || [];
    const byCaseType = {};
    for (const t of CASE_TYPES) byCaseType[t] = 0;
    let inSystem = 0, outSystem = 0, unclassified = 0;
    for (const row of contracted) {
      if (row.case_type && byCaseType[row.case_type] != null) byCaseType[row.case_type]++;
      if (row.is_out_of_system === true) outSystem++;
      else if (row.is_out_of_system === false) inSystem++;
      else unclassified++;
    }
    const override = overrideByStaffId.get(c.id);
    const target = override != null ? override : c.fallback_target;
    const leadCounts = leadCountByName.get(c.full_name) || { total: 0, new_this_month: 0 };
    // Per-lead detail backing this row's drill-down cells (In system/Out
    // system/case-type columns) — same "click a number, see the receipts"
    // pattern as the Contracted KPI tile, scoped to just this counselor.
    const contractedDetail = contracted.map((row) => {
      const info = sourceInfoByLead.get(row.lead_id) || {};
      return {
        leadId: row.lead_id, studentId: info.studentId, fullName: info.fullName,
        caseType: row.case_type, isOutOfSystem: row.is_out_of_system,
      };
    });
    const newCalls = newByCounselor.get(c.full_name) || 0;
    const ongoingCalls = ongoingByCounselor.get(c.full_name) || 0;
    const kbmCalls = kbmByCounselor.get(c.full_name) || 0;
    const calls = newCalls + ongoingCalls;   // Total = New + Ongoing; KBM already excluded, not subtracted again
    const callTargetOverride = callTargetOverrideByStaffId.get(c.id);
    const callsKpi = callTargetOverride != null ? callTargetOverride : c.fallback_call_target;
    return {
      staffId: c.id,
      fullName: c.full_name,
      target,
      isFallback: override == null,
      contractedTotal: contracted.length,
      inSystem, outSystem, unclassified,
      byCaseType,
      totalLeads: leadCounts.total,
      newLeadsThisMonth: leadCounts.new_this_month,
      convertRate: leadCounts.total ? Math.round((contracted.length / leadCounts.total) * 1000) / 10 : null,
      contractedLeadIds: contracted.map((r) => r.lead_id),
      contractedDetail,
      calls,
      newCalls,
      ongoingCalls,
      kbmCalls,
      callsKpi,
      pctCallsKpi: callsKpi ? Math.round((calls / callsKpi) * 1000) / 10 : null,
      basicLetters: basicLettersByCounselor.get(c.full_name) || 0,
      finalLetters: finalLettersByCounselor.get(c.full_name) || 0,
    };
  });

  // ── Contract Resources ("Nguồn HĐ") — source of leads that Contracted this month ──
  const sourceCounts = new Map();
  for (const row of contractedRows) {
    const label = sourceInfoByLead.get(row.lead_id)?.sourceLabel || '(Unknown / not recorded)';
    sourceCounts.set(label, (sourceCounts.get(label) || 0) + 1);
  }
  const contractResources = Array.from(sourceCounts, ([sourceLabel, count]) => ({ sourceLabel, count }))
    .sort((a, b) => b.count - a.count);

  // Flat list backing the "Contracted" KPI tile's drill-down (Event Report's
  // KPI-tile-click-to-expand pattern) — every lead that Contracted this
  // month, across all counselors, name + source + counselor for a quick
  // "who's behind this number" check, click-through to the lead itself.
  const contractedLeads = contractedRows.map((row) => {
    const info = sourceInfoByLead.get(row.lead_id) || {};
    return {
      leadId: row.lead_id,
      studentId: info.studentId,
      fullName: info.fullName,
      sourceLabel: info.sourceLabel || '(Unknown / not recorded)',
      counselor: row.counselor,
    };
  });

  // ── Pre-sales stats (per presales staffer) ──
  // Same unified New/Ongoing/KBM classification as the counselor section
  // above (confirmed 2026-08, New scoped per staff member as of 2026-08)
  // — history spans ANY author (not just Pre-sales), before this month,
  // matching Weekly Report's scope; classifyCalls itself narrows it down
  // to each staffer's own prior contact with a lead.
  const noteRows = presalesNames.length ? (await pool.query(
    `SELECT sn.id AS note_id, sn.author_name, sn.student_id, s.full_name,
            sn.contact_platform, sn.content, sn.created_at, sn.call_answered
       FROM student_notes sn
       JOIN students s ON s.student_id = sn.student_id
      WHERE sn.author_name = ANY($1) AND sn.created_at >= $2 AND sn.created_at < $3`,
    [presalesNames, startISO, endISO]
  )).rows : [];
  const presalesCallStudentIds = [...new Set(noteRows.filter(isCallNote).map((n) => n.student_id))];
  const presalesHistRows = presalesCallStudentIds.length ? (await pool.query(
    `SELECT student_id, author_name, contact_platform, content, created_at, call_answered
       FROM student_notes WHERE student_id = ANY($1) AND created_at < $2`,
    [presalesCallStudentIds, startISO]
  )).rows : [];
  const presalesClassified = classifyCalls(noteRows, presalesHistRows);
  const newByPresales = new Map(), ongoingByPresales = new Map(), kbmCountByName = new Map();
  for (const it of presalesClassified.newItems)     newByPresales.set(it.note.author_name, (newByPresales.get(it.note.author_name) || 0) + 1);
  for (const it of presalesClassified.ongoingItems) ongoingByPresales.set(it.note.author_name, (ongoingByPresales.get(it.note.author_name) || 0) + 1);
  for (const it of presalesClassified.kbmItems)     kbmCountByName.set(it.note.author_name, (kbmCountByName.get(it.note.author_name) || 0) + 1);

  // Per-note detail backing the "click a number, see the receipts" drill-down
  // on Total calls / KBM in the Pre-sales table — every call attempt (new,
  // ongoing, or KBM), tagged with which bucket it landed in and why.
  const bucketByNoteId = new Map();
  for (const it of presalesClassified.newItems)     bucketByNoteId.set(it.note.note_id, { bucket: 'new' });
  for (const it of presalesClassified.ongoingItems) bucketByNoteId.set(it.note.note_id, { bucket: 'ongoing' });
  for (const it of presalesClassified.kbmItems)     bucketByNoteId.set(it.note.note_id, { bucket: 'kbm', kbmSource: it.kbmSource });
  const callDetailByName = new Map();
  for (const n of noteRows.filter(isCallNote)) {
    if (!callDetailByName.has(n.author_name)) callDetailByName.set(n.author_name, []);
    const meta = bucketByNoteId.get(n.note_id) || {};
    callDetailByName.get(n.author_name).push({
      noteId: n.note_id,
      studentId: n.student_id,
      fullName: n.full_name,
      contactPlatform: n.contact_platform,
      content: n.content,
      createdAt: n.created_at,
      callAnswered: n.call_answered,
      bucket: meta.bucket || null,       // 'new' | 'ongoing' | 'kbm'
      kbmSource: meta.kbmSource || null, // 'toggle' | 'keyword' | null — why a KBM note counts as KBM
    });
  }

  const meetingRows = presalesNames.length ? (await pool.query(
    `SELECT author_name, COUNT(*)::int AS c
       FROM student_notes
      WHERE author_name = ANY($1) AND topic IN ('First Meeting', 'Second Meeting', 'Office Visit')
        AND created_at >= $2 AND created_at < $3
      GROUP BY author_name`,
    [presalesNames, startISO, endISO]
  )).rows : [];
  const meetingCountByName = new Map(meetingRows.map((r) => [r.author_name, r.c]));

  // Khách chuyển: leads whose `presales` field was cleared/changed away from
  // this staffer this month. Only catches handoffs done through Lead.update()
  // (which logs via logChanges) — the bulk distribution paths never touch
  // `presales`, so a handoff done that way won't appear here. received-by =
  // the lead's CURRENT counselor, not necessarily who received it at the
  // exact transfer moment.
  const transferRows = presalesNames.length ? (await pool.query(
    `SELECT DISTINCT ON (a.lead_id) a.lead_id, a.old_value AS presales_from, a.changed_at,
            l.person_id AS student_id, s.full_name, l.destination_country, s.stone_tier, l.counselor
       FROM audit_log a
       JOIN leads l ON l.lead_id = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name = 'presales' AND a.old_value = ANY($1)
        AND COALESCE(a.new_value, '') <> ALL($1)
        AND a.changed_at >= $2 AND a.changed_at < $3
      ORDER BY a.lead_id, a.changed_at DESC`,
    [presalesNames, startISO, endISO]
  )).rows : [];
  const transfersByName = new Map();
  for (const row of transferRows) {
    if (!transfersByName.has(row.presales_from)) transfersByName.set(row.presales_from, []);
    transfersByName.get(row.presales_from).push({
      leadId: row.lead_id, studentId: row.student_id, fullName: row.full_name,
      country: row.destination_country, stoneTier: row.stone_tier,
      receivedBy: row.counselor, transferredAt: row.changed_at,
    });
  }

  const presalesIds = presales.map((p) => p.id);
  const hoursRows = presalesIds.length ? (await pool.query(
    `SELECT staff_id, hours FROM call_hours WHERE staff_id = ANY($1) AND month = $2`,
    [presalesIds, monthDate]
  )).rows : [];
  const hoursByStaffId = new Map(hoursRows.map((r) => [r.staff_id, Number(r.hours)]));
  const presalesCallTargetOverrideByStaffId = await getCallTargetOverrides(presalesIds, monthDate);

  const presalesReport = presales.map((p) => {
    const kbmCount = kbmCountByName.get(p.full_name) || 0;
    const hours = hoursByStaffId.has(p.id) ? hoursByStaffId.get(p.id) : null;
    const newCalls = newByPresales.get(p.full_name) || 0;
    const ongoingCalls = ongoingByPresales.get(p.full_name) || 0;
    const totalCalls = newCalls + ongoingCalls;   // Total = New + Ongoing; KBM already excluded, not subtracted again
    const callTargetOverride = presalesCallTargetOverrideByStaffId.get(p.id);
    const callsKpi = callTargetOverride != null ? callTargetOverride : p.fallback_call_target;
    return {
      staffId: p.id,
      fullName: p.full_name,
      hours,
      totalCalls,
      newCalls,
      ongoingCalls,
      kbmCount,
      avgKbmPerHour: hours ? Math.round((kbmCount / hours) * 100) / 100 : null,
      meetingsCount: meetingCountByName.get(p.full_name) || 0,
      transferred: transfersByName.get(p.full_name) || [],
      callDetail: callDetailByName.get(p.full_name) || [],
      callsKpi,
      pctCallsKpi: callsKpi ? Math.round((totalCalls / callsKpi) * 1000) / 10 : null,
    };
  });

  return { month: monthLabel, teamPerformance, contractResources, contractedLeads, presalesReport };
}

// ── Giờ gọi (call hours) — manual entry, persisted per (staff, month). ──
// getCallHours(monthLabel) -> [{staffId, fullName, hours}] for presales staff.
async function getCallHours(monthLabel) {
  const { monthDate } = monthBounds(monthLabel);
  const presales = await getPresalesStaff();
  const ids = presales.map((p) => p.id);
  const rows = ids.length ? (await pool.query(
    `SELECT staff_id, hours FROM call_hours WHERE staff_id = ANY($1) AND month = $2`,
    [ids, monthDate]
  )).rows : [];
  const byStaffId = new Map(rows.map((r) => [r.staff_id, Number(r.hours)]));
  return presales.map((p) => ({ staffId: p.id, fullName: p.full_name, hours: byStaffId.has(p.id) ? byStaffId.get(p.id) : null }));
}

// saveCallHours(staffId, monthLabel, hours, updatedBy) — mirrors
// reportController.js's saveMonthlyTarget: empty/null hours deletes the row
// (reverts to "not yet entered", shown as "—", not silently 0).
async function saveCallHours(staffId, monthLabel, hours, updatedBy) {
  const { monthDate } = monthBounds(monthLabel);
  if (hours === '' || hours === null || hours === undefined) {
    await pool.query(`DELETE FROM call_hours WHERE staff_id = $1 AND month = $2`, [staffId, monthDate]);
    return { staffId: Number(staffId), month: monthLabel, hours: null };
  }
  const n = Number(hours);
  if (isNaN(n) || n < 0) throw new Error('hours must be a non-negative number');
  const r = await pool.query(
    `INSERT INTO call_hours (staff_id, month, hours, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (staff_id, month)
     DO UPDATE SET hours = EXCLUDED.hours, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING staff_id, to_char(month, 'YYYY-MM') AS month, hours`,
    [staffId, monthDate, n, updatedBy || null]
  );
  return r.rows[0];
}

// ── Monthly Report free-text notes — minimal, single-section, plain upsert
// (no append/freeze semantics like weekly_recommendations; that machinery
// wasn't asked for here and would be over-engineering for an optional field). ──
async function getMonthlyNotes(monthLabel) {
  const { monthDate } = monthBounds(monthLabel);
  const r = await pool.query(
    `SELECT content, updated_by, updated_at FROM monthly_report_notes WHERE month = $1`,
    [monthDate]
  );
  const row = r.rows[0];
  return { content: row ? row.content : '', updatedBy: row ? row.updated_by : null, updatedAt: row ? row.updated_at : null };
}

async function saveMonthlyNotes(monthLabel, content, updatedBy) {
  const { monthDate } = monthBounds(monthLabel);
  const r = await pool.query(
    `INSERT INTO monthly_report_notes (month, content, updated_by, updated_at)
          VALUES ($1, $2, $3, NOW())
     ON CONFLICT (month)
     DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING content, updated_by, updated_at`,
    [monthDate, content || '', updatedBy || null]
  );
  return r.rows[0];
}

// getMarketingMonthlyReport(monthLabel) -> { month, activities }
// Only shows activity-linked leads — students registered through the
// "Event/Campaign" Source-of-Lead mode against a real `events` row. This is
// a process dependency (marketing staff must create `events` rows for small
// activities and drive registration through that mode), not a coding gap —
// historical leads from other source modes won't retroactively appear.
async function getMarketingMonthlyReport(monthLabel) {
  const { startISO, endISO } = monthBounds(monthLabel);

  const rows = (await pool.query(
    `SELECT e.id AS event_id, e.name, e.event_type, le.student_id, rl.lead_status
       FROM events e
       JOIN lead_events le ON le.event_id = e.id
       LEFT JOIN LATERAL (
             SELECT lead_status FROM leads
              WHERE person_id = le.student_id
              ORDER BY (lead_status NOT IN ('Contracted', 'Lost', 'Archived')) DESC, lead_id DESC
              LIMIT 1
            ) rl ON true
      WHERE le.created_at >= $1 AND le.created_at < $2`,
    [startISO, endISO]
  )).rows;

  const byEvent = new Map();
  for (const row of rows) {
    if (!byEvent.has(row.event_id)) {
      byEvent.set(row.event_id, { eventId: row.event_id, name: row.name, eventType: row.event_type, leadCount: 0, byStatus: {} });
    }
    const bucket = byEvent.get(row.event_id);
    bucket.leadCount += 1;
    const status = row.lead_status || '(no lead record)';
    bucket.byStatus[status] = (bucket.byStatus[status] || 0) + 1;
  }

  // Marketing Cost per activity — reuses the Event Report budget ledger
  // as-is (zero new budget code), keyed only by event_id.
  const activities = await Promise.all(Array.from(byEvent.values()).map(async (a) => {
    let budget = null;
    try {
      budget = await eventBudget.getBudget(a.eventId);
    } catch {
      budget = null; // event has no budget rows yet — leave cost blank, not an error
    }
    return {
      ...a,
      totalCostPlanned: budget ? budget.totalCostPlanned : null,
      totalCostActual: budget ? budget.totalCostActual : null,
    };
  }));
  activities.sort((a, b) => b.leadCount - a.leadCount);

  return { month: monthLabel, activities };
}

module.exports = {
  getSalesMonthlyReport, getMarketingMonthlyReport, monthBounds, isCallNote,
  getCallHours, saveCallHours, getMonthlyNotes, saveMonthlyNotes,
};
