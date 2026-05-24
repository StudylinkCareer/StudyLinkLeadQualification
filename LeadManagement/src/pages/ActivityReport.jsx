// LeadManagement/src/pages/ActivityReport.jsx
//
// PURPOSE
//   Phone vs other-note activity dashboard. Aligned visually with
//   Dashboard.jsx (StatCard + HBarChart, drill-down right panel).
//
// VIEWS BY ROLE
//   Admin / Director / Manager:  see all staff. Default drill: by-staff chart.
//   Counselor / Pre-Sales:       see only their own data — by-staff chart
//                                hidden (would be one bar anyway), goes straight
//                                to tier/status breakdown for their leads.
//
// DRILL FLOW
//   Click a bar in "Notes by Staff"  → right panel shows that staff's
//                                       Tier + Status mini-charts +
//                                       lead-level table below.
//   Click a bar in "Notes by Tier"   → filters the lead-level table.
//   Click a bar in "Notes by Status" → filters the lead-level table.
//   Click a lead row's →             → navigates to /leads/:id (Lead Detail).
//
// PERFORMANCE
//   One API call returns all roll-ups. No per-row queries from JS.
//   Refilters re-fetch only if date range changes; other filters can
//   be applied client-side over the already-loaded data.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiX, FiDownload, FiPhone, FiMessageSquare, FiRefreshCw, FiArrowRight } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI, staffAPI } from '../services/api';
import { stoneLabel } from '../utils/stoneLabels';
import Watermark from '../components/Watermark';

// ── Local helpers ─────────────────────────────────────────────
function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Colour palette — mirrors Dashboard.jsx where possible.
const COLORS = {
  primary:  '#2563EB',
  phone:    '#10B981',  // green — phone activity is the "good" signal
  other:    '#94A3B8',  // grey — other notes
  warn:     '#F59E0B',
  danger:   '#DC2626',
};

const STONE_COLORS = {
  Diamond:  '#8B5CF6',
  Ruby:     '#DC2626',
  Sapphire: '#2563EB',
  Agate:    '#F59E0B',
  Quartz:   '#94A3B8',
  Unscored: '#6B7280',
};

// ── Stat card (matches Dashboard.jsx) ─────────────────────────
function StatCard({ label, value, sub, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      background:'var(--bg-primary)', border:'1px solid var(--border)',
      borderRadius:'10px', padding:'1rem 1.25rem',
      cursor: onClick ? 'pointer' : 'default',
      borderLeft: `4px solid ${color || 'var(--border)'}`,
      transition:'box-shadow 0.15s',
    }}
    onMouseEnter={e=>{ if(onClick) e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'; }}
    onMouseLeave={e=>{ e.currentTarget.style.boxShadow='none'; }}>
      <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500, marginBottom:'0.25rem' }}>{label}</div>
      <div style={{ fontSize:'1.75rem', fontWeight:600, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.25rem' }}>{sub}</div>}
    </div>
  );
}

