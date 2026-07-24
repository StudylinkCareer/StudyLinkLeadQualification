// Server/src/services/eventSourceBreakdown.js
// ─────────────────────────────────────────────────────────────────────
// Lead-source breakdown for the Event Report page (LM console -> Report ->
// Event Report). Separate from eventReportData.js (the existing per-event
// file/AI-narrative generator) because that file's "registered" figure comes
// from event_attendees, which only gains a row on badge-issue/check-in — not
// true registration. True registration is a lead_events row. Reusing
// eventReportData here would silently undercount "Đăng ký".
//
// Mirrors reportController.js's bucketFor()/primaryStaffOf() pattern: the SQL
// stays a plain join, classification and aggregation happen in JS.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Resolve the display label for a registration's lead source. Priority:
//   1. Channel (Facebook/Zalo/TikTok/...) from the event-registration record
//   2. Referral (Sub-agent/Partner/Ex-client) + who — free text, shown as-is
//   3. Per-registration source/source_detail mirror fields — UNLESS the
//      Source-of-Lead picked was "Events" mode, in which case le.source is
//      just the name of an event (usually THIS same event: the LQ app sets
//      lead_events.event_id and the "source" event to the same picked value,
//      so on-site registrants are tautologically "sourced from" the fair
//      they're standing in). Showing that raw event name as if it were a
//      channel like "FB ads" is meaningless noise, so it's collapsed to the
//      Source-of-Lead lookup's own label instead (e.g. "Sự kiện / Event").
//   4. Student-level fallback (older registrations captured before per-event
//      attribution existed), same Events-mode collapse applied
//   5. Unknown
function resolveSourceLabel(row) {
  if (row.ev_heard_type === 'Channel' && row.ev_channel) {
    return row.ev_channel;
  }
  if (row.ev_heard_type === 'Referral' && row.ev_referral_kind) {
    const who = (row.ev_referral_who || '').trim();
    return `${row.ev_referral_kind}${who ? ': ' + who : ''}`;
  }
  if (row.le_sol_mode === 'events') {
    return row.le_sol_label || 'Event/Campaign';
  }
  const leSource = [row.le_source, row.le_source_detail].filter(Boolean).join(' - ');
  if (leSource) return leSource;

  if (row.s_sol_mode === 'events') {
    return row.s_sol_label || 'Event/Campaign';
  }
  const sSource = [row.s_lead_source || row.s_source, row.s_source_detail].filter(Boolean).join(' - ');
  if (sSource) return sSource;

  return '(Unknown / not recorded)';
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

// Same precedence as reportController.js's primaryStaffOf() (not exported
// from there, so replicated here rather than cross-importing a controller
// into a service).
function primaryStaffOf(row) {
  return row.counselor || row.senior_counselor || row.presales || row.marketing_staff || '(unassigned)';
}

// Generic rollup used for both bySource (grouped by lead source) and byTier
// (grouped by Stone Tier) — same shape, same percentage math, just a
// different grouping key function.
function rollUp(byLead, keyFn, spendByKey, eventKeyForSpend) {
  const map = new Map();
  for (const lead of byLead) {
    const key = keyFn(lead);
    if (!map.has(key)) map.set(key, { key, registered: 0, confirmed: 0, attended: 0 });
    const e = map.get(key);
    e.registered += 1;
    if (lead.confirmed) e.confirmed += 1;
    if (lead.attended) e.attended += 1;
  }
  return Array.from(map.values())
    .map((e) => {
      const spend = spendByKey && eventKeyForSpend != null ? spendByKey.get(`${eventKeyForSpend}::${e.key}`) : null;
      return {
        ...e,
        confirmedOverRegistered: pct(e.confirmed, e.registered),
        attendedOverConfirmed: pct(e.attended, e.confirmed),
        attendedOverRegistered: pct(e.attended, e.registered),
        spendAmount: spend != null ? Number(spend) : null,
        cpl: spend != null && e.registered ? Math.round(Number(spend) / e.registered) : null,
      };
    })
    .sort((a, b) => b.registered - a.registered);
}

// gatherSourceBreakdown(eventIds) -> { events, bySource, byTier, byLead }
async function gatherSourceBreakdown(eventIds) {
  const ids = (eventIds || []).map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
  if (!ids.length) return { events: [], bySource: [], byTier: [], byLead: [] };

  const [regRes, schoolsRes, spendRes] = await Promise.all([
    pool.query(
      `SELECT le.event_id, le.student_id, le.status AS lead_event_status, le.created_at AS registered_for_event_at,
              le.ev_heard_type, le.ev_channel, le.ev_referral_kind, le.ev_referral_who,
              le.source AS le_source, le.source_detail AS le_source_detail,
              s.full_name, s.lead_source AS s_lead_source, s.source AS s_source, s.source_detail AS s_source_detail,
              s.stone_tier,
              ea.registered_at, ea.attended_at,
              rl.lead_id, rl.lead_status, rl.actual_close_date,
              rl.counselor, rl.senior_counselor, rl.presales, rl.marketing_staff,
              solv.meta->>'mode' AS le_sol_mode, COALESCE(solv.label_vi, solv.label_en, solv.code) AS le_sol_label,
              ssolv.meta->>'mode' AS s_sol_mode, COALESCE(ssolv.label_vi, ssolv.label_en, ssolv.code) AS s_sol_label
         FROM (
               SELECT DISTINCT ON (student_id, event_id) *
                 FROM lead_events
                WHERE event_id = ANY($1)
                ORDER BY student_id, event_id, created_at ASC
              ) le
         JOIN students s ON s.student_id = le.student_id
         LEFT JOIN event_attendees ea ON ea.event_id = le.event_id AND ea.student_unique_id = le.student_id
         LEFT JOIN LATERAL (
               SELECT lead_id, lead_status, actual_close_date, counselor, senior_counselor, presales, marketing_staff
                 FROM leads
                WHERE person_id = le.student_id
                ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id DESC
                LIMIT 1
              ) rl ON true
         LEFT JOIN lookup_values solv ON solv.category = 'source_of_lead' AND solv.code = le.source_of_lead
         LEFT JOIN lookup_values ssolv ON ssolv.category = 'source_of_lead' AND ssolv.code = s.lead_source`,
      [ids]
    ),
    pool.query(
      `SELECT ei.event_id, i.id AS institution_id, i.name
         FROM event_institutions ei
         JOIN institutions i ON i.id = ei.institution_id
        WHERE ei.event_id = ANY($1) AND ei.is_active = true
        ORDER BY ei.event_id, i.name`,
      [ids]
    ),
    pool.query(
      `SELECT event_id, source_label, spend_amount
         FROM event_source_spend
        WHERE event_id = ANY($1)`,
      [ids]
    ),
  ]);

  const schoolsByEvent = new Map();
  for (const row of schoolsRes.rows) {
    if (!schoolsByEvent.has(row.event_id)) schoolsByEvent.set(row.event_id, []);
    schoolsByEvent.get(row.event_id).push({ id: row.institution_id, name: row.name });
  }
  const spendByKey = new Map(spendRes.rows.map((r) => [`${r.event_id}::${r.source_label}`, r.spend_amount]));

  // A registrant only counts as "Contracted via this event" if their
  // representative lead (rl — same precedence used for counselor above) is
  // itself Contracted AND it closed on/after they registered for THIS event.
  // There is no FK linking a lead to the event that produced it (a
  // student/Sale can carry many unrelated leads over time per the
  // connected-unit model), so "any Contracted lead ever" — the old query —
  // wrongly credited this event with contracts from prior, unrelated
  // engagements. events.start_date turned out to be an unreliable cutoff too
  // (it reflects when registration opened, sometimes weeks before the event
  // itself, so it let old contracts through) — the registration timestamp on
  // THIS student's own lead_events row is the only date directly tied to
  // this specific event. It's still only a proxy, not a guarantee (a lead
  // that closes hours after registering could be a coincidence, e.g. a
  // pre-arranged deal just being logged the same day) — staff can verify
  // exactly which leads are counted via the `isContracted` flag on each
  // byLead row and the drill-down list this produces.
  const byLead = regRes.rows.map((row) => {
    const isContracted = row.lead_status === 'Contracted'
      && row.actual_close_date != null
      && row.registered_for_event_at != null
      && new Date(row.actual_close_date) >= new Date(row.registered_for_event_at);
    return {
      eventId: row.event_id,
      studentId: row.student_id,
      fullName: row.full_name,
      sourceLabel: resolveSourceLabel(row),
      stoneTier: row.stone_tier || 'Unscored',
      counselor: primaryStaffOf(row),
      confirmed: row.lead_event_status === 'Confirmed',
      status: row.lead_event_status,
      attended: row.attended_at != null,
      registeredAt: row.registered_at,
      attendedAt: row.attended_at,
      leadId: row.lead_id,
      leadStatus: row.lead_status,
      isContracted,
    };
  });

  // ── Per-event totals ──
  const eventTotals = new Map();
  for (const id of ids) {
    const schools = schoolsByEvent.get(id) || [];
    eventTotals.set(id, {
      eventId: id, registered: 0, confirmed: 0, attended: 0,
      schoolsCount: schools.length,
      schoolsList: schools,
      contractedCount: 0,
      contractedLeads: [],
    });
  }
  for (const lead of byLead) {
    const t = eventTotals.get(lead.eventId);
    if (!t) continue;
    t.registered += 1;
    if (lead.confirmed) t.confirmed += 1;
    if (lead.attended) t.attended += 1;
    if (lead.isContracted) {
      t.contractedCount += 1;
      t.contractedLeads.push({
        studentId: lead.studentId, fullName: lead.fullName, leadId: lead.leadId, sourceLabel: lead.sourceLabel,
      });
    }
  }
  const events = Array.from(eventTotals.values()).map((t) => ({
    ...t,
    confirmedOverRegistered: pct(t.confirmed, t.registered),
    attendedOverConfirmed: pct(t.attended, t.confirmed),
    attendedOverRegistered: pct(t.attended, t.registered),
  }));

  // Spend/CPL only makes sense keyed to ONE event (a Compare-mode multi-event
  // call has no single event to attach event_source_spend rows to).
  const eventKeyForSpend = ids.length === 1 ? ids[0] : null;

  // ── Breakdown by source (single-event callers pass one id; multi-event
  // callers get sources merged across all requested events) ──
  const bySource = rollUp(byLead, (l) => l.sourceLabel, spendByKey, eventKeyForSpend)
    .map(({ key, ...rest }) => ({ sourceLabel: key, ...rest }));

  // ── Breakdown by Stone Tier (drives the "by tier" pie charts) — same
  // shape as bySource, no spend/CPL concept for tiers.
  const byTier = rollUp(byLead, (l) => l.stoneTier, null, null)
    .map(({ key, spendAmount, cpl, ...rest }) => ({ stoneTier: key, ...rest }));

  return { events, bySource, byTier, byLead };
}

async function setSourceSpend(eventId, sourceLabel, amount, updatedBy) {
  await pool.query(
    `INSERT INTO event_source_spend (event_id, source_label, spend_amount, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (event_id, source_label) DO UPDATE
       SET spend_amount = EXCLUDED.spend_amount, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [eventId, sourceLabel, amount, updatedBy || null]
  );
}

module.exports = { gatherSourceBreakdown, setSourceSpend, resolveSourceLabel };
