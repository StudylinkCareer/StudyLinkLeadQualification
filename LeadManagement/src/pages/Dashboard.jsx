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

import { useState, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import { studentAPI, staffAPI, reportsAPI } from '../services/api';
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
  // Sunday of the current Mon-Sun week. Derived from getWeekStart so it is
  // always exactly 6 days after Monday. (The old formula `date + (7 - getDay())`
  // jumped to NEXT Sunday when today WAS Sunday, stretching "this week" to ~2 weeks.)
  const end = getWeekStart();
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
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
function getQuarterStart() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1, 0, 0, 0, 0);
}
function getNextMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}
function getNextMonthEnd() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 2, 0, 23, 59, 59, 999);
}
function getNextQuarterStart() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), (q + 1) * 3, 1, 0, 0, 0, 0);
}
function getNextQuarterEnd() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), (q + 2) * 3, 0, 23, 59, 59, 999);
}
function getQuarterPlus2Start() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), (q + 2) * 3, 1, 0, 0, 0, 0);
}

// Forward-looking pipeline buckets, keyed off close date. Overlaps are
// INTENTIONAL: "to month end" includes "this week", "to quarter end" includes
// the months inside it, etc. Backlog (before today) and no-close-date stand
// alone. Each bucket is its own filter — they are NOT meant to sum to a total.
function computePipeline(active) {
  const today        = getStartOfToday();
  const weekStart    = getWeekStart();
  const weekEnd      = getWeekEnd();
  const monthEnd     = getMonthEnd();
  const nextMonStart = getNextMonthStart();
  const nextMonEnd   = getNextMonthEnd();
  const quarterStart = getQuarterStart();
  const quarterEnd   = getQuarterEnd();
  const nextQStart   = getNextQuarterStart();
  const nextQEnd     = getNextQuarterEnd();
  const qPlus2Start  = getQuarterPlus2Start();
  const cd = l => new Date(l.closeDate);
  return {
    backlog:         active.filter(l => l.closeDate && cd(l) <  today),
    thisWeek:        active.filter(l => l.closeDate && cd(l) >= weekStart    && cd(l) <= weekEnd),
    toMonthEnd:      active.filter(l => l.closeDate && cd(l) >= weekStart    && cd(l) <= monthEnd),
    followingMonth:  active.filter(l => l.closeDate && cd(l) >= nextMonStart && cd(l) <= nextMonEnd),
    toQuarterEnd:    active.filter(l => l.closeDate && cd(l) >= quarterStart && cd(l) <= quarterEnd),
    nextQuarter:     active.filter(l => l.closeDate && cd(l) >= nextQStart   && cd(l) <= nextQEnd),
    postNextQuarter: active.filter(l => l.closeDate && cd(l) >= qPlus2Start),
    noCloseDate:     active.filter(l => !l.closeDate),
  };
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

const TERMINAL_STATUSES = ['Contracted', 'Lost', 'Archived', 'Cancelled'];

// Lead statuses that COUNT in a counsellor's reporting. Whitelist, not blacklist:
// any status NOT here — Lost, Archived, Cancelled, and blank/null — is excluded
// (the name stays on the record for reference only). 'Not contactable' IS counted
// (added 2026-07-04, user's call) so the per-counsellor Management view matches
// each counsellor's own dashboard. This set now == the counsellor's own-leads
// filter (active book = everything except Lost/Archived/Cancelled).
const REPORTING_INCLUDED_STATUSES = [
  'New', 'Engaged', 'Contracted', 'Proposal',
  'Met with customer and family', 'Vetted', 'Family negotiation/review',
  'Nurturing', 'Not contactable',
];

// Presales works the same early funnel — identical reportable set now that
// 'Not contactable' is counted for Counselling too.
const PRESALES_INCLUDED_STATUSES = REPORTING_INCLUDED_STATUSES;

// Reportable-status set per department phase. Same philosophy, different funnel.
const REPORTABLE_STATUSES_BY_PHASE = {
  Counselling: REPORTING_INCLUDED_STATUSES,
  Presales:    PRESALES_INCLUDED_STATUSES,
};

// Phase-driven ownership: a lead counts toward the current owner (the primary
// `counselor` slot — which for a Presales-phase Order holds a PreSales-position
// person) in per-staff reporting ONLY while its status is reportable AND its
// Sales Order sits in the given department phase. Presales reporting reuses this
// exact philosophy with phase='Presales' (same grouping column, same whitelist).
// Once the Order moves department, or the status leaves the reportable set, the
// name remains for display but the lead is no longer attributed.
function attributableTo(l, phase) {
  const reportable = REPORTABLE_STATUSES_BY_PHASE[phase] || REPORTING_INCLUDED_STATUSES;
  return l.orderPhase === phase && reportable.includes(l.leadStatus);
}

// Labels for the Contracted period cards (kept local for now; can be moved
// into i18n/en.js + vi.js later).
const CONTRACTED_LABELS = {
  en: { heading:'Contracts signed — backward-looking (actuals)', thisWeek:'Contracted this week', lastWeek:'Contracted last week', mtd:'Contracted MTD', qtd:'Contracted QTD', ytd:'Contracted YTD', reversed:'Contracted reversed' },
  vi: { heading:'Hợp đồng đã ký — nhìn lại', thisWeek:'Hợp đồng tuần này', lastWeek:'Hợp đồng tuần trước', mtd:'Hợp đồng tháng này', qtd:'Hợp đồng quý này', ytd:'Hợp đồng năm nay', reversed:'Hợp đồng bị đảo' },
};

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

// ── Record finder ─────────────────────────────────────────────
// A lightweight type-ahead: filters `entries` (up to 50 shown) into a native
// <datalist>; when the input value exactly matches an entry (i.e. the user
// picked from the list), calls onPick(id) to navigate. Entry.value is a unique
// display string ("Name — SalesID" / "LeadID — Name"); entry.id is the nav key.
function RecordFinder({ label, placeholder, entries, onPick, style }) {
  const [text, setText] = useState('');
  const listId = useId();
  const map = useMemo(() => {
    const m = new Map();
    for (const e of entries) m.set(e.value, e.id);
    return m;
  }, [entries]);
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const e of entries) {
      if (e.value.toLowerCase().includes(q)) { out.push(e); if (out.length >= 50) break; }
    }
    return out;
  }, [text, entries]);
  function handleChange(v) {
    setText(v);
    if (map.has(v)) { onPick(map.get(v)); setText(''); }   // picked from the list → go
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.25rem', minWidth:0, ...(style||{}) }}>
      {label && <label style={{ fontSize:'0.7rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.03em' }}>{label}</label>}
      <input list={listId} value={text} placeholder={placeholder}
        onChange={e=>handleChange(e.target.value)}
        style={{ padding:'0.45rem 0.625rem', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg-primary)', color:'var(--text-primary)', fontSize:'0.8125rem' }}/>
      <datalist id={listId}>
        {suggestions.map(e => <option key={e.value} value={e.value} />)}
      </datalist>
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
  const [contracted, setContracted]   = useState(null);
  const [contractedSelected, setContractedSelected] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [selectedCounselor, setSelectedCounselor] = useState(null);
  // Which department's per-owner reporting to show: 'Counselling' | 'Presales'.
  // Same format/philosophy for both — only the Order-phase gate differs.
  const [reportDept, setReportDept] = useState('Counselling');
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
    // Per-LEAD dataset (one row per lead) so all analytics are lead-level, not
    // person-level — a person with N leads counts as N, each under its own
    // status/counsellor. (searchLeads = SELECT s.*, l.*; the lead's own status
    // and staff win over the person's.)
    const promises = [studentAPI.searchLeads('').then(d => setLeads(d.data || []))];
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
    promises.push(
      reportsAPI.contractedStats()
        .then(d => { if (d.data) setContracted(d.data); })
        .catch(() => {})
    );
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
      thisMonthIds: thisMonthLeads.map(l => l.leadId),
    };
  }, [scopedLeads]);

  const pipeline = useMemo(() => {
    const active = scopedLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus));
    return computePipeline(active);
  }, [scopedLeads]);

  // ── Record-finder option lists (permission-scoped: built from `leads`, which
  // the server already limited to what this user may see). Persons are de-duped
  // by Sales ID; Lead IDs are one-per-lead.
  const finderOpts = useMemo(() => {
    const persons = new Map();                 // studentId -> fullName
    const leadOpts = [];
    for (const l of leads) {
      const name = l.fullName || '(no name)';
      if (l.leadId != null) leadOpts.push({ value: `${l.leadId} — ${name}`, id: l.leadId });
      if (l.studentId && !persons.has(l.studentId)) persons.set(l.studentId, name);
    }
    const nameOpts  = [];
    const salesOpts = [];
    for (const [sid, name] of persons) {
      nameOpts.push({ value: `${name} — ${sid}`, id: sid });
      salesOpts.push({ value: `${sid} — ${name}`, id: sid });
    }
    nameOpts.sort((a, b) => a.value.localeCompare(b.value));
    return { nameOpts, salesOpts, leadOpts };
  }, [leads]);

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
      if (!attributableTo(l, reportDept)) return;   // wrong department, or inactive → display-only
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
  }, [leads, hasAllScope, reportDept]);

  const selectedCounselorLeads = useMemo(() => {
    if (!selectedCounselor) return [];
    return leads.filter(l => (l.counselor || 'Unassigned') === selectedCounselor && attributableTo(l, reportDept));
  }, [leads, selectedCounselor, reportDept]);

  // Per-counsellor backward (signed) figures for the pipeline's counsellor column.
  useEffect(() => {
    if (!selectedCounselor || !hasAllScope) { setContractedSelected(null); return; }
    reportsAPI.contractedStats(selectedCounselor)
      .then(d => setContractedSelected(d.data || null))
      .catch(() => setContractedSelected(null));
  }, [selectedCounselor, hasAllScope]);

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
    const active = selectedCounselorLeads.filter(l => !TERMINAL_STATUSES.includes(l.leadStatus));
    return computePipeline(active);
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
    // Drill by the matching LEADS' ids (scopedLeads is already permission-scoped),
    // so the Leads list shows those exact leads — not every lead of the persons
    // involved. Uniform for counsellors and managers/admins.
    const ids = scopedLeads
      .filter(l => {
        if (filterKey === 'stoneTier')  return (l.stoneTier  || 'Unscored') === filterValue;
        if (filterKey === 'leadSource') return (l.leadSource || '')          === filterValue;
        if (filterKey === 'leadStatus') {
          if (filterValue === 'active') return !TERMINAL_STATUSES.includes(l.leadStatus || 'New');
          return (l.leadStatus || 'New') === filterValue;
        }
        return l[filterKey] === filterValue;
      })
      .map(l => l.leadId);
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  }
  function drillPipeline(leads) {
    const list = isCounselor ? leads.filter(ownsLead) : leads;
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: list.map(l => l.leadId) } } });
  }
  // Drill straight into a server-provided id list (already scope-correct).
  function drillIds(ids) {
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids || [] } } });
  }
  function toggleCounselor(name) {
    setSelectedCounselor(prev => prev === name ? null : name);
  }
  function drillCounselorStone(counselor, stone) {
    const ids = leads
      .filter(l => (l.counselor || 'Unassigned') === counselor
                && (l.stoneTier || 'Unscored')   === stone
                && attributableTo(l, reportDept))
      .map(l => l.leadId);
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  }
  function drillCounselorStatus(counselor, status) {
    const ids = leads
      .filter(l => (l.counselor || 'Unassigned') === counselor
                && (l.leadStatus || 'New')       === status
                && attributableTo(l, reportDept))
      .map(l => l.leadId);
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  }

  if (loading) return <div className="loading-center">{t('dashboard.loading', language)}</div>;

  const isManagerOrAdmin = hasAllScope;
  const maxCounselorTotal = Math.max(...counselorData.map(d => d.total), 1);

  // ── Pipeline Statistics: bilingual table ─────────────────────
  const showCounselorCol = isManagerOrAdmin && !!selectedCounselor;

  // Item #5: Backlog row goes first (highest urgency).
  const _cl = CONTRACTED_LABELS[language] || CONTRACTED_LABELS.en;
  const pipelineRows = [
    { kind:'header', label: language==='vi'?'Đã ký — thực tế (nhìn lại)':'Signed — actual (backward)' },
    { kind:'contracted', bucket:'thisWeek',      label: _cl.thisWeek, color:'#10B981' },
    { kind:'contracted', bucket:'lastWeek',      label: _cl.lastWeek, color:'#10B981' },
    { kind:'contracted', bucket:'monthToDate',   label: _cl.mtd,      color:'#10B981' },
    { kind:'contracted', bucket:'quarterToDate', label: _cl.qtd,      color:'#10B981' },
    { kind:'contracted', bucket:'yearToDate',    label: _cl.ytd,      color:'#10B981' },
    { kind:'header', label: language==='vi'?'Dự kiến ký — theo ngày chốt (nhìn tới)':'Projected — by close date (forward)' },
    { kind:'pipeline', key:'backlog',         label: language==='vi'?'Tồn đọng':'Backlog',           sub: language==='vi'?'trước hôm nay':'before today',                                            color:'#DC2626' },
    { kind:'pipeline', key:'thisWeek',        label: language==='vi'?'Tuần này':'This week',              sub: `${getWeekStart().toLocaleDateString()} – ${getWeekEnd().toLocaleDateString()}`,                       color:'#10B981' },
    { kind:'pipeline', key:'toMonthEnd',      label: language==='vi'?'Đến cuối tháng':'To month end',  sub: `${getWeekStart().toLocaleDateString()} → ${getMonthEnd().toLocaleDateString()}`,             color:'#2563EB' },
    { kind:'pipeline', key:'followingMonth',  label: language==='vi'?'Tháng kế tiếp':'Following month',    sub: `${getNextMonthStart().toLocaleDateString()} – ${getNextMonthEnd().toLocaleDateString()}`,    color:'#0EA5E9' },
    { kind:'pipeline', key:'toQuarterEnd',    label: language==='vi'?'Đến cuối quý':'To quarter end',  sub: `${getQuarterStart().toLocaleDateString()} → ${getQuarterEnd().toLocaleDateString()}`,        color:'#8B5CF6' },
    { kind:'pipeline', key:'nextQuarter',     label: language==='vi'?'Quý kế tiếp':'Next quarter',         sub: `${getNextQuarterStart().toLocaleDateString()} – ${getNextQuarterEnd().toLocaleDateString()}`, color:'#A855F7' },
    { kind:'pipeline', key:'postNextQuarter', label: language==='vi'?'Sau quý kế tiếp':'Post next quarter', sub: `${getQuarterPlus2Start().toLocaleDateString()} →`,                                          color:'#F59E0B' },
    { kind:'pipeline', key:'noCloseDate',     label: language==='vi'?'Chưa có ngày chốt':'No close date', sub: null,                                                                                         color:'#9CA3AF' },
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
          {pipelineRows.map((row, idx) => {
            if (row.kind === 'header') {
              return (
                <tr key={`hdr-${idx}`}>
                  <td colSpan={showCounselorCol ? 3 : 2}
                      style={{ padding:'0.7rem 0.25rem 0.3rem', fontSize:'0.6875rem', fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)' }}>
                    {row.label}
                  </td>
                </tr>
              );
            }
            if (row.kind === 'contracted') {
              const c = contracted ? contracted[row.bucket] : null;
              return (
                <tr key={`ctr-${row.bucket}`}>
                  <td style={{ padding:'0.5rem 0.25rem', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ fontSize:'0.875rem' }}>{row.label}</div>
                  </td>
                  <td onClick={() => drillIds(c ? c.ids : [])}
                    style={{ padding:'0.5rem 0.25rem', textAlign:'right', fontSize:'1rem', fontWeight:600, color: row.color, borderBottom:'1px solid var(--border)', cursor:'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background='var(--bg-secondary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}>
                    {c ? c.count : '—'}
                  </td>
                  {showCounselorCol && (() => {
                    const sc = contractedSelected ? contractedSelected[row.bucket] : null;
                    return (
                      <td onClick={() => drillIds(sc ? sc.ids : [])}
                        style={{ padding:'0.5rem 0.25rem', textAlign:'right', fontSize:'1rem', fontWeight:600, color: row.color, borderBottom:'1px solid var(--border)', cursor:'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.background='var(--bg-secondary)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}>
                        {sc ? sc.count : '—'}
                      </td>
                    );
                  })()}
                </tr>
              );
            }
            const mgrLeads = pipeline[row.key] || [];
            const cslLeads = selectedPipeline ? (selectedPipeline[row.key] || []) : [];
            const subText = row.sub || null;
            return (
              <tr key={row.key}>
                <td style={{ padding:'0.5rem 0.25rem', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ fontSize:'0.875rem' }}>{row.label}</div>
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

        {/* ── Banner statistics + quick record finder (5th card) ── */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'1rem', alignItems:'flex-start', marginBottom:'1.5rem' }}>
          <div className="dashboard-stat-grid" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', flex:'1 1 560px' }}>
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

          {/* Quick record finder — compact 5th card on the right. Pick a
              Name / Sales ID / Lead ID to jump straight to that record;
              the Leads page has the fuller, filterable list. */}
          <div style={{ flex:'0 0 240px', minWidth:'220px', display:'flex', flexDirection:'column', gap:'0.5rem', justifyContent:'center',
                        background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'10px',
                        borderLeft:'4px solid var(--primary)', padding:'0.875rem 1rem' }}>
            <RecordFinder
              placeholder={language==='vi'?'Tìm tên…':'Search name'}
              entries={finderOpts.nameOpts}
              onPick={sid=>navigate(`/students/${sid}`)}/>
            <RecordFinder
              placeholder={language==='vi'?'Tìm Sales ID…':'Search Sales ID'}
              entries={finderOpts.salesOpts}
              onPick={sid=>navigate(`/students/${sid}`)}/>
            <RecordFinder
              placeholder={language==='vi'?'Tìm Lead ID…':'Search Lead ID'}
              entries={finderOpts.leadOpts}
              onPick={lid=>navigate(`/lead/${lid}`)}/>
          </div>
        </div>

        {/* Contracts-signed cards moved to the Weekly Report page. */}

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

            {/* ── Frame 1: per-owner chart (Counselling / Presales) ── */}
            <div className="section-card">
              <div className="section-header">
                <span className="section-title">
                  {reportDept === 'Presales'
                    ? (language === 'vi' ? 'Khách hàng theo Pre-Sales' : 'Leads by Pre-Sales')
                    : t('dashboard.chart.leadsByCounselor', language)}
                </span>
                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                  {/* Department toggle — same reporting format/philosophy, phase gate differs */}
                  <div style={{ display:'inline-flex', border:'1px solid var(--border)', borderRadius:'6px', overflow:'hidden' }}>
                    {[
                      ['Counselling', language === 'vi' ? 'Tư vấn'   : 'Counselling'],
                      ['Presales',    language === 'vi' ? 'Pre-Sales' : 'Pre-Sales'],
                    ].map(([dep, label]) => (
                      <button
                        key={dep}
                        onClick={() => { setReportDept(dep); setSelectedCounselor(null); }}
                        style={{
                          padding:'0.2rem 0.65rem', fontSize:'0.75rem', fontWeight:600,
                          cursor:'pointer', border:'none',
                          background: reportDept === dep ? 'var(--primary)' : 'transparent',
                          color:      reportDept === dep ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                    {t('dashboard.clickCounselorToDrill', language)}
                  </span>
                </div>
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