// ── Stacked horizontal bar chart (phone vs other) ─────────────
// Each row shows two segments: phone (green) and other (grey), stacked
// horizontally. Hover tooltip shows breakdown. Click triggers drill.
function StackedBarChart({ data, onBarClick, displayFor, colorMap, selectedKey }) {
  const max = Math.max(...data.map(d => d.totalNotes), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
      {data.map(entry => {
        const display    = displayFor ? displayFor(entry.key) : entry.key;
        const totalPct   = (entry.totalNotes / max) * 100;
        const phonePct   = entry.totalNotes > 0 ? (entry.phoneNotes / entry.totalNotes) * 100 : 0;
        const otherPct   = 100 - phonePct;
        const isSelected = selectedKey === entry.key;
        const tierColor  = colorMap?.[entry.key];
        // Bars with no notes are kept visible (so users see the dimension
        // still exists in the dataset) but greyed out at reduced opacity
        // and made non-clickable.
        const isEmpty    = entry.totalNotes === 0;
        const rowClickable = onBarClick && !isEmpty;
        return (
          <div
            key={entry.key}
            onClick={() => rowClickable && onBarClick(entry.key)}
            style={{
              display:'flex', alignItems:'center', gap:'0.5rem',
              cursor: rowClickable ? 'pointer' : 'default',
              padding:'2px 4px', borderRadius:'4px',
              background: isSelected ? 'var(--primary-light)' : 'transparent',
              opacity: isEmpty ? 0.45 : 1,
              transition:'background 0.15s, opacity 0.2s',
            }}
            title={`${display} — ${entry.totalNotes} notes (${entry.phoneNotes} phone, ${entry.otherNotes} other) across ${entry.uniqueLeads} leads with notes — ${entry.totalLeads ?? entry.uniqueLeads} leads total`}>
            <div style={{
              fontSize:'0.75rem', color:'var(--text-secondary)',
              width:'130px', flexShrink:0, textAlign:'right',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              fontWeight: isSelected ? 600 : 400,
            }}>
              {tierColor && (
                <span style={{
                  display:'inline-block', width:'8px', height:'8px',
                  borderRadius:'50%', background: tierColor,
                  marginRight:'4px', verticalAlign:'middle',
                }}/>
              )}
              {display}
            </div>
            <div style={{
              flex:1, height:'22px', background:'var(--bg-secondary)',
              borderRadius:'4px', overflow:'hidden', display:'flex',
              minWidth:0,
            }}>
              <div style={{ width:`${totalPct}%`, height:'100%', display:'flex' }}>
                <div style={{
                  height:'100%', width:`${phonePct}%`,
                  background: COLORS.phone,
                  transition:'width 0.4s ease',
                }}/>
                <div style={{
                  height:'100%', width:`${otherPct}%`,
                  background: COLORS.other,
                  transition:'width 0.4s ease',
                }}/>
              </div>
            </div>
            <div style={{
              fontSize:'0.8125rem', fontWeight:600,
              minWidth:'70px', textAlign:'right',
              color:'var(--text-primary)',
            }}>
              {entry.phoneNotes}
              <span style={{ color:'var(--text-secondary)', fontWeight:400 }}> / {entry.totalNotes}</span>
            </div>
          </div>
        );
      })}
      {data.length === 0 && (
        <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem', padding:'1rem', textAlign:'center' }}>
          No activity in this window
        </div>
      )}
    </div>
  );
}

// ── Legend (small, inline) ────────────────────────────────────
function Legend() {
  return (
    <div style={{ display:'flex', gap:'1rem', fontSize:'0.7rem', color:'var(--text-secondary)' }}>
      <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
        <span style={{ width:'10px', height:'10px', background: COLORS.phone, borderRadius:'2px' }}/>
        Phone
      </span>
      <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
        <span style={{ width:'10px', height:'10px', background: COLORS.other, borderRadius:'2px' }}/>
        Other
      </span>
    </div>
  );
}

// ── Filter chip ───────────────────────────────────────────────
// Pill showing an active filter (e.g. "Staff: Nguyễn Thị Mỹ Ly ×").
// Clicking the × clears just that filter; other filters remain active.
function FilterChip({ label, value, onRemove }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'6px',
      padding:'4px 8px 4px 10px',
      background:'var(--bg-primary)',
      border:'1px solid var(--border)',
      borderRadius:'14px',
      fontSize:'0.75rem',
    }}>
      <span style={{ color:'var(--text-secondary)', fontWeight:500 }}>{label}:</span>
      <span style={{ fontWeight:600, color:'var(--text-primary)' }}>{value}</span>
      <button
        type="button"
        onClick={onRemove}
        title="Remove this filter"
        aria-label={`Remove ${label} filter`}
        style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:'18px', height:'18px',
          border:'none', borderRadius:'50%',
          background:'transparent', cursor:'pointer',
          color:'var(--text-secondary)',
          padding:0, marginLeft:'2px',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--danger)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        <FiX size={12}/>
      </button>
    </span>
  );
}

