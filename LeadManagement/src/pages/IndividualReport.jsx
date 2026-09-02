// src/pages/IndividualReport.jsx
// -----------------------------------------------------------------------------
// One staffer's performance over a weekly/monthly/yearly/custom period.
// Successor to Weekly Report's individual mode (2026-08 Weekly/Monthly
// Report merge, planned with Hong Ha) — see SUPPORT_HANDOVER_SPEC / the
// plan file for full background. V1: own-only for lower-level staff,
// any-staffer for managers/CEO/COO (server-enforced via
// canPickAnyStaff/staffOptions on the response — this page trusts the
// server, no client-side role logic duplicated here).
//
// Contracted is a single period-scoped figure (+ reversed), not the old
// Weekly Report's fixed 5-tile last-week/MTD/QTD/YTD row — selecting
// Monthly/Yearly as the period now does what MTD/YTD used to approximate.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { KpiTiles, DrillPanel } from '../components/reports/KpiTiles';
import PeriodPicker from '../components/reports/PeriodPicker';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const th = { textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary,#6b7280)', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
const NAME_COL = { key: 'fullName', label: 'Name' };
const MODES = ['E-mail', 'Phone call', 'SMS', 'Zalo', 'WhatsApp', 'Messenger'];

function mondayOf(d) {
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - dow);
  return mon.toISOString().slice(0, 10);
}

function bucketLabel(granularity, L) {
  return granularity === 'day' ? L('Day', 'Ngày') : granularity === 'week' ? L('Week of', 'Tuần') : L('Month', 'Tháng');
}

