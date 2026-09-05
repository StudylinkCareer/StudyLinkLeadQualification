// Server/src/services/rangeReport.js
// ─────────────────────────────────────────────────────────────────────
// Individual Report / Company Report (2026-08, planned with Hong Ha) —
// generalizes Weekly Report's per-group computation (reportController.js's
// computeGroup) to an ARBITRARY [from, to) range instead of a fixed
// calendar week, so the same numbers work for weekly/monthly/yearly/custom
// period views.
//
// Deliberately a LEAF module (no dependency on reportController.js, and
// reportController.js depends on this — not the other way — so there's no
// circular require). It does NOT compute Leads Opening/In/Out/In-progress
// (that still needs reportController.js's membersAsAt, which stays there
// and gets called directly by the new route handlers alongside this) — this
// module covers Calls (New/Ongoing/KBM via the shared classifyCalls rule),
// Counselling Letters, Meetings, and Contracted-within-range + reversed.
//
// Reuses the exact same rules as computeGroup/monthlyReport.js — this is
// the whole point: the historically-disputed numbers (calls/notes) come
// from one shared classifyCalls() call, same as every other report in this
// system, not a fourth reimplementation.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
const { classifyCalls, isCallNote, normalizeMode } = require('./callClassification');
const { objectToCamelCase } = require('../utils/caseConvert');
const eventBudget = require('./eventBudget');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const VN_MS = 7 * 60 * 60 * 1000;
const vnMidnightUTC = (y, m, d) => new Date(Date.UTC(y, m, d) - VN_MS);
// The VN-calendar date (YYYY-MM-DD) a UTC instant falls on — for comparing
// a `from`/`to` range boundary against a plain DATE column (actual_close_date,
// assigned_in). NOT the same as `dt.toISOString().slice(0, 10)`: `from`/`to`
// are UTC instants representing VN-MIDNIGHT of a given day — e.g. July's
// `from` is "2026-07-01 00:00 VN", stored as the UTC instant
// "2026-06-30T17:00:00Z". Slicing that raw ISO string reads off the UTC
// calendar date, "2026-06-30" — a full day EARLIER than the VN date it's
// supposed to represent. Both `from` and `to` shift the same way, so the
// whole [from, to) window silently lands one calendar day early. Found
// 2026-09 as a real report bug: a lead signed 2026-06-30 (June) was showing
// up in the JULY report, because July's shifted window actually ran
// June 30 - July 30 instead of July 1 - July 31. Shift into VN-local time
// FIRST, matching reportController.js's vnYmd(), before reading the
// calendar fields back out.
const vnYmd = (dt) => new Date(dt.getTime() + VN_MS).toISOString().slice(0, 10);

// Same 4 buckets Monthly Report's Team Performance table uses.
const CASE_TYPES = ['Du học', 'Du học hè', 'Thị thực Du lịch', 'Thị thực Khác'];

/**
 * Resolves a period spec (from query params) into a half-open [from, to)
 * VN-anchored range, plus a bucket granularity for any "by X" breakdown.
 *   period='weekly'  + weekStart=YYYY-MM-DD  -> that VN week (Mon-Sun), bucket='day'
 *   period='monthly' + month=YYYY-MM         -> that VN month, bucket='day'
 *   period='yearly'  + year=YYYY             -> that VN year, bucket='month'
 *   period='custom'  + from=YYYY-MM-DD&to=YYYY-MM-DD -> that range (to inclusive),
 *     bucket='day' if <=31 days, 'week' if <=366 days, else 'month'
 */