// ── Main component ───────────────────────────────────────────
export default function ActivityReport() {
  const navigate = useNavigate();
  const { staff }    = useAuth();
  const { scope }    = usePermissions();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();

  // Permissions — gate the page itself and the Excel-export button.
  const hasAllScope    = scope('reports', 'view') === 'all';
  const canExportExcel = (staff?.role === 'Admin' || staff?.role === 'Director');

  // ── Filter / date state ─────────────────────────────────────
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(10));
  const [dateTo,   setDateTo]   = useState(todayIso());

  // Drill selections — set by clicking bars. Null = no filter.
  const [selectedStaff,  setSelectedStaff]  = useState(null);
  const [selectedTier,   setSelectedTier]   = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);

  // Raw report payload + load state
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // ── Navigation trail entry ──────────────────────────────────
  // Push (or update) the trail entry whenever the page mounts or its
  // filter context changes. The same path means push() will update the
  // existing entry rather than create a new one — so drilling deeper
  // doesn't pile up the trail.
  useEffect(() => {
    const parts = [];
    if (selectedStaff)  parts.push(`Staff: ${selectedStaff}`);
    if (selectedTier)   parts.push(`Tier: ${selectedTier}`);
    if (selectedStatus) parts.push(`Status: ${selectedStatus}`);
    const label = parts.length
      ? `Activity Report (${parts.join(', ')})`
      : 'Activity Report';
    pushTrail({ label, path: '/reports/activity' });
  }, [pushTrail, selectedStaff, selectedTier, selectedStatus]);

  // ── Fetch data ──────────────────────────────────────────────
  const loadReport = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { dateFrom, dateTo };
      const res = await reportsAPI.notesActivity(params);
      setReport(res.data || null);
    } catch (e) {
      setError(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // When a category bar is labelled "(none)", that means "leads where the
  // field is null/empty". The lead-level data has actual null/empty values
  // in those fields, not the literal string "(none)", so we need a matcher
  // that treats both as equivalent.
  const isNone = v => v == null || v === '';
  const matchesCategory = (leadValue, selectedValue) =>
    selectedValue === '(none)' ? isNone(leadValue) : leadValue === selectedValue;

  // ── Filter the by-lead table client-side ────────────────────
  // The roll-ups (byStaff, byTier, byStatus) always reflect the full
  // server payload — they're our drill navigation surface. The lead
  // table at the bottom narrows based on bar selections.
  const filteredLeads = useMemo(() => {
    if (!report) return [];
    let r = report.byLead;
    if (selectedStaff)  r = r.filter(l => matchesCategory(l.primaryStaff, selectedStaff));
    if (selectedTier)   r = r.filter(l => matchesCategory(l.stoneTier,    selectedTier));
    if (selectedStatus) r = r.filter(l => matchesCategory(l.leadStatus,   selectedStatus));
    return r;
  }, [report, selectedStaff, selectedTier, selectedStatus]);

  // Total leads matching the current drill (independent of notes).
  // Used in the lead-table heading: "Leads (filtered: 8 with notes, 12 total)".
  const totalLeadsInDrill = useMemo(() => {
    if (!report?.allLeads) return null;
    let r = report.allLeads;
    if (selectedStaff)  r = r.filter(l => matchesCategory(l.primaryStaff, selectedStaff));
    if (selectedTier)   r = r.filter(l => matchesCategory(l.stoneTier,    selectedTier));
    if (selectedStatus) r = r.filter(l => matchesCategory(l.leadStatus,   selectedStatus));
    return r.length;
  }, [report, selectedStaff, selectedTier, selectedStatus]);

  // ── Cross-filtered chart datasets ───────────────────────────
  // Each chart is filtered by the OTHER two selections, but NOT by its own
  // dimension. So clicking Staff=X narrows the Tier+Status charts to X's
  // data, while leaving the Staff chart unchanged (so you can still pick
  // a different staff member). This gives the user 6 equivalent drill
  // pathways (Staff→Tier→Status, Tier→Staff→Status, etc.) that all
  // converge to the same lead list.
  //
  // Bars for categories with 0 notes are still included (greyed out in the
  // chart component) so the available dimensions remain visible during drill.
  const crossFilteredCharts = useMemo(() => {
    if (!report) return { byStaff: [], byTier: [], byStatus: [] };

    // Build a roll-up over byLead (note counts) + allLeads (total leads),
    // optionally pre-filtered by a subset of {staff, tier, status} drill
    // selections (the ones that should APPLY to this chart).
    function buildRollup(dimensionAccessor, applyStaff, applyTier, applyStatus) {
      // Filter byLead by the OTHER active selections (excluding the one
      // this chart represents).
      let notes = report.byLead || [];
      if (applyStaff  && selectedStaff)  notes = notes.filter(l => matchesCategory(l.primaryStaff, selectedStaff));
      if (applyTier   && selectedTier)   notes = notes.filter(l => matchesCategory(l.stoneTier,    selectedTier));
      if (applyStatus && selectedStatus) notes = notes.filter(l => matchesCategory(l.leadStatus,   selectedStatus));

      // Same for allLeads (for the totalLeads count per category).
      let pool = report.allLeads || [];
      if (applyStaff  && selectedStaff)  pool = pool.filter(l => matchesCategory(l.primaryStaff, selectedStaff));
      if (applyTier   && selectedTier)   pool = pool.filter(l => matchesCategory(l.stoneTier,    selectedTier));
      if (applyStatus && selectedStatus) pool = pool.filter(l => matchesCategory(l.leadStatus,   selectedStatus));

      // Group both arrays by the chart's own dimension.
      const noteMap = new Map();
      for (const l of notes) {
        const key = dimensionAccessor(l) || '(none)';
        if (!noteMap.has(key)) noteMap.set(key, { key, totalNotes: 0, phoneNotes: 0, leadIds: new Set() });
        const e = noteMap.get(key);
        e.totalNotes += l.totalNotes;
        e.phoneNotes += l.phoneNotes;
        e.leadIds.add(l.studentId);
      }
      const totalByKey = new Map();
      for (const l of pool) {
        const key = dimensionAccessor(l) || '(none)';
        totalByKey.set(key, (totalByKey.get(key) || 0) + 1);
      }
      // Categories from either side, merged.
      const keys = new Set([...noteMap.keys(), ...totalByKey.keys()]);
      const out = [];
      for (const key of keys) {
        const n = noteMap.get(key) || { totalNotes: 0, phoneNotes: 0, leadIds: new Set() };
        out.push({
          key,
          totalNotes:  n.totalNotes,
          phoneNotes:  n.phoneNotes,
          otherNotes:  n.totalNotes - n.phoneNotes,
          uniqueLeads: n.leadIds.size,
          totalLeads:  totalByKey.get(key) || 0,
        });
      }
      // Sort by total notes desc, with zero-bars at the bottom in alpha order.
      return out.sort((a, b) => {
        if ((b.totalNotes > 0) !== (a.totalNotes > 0)) {
          return (b.totalNotes > 0 ? 1 : 0) - (a.totalNotes > 0 ? 1 : 0);
        }
        if (b.totalNotes !== a.totalNotes) return b.totalNotes - a.totalNotes;
        return String(a.key).localeCompare(String(b.key));
      });
    }

    return {
      // Staff chart: filtered by Tier + Status (not by Staff itself)
      byStaff:  buildRollup(l => l.primaryStaff, false, true,  true),
      // Tier chart: filtered by Staff + Status
      byTier:   buildRollup(l => l.stoneTier,    true,  false, true),
      // Status chart: filtered by Staff + Tier
      byStatus: buildRollup(l => l.leadStatus,   true,  true,  false),
    };
  }, [report, selectedStaff, selectedTier, selectedStatus]);

  // ── Excel export ────────────────────────────────────────────
  // Pulls the same filtered set you're looking at and produces a CSV-ish
  // download via Blob — no external library needed.
  function exportToCsv() {
    if (!filteredLeads.length) { alert('Nothing to export'); return; }
    const header = ['Lead ID','Lead Name','Tier','Status','Primary Staff','Total Notes','Phone Notes','Other Notes','Last Phone','Last Note','Days Since Phone'];
    const rows = filteredLeads.map(l => [
      l.studentId, l.leadName, l.stoneTier || '', l.leadStatus || '',
      l.primaryStaff || '',
      l.totalNotes, l.phoneNotes, l.otherNotes,
      l.lastPhoneAt ? new Date(l.lastPhoneAt).toLocaleString('en-GB') : '',
      l.lastNoteAt  ? new Date(l.lastNoteAt ).toLocaleString('en-GB') : '',
      l.daysSincePhone == null ? '' : l.daysSincePhone,
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(cell => {
        const s = String(cell ?? '');
        // Quote anything containing comma/quote/newline
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','))
      .join('\n');
    // Add BOM so Excel reads UTF-8 (Vietnamese diacritics)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `activity-report-${dateFrom}-to-${dateTo}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Reset all drill selections ──────────────────────────────
  function clearDrill() {
    setSelectedStaff(null);
    setSelectedTier(null);
    setSelectedStatus(null);
  }

  // ── Render guards ───────────────────────────────────────────
  if (loading) return <div className="loading-center">Loading activity report...</div>;
  if (error) return (
    <div className="page-body">
      <div className="alert alert--error">{error}</div>
      <button className="btn btn--secondary btn--sm" onClick={loadReport}>
        <FiRefreshCw size={12}/> Retry
      </button>
    </div>
  );
  if (!report) return <div className="page-body">No data.</div>;

  const { kpi } = report;
  // Use the cross-filtered datasets (computed from byLead + allLeads with
  // the OTHER active selections applied) rather than the server's raw
  // top-level rollups. This is what makes the three charts behave as
  // peers — picking any one filters the other two.
  const { byStaff, byTier, byStatus } = crossFilteredCharts;
  const activeFilters = [selectedStaff, selectedTier, selectedStatus].filter(Boolean).length;

  return (
    <div>
      <Watermark />

      {/* ── Header ────────────────────────────────────────── */}
      <div className="page-header">
        <span className="page-title">Activity Report</span>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {activeFilters > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={clearDrill}>
              <FiX size={12}/> Clear drill ({activeFilters})
            </button>
          )}
          {canExportExcel && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={exportToCsv}
              title="Export the current lead-level breakdown to CSV (opens in Excel)"
              style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <FiDownload size={13}/> Export
            </button>
          )}
        </div>
      </div>

      <div className="page-body" style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

        {/* ── Date range strip ───────────────────────────── */}
        <div style={{
          display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap',
          padding:'8px 0', borderBottom:'1px solid var(--border)',
        }}>
          <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>Date range:</span>
          <input type="date" className="form-input" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{ padding:'4px 8px', fontSize:'0.8rem' }}/>
          <span style={{ color:'var(--text-secondary)' }}>→</span>
          <input type="date" className="form-input" value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{ padding:'4px 8px', fontSize:'0.8rem' }}/>
          <span style={{ marginLeft:'auto', fontSize:'0.75rem', color:'var(--text-secondary)' }}>
            {kpi.uniqueLeads} leads · {kpi.totalNotes} notes · {kpi.phoneNotes} phone
          </span>
        </div>

        {/* ── KPI strip ──────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'1rem' }}>
          <StatCard
            label="Leads with Notes"
            value={kpi.uniqueLeads}
            sub={`in selected window`}
            color={COLORS.primary}
          />
          <StatCard
            label="Leads with Phone Activity"
            value={kpi.leadsWithPhone}
            sub={kpi.uniqueLeads > 0
              ? `${Math.round((kpi.leadsWithPhone / kpi.uniqueLeads) * 100)}% of leads with notes`
              : ''}
            color={COLORS.phone}
          />
          <StatCard
            label="Total Notes"
            value={kpi.totalNotes}
            sub="all note types"
            color={COLORS.other}
          />
          <StatCard
            label="Phone Notes"
            value={kpi.phoneNotes}
            sub={kpi.totalNotes > 0
              ? `${Math.round((kpi.phoneNotes / kpi.totalNotes) * 100)}% of all notes`
              : ''}
            color={COLORS.phone}
          />
        </div>

        {/* ── Charts: Staff on the left (tall); Tier + Status stacked on the right ──
            All three charts filter the lead-level table independently. Any
            combination of bars across all three may be active at once. */}
        <div style={{
          display:'grid',
          gridTemplateColumns: hasAllScope ? '1fr 1fr' : '1fr',
          gap:'1rem',
          alignItems:'start',
        }}>
          {hasAllScope && (
            <div className="section-card">
              <div className="section-header" style={{ justifyContent:'space-between' }}>
                <span className="section-title">Notes by Staff</span>
                <Legend/>
              </div>
              <StackedBarChart
                data={byStaff}
                onBarClick={key => setSelectedStaff(key)}
                selectedKey={selectedStaff}
              />
            </div>
          )}

          {/* Right column: Tier above, Status below — stacked */}
          <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
            <div className="section-card">
              <div className="section-header" style={{ justifyContent:'space-between' }}>
                <span className="section-title">Notes by Tier</span>
                <Legend/>
              </div>
              <StackedBarChart
                data={byTier}
                displayFor={k => stoneLabel ? stoneLabel(k, language) : k}
                colorMap={STONE_COLORS}
                onBarClick={key => setSelectedTier(key)}
                selectedKey={selectedTier}
              />
            </div>

            <div className="section-card">
              <div className="section-header" style={{ justifyContent:'space-between' }}>
                <span className="section-title">Notes by Status</span>
                <Legend/>
              </div>
              <StackedBarChart
                data={byStatus}
                onBarClick={key => setSelectedStatus(key)}
                selectedKey={selectedStatus}
              />
            </div>
          </div>
        </div>

        {/* ── Active filter chips (visible only when any filter is active) ──
            Each chip shows the category + value and can be dismissed with ×.
            This makes the "all 3 are independent filters that AND together"
            model self-evident — users see exactly what's narrowing the list. */}
        {activeFilters > 0 && (
          <div style={{
            display:'flex', flexWrap:'wrap', gap:'6px', alignItems:'center',
            padding:'8px 10px', background:'var(--bg-secondary)',
            borderRadius:'8px', border:'1px solid var(--border)',
          }}>
            <span style={{
              fontSize:'0.7rem', fontWeight:600, textTransform:'uppercase',
              color:'var(--text-secondary)', marginRight:'4px',
            }}>
              Filtered by:
            </span>
            {selectedStaff && (
              <FilterChip
                label="Staff"
                value={selectedStaff}
                onRemove={() => setSelectedStaff(null)}
              />
            )}
            {selectedTier && (
              <FilterChip
                label="Tier"
                value={stoneLabel ? stoneLabel(selectedTier, language) : selectedTier}
                onRemove={() => setSelectedTier(null)}
              />
            )}
            {selectedStatus && (
              <FilterChip
                label="Status"
                value={selectedStatus}
                onRemove={() => setSelectedStatus(null)}
              />
            )}
          </div>
        )}

        {/* ── Lead-level table (always visible — narrows with drill) ── */}
        <div className="section-card">
          <div className="section-header" style={{ justifyContent:'space-between' }}>
            <span className="section-title">
              Leads ({filteredLeads.length} with notes
              {totalLeadsInDrill != null && totalLeadsInDrill !== filteredLeads.length
                ? `, ${totalLeadsInDrill} total` : ''})
            </span>
            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)' }}>
              Click → to open lead detail
            </span>
          </div>
          <div style={{ overflowX:'auto', maxHeight:'500px', overflowY:'auto' }}>
            <table className="leads-data-table" style={{ width:'100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left' }}>Lead</th>
                  <th style={{ textAlign:'left' }}>Tier</th>
                  <th style={{ textAlign:'left' }}>Status</th>
                  <th style={{ textAlign:'left' }}>Staff</th>
                  <th style={{ textAlign:'right' }}>Phone</th>
                  <th style={{ textAlign:'right' }}>Other</th>
                  <th style={{ textAlign:'right' }}>Last Phone</th>
                  <th style={{ textAlign:'right' }}>Days Since</th>
                  <th style={{ width:'40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map(l => {
                  const days = l.daysSincePhone;
                  const daysColor =
                    days == null    ? 'var(--text-secondary)' :
                    days >= 14      ? COLORS.danger :
                    days >= 7       ? COLORS.warn   :
                                      'var(--text-primary)';
                  return (
                    <tr key={l.studentId}
                        style={{ cursor:'pointer' }}
                        onClick={() => navigate(`/leads/${l.studentId}`)}>
                      <td style={{ fontWeight:500 }}>{l.leadName || '—'}</td>
                      <td>
                        {l.stoneTier && (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                            <span style={{
                              display:'inline-block', width:'8px', height:'8px',
                              borderRadius:'50%',
                              background: STONE_COLORS[l.stoneTier] || COLORS.other,
                            }}/>
                            {stoneLabel ? stoneLabel(l.stoneTier, language) : l.stoneTier}
                          </span>
                        )}
                      </td>
                      <td>{l.leadStatus || '—'}</td>
                      <td>{l.primaryStaff || '—'}</td>
                      <td style={{ textAlign:'right', color: l.phoneNotes > 0 ? COLORS.phone : 'var(--text-secondary)', fontWeight: l.phoneNotes > 0 ? 600 : 400 }}>
                        {l.phoneNotes}
                      </td>
                      <td style={{ textAlign:'right' }}>{l.otherNotes}</td>
                      <td style={{ textAlign:'right', fontSize:'0.8rem', color:'var(--text-secondary)' }}>
                        {l.lastPhoneAt ? new Date(l.lastPhoneAt).toLocaleDateString('en-GB') : '—'}
                      </td>
                      <td style={{ textAlign:'right', color: daysColor, fontWeight: days >= 7 ? 600 : 400 }}>
                        {days == null ? '—' : `${days}d`}
                      </td>
                      <td style={{ textAlign:'center' }}>
                        <FiArrowRight size={14} style={{ color:'var(--text-secondary)' }}/>
                      </td>
                    </tr>
                  );
                })}
                {filteredLeads.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign:'center', color:'var(--text-secondary)', padding:'2rem' }}>
                      No leads match the current selection
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
