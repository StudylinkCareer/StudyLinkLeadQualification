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

import { useState, useEffect, useMemo, useRef, Component } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI, staffAPI } from '../services/api';

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

  // Recommendations are APPEND-ONLY: recoContent is the immutable history,
  // recoAdd is a new supplemental segment. Locked (frozen) weeks reject additions.
  const [recoContent, setRecoContent]   = useState('');
  const [recoAdd, setRecoAdd]           = useState('');
  const [recoLocked, setRecoLocked]     = useState(false);
  const [recoInfo, setRecoInfo]         = useState({ updatedBy: null, updatedAt: null });
  const [recoStatus, setRecoStatus]     = useState('idle');
  const [reloadKey, setReloadKey]       = useState(0);
  const [republishing, setRepublishing] = useState(false);
  const recoDirty = recoAdd.trim().length > 0;

  // ── Monthly Targets state ───────────────────────────────────
  const [targets, setTargets]               = useState(null);   // { months, rows }
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [roster, setRoster]                 = useState([]);     // active staff for the add-picker
  const [editCell, setEditCell]             = useState(null);   // { staffId, month }
  const [editVal, setEditVal]               = useState('');
  const [showAdd, setShowAdd]               = useState(false);
  const [addId, setAddId]                   = useState('');
  const skipBlurRef                         = useRef(false);

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
  }, [weekStart, mode, selected, isManager, reloadKey]);

  // Manager "Re-publish": re-freeze this week's snapshot, then refetch it.
  const republish = async () => {
    if (!isManager || republishing) return;
    setRepublishing(true);
    try { await reportsAPI.regenerateWeekly(weekStart); setReloadKey(k => k + 1); }
    catch { /* ignore */ }
    finally { setRepublishing(false); }
  };

  useEffect(() => {
    if (typeof reportsAPI.getRecommendation !== 'function') return;
    if (needsSelection) { setRecoContent(''); setRecoAdd(''); setRecoLocked(false); setRecoInfo({ updatedBy: null, updatedAt: null }); setRecoStatus('idle'); return; }
    setRecoStatus('loading');
    reportsAPI.getRecommendation(weekStart, apiMode, apiResources)
      .then(r => { const d = r?.data || {}; setRecoContent(d.content || ''); setRecoAdd(''); setRecoLocked(!!d.locked); setRecoInfo({ updatedBy: d.updatedBy || null, updatedAt: d.updatedAt || null }); setRecoStatus('idle'); })
      .catch(() => setRecoStatus('error'));
  }, [weekStart, mode, selected, isManager]);

  useEffect(() => {
    pushTrail({ label: L('Weekly Report (static)', 'Báo cáo tuần (tĩnh)'), path: '/reports/weekly',
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
  const leadCols = [name, { key: 'studentId', label: L('Sales ID', 'Mã KH') }, { key: 'leadSource', label: L('Source', 'Nguồn') }, { key: 'leadStatus', label: L('Status', 'Trạng thái') }];
  const leadsSection = { title: L('Leads', 'Khách hàng'), color: '#2563eb', metrics: [
    { key: 'l_open', label: L('Opening', 'Đầu kỳ'),         value: g => g.leadsFlow?.opening?.count, leads: g => g.leadsFlow?.opening?.leads, cols: leadCols },
    { key: 'l_in',   label: L('Leads in', 'Nhận vào'),      value: g => g.leadsFlow?.in?.count,      leads: g => g.leadsFlow?.in?.leads,      cols: leadCols },
    { key: 'l_out',  label: L('Leads out', 'Chuyển đi'),    value: g => g.leadsFlow?.out?.count,     leads: g => g.leadsFlow?.out?.leads,     cols: leadCols },
    { key: 'l_prog', label: L('In progress', 'Đang xử lý'), value: g => g.leadsFlow?.closing?.count, leads: g => g.leadsFlow?.closing?.leads, cols: leadCols },
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
    navigate(`/students/${studentId}`);   // rows are people here → open the Student record
  };

  // "Drill down to list of records" — open the full Leads list filtered to exactly
  // the records in this drill panel (by studentId; the list matches lead/student ids).
  const openDrillAsList = () => {
    const ids = (drill?.items || []).map(it => it.studentId).filter(Boolean);
    if (!ids.length) return;
    navigate('/leads', { state: { drillFilter: { key: '_ids', value: ids } } });
  };

  // Resizable drill panel: drag its RIGHT edge to extend the panel rightward
  // (cards stay put; .wr-split scrolls if it passes the container). Session-persisted.
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = Number(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('wr-panel-width'));
    return v >= 300 && v <= 900 ? v : 380;
  });
  const startPanelResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    let latest = startW;
    // Grip is on the panel's RIGHT edge → drag right widens, drag left narrows.
    const onMove = (ev) => { latest = Math.min(1200, Math.max(300, startW + (ev.clientX - startX))); setPanelWidth(latest); };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { sessionStorage.setItem('wr-panel-width', String(latest)); } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Per-column widths for the drill list (drag a column's right edge to widen it
  // so long values stop overflowing). Keyed by column key; defaults below.
  const [colWidths, setColWidths] = useState({});
  const colWidthFor = (key, idx) => colWidths[key] || (idx === 0 ? 160 : 130);
  const startColResize = (e, key, currentW) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = currentW;
    const onMove = (ev) => { setColWidths(w => ({ ...w, [key]: Math.max(60, startW + (ev.clientX - startX)) })); };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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

  // Append the supplemental note; the server stamps it (time + author) and
  // returns the full history. Existing text is never edited.
  const saveReco = () => {
    if (typeof reportsAPI.saveRecommendation !== 'function' || needsSelection || !recoAdd.trim() || recoLocked) return;
    setRecoStatus('saving');
    reportsAPI.saveRecommendation(weekStart, apiMode, apiResources, recoAdd.trim())
      .then(r => { const d = r?.data || {}; setRecoContent(d.content || ''); setRecoAdd(''); setRecoLocked(!!d.locked); setRecoInfo({ updatedBy: d.updatedBy || null, updatedAt: d.updatedAt || null }); setRecoStatus('saved'); })
      .catch(() => setRecoStatus('error'));
  };

  // ── Monthly Targets: load + mutations (managers only) ───────
  const cellColor = (a, t) =>
    (t > 0 ? (a >= t ? '#10B981' : '#DC2626') : (a > 0 ? '#10B981' : 'var(--text-secondary,#9ca3af)'));

  function reloadTargets() {
    if (!isManager || typeof reportsAPI.monthlyTargets !== 'function') return;
    setTargetsLoading(true);
    reportsAPI.monthlyTargets()
      .then(r => setTargets(r?.data || null))
      .catch(() => setTargets(null))
      .finally(() => setTargetsLoading(false));
  }
  useEffect(() => { reloadTargets(); }, [isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isManager || typeof staffAPI.listActive !== 'function') return;
    staffAPI.listActive().then(r => setRoster(r?.data || [])).catch(() => setRoster([]));
  }, [isManager]);

  function saveTarget(staffId, month, value) {
    reportsAPI.saveMonthlyTarget(staffId, month, value)
      .then(() => { setEditCell(null); reloadTargets(); })
      .catch(() => setEditCell(null));
  }
  function addTracked() {
    if (!addId) return;
    reportsAPI.addTrackedStaff(Number(addId))
      .then(() => { setAddId(''); setShowAdd(false); reloadTargets(); })
      .catch(() => {});
  }
  function removeTracked(staffId) {
    reportsAPI.removeTrackedStaff(staffId).then(() => reloadTargets()).catch(() => {});
  }

  const currentViewLabel = !isManager
    ? (staff?.fullName || L('Me', 'Tôi'))
    : mode === 'groups' ? L('Counsellors & Pre-Sales', 'Tư vấn & Pre-Sales')
    : mode === 'selected' ? (selected.join(', ') || L('Selected', 'Đã chọn'))
    : mode === 'individual' ? (selected[0] || L('Individual', 'Cá nhân'))
    : L('All', 'Tất cả');

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1rem' }}>
      <style>{`
        .wr-split{display:flex;gap:1rem;align-items:flex-start;overflow-x:auto;}
        /* Cards fill spare room but NEVER shrink (flex-shrink:0). So widening the
           Detail panel does not steal width from the cards — instead the panel's
           right edge extends past the container edge and .wr-split scrolls, with
           the cards (and the panel's left edge) staying put. 396 = default panel
           380 + the 1rem gap. */
        .wr-cards{flex:1 0 calc(100% - 396px);min-width:640px;}
        .wr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;align-items:start;margin-bottom:1rem;}
        .wr-detail{width:380px;flex-shrink:0;position:sticky;top:1rem;align-self:flex-start;}
        @media (max-width:1000px){.wr-split{flex-direction:column;overflow-x:visible;}.wr-cards{min-width:0;flex:0 0 auto;width:auto;}.wr-detail{width:100%;position:static;}}
        @media (max-width:760px){.wr-grid{grid-template-columns:1fr;}}
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{L('Weekly Report (static)', 'Báo cáo tuần (tĩnh)')}</h1>
          <div style={sub}>{fmt(weekStart)} – {weekEndLabel}
            {data?.frozen
              ? <span> · {L('published', 'đã xuất bản')}{data.asOf ? ` ${new Date(data.asOf).toLocaleDateString()}` : ''}</span>
              : data ? <span> · {L('live (not yet published)', 'trực tiếp (chưa xuất bản)')}</span> : null}
          </div>
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
          {isManager && (
            <button className="btn" onClick={republish} disabled={republishing}
              title={L('Re-freeze this week from the current data (the report normally auto-publishes Monday 08:00)', 'Cập nhật lại báo cáo tuần từ dữ liệu hiện tại (tự động xuất bản Thứ Hai 08:00)')}>
              {republishing ? L('Publishing…', 'Đang xuất…') : L('↻ Re-publish', '↻ Cập nhật lại')}
            </button>
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

          {/* Recommendations — full width, directly under the banner. APPEND-ONLY:
              history is immutable; supplemental notes can be added until the next
              Monday publish freezes the week. */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{L('Recommendations', 'Đề xuất')}</h2>
                {recoLocked && (
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                                 background: '#e5e7eb', color: '#374151' }}>
                    ❄ {L('Frozen', 'Đã khóa')}
                  </span>
                )}
              </div>
              <span style={sub}>{L('For', 'Cho')}: {currentViewLabel} · {L('week of', 'tuần')} {fmt(weekStart)}</span>
            </div>
            {recoContent
              ? <div style={{ whiteSpace: 'pre-wrap', padding: '0.6rem', border: '1px solid var(--border,#e5e7eb)',
                              borderRadius: 6, background: 'var(--bg-secondary,#f8fafc)', fontSize: '0.9rem',
                              maxHeight: 220, overflowY: 'auto' }}>{recoContent}</div>
              : <div style={{ ...sub, padding: '0.25rem 0' }}>{recoLocked
                  ? L('No notes were recorded for this week.', 'Không có ghi chú cho tuần này.')
                  : L('No notes yet for this week.', 'Chưa có ghi chú cho tuần này.')}</div>}
            {!recoLocked && (
              <>
                <textarea value={recoAdd} onChange={e => setRecoAdd(e.target.value)} rows={3}
                  placeholder={L('Add a supplemental note (existing notes are preserved)…', 'Thêm ghi chú bổ sung (ghi chú cũ được giữ nguyên)…')}
                  style={{ width: '100%', marginTop: '0.5rem', padding: '0.6rem', border: '1px solid var(--border,#e5e7eb)', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn btn--primary" onClick={saveReco} disabled={!recoDirty || recoStatus === 'saving'}>
                    {recoStatus === 'saving' ? L('Adding…', 'Đang thêm…') : L('Add note', 'Thêm ghi chú')}
                  </button>
                  <span style={sub}>
                    {recoStatus === 'saved' ? L('Added', 'Đã thêm')
                      : recoStatus === 'error' ? L('Save failed', 'Lưu thất bại') : ''}
                    {recoInfo.updatedBy ? `  ·  ${L('last by', 'bởi')} ${recoInfo.updatedBy}${recoInfo.updatedAt ? ` · ${new Date(recoInfo.updatedAt).toLocaleString()}` : ''}` : ''}
                  </span>
                </div>
              </>
            )}
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
            <aside className="wr-detail" style={{ width: panelWidth, position: 'relative', paddingRight: 12 }}>
              {/* Visible drag handle on the panel's RIGHT edge — drag it RIGHT to
                  extend the panel's right boundary (the area scrolls horizontally
                  once it runs out of room). Sits in a 12px gutter so it clears the
                  list's vertical scrollbar. */}
              <div onMouseDown={startPanelResize}
                   title={L('Drag right to widen this panel', 'Kéo sang phải để mở rộng bảng')}
                   onMouseEnter={e => { e.currentTarget.firstChild.style.background = 'var(--primary,#2563eb)'; }}
                   onMouseLeave={e => { e.currentTarget.firstChild.style.background = 'var(--border,#cbd5e1)'; }}
                   style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, cursor: 'col-resize', zIndex: 20,
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 4, borderRadius: 3, height: 56, background: 'var(--border,#cbd5e1)', transition: 'background 0.12s' }} />
              </div>
              <div style={{ ...card, marginBottom: 0, padding: 0, maxHeight: 'calc(100vh - 2rem)', overflow: 'auto' }}>
                {drill ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border,#e5e7eb)', position: 'sticky', top: 0, background: 'var(--bg-primary,#fff)' }}>
                      <button onClick={closeDrill} style={{ background: 'transparent', border: 'none', color: 'var(--primary,#2563eb)', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>← {L('Back', 'Quay lại')}</button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button onClick={openDrillAsList}
                          style={{ background: 'var(--primary,#2563eb)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>
                          {L('Open as list', 'Mở dạng danh sách')} →
                        </button>
                        <button onClick={closeDrill} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary,#6b7280)', fontSize: '1rem' }}>✕</button>
                      </div>
                    </div>
                    <div style={{ padding: '0.6rem 1rem 0' }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{drill.title} <span style={sub}>({drill.items.length})</span></h3>
                    </div>
                    <table style={{ tableLayout: 'fixed', width: drill.cols.reduce((s, c, ci) => s + colWidthFor(c.key, ci), 0), borderCollapse: 'collapse', marginTop: '0.4rem' }}>
                      <thead><tr>{drill.cols.map((c, ci) => {
                        const w = colWidthFor(c.key, ci);
                        return (
                          <th key={c.key} style={{ ...th, width: w, position: 'relative', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.label}
                            {/* drag the right edge to resize this column */}
                            <span onMouseDown={(e) => startColResize(e, c.key, w)}
                              style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'col-resize' }} />
                          </th>
                        );
                      })}</tr></thead>
                      <tbody>
                        {drill.items.map((it, i) => (
                          <tr key={it.studentId || i} onClick={() => openLead(it.studentId)} style={{ cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary,#f8fafc)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                            {drill.cols.map((c, ci) => {
                              const w = colWidthFor(c.key, ci);
                              return (
                                <td key={c.key} title={String(it[c.key] ?? '')}
                                  style={{ ...td, width: w, maxWidth: w, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(ci === 0 ? { fontWeight: 600, color: 'var(--primary,#2563eb)' } : {}) }}>
                                  {it[c.key] || '—'}
                                </td>
                              );
                            })}
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

        </>
      )}

      {isManager && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{L('Monthly Targets', 'Chỉ tiêu tháng')}</h2>
              <span style={sub}>{L('Contracts per month — actual / target · click a target to edit', 'Hợp đồng mỗi tháng — thực tế / chỉ tiêu · nhấn để sửa')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {showAdd ? (
                <>
                  <select value={addId} onChange={e => setAddId(e.target.value)} style={{ padding: '0.35rem', fontSize: '0.85rem' }}>
                    <option value="">{L('— Select staff —', '— Chọn nhân viên —')}</option>
                    {roster
                      .filter(s => !(targets?.rows || []).some(r => r.staffId === s.id))
                      .map(s => <option key={s.id} value={s.id}>{s.fullName}{s.role ? ` (${s.role})` : ''}</option>)}
                  </select>
                  <button className="btn" onClick={addTracked} disabled={!addId}>{L('Add', 'Thêm')}</button>
                  <button className="btn" onClick={() => { setShowAdd(false); setAddId(''); }}>{L('Cancel', 'Hủy')}</button>
                </>
              ) : (
                <button className="btn" onClick={() => setShowAdd(true)}>+ {L('Add counsellor', 'Thêm tư vấn')}</button>
              )}
            </div>
          </div>

          {targetsLoading && !targets && <div style={sub}>{L('Loading…', 'Đang tải…')}</div>}
          {targets && targets.rows.length === 0 && (
            <div style={sub}>{L('No counsellors tracked yet — use Add counsellor.', 'Chưa có tư vấn nào — dùng Thêm tư vấn.')}</div>
          )}

          {targets && targets.rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>2026</th>
                    {targets.rows.map(r => (
                      <th key={r.staffId} style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.fullName}
                        <span onClick={() => removeTracked(r.staffId)} title={L('Remove', 'Xóa')}
                          style={{ marginLeft: 6, cursor: 'pointer', color: 'var(--text-secondary,#9ca3af)' }}>×</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {targets.months.map(mo => (
                    <tr key={mo.label}>
                      <td style={{ ...td, fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>{mo.label}</td>
                      {targets.rows.map(r => {
                        const c = r.cells[mo.label] || { actual: 0, target: 0, isFallback: true };
                        const editing = editCell && editCell.staffId === r.staffId && editCell.month === mo.label;
                        return (
                          <td key={r.staffId} style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ color: cellColor(c.actual, c.target), fontWeight: 600 }}>{c.actual}</span>
                            <span style={{ color: 'var(--text-secondary,#9ca3af)' }}> / </span>
                            {editing ? (
                              <input type="number" min="0" value={editVal} autoFocus
                                onChange={e => setEditVal(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter')  { skipBlurRef.current = true; saveTarget(r.staffId, mo.label, editVal); }
                                  if (e.key === 'Escape') { skipBlurRef.current = true; setEditCell(null); }
                                }}
                                onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } saveTarget(r.staffId, mo.label, editVal); }}
                                style={{ width: 44, padding: '2px 4px', fontSize: '0.8rem', textAlign: 'right' }} />
                            ) : (
                              <span onClick={() => { setEditCell({ staffId: r.staffId, month: mo.label }); setEditVal(String(c.target)); }}
                                title={c.isFallback ? L('Inherited staff target — click to set a monthly target', 'Chỉ tiêu mặc định — nhấn để đặt theo tháng') : L('Click to edit', 'Nhấn để sửa')}
                                style={{ cursor: 'pointer', fontStyle: c.isFallback ? 'italic' : 'normal', color: c.isFallback ? 'var(--text-secondary,#9ca3af)' : 'inherit' }}>
                                {c.target}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...td, fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>{L('YTD', 'Năm')}</td>
                    {targets.rows.map(r => (
                      <td key={r.staffId} style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <span style={{ color: cellColor(r.ytd.actual, r.ytd.target) }}>{r.ytd.actual}</span>
                        <span style={{ color: 'var(--text-secondary,#9ca3af)' }}> / {r.ytd.target}</span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WeeklyReport() {
  return <ErrorBoundary><WeeklyReportInner /></ErrorBoundary>;
}