// "Calls by day/week/month" — actual vs target, role-aware: Counsellors keep
// a New/Ongoing split (role-wide day-of-week grid); Pre-Sales is a single
// combined Total/Target column (per-individual hours x 8, no split — see
// Phase 0's redesigned quota mechanism). Successor to Weekly Report's ByDay
// table, generalized past exactly 7 days. Uses callTarget.byBucket as the
// spine when available (covers every day in range, even at 0), so the table
// never has gaps — falls back to calls.byBucket alone when the staffer is
// neither a Counsellor nor Pre-Sales (no target concept applies).
function CallsByBucket({ data, L }) {
  const actualByKey = new Map(data.calls.byBucket.map(b => [b.bucket, b]));
  const targetByKey = new Map((data.callTarget?.byBucket || []).map(b => [b.bucket, b]));
  const keys = data.callTarget ? [...targetByKey.keys()].sort() : data.calls.byBucket.map(b => b.bucket);
  if (keys.length === 0) return null;
  const isCounselor = data.role === 'Counselor';

  const rows = keys.map(k => {
    const a = actualByKey.get(k) || { newLeads: 0, ongoing: 0 };
    const t = targetByKey.get(k);
    return {
      bucket: k, newLeads: a.newLeads, ongoing: a.ongoing, total: a.newLeads + a.ongoing,
      targetNew: t?.new, targetOngoing: t?.ongoing, target: isCounselor ? (t ? t.new + t.ongoing : undefined) : t?.total,
    };
  });

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('Calls by ', 'Cuộc gọi theo ') + bucketLabel(data.calls.bucket, L).toLowerCase()}</div>
      <div style={{ height: 220, marginBottom: '1rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border,#e5e7eb)" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            {isCounselor ? (
              <>
                <Bar dataKey="newLeads" name={L('New', 'Mới')} fill="#8b5cf6" />
                <Bar dataKey="ongoing" name={L('Ongoing', 'Theo dõi')} fill="#c4b5fd" />
                <Bar dataKey="target" name={L('Target', 'Chỉ tiêu')} fill="#e5e7eb" />
              </>
            ) : (
              <>
                <Bar dataKey="total" name={L('Actual', 'Thực tế')} fill="#8b5cf6" />
                <Bar dataKey="target" name={L('Target', 'Chỉ tiêu')} fill="#e5e7eb" />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>{bucketLabel(data.calls.bucket, L)}</th>
            {isCounselor ? (
              <>
                <th style={{ ...th, textAlign: 'right' }}>{L('New / target', 'Mới / MT')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{L('Ongoing / target', 'Theo dõi / MT')}</th>
              </>
            ) : (
              <th style={{ ...th, textAlign: 'right' }}>{L('Total / target', 'Tổng / MT')}</th>
            )}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.bucket}>
                <td style={td}>{r.bucket}</td>
                {isCounselor ? (
                  <>
                    <td style={{ ...td, textAlign: 'right', color: r.targetNew != null ? (r.newLeads >= r.targetNew ? '#10B981' : '#DC2626') : 'inherit' }}>
                      {r.newLeads}{r.targetNew != null ? ` / ${r.targetNew}` : ''}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: r.targetOngoing != null ? (r.ongoing >= r.targetOngoing ? '#10B981' : '#DC2626') : 'inherit' }}>
                      {r.ongoing}{r.targetOngoing != null ? ` / ${r.targetOngoing}` : ''}
                    </td>
                  </>
                ) : (
                  <td style={{ ...td, textAlign: 'right', color: r.target != null ? (r.total >= r.target ? '#10B981' : '#DC2626') : 'inherit' }}>
                    {r.total}{r.target != null ? ` / ${r.target}` : ''}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "Breakdown by contact mode" — bucket x platform matrix. Successor to
// Weekly Report's ByModeMatrix, generalized past exactly 7 days.
function ModeMatrix({ data, L }) {
  const grid = data.calls.modeByBucket || [];
  if (grid.length === 0) return null;
  const extra = new Set();
  grid.forEach(d => Object.keys(d.byMode || {}).forEach(k => { if (!MODES.includes(k)) extra.add(k); }));
  const cols = [...MODES, ...extra];
  const modeTotals = {}; cols.forEach(c => { modeTotals[c] = 0; });
  let grand = 0;
  const rows = grid.map(d => {
    let rowTotal = 0;
    const cells = cols.map(c => { const v = (d.byMode && d.byMode[c]) || 0; modeTotals[c] += v; rowTotal += v; return v; });
    grand += rowTotal;
    return { bucket: d.bucket, cells, rowTotal };
  });

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('Breakdown by contact mode', 'Phân tích theo kênh liên hệ')}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead><tr>
            <th style={th}>{bucketLabel(data.calls.bucket, L)}</th>
            {cols.map(c => <th key={c} style={{ ...th, textAlign: 'right' }}>{c}</th>)}
            <th style={{ ...th, textAlign: 'right', color: 'var(--primary,#2563eb)' }}>{L('Total', 'Tổng')}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.bucket}>
                <td style={td}>{r.bucket}</td>
                {r.cells.map((v, i) => <td key={cols[i]} style={{ ...td, textAlign: 'right' }}>{v}</td>)}
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{r.rowTotal}</td>
              </tr>
            ))}
            <tr style={{ background: 'var(--bg-secondary,#f8fafc)' }}>
              <td style={{ ...td, fontWeight: 700 }}>{L('Total', 'Tổng')}</td>
              {cols.map(c => <td key={c} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{modeTotals[c]}</td>)}
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{grand}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function IndividualReport() {
  const { staff } = useAuth();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const navigate = useNavigate();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const [periodVal, setPeriodVal] = useState({ period: 'weekly', weekStart: mondayOf(new Date()) });
  const [selectedStaff, setSelectedStaff] = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [drill, setDrill]     = useState(null);

  useEffect(() => { pushTrail && pushTrail({ label: L('Individual Report', 'Báo cáo cá nhân') }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    setLoading(true); setError(null);
    reportsAPI.individualReport(periodVal, selectedStaff || undefined)
      .then(r => { setData(r.data); if (!selectedStaff) setSelectedStaff(r.data.staffName); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [periodVal, selectedStaff]); // eslint-disable-line react-hooks/exhaustive-deps

  function openLead(studentId) { navigate(`/students/${studentId}`); }

  if (error) return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1rem' }}><div style={card}>{error}</div></div>;

  const metrics = data ? [
    { key: 'contracted', label: L('Contracted', 'Ký HĐ'), value: data.contracted.count, color: '#10B981',
      cols: [NAME_COL, { key: 'destinationCountry', label: L('Destination', 'Điểm đến') }], items: data.contracted.items },
    { key: 'reversed', label: L('Reversed', 'Hủy sau ký'), value: data.reversed.count, color: '#DC2626',
      cols: [NAME_COL], items: data.reversed.items },
    { key: 'basicLetters', label: L('Basic Letters', 'Thư CB'), value: data.basicLetters.count, color: '#f59e0b',
      cols: [NAME_COL], items: data.basicLetters.items },
    { key: 'finalLetters', label: L('Final Letters', 'Thư cuối'), value: data.finalLetters.count, color: '#f59e0b',
      cols: [NAME_COL], items: data.finalLetters.items },
    { key: 'new', label: L('New calls', 'Cuộc gọi Mới'), value: data.calls.totals.newLeads, color: '#8b5cf6',
      cols: [NAME_COL], items: data.calls.newLeadItems },
    { key: 'ongoing', label: L('Ongoing calls', 'Cuộc gọi theo dõi'), value: data.calls.totals.ongoing, color: '#8b5cf6',
      cols: [NAME_COL], items: data.calls.ongoingItems },
    { key: 'kbm', label: L('KBM (unanswered)', 'Không bắt máy'), value: data.calls.totals.kbm, color: '#DC2626',
      cols: [NAME_COL], items: data.calls.kbmItems },
    ...(data.callTarget ? [{
      key: 'callsKpi', label: L('Calls KPI', 'KPI cuộc gọi'),
      value: `${data.calls.totals.newLeads + data.calls.totals.ongoing} / ${data.callTarget.total}`,
      color: (data.calls.totals.newLeads + data.calls.totals.ongoing) >= data.callTarget.total ? '#10B981' : '#DC2626',
      items: [],
    }] : []),
    { key: 'meetings', label: L('Meetings', 'Cuộc gặp'), value: data.meetings.count, color: '#2563eb',
      cols: [NAME_COL, { key: 'topic', label: L('Type', 'Loại') }], items: data.meetings.items },
    { key: 'leadsIn', label: L('Leads in', 'Lead vào'), value: data.leadsFlow.in.count, color: '#2563eb',
      cols: [NAME_COL], items: data.leadsFlow.in.leads },
    { key: 'leadsOut', label: L('Leads out', 'Lead ra'), value: data.leadsFlow.out.count, color: '#2563eb',
      cols: [NAME_COL], items: data.leadsFlow.out.leads },
    { key: 'leadsProg', label: L('In progress', 'Đang xử lý'), value: data.leadsFlow.closing.count, color: '#2563eb',
      cols: [NAME_COL], items: data.leadsFlow.closing.leads },
  ] : [];

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{L('Individual Report', 'Báo cáo cá nhân')}</h1>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary,#6b7280)' }}>
            {data ? `${new Date(data.from).toLocaleDateString()} – ${new Date(new Date(data.to).getTime() - 1).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {data?.canPickAnyStaff && (
            <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}>
              {data.staffOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <PeriodPicker value={periodVal} onChange={setPeriodVal} L={L} />
        </div>
      </div>

      {loading && !data && <div style={card}>{L('Loading…', 'Đang tải…')}</div>}

      {data && (
        <>
          <div style={card}><KpiTiles metrics={metrics} onOpen={setDrill} /></div>
          <CallsByBucket data={data} L={L} />
          <ModeMatrix data={data} L={L} />
        </>
      )}

      <DrillPanel drill={drill} onClose={() => setDrill(null)} onRowClick={openLead} L={L} />
    </div>
  );
}
