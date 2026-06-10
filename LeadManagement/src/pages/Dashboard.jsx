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
//
// CHANGES (Manager/Admin KPI layout):
//   - Manager/Admin dashboard uses a two-level layout:
//       Level 1: Leads by Stone + Leads by Status side-by-side (full width)
//       Level 2: 2 frames (no selection) or 3 frames (counselor selected)
//   - Pipeline Statistics is a bilingual table (Manager + selected counselor)
//
// CHANGES (i18n Phase 2b):
//   - All UI chrome uses t(key, language)
//   - Lead Status chart labels + Pipeline Statistics use labelFor(status, language)
//     from leadStatusLabels.js so status names translate with the language.
//   - Stone tier names use stoneLabel(tier, language) from stoneLabels.js —
//     the DB still stores canonical English values.
//   - Counselor names are user data and are not translated.
//
// CHANGES (Apr 30, 2026 — Item #5 Backlog row):
//   - New 'backlog' pipeline bucket: active leads with closeDate before this
//     week's Monday (i.e. anything from last week or earlier that is still open).
//   - 'thisWeek' is now "Mon..Sun of current week" — leads whose close date is
//     earlier in the same week (e.g. Tuesday when today is Friday) still count
//     as "Close this week", not Backlog.
//   - Added getWeekStart() and getStartOfToday() helpers.
//   - Backlog row appears first in the pipeline table, rendered red,
//     drill-clickable like the other rows.
//   - i18n keys: dashboard.pipeline.backlog, dashboard.pipeline.backlog.sub.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import { studentAPI, staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { t } from '../i18n';
import { labelFor } from '../utils/leadStatusLabels';
import { stoneLabel } from '../utils/stoneLabels';
import Watermark from '../components/Watermark';

// ── Date helpers ──────────────────────────────────────────────
function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekStart() {
  // Monday of the current week, at 00:00:00.000
  const d = new Date();
  const day = d.getDay();                    // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = day === 0 ? -6 : 1 - day;   // distance back to Monday
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}
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

function fmt(str, params) {
  if (!params) return str;
  return Object.keys(params).reduce(
    (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]),
    str
  );
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

