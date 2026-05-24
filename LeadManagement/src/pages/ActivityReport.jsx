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
        return (
          <div
            key={entry.key}
            onClick={() => onBarClick && onBarClick(entry.key)}
            style={{
              display:'flex', alignItems:'center', gap:'0.5rem',
              cursor: onBarClick ? 'pointer' : 'default',
              padding:'2px 4px', borderRadius:'4px',
              background: isSelected ? 'var(--primary-light)' : 'transparent',
              transition:'background 0.15s',
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

// ── Main component ───────────────────────────────────────────
export default function ActivityReport() {
  const navigate = useNavigate();
  const { staff }    = useAuth();
  const { scope }    = usePermissions();
  const { language } = useLanguage();

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

  // Temporary debug logging — remove once filter consistency is confirmed.
  useEffect(() => {
    if (!report) return;
    console.log('[ActivityReport drill state]', {
      selectedStaff, selectedTier, selectedStatus,
      filteredLeadsCount:  filteredLeads.length,
      totalLeadsInDrill,
      firstFewLeads: filteredLeads.slice(0, 3).map(l => ({
        leadName: l.leadName, stoneTier: l.stoneTier, leadStatus: l.leadStatus, primaryStaff: l.primaryStaff,
      })),
    });
  }, [report, selectedStaff, selectedTier, selectedStatus, filteredLeads, totalLeadsInDrill]);

  // Roll-ups limited to the current drill — for the side panel when a
  // staff member is selected. Recomputed only on selection change.
  // Uses report.byLead for note-related counts, and report.allLeads for
  // total-leads-in-context counts (independent of whether they have notes).
  const drillRollups = useMemo(() => {
    if (!report || !selectedStaff) return null;
    const filtered   = report.byLead.filter(l => matchesCategory(l.primaryStaff, selectedStaff));
    const allInScope = (report.allLeads || []).filter(l => matchesCategory(l.primaryStaff, selectedStaff));

    const tierMap = new Map();
    const statusMap = new Map();
    for (const l of filtered) {
      const t = l.stoneTier || '(none)';
      if (!tierMap.has(t)) tierMap.set(t, { key: t, totalNotes: 0, phoneNotes: 0, uniqueLeads: 0 });
      const te = tierMap.get(t);
      te.totalNotes += l.totalNotes; te.phoneNotes += l.phoneNotes; te.uniqueLeads += 1;

      const s = l.leadStatus || '(none)';
      if (!statusMap.has(s)) statusMap.set(s, { key: s, totalNotes: 0, phoneNotes: 0, uniqueLeads: 0 });
      const se = statusMap.get(s);
      se.totalNotes += l.totalNotes; se.phoneNotes += l.phoneNotes; se.uniqueLeads += 1;
    }

    // Total leads per category WITHIN this drill context — i.e. all of
    // this staff's leads, grouped by tier / status, regardless of whether
    // they have notes in the date window.
    const tierTotals   = new Map();
    const statusTotals = new Map();
    for (const l of allInScope) {
      const t = l.stoneTier  || '(none)';
      const s = l.leadStatus || '(none)';
      tierTotals.set(t,   (tierTotals.get(t)   || 0) + 1);
      statusTotals.set(s, (statusTotals.get(s) || 0) + 1);
      // Ensure categories with leads but no notes still appear
      if (!tierMap.has(t))   tierMap.set(t,   { key: t, totalNotes: 0, phoneNotes: 0, uniqueLeads: 0 });
      if (!statusMap.has(s)) statusMap.set(s, { key: s, totalNotes: 0, phoneNotes: 0, uniqueLeads: 0 });
    }

    const finalize = (m, totalsMap) => [...m.values()]
      .map(e => ({
        ...e,
        otherNotes: e.totalNotes - e.phoneNotes,
        totalLeads: totalsMap.get(e.key) ?? e.uniqueLeads,
      }))
      .sort((a,b) => b.totalNotes - a.totalNotes);

    return {
      byTier:   finalize(tierMap,   tierTotals),
      byStatus: finalize(statusMap, statusTotals),
    };
  }, [report, selectedStaff]);

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

  const { kpi, byStaff, byTier, byStatus } = report;
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

        {/* ── Level 1 charts: Staff + Tier side by side ───── */}
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
        </div>

        {/* ── Drill panel: shows when a staff is selected ──── */}
        {selectedStaff && drillRollups && (
          <div className="section-card" style={{
            borderLeft:`4px solid ${COLORS.primary}`,
            background:'var(--bg-secondary)',
          }}>
            <div className="section-header" style={{ justifyContent:'space-between' }}>
              <span className="section-title">Drill: {selectedStaff}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedStaff(null)}>
                <FiX size={12}/>
              </button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem' }}>
              <div>
                <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:600, marginBottom:'0.5rem', textTransform:'uppercase' }}>
                  Their leads by Tier
                </div>
                <StackedBarChart
                  data={drillRollups.byTier}
                  displayFor={k => stoneLabel ? stoneLabel(k, language) : k}
                  colorMap={STONE_COLORS}
                  onBarClick={key => setSelectedTier(key)}
                  selectedKey={selectedTier}
                />
              </div>
              <div>
                <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:600, marginBottom:'0.5rem', textTransform:'uppercase' }}>
                  Their leads by Status
                </div>
                <StackedBarChart
                  data={drillRollups.byStatus}
                  onBarClick={key => setSelectedStatus(key)}
                  selectedKey={selectedStatus}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Status chart (Level 1 alt — shown only when NO staff selected) ── */}
        {!selectedStaff && (
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
