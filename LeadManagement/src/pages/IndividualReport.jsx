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
import { KpiTiles, DrillPanel } from '../components/reports/KpiTiles';
import PeriodPicker from '../components/reports/PeriodPicker';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const th = { textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary,#6b7280)', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
const NAME_COL = { key: 'fullName', label: 'Name' };

function mondayOf(d) {
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - dow);
  return mon.toISOString().slice(0, 10);
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

          {data.calls.byBucket.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('Calls over time', 'Cuộc gọi theo thời gian')}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>{data.calls.bucket === 'day' ? L('Day', 'Ngày') : data.calls.bucket === 'week' ? L('Week of', 'Tuần') : L('Month', 'Tháng')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{L('New', 'Mới')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{L('Ongoing', 'Theo dõi')}</th>
                </tr></thead>
                <tbody>
                  {data.calls.byBucket.map(b => (
                    <tr key={b.bucket}>
                      <td style={td}>{b.bucket}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{b.newLeads}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{b.ongoing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.calls.byPlatform.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{L('By contact platform', 'Theo kênh liên hệ')}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>{L('Platform', 'Kênh')}</th><th style={{ ...th, textAlign: 'right' }}>{L('New', 'Mới')}</th><th style={{ ...th, textAlign: 'right' }}>{L('Ongoing', 'Theo dõi')}</th></tr></thead>
                <tbody>
                  {data.calls.byPlatform.map(p => (
                    <tr key={p.platform}>
                      <td style={td}>{p.platform}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{p.newCount}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{p.ongoing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <DrillPanel drill={drill} onClose={() => setDrill(null)} onRowClick={openLead} L={L} />
    </div>
  );
}
