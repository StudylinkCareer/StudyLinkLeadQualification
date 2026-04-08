// src/pages/Dashboard.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { studentAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Watermark from '../components/Watermark';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const STONE_COLORS = {
  Quartz:   '#9CA3AF',
  Agate:    '#78716C',
  Sapphire: '#2563EB',
  Ruby:     '#DC2626',
  Diamond:  '#8B5CF6',
};

const STATUS_COLORS = {
  'New':         '#6B7280',
  'Contacted':   '#3B82F6',
  'Qualified':   '#8B5CF6',
  'Proposal':    '#F59E0B',
  'Negotiation': '#F97316',
  'Won':         '#10B981',
  'Lost':        '#EF4444',
  'On Hold':     '#94A3B8',
};

const SOURCE_COLOR = '#2563EB';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      background:'var(--bg-primary)', border:'1px solid var(--border)',
      borderRadius:'10px', padding:'1rem 1.25rem',
      cursor: onClick ? 'pointer' : 'default',
      borderLeft: color ? `4px solid ${color}` : '1px solid var(--border)',
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

// ── Custom bar label ──────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:'var(--bg-primary)', border:'1px solid var(--border)',
      borderRadius:'8px', padding:'0.5rem 0.75rem', fontSize:'0.8125rem',
    }}>
      <div style={{ fontWeight:600 }}>{label}</div>
      <div style={{ color:'var(--primary)' }}>{payload[0].value} leads</div>
    </div>
  );
}

export default function Dashboard() {
  const [leads, setLeads]     = useState([]);
  const [loading, setLoading] = useState(true);
  const { staff, isManager }  = useAuth();
  const navigate              = useNavigate();

  useEffect(() => {
    studentAPI.search('').then(d => {
      setLeads(d.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // ── Scope leads by role ──────────────────────────────────────────────────
  const scopedLeads = useMemo(() => {
    if (isManager) return leads;
    // Non-managers only see leads where they are assigned in any role
    return leads.filter(l =>
      l.counselor       === staff?.fullName ||
      l.seniorCounselor === staff?.fullName ||
      l.presales        === staff?.fullName ||
      l.marketingStaff  === staff?.fullName
    );
  }, [leads, isManager, staff]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total    = scopedLeads.length;
    const won      = scopedLeads.filter(l => l.leadStatus === 'Won').length;
    const active   = scopedLeads.filter(l => !['Won','Lost'].includes(l.leadStatus)).length;
    const thisMonth = scopedLeads.filter(l => {
      if (!l.createdAt) return false;
      const d = new Date(l.createdAt);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { total, won, active, thisMonth };
  }, [scopedLeads]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const stoneData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => {
      const s = l.stoneTier || 'Unscored';
      counts[s] = (counts[s] || 0) + 1;
    });
    const order = ['Quartz','Agate','Sapphire','Ruby','Diamond','Unscored'];
    return order.filter(k => counts[k]).map(k => ({ name: k, count: counts[k] }));
  }, [scopedLeads]);

  const statusData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => {
      const s = l.leadStatus || 'New';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }))
      .sort((a,b) => b.count - a.count);
  }, [scopedLeads]);

  const sourceData = useMemo(() => {
    const counts = {};
    scopedLeads.forEach(l => {
      if (l.leadSource) counts[l.leadSource] = (counts[l.leadSource] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }))
      .sort((a,b) => b.count - a.count);
  }, [scopedLeads]);

  // ── Drill-down navigation ─────────────────────────────────────────────────
  function drillDown(filterKey, filterValue) {
    navigate('/leads', { state: { drillFilter: { key: filterKey, value: filterValue } } });
  }

  if (loading) return <div className="loading-center">Loading dashboard...</div>;

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
          {isManager ? 'All leads' : `Your assigned leads — ${staff?.fullName}`}
        </span>
      </div>

      <div className="page-body">

        {/* ── Stat cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'1rem', marginBottom:'1.5rem' }}>
          <StatCard label="Total Leads"    value={stats.total}    onClick={()=>navigate('/leads')}/>
          <StatCard label="Active"         value={stats.active}   color="#2563EB" onClick={()=>drillDown('leadStatus','active')}/>
          <StatCard label="Won"            value={stats.won}      color="#10B981" onClick={()=>drillDown('leadStatus','Won')}/>
          <StatCard label="This Month"     value={stats.thisMonth} color="#F59E0B" sub="new leads"/>
        </div>

        {/* ── Charts row ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>

          {/* Stone chart */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Leads by Stone</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stoneData} margin={{ top:4, right:8, bottom:4, left:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:11 }} />
                <YAxis tick={{ fontSize:11 }} allowDecimals={false}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Bar dataKey="count" radius={[4,4,0,0]} cursor="pointer"
                  onClick={d => drillDown('stoneTier', d.name)}>
                  {stoneData.map(entry => (
                    <Cell key={entry.name} fill={STONE_COLORS[entry.name] || '#9CA3AF'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.25rem' }}>
              Click a bar to view those leads
            </div>
          </div>

          {/* Status chart */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Leads by Status</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={statusData} margin={{ top:4, right:8, bottom:4, left:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:10 }} interval={0} angle={-20} textAnchor="end" height={40}/>
                <YAxis tick={{ fontSize:11 }} allowDecimals={false}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Bar dataKey="count" radius={[4,4,0,0]} cursor="pointer"
                  onClick={d => drillDown('leadStatus', d.name)}>
                  {statusData.map(entry => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6B7280'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.25rem' }}>
              Click a bar to view those leads
            </div>
          </div>

          {/* Source chart */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Leads by Source</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sourceData} margin={{ top:4, right:8, bottom:4, left:0 }}>
                <XAxis dataKey="name" tick={{ fontSize:10 }} interval={0} angle={-20} textAnchor="end" height={40}/>
                <YAxis tick={{ fontSize:11 }} allowDecimals={false}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Bar dataKey="count" fill={SOURCE_COLOR} radius={[4,4,0,0]} cursor="pointer"
                  onClick={d => drillDown('leadSource', d.name)}/>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', textAlign:'center', marginTop:'0.25rem' }}>
              Click a bar to view those leads
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
