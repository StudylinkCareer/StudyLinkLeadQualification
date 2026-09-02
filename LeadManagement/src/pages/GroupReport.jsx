// src/pages/GroupReport.jsx
// -----------------------------------------------------------------------------
// Company-wide performance over a weekly/monthly/yearly/custom period.
// Successor to Monthly Report (2026-08 Weekly/Monthly Report merge, planned
// with Hong Ha). Hidden entirely from lower-level staff (server 403s;
// nav-hidden too, see Sidebar.jsx).
//
// Team Performance / Telesales / Pre-sales are three separate tables, same
// split as the original Monthly Report (2026-09: restored after an earlier
// pass wrongly merged Team Performance + Telesales into one table — see
// reportController.js's groupReport comment). Team Performance carries
// sales/contract OUTCOME metrics (Total leads, Contracted, Convert %, In/
// Out system, case-type split, the real contract-SIGNING target from
// monthly_targets); Telesales and Pre-sales carry calls ACTIVITY metrics
// (New/Ongoing/Total calls, the calls-volume target from Phase 0's
// redesigned quota mechanism, KBM) — genuinely different "target" concepts,
// kept in separate tables/columns rather than one ambiguous column.
//
// Pre-sales' "Transferred to Sales" column (audit-log based handoffs to a
// counsellor) and Marketing Activities (funnel by event, planned/actual
// cost) are both ported from the old Monthly Report as of 2026-09.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI } from '../services/api';
import { DrillPanel } from '../components/reports/KpiTiles';
import BarChartCard from '../components/reports/BarChartCard';
import PeriodPicker from '../components/reports/PeriodPicker';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const th = { textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary,#6b7280)', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
const CASE_TYPES = ['Du học', 'Du học hè', 'Thị thực Du lịch', 'Thị thực Khác'];
const PIE_COLORS = ['#2563eb', '#8b5cf6', '#f59e0b', '#10B981', '#DC2626', '#0891B2', '#D97706'];
const pct = (actual, target) => (target > 0 ? `${Math.round((actual / target) * 100)}%` : '—');

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Sales/contract OUTCOME metrics — same columns as old Monthly Report's
// Team Performance table, plus the real contract-signing Target (a value
// per calendar month; shows "—" for weekly/custom periods that don't line
// up with whole months, rather than a fabricated prorated guess — see
// rangeReport.js's contractTargetForRange).
function TeamPerformanceTable({ rows, L }) {
  const totals = rows.reduce((a, r) => ({
    totalLeads: a.totalLeads + r.totalLeads, newThisPeriod: a.newThisPeriod + r.newThisPeriod,
    contracted: a.contracted + r.contracted, reversed: a.reversed + r.reversed,
    inSystemCount: a.inSystemCount + r.inSystemCount, outSystemCount: a.outSystemCount + r.outSystemCount,
    target: a.target + (r.target || 0), basicLetters: a.basicLetters + r.basicLetters, finalLetters: a.finalLetters + r.finalLetters,
  }), { totalLeads: 0, newThisPeriod: 0, contracted: 0, reversed: 0, inSystemCount: 0, outSystemCount: 0, target: 0, basicLetters: 0, finalLetters: 0 });
  const anyTarget = rows.some(r => r.target != null);

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('Team Performance (Counsellors)', 'Hiệu suất đội (Tư vấn viên)')}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
          <thead><tr>
            <th style={th}>{L('Staff', 'Nhân viên')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Total leads', 'Tổng lead')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('New this period', 'Mới trong kỳ')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Contracted', 'Ký HĐ')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Target', 'Chỉ tiêu')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Convert %', '% Convert')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('In system', 'Trong hệ thống')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Out system', 'Ngoài hệ thống')}</th>
            {CASE_TYPES.map(t => <th key={t} style={{ ...th, textAlign: 'right' }}>{t}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>{L('Reversed', 'Hủy')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Basic Ltr', 'Thư CB')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Final Ltr', 'Thư cuối')}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.fullName}>
                <td style={{ ...td, fontWeight: 600 }}>{r.fullName}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.totalLeads}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.newThisPeriod}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{r.contracted}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary,#9ca3af)' }} title={r.target == null ? L('Contract target is monthly — not shown for this period type', 'Chỉ tiêu hợp đồng theo tháng — không hiển thị cho loại kỳ này') : ''}>
                  {r.target ?? '—'}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{r.convertPct != null ? `${r.convertPct}%` : '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.inSystemCount}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.outSystemCount}</td>
                {CASE_TYPES.map(t => <td key={t} style={{ ...td, textAlign: 'right' }}>{r.caseTypeBreakdown?.[t] || 0}</td>)}
                <td style={{ ...td, textAlign: 'right', color: r.reversed > 0 ? '#DC2626' : 'inherit' }}>{r.reversed}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.basicLetters}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.finalLetters}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13} style={{ ...td, color: 'var(--text-secondary,#9ca3af)' }}>{L('No staff in this group.', 'Không có nhân viên.')}</td></tr>}
            <tr style={{ background: 'var(--bg-secondary,#f8fafc)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{L('Total', 'Tổng')}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.totalLeads}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.newThisPeriod}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.contracted}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{anyTarget ? totals.target : '—'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.totalLeads > 0 ? `${Math.round((totals.contracted / totals.totalLeads) * 1000) / 10}%` : '—'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.inSystemCount}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.outSystemCount}</td>
              {CASE_TYPES.map(t => <td key={t} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{rows.reduce((s, r) => s + (r.caseTypeBreakdown?.[t] || 0), 0)}</td>)}
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.reversed}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.basicLetters}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.finalLetters}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Calls ACTIVITY metrics — shared shape for Telesales (Counsellors) and
// Pre-sales, same as old Monthly Report ("mirroring Pre-Sales exactly" was
// the whole reason Telesales was split out of Team Performance in the first
// place). `showTransferred` adds Pre-sales' "Transferred to Sales" column
// (audit-log-based handoffs to a counsellor, see rangeReport.js's
// transfersToSalesForRange) — clickable per row, opens the transferred
// leads' detail (destination, who received them, when) via `onOpen`.
function CallsTable({ title, rows, showMeetings, showTransferred, onOpen, L }) {
  const totals = rows.reduce((a, r) => ({
    newLeads: a.newLeads + r.newLeads, ongoing: a.ongoing + r.ongoing, kbm: a.kbm + r.kbm,
    totalCalls: a.totalCalls + r.totalCalls, target: a.target + (r.target || 0),
    meetings: a.meetings + (r.meetings || 0), transferred: a.transferred + (r.transferred || 0),
  }), { newLeads: 0, ongoing: 0, kbm: 0, totalCalls: 0, target: 0, meetings: 0, transferred: 0 });
  const colCount = 7 + (showMeetings ? 1 : 0) + (showTransferred ? 1 : 0);

  function openTransferred(r) {
    const items = (r.transferredItems || []).map(it => ({ ...it, transferredAtDisplay: it.transferredAt ? new Date(it.transferredAt).toLocaleDateString() : '' }));
    onOpen({
      title: L('Transferred to Sales', 'Khách chuyển') + ` — ${r.fullName}`,
      cols: [
        { key: 'fullName', label: L('Name', 'Tên') },
        { key: 'destinationCountry', label: L('Destination', 'Điểm đến') },
        { key: 'receivedBy', label: L('Received by', 'Người nhận') },
        { key: 'transferredAtDisplay', label: L('Date', 'Ngày') },
      ],
      items,
    });
  }

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead><tr>
            <th style={th}>{L('Staff', 'Nhân viên')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('New', 'Mới')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Ongoing', 'Theo dõi')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Total calls', 'Tổng cuộc gọi')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Target', 'Chỉ tiêu')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('% KPI', '% KPI')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('KBM', 'KBM')}</th>
            {showMeetings && <th style={{ ...th, textAlign: 'right' }}>{L('Meetings', 'Cuộc gặp')}</th>}
            {showTransferred && <th style={{ ...th, textAlign: 'right' }}>{L('Transferred', 'Khách chuyển')}</th>}
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const clickable = showTransferred && (r.transferred || 0) > 0;
              return (
                <tr key={r.fullName}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.fullName}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.newLeads}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.ongoing}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{r.totalCalls}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-secondary,#9ca3af)' }}>{r.target}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: r.totalCalls >= r.target ? '#10B981' : '#DC2626' }}>{pct(r.totalCalls, r.target)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.kbm}</td>
                  {showMeetings && <td style={{ ...td, textAlign: 'right' }}>{r.meetings}</td>}
                  {showTransferred && (
                    <td style={{ ...td, textAlign: 'right', cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline' : 'none' }}
                      onClick={clickable ? () => openTransferred(r) : undefined}>
                      {r.transferred || 0}
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={colCount} style={{ ...td, color: 'var(--text-secondary,#9ca3af)' }}>{L('No staff in this group.', 'Không có nhân viên.')}</td></tr>}
            <tr style={{ background: 'var(--bg-secondary,#f8fafc)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{L('Total', 'Tổng')}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.newLeads}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.ongoing}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.totalCalls}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.target}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{pct(totals.totalCalls, totals.target)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.kbm}</td>
              {showMeetings && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.meetings}</td>}
              {showTransferred && <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.transferred}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Marketing Activities — funnel by event (lead count, status breakdown,
// budget planned/actual), same shape as old Monthly Report's marketing
// section. Reuses the Event Report budget ledger as-is (see rangeReport.js's
// marketingActivitiesForRange). VND figures, unformatted (matches how the
// rest of this app displays currency — no existing shared formatter).
function MarketingActivities({ activities, L }) {
  if (!activities) return null;
  const vnd = (n) => (n == null ? '—' : `${n.toLocaleString()}₫`);
  const totals = activities.reduce((a, r) => ({
    leadCount: a.leadCount + r.leadCount,
    totalCostPlanned: a.totalCostPlanned + (r.totalCostPlanned || 0),
    totalCostActual: a.totalCostActual + (r.totalCostActual || 0),
  }), { leadCount: 0, totalCostPlanned: 0, totalCostActual: 0 });

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('Marketing Activities', 'Hoạt động Marketing')}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr>
            <th style={th}>{L('Event', 'Sự kiện')}</th>
            <th style={th}>{L('Type', 'Loại')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Leads', 'Lead')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Contracted', 'Ký HĐ')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Cost (planned)', 'Chi phí (dự kiến)')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{L('Cost (actual)', 'Chi phí (thực tế)')}</th>
          </tr></thead>
          <tbody>
            {activities.map(a => (
              <tr key={a.eventId}>
                <td style={{ ...td, fontWeight: 600 }}>{a.name}</td>
                <td style={td}>{a.eventType || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{a.leadCount}</td>
                <td style={{ ...td, textAlign: 'right' }}>{a.byStatus?.['Contracted'] || 0}</td>
                <td style={{ ...td, textAlign: 'right' }}>{vnd(a.totalCostPlanned)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{vnd(a.totalCostActual)}</td>
              </tr>
            ))}
            {activities.length === 0 && <tr><td colSpan={6} style={{ ...td, color: 'var(--text-secondary,#9ca3af)' }}>{L('No marketing events in this period.', 'Không có sự kiện marketing trong kỳ.')}</td></tr>}
            <tr style={{ background: 'var(--bg-secondary,#f8fafc)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{L('Total', 'Tổng')}</td>
              <td style={td} />
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.leadCount}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{activities.reduce((s, a) => s + (a.byStatus?.['Contracted'] || 0), 0)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{vnd(totals.totalCostPlanned)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{vnd(totals.totalCostActual)}</td>
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
  // Same grouped bar-chart-card language as Individual Report (2026-09,
  // explicit request), applied company-wide instead of per-person.
  const contractedBars = cw ? [
    { key: 'contracted', label: L('Contracted', 'Ký HĐ'), value: cw.contracted.count, color: '#10B981', cols: [{ key: 'fullName', label: 'Name' }], items: cw.contracted.items },
    { key: 'reversed', label: L('Reversed', 'Hủy sau ký'), value: cw.reversed.count, color: '#DC2626', cols: [{ key: 'fullName', label: 'Name' }], items: cw.reversed.items },
  ] : [];
  const lettersBars = cw ? [
    { key: 'basic', label: L('Basic', 'Cơ bản'), value: cw.basicLetters.count, color: '#f59e0b', cols: [{ key: 'fullName', label: 'Name' }], items: cw.basicLetters.items },
    { key: 'final', label: L('Final', 'Cuối'), value: cw.finalLetters.count, color: '#f59e0b', cols: [{ key: 'fullName', label: 'Name' }], items: cw.finalLetters.items },
  ] : [];
  const callsBars = cw ? [
    { key: 'new', label: L('New', 'Mới'), value: cw.calls.totals.newLeads, color: '#8b5cf6' },
    { key: 'ongoing', label: L('Ongoing', 'Theo dõi'), value: cw.calls.totals.ongoing, color: '#8b5cf6' },
    { key: 'kbm', label: L('KBM (unanswered)', 'Không bắt máy'), value: cw.calls.totals.kbm, color: '#f59e0b' },
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ ...card, flex: '1 1 260px' }}><BarChartCard title={L('Contracted', 'Ký HĐ')} subtitle={L('company-wide', 'toàn công ty')} bars={contractedBars} onOpen={setDrill} /></div>
            <div style={{ ...card, flex: '1 1 200px' }}><BarChartCard title={L('Counselling Letters', 'Thư tư vấn')} bars={lettersBars} onOpen={setDrill} /></div>
            <div style={{ ...card, flex: '1 1 320px' }}><BarChartCard title={L('Calls', 'Cuộc gọi')} bars={callsBars} onOpen={setDrill} /></div>
          </div>
          <TeamPerformanceTable rows={data.teamPerformance} L={L} />
          <CallsTable title={L('Telesales (Counsellors)', 'Telesales (Tư vấn viên)')} rows={data.telesales} showMeetings={false} L={L} />
          <CallsTable
            title={L('Pre-sales', 'Pre-sales')}
            rows={data.presales}
            showMeetings
            showTransferred
            onOpen={setDrill}
            L={L}
          />
          <ContractSources sources={cw?.contractSources} L={L} />
          <MarketingActivities activities={data.marketingActivities} L={L} />
        </>
      )}

      <DrillPanel drill={drill} onClose={() => setDrill(null)} L={L} />
    </div>
  );
}
