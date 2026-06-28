// server/src/controllers/reportController.js
//
// PURPOSE
//   Activity Report — aggregates note activity across leads to surface
//   "who is calling vs writing notes" patterns for managers, and to give
//   counselors a view of their own follow-up activity on high-tier leads.
//
// ENDPOINTS
//   GET /api/reports/notes-activity
//     Query params (all optional):
//       dateFrom        ISO date (default: today - 10 days)
//       dateTo          ISO date (default: today)
//       staffName       filter to one assigned counselor / presales person
//       tier            filter to one stone tier (Diamond, Ruby, ...)
//       status          filter to one lead status
//       noteType        filter to one note type ('counselor'/'presales'/'management')
//
// RBAC
//   Route is gated by requirePermission('reports', 'view'). Within that:
//     - scope='all'  → see every lead's activity
//     - scope='own'  → only leads where the caller is assigned in any
//                       of the 4 staff slots
//   Counselors don't see other counselors' rows in the breakdown — the
//   staff aggregation is filtered to themselves.
//
// AGGREGATION STRATEGY
//   1. Single SQL query pulls all notes in the date window joined to
//      their lead (limited to leads the caller can see).
//   2. JS classifies each note as 'phone' or 'other' using the
//      phoneAliases matcher.
//   3. Roll-ups are computed in JS by grouping the classified rows.
//      ~10k notes max, runs in single-digit ms.
//
//   This keeps the alias list editable in one place (the Node service)
//   without coupling to Postgres regex internals.

const { Pool } = require('pg');
const permissionService    = require('../services/permissionService');
const { containsPhoneMention } = require('../services/phoneAliases');
const { objectToCamelCase }    = require('../utils/caseConvert');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Bucket assignment for a single note — used everywhere downstream.
function bucketFor(noteContent) {
  return containsPhoneMention(noteContent) ? 'phone' : 'other';
}

// Best-effort identification of the "responsible staff" for a lead.
// Used to attribute notes to staff in the breakdown. Order of preference:
//   counselor → senior_counselor → presales → marketing_staff
// Returns '(unassigned)' if all four slots are empty.
function primaryStaffOf(lead) {
  return lead.counselor
      || lead.seniorCounselor
      || lead.presales
      || lead.marketingStaff
      || '(unassigned)';
}