// ── Horizontal bar chart ──────────────────────────────────────
function HBarChart({ data, colorMap, defaultColor, onBarClick, displayFor }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
      {data.map((entry, i) => {
        const color = colorMap?.[entry.name] || (Array.isArray(defaultColor) ? defaultColor[i % defaultColor.length] : defaultColor) || '#2563EB';
        const pct = (entry.count / max) * 100;
        const display = displayFor ? displayFor(entry.name) : entry.name;
        return (
          <div key={entry.name} onClick={() => onBarClick && onBarClick(entry.name)}
            style={{ display:'flex', alignItems:'center', gap:'0.5rem', cursor: onBarClick ? 'pointer' : 'default' }}>
            <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', width:'110px', flexShrink:0, textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                 title={display}>
              {display}
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
  const [activeStaff, setActiveStaff] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selectedCounselor, setSelectedCounselor] = useState(null);
  const { staff }    = useAuth();
  const { scope, loading: permsLoading } = usePermissions();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const navigate     = useNavigate();

  // Push trail entry on mount. Dashboard is the trail root — clicking
  // the sidebar Dashboard link clears the trail before navigating here,
  // so this becomes the first entry on a fresh navigation chain.
  useEffect(() => {
    pushTrail({ label: 'Dashboard', path: '/dashboard' });
  }, [pushTrail]);

  // ── Role flags ────────────────────────────────────────────────
  // scope() is exposed by PermissionsContext with signature
  //   scope(resource, operation) — note the order: resource FIRST.
  //   Returns 'all' | 'own' | 'none'.
  //   hasAllScope  → user can see every lead (Manager, Director, Admin)
  //   isAdmin      → role-string check for the few places Admin behaves
  //                  differently (e.g. no target row).
  // Do not treat scope as 'all' until permissions have finished loading.
  // While permsLoading is true, scope() returns a default that may not
  // reflect the real role — treating it as 'all' too early causes
  // counsellors to see every lead until permissions settle.
  const hasAllScope = !permsLoading && scope('leads', 'view_list') === 'all';
  const isAdmin     = staff?.role === 'Admin';

  useEffect(() => {
    // Wait for permissions to resolve before fetching, so hasAllScope
    // is stable and scopedLeads computes correctly on first render.
    if (permsLoading) return;
    const promises = [studentAPI.search('').then(d => setLeads(d.data || []))];
    if (staff?.id) {
      promises.push(
        staffAPI.me()
          .then(d => { if (d.data) setMyStaff(d.data); })
          .catch(() => {})
      );
    }
    if (hasAllScope) {
      promises.push(
        staffAPI.listActive()
          .then(d => { if (d.data) setActiveStaff(d.data); })
          .catch(() => {})
      );
    }
    Promise.all(promises).catch(console.error).finally(() => setLoading(false));
  }, [staff?.id, hasAllScope, permsLoading]);

  const scopedLeads = useMemo(() => {
    if (hasAllScope) return leads;
    return leads.filter(l =>
      l.counselor       === staff?.fullName ||
      l.seniorCounselor === staff?.fullName ||
      l.presales        === staff?.fullName ||
      l.marketingStaff  === staff?.fullName
    );
  }, [leads, hasAllScope, staff]);

  const stats = useMemo(() => {
    const total  = scopedLeads.length;
    const won    = scopedLeads.filter(l => l.leadStatus === 'Contracted').length;
    const active = scopedLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus)).length;
    const thisMonthLeads = scopedLeads.filter(l => {
      if (!l.createdAt) return false;
      const d = new Date(l.createdAt), now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    return {
      total,
      won,
      active,
      thisMonth:    thisMonthLeads.length,
      thisMonthIds: thisMonthLeads.map(l => l.uniqueId),
    };
  }, [scopedLeads]);

  const pipeline = useMemo(() => {
    const weekStart  = getWeekStart();
    const weekEnd    = getWeekEnd();
    const monthEnd   = getMonthEnd();
    const quarterEnd = getQuarterEnd();
    const rolling3m  = getRolling3m();

    const active = scopedLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus));

    // Item #5: Backlog = anything BEFORE this week's Monday.
    // thisWeek = Mon..Sun of the current week (any leads in the current week, even past days).
    const backlog     = active.filter(l => l.closeDate && new Date(l.closeDate) <  weekStart);
    const thisWeek    = active.filter(l => l.closeDate && new Date(l.closeDate) >= weekStart && new Date(l.closeDate) <= weekEnd);
    const thisMonth   = active.filter(l => l.closeDate && new Date(l.closeDate) >  weekEnd  && new Date(l.closeDate) <= monthEnd);
    const thisQuarter = active.filter(l => l.closeDate && new Date(l.closeDate) >  monthEnd && new Date(l.closeDate) <= quarterEnd);
    const rolling     = active.filter(l => l.closeDate && new Date(l.closeDate) >  quarterEnd && new Date(l.closeDate) <= rolling3m);
    const notProjected = active.filter(l => l.closeDate && new Date(l.closeDate) > rolling3m);
    const noCloseDate = active.filter(l => !l.closeDate);
    return { backlog, thisWeek, thisMonth, thisQuarter, rolling, notProjected, noCloseDate };
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
    if (!hasAllScope) return [];
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
  }, [leads, hasAllScope]);

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

  const selectedPipeline = useMemo(() => {
    if (!selectedCounselor) return null;
    const weekStart  = getWeekStart();
    const weekEnd    = getWeekEnd();
    const monthEnd   = getMonthEnd();
    const quarterEnd = getQuarterEnd();
    const rolling3m  = getRolling3m();
    const active = selectedCounselorLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus));
    // Same backlog/thisWeek split as the global pipeline.
    const backlog     = active.filter(l => l.closeDate && new Date(l.closeDate) <  weekStart);
    const thisWeek    = active.filter(l => l.closeDate && new Date(l.closeDate) >= weekStart && new Date(l.closeDate) <= weekEnd);
    const thisMonth   = active.filter(l => l.closeDate && new Date(l.closeDate) >  weekEnd  && new Date(l.closeDate) <= monthEnd);
    const thisQuarter = active.filter(l => l.closeDate && new Date(l.closeDate) >  monthEnd && new Date(l.closeDate) <= quarterEnd);
    const rolling     = active.filter(l => l.closeDate && new Date(l.closeDate) >  quarterEnd && new Date(l.closeDate) <= rolling3m);
    const notProjected = active.filter(l => l.closeDate && new Date(l.closeDate) > rolling3m);
    const noCloseDate = active.filter(l => !l.closeDate);
    return { backlog, thisWeek, thisMonth, thisQuarter, rolling, notProjected, noCloseDate };
  }, [selectedCounselor, selectedCounselorLeads]);

  const selectedCounselorStaff = useMemo(() => {
    if (!selectedCounselor) return null;
    return activeStaff.find(s => s.fullName === selectedCounselor) || null;
  }, [activeStaff, selectedCounselor]);

  useEffect(() => {
    if (selectedCounselor && !counselorData.some(c => c.counselor === selectedCounselor)) {
      setSelectedCounselor(null);
    }
  }, [counselorData, selectedCounselor]);

  // Counselor restriction: when a Counselor user drills from the dashboard,
  // the resulting Leads view should only contain THEIR leads (not the whole
  // company's). We implement this by pre-filtering leads to ownership and
  // passing the matching IDs through the existing `_ids` drill mechanism.
  // Non-Counselors fall through to the original behavior.
  const isCounselor = staff?.role === 'Counselor';
  function ownsLead(l) {
    if (!staff?.fullName) return false;
    return (
      l.counselor       === staff.fullName ||
      l.seniorCounselor === staff.fullName ||
      l.presales        === staff.fullName ||
      l.marketingStaff  === staff.fullName
    );
  }

  function drillDown(filterKey, filterValue) {
    if (isCounselor) {
      const ids = leads
        .filter(ownsLead)
        .filter(l => {
          if (filterKey === 'stoneTier') {
            return (l.stoneTier || 'Unscored') === filterValue;
          }
          if (filterKey === 'leadStatus' && filterValue === 'active') {
            const active = ['New','Not contactable','Engaged','Vetted','Met with customer and family','Proposal','Family negotiation/review','Nurturing'];
            return active.includes(l.leadStatus || 'New');
          }
          return l[filterKey] === filterValue;
        })
        .map(l => l.uniqueId);
      navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
      return;
    }
    navigate('/leads', { state: { drillFilter: { key: filterKey, value: filterValue } } });
  }
  function drillPipeline(leads) {
    const list = isCounselor ? leads.filter(ownsLead) : leads;
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: list.map(l => l.uniqueId) } } });
  }
  function toggleCounselor(name) {
    setSelectedCounselor(prev => prev === name ? null : name);
  }
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

  if (loading) return <div className="loading-center">{t('dashboard.loading', language)}</div>;

  const isManagerOrAdmin = hasAllScope;
  const maxCounselorTotal = Math.max(...counselorData.map(d => d.total), 1);

  // ── Pipeline Statistics: bilingual table ─────────────────────
  const showCounselorCol = isManagerOrAdmin && !!selectedCounselor;

  // Item #5: Backlog row goes first (highest urgency).
  const pipelineRows = [
    { key:'backlog',      labelKey:'dashboard.pipeline.backlog',          subKey:'dashboard.pipeline.backlog.sub',          subParams:null,                                            color:'#DC2626' },
    { key:'thisWeek',     labelKey:'dashboard.pipeline.closeThisWeek',    subKey:'dashboard.pipeline.closeThisWeek.sub',    subParams:{ date: getWeekEnd().toLocaleDateString()    }, color:'#10B981' },
    { key:'thisMonth',    labelKey:'dashboard.pipeline.closeThisMonth',   subKey:'dashboard.pipeline.closeThisMonth.sub',   subParams:{ date: getMonthEnd().toLocaleDateString()   }, color:'#2563EB' },
    { key:'thisQuarter',  labelKey:'dashboard.pipeline.closeThisQuarter', subKey:'dashboard.pipeline.closeThisQuarter.sub', subParams:{ date: getQuarterEnd().toLocaleDateString() }, color:'#8B5CF6' },
    { key:'rolling',      labelKey:'dashboard.pipeline.rolling3Months',   subKey:'dashboard.pipeline.rolling3Months.sub',   subParams:null,                                            color:'#F59E0B' },
    { key:'notProjected', labelKey:'dashboard.pipeline.beyond3Months',    subKey:null,                                      subParams:null,                                            color:'#EF4444' },
    { key:'noCloseDate',  labelKey:'dashboard.pipeline.noCloseDate',      subKey:null,                                      subParams:null,                                            color:'#9CA3AF' },
  ];

  const managerTargetCount = (() => {
    // Manager OR Director (anyone with all-scope view who isn't Admin)
    // sees the aggregated counselor target total.
    if (hasAllScope && !isAdmin) {
      const cw = activeStaff.filter(s => s.role === 'Counselor' && s.target != null);
      return cw.length > 0 ? cw.reduce((sum, s) => sum + Number(s.target || 0), 0) : '—';
    }
    if (!isAdmin) return myStaff?.target ?? '—';
    return null;
  })();

  const managerTargetSub = (() => {
    if (hasAllScope && !isAdmin) {
      const n = activeStaff.filter(s => s.role === 'Counselor' && s.target != null).length;
      if (n === 0) return t('dashboard.pipeline.target.none', language);
      const key = n === 1 ? 'dashboard.pipeline.target.aggregated' : 'dashboard.pipeline.target.aggregatedPlural';
      return fmt(t(key, language), { n });
    }
    if (!isAdmin) {
      return myStaff?.targetSetBy
        ? fmt(t('dashboard.pipeline.target.setBy', language), { name: myStaff.targetSetBy })
        : t('dashboard.pipeline.target.notSet', language);
    }
    return '';
  })();

  const counselorTargetCount = selectedCounselorStaff?.target ?? '—';
  const showTargetRow = !isAdmin;

  const pipelineCard = (
    <div className="section-card" style={{ height:'100%', overflowY:'auto', alignSelf:'stretch' }}>
      <div className="section-header"><span className="section-title">{t('dashboard.pipeline.title', language)}</span></div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign:'left', padding:'0.4rem 0.25rem', fontSize:'0.6875rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)' }}></th>
            <th style={{ textAlign:'right', padding:'0.4rem 0.25rem', fontSize:'0.6875rem', fontWeight:600, color:'var(--primary)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', width:'72px' }}>
              {hasAllScope ? (staff?.role || t('common.manager', language)) : t('common.you', language)}
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
                <div style={{ fontSize:'0.875rem' }}>{t('dashboard.pipeline.target', language)}</div>
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
            const subText = row.subKey ? fmt(t(row.subKey, language), row.subParams || {}) : null;
            return (
              <tr key={row.key}>
                <td style={{ padding:'0.5rem 0.25rem', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ fontSize:'0.875rem' }}>{t(row.labelKey, language)}</div>
                  {subText && <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{subText}</div>}
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

  const selectedLeadsCount = selectedCounselorLeads.length;
  const leadsWord = language === 'vi'
    ? t('dashboard.counselor.leads', language)
    : (selectedLeadsCount === 1 ? t('dashboard.counselor.lead', language) : t('dashboard.counselor.leads', language) + 's');

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">{t('dashboard.title', language)}</span>
        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
          {isManagerOrAdmin
            ? t('dashboard.allLeads', language)
            : `${staff?.fullName} — ${t('dashboard.yourAssignedLeads', language)}`}
        </span>
      </div>

      <div className="page-body">

        {/* ── Top stat cards ──────────────────────────────────── */}
        <div className="dashboard-stat-grid" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
          <StatCard label={t('dashboard.stat.totalLeads', language)}    value={stats.total}     color="#6B7280" onClick={()=>navigate('/leads', { state: { reset: true } })}/>
          <StatCard label={t('dashboard.stat.active', language)}        value={stats.active}    color="#2563EB" onClick={()=>drillDown('leadStatus','active')}/>
          <StatCard label={t('dashboard.stat.contracted', language)}    value={stats.won}       color="#10B981" onClick={()=>drillDown('leadStatus','Contracted')}/>
          <StatCard
            label={t('dashboard.stat.newThisMonth', language)}
            value={stats.thisMonth}
            color="#F59E0B"
            sub={t('dashboard.stat.newThisMonth.sub', language)}
            onClick={() => drillDown('_ids', stats.thisMonthIds)}
          />
        </div>

        {/* ── Level 1 / counselor mixed ───────────────────────── */}
        {isManagerOrAdmin ? (
          <div className="dashboard-charts-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1.5rem' }}>
            <div className="section-card">
              <div className="section-header"><span className="section-title">{t('dashboard.chart.leadsByStone', language)}</span></div>
              <HBarChart data={stoneData} colorMap={STONE_COLORS}
                displayFor={name => stoneLabel(name, language)}
                onBarClick={name => drillDown('stoneTier', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>{t('dashboard.clickBarToView', language)}</div>
            </div>

            <div className="section-card">
              <div className="section-header"><span className="section-title">{t('dashboard.chart.leadsByStatus', language)}</span></div>
              <HBarChart data={statusData} colorMap={STATUS_COLORS}
                displayFor={name => labelFor(name, language)}
                onBarClick={name => drillDown('leadStatus', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>{t('dashboard.clickBarToView', language)}</div>
            </div>
          </div>
        ) : (
          <div className="dashboard-charts-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 300px', gap:'1rem', marginBottom:'1.5rem' }}>

            <div className="section-card">
              <div className="section-header"><span className="section-title">{t('dashboard.chart.leadsByStone', language)}</span></div>
              <HBarChart data={stoneData} colorMap={STONE_COLORS}
                displayFor={name => stoneLabel(name, language)}
                onBarClick={name => drillDown('stoneTier', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>{t('dashboard.clickBarToView', language)}</div>
            </div>

            <div className="section-card">
              <div className="section-header"><span className="section-title">{t('dashboard.chart.leadsByStatus', language)}</span></div>
              <HBarChart data={statusData} colorMap={STATUS_COLORS}
                displayFor={name => labelFor(name, language)}
                onBarClick={name => drillDown('leadStatus', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>{t('dashboard.clickBarToView', language)}</div>
            </div>

            <div className="section-card">
              <div className="section-header"><span className="section-title">{t('dashboard.chart.leadsBySource', language)}</span></div>
              <HBarChart data={sourceData} defaultColor={SOURCE_COLORS} onBarClick={name => drillDown('leadSource', name)}/>
              <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>{t('dashboard.clickBarToView', language)}</div>
            </div>

            {pipelineCard}
          </div>
        )}

        {/* ── Level 2 (Manager/Admin only) ────────────────────── */}
        {isManagerOrAdmin && (
          <div className="dashboard-level2-grid" style={{
            display:'grid',
            gridTemplateColumns: selectedCounselor ? '1.3fr 1fr 1fr' : '2fr 1fr',
            gap:'1rem',
            transition:'grid-template-columns 0.3s ease',
          }}>

            {/* ── Frame 1: Counselor chart ── */}
            <div className="section-card">
              <div className="section-header">
                <span className="section-title">{t('dashboard.chart.leadsByCounselor', language)}</span>
                <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                  {t('dashboard.clickCounselorToDrill', language)}
                </span>
              </div>

              {/* Stone legend at top of counselor chart */}
              <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap', marginBottom:'1.25rem' }}>
                {COUNSELOR_STONES.map(stone => (
                  <div key={stone} style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                    <div style={{
                      width:'12px', height:'12px', borderRadius:'3px', flexShrink:0,
                      background: COUNSELOR_STONE_COLORS[stone],
                      border: stone === 'Unscored' ? '1px solid #D1D5DB' : 'none',
                    }}/>
                    <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{stoneLabel(stone, language)}</span>
                  </div>
                ))}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {counselorData.map(({ counselor, stoneMap, total }) => {
                  const barWidthPct = (total / maxCounselorTotal) * 100;
                  const isSelected  = selectedCounselor === counselor;
                  const allLeadsTitle = `${counselor} — ${t('dashboard.counselor.allLeadsTotal', language)} ${total}`;
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
                                title={`${counselor} — ${stoneLabel(stone, language)}: ${arr.length}`}
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
                        title={allLeadsTitle}
                      >
                        {total}
                      </div>

                    </div>
                  );
                })}
              </div>

              {/* Bottom stone totals summary */}
              <div style={{ marginTop:'1.25rem', paddingTop:'0.875rem', borderTop:'1px solid var(--border)', display:'flex', gap:'1.25rem', flexWrap:'wrap' }}>
                {COUNSELOR_STONES.map(stone => {
                  const count = leads.filter(l => (COUNSELOR_STONES.includes(l.stoneTier) ? l.stoneTier : 'Unscored') === stone).length;
                  if (!count) return null;
                  return (
                    <div key={stone} style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                      <div style={{ width:'9px', height:'9px', borderRadius:'2px', background: COUNSELOR_STONE_COLORS[stone], border: stone==='Unscored'?'1px solid #D1D5DB':'none' }}/>
                      <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>{stoneLabel(stone, language)}:</span>
                      <span style={{ fontSize:'0.8rem', fontWeight:600 }}>{count}</span>
                    </div>
                  );
                })}
                <div style={{ marginLeft:'auto', fontSize:'0.8rem', fontWeight:700 }}>{t('dashboard.counselor.total', language)}: {leads.length}</div>
              </div>
            </div>

            {/* ── Frame 2: drill-down ── */}
            {selectedCounselor && (
              <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

                <div className="section-card">
                  <div className="section-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
                    <div style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
                      <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                        {t('dashboard.counselor.label', language)}
                      </span>
                      <span className="section-title" style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {selectedCounselor}
                      </span>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.125rem' }}>
                        {selectedLeadsCount} {leadsWord}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedCounselor(null)}
                      title={t('dashboard.counselor.closeDrilldown', language)}
                      aria-label={t('dashboard.counselor.closeDrilldown', language)}
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
                  <div style={{ fontSize:'0.8125rem', fontWeight:600, marginBottom:'0.625rem', marginTop:'0.5rem' }}>{t('dashboard.chart.leadsByStone', language)}</div>
                  {selectedStoneData.length === 0 ? (
                    <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{t('dashboard.counselor.noLeads', language)}</div>
                  ) : (
                    <HBarChart
                      data={selectedStoneData}
                      colorMap={STONE_COLORS}
                      displayFor={name => stoneLabel(name, language)}
                      onBarClick={name => drillCounselorStone(selectedCounselor, name)}
                    />
                  )}
                  <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.625rem' }}>
                    {t('dashboard.clickBarToView', language)}
                  </div>
                </div>

                <div className="section-card">
                  <div className="section-header"><span className="section-title">{t('dashboard.chart.leadsByStatus', language)}</span></div>
                  {selectedStatusData.length === 0 ? (
                    <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{t('dashboard.counselor.noLeads', language)}</div>
                  ) : (
                    <HBarChart
                      data={selectedStatusData}
                      colorMap={STATUS_COLORS}
                      displayFor={name => labelFor(name, language)}
                      onBarClick={name => drillCounselorStatus(selectedCounselor, name)}
                    />
                  )}
                  <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.625rem' }}>
                    {t('dashboard.clickBarToView', language)}
                  </div>
                </div>

              </div>
            )}

            {/* ── Frame 3: Pipeline Statistics ── */}
            {pipelineCard}
          </div>
        )}

      </div>
    </div>
  );
}