function resolvePeriod(query) {
  const period = query.period || 'weekly';
  if (period === 'weekly') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.weekStart || '')) throw new Error('weekStart (YYYY-MM-DD) is required for period=weekly');
    const [y, m, d] = query.weekStart.split('-').map(Number);
    const from = vnMidnightUTC(y, m - 1, d);
    const to = new Date(from.getTime() + 7 * 86400000);
    return { period, from, to, bucket: 'day' };
  }
  if (period === 'monthly') {
    if (!/^\d{4}-\d{2}$/.test(query.month || '')) throw new Error('month (YYYY-MM) is required for period=monthly');
    const [y, m] = query.month.split('-').map(Number);
    const from = vnMidnightUTC(y, m - 1, 1);
    const to = vnMidnightUTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
    return { period, from, to, bucket: 'day' };
  }
  if (period === 'yearly') {
    if (!/^\d{4}$/.test(query.year || '')) throw new Error('year (YYYY) is required for period=yearly');
    const y = Number(query.year);
    const from = vnMidnightUTC(y, 0, 1);
    const to = vnMidnightUTC(y + 1, 0, 1);
    return { period, from, to, bucket: 'month' };
  }
  if (period === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) {
      throw new Error('from and to (YYYY-MM-DD) are required for period=custom');
    }
    const [fy, fm, fd] = query.from.split('-').map(Number);
    const [ty, tm, td] = query.to.split('-').map(Number);
    const from = vnMidnightUTC(fy, fm - 1, fd);
    const to = new Date(vnMidnightUTC(ty, tm - 1, td).getTime() + 86400000); // 'to' is inclusive
    if (to <= from) throw new Error('to must be on or after from');
    const spanDays = (to.getTime() - from.getTime()) / 86400000;
    const bucket = spanDays <= 31 ? 'day' : spanDays <= 366 ? 'week' : 'month';
    return { period, from, to, bucket };
  }
  throw new Error(`Unknown period '${period}' — expected weekly, monthly, yearly, or custom`);
}