async function notesActivity(req, res, next) {
  try {
    const staffRole = req.session.staffRole;
    const staffName = req.session.staffName;

    // ── Permission scope ─────────────────────────────────────
    const scope = await permissionService.getResourceScope(staffRole, 'reports', 'view');
    if (!scope || scope === 'none') {
      return res.status(403).json({ success: false, error: 'Not authorised to view reports' });
    }

    // ── Date window — default last 10 days, inclusive ────────
    const now      = new Date();
    const defaultFrom = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom)         : defaultFrom;
    const dateTo   = req.query.dateTo   ? new Date(req.query.dateTo + 'T23:59:59') : now;

    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date parameter' });
    }

    // ── Optional filters from query ──────────────────────────
    const filterStaff    = req.query.staffName ? String(req.query.staffName) : null;
    const filterTier     = req.query.tier      ? String(req.query.tier)      : null;
    const filterStatus   = req.query.status    ? String(req.query.status)    : null;
    const filterNoteType = req.query.noteType  ? String(req.query.noteType)  : null;

    // ── Build the SQL ────────────────────────────────────────
    // We need every note in the window + minimal lead context. LEFT JOIN
    // (rather than INNER) ensures we don't lose orphaned notes (shouldn't
    // exist, but safer).
    //
    // Parameterised filters appended dynamically so we don't have empty
    // AND clauses cluttering the plan.
    const params = [dateFrom.toISOString(), dateTo.toISOString()];
    const where  = ['n.created_at >= $1', 'n.created_at <= $2'];

    if (scope === 'own') {
      // Restrict to leads where the caller is assigned in any of the four slots.
      params.push(staffName);
      const p = `$${params.length}`;
      where.push(`(l.counselor = ${p} OR l.senior_counselor = ${p} OR l.presales = ${p} OR l.marketing_staff = ${p})`);
    }
    if (filterStaff) {
      params.push(filterStaff);
      const p = `$${params.length}`;
      where.push(`(l.counselor = ${p} OR l.senior_counselor = ${p} OR l.presales = ${p} OR l.marketing_staff = ${p})`);
    }
    if (filterTier) {
      params.push(filterTier);
      where.push(`s.stone_tier = $${params.length}`);
    }
    if (filterStatus) {
      params.push(filterStatus);
      where.push(`l.lead_status = $${params.length}`);
    }
    if (filterNoteType) {
      params.push(filterNoteType);
      where.push(`n.note_type = $${params.length}`);
    }

    const sql = `
      SELECT
        n.id              AS note_id,
        n.student_id,
        n.note_type,
        n.content,
        n.author_id,
        n.author_name,
        n.created_at,
        s.full_name       AS lead_name,
        s.stone_tier,
        l.lead_status,
        l.counselor,
        l.senior_counselor,
        l.presales,
        l.marketing_staff
      FROM student_notes n
      INNER JOIN students s ON s.student_id = n.student_id
      LEFT JOIN  leads    l ON l.lead_id    = n.lead_id
      WHERE ${where.join(' AND ')}
      ORDER BY n.created_at DESC
    `;

    const result = await pool.query(sql, params);
    const rows   = result.rows.map(objectToCamelCase);

    // ── Second query: ALL leads (irrespective of notes) ──────
    // The notes query above is filtered by date window + RBAC scope; we
    // still want totals to respect those constraints (RBAC scope yes,
    // date window no — totals are point-in-time, not date-bounded).
    //
    // We don't apply tier/status/staff filters from the query string here
    // because the frontend uses this full set to compute "leads in this
    // drill context" at every level. Applying those filters server-side
    // would prevent the frontend from re-aggregating during drill.
    const leadWhere  = [];
    const leadParams = [];
    if (scope === 'own') {
      leadParams.push(staffName);
      const p = `$${leadParams.length}`;
      leadWhere.push(`(l.counselor = ${p} OR l.senior_counselor = ${p} OR l.presales = ${p} OR l.marketing_staff = ${p})`);
    }
    const leadSql = `
      SELECT l.person_id AS student_id, s.full_name, s.stone_tier, l.lead_status,
             l.counselor, l.senior_counselor, l.presales, l.marketing_staff
      FROM leads l
      JOIN students s ON s.student_id = l.person_id
      ${leadWhere.length ? `WHERE ${leadWhere.join(' AND ')}` : ''}
    `;
    const leadResult = await pool.query(leadSql, leadParams);
    const allLeads   = leadResult.rows.map(objectToCamelCase).map(l => ({
      ...l,
      primaryStaff: primaryStaffOf(l),
    }));

    // ── Classify each note ───────────────────────────────────
    const classified = rows.map(r => ({
      ...r,
      bucket: bucketFor(r.content),
      primaryStaff: primaryStaffOf(r),
    }));

    // ── Roll-ups for the dashboard charts ────────────────────
    // 1. KPIs (overall)
    // 2. By staff
    // 3. By stone tier
    // 4. By lead status
    // 5. By lead (for the drill-down table at the bottom)
    //
    // All counts include both phone + other; phone is reported separately.
    const kpi = {
      totalNotes:    classified.length,
      phoneNotes:    classified.filter(r => r.bucket === 'phone').length,
      uniqueLeads:   new Set(classified.map(r => r.studentId)).size,
      leadsWithPhone: new Set(
        classified.filter(r => r.bucket === 'phone').map(r => r.studentId)
      ).size,
    };

    // Roll-up over notes, with an optional accessor for matching the
    // SAME category against the full leads list to compute "total leads
    // assigned in this category" (independent of whether they have notes).
    function rollUp(noteKeyFn, leadKeyFn) {
      const map = new Map();
      for (const r of classified) {
        const key = noteKeyFn(r) || '(none)';
        if (!map.has(key)) {
          map.set(key, { key, totalNotes: 0, phoneNotes: 0, leadIds: new Set() });
        }
        const e = map.get(key);
        e.totalNotes += 1;
        if (r.bucket === 'phone') e.phoneNotes += 1;
        e.leadIds.add(r.studentId);
      }
      // Compute total leads per category from the full leads list.
      // If leadKeyFn is supplied, use it; otherwise leave totalLeads as
      // uniqueLeads-with-notes (caller decides).
      const totalLeadsByKey = new Map();
      if (leadKeyFn) {
        for (const l of allLeads) {
          const k = leadKeyFn(l) || '(none)';
          totalLeadsByKey.set(k, (totalLeadsByKey.get(k) || 0) + 1);
        }
        // Also ensure every category present in totalLeads but absent in
        // notes shows up with zero notes (so a tier with no notes still
        // renders with its total).
        for (const k of totalLeadsByKey.keys()) {
          if (!map.has(k)) {
            map.set(k, { key: k, totalNotes: 0, phoneNotes: 0, leadIds: new Set() });
          }
        }
      }
      return [...map.values()]
        .map(e => ({
          key:                e.key,
          totalNotes:         e.totalNotes,
          phoneNotes:         e.phoneNotes,
          otherNotes:         e.totalNotes - e.phoneNotes,
          uniqueLeads:        e.leadIds.size,                // leads w/ notes
          totalLeads:         totalLeadsByKey.get(e.key) ?? e.leadIds.size,
        }))
        .sort((a, b) => b.totalNotes - a.totalNotes);
    }

    // For staff aggregation, a lead can appear in multiple staff slots
    // (counselor + senior_counselor + presales + marketing_staff). We
    // treat the primary staff (first non-empty of those four) as the
    // canonical assignment, matching how the byLead rollup attributes notes.
    const byStaff  = rollUp(r => r.primaryStaff, l => l.primaryStaff);
    const byTier   = rollUp(r => r.stoneTier,    l => l.stoneTier);
    const byStatus = rollUp(r => r.leadStatus,   l => l.leadStatus);

    // By-lead breakdown — one row per lead, with last-call timestamp.
    const leadMap = new Map();
    for (const r of classified) {
      if (!leadMap.has(r.studentId)) {
        leadMap.set(r.studentId, {
          studentId:        r.studentId,
          leadName:         r.leadName,
          stoneTier:        r.stoneTier,
          leadStatus:       r.leadStatus,
          primaryStaff:     r.primaryStaff,
          totalNotes:       0,
          phoneNotes:       0,
          lastPhoneAt:      null,
          lastNoteAt:       null,
        });
      }
      const e = leadMap.get(r.studentId);
      e.totalNotes += 1;
      if (!e.lastNoteAt || r.createdAt > e.lastNoteAt) e.lastNoteAt = r.createdAt;
      if (r.bucket === 'phone') {
        e.phoneNotes += 1;
        if (!e.lastPhoneAt || r.createdAt > e.lastPhoneAt) e.lastPhoneAt = r.createdAt;
      }
    }
    const byLead = [...leadMap.values()].map(e => ({
      ...e,
      otherNotes:    e.totalNotes - e.phoneNotes,
      daysSincePhone: e.lastPhoneAt
        ? Math.floor((Date.now() - new Date(e.lastPhoneAt).getTime()) / 86400000)
        : null,
    }))
    .sort((a, b) => {
      // Sort by "needs attention" by default: leads with phone notes first,
      // then by recency of last note (oldest first — those need contact most).
      if ((b.phoneNotes > 0) !== (a.phoneNotes > 0)) {
        return (b.phoneNotes > 0 ? 1 : 0) - (a.phoneNotes > 0 ? 1 : 0);
      }
      return new Date(a.lastNoteAt).getTime() - new Date(b.lastNoteAt).getTime();
    });

    res.json({
      success: true,
      data: {
        meta: {
          dateFrom:       dateFrom.toISOString(),
          dateTo:         dateTo.toISOString(),
          scope,
          appliedFilters: {
            staffName: filterStaff, tier: filterTier,
            status:    filterStatus, noteType: filterNoteType,
          },
        },
        kpi,
        byStaff,
        byTier,
        byStatus,
        byLead,
        // Slim list of all leads (no notes attached) so the frontend can
        // compute "total leads in this drill context" at every level.
        // Keep this lean — used for totals only, not for rendering.
        allLeads: allLeads.map(l => ({
          studentId:    l.studentId,
          stoneTier:    l.stoneTier,
          leadStatus:   l.leadStatus,
          primaryStaff: l.primaryStaff,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Contracted pipeline metrics (period counts from audit_log) ───────────────
// GET /api/reports/contracted-stats
// Counts leads that transitioned INTO 'Contracted' within each period, plus the
// lead ids for drill-down. Periods are computed in Vietnam local time (UTC+7).
// Scope: 'all' sees every lead; 'own' is limited to the caller's assignments.
async function contractedStats(req, res, next) {
  try {
    const role = req.session.staffRole;
    const name = req.session.staffName;
    const scope = await permissionService.getResourceScope(role, 'leads', 'view_list');
    if (!scope || scope === 'none') {
      return res.status(403).json({ success: false, error: 'Not authorised to view leads' });
    }

    const VN = 7 * 60 * 60 * 1000;            // UTC+7, fixed (no DST in Vietnam)
    const now = new Date();
    const vn  = new Date(now.getTime() + VN); // shift so UTC fields read as VN local
    const y = vn.getUTCFullYear(), m = vn.getUTCMonth(), day = vn.getUTCDate(), dow = vn.getUTCDay();
    const vnMidnightUTC = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd) - VN);

    const mondayOffset  = (dow + 6) % 7;                     // days back to Monday (Mon=0 .. Sun=6)
    const thisWeekMon   = vnMidnightUTC(y, m, day - mondayOffset);
    const lastWeekStart = new Date(thisWeekMon.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastWeekEnd   = thisWeekMon;                       // exclusive (covers prev Mon..Sun)
    const monthStart    = vnMidnightUTC(y, m, 1);
    const quarterStart  = vnMidnightUTC(y, m - (m % 3), 1);
    const yearStart     = vnMidnightUTC(y, 0, 1);
    const earliest      = new Date(Math.min(lastWeekStart.getTime(), yearStart.getTime()));

    // Optional per-counsellor drill (managers only): ?counselor=Name scopes to
    // the primary `counselor` slot, matching the dashboard's per-counsellor view.
    const counselorParam = (req.query.counselor || '').trim();
    const byCounselor = !!counselorParam && scope === 'all';
    const buildScope = (idx) => {
      if (byCounselor)     return { sql: `AND l.counselor = $${idx}`, val: counselorParam };
      if (scope === 'own') return { sql: `AND (l.counselor = $${idx} OR l.senior_counselor = $${idx} OR l.presales = $${idx} OR l.marketing_staff = $${idx})`, val: name };
      return { sql: '', val: null };
    };

    const periodScope = buildScope(2);
    const params = [earliest.toISOString()];
    if (periodScope.val !== null) params.push(periodScope.val);
    const scopeSql = periodScope.sql;

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (a.lead_id) a.lead_id, a.student_id, a.changed_at
         FROM audit_log a
         JOIN leads l ON l.lead_id = a.lead_id
        WHERE a.field_name = 'leadStatus'
          AND a.new_value  = 'Contracted'
          AND l.lead_status = 'Contracted'   -- only leads STILL contracted today
          AND a.changed_at >= $1
          ${scopeSql}
        ORDER BY a.lead_id, a.changed_at DESC`,
      params
    );

    const nowMs = now.getTime();
    const b = {
      thisWeek:      { count: 0, ids: [] },
      lastWeek:      { count: 0, ids: [] },
      monthToDate:   { count: 0, ids: [] },
      quarterToDate: { count: 0, ids: [] },
      yearToDate:    { count: 0, ids: [] },
    };
    for (const r of rows) {
      const t = new Date(r.changed_at).getTime();
      if (t >= thisWeekMon.getTime()   && t <= nowMs)               { b.thisWeek.count++;      b.thisWeek.ids.push(r.lead_id); }
      if (t >= lastWeekStart.getTime() && t < lastWeekEnd.getTime()) { b.lastWeek.count++;      b.lastWeek.ids.push(r.lead_id); }
      if (t >= monthStart.getTime()    && t <= nowMs)               { b.monthToDate.count++;   b.monthToDate.ids.push(r.lead_id); }
      if (t >= quarterStart.getTime()  && t <= nowMs)               { b.quarterToDate.count++; b.quarterToDate.ids.push(r.lead_id); }
      if (t >= yearStart.getTime()     && t <= nowMs)               { b.yearToDate.count++;    b.yearToDate.ids.push(r.lead_id); }
    }

    // Reversed: leads set to Contracted at some point but no longer Contracted.
    const revScope = buildScope(1);
    const reversedRes = await pool.query(
      `SELECT DISTINCT a.lead_id
         FROM audit_log a
         JOIN leads l ON l.lead_id = a.lead_id
        WHERE a.field_name = 'leadStatus'
          AND a.new_value  = 'Contracted'
          AND l.lead_status <> 'Contracted'
          ${revScope.sql}`,
      revScope.val !== null ? [revScope.val] : []
    );
    b.reversed = { count: reversedRes.rows.length, ids: reversedRes.rows.map(r => r.lead_id) };

    res.json({ success: true, data: b });
  } catch (err) { next(err); }
}

// -- Weekly status report (per resource-group, Mon-Sun) ----------------------
// GET /api/reports/weekly?weekStart=YYYY-MM-DD&mode=all|groups|selected|individual&resources=A,B
// Managers: all / by-group (Counsellors|Pre-Sales) / selected (one combined total) /
// individual. Individual users always see only themselves. Leads-in assignment
// date falls back to students.created_at when no assignment audit row exists.

// Normalise a stored contact_platform into one of the six communication modes.
// Keyword-only call mentions (no platform) are treated as Phone call upstream.
function normalizeMode(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('mail'))                         return 'E-mail';
  if (p.includes('phone') || p.includes('call'))  return 'Phone call';
  if (p.includes('sms') || p.includes('text'))    return 'SMS';
  if (p.includes('zalo'))                          return 'Zalo';
  if (p.includes('whatsapp'))                      return 'WhatsApp';
  if (p.includes('messenger') || p.includes('facebook')) return 'Messenger';
  return platform || 'Phone call';
}

// Contracted buckets (last week / MTD / QTD / YTD + reversed YTD), still-Contracted
// only, with names for drill-down. names = array → scope to those staff;
// names = null → company-wide total (used for the page-header KPIs).
async function contractedBuckets(ctx, names) {
  const filt    = names ? `AND (l.counselor = ANY($2) OR l.presales = ANY($2))` : '';
  const ctrPar  = names ? [ctx.earliestISO, names] : [ctx.earliestISO];
  const ctr = (await pool.query(
    `SELECT DISTINCT ON (a.lead_id) a.lead_id, l.person_id AS student_id, a.changed_at, s.full_name, l.destination_country
       FROM audit_log a
       JOIN leads l    ON l.lead_id    = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name = 'leadStatus' AND a.new_value = 'Contracted'
        AND l.lead_status = 'Contracted'
        AND a.changed_at >= $1 ${filt}
      ORDER BY a.lead_id, a.changed_at DESC`, ctrPar)).rows;
  const mkBucket = () => ({ count: 0, ids: [], items: [] });
  const out = { lastWeek: mkBucket(), monthToDate: mkBucket(), quarterToDate: mkBucket(), yearToDate: mkBucket() };
  const push = (bk, r) => { bk.count++; bk.ids.push(r.lead_id);
    bk.items.push({ leadId: r.lead_id, studentId: r.student_id, fullName: r.full_name, country: r.destination_country }); };
  for (const r of ctr) {
    const t = new Date(r.changed_at).getTime();
    if (t >= ctx.lwStartMs && t < ctx.lwEndMs)     push(out.lastWeek, r);
    if (t >= ctx.monthStartMs   && t <= ctx.nowMs) push(out.monthToDate, r);
    if (t >= ctx.quarterStartMs && t <= ctx.nowMs) push(out.quarterToDate, r);
    if (t >= ctx.yearStartMs    && t <= ctx.nowMs) push(out.yearToDate, r);
  }
  const revPar = names ? [ctx.yearStartISO, names] : [ctx.yearStartISO];
  const rev = (await pool.query(
    `SELECT DISTINCT a.lead_id, l.person_id AS student_id, s.full_name
       FROM audit_log a
       JOIN leads l    ON l.lead_id    = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name = 'leadStatus' AND a.new_value = 'Contracted' AND l.lead_status <> 'Contracted'
        AND a.changed_at >= $1 ${filt}`, revPar)).rows;
  out.reversed = { count: rev.length, ids: rev.map(r => r.lead_id),
    items: rev.map(r => ({ leadId: r.lead_id, studentId: r.student_id, fullName: r.full_name })) };
  return out;
}

// Per-person DAILY call targets by role (index 0=Mon … 6=Sun; Sunday = 0).
//   Counsellors: Mon–Fri 10 new / 5 ongoing, Sat 5 / 2.
//   Pre-Sales:   Mon–Fri 15 new / 10 ongoing, Sat 7 / 5.
const CALL_TARGETS = {
  Counselor:   { new: [10, 10, 10, 10, 10, 5, 0], ongoing: [5,  5,  5,  5,  5,  2, 0] },
  'Pre-Sales': { new: [15, 15, 15, 15, 15, 7, 0], ongoing: [10, 10, 10, 10, 10, 5, 0] },
};

async function computeGroup(names, ctx, opts = {}) {
  const cc = rows => rows.map(objectToCamelCase);
  const { ws, we, monthStartISO, earliestISO, yearStartISO } = ctx;

  // -- Leads in: assignment audit events (or created_at fallback) in the week --
  const leadsIn = cc((await pool.query(
    `SELECT q.lead_id, q.student_id, q.full_name, q.lead_source, q.lead_status FROM (
       (SELECT DISTINCT ON (a.lead_id) a.lead_id, l.person_id AS student_id, s.full_name, s.lead_source, l.lead_status, a.changed_at AS eff
          FROM audit_log a
          JOIN leads l    ON l.lead_id    = a.lead_id
          JOIN students s ON s.student_id = l.person_id
         WHERE a.field_name IN ('counselor','presales') AND a.new_value = ANY($1)
           AND a.changed_at >= $2 AND a.changed_at < $3
         ORDER BY a.lead_id, a.changed_at DESC)
       UNION
       (SELECT l.lead_id, l.person_id AS student_id, s.full_name, s.lead_source, l.lead_status, l.created_at AS eff
          FROM leads l
          JOIN students s ON s.student_id = l.person_id
         WHERE (l.counselor = ANY($1) OR l.presales = ANY($1))
           AND l.created_at >= $2 AND l.created_at < $3
           AND NOT EXISTS (SELECT 1 FROM audit_log a2
                           WHERE a2.lead_id = l.lead_id AND a2.field_name IN ('counselor','presales')))
     ) q`, [names, ws, we])).rows);

  const leadsOut = cc((await pool.query(
    `SELECT DISTINCT ON (a.lead_id) a.lead_id, l.person_id AS student_id, s.full_name, s.lead_source, a.new_value AS moved_to
       FROM audit_log a
       JOIN leads l    ON l.lead_id    = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name IN ('counselor','presales') AND a.old_value = ANY($1)
        AND COALESCE(a.new_value,'') <> ALL($1)
        AND a.changed_at >= $2 AND a.changed_at < $3
      ORDER BY a.lead_id, a.changed_at DESC`, [names, ws, we])).rows);

  // -- Leads in progress: currently-assigned, non-terminal leads (a stock, not week-bound) --
  const leadsInProgress = cc((await pool.query(
    `SELECT l.person_id AS student_id, l.lead_id, s.full_name, s.lead_source, l.lead_status
       FROM leads l
       JOIN students s ON s.student_id = l.person_id
      WHERE (l.counselor = ANY($1) OR l.presales = ANY($1))
        AND l.lead_status NOT IN ('Contracted','Lost','Archived')
      ORDER BY s.full_name`, [names])).rows);

  // -- Calls (prior week). RECONCILED with the Activity Report: a note is a call
  //    if it was logged with a contact platform OR its text mentions a call
  //    ("call"/"goi"/... via phoneAliases). New-client vs follow-up is decided by
  //    whether the student had any earlier qualifying call (any author, any time). --
  const isCall = n => (n.contact_platform != null && n.contact_platform !== '')
                      || containsPhoneMention(n.content);

  const weekNoteRows = (await pool.query(
    `SELECT sn.student_id, sn.contact_platform, sn.content, sn.created_at, s.full_name
       FROM student_notes sn JOIN students s ON s.student_id = sn.student_id
      WHERE sn.author_name = ANY($1) AND sn.created_at >= $2 AND sn.created_at < $3`,
    [names, ws, we])).rows;
  const weekCalls = weekNoteRows.filter(isCall);

  const callStudentIds = [...new Set(weekCalls.map(c => c.student_id))];
  const histRows = callStudentIds.length ? (await pool.query(
    `SELECT student_id, contact_platform, content, created_at
       FROM student_notes WHERE student_id = ANY($1) AND created_at < $2`,
    [callStudentIds, we])).rows : [];
  const firstMs = {};
  for (const h of histRows) {
    if (!isCall(h)) continue;
    const t = new Date(h.created_at).getTime();
    if (firstMs[h.student_id] == null || t < firstMs[h.student_id]) firstMs[h.student_id] = t;
  }

  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const daily = dayNames.map(d => ({ day: d, newLeads: new Set(), ongoing: new Set() }));
  const modeDaily = dayNames.map(d => ({ day: d, byMode: {} }));   // mode x day matrix
  const platforms = {};
  const newMap = new Map();      // student_id -> full_name (first-ever call lands this week)
  const ongoingMap = new Map();
  for (const c of weekCalls) {
    const isFirst = new Date(c.created_at).getTime() === firstMs[c.student_id];
    const i = Math.floor((new Date(c.created_at).getTime() - ctx.weekStartMs) / (24 * 60 * 60 * 1000));
    const b = daily[Math.max(0, Math.min(6, i))];
    (isFirst ? b.newLeads : b.ongoing).add(c.student_id);
    const p = c.contact_platform ? normalizeMode(c.contact_platform) : 'Phone call';
    platforms[p] = platforms[p] || { platform: p, newCount: 0, ongoing: 0 };
    if (isFirst) platforms[p].newCount++; else platforms[p].ongoing++;
    const md = modeDaily[Math.max(0, Math.min(6, i))].byMode;
    md[p] = (md[p] || 0) + 1;
    (isFirst ? newMap : ongoingMap).set(c.student_id, c.full_name);
  }
  const headcount = Math.max(0, names.length);
  // Role-aware, day-of-week-aware targets: sum each role's per-day target across
  // the people in this group. Roles come from staff.role via ctx.counsellorSet /
  // ctx.presalesSet (built in weeklyReport). Falls back to 0 if a name has no role.
  const cSet = ctx.counsellorSet || new Set();
  const pSet = ctx.presalesSet   || new Set();
  const nC = names.filter(n => cSet.has(n)).length;
  const nP = names.filter(n => pSet.has(n)).length;
  const dailyCalls = daily.map((d, i) => ({ day: d.day, newLeads: d.newLeads.size, ongoing: d.ongoing.size,
    targetNew:     nC * CALL_TARGETS.Counselor.new[i]     + nP * CALL_TARGETS['Pre-Sales'].new[i],
    targetOngoing: nC * CALL_TARGETS.Counselor.ongoing[i] + nP * CALL_TARGETS['Pre-Sales'].ongoing[i] }));
  const newLeadItems = [...newMap].map(([studentId, fullName]) => ({ studentId, fullName }));
  const ongoingItems = [...ongoingMap].filter(([id]) => !newMap.has(id))
                                      .map(([studentId, fullName]) => ({ studentId, fullName }));
  const callTotals = { newLeads: newLeadItems.length, ongoing: ongoingItems.length };

  const lettersFor = async (topic) => {
    const week = cc((await pool.query(
      `SELECT sn.student_id, s.full_name, l.destination_country
         FROM student_notes sn
         JOIN students s ON s.student_id = sn.student_id
         LEFT JOIN leads l ON l.lead_id = sn.lead_id
        WHERE sn.author_name = ANY($1) AND sn.topic = $2 AND sn.created_at >= $3 AND sn.created_at < $4`,
      [names, topic, ws, we])).rows);
    const mtd = (await pool.query(
      `SELECT COUNT(*)::int AS c FROM student_notes
        WHERE author_name = ANY($1) AND topic = $2 AND created_at >= $3`, [names, topic, monthStartISO])).rows[0].c;
    return { count: week.length, monthToDate: mtd, items: week };
  };
  const basicLetters = await lettersFor('Basic Counselling Letter');
  const finalLetters = await lettersFor('Final Counselling Letter');

  const meetings = cc((await pool.query(
    `SELECT sn.student_id, s.full_name, sn.topic, sn.meeting_location
       FROM student_notes sn JOIN students s ON s.student_id = sn.student_id
      WHERE sn.author_name = ANY($1)
        AND sn.topic IN ('First Meeting','Second Meeting','Office Visit')
        AND sn.created_at >= $2 AND sn.created_at < $3`, [names, ws, we])).rows);

  const contracts = cc((await pool.query(
    `SELECT DISTINCT a.lead_id, l.person_id AS student_id, s.full_name, l.destination_country
       FROM audit_log a
       JOIN leads l    ON l.lead_id    = a.lead_id
       JOIN students s ON s.student_id = l.person_id
      WHERE a.field_name = 'leadStatus' AND a.new_value = 'Contracted'
        AND (l.counselor = ANY($1) OR l.presales = ANY($1))
        AND a.changed_at >= $2 AND a.changed_at < $3`, [names, ws, we])).rows);

  const contracted = await contractedBuckets(ctx, opts.companyWideContracted ? null : names);

  return {
    contracted,
    leadsIn:  { count: leadsIn.length,  leads: leadsIn },
    leadsOut: { count: leadsOut.length, leads: leadsOut },
    leadsInProgress: { count: leadsInProgress.length, leads: leadsInProgress },
    calls: { byPlatform: Object.values(platforms), daily: dailyCalls, modeByDay: modeDaily,
             totals: callTotals, newLeadItems, ongoingItems, headcount },
    basicLetters, finalLetters,
    meetings:  { count: meetings.length,  items: meetings },
    contracts: { count: contracts.length, items: contracts },
  };
}

async function weeklyReport(req, res, next) {
  try {
    const role = req.session.staffRole;
    const name = req.session.staffName;
    const scope = await permissionService.getResourceScope(role, 'leads', 'view_list');
    if (!scope || scope === 'none') {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }

    const VN = 7 * 60 * 60 * 1000;
    const vnMidnightUTC = (y, m, d) => new Date(Date.UTC(y, m, d) - VN);
    let weekStart;
    if (req.query.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart)) {
      const [yy, mm, dd] = req.query.weekStart.split('-').map(Number);
      weekStart = vnMidnightUTC(yy, mm - 1, dd);
    } else {
      const vnd = new Date(Date.now() + VN);
      const off = (vnd.getUTCDay() + 6) % 7;
      const thisMon = vnMidnightUTC(vnd.getUTCFullYear(), vnd.getUTCMonth(), vnd.getUTCDate() - off);
      weekStart = new Date(thisMon.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const vn = new Date(Date.now() + VN);
    const monthStart   = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1);
    const quarterStart = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth() - (vn.getUTCMonth() % 3), 1);
    const yearStart    = vnMidnightUTC(vn.getUTCFullYear(), 0, 1);
    const vnOff = (vn.getUTCDay() + 6) % 7;
    const curMon = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - vnOff);
    const lwStart = new Date(curMon.getTime() - 7 * 24 * 60 * 60 * 1000);
    const earliest = new Date(Math.min(lwStart.getTime(), yearStart.getTime()));

    const ctx = {
      ws: weekStart.toISOString(), we: weekEnd.toISOString(), weekStartMs: weekStart.getTime(),
      monthStartISO: monthStart.toISOString(), earliestISO: earliest.toISOString(),
      lwStartMs: lwStart.getTime(), lwEndMs: curMon.getTime(),
      monthStartMs: monthStart.getTime(), quarterStartMs: quarterStart.getTime(),
      yearStartMs: yearStart.getTime(), yearStartISO: yearStart.toISOString(), nowMs: Date.now(),
    };

    const namesByRole = async (r) =>
      (await pool.query(`SELECT full_name FROM staff WHERE role = $1 AND is_active = true`, [r])).rows.map(x => x.full_name);
    const counsellorNames = await namesByRole('Counselor');
    const presalesNames   = await namesByRole('Pre-Sales');
    const allNames = Array.from(new Set([...counsellorNames, ...presalesNames]));
    // Expose role membership to computeGroup so daily call targets are role-aware.
    ctx.counsellorSet = new Set(counsellorNames);
    ctx.presalesSet   = new Set(presalesNames);

    const mode = req.query.mode || 'all';
    const resourcesParam = (req.query.resources || '').split(',').map(s => s.trim()).filter(Boolean);

    let groups;
    if (scope !== 'all') {
      groups = [{ label: name, names: [name] }];
    } else if (mode === 'groups') {
      groups = [
        { label: 'Counsellors', names: counsellorNames },
        { label: 'Pre-Sales',   names: presalesNames },
      ];
    } else if (mode === 'selected' && resourcesParam.length) {
      groups = [{ label: 'Selected', names: resourcesParam }];
    } else if (mode === 'individual' && resourcesParam.length) {
      groups = [{ label: resourcesParam[0], names: [resourcesParam[0]] }];
    } else {
      groups = [{ label: 'All', names: allNames, companyWide: true }];
    }

    // Page-header KPIs are ALWAYS the period totals across all individuals
    // (company-wide for managers; own figures for own-scope users).
    const contractedTotals = await contractedBuckets(ctx, scope === 'all' ? null : [name]);

    const results = [];
    for (const g of groups) {
      results.push({ label: g.label, names: g.names, ...(await computeGroup(g.names, ctx, { companyWideContracted: !!g.companyWide })) });
    }

    res.json({ success: true, data: {
      weekStart: ctx.ws, weekEnd: ctx.we, mode,
      staff: { counsellors: counsellorNames, presales: presalesNames },
      contractedTotals,
      groups: results,
    }});
  } catch (err) { next(err); }
}

// -- Weekly Status Report recommendations (per week, per view-scope) ----------
// scope_key mirrors the report's group selection so each view keeps its own
// notes. Non-managers are always scoped to their own name.
async function recoScopeKey(req) {
  const role  = req.session.staffRole;
  const name  = req.session.staffName;
  const scope = await permissionService.getResourceScope(role, 'leads', 'view_list');
  if (scope !== 'all') return `individual:${name}`;
  const mode = (req.query.mode ?? (req.body && req.body.mode)) || 'all';
  const raw  = (req.query.resources ?? (req.body && req.body.resources)) || '';
  const resources = (Array.isArray(raw) ? raw.join(',') : String(raw))
    .split(',').map(s => s.trim()).filter(Boolean);
  if (mode === 'groups') return 'groups';
  if (mode === 'selected'   && resources.length) return 'selected:' + resources.slice().sort().join('|');
  if (mode === 'individual' && resources.length) return 'individual:' + resources[0];
  return 'all';
}

async function getRecommendation(req, res, next) {
  try {
    const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'view_list');
    if (!scope || scope === 'none') return res.status(403).json({ success: false, error: 'Not authorised' });
    const weekStart = req.query.weekStart;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) {
      return res.status(400).json({ success: false, error: 'weekStart must be YYYY-MM-DD' });
    }
    const scopeKey = await recoScopeKey(req);
    const r = await pool.query(
      `SELECT content, updated_by, updated_at FROM weekly_recommendations
        WHERE week_start = $1 AND scope_key = $2`, [weekStart, scopeKey]);
    const row = r.rows[0] || null;
    res.json({ success: true, data: {
      content:   row ? row.content    : '',
      updatedBy: row ? row.updated_by : null,
      updatedAt: row ? row.updated_at : null,
      scopeKey,
    }});
  } catch (err) { next(err); }
}

async function saveRecommendation(req, res, next) {
  try {
    const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'view_list');
    if (!scope || scope === 'none') return res.status(403).json({ success: false, error: 'Not authorised' });
    const { weekStart, content } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) {
      return res.status(400).json({ success: false, error: 'weekStart must be YYYY-MM-DD' });
    }
    const scopeKey = await recoScopeKey(req);
    const r = await pool.query(
      `INSERT INTO weekly_recommendations (week_start, scope_key, content, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (week_start, scope_key)
       DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING content, updated_by, updated_at`,
      [weekStart, scopeKey, content || '', req.session.staffName || '']);
    const row = r.rows[0];
    res.json({ success: true, data: {
      content: row.content, updatedBy: row.updated_by, updatedAt: row.updated_at, scopeKey,
    }});
  } catch (err) { next(err); }
}

// ── Monthly Targets (Weekly Report tracker) ──────────────────────────────────
// GET    /api/reports/monthly-targets        grid: tracked counsellors x months
// PUT    /api/reports/monthly-targets         upsert one target (manager/admin)
// POST   /api/reports/tracked-staff           add a counsellor to the tracker
// DELETE /api/reports/tracked-staff/:staffId  remove a counsellor
//
// "Actual" = contracted signings in that month (audit_log, still-Contracted,
// attributed by the `counselor` slot), using the SAME VN month boundaries and
// changed_at comparison as contractedStats, so the numbers reconcile with the
// Dashboard / Pipeline contracted figures. "Target" = the monthly_targets row
// if one exists, else the staff.target fallback (flagged isFallback).

// Manager-level write gate (mirrors mass-assign): leads/assign scope = 'all'.
async function isManagerScope(req) {
  const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'assign');
  return scope === 'all';
}

// Months from Jan 2026 to the current month, in Vietnam local time (UTC+7).
// Each month carries its half-open [startMs, endMs) window for bucketing.
function buildTargetMonths() {
  const VN = 7 * 60 * 60 * 1000;
  const vnMidnightUTC = (y, m, d) => new Date(Date.UTC(y, m, d) - VN);
  const vn = new Date(Date.now() + VN);
  const curY = vn.getUTCFullYear(), curM = vn.getUTCMonth();
  const months = [];
  let y = 2026, m = 0;
  while (y < curY || (y === curY && m <= curM)) {
    const startMs = vnMidnightUTC(y, m, 1).getTime();
    const endMs   = vnMidnightUTC(y, m + 1, 1).getTime();   // first of next month (exclusive)
    const label   = `${y}-${String(m + 1).padStart(2, '0')}`;
    months.push({ label, month: `${label}-01`, startMs, endMs });
    m++; if (m > 11) { m = 0; y++; }
  }
  return { months, yearStartISO: vnMidnightUTC(2026, 0, 1).toISOString() };
}

async function monthlyTargets(req, res, next) {
  try {
    if (!(await isManagerScope(req))) {
      return res.status(403).json({ success: false, error: 'Not authorised to view monthly targets' });
    }

    const { months, yearStartISO } = buildTargetMonths();

    // Tracked counsellors, in display order, with their staff-level fallback target.
    const tracked = (await pool.query(
      `SELECT t.staff_id, t.sort_order, s.full_name, COALESCE(s.target, 0) AS fallback_target
         FROM target_tracked_staff t
         JOIN staff s ON s.id = t.staff_id
        ORDER BY t.sort_order, s.full_name`
    )).rows;
    const names = tracked.map(r => r.full_name);

    // Monthly target overrides for these staff (this year only).
    const overrides = names.length ? (await pool.query(
      `SELECT mt.staff_id, to_char(mt.month, 'YYYY-MM') AS label, mt.target
         FROM monthly_targets mt
         JOIN target_tracked_staff t ON t.staff_id = mt.staff_id
        WHERE mt.month >= DATE '2026-01-01'`
    )).rows : [];
    const overrideMap = new Map();             // `${staffId}|${label}` -> target
    for (const o of overrides) overrideMap.set(`${o.staff_id}|${o.label}`, o.target);

    // Actuals: contracted signings (still-Contracted) by counsellor name, this year.
    const actualRows = names.length ? (await pool.query(
      `SELECT DISTINCT ON (a.lead_id) a.lead_id, a.changed_at, l.counselor
         FROM audit_log a
         JOIN leads l ON l.lead_id = a.lead_id
        WHERE a.field_name = 'leadStatus'
          AND a.new_value  = 'Contracted'
          AND l.lead_status = 'Contracted'
          AND l.counselor = ANY($1)
          AND a.changed_at >= $2
        ORDER BY a.lead_id, a.changed_at DESC`,
      [names, yearStartISO]
    )).rows : [];

    const actualMap = new Map();               // name -> { label -> count }
    for (const r of actualRows) {
      const t  = new Date(r.changed_at).getTime();
      const mo = months.find(x => t >= x.startMs && t < x.endMs);
      if (!mo) continue;
      if (!actualMap.has(r.counselor)) actualMap.set(r.counselor, {});
      const byMonth = actualMap.get(r.counselor);
      byMonth[mo.label] = (byMonth[mo.label] || 0) + 1;
    }

    const rows = tracked.map(tr => {
      const cells = {};
      let ytdActual = 0, ytdTarget = 0;
      const byMonth = actualMap.get(tr.full_name) || {};
      for (const mo of months) {
        const actual     = byMonth[mo.label] || 0;
        const ov         = overrideMap.get(`${tr.staff_id}|${mo.label}`);
        const isFallback = ov === undefined;
        const target     = isFallback ? tr.fallback_target : ov;
        cells[mo.label]  = { actual, target, isFallback };
        ytdActual += actual;
        ytdTarget += target;
      }
      return {
        staffId:        tr.staff_id,
        fullName:       tr.full_name,
        sortOrder:      tr.sort_order,
        fallbackTarget: tr.fallback_target,
        cells,
        ytd: { actual: ytdActual, target: ytdTarget },
      };
    });

    res.json({
      success: true,
      data: { months: months.map(m => ({ month: m.month, label: m.label })), rows },
    });
  } catch (err) { next(err); }
}

async function saveMonthlyTarget(req, res, next) {
  try {
    if (!(await isManagerScope(req))) {
      return res.status(403).json({ success: false, error: 'Not authorised to edit targets' });
    }
    const { staffId, month, target } = req.body || {};
    if (!staffId || !/^\d+$/.test(String(staffId))) {
      return res.status(400).json({ success: false, error: 'staffId is required' });
    }
    // Accept 'YYYY-MM' or 'YYYY-MM-01'; normalise to first-of-month.
    const mm = String(month || '');
    const monthDate = /^\d{4}-\d{2}$/.test(mm)    ? `${mm}-01`
                    : /^\d{4}-\d{2}-01$/.test(mm) ? mm
                    : null;
    if (!monthDate) {
      return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    }
    const updatedBy = req.session.staffName || req.session.staffEmail || 'unknown';

    // Empty target reverts this cell to the staff-level fallback (delete override).
    if (target === '' || target === null || target === undefined) {
      await pool.query(`DELETE FROM monthly_targets WHERE staff_id = $1 AND month = $2`, [staffId, monthDate]);
      return res.json({ success: true, data: { staffId: Number(staffId), month: mm.slice(0, 7), reverted: true } });
    }

    const n = Number(target);
    if (!Number.isInteger(n) || n < 0) {
      return res.status(400).json({ success: false, error: 'target must be a non-negative integer' });
    }

    const r = await pool.query(
      `INSERT INTO monthly_targets (staff_id, month, target, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (staff_id, month)
       DO UPDATE SET target = EXCLUDED.target, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING staff_id, to_char(month, 'YYYY-MM') AS month, target, updated_by, updated_at`,
      [staffId, monthDate, n, updatedBy]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
}

async function addTrackedStaff(req, res, next) {
  try {
    if (!(await isManagerScope(req))) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const { staffId } = req.body || {};
    if (!staffId || !/^\d+$/.test(String(staffId))) {
      return res.status(400).json({ success: false, error: 'staffId is required' });
    }
    const exists = await pool.query(`SELECT id, full_name FROM staff WHERE id = $1`, [staffId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Staff member not found' });
    }
    const addedBy = req.session.staffName || req.session.staffEmail || 'unknown';
    await pool.query(
      `INSERT INTO target_tracked_staff (staff_id, sort_order, added_by)
            VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM target_tracked_staff), $2)
       ON CONFLICT (staff_id) DO NOTHING`,
      [staffId, addedBy]
    );
    res.json({ success: true, data: { staffId: Number(staffId), fullName: exists.rows[0].full_name } });
  } catch (err) { next(err); }
}

async function removeTrackedStaff(req, res, next) {
  try {
    if (!(await isManagerScope(req))) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const staffId = req.params.staffId;
    if (!staffId || !/^\d+$/.test(String(staffId))) {
      return res.status(400).json({ success: false, error: 'staffId is required' });
    }
    // monthly_targets history is intentionally preserved so re-adding restores it.
    await pool.query(`DELETE FROM target_tracked_staff WHERE staff_id = $1`, [staffId]);
    res.json({ success: true, data: { staffId: Number(staffId), removed: true } });
  } catch (err) { next(err); }
}

module.exports = {
  notesActivity, contractedStats, weeklyReport, getRecommendation, saveRecommendation,
  monthlyTargets, saveMonthlyTarget, addTrackedStaff, removeTrackedStaff,
};
