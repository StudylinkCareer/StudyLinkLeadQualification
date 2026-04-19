// src/pages/Dashboard.jsx
// CHANGES (Apr 18, 2026):
//   - STATUS_COLORS updated for new lead statuses
//   - stats.won now checks for 'Contracted'
//   - stats.active excludes ['Contracted','Lost','Archived']
//   - pipeline 'active' filter updated to match
//
// CHANGES (Counselor drill-down):
//   - Click any counselor row in "Leads by Counselor" to open a drill-down
//     panel on the right showing that counselor's Leads by Stone +
//     Leads by Status as mini bar charts. Chart resizes to ~50% width.
//   - Click the same row again, a different row, or the (×) button to
//     switch counselors or close the drill-down.
//   - Mini-chart bars navigate to /leads filtered by counselor +
//     stone/status (pre-filtered by uniqueId).
//
// CHANGES (Manager/Admin KPI layout):
//   - Manager/Admin dashboard uses a two-level layout:
//       Level 1: Leads by Stone + Leads by Status side-by-side (full width)
//       Level 2:
//         No counselor selected → 2 frames:
//           Frame 1: Leads by Counselor
//           Frame 2: Pipeline Statistics (Manager-only column)
//         Counselor selected → 3 frames:
//           Frame 1: Leads by Counselor (compressed)
//           Frame 2: upper = Stone for counselor,
//                    lower = Status for counselor (stacked)
//           Frame 3: Pipeline Statistics (2 numeric columns —
//                    Manager aggregate + selected counselor)
//   - 'Leads by Source' removed from Manager/Admin view entirely.
//   - Pipeline Statistics is now a table with common header and row names;
//     the "counselor" column appears only when a counselor is selected.
//   - Target row logic is role-dependent:
//       * Counselor → own target (from /api/staff/me)
//       * Manager   → aggregate of all active Counselors' targets
//                     (from /api/staff/active). Sub-text reads
//                     "Aggregated from N counselors".
//       * Admin     → Target row is hidden (Admins have no target).
//   - /api/staff/me is the new secure endpoint so Counselors can fetch
//     their own target (previously they saw '—' / 'Not set' because
//     list() is Admin-only).

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import { studentAPI, staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Watermark from '../components/Watermark';

// ── Date helpers ──────────────────────────────────────────────
function getWeekEnd() {
  const d = new Date();
  d.setDate(d.getDate() + (7 - d.getDay()));
  d.setHours(23, 59, 59, 999);
  return d;
}
function getMonthEnd() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function getQuarterEnd() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), (q + 1) * 3, 0, 23, 59, 59, 999);
}
function getRolling3m() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d;
}

// ── Colors ────────────────────────────────────────────────────
const STONE_COLORS  = { Quartz:'#9CA3AF', Agate:'#78716C', Sapphire:'#2563EB', Ruby:'#DC2626', Diamond:'#8B5CF6' };
const STATUS_COLORS = {
  'New':                          '#6B7280',
  'Not contactable':              '#94A3B8',
  'Engaged':                      '#3B82F6',
  'Vetted':                       '#8B5CF6',
  'Met with customer and family': '#06B6D4',
  'Proposal':                     '#F59E0B',
  'Family negotiation/review':    '#F97316',
  'Contracted':                   '#10B981',
  'Lost':                         '#EF4444',
  'Nurturing':                    '#14B8A6',
  'Archived':                     '#64748B',
};
const SOURCE_COLORS = ['#2563EB','#0891B2','#059669','#D97706','#7C3AED','#DB2777'];

const TERMINAL_STATUSES = ['Contracted', 'Lost', 'Archived'];

const COUNSELOR_STONES        = ['Diamond', 'Ruby', 'Sapphire', 'Agate', 'Quartz', 'Unscored'];
const COUNSELOR_STONE_COLORS  = {
  Diamond:  '#8B5CF6',
  Ruby:     '#DC2626',
  Sapphire: '#2563EB',
  Agate:    '#78716C',
  Quartz:   '#9CA3AF',
  Unscored: '#E5E7EB',
};
const COUNSELOR_STONE_TEXT = {
  Diamond:  '#FFFFFF',
  Ruby:     '#FFFFFF',
  Sapphire: '#FFFFFF',
  Agate:    '#FFFFFF',
  Quartz:   '#FFFFFF',
  Unscored: '#6B7280',
};

