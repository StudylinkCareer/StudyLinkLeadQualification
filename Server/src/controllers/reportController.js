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
const { canManageTargets } = require('../utils/authProfiles');
const { containsPhoneMention } = require('../services/phoneAliases');
const { objectToCamelCase }    = require('../utils/caseConvert');
const { classifyCalls, isCallNote } = require('../services/callClassification');
const rangeReport = require('../services/rangeReport');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Bucket assignment for a single note — used everywhere downstream. Same
// combined rule as isCallNote elsewhere (contact_platform set OR the text
// mentions a call) — this used to check the text only, which undercounted
// notes logged via clicking a Call/Zalo/WhatsApp icon whose content didn't
// happen to contain a call-keyword.
function bucketFor(note) {
  const hasPlatform = note.contactPlatform != null && note.contactPlatform !== '';
  return (hasPlatform || containsPhoneMention(note.content)) ? 'phone' : 'other';
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
        n.contact_platform,
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
      bucket: bucketFor(r),
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

// ── Contracted pipeline metrics ───────────────────────────────────────────────
// GET /api/reports/contracted-stats
// Counts leads whose REAL signing date (leads.actual_close_date) falls within
// each period, plus the lead ids for drill-down. Periods are computed in
// Vietnam local time (UTC+7). Scope: 'all' sees every lead; 'own' is limited
// to the caller's assignments. Revised 2026-08 to match Monthly Targets /
// Monthly Report's definition — previously bucketed by the audit_log
// leadStatus->'Contracted' transition timestamp instead, which meant a
// contract signed long ago but only entered/corrected into the system this
// week counted as "Contracted this week" here while the other two reports
// (already actual_close_date-based) disagreed.
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
      `SELECT l.lead_id, l.person_id AS student_id, l.actual_close_date AS close_date
         FROM leads l
        WHERE l.lead_status = 'Contracted'   -- only leads STILL contracted today
          AND l.actual_close_date >= $1
          ${scopeSql}`,
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
      const t = new Date(r.close_date).getTime();
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
//
// Bucketed by leads.actual_close_date — the REAL contract signing date —
// not by when staff happened to flip the status field in the app (revised
// 2026-08). Previously this joined audit_log for the leadStatus->'Contracted'
// change event instead, which meant a contract signed months/years ago but
// only entered/corrected into the system this week showed up as "Contracted
// this week" here, while Monthly Report (already actual_close_date-based)
// disagreed. Both reports now share one definition. The "reversed" bucket
// below stays audit-log-based on purpose — it's inherently about the EVENT
// of a Contracted marking later being undone, not a signing date.
async function contractedBuckets(ctx, names) {
  const filt    = names ? `AND (l.counselor = ANY($2) OR l.presales = ANY($2))` : '';
  const ctrPar  = names ? [ctx.earliestISO, names] : [ctx.earliestISO];
  const ctr = (await pool.query(
    `SELECT l.lead_id, l.person_id AS student_id, l.actual_close_date AS close_date, s.full_name, l.destination_country
       FROM leads l
       JOIN students s ON s.student_id = l.person_id
      WHERE l.lead_status = 'Contracted'
        AND l.actual_close_date >= $1 ${filt}`, ctrPar)).rows;
  const mkBucket = () => ({ count: 0, ids: [], items: [] });
  const out = { lastWeek: mkBucket(), monthToDate: mkBucket(), quarterToDate: mkBucket(), yearToDate: mkBucket() };
  const push = (bk, r) => { bk.count++; bk.ids.push(r.lead_id);
    bk.items.push({ leadId: r.lead_id, studentId: r.student_id, fullName: r.full_name, country: r.destination_country }); };
  for (const r of ctr) {
    const t = new Date(r.close_date).getTime();
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
// Fallback only, used if call_day_targets has no Counselor row for ANY
// month yet — the DB (editable from Staff Targets) is the real source now;
// see loadDayTargets() below. Counselor-only (2026-08 Phase-0 redesign,
// planned with Hong Ha): Pre-Sales no longer has a role-wide daily target —
// their target is now per-individual, derived from presales_working_hours
// (hours worked that day x 8), combined New+Ongoing, computed directly in
// computeGroup below rather than through this table.
const CALL_TARGETS = {
  Counselor: { new: [10, 10, 10, 10, 10, 5, 0], ongoing: [5, 5, 5, 5, 5, 2, 0] },
};

// Loads the editable, month-aware per-weekday Counselor call quotas (Staff
// Targets page's "Daily Call Quotas" grid) and returns a lookup function
// `forMonth(monthKey)` -> {new:[7], ongoing:[7]}, monthKey = 'YYYY-MM-01'.
// "Copy forward" semantics (confirmed 2026-08): a month with no row of its
// own inherits the most recently configured EARLIER month, never silently
// drops to 0 — only truly falls back to the hardcoded CALL_TARGETS default
// if NO month has ever been configured at all.
// Called once per report build (generateWeeklySnapshot / weeklyReport's live
// path) and stashed on ctx, same pattern as ctx.counsellorSet/presalesSet —
// computeGroup calls the returned function per day, since a single week can
// span two different months near a month boundary.
async function loadDayTargets() {
  const rows = (await pool.query(
    `SELECT to_char(month, 'YYYY-MM-01') AS month, day_of_week, new_target, ongoing_target
       FROM call_day_targets WHERE role = 'Counselor' ORDER BY month`
  )).rows;
  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, { new: [...CALL_TARGETS.Counselor.new], ongoing: [...CALL_TARGETS.Counselor.ongoing] });
    const m = byMonth.get(r.month);
    m.new[r.day_of_week]     = r.new_target;
    m.ongoing[r.day_of_week] = r.ongoing_target;
  }
  const months = [...byMonth.keys()].sort();
  return function forMonth(monthKey) {
    let best = null;
    for (const m of months) { if (m <= monthKey) best = m; else break; }
    return best ? byMonth.get(best) : { new: [...CALL_TARGETS.Counselor.new], ongoing: [...CALL_TARGETS.Counselor.ongoing] };
  };
}

// Reconstructs a group's ACTIVE book as at instant `tISO` (point-in-time), from
// the audit log: each lead's counselor / presales / status = its last logged
// change on-or-before T, else the value just before its first change after T,
// else the current value (never changed). Non-terminal only. Validated to
// reproduce the live book exactly at T = now for all counsellors.
async function membersAsAt(names, tISO) {
  const asof = (field, src) => `COALESCE(
      (SELECT a.new_value FROM audit_log a WHERE a.lead_id=l.lead_id AND a.field_name='${field}' AND a.changed_at <= $2 ORDER BY a.changed_at DESC LIMIT 1),
      (SELECT a.old_value FROM audit_log a WHERE a.lead_id=l.lead_id AND a.field_name='${field}' AND a.changed_at >  $2 ORDER BY a.changed_at ASC  LIMIT 1),
      ${src})`;
  const { rows } = await pool.query(
    `WITH candidates AS (
        SELECT lead_id FROM leads
          WHERE btrim(COALESCE(counselor,''))=ANY($1) OR btrim(COALESCE(presales,''))=ANY($1)
        UNION
        SELECT lead_id FROM audit_log
          WHERE field_name IN ('counselor','presales')
            AND (btrim(COALESCE(new_value,''))=ANY($1) OR btrim(COALESCE(old_value,''))=ANY($1))
     ),
     asof AS (
        SELECT l.lead_id, l.person_id AS student_id,
               btrim(${asof('counselor', 'l.counselor')})   AS cslr,
               btrim(${asof('presales',  'l.presales')})     AS pres,
                     ${asof('leadStatus', 'l.lead_status')}  AS status
          FROM leads l
         WHERE l.lead_id IN (SELECT lead_id FROM candidates) AND l.created_at <= $2
     )
     SELECT a.lead_id, a.student_id, s.full_name, s.lead_source, a.status AS lead_status
       FROM asof a JOIN students s ON s.student_id = a.student_id
      WHERE (a.cslr = ANY($1) OR a.pres = ANY($1))
        AND a.status NOT IN ('Contracted','Lost','Archived','Cancelled')
      ORDER BY s.full_name`,
    [names, tISO]);
  return rows;
}

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

  // -- Point-in-time leads book: Opening (as at week start) + In − Out = Closing
  //    (as at week end = the Monday-9am number). Reconstructed from the audit log.
  //    "Out" = left the book for ANY reason (transfer, pool, Lost/Archived/
  //    Cancelled/Contracted); "In" = entered for any reason. Balances by set algebra.
  const opening = cc(await membersAsAt(names, ws));
  const closing = cc(await membersAsAt(names, we));
  const openIds  = new Set(opening.map(r => r.leadId));
  const closeIds = new Set(closing.map(r => r.leadId));
  const flowIn   = closing.filter(r => !openIds.has(r.leadId));
  const flowOut  = opening.filter(r => !closeIds.has(r.leadId));
  const leadsFlow = {
    opening: { count: opening.length, leads: opening },
    in:      { count: flowIn.length,  leads: flowIn  },
    out:     { count: flowOut.length, leads: flowOut },
    closing: { count: closing.length, leads: closing },
  };

  // -- Calls (this week). Unified New/Ongoing/KBM classification (confirmed
  //    2026-08) — see callClassification.js for the full rule. KBM notes are
  //    excluded BEFORE New/Ongoing classification (a KBM'd attempt never
  //    counts as anyone's first contact); New = first non-KBM contact EVER
  //    (checked against that STAFF MEMBER's full history, not just this
  //    week — a lead already worked by someone else, e.g. Presales before
  //    a hand-off, is still New to whoever it's handed to); Ongoing =
  //    later non-KBM contacts by the same staffer, deduped by (lead, VN
  //    day, khung giờ time-slot) — repeat touches to the same lead in the
  //    same slot by the same person count once, a different slot (or the
  //    same slot by a different staffer) counts as a separate genuine
  //    touch. Same rule Monthly Report and the Call Targets "actual"
  //    figure use, so all three agree. --
  const weekNoteRows = (await pool.query(
    `SELECT sn.student_id, sn.author_name, sn.contact_platform, sn.content, sn.created_at, sn.call_answered, s.full_name
       FROM student_notes sn JOIN students s ON s.student_id = sn.student_id
      WHERE sn.author_name = ANY($1) AND sn.created_at >= $2 AND sn.created_at < $3`,
    [names, ws, we])).rows;

  const callStudentIds = [...new Set(weekNoteRows.filter(isCallNote).map(c => c.student_id))];
  const histRows = callStudentIds.length ? (await pool.query(
    `SELECT student_id, author_name, contact_platform, content, created_at, call_answered
       FROM student_notes WHERE student_id = ANY($1) AND created_at < $2`,
    [callStudentIds, ws])).rows : [];

  const classified = classifyCalls(weekNoteRows, histRows);

  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayIndexOf = (ms) => Math.max(0, Math.min(6, Math.floor((ms - ctx.weekStartMs) / (24 * 60 * 60 * 1000))));
  // Role-aware from here on (2026-08 Phase-0 redesign): Counsellors keep a
  // role-wide New/Ongoing target; Pre-Sales' target is per-individual
  // (hours worked that day x 8, combined — see below), so their actuals and
  // targets are tracked as a single combined bucket, not New/Ongoing.
  const daily = dayNames.map(d => ({ day: d, counselor: { newLeads: 0, ongoing: 0 }, presales: { total: 0 } }));
  const modeDaily = dayNames.map(d => ({ day: d, byMode: {} }));   // mode x day matrix, unaffected by the role split
  const platforms = {};
  const cSet = ctx.counsellorSet || new Set();
  const pSet = ctx.presalesSet   || new Set();
  for (const [bucketKey, items] of [['newCount', classified.newItems], ['ongoing', classified.ongoingItems]]) {
    for (const item of items) {
      const i = dayIndexOf(new Date(item.note.created_at).getTime());
      if (pSet.has(item.note.author_name)) {
        daily[i].presales.total++;
      } else if (bucketKey === 'newCount') {
        daily[i].counselor.newLeads++;
      } else {
        daily[i].counselor.ongoing++;
      }
      const p = item.note.contact_platform ? normalizeMode(item.note.contact_platform) : 'Phone call';
      platforms[p] = platforms[p] || { platform: p, newCount: 0, ongoing: 0 };
      platforms[p][bucketKey]++;
      modeDaily[i].byMode[p] = (modeDaily[i].byMode[p] || 0) + 1;
    }
  }
  const headcount = Math.max(0, names.length);
  const nC = names.filter(n => cSet.has(n)).length;

  // Counsellor targets: role-wide, day-of-week + month aware (ctx.dayTargets
  // is the forMonth() lookup function from loadDayTargets()).
  const dt = ctx.dayTargets || (() => ({ new: [...CALL_TARGETS.Counselor.new], ongoing: [...CALL_TARGETS.Counselor.ongoing] }));
  const monthKeyOf = (ms) => {
    const vn = new Date(ms + VN_MS);
    return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-01`;
  };

  // Pre-Sales targets: per-individual, hours(staff, month, day_of_week) x 8,
  // summed across whichever Pre-Sales members are actually in this group.
  // A week can span two months near a boundary, so this is looked up per
  // day, per person — not a single flat number for the whole week.
  const presalesNames = names.filter(n => pSet.has(n));
  const presalesHoursByNameMonthDow = new Map(); // `${name}|${monthKey}|${dow}` -> hours
  if (presalesNames.length) {
    const hourRows = (await pool.query(
      `SELECT s.full_name, to_char(wh.month, 'YYYY-MM-01') AS month, wh.day_of_week, wh.hours
         FROM presales_working_hours wh JOIN staff s ON s.id = wh.staff_id
        WHERE s.full_name = ANY($1)`,
      [presalesNames]
    )).rows;
    for (const r of hourRows) {
      presalesHoursByNameMonthDow.set(`${r.full_name}|${r.month}|${r.day_of_week}`, Number(r.hours));
    }
  }
  // "Copy forward" fallback per person: if THIS month has no hours row for
  // them at all (any day), fall back to their most recent earlier month
  // that does — mirrors the Counsellor grid's copy-forward semantics.
  const presalesMonthsByName = new Map();
  for (const key of presalesHoursByNameMonthDow.keys()) {
    const [name, month] = key.split('|');
    if (!presalesMonthsByName.has(name)) presalesMonthsByName.set(name, new Set());
    presalesMonthsByName.get(name).add(month);
  }
  function presalesHoursFor(name, monthKey, dow) {
    const direct = presalesHoursByNameMonthDow.get(`${name}|${monthKey}|${dow}`);
    if (direct !== undefined) return direct;
    const months = [...(presalesMonthsByName.get(name) || [])].sort();
    let best = null;
    for (const m of months) { if (m <= monthKey) best = m; else break; }
    return best ? (presalesHoursByNameMonthDow.get(`${name}|${best}|${dow}`) || 0) : 0;
  }

  const dailyCalls = daily.map((d, i) => {
    const monthKey = monthKeyOf(ctx.weekStartMs + i * 24 * 60 * 60 * 1000);
    const dt_i = dt(monthKey);
    let presalesTarget = 0;
    for (const nm of presalesNames) presalesTarget += presalesHoursFor(nm, monthKey, i) * 8;
    return {
      day: d.day,
      newLeads: d.counselor.newLeads, ongoing: d.counselor.ongoing,
      targetNew: nC * dt_i.new[i], targetOngoing: nC * dt_i.ongoing[i],
      presalesActual: d.presales.total, presalesTarget,
    };
  });
  const newLeadItems = classified.newItems.map(it => ({ studentId: it.studentId, fullName: it.fullName }));
  // NOT deduped by lead — a lead can legitimately appear more than once
  // (once per distinct khung giờ touched), and the count here must match
  // callTotals.ongoing exactly so the drill-down list and the headline
  // number never disagree.
  const ongoingItems = classified.ongoingItems.map(it => ({
    studentId: it.studentId, fullName: it.fullName, dayKey: it.dayKey, slot: it.slot,
  }));
  // NOT deduped either — same reasoning as ongoingItems above, so the KBM
  // drill-down list length matches callTotals.kbm exactly (a lead KBM'd
  // 3 times this week appears 3 times, since each is a real unanswered
  // attempt, not one that got silently absorbed into the headline count).
  const kbmItems = classified.kbmItems.map(it => ({ studentId: it.studentId, fullName: it.fullName }));
  const callTotals = { newLeads: newLeadItems.length, ongoing: ongoingItems.length, kbm: kbmItems.length };

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

  // Bucketed by actual_close_date (real signing date), not the audit-log
  // status-change event — same 2026-08 revision as contractedBuckets below.
  // Deliberately NOT filtered to lead_status='Contracted' (matches the prior
  // behavior): this is "signings that happened this week", not "still-
  // Contracted leads whose signing fell in this week" — a lead reversed
  // after signing still counts as a signing that week.
  const contracts = cc((await pool.query(
    `SELECT l.lead_id, l.person_id AS student_id, s.full_name, l.destination_country
       FROM leads l
       JOIN students s ON s.student_id = l.person_id
      WHERE (l.counselor = ANY($1) OR l.presales = ANY($1))
        AND l.actual_close_date >= $2 AND l.actual_close_date < $3`, [names, ws, we])).rows);

  const contracted = await contractedBuckets(ctx, opts.companyWideContracted ? null : names);

  return {
    contracted,
    leadsIn:  { count: leadsIn.length,  leads: leadsIn },
    leadsOut: { count: leadsOut.length, leads: leadsOut },
    leadsInProgress: { count: leadsInProgress.length, leads: leadsInProgress },
    leadsFlow,
    calls: { byPlatform: Object.values(platforms), daily: dailyCalls, modeByDay: modeDaily,
             totals: callTotals, newLeadItems, ongoingItems, kbmItems, headcount },
    basicLetters, finalLetters,
    meetings:  { count: meetings.length,  items: meetings },
    contracts: { count: contracts.length, items: contracts },
  };
}

const VN_MS = 7 * 60 * 60 * 1000;
const vnMidnightUTC = (y, m, d) => new Date(Date.UTC(y, m, d) - VN_MS);
// VN calendar date (YYYY-MM-DD) of an instant — used as the snapshot key so a VN
// Monday is stored as that Monday, not the UTC date of VN-midnight (a day earlier).
const vnYmd = (dt) => new Date(dt.getTime() + VN_MS).toISOString().slice(0, 10);

// Monday (VN) of the week containing asOfMs, minus `weeksBack` weeks.
function vnWeekStart(asOfMs, weeksBack = 0) {
  const vn = new Date(asOfMs + VN_MS);
  const off = (vn.getUTCDay() + 6) % 7;                    // Mon=0 … Sun=6
  const thisMon = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - off);
  return new Date(thisMon.getTime() - weeksBack * 7 * 86400000);
}

// Compute context for a report week. `asOfMs` pins the to-date rollups
// (MTD/QTD/YTD, "last week") — for a frozen snapshot it's Monday 08:00 VN of the
// week's close; for a live view it's Date.now().
function buildWeeklyCtx(weekStart, asOfMs) {
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const vn = new Date(asOfMs + VN_MS);
  const monthStart   = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1);
  const quarterStart = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth() - (vn.getUTCMonth() % 3), 1);
  const yearStart    = vnMidnightUTC(vn.getUTCFullYear(), 0, 1);
  const vnOff = (vn.getUTCDay() + 6) % 7;
  const curMon = vnMidnightUTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - vnOff);
  const lwStart = new Date(curMon.getTime() - 7 * 86400000);
  const earliest = new Date(Math.min(lwStart.getTime(), yearStart.getTime()));
  return {
    ws: weekStart.toISOString(), we: weekEnd.toISOString(), weekStartMs: weekStart.getTime(),
    monthStartISO: monthStart.toISOString(), earliestISO: earliest.toISOString(),
    lwStartMs: lwStart.getTime(), lwEndMs: curMon.getTime(),
    monthStartMs: monthStart.getTime(), quarterStartMs: quarterStart.getTime(),
    yearStartMs: yearStart.getTime(), yearStartISO: yearStart.toISOString(), nowMs: asOfMs,
  };
}

// Active staff for the report, grouped by POSITION (the real job — where leads
// flow in/out), not the RBAC role (role='Counselor' can be held by PreSales/PM/
// Marketing-position staff, which would inflate the Counsellors group).
async function weeklyStaffNames() {
  // Match by ILIKE so this survives the auth-profile rename: 'Counselor'/'PreSales'
  // became 'Staff, Counsellor' / 'Lead, Counsellor' / 'Staff, Pre-sales' etc.
  // ILIKE '%counsel%' catches both spellings + Staff/Lead/Senior variants (and the
  // legacy exact names); '%pre%sale%' catches 'Pre-sales' and legacy 'PreSales'.
  const byLike = async (pattern) => (await pool.query(
    `SELECT full_name FROM staff
       WHERE position ILIKE $1 AND is_active = true
         AND COALESCE(staff_type,'permanent') <> 'event'`, [pattern])).rows.map(x => x.full_name);
  const counsellorNames = await byLike('%counsel%');
  const presalesNames   = await byLike('%pre%sale%');
  return { counsellorNames, presalesNames, allNames: Array.from(new Set([...counsellorNames, ...presalesNames])) };
}

// Compute the FULL frozen payload for a week (All + Counsellors + Pre-Sales +
// every individual) and store it. asOf is pinned to Monday 08:00 VN of the
// week's close so the numbers are deterministic regardless of when this runs.
async function generateWeeklySnapshot(weekStart) {
  const asOfMs = weekStart.getTime() + 7 * 86400000 + 8 * 60 * 60 * 1000;   // Mon 08:00 VN after the week
  const ctx = buildWeeklyCtx(weekStart, asOfMs);
  const { counsellorNames, presalesNames, allNames } = await weeklyStaffNames();
  ctx.counsellorSet = new Set(counsellorNames);
  ctx.presalesSet   = new Set(presalesNames);
  ctx.dayTargets    = await loadDayTargets();

  const byLabel = {};
  // Keys are TRIMMED (some staff full_names carry stray whitespace, and the
  // serve path trims requested labels) but the names passed to the queries stay
  // as stored so lead-assignment matching is unaffected.
  const put = async (label, names, companyWide) => {
    byLabel[String(label).trim()] = { label: String(label).trim(), names, ...(await computeGroup(names, ctx, { companyWideContracted: !!companyWide })) };
  };
  await put('All', allNames, true);
  await put('Counsellors', counsellorNames, false);
  await put('Pre-Sales', presalesNames, false);
  for (const n of allNames) await put(n, [n], false);   // per-individual (drill)

  const contractedTotals = await contractedBuckets(ctx, null);
  const data = {
    weekStart: ctx.ws, weekEnd: ctx.we,
    staff: { counsellors: counsellorNames, presales: presalesNames },
    contractedTotals, byLabel, asOf: new Date(asOfMs).toISOString(),
  };
  const weekStartYmd = vnYmd(weekStart);
  await pool.query(
    `INSERT INTO weekly_report_snapshots (week_start, data, generated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (week_start) DO UPDATE SET data = EXCLUDED.data, generated_at = now()`,
    [weekStartYmd, data]);
  return weekStartYmd;
}

// ── Individual Report / Company Report (2026-08, planned with Hong Ha) ───
// Successors to Weekly Report's individual mode / Monthly Report, both
// generalized to weekly/monthly/yearly/custom periods via rangeReport.js.
//
// V1 SCOPE NOTE: always computed live (no frozen-snapshot reuse yet for the
// weekly preset — that's a deliberate deferral, not an oversight; the
// numbers themselves are correct and match a live call to the old /weekly
// endpoint for the same range, just without the snapshot's performance/
// point-in-time-freeze properties). Company Report's per-staff breakdown
// covers Calls/Letters/Meetings/Contracted per person — Monthly Report's
// fuller columns (Target/%KPI/case-type split/Convert%/Contract Sources/
// Marketing Activities) are a follow-up, not yet ported here.
//
// RBAC: resource='reports', operations 'view_individual'/'view_group'
// (seedIndividualGroupReportScope.js) — deliberately separate from the OLD
// (reports,'view') key Monthly/Activity Report still use.
async function individualReport(req, res, next) {
  try {
    const role = req.session.staffRole;
    const myName = req.session.staffName;
    const scope = await permissionService.getResourceScope(role, 'reports', 'view_individual');
    if (!scope || scope === 'none') {
      return res.status(403).json({ success: false, error: 'Not authorised to view Individual Report' });
    }
    // 'own' → always the caller, ignoring any staffName param. 'all' → any
    // staffer, defaulting to the caller if none given.
    const staffName = scope === 'all' ? (req.query.staffName || myName) : myName;

    let periodResolved;
    try { periodResolved = rangeReport.resolvePeriod(req.query); }
    catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const { from, to, bucket, period } = periodResolved;

    const { counsellorNames, presalesNames, allNames } = await weeklyStaffNames();
    const isCounselor = counsellorNames.includes(staffName);
    const isPresales   = presalesNames.includes(staffName);

    const [opening, closing, rangeData, callTarget] = await Promise.all([
      membersAsAt([staffName], from.toISOString()),
      membersAsAt([staffName], to.toISOString()),
      rangeReport.computeRangeReport([staffName], from, to, { bucket }),
      isCounselor ? rangeReport.counselorTargetForRange(from, to, bucket)
        : isPresales ? rangeReport.presalesTargetForRange(staffName, from, to, bucket)
        : Promise.resolve(null),
    ]);
    const openIds = new Set(opening.map(r => r.lead_id));
    const closeIds = new Set(closing.map(r => r.lead_id));
    const leadsFlow = {
      opening: { count: opening.length, leads: opening.map(objectToCamelCase) },
      in:      { count: closing.filter(r => !openIds.has(r.lead_id)).length,  leads: closing.filter(r => !openIds.has(r.lead_id)).map(objectToCamelCase) },
      out:     { count: opening.filter(r => !closeIds.has(r.lead_id)).length, leads: opening.filter(r => !closeIds.has(r.lead_id)).map(objectToCamelCase) },
      closing: { count: closing.length, leads: closing.map(objectToCamelCase) },
    };

    const staffOptions = scope === 'all' ? allNames.sort() : [];

    res.json({ success: true, data: {
      period, from: from.toISOString(), to: to.toISOString(), staffName, canPickAnyStaff: scope === 'all', staffOptions,
      role: isCounselor ? 'Counselor' : isPresales ? 'Pre-Sales' : null, callTarget,
      leadsFlow, ...rangeData,
    }});
  } catch (err) { next(err); }
}

async function groupReport(req, res, next) {
  try {
    const role = req.session.staffRole;
    const scope = await permissionService.getResourceScope(role, 'reports', 'view_group');
    if (scope !== 'all') {
      return res.status(403).json({ success: false, error: 'Not authorised to view Company Report' });
    }

    let periodResolved;
    try { periodResolved = rangeReport.resolvePeriod(req.query); }
    catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const { from, to, bucket, period } = periodResolved;

    const { counsellorNames, presalesNames, allNames } = await weeklyStaffNames();

    // Company-wide totals (one computeRangeReport call across everyone) +
    // a per-staff breakdown (one call per person) — mirrors Monthly
    // Report's original per-counselor/per-presales row shape (2026-09:
    // split Team Performance/Telesales back into two tables, matching the
    // old page — see file-header note). Counsellor CALLS target is
    // role-wide (same for everyone), computed once; Pre-Sales target and
    // every Counsellor's own contract-SIGNING target are per-individual,
    // one call per person each — two genuinely different "target" concepts,
    // never merged under one ambiguous column (found while porting, see
    // rangeReport.js's contractTargetForRange comment).
    const [companyWide, counselorCallTarget, counselorLeadCounts, transfersByName, marketingActivities, ...perStaff] = await Promise.all([
      rangeReport.computeRangeReport(allNames, from, to, { bucket, contractedNames: counsellorNames }),
      rangeReport.counselorTargetForRange(from, to),
      rangeReport.leadCounts(counsellorNames, 'counselor', from, to),
      rangeReport.transfersToSalesForRange(presalesNames, from, to),
      rangeReport.marketingActivitiesForRange(from, to),
      ...counsellorNames.map(name => Promise.all([
        rangeReport.computeRangeReport([name], from, to, { bucket }),
        rangeReport.contractTargetForRange(name, from, to),
      ]).then(([d, contractTarget]) => ({ name, role: 'Counselor', data: d, contractTarget }))),
      ...presalesNames.map(name => Promise.all([
        rangeReport.computeRangeReport([name], from, to, { bucket }),
        rangeReport.presalesTargetForRange(name, from, to),
      ]).then(([d, target]) => ({ name, role: 'Pre-Sales', data: d, callTarget: target.total }))),
    ]);

    const counsellorRows = perStaff.filter(r => r.role === 'Counselor');
    const presalesRows   = perStaff.filter(r => r.role === 'Pre-Sales');

    // Team Performance — sales/contract OUTCOME metrics: Total leads, New
    // this period, Contracted, Convert %, In/Out system, case-type split,
    // the real contract-SIGNING target, and the two Letters columns
    // (counted as conversion-adjacent, same as the old page). No calls
    // volume here — that's Telesales below.
    const teamPerformance = counsellorRows.map(r => {
      const lc = counselorLeadCounts.get(r.name) || { total: 0, newThisPeriod: 0 };
      const c = r.data.contracted;
      return {
        fullName: r.name,
        totalLeads: lc.total, newThisPeriod: lc.newThisPeriod,
        contracted: c.count, reversed: r.data.reversed.count,
        convertPct: lc.total > 0 ? Math.round((c.count / lc.total) * 1000) / 10 : null,
        inSystemCount: c.inSystemCount, outSystemCount: c.outSystemCount,
        caseTypeBreakdown: c.caseTypeBreakdown,
        target: r.contractTarget?.total ?? null, // null = not applicable for this period type (see contractTargetForRange)
        basicLetters: r.data.basicLetters.count, finalLetters: r.data.finalLetters.count,
      };
    });

    // Telesales — calls ACTIVITY metrics, same shape as the Pre-sales table
    // below (that's the whole point of the original split: "so counselor
    // calls read as their own report, mirroring Pre-Sales"). Calls target
    // is role-wide (counselorCallTarget, same number for every row here).
    const telesales = counsellorRows.map(r => ({
      fullName: r.name,
      newLeads: r.data.calls.totals.newLeads, ongoing: r.data.calls.totals.ongoing, kbm: r.data.calls.totals.kbm,
      totalCalls: r.data.calls.totals.newLeads + r.data.calls.totals.ongoing,
      target: counselorCallTarget.total,
    }));

    // Pre-sales — same original column set as old Monthly Report: New,
    // Ongoing, Total calls, Calls KPI/%KPI, KBM, Meetings, Transferred to
    // Sales. No Letters (a Counsellor-only activity) and no Total leads/New
    // this period (that was Team Performance-only) — both were wrongly on
    // this row in an earlier pass, caught during the reconciliation request.
    const presales = presalesRows.map(r => {
      const transfers = transfersByName.get(r.name) || [];
      return {
        fullName: r.name,
        newLeads: r.data.calls.totals.newLeads, ongoing: r.data.calls.totals.ongoing, kbm: r.data.calls.totals.kbm,
        totalCalls: r.data.calls.totals.newLeads + r.data.calls.totals.ongoing,
        target: r.callTarget,
        meetings: r.data.meetings.count,
        transferred: transfers.length, transferredItems: transfers,
      };
    });

    res.json({ success: true, data: {
      period, from: from.toISOString(), to: to.toISOString(),
      companyWide, teamPerformance, telesales, presales, marketingActivities,
    }});
  } catch (err) { next(err); }
}

async function weeklyReport(req, res, next) {
  try {
    const role = req.session.staffRole;
    const name = req.session.staffName;
    const scope = await permissionService.getResourceScope(role, 'leads', 'view_list');
    if (!scope || scope === 'none') {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }

    let weekStart;
    if (req.query.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart)) {
      const [yy, mm, dd] = req.query.weekStart.split('-').map(Number);
      weekStart = vnMidnightUTC(yy, mm - 1, dd);
    } else {
      weekStart = vnWeekStart(Date.now(), 1);   // default: the prior full week
    }
    const weekStartYmd = vnYmd(weekStart);
    const mode = req.query.mode || 'all';
    const resourcesParam = (req.query.resources || '').split(',').map(s => s.trim()).filter(Boolean);

    // ── Serve the FROZEN snapshot if one exists (not for ad-hoc 'selected' sets,
    //    which aren't pre-computed). Falls through to live if a requested label
    //    isn't in the snapshot.
    const snap = (await pool.query(
      `SELECT data, generated_at FROM weekly_report_snapshots WHERE week_start = $1`, [weekStartYmd])).rows[0];
    if (snap && mode !== 'selected') {
      const d = snap.data;
      let labels;
      if (scope !== 'all')                                     labels = [name];
      else if (mode === 'groups')                              labels = ['Counsellors', 'Pre-Sales'];
      else if (mode === 'individual' && resourcesParam.length) labels = [resourcesParam[0]];
      else                                                     labels = ['All'];
      const groups = labels.map(lbl => d.byLabel[String(lbl || '').trim()]).filter(Boolean);
      if (groups.length === labels.length) {
        const contractedTotals = scope === 'all' ? d.contractedTotals : (d.byLabel[name]?.contracted || d.contractedTotals);
        return res.json({ success: true, data: {
          weekStart: d.weekStart, weekEnd: d.weekEnd, mode,
          staff: d.staff, contractedTotals, groups,
          frozen: true, asOf: d.asOf, generatedAt: snap.generated_at,
        }});
      }
    }

    // ── Live fallback (no snapshot yet, an older/ad-hoc week, or 'selected'). ──
    const ctx = buildWeeklyCtx(weekStart, Date.now());
    const { counsellorNames, presalesNames, allNames } = await weeklyStaffNames();
    ctx.counsellorSet = new Set(counsellorNames);
    ctx.presalesSet   = new Set(presalesNames);
    ctx.dayTargets    = await loadDayTargets();

    let groupsDef;
    if (scope !== 'all')                                     groupsDef = [{ label: name, names: [name] }];
    else if (mode === 'groups')                              groupsDef = [{ label: 'Counsellors', names: counsellorNames }, { label: 'Pre-Sales', names: presalesNames }];
    else if (mode === 'selected' && resourcesParam.length)   groupsDef = [{ label: 'Selected', names: resourcesParam }];
    else if (mode === 'individual' && resourcesParam.length) groupsDef = [{ label: resourcesParam[0], names: [resourcesParam[0]] }];
    else                                                     groupsDef = [{ label: 'All', names: allNames, companyWide: true }];

    const contractedTotals = await contractedBuckets(ctx, scope === 'all' ? null : [name]);
    const results = [];
    for (const g of groupsDef) {
      results.push({ label: g.label, names: g.names, ...(await computeGroup(g.names, ctx, { companyWideContracted: !!g.companyWide })) });
    }
    res.json({ success: true, data: {
      weekStart: ctx.ws, weekEnd: ctx.we, mode,
      staff: { counsellors: counsellorNames, presales: presalesNames },
      contractedTotals, groups: results, frozen: false,
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

// A week's notes are locked when its ROW was frozen, OR — even with no row yet —
// once the week's report is PUBLISHED (week_start <= latest published week).
// Notes are written DURING the week; the Monday-08:00 publish freezes them with
// the metrics. Only the in-progress (unpublished) week accepts notes.
async function weekNotesLocked(weekStartYmd, rowLockedAt) {
  if (rowLockedAt) return true;
  const mx = (await pool.query(
    `SELECT MAX(week_start)::text AS mx FROM weekly_report_snapshots`)).rows[0].mx;
  return !!mx && weekStartYmd <= mx;   // YYYY-MM-DD strings compare correctly
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
      `SELECT content, updated_by, updated_at, locked_at FROM weekly_recommendations
        WHERE week_start = $1 AND scope_key = $2`, [weekStart, scopeKey]);
    const row = r.rows[0] || null;
    res.json({ success: true, data: {
      content:   row ? row.content    : '',
      updatedBy: row ? row.updated_by : null,
      updatedAt: row ? row.updated_at : null,
      locked:    await weekNotesLocked(weekStart, row && row.locked_at),
      scopeKey,
    }});
  } catch (err) { next(err); }
}

// APPEND-ONLY: existing text is history and cannot be edited. Each save adds a
// stamped supplemental segment. Once the NEXT week's snapshot publishes, the
// row is locked (locked_at) and rejects further additions.
async function saveRecommendation(req, res, next) {
  try {
    const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'view_list');
    if (!scope || scope === 'none') return res.status(403).json({ success: false, error: 'Not authorised' });
    const { weekStart } = req.body || {};
    const addendum = ((req.body && (req.body.addendum ?? req.body.content)) || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) {
      return res.status(400).json({ success: false, error: 'weekStart must be YYYY-MM-DD' });
    }
    if (!addendum) return res.status(400).json({ success: false, error: 'Nothing to add' });
    const scopeKey = await recoScopeKey(req);

    const existing = (await pool.query(
      `SELECT content, locked_at FROM weekly_recommendations WHERE week_start = $1 AND scope_key = $2`,
      [weekStart, scopeKey])).rows[0];
    if (await weekNotesLocked(weekStart, existing && existing.locked_at)) {
      return res.status(409).json({ success: false, error: 'This week\'s notes are frozen.' });
    }
    const vnStamp = new Date(Date.now() + VN_MS).toISOString().slice(0, 16).replace('T', ' ');
    const segment = `[${vnStamp}] ${req.session.staffName || ''}:\n${addendum}`;
    const newContent = existing && existing.content ? `${existing.content}\n\n${segment}` : segment;

    const r = await pool.query(
      `INSERT INTO weekly_recommendations (week_start, scope_key, content, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (week_start, scope_key)
       DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING content, updated_by, updated_at, locked_at`,
      [weekStart, scopeKey, newContent, req.session.staffName || '']);
    const row = r.rows[0];
    res.json({ success: true, data: {
      content: row.content, updatedBy: row.updated_by, updatedAt: row.updated_at,
      locked: !!row.locked_at, scopeKey,
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

// Who may view/manage Monthly Targets: manager-scope (so the Weekly Report
// grid keeps working for any manager) PLUS the dedicated Staff Targets group
// (see authProfiles) — this endpoint is shared by both surfaces.
async function canAccessTargets(req) {
  return (await isManagerScope(req)) || canManageTargets(req.session.staffRole);
}

// Who may use the Staff Targets PAGE's page-only features (Call Targets grid,
// Uncontactable→Pre-sales roster) — deliberately WITHOUT the manager-scope
// fallback above, since these have no other consumer (unlike Monthly
// Targets, nothing else needs a broader manager carve-out for them). Exactly
// the business-defined TARGETS_PROFILES list — CEO/COO/HR Manager/Tech
// Manager (2026-08).
function canAccessStaffTargetsPageOnly(req) {
  return canManageTargets(req.session.staffRole);
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
  return { months, yearStartISO: vnMidnightUTC(2026, 0, 1).toISOString(), yearStartDate: '2026-01-01' };
}

async function monthlyTargets(req, res, next) {
  try {
    if (!(await canAccessTargets(req))) {
      return res.status(403).json({ success: false, error: 'Not authorised to view monthly targets' });
    }

    const { months, yearStartDate } = buildTargetMonths();

    // Tracked counsellors, in display order, with their staff-level fallback target.
    // Only ACTIVE tracked staff appear (inactive counsellors are excluded from
    // both the Staff Targets and Weekly Report grids). The tracked row is kept,
    // so re-activating the staff member restores them automatically.
    const tracked = (await pool.query(
      `SELECT t.staff_id, t.sort_order, s.full_name, COALESCE(s.target, 0) AS fallback_target
         FROM target_tracked_staff t
         JOIN staff s ON s.id = t.staff_id
        WHERE s.is_active = true
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

    // Actuals: contracted signings (still-Contracted) by counsellor name, this
    // year — bucketed by the lead's own actual_close_date (the true signing
    // date, corrected via the admin fix-up script when entered late) rather
    // than the audit-log transition timestamp (when the system happened to
    // record it). Matches Monthly Report's definition of "which month" now,
    // so the two reports agree instead of disagreeing on late-entered leads.
    const actualRows = names.length ? (await pool.query(
      `SELECT lead_id, actual_close_date, counselor
         FROM leads
        WHERE lead_status = 'Contracted'
          AND counselor = ANY($1)
          AND actual_close_date >= $2::date`,
      [names, yearStartDate]
    )).rows : [];

    const actualMap = new Map();               // name -> { label -> count }
    for (const r of actualRows) {
      // actual_close_date is a plain DATE (no time-of-day) — derive the month
      // label straight from its own calendar date via UTC getters, never
      // local-timezone getters (pg returns DATE columns as UTC-midnight JS
      // Date objects; local getters would drift depending on server TZ).
      const d = new Date(r.actual_close_date);
      const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!months.some(mo => mo.label === label)) continue;
      if (!actualMap.has(r.counselor)) actualMap.set(r.counselor, {});
      const byMonth = actualMap.get(r.counselor);
      byMonth[label] = (byMonth[label] || 0) + 1;
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
    if (!(await canAccessTargets(req))) {
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
    if (!(await canAccessTargets(req))) {
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
    if (!(await canAccessTargets(req))) {
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

// ── Call Targets (Monthly Call Volume Targets) — RETIRED 2026-08 ─────────
// Superseded by the Daily Call Quotas grid (Counsellors, role-wide,
// per-weekday) + Pre-sales Working Hours (per-individual, per-weekday) —
// see loadDayTargets() and callDayTargets/presalesWorkingHours below.
// call_targets / call_target_tracked_staff / staff.call_target and its
// sibling columns are deliberately LEFT IN PLACE, unmaintained, rather than
// dropped — old Monthly Report (Server/src/services/monthlyReport.js) still
// reads them for its Calls-KPI columns and is untouched during the
// Individual/Group Report migration; those columns will go stale (frozen at
// whatever was last configured) until Monthly Report itself is retired.
// The UI grid for editing them is removed from StaffTargets.jsx.

// ── Call Day Targets (Staff Targets page, "Daily Call Quotas" grid) ───────
// Counsellors only (2026-08 Phase-0 redesign, planned with Hong Ha) —
// Pre-Sales no longer has a role-wide daily target, see presalesWorkingHours
// below. Per-weekday (0=Mon..6=Sun) New/Ongoing quotas, now also per-month:
// what Weekly Report's "Calls by day" table compares Counsellor actuals
// against (loadDayTargets() above). Always returns all 7 days for the
// requested month, defaulting anything missing to 0, so the frontend never
// has to guard for a hole in the grid.
async function callDayTargets(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised to view call day targets' });
    }
    const mm = String(req.query.month || '');
    const monthDate = /^\d{4}-\d{2}$/.test(mm) ? `${mm}-01` : null;
    if (!monthDate) return res.status(400).json({ success: false, error: 'month (YYYY-MM) is required' });

    const rows = (await pool.query(
      `SELECT day_of_week, new_target, ongoing_target, updated_by, updated_at
         FROM call_day_targets WHERE role = 'Counselor' AND month = $1`,
      [monthDate]
    )).rows;
    const cellMap = new Map();
    for (const r of rows) cellMap.set(r.day_of_week, r);
    const cells = {};
    for (let d = 0; d < 7; d++) {
      const r = cellMap.get(d);
      cells[d] = {
        newTarget:     r ? r.new_target     : 0,
        ongoingTarget: r ? r.ongoing_target : 0,
        updatedBy:     r ? r.updated_by     : null,
        updatedAt:     r ? r.updated_at     : null,
      };
    }
    res.json({ success: true, data: { month: mm, days: [0, 1, 2, 3, 4, 5, 6], role: 'Counselor', cells } });
  } catch (err) { next(err); }
}

async function saveCallDayTarget(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised to edit call day targets' });
    }
    const { month, dayOfWeek, newTarget, ongoingTarget } = req.body || {};
    const mm = String(month || '');
    const monthDate = /^\d{4}-\d{2}$/.test(mm) ? `${mm}-01` : null;
    if (!monthDate) return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    const d = Number(dayOfWeek);
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      return res.status(400).json({ success: false, error: 'dayOfWeek must be an integer 0-6 (0=Mon..6=Sun)' });
    }
    const nNew = Number(newTarget), nOngoing = Number(ongoingTarget);
    if (!Number.isInteger(nNew) || nNew < 0 || !Number.isInteger(nOngoing) || nOngoing < 0) {
      return res.status(400).json({ success: false, error: 'newTarget/ongoingTarget must be non-negative integers' });
    }
    const updatedBy = req.session.staffName || req.session.staffEmail || 'unknown';

    const r = await pool.query(
      `INSERT INTO call_day_targets (role, month, day_of_week, new_target, ongoing_target, updated_by, updated_at)
            VALUES ('Counselor', $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (role, month, day_of_week)
       DO UPDATE SET new_target = EXCLUDED.new_target, ongoing_target = EXCLUDED.ongoing_target,
                      updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING role, to_char(month,'YYYY-MM') AS month, day_of_week AS "dayOfWeek", new_target AS "newTarget", ongoing_target AS "ongoingTarget", updated_by AS "updatedBy", updated_at AS "updatedAt"`,
      [monthDate, d, nNew, nOngoing, updatedBy]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
}

// ── Uncontactable → Pre-sales auto-transfer roster ────────────────────────
// The round-robin pool (see uncontactableTransfer.js). `received` is how
// many transfers each person has gotten so far — shown so it's visible the
// distribution is actually staying even, not just trusted blindly.
async function listUncontactableRoster(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const rows = (await pool.query(`
      SELECT t.staff_id, t.sort_order, t.slot_mode, s.full_name,
             (SELECT COUNT(*) FROM uncontactable_transfers WHERE to_presales_staff_id = t.staff_id)::int AS received
        FROM uncontactable_transfer_presales_staff t
        JOIN staff s ON s.id = t.staff_id
       WHERE s.is_active = true
       ORDER BY t.sort_order, s.full_name
    `)).rows;
    res.json({ success: true, data: rows.map((r) => ({ staffId: r.staff_id, fullName: r.full_name, sortOrder: r.sort_order, slotMode: r.slot_mode, received: r.received })) });
  } catch (err) { next(err); }
}

async function setUncontactableSlotMode(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const staffId = req.params.staffId;
    const { slotMode } = req.body || {};
    if (!['standard', 'evening_gap'].includes(slotMode)) {
      return res.status(400).json({ success: false, error: "slotMode must be 'standard' or 'evening_gap'" });
    }
    const upd = await pool.query(
      `UPDATE uncontactable_transfer_presales_staff SET slot_mode = $1 WHERE staff_id = $2 RETURNING staff_id`,
      [slotMode, staffId]
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Not on the roster' });
    res.json({ success: true, data: { staffId: Number(staffId), slotMode } });
  } catch (err) { next(err); }
}

// ── Pre-sales working-hours grid ──────────────────────────────────────────
// Reshaped 2026-08 (Phase-0 redesign, planned with Hong Ha): per-weekday
// (0=Mon..6=Sun) hours per roster member, per month — replaces the old flat
// hours_per_day x days_per_month average. Drives TWO things now: the
// weighted round-robin's capacity calc (uncontactableTransfer.js
// pickNextPresales) AND each Pre-Sales person's own Calls-KPI target
// (hours x 8, combined New+Ongoing — see computeGroup in this file).
// Editable by whoever can manage Staff Targets (e.g. cô Như / HR). One
// month at a time (matches callDayTargets' shape); "copy forward" fallback
// for an unconfigured month is applied at READ time by consumers
// (pickNextPresales, computeGroup), not stored here — this endpoint only
// returns exactly what's configured for the requested month.
async function presalesWorkingHours(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const mm = String(req.query.month || '');
    const monthDate = /^\d{4}-\d{2}$/.test(mm) ? `${mm}-01` : null;
    if (!monthDate) return res.status(400).json({ success: false, error: 'month (YYYY-MM) is required' });

    const roster = (await pool.query(`
      SELECT t.staff_id, t.sort_order, t.slot_mode, s.full_name
        FROM uncontactable_transfer_presales_staff t
        JOIN staff s ON s.id = t.staff_id
       WHERE s.is_active = true
       ORDER BY t.sort_order, s.full_name
    `)).rows;
    const staffIds = roster.map((r) => r.staff_id);
    const hourRows = staffIds.length ? (await pool.query(
      `SELECT staff_id, day_of_week, hours, updated_by, updated_at
         FROM presales_working_hours WHERE staff_id = ANY($1) AND month = $2`,
      [staffIds, monthDate]
    )).rows : [];
    const hoursMap = new Map(); // `${staffId}|${dow}` -> row
    for (const h of hourRows) hoursMap.set(`${h.staff_id}|${h.day_of_week}`, h);
    const rows = roster.map((r) => {
      const cells = {};
      for (let d = 0; d < 7; d++) {
        const h = hoursMap.get(`${r.staff_id}|${d}`);
        cells[d] = { hours: h ? Number(h.hours) : 0, updatedBy: h ? h.updated_by : null, updatedAt: h ? h.updated_at : null };
      }
      return { staffId: r.staff_id, fullName: r.full_name, slotMode: r.slot_mode, cells };
    });
    res.json({ success: true, data: { month: mm, days: [0, 1, 2, 3, 4, 5, 6], rows } });
  } catch (err) { next(err); }
}

async function savePresalesWorkingHours(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const { staffId, month, dayOfWeek, hours } = req.body || {};
    const mm = String(month || '');
    if (!staffId || !/^\d{4}-\d{2}$/.test(mm)) {
      return res.status(400).json({ success: false, error: 'staffId and month (YYYY-MM) are required' });
    }
    const d = Number(dayOfWeek);
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      return res.status(400).json({ success: false, error: 'dayOfWeek must be an integer 0-6 (0=Mon..6=Sun)' });
    }
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0) {
      return res.status(400).json({ success: false, error: 'hours must be a non-negative number' });
    }
    const updatedBy = req.session.staffName || req.session.staffEmail || 'unknown';
    await pool.query(
      `INSERT INTO presales_working_hours (staff_id, month, day_of_week, hours, updated_by)
       VALUES ($1, ($2 || '-01')::date, $3, $4, $5)
       ON CONFLICT (staff_id, month, day_of_week)
         DO UPDATE SET hours = EXCLUDED.hours, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [staffId, mm, d, h, updatedBy]
    );
    res.json({ success: true, data: { staffId: Number(staffId), month: mm, dayOfWeek: d, hours: h } });
  } catch (err) { next(err); }
}

async function addUncontactableRosterStaff(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
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
      `INSERT INTO uncontactable_transfer_presales_staff (staff_id, sort_order, added_by)
            VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM uncontactable_transfer_presales_staff), $2)
       ON CONFLICT (staff_id) DO NOTHING`,
      [staffId, addedBy]
    );
    res.json({ success: true, data: { staffId: Number(staffId), fullName: exists.rows[0].full_name } });
  } catch (err) { next(err); }
}

async function removeUncontactableRosterStaff(req, res, next) {
  try {
    if (!canAccessStaffTargetsPageOnly(req)) {
      return res.status(403).json({ success: false, error: 'Not authorised' });
    }
    const staffId = req.params.staffId;
    if (!staffId || !/^\d+$/.test(String(staffId))) {
      return res.status(400).json({ success: false, error: 'staffId is required' });
    }
    // uncontactable_transfers history is intentionally preserved (audit trail
    // + keeps the "received" count meaningful if this person is re-added later).
    await pool.query(`DELETE FROM uncontactable_transfer_presales_staff WHERE staff_id = $1`, [staffId]);
    res.json({ success: true, data: { staffId: Number(staffId), removed: true } });
  } catch (err) { next(err); }
}

// Regenerate one week's snapshot on demand (admin "re-publish").
async function regenerateWeeklySnapshot(req, res, next) {
  try {
    const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'view_list');
    if (scope !== 'all') return res.status(403).json({ success: false, error: 'Not authorised' });
    let weekStart;
    if (req.query.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart)) {
      const [yy, mm, dd] = req.query.weekStart.split('-').map(Number);
      weekStart = vnMidnightUTC(yy, mm - 1, dd);
    } else {
      weekStart = vnWeekStart(Date.now(), 1);
    }
    // Only COMPLETED weeks can be published — publishing the in-progress week
    // would freeze its notes prematurely and snapshot a half-week.
    if (weekStart.getTime() + 7 * 86400000 > Date.now()) {
      return res.status(400).json({ success: false, error: 'This week is still in progress — it publishes automatically Monday 08:00.' });
    }
    const wk = await generateWeeklySnapshot(weekStart);
    res.json({ success: true, data: { weekStart: wk } });
  } catch (err) { next(err); }
}

// Freeze recommendation notes for all weeks THROUGH the given week (YYYY-MM-DD).
// Called by the Monday-08:00 scheduler when it publishes a week: notes are
// written during the week and freeze together with the metrics at publish.
async function lockRecommendationsBefore(weekStartYmd) {
  const r = await pool.query(
    `UPDATE weekly_recommendations SET locked_at = now()
      WHERE week_start <= $1 AND locked_at IS NULL`, [weekStartYmd]);
  if (r.rowCount) console.log(`[weekly-snapshot] froze ${r.rowCount} recommendation note(s) through ${weekStartYmd}`);
  return r.rowCount;
}

module.exports = {
  notesActivity, contractedStats, weeklyReport, getRecommendation, saveRecommendation,
  individualReport, groupReport,
  monthlyTargets, saveMonthlyTarget, addTrackedStaff, removeTrackedStaff,
  callDayTargets, saveCallDayTarget,
  listUncontactableRoster, addUncontactableRosterStaff, removeUncontactableRosterStaff, setUncontactableSlotMode,
  presalesWorkingHours, savePresalesWorkingHours,
  // Frozen Weekly Report: scheduler + manual re-publish + note freezing.
  generateWeeklySnapshot, vnWeekStart, regenerateWeeklySnapshot, lockRecommendationsBefore,
  // Exported for reuse by rangeReport.js (Individual/Group Report, 2026-08) —
  // point-in-time book reconstruction is complex enough that it should have
  // exactly one implementation, not a second copy for arbitrary ranges.
  membersAsAt, vnMidnightUTC, weeklyStaffNames,
};
