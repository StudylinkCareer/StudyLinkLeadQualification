// src/pages/Dashboard.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
const STATUS_COLORS = { 'New':'#6B7280','Contacted':'#3B82F6','Qualified':'#8B5CF6','Proposal':'#F59E0B','Negotiation':'#F97316','Won':'#10B981','Lost':'#EF4444','On Hold':'#94A3B8' };
const SOURCE_COLORS = ['#2563EB','#0891B2','#059669','#D97706','#7C3AED','#DB2777'];

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
  const [loading, setLoading]   = useState(true);
  const { staff, isManager, isAdmin } = useAuth();
  const navigate                = useNavigate();

  useEffect(() => {
    const promises = [studentAPI.search('').then(d => setLeads(d.data || []))];
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
    if (isManager || isAdmin) return leads;
    return leads.filter(l =>
      l.counselor       === staff?.fullName ||
      l.seniorCounselor === staff?.fullName ||
      l.presales        === staff?.fullName ||
      l.marketingStaff  === staff?.fullName
    );
  }, [leads, isManager, isAdmin, staff]);

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

    const active = scopedLeads.filter(l => !['Won','Lost'].includes(l.leadStatus));
    const thisWeek    = active.filter(l => l.closeDate && new Date(l.closeDate) <= weekEnd);
    const thisMonth   = active.filter(l => l.closeDate && new Date(l.closeDate) > weekEnd && new Date(l.closeDate) <= monthEnd);
    const thisQuarter = active.filter(l => l.closeDate && new Date(l.closeDate) > monthEnd && new Date(l.closeDate) <= quarterEnd);
    const rolling     = active.filter(l => l.closeDate && new Date(l.closeDate) > quarterEnd && new Date(l.closeDate) <= rolling3m);
    const notProjected = active.filter(l => l.closeDate && new Date(l.closeDate) > rolling3m);
    const noCloseDate = active.filter(l => !l.closeDate);
    return { thisWeek, thisMonth, thisQuarter, rolling, notProjected, noCloseDate };
  }, [scopedLeads]);

  // ── Chart data ────────────────────────────────────────────────
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

  // ── Counselor chart data (Admin/Manager only) ─────────────────
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

  // ── Drill-down ────────────────────────────────────────────────
  function drillDown(filterKey, filterValue) {
    navigate('/leads', { state: { drillFilter: { key: filterKey, value: filterValue } } });
  }
  function drillPipeline(leads) {
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: leads.map(l => l.uniqueId) } } });
  }
  function drillCounselor(leads) {
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: leads.map(l => l.uniqueId) } } });
  }

  if (loading) return <div className="loading-center">Loading dashboard...</div>;

  const showPipeline = !isManager && !isAdmin;
  const showCounselor = isManager || isAdmin;
  const maxCounselorTotal = Math.max(...counselorData.map(d => d.total), 1);

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
          {(isManager || isAdmin) ? 'All leads' : `${staff?.fullName} — your assigned leads`}
        </span>
      </div>

      <div className="page-body">

        {/* ── Summary stat cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
          <StatCard label="Total Leads"    value={stats.total}     color="#6B7280" onClick={()=>navigate('/leads')}/>
          <StatCard label="Active"         value={stats.active}    color="#2563EB" onClick={()=>drillDown('leadStatus','active')}/>
          <StatCard label="Won"            value={stats.won}       color="#10B981" onClick={()=>drillDown('leadStatus','Won')}/>
          <StatCard label="New This Month" value={stats.thisMonth} color="#F59E0B" sub="created this month"/>
        </div>

        {/* ── Charts + pipeline row ── */}
        <div style={{ display:'grid', gridTemplateColumns: showPipeline ? '1fr 1fr 1fr 300px' : '1fr 1fr 1fr', gap:'1rem', marginBottom:'1.5rem' }}>

          {/* Stone chart */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Leads by Stone</span></div>
            <HBarChart data={stoneData} colorMap={STONE_COLORS} onBarClick={name => drillDown('stoneTier', name)}/>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
          </div>

          {/* Status chart */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Leads by Status</span></div>
            <HBarChart data={statusData} colorMap={STATUS_COLORS} onBarClick={name => drillDown('leadStatus', name)}/>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
          </div>

          {/* Source chart */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Leads by Source</span></div>
            <HBarChart data={sourceData} defaultColor={SOURCE_COLORS} onBarClick={name => drillDown('leadSource', name)}/>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.75rem' }}>Click a bar to view those leads</div>
          </div>

          {/* Pipeline — staff only */}
          {showPipeline && (
            <div className="section-card" style={{ maxHeight:'480px', overflowY:'auto' }}>
              <div className="section-header"><span className="section-title">Pipeline Statistics</span></div>
              <PipelineRow label="Target (Won this month)" count={myStaff?.target ?? '—'} isTarget color="var(--primary)" sub={myStaff?.targetSetBy ? `Set by ${myStaff.targetSetBy}` : 'Not set'}/>
              <PipelineRow label="Close this week"    count={pipeline.thisWeek.length}     color="#10B981" sub={`by Sunday ${getWeekEnd().toLocaleDateString()}`}     onClick={() => drillPipeline(pipeline.thisWeek)}/>
              <PipelineRow label="Close this month"   count={pipeline.thisMonth.length}    color="#2563EB" sub={`by ${getMonthEnd().toLocaleDateString()}`}            onClick={() => drillPipeline(pipeline.thisMonth)}/>
              <PipelineRow label="Close this quarter" count={pipeline.thisQuarter.length}  color="#8B5CF6" sub={`by ${getQuarterEnd().toLocaleDateString()}`}          onClick={() => drillPipeline(pipeline.thisQuarter)}/>
              <PipelineRow label="Rolling 3 months"   count={pipeline.rolling.length}      color="#F59E0B" sub="beyond quarter end"                                    onClick={() => drillPipeline(pipeline.rolling)}/>
              <PipelineRow label="Beyond 3 months"    count={pipeline.notProjected.length} color="#EF4444"                                                              onClick={() => drillPipeline(pipeline.notProjected)}/>
              <PipelineRow label="No close date"      count={pipeline.noCloseDate.length}  color="#9CA3AF"                                                              onClick={() => drillPipeline(pipeline.noCloseDate)}/>
            </div>
          )}
        </div>

        {/* ── Leads by Counselor — Admin & Manager only ── */}
        {showCounselor && (
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Leads by Counselor</span>
              <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                Click any segment to view those leads
              </span>
            </div>

            {/* Legend */}
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

            {/* Bars */}
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              {counselorData.map(({ counselor, stoneMap, total }) => {
                const barWidthPct = (total / maxCounselorTotal) * 100;
                return (
                  <div key={counselor} style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>

                    {/* Counselor name */}
                    <div style={{
                      width:'160px', flexShrink:0, textAlign:'right',
                      fontSize:'0.8125rem', fontWeight:500,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>
                      {counselor}
                    </div>

                    {/* Stacked bar */}
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
                              onClick={() => drillCounselor(arr)}
                              style={{
                                width:`${segPct}%`,
                                background: COUNSELOR_STONE_COLORS[stone],
                                display:'flex', alignItems:'center', justifyContent:'center',
                                cursor:'pointer', overflow:'hidden',
                                border: stone === 'Unscored' ? '1px solid #D1D5DB' : 'none',
                              }}
                              onMouseEnter={e => e.currentTarget.style.filter='brightness(0.85)'}
                              onMouseLeave={e => e.currentTarget.style.filter='none'}
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

                    {/* Total */}
                    <div
                      onClick={() => drillCounselor(Object.values(stoneMap).flat())}
                      style={{ width:'32px', flexShrink:0, fontSize:'0.875rem', fontWeight:700, cursor:'pointer' }}
                      title={`${counselor} — all ${total} leads`}
                    >
                      {total}
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Stone totals summary */}
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
        )}

      </div>
    </div>
  );
}