// VN calendar-date key for bucketing — 'day' -> YYYY-MM-DD, 'week' -> the VN
// Monday's YYYY-MM-DD, 'month' -> YYYY-MM.
function bucketKeyOf(ms, granularity) {
  const vn = new Date(ms + VN_MS);
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth(), d = vn.getUTCDate();
  if (granularity === 'month') return `${y}-${String(m + 1).padStart(2, '0')}`;
  if (granularity === 'week') {
    const dow = (vn.getUTCDay() + 6) % 7; // 0=Mon
    const mon = new Date(Date.UTC(y, m, d - dow));
    return mon.toISOString().slice(0, 10);
  }
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// VN-local day-of-week for an instant, 0=Mon..6=Sun (call_day_targets'/
// presales_working_hours' convention).
function dowOf(ms) {
  const vn = new Date(ms + VN_MS);
  return (vn.getUTCDay() + 6) % 7;
}
function monthKeyOf(ms) {
  const vn = new Date(ms + VN_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Same hardcoded fallback as reportController.js's CALL_TARGETS — used only
// if NO month has ever been configured in call_day_targets at all.
const COUNSELOR_DEFAULT = { new: [10, 10, 10, 10, 10, 5, 0], ongoing: [5, 5, 5, 5, 5, 2, 0] };

/**
 * Counsellors' role-wide daily New/Ongoing target, summed across every
 * calendar day in [from, to) — same "copy forward the most recent earlier
 * month" semantics as reportController.js's loadDayTargets() (Weekly
 * Report), just totalled over an arbitrary range instead of exactly 7 days.
 * Same for every counsellor (role-wide), so callers compute this ONCE per
 * report, not once per person.
 */
// `granularity` ('day'/'week'/'month', matching computeRangeReport's own
// bucket choice) also returns a per-bucket breakdown for a "Calls by X"
// table with target columns — omit it to skip that work when only the
// grand total is needed (e.g. Company Report's StaffTable row).
async function counselorTargetForRange(from, to, granularity = null) {
  const rows = (await pool.query(
    `SELECT to_char(month,'YYYY-MM-01') AS month, day_of_week, new_target, ongoing_target
       FROM call_day_targets WHERE role = 'Counselor' ORDER BY month`
  )).rows;
  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, [null, null, null, null, null, null, null]);
    byMonth.get(r.month)[r.day_of_week] = { new: r.new_target, ongoing: r.ongoing_target };
  }
  const months = [...byMonth.keys()].sort();
  function forDay(monthKey, dow) {
    let best = null;
    for (const m of months) { if (m <= monthKey) best = m; else break; }
    const row = best ? byMonth.get(best)[dow] : null;
    return row || { new: COUNSELOR_DEFAULT.new[dow], ongoing: COUNSELOR_DEFAULT.ongoing[dow] };
  }
  let totalNew = 0, totalOngoing = 0;
  const bucketMap = granularity ? new Map() : null;
  for (let ms = from.getTime(); ms < to.getTime(); ms += 86400000) {
    const t = forDay(monthKeyOf(ms), dowOf(ms));
    totalNew += t.new; totalOngoing += t.ongoing;
    if (bucketMap) {
      const key = bucketKeyOf(ms, granularity);
      if (!bucketMap.has(key)) bucketMap.set(key, { bucket: key, new: 0, ongoing: 0 });
      const b = bucketMap.get(key);
      b.new += t.new; b.ongoing += t.ongoing;
    }
  }
  const result = { new: totalNew, ongoing: totalOngoing, total: totalNew + totalOngoing };
  if (bucketMap) result.byBucket = [...bucketMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  return result;
}

/**
 * One Pre-Sales person's own daily hours x 8, summed across every calendar
 * day in [from, to) — combined New+Ongoing target (no split, per Hong Ha).
 * Same copy-forward-per-month semantics as the round-robin's capacity calc
 * (uncontactableTransfer.js pickNextPresales), per-individual not role-wide.
 */
async function presalesTargetForRange(fullName, from, to, granularity = null) {
  const rows = (await pool.query(
    `SELECT to_char(wh.month,'YYYY-MM-01') AS month, wh.day_of_week, wh.hours
       FROM presales_working_hours wh JOIN staff s ON s.id = wh.staff_id
      WHERE s.full_name = $1 ORDER BY wh.month`,
    [fullName]
  )).rows;
  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, [0, 0, 0, 0, 0, 0, 0]);
    byMonth.get(r.month)[r.day_of_week] = Number(r.hours);
  }
  const months = [...byMonth.keys()].sort();
  function hoursForDay(monthKey, dow) {
    let best = null;
    for (const m of months) { if (m <= monthKey) best = m; else break; }
    return best ? byMonth.get(best)[dow] : 0;
  }
  let totalHours = 0;
  const bucketMap = granularity ? new Map() : null;
  for (let ms = from.getTime(); ms < to.getTime(); ms += 86400000) {
    const h = hoursForDay(monthKeyOf(ms), dowOf(ms));
    totalHours += h;
    if (bucketMap) {
      const key = bucketKeyOf(ms, granularity);
      if (!bucketMap.has(key)) bucketMap.set(key, { bucket: key, hours: 0, total: 0 });
      const b = bucketMap.get(key);
      b.hours += h; b.total += h * 8;
    }
  }
  const result = { hours: totalHours, total: totalHours * 8 };
  if (bucketMap) result.byBucket = [...bucketMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  return result;
}

/**
 * Calls (New/Ongoing/KBM), Counselling Letters, Meetings, Contracted-in-
 * range + reversed, for a group of staff names over [from, to). Same
 * classification rule and history-scoping as computeGroup (reportController.js)
 * / monthlyReport.js — student_id-scoped history, no author filter, so the
 * per-(student,author) "have I ever contacted this lead before" check is
 * correct regardless of how far back `from` is.
 */
async function computeRangeReport(names, from, to, opts = {}) {
  const fromISO = from.toISOString(), toISO = to.toISOString();
  const bucket = opts.bucket || 'day';

  const periodNoteRows = names.length ? (await pool.query(
    `SELECT sn.student_id, sn.author_name, sn.contact_platform, sn.content, sn.created_at, sn.call_answered, s.full_name
       FROM student_notes sn JOIN students s ON s.student_id = sn.student_id
      WHERE sn.author_name = ANY($1) AND sn.created_at >= $2 AND sn.created_at < $3`,
    [names, fromISO, toISO])).rows : [];

  const callStudentIds = [...new Set(periodNoteRows.filter(isCallNote).map(c => c.student_id))];
  // Same shape as computeGroup's histRows: student_id-scoped, NO author
  // filter, everything before the period start — required for New/Ongoing
  // to correctly credit "New" to a staffer's genuine first-ever contact
  // with that lead, regardless of who else touched it earlier.
  const histRows = callStudentIds.length ? (await pool.query(
    `SELECT student_id, author_name, contact_platform, content, created_at, call_answered
       FROM student_notes WHERE student_id = ANY($1) AND created_at < $2`,
    [callStudentIds, fromISO])).rows : [];

  const classified = classifyCalls(periodNoteRows, histRows);

  // Bucketed breakdown (for a chart) — day/week/month depending on span.
  const bucketMap = new Map(); // key -> { newLeads, ongoing }
  for (const [kind, items] of [['newLeads', classified.newItems], ['ongoing', classified.ongoingItems]]) {
    for (const item of items) {
      const key = bucketKeyOf(new Date(item.note.created_at).getTime(), bucket);
      if (!bucketMap.has(key)) bucketMap.set(key, { bucket: key, newLeads: 0, ongoing: 0 });
      bucketMap.get(key)[kind]++;
    }
  }
  const callsByBucket = [...bucketMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  const platforms = {};
  // Day/week/month x platform matrix — same shape as Weekly Report's
  // modeDaily (ByModeMatrix component), generalized past exactly 7 days.
  // normalizeMode() collapses raw contact_platform variants (an explicit
  // "Phone Call" note vs a null-platform one, plus any other free-text
  // spelling) down to the same 6 canonical modes computeGroup uses — found
  // 2026-09 that this was missing here, so "Phone Call" and the null-
  // platform fallback were showing as two separate columns in the mode
  // matrix for the exact same thing.
  const modeMap = new Map(); // bucketKey -> { platform -> count }
  for (const [kind, items] of [['newCount', classified.newItems], ['ongoing', classified.ongoingItems]]) {
    for (const item of items) {
      const raw = normalizeMode(item.note.contact_platform);
      platforms[raw] = platforms[raw] || { platform: raw, newCount: 0, ongoing: 0 };
      platforms[raw][kind]++;
      const key = bucketKeyOf(new Date(item.note.created_at).getTime(), bucket);
      if (!modeMap.has(key)) modeMap.set(key, {});
      const row = modeMap.get(key);
      row[raw] = (row[raw] || 0) + 1;
    }
  }
  const modeByBucket = [...modeMap.entries()].map(([k, byMode]) => ({ bucket: k, byMode })).sort((a, b) => a.bucket.localeCompare(b.bucket));

  const lettersFor = async (topic) => {
    const rows = (await pool.query(
      `SELECT sn.student_id, s.full_name, l.destination_country
         FROM student_notes sn
         JOIN students s ON s.student_id = sn.student_id
         LEFT JOIN leads l ON l.lead_id = sn.lead_id
        WHERE sn.author_name = ANY($1) AND sn.topic = $2 AND sn.created_at >= $3 AND sn.created_at < $4`,
      [names, topic, fromISO, toISO])).rows;
    return { count: rows.length, items: rows.map(objectToCamelCase) };
  };
  const basicLetters = names.length ? await lettersFor('Basic Counselling Letter') : { count: 0, items: [] };
  const finalLetters = names.length ? await lettersFor('Final Counselling Letter') : { count: 0, items: [] };

  const meetings = names.length ? (await pool.query(
    `SELECT sn.student_id, s.full_name, sn.topic, sn.meeting_location
       FROM student_notes sn JOIN students s ON s.student_id = sn.student_id
      WHERE sn.author_name = ANY($1)
        AND sn.topic IN ('First Meeting','Second Meeting','Office Visit')
        AND sn.created_at >= $2 AND sn.created_at < $3`,
    [names, fromISO, toISO])).rows.map(objectToCamelCase) : [];

  // Contracted within the range — actual_close_date (real signing date),
  // not filtered by current lead_status, same rule as contractedBuckets /
  // Monthly Report: a lead reversed after signing still counts as a signing
  // for the period it signed in. Selects case_type/is_out_of_system/source
  // fields too — same data Monthly Report's Team Performance case-type
  // columns and Contract Sources use, computed below rather than a second
  // round-trip query.
  //
  // Matches on `names` (counselor OR presales) — same population as calls/
  // letters/meetings above, deliberately NOT narrowed to counsellorNames
  // only. A lead can be Contracted with only a Pre-Sales assignment and no
  // counselor (closed directly by Pre-Sales, no handoff) — an earlier pass
  // (2026-09) narrowed Company Report's company-wide contracted total to
  // counsellorNames to make it match Team Performance's counselor-only sum,
  // which fixed THAT mismatch but made those Pre-Sales-closed contracts
  // disappear from the report entirely (Hong Ha caught this — a real
  // contract, Phan Thị Mỹ Tiên/Phạm Thị Ngọc Thảo, wasn't listed anywhere).
  // Reverted: groupReport's presales row mapper now also surfaces its own
  // `contracted` count/items, so Team Performance's sum + Pre-sales'
  // Contracted column together equal the company-wide total again — the
  // right fix is showing where the number comes from, not making the
  // number smaller. (Verified no lead has BOTH counselor and presales set
  // to a roster name simultaneously, so this can't double-count between
  // the two tables.)
  const contractedRows = names.length ? (await pool.query(
    `SELECT l.lead_id, l.person_id AS student_id, s.full_name, l.destination_country,
            l.case_type, l.is_out_of_system, s.lead_source, s.source, s.source_detail,
            l.created_at AS lead_created_at, l.actual_close_date,
            COALESCE(solv.label_vi, solv.label_en, solv.code) AS sol_label,
            ev.campaign_names
       FROM leads l JOIN students s ON s.student_id = l.person_id
       LEFT JOIN lookup_values solv ON solv.category = 'source_of_lead' AND solv.code = s.lead_source
       LEFT JOIN LATERAL (
             SELECT string_agg(DISTINCT e.name, ', ') AS campaign_names
               FROM lead_events le JOIN events e ON e.id = le.event_id
              WHERE le.student_id = l.person_id
            ) ev ON true
      WHERE (l.counselor = ANY($1) OR l.presales = ANY($1))
        AND l.actual_close_date >= $2 AND l.actual_close_date < $3`,
    [names, vnYmd(from), vnYmd(to)])).rows : [];

  // Case-type split + in/out system — same 4 buckets Monthly Report's Team
  // Performance table uses.
  const caseTypeBreakdown = {};
  for (const t of CASE_TYPES) caseTypeBreakdown[t] = 0;
  let inSystemCount = 0, outSystemCount = 0, unclassifiedCount = 0;
  for (const r of contractedRows) {
    if (CASE_TYPES.includes(r.case_type)) caseTypeBreakdown[r.case_type]++;
    if (r.is_out_of_system === true) outSystemCount++;
    else if (r.is_out_of_system === false) inSystemCount++;
    else unclassifiedCount++;
  }
  // Contract Sources — grouped by the Source of Lead field (students.lead_source,
  // resolved through the source_of_lead lookup list) rather than the legacy
  // source/source_detail free-text columns Monthly Report used (2026-09,
  // Hong Ha's fix — Source of Lead is the actively-maintained field; the old
  // ones are being phased out).
  //
  // Per-contract drilldown fields (2026-09, Hoàng's ask): the grouping key
  // above stays the clean, actively-maintained Source of Lead bucket, but
  // each contract underneath it also carries the legacy source/source_detail
  // pair as "specific source" (Nguồn cụ thể) — this is the exact free-text
  // Monthly Report used to show as ITS single source label (e.g. "Database -
  // Onshore" + "PTE LIFE"), so nothing is lost by grouping on the cleaner
  // field above. Campaign comes from lead_events/events (the same link
  // Marketing Activities counts leads through), not students.campaign_name/
  // campaign_type — those free-text fields were empty on every August
  // contract checked live; the event link is what's actually populated.
  const dayMs = 24 * 60 * 60 * 1000;
  const detailFor = (r) => {
    const specificSource = [r.source, r.source_detail].filter(Boolean).join(' - ') || null;
    const leadCreatedAt = r.lead_created_at ? new Date(r.lead_created_at).toISOString() : null;
    const actualCloseDate = r.actual_close_date ? new Date(r.actual_close_date).toISOString() : null;
    const daysToClose = (leadCreatedAt && actualCloseDate)
      ? Math.round((new Date(actualCloseDate) - new Date(leadCreatedAt)) / dayMs)
      : null;
    return {
      leadId: r.lead_id, studentId: r.student_id, fullName: r.full_name,
      specificSource, campaign: r.campaign_names || null,
      leadCreatedAt, actualCloseDate, daysToClose,
    };
  };
  const sourceBuckets = new Map();
  for (const r of contractedRows) {
    const label = r.sol_label || '(Unknown / not recorded)';
    if (!sourceBuckets.has(label)) sourceBuckets.set(label, []);
    sourceBuckets.get(label).push(detailFor(r));
  }
  const contractSources = [...sourceBuckets.entries()]
    .map(([source, items]) => ({ source, count: items.length, items }))
    .sort((a, b) => b.count - a.count);

  const contractedItems = contractedRows.map(objectToCamelCase);

  // Reversed: signed (per audit log) within the range, but no longer
  // Contracted now. Mirrors contractedBuckets' 'reversed' bucket, scoped to
  // the period instead of "this year".
  const reversedRows = names.length ? (await pool.query(
    `SELECT DISTINCT ON (a.lead_id) a.lead_id, l.person_id AS student_id, s.full_name
       FROM audit_log a
       JOIN leads l ON l.lead_id = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name = 'leadStatus' AND a.new_value = 'Contracted'
        AND a.changed_at >= $2 AND a.changed_at < $3
        AND (l.counselor = ANY($1) OR l.presales = ANY($1))
        AND l.lead_status <> 'Contracted'
      ORDER BY a.lead_id, a.changed_at DESC`,
    [names, fromISO, toISO])).rows.map(objectToCamelCase) : [];

  return {
    calls: {
      byBucket: callsByBucket, bucket, modeByBucket,
      byPlatform: Object.values(platforms),
      totals: { newLeads: classified.newCount, ongoing: classified.ongoingCount, kbm: classified.kbmCount },
      newLeadItems: classified.newItems.map(it => ({ studentId: it.studentId, fullName: it.fullName })),
      ongoingItems: classified.ongoingItems.map(it => ({ studentId: it.studentId, fullName: it.fullName, dayKey: it.dayKey, slot: it.slot })),
      kbmItems: classified.kbmItems.map(it => ({ studentId: it.studentId, fullName: it.fullName })),
    },
    basicLetters, finalLetters,
    meetings: { count: meetings.length, items: meetings },
    contracted: {
      count: contractedRows.length, items: contractedItems,
      caseTypeBreakdown, inSystemCount, outSystemCount, unclassifiedCount,
    },
    contractSources,
    reversed: { count: reversedRows.length, items: reversedRows },
  };
}

// Contract-SIGNING target (monthly_targets override, else staff.target
// fallback) — a genuinely different metric from the calls-volume target
// above (counselorTargetForRange/presalesTargetForRange), and deliberately
// kept separate rather than reused under the same "target" label: this is
// "how many contracts should you sign," not "how many calls should you
// make." Old Monthly Report's Team Performance table showed this; Telesales
// showed the calls one — conflating them under one ambiguous "Target"
// column was a real mistake caught while porting (2026-09).
//
// Only meaningful at whole-calendar-month granularity — monthly_targets has
// no week/day-level breakdown, and prorating a monthly commitment down to a
// partial period would fabricate a number nobody actually set. Sums every
// whole calendar month fully contained in [from, to); returns null (not a
// fabricated 0) if no whole month is contained — e.g. a weekly period, or a
// custom range that doesn't happen to line up with full months.
async function contractTargetForRange(fullName, from, to) {
  const staffRes = await pool.query(`SELECT id, COALESCE(target, 0) AS fallback FROM staff WHERE full_name = $1`, [fullName]);
  if (staffRes.rows.length === 0) return null;
  const { id: staffId, fallback } = staffRes.rows[0];

  const months = [];
  let cursor = new Date(from.getTime());
  while (cursor < to) {
    const vn = new Date(cursor.getTime() + VN_MS);
    const y = vn.getUTCFullYear(), m = vn.getUTCMonth();
    const monthStart = vnMidnightUTC(y, m, 1);
    const monthEnd = vnMidnightUTC(y, m + 1, 1);
    if (monthStart >= from && monthEnd <= to) months.push(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    cursor = monthEnd;
  }
  if (months.length === 0) return null;

  const overrides = (await pool.query(
    `SELECT to_char(month,'YYYY-MM-DD') AS month, target FROM monthly_targets WHERE staff_id = $1 AND month = ANY($2)`,
    [staffId, months]
  )).rows;
  const overrideMap = new Map(overrides.map(r => [r.month, r.target]));
  const total = months.reduce((sum, m) => sum + (overrideMap.has(m) ? overrideMap.get(m) : fallback), 0);
  return { total, months: months.length };
}

// Total leads (current assignment, not a historical reconstruction — same
// "as of right now" scoping Monthly Report's Team Performance table uses,
// not week/month-bound) + New this period (assigned_in falls in [from,to)),
// per name, for whichever assignment column applies ('counselor' for
// Counsellors, 'presales' for Pre-Sales).
async function leadCounts(names, column, from, to) {
  if (!names.length) return new Map();
  const col = column === 'presales' ? 'presales' : 'counselor';
  const rows = (await pool.query(
    `SELECT ${col} AS name, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE assigned_in >= $1 AND assigned_in < $2)::int AS new_this_period
       FROM leads WHERE ${col} = ANY($3)
       GROUP BY ${col}`,
    [vnYmd(from), vnYmd(to), names]
  )).rows;
  return new Map(rows.map(r => [r.name, { total: r.total, newThisPeriod: r.new_this_period }]));
}

// "Khách chuyển" — leads whose `presales` field was cleared/changed away
// from one of `names` within [from, to). Ported verbatim from Monthly
// Report's getSalesMonthlyReport, generalized past a calendar month. Only
// catches handoffs done through Lead.update() (which logs via logChanges —
// the bulk distribution paths never touch `presales`, so a handoff done
// that way won't appear here, same caveat the old page had). received-by is
// the lead's CURRENT counselor, not necessarily who received it at the
// exact transfer moment.
async function transfersToSalesForRange(names, from, to) {
  if (!names.length) return new Map();
  const rows = (await pool.query(
    `SELECT DISTINCT ON (a.lead_id) a.lead_id, a.old_value AS presales_from, a.changed_at,
            l.person_id AS student_id, s.full_name, l.destination_country, l.counselor
       FROM audit_log a
       JOIN leads l ON l.lead_id = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name = 'presales' AND a.old_value = ANY($1)
        AND COALESCE(a.new_value, '') <> ALL($1)
        AND a.changed_at >= $2 AND a.changed_at < $3
      ORDER BY a.lead_id, a.changed_at DESC`,
    [names, from.toISOString(), to.toISOString()]
  )).rows;
  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.presales_from)) byName.set(row.presales_from, []);
    byName.get(row.presales_from).push({
      leadId: row.lead_id, studentId: row.student_id, fullName: row.full_name,
      destinationCountry: row.destination_country, receivedBy: row.counselor, transferredAt: row.changed_at,
    });
  }
  return byName;
}

// Marketing Activities — ported verbatim from Monthly Report's
// getMarketingMonthlyReport, generalized past a calendar month. Company-
// wide only (same as the original — never scoped to a single staffer,
// hence no `names` param), reuses the Event Report budget ledger as-is via
// eventBudget.getBudget() (zero new budget code).
async function marketingActivitiesForRange(from, to) {
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
    [from.toISOString(), to.toISOString()]
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

  const activities = await Promise.all([...byEvent.values()].map(async (a) => {
    let budget = null;
    try { budget = await eventBudget.getBudget(a.eventId); } catch { budget = null; }
    return { ...a, totalCostPlanned: budget ? budget.totalCostPlanned : null, totalCostActual: budget ? budget.totalCostActual : null };
  }));
  activities.sort((a, b) => b.leadCount - a.leadCount);
  return activities;
}

module.exports = {
  resolvePeriod, computeRangeReport, counselorTargetForRange, presalesTargetForRange,
  contractTargetForRange, leadCounts, transfersToSalesForRange, marketingActivitiesForRange,
  CASE_TYPES, vnMidnightUTC, VN_MS,
};
