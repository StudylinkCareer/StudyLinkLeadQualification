// src/pages/Dashboard.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Watermark from '../components/Watermark';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ── Date helpers ──────────────────────────────────────────────
function getWeekEnd() {
  const d = new Date();
  d.setDate(d.getDate() + (7 - d.getDay())); // Sunday
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
const STATUS_COLORS = { 'New':'#6B7280','Contacted':'#3B82F6','Qualified':'#8B5CF6','Proposal':'#F59E0B','Negotiation':'#F97316','Won':'#10B981','Lost':'#EF4444','On Hold':'#94A3B8' };
const SOURCE_COLORS = ['#2563EB','#0891B2','#059669','#D97706','#7C3AED','#DB2777'];

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

// ── Custom tooltip ────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'8px', padding:'0.5rem 0.75rem', fontSize:'0.8125rem' }}>
      <div style={{ fontWeight:600 }}>{label}</div>
      <div style={{ color:'var(--primary)' }}>{payload[0].value} leads</div>
    </div>
  );
}

export default function Dashboard() {
  const [leads, setLeads]       = useState([]);
  const [myStaff, setMyStaff]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const { staff, isManager }    = useAuth();
  const navigate                = useNavigate();

  useEffect(() => {
    const promises = [studentAPI.search('').then(d => setLeads(d.data || []))];
    // Fetch own staff record to get target
    if (staff?.id) {
      promises.push(
        staffAPI.list().then(d => {
          const me = (d.data || []).find(s => s.id === staff.id);
          if (me) setMyStaff(me);
        }).catch(() => {})
      );
    }
    Promise.all(promises).catch(console.error).finally(() => setLoading(false));
  }, [staff?.id]);

  // ── Scope leads by role ──────────────────────────────────────
  const scopedLeads = useMemo(() => {
    if (isManager) return leads;
    return leads.filter(l =>
      l.counselor       === staff?.fullName ||
      l.seniorCounselor === staff?.fullName ||
      l.presales        === staff?.fullName ||
      l.marketingStaff  === staff?.fullName
    );
  }, [leads, isManager, staff]);

  // ── Summary stats ────────────────────────────────────────────
  const stats = useMemo(() => {
    const total     = scopedLeads.length;
    const won       = scopedLeads.filter(l => l.leadStatus === 'Won').length;
    const active    = scopedLeads.filter(l => !['Won','Lost'].includes(l.leadStatus)).length;
    const thisMonth = scopedLeads.filter(l => {
      if (!l.createdAt) return false;
      const d = new Date(l.createdAt), now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { total, won, active, thisMonth };
  }, [scopedLeads]);

  // ── Pipeline stats ────────────────────────────────────────────
  const pipeline = useMemo(() => {
    const weekEnd    = getWeekEnd();
    const monthEnd   = getMonthEnd();
    const quarterEnd = getQuarterEnd();
    const rolling3m  = getRolling3m();
    const now        = new Date();

    const active = scopedLeads.filter(l => !['Won','Lost'].includes(l.leadStatus));

    const thisWeek = active.filter(l => l.closeDate && new Date(l.closeDate) <= weekEnd);
    const thisWeekIds = new Set(thisWeek.map(l => l.uniqueId));

    const thisMonth = active.filter(l => l.closeDate && new Date(l.closeDate) > weekEnd && new Date(l.closeDate) <= monthEnd);
    const thisMonthIds = new Set(thisMonth.map(l => l.uniqueId));

    const thisQuarter = active.filter(l => l.closeDate && new Date(l.closeDate) > monthEnd && new Date(l.closeDate) <= quarterEnd);

    const rolling = active.filter(l => l.closeDate && new Date(l.closeDate) > quarterEnd && new Date(l.closeDate) <= rolling3m);

    const notProjected = active.filter(l => l.closeDate && new Date(l.closeDate) > rolling3m);

    const noCloseDate = active.filter(l => !l.closeDate);

    return { thisWeek, thisMonth, thisQuarter, rolling, notProjected, noCloseDate };
  }, [scopedLeads]);

  // ── Chart data ────────────────────────────────────────────────
  const stoneData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => { const s = l.stoneTier || 'Unscored'; counts[s] = (counts[s]||0)+1; });
    const order = ['Diamond','Ruby','Sapphire','Agate','Quartz','Unscored'];
    return order.filter(k => counts[k]).map(k => ({ name: k, count: counts[k] }));
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

  // ── Drill-down ────────────────────────────────────────────────
  function drillDown(filterKey, filterValue) {
    navigate('/leads', { state: { drillFilter: { key: filterKey, value: filterValue } } });
  }

  function drillPipeline(leads) {
    const ids = leads.map(l => l.uniqueId);
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  }

  if (loading) return <div className="loading-center">Loading dashboard...</div>;

  const showPipeline = !isManager; // Only for staff with assigned leads

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
          {isManager ? 'All leads' : `${staff?.fullName} — your assigned leads`}
        </span>
      </div>

      <div className="page-body">

        {/* ── Summary stat cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
          <StatCard label="Total Leads"  value={stats.total}     color="#6B7280" onClick={()=>navigate('/leads')}/>
          <StatCard label="Active"       value={stats.active}    color="#2563EB" onClick={()=>drillDown('leadStatus','active')}/>
          <StatCard label="Won"          value={stats.won}       color="#10B981" onClick={()=>drillDown('leadStatus','Won')}/>
          <StatCard label="New This Month" value={stats.thisMonth} color="#F59E0B" sub="created this month"/>
        </div>

        {/* ── Main content row ── */}
        <div style={{ display:'grid', gridTemplateColumns: showPipeline ? '1fr 1fr 1fr 300px' : '1fr 1fr 1fr', gap:'1rem' }}>

          {/* Stone chart */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Leads by Stone</span></div>
            <HBarChart
              data={stoneData}
              colorMap={STONE_COLORS}
              onBarClick={name => drillDown('stoneTier', name)}
            />
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>
              Click a bar to view those leads
            </div>
          </div>

          {/* Status chart */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Leads by Status</span></div>
            <HBarChart
              data={statusData}
              colorMap={STATUS_COLORS}
              onBarClick={name => drillDown('leadStatus', name)}
            />
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>
              Click a bar to view those leads
            </div>
          </div>

          {/* Source chart */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Leads by Source</span></div>
            <HBarChart
              data={sourceData}
              defaultColor={SOURCE_COLORS}
              onBarClick={name => drillDown('leadSource', name)}
            />
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>
              Click a bar to view those leads
            </div>
          </div>

          {/* Pipeline statistics — staff only */}
          {showPipeline && (
            <div className="section-card" style={{ maxHeight:'480px', overflowY:'auto' }}>
              <div className="section-header"><span className="section-title">Pipeline Statistics</span></div>

              <PipelineRow
                label="Target (Won this month)"
                count={myStaff?.target ?? '—'}
                isTarget
                color="var(--primary)"
                sub={myStaff?.targetSetBy ? `Set by ${myStaff.targetSetBy}` : 'Not set'}
              />
              <PipelineRow
                label="Close this week"
                count={pipeline.thisWeek.length}
                color="#10B981"
                sub={`by Sunday ${getWeekEnd().toLocaleDateString()}`}
                onClick={() => drillPipeline(pipeline.thisWeek)}
              />
              <PipelineRow
                label="Close this month"
                count={pipeline.thisMonth.length}
                color="#2563EB"
                sub={`by ${getMonthEnd().toLocaleDateString()}`}
                onClick={() => drillPipeline(pipeline.thisMonth)}
              />
              <PipelineRow
                label="Close this quarter"
                count={pipeline.thisQuarter.length}
                color="#8B5CF6"
                sub={`by ${getQuarterEnd().toLocaleDateString()}`}
                onClick={() => drillPipeline(pipeline.thisQuarter)}
              />
              <PipelineRow
                label="Rolling 3 months"
                count={pipeline.rolling.length}
                color="#F59E0B"
                sub="beyond quarter end"
                onClick={() => drillPipeline(pipeline.rolling)}
              />
              <PipelineRow
                label="Beyond 3 months"
                count={pipeline.notProjected.length}
                color="#EF4444"
                onClick={() => drillPipeline(pipeline.notProjected)}
              />
              <PipelineRow
                label="No close date"
                count={pipeline.noCloseDate.length}
                color="#9CA3AF"
                onClick={() => drillPipeline(pipeline.noCloseDate)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
