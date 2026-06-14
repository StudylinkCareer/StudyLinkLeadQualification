// LeadManagement/src/pages/WeeklyReport.jsx
//
// Weekly Status Report.
//   Page header : 5 Contracted "actuals" KPI cards — ALWAYS the period totals
//                 across all individuals (company-wide for managers). Clickable.
//   Row 1       : Contracted (view-scoped bars) | Counselling Letters
//   Row 2       : Leads | Calls
//   Row 3       : Calls by day | Breakdown by mode (E-mail/Phone call/SMS/Zalo/
//                 WhatsApp/Messenger)
//   Right panel : drill-down — clicking ANY metric lists its leads here, scrollable,
//                 ending just above Recommendations. Click a lead to open its
//                 record (/leads/:id); the trail back arrow returns to this list.
//   Footer      : full-width Recommendations panel.
// Managers pick a view (All / By group / Selected / Individual) that scopes the
// rows; the header totals never change. Crash-proof: error boundary + guards.

import { useState, useEffect, useMemo, Component } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI } from '../services/api';

function mondayOf(d) { const x = new Date(d); const o = (x.getDay() + 6) % 7; x.setDate(x.getDate() - o); x.setHours(0, 0, 0, 0); return x; }
function lastCompletedMonday() { return new Date(mondayOf(new Date()).getTime() - 7 * 864e5); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fmt(d) { return new Date(d).toLocaleDateString(); }

const card  = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const sub   = { fontSize: '0.8rem', color: 'var(--text-secondary,#6b7280)' };
const th    = { textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary,#6b7280)', padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td    = { padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
const tdc   = { padding: '0.32rem 0.5rem', fontSize: '0.82rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
const sectionHead = (title, subtitle) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.85rem' }}>
    <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
    {subtitle && <span style={sub}>{subtitle}</span>}
  </div>
);

const MODES = ['E-mail', 'Phone call', 'SMS', 'Zalo', 'WhatsApp', 'Messenger'];

class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? <div style={{ padding: '1rem', color: '#b91c1c' }}>Weekly Report failed to load: {String(this.state.err.message || this.state.err)}</div> : this.props.children; }
}

const GROUP_COLORS = ['#2563eb', '#10B981', '#f59e0b', '#8b5cf6', '#ec4899', '#0891b2'];