// ── Stat card ─────────────────────────────────────────────────
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

// ── Pipeline row ──────────────────────────────────────────────
function PipelineRow({ label, count, sub, color, onClick, isTarget }) {
  return (
    <div onClick={onClick} style={{
      display:'flex', justifyContent:'space-between', alignItems:'center',
      padding:'0.625rem 0', borderBottom:'1px solid var(--border)',
      cursor: onClick ? 'pointer' : 'default',
    }}
    onMouseEnter={e=>{ if(onClick) e.currentTarget.style.background='var(--bg-secondary)'; }}
    onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; }}>
      <div>
        <div style={{ fontSize:'0.875rem', fontWeight: isTarget ? 600 : 400 }}>{label}</div>
        {sub && <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{sub}</div>}
      </div>
      <div style={{
        fontSize: isTarget ? '1.25rem' : '1rem',
        fontWeight:600, color: color || 'var(--text-primary)',
        minWidth:'2rem', textAlign:'right',
      }}>
        {count}
      </div>
    </div>
  );
}

// ── Horizontal bar chart ──────────────────────────────────────
function HBarChart({ data, colorMap, defaultColor, onBarClick }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
      {data.map((entry, i) => {
        const color = colorMap?.[entry.name] || (Array.isArray(defaultColor) ? defaultColor[i % defaultColor.length] : defaultColor) || '#2563EB';
        const pct = (entry.count / max) * 100;
        return (
          <div key={entry.name} onClick={() => onBarClick && onBarClick(entry.name)}
            style={{ display:'flex', alignItems:'center', gap:'0.5rem', cursor: onBarClick ? 'pointer' : 'default' }}>
            <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', width:'110px', flexShrink:0, textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {entry.name}
            </div>
            <div style={{ flex:1, height:'22px', background:'var(--bg-secondary)', borderRadius:'4px', overflow:'hidden' }}>
              <div style={{
                height:'100%', width:`${pct}%`, background: color,
                borderRadius:'4px', transition:'width 0.4s ease',
                minWidth: entry.count > 0 ? '4px' : '0',
              }}/>
            </div>
            <div style={{ fontSize:'0.8125rem', fontWeight:600, minWidth:'24px', textAlign:'right' }}>
              {entry.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const [leads, setLeads]       = useState([]);
  const [myStaff, setMyStaff]   = useState(null);
  // Full active-staff list — used by Managers to aggregate counselor targets.
  const [activeStaff, setActiveStaff] = useState([]);
  const [loading, setLoading]   = useState(true);
  // Currently selected counselor for drill-down; null = chart full-width.
  const [selectedCounselor, setSelectedCounselor] = useState(null);
  const { staff, isManager, isAdmin } = useAuth();
  const navigate                = useNavigate();

  useEffect(() => {
    const promises = [studentAPI.search('').then(d => setLeads(d.data || []))];
    if (staff?.id) {
      promises.push(
        // Fetch the logged-in user's OWN record via the secure /me endpoint.
        // Any role can call this; returns target, targetSetBy, targetSetAt.
        staffAPI.me()
          .then(d => { if (d.data) setMyStaff(d.data); })
          .catch(() => {})
      );
    }
    // Managers aggregate targets across all active counselors.
    // Admins don't need this — they won't see a target row at all.
    if (isManager) {
      promises.push(
        staffAPI.listActive()
          .then(d => { if (d.data) setActiveStaff(d.data); })
          .catch(() => {})
      );
    }
    Promise.all(promises).catch(console.error).finally(() => setLoading(false));
  }, [staff?.id, isManager]);

  const scopedLeads = useMemo(() => {
    if (isManager || isAdmin) return leads;
    return leads.filter(l =>
      l.counselor       === staff?.fullName ||
      l.seniorCounselor === staff?.fullName ||
      l.presales        === staff?.fullName ||
      l.marketingStaff  === staff?.fullName
    );
  }, [leads, isManager, isAdmin, staff]);

  const stats = useMemo(() => {
    const total     = scopedLeads.length;
    const won       = scopedLeads.filter(l => l.leadStatus === 'Contracted').length;
    const active    = scopedLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus)).length;
    const thisMonth = scopedLeads.filter(l => {
      if (!l.createdAt) return false;
      const d = new Date(l.createdAt), now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { total, won, active, thisMonth };
  }, [scopedLeads]);

  const pipeline = useMemo(() => {
    const weekEnd    = getWeekEnd();
    const monthEnd   = getMonthEnd();
    const quarterEnd = getQuarterEnd();
    const rolling3m  = getRolling3m();

    const active = scopedLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus));
    const thisWeek    = active.filter(l => l.closeDate && new Date(l.closeDate) <= weekEnd);
    const thisMonth   = active.filter(l => l.closeDate && new Date(l.closeDate) > weekEnd && new Date(l.closeDate) <= monthEnd);
    const thisQuarter = active.filter(l => l.closeDate && new Date(l.closeDate) > monthEnd && new Date(l.closeDate) <= quarterEnd);
    const rolling     = active.filter(l => l.closeDate && new Date(l.closeDate) > quarterEnd && new Date(l.closeDate) <= rolling3m);
    const notProjected = active.filter(l => l.closeDate && new Date(l.closeDate) > rolling3m);
    const noCloseDate = active.filter(l => !l.closeDate);
    return { thisWeek, thisMonth, thisQuarter, rolling, notProjected, noCloseDate };
  }, [scopedLeads]);

  const stoneData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => { const s = l.stoneTier || 'Unscored'; counts[s] = (counts[s]||0)+1; });
    return ['Diamond','Ruby','Sapphire','Agate','Quartz','Unscored'].filter(k => counts[k]).map(k => ({ name: k, count: counts[k] }));
  }, [scopedLeads]);

  const statusData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => { const s = l.leadStatus||'New'; counts[s]=(counts[s]||0)+1; });
    return Object.entries(counts).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  }, [scopedLeads]);

  const sourceData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => { if(l.leadSource) counts[l.leadSource]=(counts[l.leadSource]||0)+1; });
    return Object.entries(counts).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  }, [scopedLeads]);

  const counselorData = useMemo(() => {
    if (!isManager && !isAdmin) return [];
    const map = {};
    leads.forEach(l => {
      const counselor = l.counselor || 'Unassigned';
      const stone     = COUNSELOR_STONES.includes(l.stoneTier) ? l.stoneTier : 'Unscored';
      if (!map[counselor]) map[counselor] = {};
      if (!map[counselor][stone]) map[counselor][stone] = [];
      map[counselor][stone].push(l);
    });
    return Object.entries(map)
      .map(([counselor, stoneMap]) => ({
        counselor,
        stoneMap,
        total: Object.values(stoneMap).reduce((s, arr) => s + arr.length, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [leads, isManager, isAdmin]);

  // ── Drill-down data for the selected counselor ────────────────
  const selectedCounselorLeads = useMemo(() => {
    if (!selectedCounselor) return [];
    return leads.filter(l => (l.counselor || 'Unassigned') === selectedCounselor);
  }, [leads, selectedCounselor]);

  const selectedStoneData = useMemo(() => {
    const counts = {};
    selectedCounselorLeads.forEach(l => { const s = l.stoneTier || 'Unscored'; counts[s] = (counts[s]||0)+1; });
    return ['Diamond','Ruby','Sapphire','Agate','Quartz','Unscored']
      .filter(k => counts[k]).map(k => ({ name: k, count: counts[k] }));
  }, [selectedCounselorLeads]);

  const selectedStatusData = useMemo(() => {
    const counts = {};
    selectedCounselorLeads.forEach(l => { const s = l.leadStatus || 'New'; counts[s] = (counts[s]||0)+1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [selectedCounselorLeads]);

  // Pipeline buckets scoped to the selected counselor's leads.
  // Mirrors the top-level `pipeline` computation but filtered.
  const selectedPipeline = useMemo(() => {
    if (!selectedCounselor) return null;
    const weekEnd    = getWeekEnd();
    const monthEnd   = getMonthEnd();
    const quarterEnd = getQuarterEnd();
    const rolling3m  = getRolling3m();
    const active = selectedCounselorLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus));
    const thisWeek    = active.filter(l => l.closeDate && new Date(l.closeDate) <= weekEnd);
    const thisMonth   = active.filter(l => l.closeDate && new Date(l.closeDate) > weekEnd && new Date(l.closeDate) <= monthEnd);
    const thisQuarter = active.filter(l => l.closeDate && new Date(l.closeDate) > monthEnd && new Date(l.closeDate) <= quarterEnd);
    const rolling     = active.filter(l => l.closeDate && new Date(l.closeDate) > quarterEnd && new Date(l.closeDate) <= rolling3m);
    const notProjected = active.filter(l => l.closeDate && new Date(l.closeDate) > rolling3m);
    const noCloseDate = active.filter(l => !l.closeDate);
    return { thisWeek, thisMonth, thisQuarter, rolling, notProjected, noCloseDate };
  }, [selectedCounselor, selectedCounselorLeads]);

  // The selected counselor's own target + targetSetBy, if we have their
  // staff record available (Manager pulled it via listActive).
  const selectedCounselorStaff = useMemo(() => {
    if (!selectedCounselor) return null;
    return activeStaff.find(s => s.fullName === selectedCounselor) || null;
  }, [activeStaff, selectedCounselor]);

  // If the selected counselor disappears (e.g. data refresh), drop the selection.
  useEffect(() => {
    if (selectedCounselor && !counselorData.some(c => c.counselor === selectedCounselor)) {
      setSelectedCounselor(null);
    }
  }, [counselorData, selectedCounselor]);

  function drillDown(filterKey, filterValue) {
    navigate('/leads', { state: { drillFilter: { key: filterKey, value: filterValue } } });
  }
  function drillPipeline(leads) {
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: leads.map(l => l.uniqueId) } } });
  }
  // Toggle the drill-down panel for a counselor.
  // Same name → close; different name → switch.
  function toggleCounselor(name) {
    setSelectedCounselor(prev => prev === name ? null : name);
  }
  // Drill into /leads filtered by both the selected counselor AND a stone/status.
  function drillCounselorStone(counselor, stone) {
    const ids = leads
      .filter(l => (l.counselor || 'Unassigned') === counselor
                && (l.stoneTier || 'Unscored')   === stone)
      .map(l => l.uniqueId);
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  }
  function drillCounselorStatus(counselor, status) {
    const ids = leads
      .filter(l => (l.counselor || 'Unassigned') === counselor
                && (l.leadStatus || 'New')       === status)
      .map(l => l.uniqueId);
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  }

  if (loading) return <div className="loading-center">Loading dashboard...</div>;

  const isManagerOrAdmin = isManager || isAdmin;
  const maxCounselorTotal = Math.max(...counselorData.map(d => d.total), 1);

  // ── Shared: Pipeline Statistics card ─────────────────────────
  // Rendered as a table with one or two numeric columns:
  //   - Counselor view: 1 column (their own numbers)
  //   - Manager view, no selection: 1 column (Manager aggregate)
  //   - Manager view, counselor selected: 2 columns (Manager + that counselor)
  const showCounselorCol = isManagerOrAdmin && !!selectedCounselor;

  // Rows are declared once; each row pulls both manager and counselor counts.
  const pipelineRows = [
    { key:'thisWeek',     label:'Close this week',    sub:`by Sunday ${getWeekEnd().toLocaleDateString()}`, color:'#10B981' },
    { key:'thisMonth',    label:'Close this month',   sub:`by ${getMonthEnd().toLocaleDateString()}`,        color:'#2563EB' },
    { key:'thisQuarter',  label:'Close this quarter', sub:`by ${getQuarterEnd().toLocaleDateString()}`,      color:'#8B5CF6' },
    { key:'rolling',      label:'Rolling 3 months',   sub:'beyond quarter end',                               color:'#F59E0B' },
    { key:'notProjected', label:'Beyond 3 months',    sub:null,                                               color:'#EF4444' },
    { key:'noCloseDate',  label:'No close date',      sub:null,                                               color:'#9CA3AF' },
  ];

  // Resolve the target values displayed in the table header row.
  const managerTargetCount = (() => {
    if (isManager) {
      const cw = activeStaff.filter(s => s.role === 'Counselor' && s.target != null);
      return cw.length > 0 ? cw.reduce((sum, s) => sum + Number(s.target || 0), 0) : '—';
    }
    if (!isAdmin) return myStaff?.target ?? '—';
    return null; // Admin: no target row
  })();
  const managerTargetSub = (() => {
    if (isManager) {
      const n = activeStaff.filter(s => s.role === 'Counselor' && s.target != null).length;
      return n > 0 ? `Aggregated from ${n} counselor${n === 1 ? '' : 's'}` : 'No counselor targets set';
    }
    if (!isAdmin) return myStaff?.targetSetBy ? `Set by ${myStaff.targetSetBy}` : 'Not set';
    return '';
  })();
  const counselorTargetCount = selectedCounselorStaff?.target ?? '—';
  const showTargetRow = !isAdmin; // Admins get no target row at all.

  const pipelineCard = (
    <div className="section-card" style={{ height:'100%', overflowY:'auto', alignSelf:'stretch' }}>
      <div className="section-header"><span className="section-title">Pipeline Statistics</span></div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign:'left', padding:'0.4rem 0.25rem', fontSize:'0.6875rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)' }}></th>
            <th style={{ textAlign:'right', padding:'0.4rem 0.25rem', fontSize:'0.6875rem', fontWeight:600, color:'var(--primary)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', width:'72px' }}>
              {isManager ? 'Manager' : 'You'}
            </th>
            {showCounselorCol && (
              <th style={{ textAlign:'right', padding:'0.4rem 0.25rem', fontSize:'0.6875rem', fontWeight:600, color:'#10B981', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', width:'72px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                  title={selectedCounselor}>
                {selectedCounselor}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {showTargetRow && (
            <tr>
              <td style={{ padding:'0.625rem 0.25rem', fontWeight:600, borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:'0.875rem' }}>Target (Contracted this month)</div>
                {managerTargetSub && <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:400 }}>{managerTargetSub}</div>}
              </td>
              <td style={{ padding:'0.625rem 0.25rem', textAlign:'right', fontSize:'1.25rem', fontWeight:600, color:'var(--primary)', borderBottom:'1px solid var(--border)' }}>
                {managerTargetCount}
              </td>
              {showCounselorCol && (
                <td style={{ padding:'0.625rem 0.25rem', textAlign:'right', fontSize:'1.25rem', fontWeight:600, color:'#10B981', borderBottom:'1px solid var(--border)' }}>
                  {counselorTargetCount}
                </td>
              )}
            </tr>
          )}
          {pipelineRows.map(row => {
            const mgrLeads = pipeline[row.key] || [];
            const cslLeads = selectedPipeline ? (selectedPipeline[row.key] || []) : [];
            return (
              <tr key={row.key}>
                <td style={{ padding:'0.5rem 0.25rem', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ fontSize:'0.875rem' }}>{row.label}</div>
                  {row.sub && <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{row.sub}</div>}
                </td>
                <td
                  onClick={() => drillPipeline(mgrLeads)}
                  style={{
                    padding:'0.5rem 0.25rem', textAlign:'right',
                    fontSize:'1rem', fontWeight:600, color: row.color,
                    borderBottom:'1px solid var(--border)',
                    cursor:'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background='var(--bg-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}
                >
                  {mgrLeads.length}
                </td>
                {showCounselorCol && (
                  <td
                    onClick={() => drillPipeline(cslLeads)}
                    style={{
                      padding:'0.5rem 0.25rem', textAlign:'right',
                      fontSize:'1rem', fontWeight:600, color: row.color,
                      borderBottom:'1px solid var(--border)',
                      cursor:'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background='var(--bg-secondary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}
                  >
                    {cslLeads.length}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
          {isManagerOrAdmin ? 'All leads' : `${staff?.fullName} — your assigned leads`}
        </span>
      </div>

      <div className="page-body">

        {/* ── Top stat cards row ───────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
          <StatCard label="Total Leads"     value={stats.total}     color="#6B7280" onClick={()=>navigate('/leads')}/>
          <StatCard label="Active"          value={stats.active}    color="#2563EB" onClick={()=>drillDown('leadStatus','active')}/>
          <StatCard label="Contracted"      value={stats.won}       color="#10B981" onClick={()=>drillDown('leadStatus','Contracted')}/>
          <StatCard label="New This Month"  value={stats.thisMonth} color="#F59E0B" sub="created this month"/>
        </div>

        {/* ── KPI charts + Pipeline row ────────────────────────── */}
        {isManagerOrAdmin ? (
          // Manager/Admin — Level 1: Stone + Status side-by-side (full width).
          // Pipeline moves down to Level 2 (Frame 3).
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1.5rem' }}>
            <div className="section-card">
              <div className="section-header"><span className="section-title">Leads by Stone</span></div>
              <HBarChart data={stoneData} colorMap={STONE_COLORS} onBarClick={name => drillDown('stoneTier', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
            </div>

            <div className="section-card">
              <div className="section-header"><span className="section-title">Leads by Status</span></div>
              <HBarChart data={statusData} colorMap={STATUS_COLORS} onBarClick={name => drillDown('leadStatus', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
            </div>
          </div>
        ) : (
          // Counselor view (unchanged): Stone / Status / Source / Pipeline
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 300px', gap:'1rem', marginBottom:'1.5rem' }}>

            <div className="section-card">
              <div className="section-header"><span className="section-title">Leads by Stone</span></div>
              <HBarChart data={stoneData} colorMap={STONE_COLORS} onBarClick={name => drillDown('stoneTier', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
            </div>

            <div className="section-card">
              <div className="section-header"><span className="section-title">Leads by Status</span></div>
              <HBarChart data={statusData} colorMap={STATUS_COLORS} onBarClick={name => drillDown('leadStatus', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
            </div>

            <div className="section-card">
              <div className="section-header"><span className="section-title">Leads by Source</span></div>
              <HBarChart data={sourceData} defaultColor={SOURCE_COLORS} onBarClick={name => drillDown('leadSource', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
            </div>

            {pipelineCard}
          </div>
        )}

        {/* ── Leads by Counselor + drill-down + pipeline (Manager/Admin only) ── */}
        {isManagerOrAdmin && (
          <div style={{
            display:'grid',
            // Pipeline table is always visible in Level 2.
            // No selection: 2 columns (Counselor chart + Pipeline-Manager only).
            // With selection: 3 columns (chart + drill-down + Pipeline with 2 numeric cols).
            gridTemplateColumns: selectedCounselor ? '1.3fr 1fr 1fr' : '2fr 1fr',
            gap:'1rem',
            transition:'grid-template-columns 0.3s ease',
          }}>

            {/* ── Frame 1: Leads by Counselor chart ── */}
            <div className="section-card">
              <div className="section-header">
                <span className="section-title">Leads by Counselor</span>
                <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                  Click a counselor to drill down
                </span>
              </div>

              <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap', marginBottom:'1.25rem' }}>
                {COUNSELOR_STONES.map(stone => (
                  <div key={stone} style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                    <div style={{
                      width:'12px', height:'12px', borderRadius:'3px', flexShrink:0,
                      background: COUNSELOR_STONE_COLORS[stone],
                      border: stone === 'Unscored' ? '1px solid #D1D5DB' : 'none',
                    }}/>
                    <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{stone}</span>
                  </div>
                ))}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {counselorData.map(({ counselor, stoneMap, total }) => {
                  const barWidthPct = (total / maxCounselorTotal) * 100;
                  const isSelected  = selectedCounselor === counselor;
                  return (
                    <div
                      key={counselor}
                      onClick={() => toggleCounselor(counselor)}
                      style={{
                        display:'flex', alignItems:'center', gap:'0.75rem',
                        padding:'0.3rem 0.4rem', borderRadius:'6px',
                        cursor:'pointer',
                        background: isSelected ? 'var(--bg-secondary)' : 'transparent',
                        outline: isSelected ? '1px solid var(--primary)' : 'none',
                        transition:'background 0.15s, outline 0.15s',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='var(--bg-secondary)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='transparent'; }}
                    >

                      <div style={{
                        width:'160px', flexShrink:0, textAlign:'right',
                        fontSize:'0.8125rem', fontWeight: isSelected ? 600 : 500,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                        color: isSelected ? 'var(--primary)' : 'inherit',
                      }}>
                        {counselor}
                      </div>

                      <div style={{
                        flex:1, height:'30px', display:'flex',
                        borderRadius:'4px', overflow:'hidden',
                        background:'var(--bg-secondary)',
                      }}>
                        <div style={{ width:`${barWidthPct}%`, display:'flex', height:'100%' }}>
                          {COUNSELOR_STONES.map(stone => {
                            const arr = stoneMap[stone] || [];
                            if (!arr.length) return null;
                            const segPct = (arr.length / total) * 100;
                            return (
                              <div
                                key={stone}
                                title={`${counselor} — ${stone}: ${arr.length}`}
                                style={{
                                  width:`${segPct}%`,
                                  background: COUNSELOR_STONE_COLORS[stone],
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  overflow:'hidden',
                                  border: stone === 'Unscored' ? '1px solid #D1D5DB' : 'none',
                                }}
                              >
                                {segPct > 4 && (
                                  <span style={{ fontSize:'0.7rem', fontWeight:700, color: COUNSELOR_STONE_TEXT[stone], userSelect:'none' }}>
                                    {arr.length}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div
                        style={{ width:'32px', flexShrink:0, fontSize:'0.875rem', fontWeight:700 }}
                        title={`${counselor} — all ${total} leads`}
                      >
                        {total}
                      </div>

                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop:'1.25rem', paddingTop:'0.875rem', borderTop:'1px solid var(--border)', display:'flex', gap:'1.25rem', flexWrap:'wrap' }}>
                {COUNSELOR_STONES.map(stone => {
                  const count = leads.filter(l => (COUNSELOR_STONES.includes(l.stoneTier) ? l.stoneTier : 'Unscored') === stone).length;
                  if (!count) return null;
                  return (
                    <div key={stone} style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                      <div style={{ width:'9px', height:'9px', borderRadius:'2px', background: COUNSELOR_STONE_COLORS[stone], border: stone==='Unscored'?'1px solid #D1D5DB':'none' }}/>
                      <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>{stone}:</span>
                      <span style={{ fontSize:'0.8rem', fontWeight:600 }}>{count}</span>
                    </div>
                  );
                })}
                <div style={{ marginLeft:'auto', fontSize:'0.8rem', fontWeight:700 }}>Total: {leads.length}</div>
              </div>
            </div>

            {/* ── Frame 2: drill-down charts (Stone upper, Status lower), stacked ── */}
            {selectedCounselor && (
              <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

                {/* Frame 2 — upper: Leads by Stone for selected counselor */}
                <div className="section-card">
                  <div className="section-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
                    <div style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
                      <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                        Counselor
                      </span>
                      <span className="section-title" style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {selectedCounselor}
                      </span>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.125rem' }}>
                        {selectedCounselorLeads.length} lead{selectedCounselorLeads.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedCounselor(null)}
                      title="Close drill-down"
                      aria-label="Close drill-down"
                      style={{
                        display:'flex', alignItems:'center', justifyContent:'center',
                        width:'28px', height:'28px', padding:0, flexShrink:0,
                        border:'1px solid var(--border)', borderRadius:'6px',
                        background:'#fff', color:'var(--text-secondary)', cursor:'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background='var(--bg-secondary)'; e.currentTarget.style.color='var(--text-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='var(--text-secondary)'; }}
                    >
                      <FiX size={15}/>
                    </button>
                  </div>
                  <div style={{ fontSize:'0.8125rem', fontWeight:600, marginBottom:'0.625rem', marginTop:'0.5rem' }}>Leads by Stone</div>
                  {selectedStoneData.length === 0 ? (
                    <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>No leads</div>
                  ) : (
                    <HBarChart
                      data={selectedStoneData}
                      colorMap={STONE_COLORS}
                      onBarClick={name => drillCounselorStone(selectedCounselor, name)}
                    />
                  )}
                  <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.625rem' }}>
                    Click a bar to view those leads
                  </div>
                </div>

                {/* Frame 2 — lower: Leads by Status for selected counselor */}
                <div className="section-card">
                  <div className="section-header"><span className="section-title">Leads by Status</span></div>
                  {selectedStatusData.length === 0 ? (
                    <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>No leads</div>
                  ) : (
                    <HBarChart
                      data={selectedStatusData}
                      colorMap={STATUS_COLORS}
                      onBarClick={name => drillCounselorStatus(selectedCounselor, name)}
                    />
                  )}
                  <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.625rem' }}>
                    Click a bar to view those leads
                  </div>
                </div>

              </div>
            )}

            {/* ── Frame 3: Pipeline Statistics (always visible in Level 2) ── */}
            {pipelineCard}
          </div>
        )}

      </div>
    </div>
  );
}
