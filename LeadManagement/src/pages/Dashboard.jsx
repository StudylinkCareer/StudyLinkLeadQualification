// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { studentAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function BarChart({ title, data, max }) {
  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      <div className="bar-chart">
        {data.map(({ label, count }) => (
          <div className="bar-row" key={label}>
            <div className="bar-label" title={label}>{label || '—'}</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: max > 0 ? `${(count / max) * 100}%` : '0%' }}
              />
            </div>
            <div className="bar-count">{count}</div>
          </div>
        ))}
        {data.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No data yet</div>
        )}
      </div>
    </div>
  );
}

function getLeadAge(createdAt) {
  if (!createdAt) return null;
  const days = Math.floor((Date.now() - new Date(createdAt)) / (1000 * 60 * 60 * 24));
  return days;
}

export default function Dashboard() {
  const [leads, setLeads]     = useState([]);
  const [loading, setLoading] = useState(true);
  const { staff }             = useAuth();

  useEffect(() => {
    studentAPI.search('')
      .then(data => setLeads(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-center">Loading dashboard...</div>;

  // ── Compute stats ──
  const total = leads.length;

  const byStatus = {};
  const byCounselor = {};
  const byTier = {};
  let totalAge = 0;
  let ageCount = 0;

  leads.forEach(l => {
    const status = l.lead_status || l.leadStatus || 'New';
    byStatus[status] = (byStatus[status] || 0) + 1;

    const counselor = l.counselor || 'Unassigned';
    byCounselor[counselor] = (byCounselor[counselor] || 0) + 1;

    const tier = l.stone_tier || l.stoneTier || 'Unscored';
    byTier[tier] = (byTier[tier] || 0) + 1;

    const age = getLeadAge(l.created_at || l.createdAt);
    if (age !== null) { totalAge += age; ageCount++; }
  });

  const avgAge = ageCount > 0 ? Math.round(totalAge / ageCount) : 0;

  const statusData    = Object.entries(byStatus).map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count);
  const counselorData = Object.entries(byCounselor).map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count).slice(0, 8);
  const tierData      = Object.entries(byTier).map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count);

  const maxStatus    = Math.max(...statusData.map(d => d.count), 1);
  const maxCounselor = Math.max(...counselorData.map(d => d.count), 1);
  const maxTier      = Math.max(...tierData.map(d => d.count), 1);

  const wonCount  = byStatus['Won']  || 0;
  const lostCount = byStatus['Lost'] || 0;
  const convRate  = total > 0 ? Math.round((wonCount / total) * 100) : 0;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Welcome, {staff?.fullName}
        </span>
      </div>

      <div className="page-body">
        <div className="stats-grid">
          <StatCard label="Total Leads"      value={total}      sub="all time" />
          <StatCard label="Won"              value={wonCount}   sub={`${convRate}% conversion`} />
          <StatCard label="Lost"             value={lostCount}  />
          <StatCard label="Avg Lead Age"     value={`${avgAge}d`} sub="days since created" />
        </div>

        <div className="charts-grid">
          <BarChart title="Leads by Status"    data={statusData}    max={maxStatus} />
          <BarChart title="Leads by Counselor" data={counselorData} max={maxCounselor} />
        </div>

        <div className="charts-grid">
          <BarChart title="Leads by Stone Tier" data={tierData} max={maxTier} />
        </div>
      </div>
    </div>
  );
}
