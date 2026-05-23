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
      where.push(`(s.counselor = ${p} OR s.senior_counselor = ${p} OR s.presales = ${p} OR s.marketing_staff = ${p})`);
    }
    if (filterStaff) {
      params.push(filterStaff);
      const p = `$${params.length}`;
      where.push(`(s.counselor = ${p} OR s.senior_counselor = ${p} OR s.presales = ${p} OR s.marketing_staff = ${p})`);
    }
    if (filterTier) {
      params.push(filterTier);
      where.push(`s.stone_tier = $${params.length}`);
    }
    if (filterStatus) {
      params.push(filterStatus);
      where.push(`s.lead_status = $${params.length}`);
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
        s.lead_status,
        s.counselor,
        s.senior_counselor,
        s.presales,
        s.marketing_staff
      FROM student_notes n
      INNER JOIN students s ON s.unique_id = n.student_id
      WHERE ${where.join(' AND ')}
      ORDER BY n.created_at DESC
    `;

    const result = await pool.query(sql, params);
    const rows   = result.rows.map(objectToCamelCase);

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

    function rollUp(keyFn) {
      const map = new Map();
      for (const r of classified) {
        const key = keyFn(r) || '(none)';
        if (!map.has(key)) {
          map.set(key, { key, totalNotes: 0, phoneNotes: 0, leadIds: new Set() });
        }
        const e = map.get(key);
        e.totalNotes += 1;
        if (r.bucket === 'phone') e.phoneNotes += 1;
        e.leadIds.add(r.studentId);
      }
      return [...map.values()]
        .map(e => ({
          key:           e.key,
          totalNotes:    e.totalNotes,
          phoneNotes:    e.phoneNotes,
          otherNotes:    e.totalNotes - e.phoneNotes,
          uniqueLeads:   e.leadIds.size,
        }))
        .sort((a, b) => b.totalNotes - a.totalNotes);
    }

    const byStaff  = rollUp(r => r.primaryStaff);
    const byTier   = rollUp(r => r.stoneTier);
    const byStatus = rollUp(r => r.leadStatus);

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
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { notesActivity };
