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
const { classifyCalls, isCallNote } = require('./callClassification');
const { objectToCamelCase } = require('../utils/caseConvert');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const VN_MS = 7 * 60 * 60 * 1000;
const vnMidnightUTC = (y, m, d) => new Date(Date.UTC(y, m, d) - VN_MS);

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
  for (const [kind, items] of [['newCount', classified.newItems], ['ongoing', classified.ongoingItems]]) {
    for (const item of items) {
      const raw = item.note.contact_platform || 'Phone call';
      platforms[raw] = platforms[raw] || { platform: raw, newCount: 0, ongoing: 0 };
      platforms[raw][kind]++;
    }
  }

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
  // for the period it signed in.
  const contractedRows = names.length ? (await pool.query(
    `SELECT l.lead_id, l.person_id AS student_id, s.full_name, l.destination_country
       FROM leads l JOIN students s ON s.student_id = l.person_id
      WHERE (l.counselor = ANY($1) OR l.presales = ANY($1))
        AND l.actual_close_date >= $2 AND l.actual_close_date < $3`,
    [names, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)])).rows.map(objectToCamelCase) : [];

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
      byBucket: callsByBucket, bucket,
      byPlatform: Object.values(platforms),
      totals: { newLeads: classified.newCount, ongoing: classified.ongoingCount, kbm: classified.kbmCount },
      newLeadItems: classified.newItems.map(it => ({ studentId: it.studentId, fullName: it.fullName })),
      ongoingItems: classified.ongoingItems.map(it => ({ studentId: it.studentId, fullName: it.fullName, dayKey: it.dayKey, slot: it.slot })),
      kbmItems: classified.kbmItems.map(it => ({ studentId: it.studentId, fullName: it.fullName })),
    },
    basicLetters, finalLetters,
    meetings: { count: meetings.length, items: meetings },
    contracted: { count: contractedRows.length, items: contractedRows },
    reversed: { count: reversedRows.length, items: reversedRows },
  };
}

module.exports = { resolvePeriod, computeRangeReport, vnMidnightUTC, VN_MS };