function makePayload(sectionTitle, m, g, multi) {
  const lbl = m.barLabel || m.label;
  // Each lead once: de-duplicate by lead id, keeping the first (current-status) row.
  let items = (m.leads ? (m.leads(g) || []) : []);
  const seen = new Set();
  items = items.filter(it => { const k = it.studentId; if (k == null) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    title: `${sectionTitle} — ${lbl}${multi ? ` (${g.label})` : ''}`,
    cols: m.cols || [{ key: 'fullName', label: 'Name' }],
    items, secTitle: sectionTitle, metricKey: m.key, groupLabel: g.label,
  };
}

function BarChart({ sectionTitle, metrics, groups, sectionColor, onBar }) {
  const H = 140;
  const multi = groups.length > 1;
  let max = 0;
  metrics.forEach(m => groups.forEach(g => { const v = m.value(g) || 0; if (v > max) max = v; }));
  max = max || 1;
  return (
    <div>
      {multi && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          {groups.map((g, gi) => (
            <span key={g.label} style={{ ...sub, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: GROUP_COLORS[gi % GROUP_COLORS.length], display: 'inline-block' }} />
              {g.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', padding: '0 0.25rem', overflowX: 'auto' }}>
        {metrics.map(m => (
          <div key={m.key} style={{ flex: '1 1 0', minWidth: multi ? groups.length * 30 + 20 : 50, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, height: H }}>
              {groups.map((g, gi) => {
                const v = m.value(g) || 0;
                const clickable = (m.leads ? (m.leads(g) || []) : []).length > 0;
                const color = multi ? GROUP_COLORS[gi % GROUP_COLORS.length] : (m.color || sectionColor);
                const ph = Math.round((v / max) * (H - 20));
                return (
                  <div key={g.label} title={multi ? `${g.label}: ${v}` : (clickable ? 'Click to view leads' : String(v))}
                    onClick={clickable ? () => onBar(makePayload(sectionTitle, m, g, multi)) : undefined}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: clickable ? 'pointer' : 'default' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, marginBottom: 3, color: 'var(--text-primary,#111827)' }}>{v}</div>
                    <div style={{ width: multi ? 24 : 34, height: Math.max(ph, v > 0 ? 6 : 2),
                      background: v > 0 ? color : 'var(--border,#e5e7eb)', borderRadius: '4px 4px 0 0', transition: 'height .25s' }} />
                  </div>
                );
              })}
            </div>
            <div style={{ ...sub, marginTop: 8, textAlign: 'center', lineHeight: 1.2 }}>{m.barLabel || m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiTiles({ sectionTitle, metrics, groups, onBar }) {
  const multi = groups.length > 1;
  return (
    <div>
      {groups.map(g => (
        <div key={g.label} style={{ marginBottom: multi ? '0.85rem' : 0 }}>
          {multi && <div style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0 0 0.4rem' }}>{g.label}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {metrics.map(m => {
              const v = m.value(g) || 0;
              const clickable = (m.leads ? (m.leads(g) || []) : []).length > 0;
              const color = m.color || '#10B981';
              return (
                <div key={m.key} onClick={clickable ? () => onBar(makePayload(sectionTitle, m, g, multi)) : undefined}
                  title={clickable ? 'Click to view leads' : ''}
                  style={{ flex: '1 1 150px', minWidth: 140, border: '1px solid var(--border,#e5e7eb)',
                           borderLeft: `4px solid ${color}`, borderRadius: 8, padding: '0.7rem 0.9rem',
                           cursor: clickable ? 'pointer' : 'default', background: 'var(--bg-primary,#fff)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{v}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ByDay({ group, multi, L }) {
  const daily = group.calls?.daily || [];
  const tot = daily.reduce((a, r) => ({
    newLeads: a.newLeads + r.newLeads, ongoing: a.ongoing + r.ongoing,
    targetNew: a.targetNew + r.targetNew, targetOngoing: a.targetOngoing + r.targetOngoing,
  }), { newLeads: 0, ongoing: 0, targetNew: 0, targetOngoing: 0 });
  return (
    <div style={{ marginBottom: multi ? '1rem' : 0 }}>
      {multi && <div style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0.5rem 0 0.25rem' }}>{group.label}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>{L('Day', 'Ngày')}</th><th style={{ ...th, textAlign: 'right' }}>{L('New / target', 'Mới / MT')}</th><th style={{ ...th, textAlign: 'right' }}>{L('Ongoing / target', 'Theo dõi / MT')}</th></tr></thead>
        <tbody>
          {daily.map(r => (
            <tr key={r.day}>
              <td style={tdc}>{r.day}</td>
              <td style={{ ...tdc, textAlign: 'right', fontWeight: 600, color: r.newLeads >= r.targetNew ? '#10B981' : '#DC2626' }}>{r.newLeads} / {r.targetNew}</td>
              <td style={{ ...tdc, textAlign: 'right', fontWeight: 600, color: r.ongoing >= r.targetOngoing ? '#10B981' : '#DC2626' }}>{r.ongoing} / {r.targetOngoing}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdc, fontWeight: 700 }}>{L('Totals', 'Tổng')}</td>
            <td style={{ ...tdc, textAlign: 'right', fontWeight: 700, color: tot.newLeads >= tot.targetNew ? '#10B981' : '#DC2626' }}>{tot.newLeads} / {tot.targetNew}</td>
            <td style={{ ...tdc, textAlign: 'right', fontWeight: 700, color: tot.ongoing >= tot.targetOngoing ? '#10B981' : '#DC2626' }}>{tot.ongoing} / {tot.targetOngoing}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ByModeMatrix({ group, multi, L }) {
  const grid = group.calls?.modeByDay || [];
  const extra = new Set();
  grid.forEach(d => Object.keys(d.byMode || {}).forEach(k => { if (!MODES.includes(k)) extra.add(k); }));
  const cols = [...MODES, ...extra];
  const modeTotals = {}; cols.forEach(c => { modeTotals[c] = 0; });
  let grand = 0;
  const rows = grid.map(d => {
    let rowTotal = 0;
    const cells = cols.map(c => { const v = (d.byMode && d.byMode[c]) || 0; modeTotals[c] += v; rowTotal += v; return v; });
    grand += rowTotal;
    return { day: d.day, cells, rowTotal };
  });
  return (
    <div style={{ marginBottom: multi ? '1rem' : 0, overflowX: 'auto' }}>
      {multi && <div style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0.5rem 0 0.25rem' }}>{group.label}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr>
            <th style={{ ...th, padding: '0.4rem 0.4rem' }}>{L('Day', 'Ngày')}</th>
            {cols.map(c => <th key={c} style={{ ...th, padding: '0.4rem 0.4rem', textAlign: 'right' }} title={c}>{c}</th>)}
            <th style={{ ...th, padding: '0.4rem 0.4rem', textAlign: 'right' }}>{L('Total', 'Tổng')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.day}>
              <td style={{ ...tdc, padding: '0.3rem 0.4rem' }}>{r.day}</td>
              {r.cells.map((v, i) => <td key={i} style={{ ...tdc, padding: '0.3rem 0.4rem', textAlign: 'right', color: v ? 'inherit' : 'var(--text-secondary,#9ca3af)' }}>{v}</td>)}
              <td style={{ ...tdc, padding: '0.3rem 0.4rem', textAlign: 'right', fontWeight: 700 }}>{r.rowTotal}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdc, padding: '0.3rem 0.4rem', fontWeight: 700 }}>{L('Totals', 'Tổng')}</td>
            {cols.map(c => <td key={c} style={{ ...tdc, padding: '0.3rem 0.4rem', textAlign: 'right', fontWeight: 700 }}>{modeTotals[c]}</td>)}
            <td style={{ ...tdc, padding: '0.3rem 0.4rem', textAlign: 'right', fontWeight: 700 }}>{grand}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
function WeeklyReportInner() {
  const { staff } = useAuth();
  const { scope } = usePermissions();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { push: pushTrail } = useNavTrail();
  const isManager = scope('leads', 'view_list') === 'all';
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const init = location.state || {};
  const [weekStart, setWeekStart] = useState(() => init.weekStart || iso(lastCompletedMonday()));
  const [mode, setMode]           = useState(() => init.mode || 'all');
  const [selected, setSelected]   = useState(() => Array.isArray(init.selected) ? init.selected : []);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill]     = useState(null);

  const [recoContent, setRecoContent]   = useState('');
  const [recoBaseline, setRecoBaseline] = useState('');
  const [recoInfo, setRecoInfo]         = useState({ updatedBy: null, updatedAt: null });
  const [recoStatus, setRecoStatus]     = useState('idle');
  const recoDirty = recoContent !== recoBaseline;

  const viewResources = (mode === 'selected' || mode === 'individual') ? selected : [];
  const apiMode      = isManager ? mode : 'individual';
  const apiResources = isManager ? viewResources : [];
  const needsSelection = isManager && (mode === 'selected' || mode === 'individual') && !selected.length;

  useEffect(() => {
    if (typeof reportsAPI.weeklyReport !== 'function') { setData(null); return; }
    setLoading(true);
    reportsAPI.weeklyReport(weekStart, apiMode, apiResources)
      .then(r => setData(r?.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [weekStart, mode, selected, isManager]);

  useEffect(() => {
    if (typeof reportsAPI.getRecommendation !== 'function') return;
    if (needsSelection) { setRecoContent(''); setRecoBaseline(''); setRecoInfo({ updatedBy: null, updatedAt: null }); setRecoStatus('idle'); return; }
    setRecoStatus('loading');
    reportsAPI.getRecommendation(weekStart, apiMode, apiResources)
      .then(r => { const d = r?.data || {}; setRecoContent(d.content || ''); setRecoBaseline(d.content || ''); setRecoInfo({ updatedBy: d.updatedBy || null, updatedAt: d.updatedAt || null }); setRecoStatus('idle'); })
      .catch(() => setRecoStatus('error'));
  }, [weekStart, mode, selected, isManager]);

  useEffect(() => {
    pushTrail({ label: L('Weekly Status Report', 'Báo cáo tuần'), path: '/reports/weekly',
                state: { weekStart, mode, selected } });
  }, [pushTrail, weekStart, mode, selected, language]);

  const shiftWeek = (delta) => { const x = new Date(weekStart); x.setDate(x.getDate() + delta * 7); setWeekStart(iso(x)); setDrill(null); };
  const weekEndLabel = useMemo(() => { const x = new Date(weekStart); x.setDate(x.getDate() + 6); return fmt(x); }, [weekStart]);

  const groups = data?.groups || [];
  const totalsGroup = { label: '__totals__', contracted: data?.contractedTotals || {} };
  const resourceOptions = useMemo(() => {
    const s = data?.staff || {};
    return [...(s.counsellors || []), ...(s.presales || [])];
  }, [data]);

  // ── Metric definitions ──────────────────────────────────────
  const name = { key: 'fullName', label: L('Name', 'Họ tên') };
  const dest = { key: 'country', label: L('Destination', 'Điểm đến') };

  const contractedSection = { title: L('Contracted', 'Hợp đồng'), color: '#10B981', metrics: [
    { key: 'c_lw',  label: L('Contracted last week', 'HĐ tuần trước'), barLabel: L('Last week', 'Tuần trước'), value: g => g.contracted?.lastWeek?.count,      leads: g => g.contracted?.lastWeek?.items,      cols: [name, dest] },
    { key: 'c_mtd', label: L('Contracted MTD', 'HĐ tháng này'),        barLabel: L('MTD', 'Tháng'),            value: g => g.contracted?.monthToDate?.count,   leads: g => g.contracted?.monthToDate?.items,   cols: [name, dest] },
    { key: 'c_qtd', label: L('Contracted QTD', 'HĐ quý này'),          barLabel: L('QTD', 'Quý'),              value: g => g.contracted?.quarterToDate?.count, leads: g => g.contracted?.quarterToDate?.items, cols: [name, dest] },
    { key: 'c_ytd', label: L('Contracted YTD', 'HĐ năm nay'),          barLabel: L('YTD', 'Năm'),              value: g => g.contracted?.yearToDate?.count,    leads: g => g.contracted?.yearToDate?.items,    cols: [name, dest] },
    { key: 'c_rev', label: L('Contracted reversed', 'HĐ đã đảo'),      barLabel: L('Reversed', 'Đã đảo'),      value: g => g.contracted?.reversed?.count,      leads: g => g.contracted?.reversed?.items,      color: '#DC2626', cols: [name] },
  ] };
  const lettersSection = { title: L('Counselling Letters', 'Thư tư vấn'), color: '#f59e0b', subtitle: L('prior week only', 'chỉ tuần trước'), metrics: [
    { key: 'let_basic', label: L('Basic', 'Cơ bản'), value: g => g.basicLetters?.count, leads: g => g.basicLetters?.items, cols: [name, { key: 'destinationCountry', label: L('Destination', 'Điểm đến') }] },
    { key: 'let_final', label: L('Final', 'Cuối'),   value: g => g.finalLetters?.count, leads: g => g.finalLetters?.items, cols: [name, { key: 'destinationCountry', label: L('Destination', 'Điểm đến') }] },
  ] };
  const leadsSection = { title: L('Leads', 'Khách hàng'), color: '#2563eb', metrics: [
    { key: 'l_in',   label: L('Leads in', 'Nhận vào'),      value: g => g.leadsIn?.count,         leads: g => g.leadsIn?.leads,         cols: [name, { key: 'studentId', label: L('Lead ID', 'Mã KH') }, { key: 'leadSource', label: L('Source', 'Nguồn') }, { key: 'leadStatus', label: L('Status', 'Trạng thái') }] },
    { key: 'l_out',  label: L('Leads out', 'Chuyển đi'),    value: g => g.leadsOut?.count,        leads: g => g.leadsOut?.leads,        cols: [name, { key: 'studentId', label: L('Lead ID', 'Mã KH') }, { key: 'leadSource', label: L('Source', 'Nguồn') }, { key: 'movedTo', label: L('Moved to', 'Chuyển đến') }] },
    { key: 'l_prog', label: L('In progress', 'Đang xử lý'), value: g => g.leadsInProgress?.count, leads: g => g.leadsInProgress?.leads, cols: [name, { key: 'studentId', label: L('Lead ID', 'Mã KH') }, { key: 'leadSource', label: L('Source', 'Nguồn') }, { key: 'leadStatus', label: L('Status', 'Trạng thái') }] },
  ] };
  const callsSection = { title: L('Calls', 'Cuộc gọi'), color: '#8b5cf6', subtitle: L('prior week only', 'chỉ tuần trước'), metrics: [
    { key: 'call_new', label: L('New clients', 'Khách mới'),       value: g => g.calls?.totals?.newLeads, leads: g => g.calls?.newLeadItems, cols: [name] },
    { key: 'call_fu',  label: L('Follow-up', 'Theo dõi'),          value: g => g.calls?.totals?.ongoing,  leads: g => g.calls?.ongoingItems, cols: [name] },
    { key: 'call_mtg', label: L('Meetings scheduled', 'Cuộc gặp'), value: g => g.meetings?.count,         leads: g => g.meetings?.items,     cols: [name, { key: 'topic', label: L('Type', 'Loại') }, { key: 'meetingLocation', label: L('Location', 'Địa điểm') }] },
  ] };
  const ALL_SECTIONS = [contractedSection, lettersSection, leadsSection, callsSection];

  // ── Drill open / restore ────────────────────────────────────
  const openDrill = (payload) => { if (payload?.items?.length) setDrill(payload); };
  const closeDrill = () => setDrill(null);

  const openLead = (studentId) => {
    if (!studentId) return;
    if (drill) { try { sessionStorage.setItem('weekly-drill', JSON.stringify({ weekStart, mode, selected, secTitle: drill.secTitle, metricKey: drill.metricKey, groupLabel: drill.groupLabel })); } catch { /* ignore */ } }
    navigate(`/leads/${studentId}`);
  };

  useEffect(() => {
    if (!groups.length) return;
    let raw; try { raw = sessionStorage.getItem('weekly-drill'); } catch { return; }
    if (!raw) return;
    try { sessionStorage.removeItem('weekly-drill'); } catch { /* ignore */ }
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.weekStart !== weekStart || d.mode !== mode || JSON.stringify(d.selected || []) !== JSON.stringify(selected)) return;
    const sec = ALL_SECTIONS.find(s => s.title === d.secTitle); if (!sec) return;
    const metric = sec.metrics.find(m => m.key === d.metricKey); if (!metric) return;
    const grp = d.groupLabel === '__totals__' ? totalsGroup : (groups.find(g => g.label === d.groupLabel) || groups[0]);
    if (!grp) return;
    setDrill(makePayload(sec.title, metric, grp, grp !== totalsGroup && groups.length > 1));
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveReco = () => {
    if (typeof reportsAPI.saveRecommendation !== 'function' || needsSelection) return;
    setRecoStatus('saving');
    reportsAPI.saveRecommendation(weekStart, apiMode, apiResources, recoContent)
      .then(r => { const d = r?.data || {}; setRecoBaseline(d.content ?? recoContent); setRecoInfo({ updatedBy: d.updatedBy || null, updatedAt: d.updatedAt || null }); setRecoStatus('saved'); })
      .catch(() => setRecoStatus('error'));
  };

  const currentViewLabel = !isManager
    ? (staff?.fullName || L('Me', 'Tôi'))
    : mode === 'groups' ? L('Counsellors & Pre-Sales', 'Tư vấn & Pre-Sales')
    : mode === 'selected' ? (selected.join(', ') || L('Selected', 'Đã chọn'))
    : mode === 'individual' ? (selected[0] || L('Individual', 'Cá nhân'))
    : L('All', 'Tất cả');

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1rem' }}>
      <style>{`
        .wr-split{display:flex;gap:1rem;align-items:flex-start;}
        .wr-cards{flex:1;min-width:0;}
        .wr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;align-items:start;margin-bottom:1rem;}
        .wr-detail{width:380px;flex-shrink:0;position:sticky;top:1rem;align-self:flex-start;}
        @media (max-width:1000px){.wr-split{flex-direction:column;}.wr-detail{width:100%;position:static;}}
        @media (max-width:760px){.wr-grid{grid-template-columns:1fr;}}
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{L('Weekly Status Report', 'Báo cáo tuần')}</h1>
          <div style={sub}>{fmt(weekStart)} – {weekEndLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => shiftWeek(-1)}>◀ {L('Prev', 'Trước')}</button>
          <button className="btn" onClick={() => shiftWeek(1)}>{L('Next', 'Sau')} ▶</button>
          {isManager && (
            <select value={mode} onChange={e => { setMode(e.target.value); setSelected([]); setDrill(null); }} style={{ padding: '0.4rem' }}>
              <option value="all">{L('All', 'Tất cả')}</option>
              <option value="groups">{L('By group (Counsellors / Pre-Sales)', 'Theo nhóm (Tư vấn / Pre-Sales)')}</option>
              <option value="selected">{L('Selected', 'Đã chọn')}</option>
              <option value="individual">{L('Individual', 'Cá nhân')}</option>
            </select>
          )}
          {isManager && mode === 'selected' && (
            <select multiple value={selected} onChange={e => { setSelected(Array.from(e.target.selectedOptions).map(o => o.value)); setDrill(null); }} style={{ padding: '0.4rem', minWidth: 180, minHeight: 90 }}>
              {resourceOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {isManager && mode === 'individual' && (
            <select value={selected[0] || ''} onChange={e => { setSelected(e.target.value ? [e.target.value] : []); setDrill(null); }} style={{ padding: '0.4rem' }}>
              <option value="">{L('— Select resource —', '— Chọn —')}</option>
              {resourceOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading && <div style={sub}>{L('Loading…', 'Đang tải…')}</div>}
      {needsSelection && <div style={card}>{L('Select one or more resources above.', 'Chọn tài nguyên ở trên.')}</div>}
      {!loading && !groups.length && !needsSelection && (
        <div style={card}>{L('No data returned. Make sure the weekly-report endpoint is deployed.', 'Không có dữ liệu. Hãy đảm bảo endpoint báo cáo tuần đã được triển khai.')}</div>
      )}

      {!!groups.length && (
        <>
          {/* PAGE HEADER — Contracted actuals, ALWAYS company-wide totals */}
          <div style={card}>
            {sectionHead(L('Contracted', 'Hợp đồng'), L('signed — actuals · all individuals', 'đã ký — thực tế · toàn bộ'))}
            <KpiTiles sectionTitle={contractedSection.title} metrics={contractedSection.metrics} groups={[totalsGroup]} onBar={openDrill} />
          </div>

          <div className="wr-split">
            <div className="wr-cards">
              {/* Row 1 */}
              <div className="wr-grid">
                <div style={{ ...card, marginBottom: 0 }}>
                  {sectionHead(contractedSection.title, L('this view', 'theo lựa chọn'))}
                  <BarChart sectionTitle={contractedSection.title} metrics={contractedSection.metrics} groups={groups} sectionColor={contractedSection.color} onBar={openDrill} />
                </div>
                <div style={{ ...card, marginBottom: 0 }}>
                  {sectionHead(lettersSection.title, lettersSection.subtitle)}
                  <BarChart sectionTitle={lettersSection.title} metrics={lettersSection.metrics} groups={groups} sectionColor={lettersSection.color} onBar={openDrill} />
                </div>
              </div>

              {/* Row 2 */}
              <div className="wr-grid">
                <div style={{ ...card, marginBottom: 0 }}>
                  {sectionHead(leadsSection.title)}
                  <BarChart sectionTitle={leadsSection.title} metrics={leadsSection.metrics} groups={groups} sectionColor={leadsSection.color} onBar={openDrill} />
                </div>
                <div style={{ ...card, marginBottom: 0 }}>
                  {sectionHead(callsSection.title, callsSection.subtitle)}
                  <BarChart sectionTitle={callsSection.title} metrics={callsSection.metrics} groups={groups} sectionColor={callsSection.color} onBar={openDrill} />
                </div>
              </div>

              {/* Row 3 */}
              <div className="wr-grid">
                <div style={{ ...card, marginBottom: 0 }}>
                  {sectionHead(L('Calls by day', 'Cuộc gọi theo ngày'), callsSection.subtitle)}
                  {groups.map(g => <ByDay key={g.label} group={g} multi={groups.length > 1} L={L} />)}
                </div>
                <div style={{ ...card, marginBottom: 0 }}>
                  {sectionHead(L('Breakdown by mode', 'Theo hình thức'), callsSection.subtitle)}
                  {groups.map(g => <ByModeMatrix key={g.label} group={g} multi={groups.length > 1} L={L} />)}
                </div>
              </div>

              <div style={{ ...sub, margin: '0 0.25rem 1rem' }}>
                {L('Click any KPI card or bar to list its leads on the right, then open a record.', 'Nhấn vào thẻ KPI hoặc cột bất kỳ để xem danh sách bên phải, rồi mở hồ sơ.')}
              </div>
            </div>

            {/* RIGHT: drill-down panel — scrolls, ends above Recommendations */}
            <aside className="wr-detail">
              <div style={{ ...card, marginBottom: 0, padding: 0, maxHeight: 'calc(100vh - 2rem)', overflow: 'auto' }}>
                {drill ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border,#e5e7eb)', position: 'sticky', top: 0, background: 'var(--bg-primary,#fff)' }}>
                      <button onClick={closeDrill} style={{ background: 'transparent', border: 'none', color: 'var(--primary,#2563eb)', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>← {L('Back', 'Quay lại')}</button>
                      <button onClick={closeDrill} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary,#6b7280)', fontSize: '1rem' }}>✕</button>
                    </div>
                    <div style={{ padding: '0.6rem 1rem 0' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{drill.title} <span style={sub}>({drill.items.length})</span></h3>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
                      <thead><tr>{drill.cols.map(c => <th key={c.key} style={th}>{c.label}</th>)}</tr></thead>
                      <tbody>
                        {drill.items.map((it, i) => (
                          <tr key={it.studentId || i} onClick={() => openLead(it.studentId)} style={{ cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary,#f8fafc)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                            {drill.cols.map((c, ci) => (
                              <td key={c.key} style={{ ...td, ...(ci === 0 ? { fontWeight: 600, color: 'var(--primary,#2563eb)' } : {}) }}>{it[c.key] || '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ padding: '0.6rem 1rem', ...sub }}>
                      {L('Click a row to open the record. The back arrow returns here.', 'Nhấn vào một hàng để mở hồ sơ. Nút quay lại sẽ trở về đây.')}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '1.25rem 1rem', textAlign: 'center', ...sub }}>
                    {L('Click any KPI card or bar to list its leads here, then drill into a record.', 'Nhấn vào thẻ KPI hoặc cột để xem danh sách khách hàng tại đây.')}
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Recommendations — full width */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{L('Recommendations', 'Đề xuất')}</h2>
              <span style={sub}>{L('For', 'Cho')}: {currentViewLabel} · {L('week of', 'tuần')} {fmt(weekStart)}</span>
            </div>
            <textarea value={recoContent} onChange={e => setRecoContent(e.target.value)} rows={4}
              placeholder={L('Notes / recommendations for this week…', 'Ghi chú / đề xuất cho tuần này…')}
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border,#e5e7eb)', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={saveReco} disabled={!recoDirty || recoStatus === 'saving'}>
                {recoStatus === 'saving' ? L('Saving…', 'Đang lưu…') : L('Save', 'Lưu')}
              </button>
              <span style={sub}>
                {recoDirty ? L('Unsaved changes', 'Thay đổi chưa lưu')
                  : recoStatus === 'saved' ? L('Saved', 'Đã lưu')
                  : recoStatus === 'error' ? L('Save failed', 'Lưu thất bại') : ''}
                {recoInfo.updatedBy ? `  ·  ${L('last by', 'bởi')} ${recoInfo.updatedBy}${recoInfo.updatedAt ? ` · ${new Date(recoInfo.updatedAt).toLocaleString()}` : ''}` : ''}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function WeeklyReport() {
  return <ErrorBoundary><WeeklyReportInner /></ErrorBoundary>;
}
