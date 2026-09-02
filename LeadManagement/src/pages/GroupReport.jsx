// src/pages/GroupReport.jsx
// -----------------------------------------------------------------------------
// Company-wide performance over a weekly/monthly/yearly/custom period.
// Successor to Monthly Report (2026-08 Weekly/Monthly Report merge, planned
// with Hong Ha). Hidden entirely from lower-level staff (server 403s;
// nav-hidden too, see Sidebar.jsx).
//
// V1 SCOPE: Team Performance (Counsellors) and Pre-sales tables cover
// Contracted/Reversed/New/Ongoing/KBM/Total calls/Target/%KPI/Letters/
// Meetings/case-type split/In-Out system/Convert %/Total leads/New this
// period per person, plus a Contract Sources table + pie chart — all reused
// from rangeReport.js (same logic as old Monthly Report's
// resolveContractSourceLabel, generalized past a calendar month). Case-type/
// In-Out/Convert % only apply to Counsellors (same as old Monthly Report —
// Pre-sales rows carry these as null, columns omitted for that table).
// Marketing Activities (funnel by event, cost planned/actual) is the one
// remaining deliberate follow-up, not yet ported — flagged in-page.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI } from '../services/api';
import { KpiTiles, DrillPanel } from '../components/reports/KpiTiles';
import PeriodPicker from '../components/reports/PeriodPicker';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const th = { textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary,#6b7280)', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
const CASE_TYPES = ['Du học', 'Du học hè', 'Thị thực Du lịch', 'Thị thực Khác'];
const PIE_COLORS = ['#2563eb', '#8b5cf6', '#f59e0b', '#10B981', '#DC2626', '#0891B2', '#D97706'];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// showCounselorCols: case-type split / In-Out system / Convert % / Total
// leads / New this period only apply to Counsellors (same as old Monthly
// Report) — Pre-sales table omits these columns entirely rather than
// showing an all-blank set.
function StaffTable({ title, rows, showCounselorCols, L }) {
  const totals = rows.reduce((a, r) => ({
    contracted: a.contracted + r.contracted, reversed: a.reversed + r.reversed,
    newLeads: a.newLeads + r.newLeads, ongoing: a.ongoing + r.ongoing, kbm: a.kbm + r.kbm,
    totalCalls: a.totalCalls + r.totalCalls, target: a.target + (r.target || 0),
    basicLetters: a.basicLetters + r.basicLetters,
    finalLetters: a.finalLetters + r.finalLetters, meetings: a.meetings + r.meetings,
    inSystemCount: a.inSystemCount + (r.inSystemCount || 0), outSystemCount: a.outSystemCount + (r.outSystemCount || 0),
    totalLeads: a.totalLeads + (r.totalLeads || 0), newThisPeriod: a.newThisPeriod + (r.newThisPeriod || 0),
  }), { contracted: 0, reversed: 0, newLeads: 0, ongoing: 0, kbm: 0, totalCalls: 0, target: 0, basicLetters: 0, finalLetters: 0, meetings: 0, inSystemCount: 0, outSystemCount: 0, totalLeads: 0, newThisPeriod: 0 });
  const pct = (actual, target) => target > 0 ? `${Math.round((actual / target) * 100)}%` : '—';

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: showCounselorCols ? 1180 : 800 }}>
          <thead><tr>
            <th style={th}>{L('Staff', 'Nhân viên')}</th>
            {showCounselorCols && <th style={{ ...th, textAlign: 'right' }}>{L('Total leads', 'Tổng lead')}</th>}
            {showCounselorCols && <th style={{ ...th, textAlign: 'right' }}>{L('New this period', 'Mới trong kỳ')}</th>}
            <th style={{ ...th, textAlign: 'right' }}>{L('Contracted', 'Ký HĐ')}</th>
            {showCounselorCols && <th style={{ ...th, textAlign: 'right' }}>{L('Convert %', '% Convert')}</th>}
            {showCounselorCols && <th style={{ ...th, textAlign: 'right' }}>{L('In system', 'Trong hệ thống')}</th>}
            {showCounselorCols && <th style={{ ...th, textAlign: 'right' }}>{L('Out system', 'Ngoài hệ thống')}</th>}
            {showCounselorCols && CASE_TYPES.map(t => <th key={t} style={{ ...th, textAlign: 'right' }}>{t}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>{L('Reversed', 'Hủy')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('New', 'Mới')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Ongoing', 'Theo dõi')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Total calls', 'Tổng cuộc gọi')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Target', 'Chỉ tiêu')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('% KPI', '% KPI')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('KBM', 'KBM')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Basic Ltr', 'Thư CB')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Final Ltr', 'Thư cuối')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Meetings', 'Cuộc gặp')}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.fullName}>
                <td style={{ ...td, fontWeight: 600 }}>{r.fullName}</td>
                {showCounselorCols && <td style={{ ...td, textAlign: 'right' }}>{r.totalLeads}</td>}
                {showCounselorCols && <td style={{ ...td, textAlign: 'right' }}>{r.newThisPeriod}</td>}
                <td style={{ ...td, textAlign: 'right' }}>{r.contracted}</td>
                {showCounselorCols && <td style={{ ...td, textAlign: 'right' }}>{r.convertPct != null ? `${r.convertPct}%` : '—'}</td>}
                {showCounselorCols && <td style={{ ...td, textAlign: 'right' }}>{r.inSystemCount}</td>}
                {showCounselorCols && <td style={{ ...td, textAlign: 'right' }}>{r.outSystemCount}</td>}
                {showCounselorCols && CASE_TYPES.map(t => <td key={t} style={{ ...td, textAlign: 'right' }}>{r.caseTypeBreakdown?.[t] || 0}</td>)}
                <td style={{ ...td, textAlign: 'right', color: r.reversed > 0 ? '#DC2626' : 'inherit' }}>{r.reversed}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.newLeads}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.ongoing}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{r.totalCalls}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary,#9ca3af)' }}>{r.target}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: r.totalCalls >= r.target ? '#10B981' : '#DC2626' }}>{pct(r.totalCalls, r.target)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.kbm}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.basicLetters}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.finalLetters}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.meetings}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={showCounselorCols ? 17 : 9} style={{ ...td, color: 'var(--text-secondary,#9ca3af)' }}>{L('No staff in this group.', 'Không có nhân viên.')}</td></tr>}
            <tr style={{ background: 'var(--bg-secondary,#f8fafc)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{L('Total', 'Tổng')}</td>
              {showCounselorCols && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.totalLeads}</td>}
              {showCounselorCols && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.newThisPeriod}</td>}
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.contracted}</td>
              {showCounselorCols && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.totalLeads > 0 ? `${Math.round((totals.contracted / totals.totalLeads) * 1000) / 10}%` : '—'}</td>}
              {showCounselorCols && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.inSystemCount}</td>}
              {showCounselorCols && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.outSystemCount}</td>}
              {showCounselorCols && CASE_TYPES.map(t => (
                <td key={t} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{rows.reduce((s, r) => s + (r.caseTypeBreakdown?.[t] || 0), 0)}</td>
              ))}
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.reversed}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.newLeads}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.ongoing}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.totalCalls}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.target}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{pct(totals.totalCalls, totals.target)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.kbm}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.basicLetters}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.finalLetters}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.meetings}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Contract Sources — table + pie chart. Capped to the top 7 sources (+
// "Other") for the pie, same cap Monthly Report used, so a long tail of
// one-off sources doesn't turn the chart illegible.
function ContractSources({ sources, L }) {
  if (!sources || sources.length === 0) return null;
  const total = sources.reduce((s, r) => s + r.count, 0);
  const top = sources.slice(0, 7);
  const restCount = sources.slice(7).reduce((s, r) => s + r.count, 0);
  const pieData = restCount > 0 ? [...top, { source: L('Other', 'Khác'), count: restCount }] : top;

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('Contract Sources', 'Nguồn HĐ')}</div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>{L('Source', 'Nguồn')}</th><th style={{ ...th, textAlign: 'right' }}>{L('Contracts', 'Hợp đồng')}</th></tr></thead>
            <tbody>
              {sources.map(r => (
                <tr key={r.source}>
                  <td style={td}>{r.source}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.count}</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--bg-secondary,#f8fafc)' }}>
                <td style={{ ...td, fontWeight: 700 }}>{L('Total', 'Tổng')}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 240, height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={90} label={({ source, percent }) => `${source} ${(percent * 100).toFixed(0)}%`}>
                {pieData.map((entry, i) => <Cell key={entry.source} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function GroupReport() {
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const [periodVal, setPeriodVal] = useState({ period: 'monthly', month: currentMonth() });
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [drill, setDrill]     = useState(null);

  useEffect(() => { pushTrail && pushTrail({ label: L('Company Report', 'Báo cáo công ty') }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    setLoading(true); setError(null);
    reportsAPI.groupReport(periodVal)
      .then(r => setData(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [periodVal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}><div style={card}>{error}</div></div>;

  const cw = data?.companyWide;
  const metrics = cw ? [
    { key: 'contracted', label: L('Contracted', 'Ký HĐ'), value: cw.contracted.count, color: '#10B981', cols: [{ key: 'fullName', label: 'Name' }], items: cw.contracted.items },
    { key: 'reversed', label: L('Reversed', 'Hủy sau ký'), value: cw.reversed.count, color: '#DC2626', cols: [{ key: 'fullName', label: 'Name' }], items: cw.reversed.items },
    { key: 'newLeads', label: L('New calls', 'Cuộc gọi Mới'), value: cw.calls.totals.newLeads, color: '#8b5cf6', items: [] },
    { key: 'ongoing', label: L('Ongoing calls', 'Cuộc gọi theo dõi'), value: cw.calls.totals.ongoing, color: '#8b5cf6', items: [] },
    { key: 'kbm', label: L('KBM (unanswered)', 'Không bắt máy'), value: cw.calls.totals.kbm, color: '#DC2626', items: [] },
    { key: 'letters', label: L('Counselling Letters', 'Thư tư vấn'), value: cw.basicLetters.count + cw.finalLetters.count, color: '#f59e0b', items: [] },
    { key: 'meetings', label: L('Meetings', 'Cuộc gặp'), value: cw.meetings.count, color: '#2563eb', cols: [{ key: 'fullName', label: 'Name' }, { key: 'topic', label: L('Type', 'Loại') }], items: cw.meetings.items },
  ] : [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{L('Company Report', 'Báo cáo công ty')}</h1>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary,#6b7280)' }}>
            {data ? `${new Date(data.from).toLocaleDateString()} – ${new Date(new Date(data.to).getTime() - 1).toLocaleDateString()}` : ''}
          </div>
        </div>
        <PeriodPicker value={periodVal} onChange={setPeriodVal} L={L} />
      </div>

      {loading && !data && <div style={card}>{L('Loading…', 'Đang tải…')}</div>}

      {data && (
        <>
          <div style={card}><KpiTiles metrics={metrics} onOpen={setDrill} /></div>
          <StaffTable title={L('Team Performance (Counsellors)', 'Hiệu suất đội (Tư vấn viên)')} rows={data.teamPerformance} showCounselorCols L={L} />
          <StaffTable title={L('Pre-sales', 'Pre-sales')} rows={data.presales} showCounselorCols={false} L={L} />
          <ContractSources sources={cw?.contractSources} L={L} />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#9ca3af)', marginTop: '-0.5rem' }}>
            {L(
              'v1: Marketing Activities (funnel by event, cost planned/actual) from the old Monthly Report is not yet ported here — follow-up.',
              'v1: chưa đưa Hoạt động Marketing (phễu theo sự kiện, chi phí dự kiến/thực tế) từ Báo cáo tháng cũ sang — sẽ bổ sung sau.'
            )}
          </div>
        </>
      )}

      <DrillPanel drill={drill} onClose={() => setDrill(null)} L={L} />
    </div>
  );
}
