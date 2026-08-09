// LeadManagement/src/pages/MonthlyReport.jsx
//
// PURPOSE
//   Sales + Marketing Monthly Report (Report -> Monthly Report). Automates
//   what's derivable from existing data (Team Performance/Convert Rate,
//   Contract Sources, Pre-sales call/meeting/handoff stats, Marketing
//   per-activity leads/funnel/cost) and cleanly surfaces the few things that
//   must stay manual (Giờ gọi) rather than pretending they're automated.
//
// WHAT'S NOT SHOWN / CAVEATS
//   - Khách chuyển (presales->sales handoffs) only catches handoffs done
//     through the normal lead-edit flow (which logs to audit_log) — the bulk
//     distribution paths never touch the `presales` field, so a handoff done
//     that way won't appear here.
//   - "Total leads" per counselor is a CURRENT-assignment count, not a full
//     historical reconstruction — a lead reassigned away won't count.
//   - Marketing per-activity data only shows leads registered through the
//     "Event/Campaign" source mode against a real `events` row — it depends
//     on marketing staff actually creating those rows for small activities.

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiChevronDown, FiChevronRight, FiArrowRight, FiRefreshCw } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI } from '../services/api';
import Watermark from '../components/Watermark';
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from '../utils/leadStatusLabels';

// dataviz skill's validated default categorical palette (8 slots, light mode,
// ΔE-checked) — same instance EventReport.jsx already uses, reused here for
// visual consistency rather than re-deriving/re-validating a new one.
const CATEGORICAL = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#94A3B8';
const PIE_MAX_SLICES = 7; // + 1 folded "Khác/Other" slice, keeps within the validated 8-slot categorical set

// Folds a rollup into pie-ready {name, value, key} data, sorted descending,
// capped at PIE_MAX_SLICES + one "Other" slice — same helper as EventReport.jsx.
function toPieData(rows, metricKey, nameFn, keyFn, otherLabel) {
  const withValue = (rows || [])
    .map((r) => ({ name: nameFn(r), value: r[metricKey], key: keyFn(r) }))
    .filter((r) => r.value > 0);
  withValue.sort((a, b) => b.value - a.value);
  if (withValue.length <= PIE_MAX_SLICES) return withValue;
  const top = withValue.slice(0, PIE_MAX_SLICES);
  const restSum = withValue.slice(PIE_MAX_SLICES).reduce((s, r) => s + r.value, 0);
  return [...top, { name: otherLabel, value: restSum, key: '__other__' }];
}

// Direct label outside each slice with a leader line — labels never fit
// reliably inside a mark this size, and text never wears the slice's own
// color (dataviz skill). Identical to EventReport.jsx's renderPieLabel.
function renderPieLabel({ cx, cy, midAngle, outerRadius, value, percent }) {
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 16;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central"
      style={{ fontSize: '0.65rem', fill: 'var(--text-secondary)' }}>
      {`${value} (${Math.round(percent * 100)}%)`}
    </text>
  );
}

function PieCard({ title, data, colorFor }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="section-card" style={{ padding: '0.75rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center', color: 'var(--text-primary)' }}>{title}</div>
      {!data.length ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '3rem 0' }}>—</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data} dataKey="value" nameKey="name" cx="50%" cy="44%" outerRadius={58} paddingAngle={1}
              label={renderPieLabel} labelLine={{ stroke: 'var(--border)' }}>
              {data.map((entry, i) => (
                <Cell key={entry.name + i} fill={colorFor(entry, i)} stroke="var(--bg-primary)" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} (${total ? Math.round((value / total) * 100) : 0}%)`, name]} />
            <Legend wrapperStyle={{ fontSize: '0.68rem' }} layout="horizontal" verticalAlign="bottom" />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function pieColor(entry, i) {
  return entry.key === '__other__' ? OTHER_COLOR : CATEGORICAL[i % CATEGORICAL.length];
}

function fmtVnd(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('vi-VN') + ' đ';
}

const COLORS = { primary: '#2563EB', good: '#10B981', warn: '#F59E0B', danger: '#DC2626', neutral: '#94A3B8' };
const CASE_TYPES = ['Du học', 'Du học hè', 'Thị thực Du lịch', 'Thị thực Khác'];

function fmtPct(n) {
  return n == null ? '—' : `${n}%`;
}
function fmtNum(n) {
  return n == null ? '—' : n;
}
function currentMonthLabel() {
  return new Date().toISOString().slice(0, 7);
}

// ── Stat card (matches EventReport.jsx / ActivityReport.jsx convention) ──
// onClick/active are optional — same clickable-tile pattern EventReport.jsx's
// KPI strip already uses for its drill-down panels.
function StatCard({ label, value, sub, color, onClick, active }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? 'var(--primary-light)' : 'var(--bg-primary)',
        border: `1px solid ${active ? (color || 'var(--primary, #2563EB)') : 'var(--border)'}`,
        borderRadius: '10px', padding: '1rem 1.25rem',
        borderLeft: `4px solid ${color || 'var(--border)'}`,
        cursor: clickable ? 'pointer' : 'default',
      }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

// Same drill-down pattern as EventReport.jsx's KpiDrilldownPanel — a quick
// "who's behind this number" list, click a row to jump to the lead.
function ContractedDrilldownPanel({ leads, navigate, L }) {
  return (
    <div className="section-card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="leads-data-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{L('Name', 'Tên')}</th>
            <th style={{ textAlign: 'left' }}>{L('Source', 'Nguồn')}</th>
            <th style={{ textAlign: 'left' }}>{L('Counselor', 'Tư vấn viên')}</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.leadId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.studentId}`)}>
              <td style={{ fontWeight: 500 }}>{l.fullName || '—'}</td>
              <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.sourceLabel}</td>
              <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.counselor || ''}</td>
              <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
            </tr>
          ))}
          {!leads.length && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
              {L('Nothing here', 'Không có dữ liệu')}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Slices a counselor row's contractedDetail (leadId/studentId/fullName/
// caseType/isOutOfSystem) down to whichever Team Performance cell was
// clicked — In system / Out system (+ unclassified) / a specific case type.
function filterContractedDetail(detail, cellKey) {
  const rows = detail || [];
  if (cellKey === 'inSystem') return rows.filter((d) => d.isOutOfSystem === false);
  if (cellKey === 'outSystem') return rows.filter((d) => d.isOutOfSystem !== false); // true or null (unclassified)
  if (cellKey?.startsWith('caseType:')) {
    const type = cellKey.slice('caseType:'.length);
    return rows.filter((d) => d.caseType === type);
  }
  return [];
}

// Slices a presales staffer's callDetail (every note counted toward Total
// calls) down to whichever cell was clicked — the full list, or just the
// KBM (unanswered) subset.
function filterCallDetail(detail, cellKey) {
  const rows = detail || [];
  if (cellKey === 'total') return rows.filter((d) => d.bucket === 'new' || d.bucket === 'ongoing');
  if (cellKey === 'new') return rows.filter((d) => d.bucket === 'new');
  if (cellKey === 'ongoing') return rows.filter((d) => d.bucket === 'ongoing');
  // Uses the classified bucket (toggle OR keyword), not just the explicit
  // callAnswered===false toggle — so the drill-down list matches the KBM
  // count exactly, including keyword-inferred KBM notes.
  if (cellKey === 'kbm') return rows.filter((d) => d.bucket === 'kbm');
  return [];
}

// "Click a number, see the receipts" for Total calls / KBM — every
// underlying note, with enough context (date, lead, platform, content,
// answered) for someone to judge for themselves whether each one legitimately
// counts, click-through to the lead for full context.
function CallDetailDrilldownPanel({ notes, navigate, L, language }) {
  return (
    <table className="leads-data-table" style={{ width: '100%' }}>
      <thead><tr>
        <th style={{ textAlign: 'left' }}>{L('Date', 'Ngày')}</th>
        <th style={{ textAlign: 'left' }}>{L('Lead', 'Khách hàng')}</th>
        <th style={{ textAlign: 'left' }}>{L('Platform', 'Kênh')}</th>
        <th style={{ textAlign: 'left' }}>{L('Note', 'Ghi chú')}</th>
        <th style={{ textAlign: 'left' }}>{L('Answered', 'Bắt máy')}</th>
        <th style={{ width: '40px' }}></th>
      </tr></thead>
      <tbody>
        {notes.map((n) => (
          <tr key={n.noteId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${n.studentId}`)}>
            <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
              {new Date(n.createdAt).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </td>
            <td style={{ fontWeight: 500 }}>{n.fullName || '—'}</td>
            <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{n.contactPlatform || '—'}</td>
            <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {n.content || ''}
            </td>
            <td style={{ fontSize: '0.78rem' }}>
              {n.kbmSource === 'toggle' ? L('No', 'Không')
                : n.kbmSource === 'keyword' ? L('No (keyword)', 'Không (từ khóa)')
                : n.callAnswered === true ? L('Yes', 'Có') : '—'}
            </td>
            <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
          </tr>
        ))}
        {!notes.length && (
          <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '0.75rem' }}>
            {L('Nothing here', 'Không có dữ liệu')}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}

// Plain-number inline-edit cell (EventReport.jsx's EditableNumber, but no
// VND formatting — Giờ gọi is hours, not currency).
function EditableHours({ value, onSave, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  if (!editing) {
    return (
      <span onClick={() => setEditing(true)} title="Click to edit"
        style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border)' }}>
        {value == null ? (placeholder || '— (click to enter)') : value}
      </span>
    );
  }
  return (
    <input
      autoFocus type="number" className="form-input" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft === '' ? null : Number(draft)); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); onSave(draft === '' ? null : Number(draft)); }
        if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); }
      }}
      style={{ width: '90px' }}
    />
  );
}

export default function MonthlyReport() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const [month, setMonth] = useState(currentMonthLabel());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedTransfers, setExpandedTransfers] = useState(new Set());
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [contractedExpanded, setContractedExpanded] = useState(false);
  const [expandedTeamCell, setExpandedTeamCell] = useState(null); // `${staffId}|inSystem` | `${staffId}|outSystem` | `${staffId}|caseType:<type>` | null
  const [expandedCallCell, setExpandedCallCell] = useState(null); // `${staffId}|total` | `${staffId}|kbm` | null
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesMsg, setNotesMsg] = useState('');

  useEffect(() => {
    pushTrail({ label: L('Monthly Report', 'Báo cáo tháng'), path: '/reports/monthly' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushTrail, language]);

  const load = useCallback(async (m) => {
    setLoading(true); setError(''); setExpandedTransfers(new Set()); setContractedExpanded(false); setExpandedTeamCell(null); setExpandedCallCell(null);
    try {
      const [reportRes, notesRes] = await Promise.all([
        reportsAPI.monthlyReport(m),
        reportsAPI.monthlyNotes(m),
      ]);
      setReport(reportRes.data || null);
      setNotes(notesRes.data?.content || '');
    } catch (e) {
      setError(e.message || 'Failed to load monthly report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (month) load(month); }, [month, load]);

  async function handleSaveHours(staffId, hours) {
    await reportsAPI.saveCallHours(staffId, month, hours);
    load(month);
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    try {
      await reportsAPI.saveMonthlyNotes(month, notes);
      setNotesMsg(L('Saved', 'Đã lưu'));
      setTimeout(() => setNotesMsg(''), 2000);
    } catch (e) {
      setNotesMsg(L('Failed to save: ', 'Lưu thất bại: ') + e.message);
    } finally {
      setNotesSaving(false);
    }
  }

  function toggleTransfers(staffId) {
    setExpandedTransfers((prev) => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId); else next.add(staffId);
      return next;
    });
  }

  function toggleActivity(eventId) {
    setExpandedActivities((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  }

  const totalContracted = (report?.teamPerformance || []).reduce((s, r) => s + r.contractedTotal, 0);
  const totalTarget = (report?.teamPerformance || []).reduce((s, r) => s + (r.target || 0), 0);
  const totalCalls = (report?.presalesReport || []).reduce((s, r) => s + r.totalCalls, 0);
  const totalKbm = (report?.presalesReport || []).reduce((s, r) => s + r.kbmCount, 0);

  // Totals rows for each table — company-wide %/Convert %/Avg KBM-hour are
  // recomputed from the summed numerators/denominators (sum-of-rates would be
  // mathematically wrong), not an average of each row's own percentage.
  const teamTotals = useMemo(() => {
    const rows = report?.teamPerformance || [];
    const t = {
      target: 0, contractedTotal: 0, inSystem: 0, outSystem: 0, unclassified: 0,
      byCaseType: Object.fromEntries(CASE_TYPES.map((c) => [c, 0])),
      totalLeads: 0, newLeadsThisMonth: 0,
      calls: 0, newCalls: 0, ongoingCalls: 0, kbmCalls: 0, callsKpi: 0, basicLetters: 0, finalLetters: 0,
    };
    for (const r of rows) {
      t.target += r.target || 0;
      t.contractedTotal += r.contractedTotal;
      t.inSystem += r.inSystem;
      t.outSystem += r.outSystem;
      t.unclassified += r.unclassified;
      for (const c of CASE_TYPES) t.byCaseType[c] += r.byCaseType[c] || 0;
      t.totalLeads += r.totalLeads;
      t.newLeadsThisMonth += r.newLeadsThisMonth;
      t.calls += r.calls || 0;
      t.newCalls += r.newCalls || 0;
      t.ongoingCalls += r.ongoingCalls || 0;
      t.kbmCalls += r.kbmCalls || 0;
      t.callsKpi += r.callsKpi || 0;
      t.basicLetters += r.basicLetters || 0;
      t.finalLetters += r.finalLetters || 0;
    }
    t.pct = t.target ? Math.round((t.contractedTotal / t.target) * 1000) / 10 : null;
    t.convertRate = t.totalLeads ? Math.round((t.contractedTotal / t.totalLeads) * 1000) / 10 : null;
    t.pctCallsKpi = t.callsKpi ? Math.round((t.calls / t.callsKpi) * 1000) / 10 : null;
    return t;
  }, [report]);

  const contractResourcesTotal = (report?.contractResources || []).reduce((s, r) => s + r.count, 0);

  const presalesTotals = useMemo(() => {
    const rows = report?.presalesReport || [];
    const t = { hours: 0, hasHours: false, totalCalls: 0, newCalls: 0, ongoingCalls: 0, kbmCount: 0, meetingsCount: 0, transferred: 0, callsKpi: 0 };
    for (const r of rows) {
      if (r.hours != null) { t.hours += r.hours; t.hasHours = true; }
      t.totalCalls += r.totalCalls;
      t.newCalls += r.newCalls || 0;
      t.ongoingCalls += r.ongoingCalls || 0;
      t.kbmCount += r.kbmCount;
      t.meetingsCount += r.meetingsCount;
      t.transferred += r.transferred.length;
      t.callsKpi += r.callsKpi || 0;
    }
    t.avgKbmPerHour = t.hasHours && t.hours ? Math.round((t.kbmCount / t.hours) * 100) / 100 : null;
    t.pctCallsKpi = t.callsKpi ? Math.round((t.totalCalls / t.callsKpi) * 1000) / 10 : null;
    return t;
  }, [report]);

  const activitiesTotals = useMemo(() => {
    const rows = report?.activities || [];
    const t = { leadCount: 0, totalCostPlanned: 0, hasCostPlanned: false, totalCostActual: 0, hasCostActual: false };
    for (const a of rows) {
      t.leadCount += a.leadCount;
      if (a.totalCostPlanned != null) { t.totalCostPlanned += a.totalCostPlanned; t.hasCostPlanned = true; }
      if (a.totalCostActual != null) { t.totalCostActual += a.totalCostActual; t.hasCostActual = true; }
    }
    return t;
  }, [report]);

  const teamChartData = useMemo(() => (report?.teamPerformance || []).map((r) => ({
    name: r.fullName, target: r.target, inSystem: r.inSystem, outSystem: r.outSystem,
  })), [report]);
  const contractResourcesPieData = useMemo(() => toPieData(
    report?.contractResources, 'count', (r) => r.sourceLabel, (r) => r.sourceLabel, L('Other', 'Khác')
  ), [report, language]);

  // Pre-sales: raw counts (Total calls vs KBM) side by side with the derived
  // rate (Avg KBM/hour) — same two-chart pattern as Team Performance above.
  const presalesCountData = useMemo(() => (report?.presalesReport || []).map((r) => ({
    name: r.fullName, totalCalls: r.totalCalls, kbmCount: r.kbmCount,
  })), [report]);
  const presalesRateData = useMemo(() => (report?.presalesReport || [])
    .filter((r) => r.avgKbmPerHour != null)
    .map((r) => ({ name: r.fullName, rate: r.avgKbmPerHour })), [report]);

  // Marketing: leads-per-activity magnitude, plus a stacked funnel-by-activity
  // breakdown. Statuses are ordered per LEAD_STATUSES (fixed order, never
  // data-sorted) and capped to the 8-slot categorical palette, folding any
  // overflow into one "Other" segment — same cap/fold rule as toPieData.
  const activitiesLeadCountData = useMemo(() => (report?.activities || [])
    .map((a) => ({ name: a.name, leads: a.leadCount }))
    .sort((a, b) => b.leads - a.leads), [report]);
  const funnelStatusKeys = useMemo(() => {
    const present = new Set();
    (report?.activities || []).forEach((a) => Object.keys(a.byStatus || {}).forEach((s) => present.add(s)));
    const ordered = LEAD_STATUSES.filter((s) => present.has(s));
    return ordered.length <= PIE_MAX_SLICES ? ordered : ordered.slice(0, PIE_MAX_SLICES);
  }, [report]);
  const activitiesFunnelFolded = useMemo(() => {
    const present = new Set();
    (report?.activities || []).forEach((a) => Object.keys(a.byStatus || {}).forEach((s) => present.add(s)));
    return LEAD_STATUSES.filter((s) => present.has(s)).length > PIE_MAX_SLICES;
  }, [report]);
  const activitiesFunnelData = useMemo(() => (report?.activities || []).map((a) => {
    const row = { name: a.name };
    let otherSum = 0;
    Object.entries(a.byStatus || {}).forEach(([status, count]) => {
      if (funnelStatusKeys.includes(status)) row[status] = count;
      else otherSum += count;
    });
    if (activitiesFunnelFolded && otherSum > 0) row.__other__ = otherSum;
    return row;
  }), [report, funnelStatusKeys, activitiesFunnelFolded]);

  return (
    <div>
      <Watermark />
      <div className="page-header">
        <span className="page-title">{L('Monthly Report', 'Báo cáo tháng')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="month" className="form-input" value={month} onChange={(e) => setMonth(e.target.value)} />
          {/* Numbers only refresh on load/month-change — staff who leave this
              tab open while making calls elsewhere were seeing stale totals
              and assuming the count wasn't working. Explicit refresh so
              there's an obvious way to pull the latest without an F5. */}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => load(month)} disabled={loading}
                  title={L('Refresh', 'Làm mới')}>
            <FiRefreshCw size={14} /> {L('Refresh', 'Làm mới')}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <div className="alert alert--error">{error}</div>}
        {loading && !report && <div className="loading-center">{L('Loading...', 'Đang tải...')}</div>}

        {report && (
          <>
            {/* ── KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
              <StatCard
                label={L('Contracted (Total)', 'Tổng HĐ')} value={fmtNum(totalContracted)} sub={`${L('Target', 'Chỉ tiêu')}: ${totalTarget}`} color={COLORS.primary}
                active={contractedExpanded} onClick={() => setContractedExpanded((v) => !v)}
              />
              <StatCard label={L('Total calls', 'Tổng cuộc gọi')} value={fmtNum(totalCalls)} color={COLORS.good} />
              <StatCard label={L('Unanswered (KBM)', 'Số cuộc KBM')} value={fmtNum(totalKbm)} color={COLORS.warn} />
              <StatCard label={L('Contract Sources', 'Nguồn HĐ')} value={fmtNum((report.contractResources || []).length)} sub={L('distinct sources', 'nguồn khác nhau')} color={COLORS.neutral} />
            </div>
            {contractedExpanded && (
              <ContractedDrilldownPanel leads={report.contractedLeads || []} navigate={navigate} L={L} />
            )}

            {/* ── Team Performance / Convert Rate ── */}
            <div className="section-card">
              <div className="section-header"><span className="section-title">{L('Team Performance / Convert Rate', 'Hiệu suất đội / Tỉ lệ chuyển đổi')}</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table className="leads-data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{L('Counselor', 'Tư vấn viên')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Target', 'Chỉ tiêu')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Contracted', 'Đã ký HĐ')}</th>
                      <th style={{ textAlign: 'right' }}>{L('In system', 'Trong hệ thống')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Out system', 'Ngoài hệ thống')}</th>
                      <th style={{ textAlign: 'right' }}>{L('% KPI', '% KPI')}</th>
                      {CASE_TYPES.map((t) => <th key={t} style={{ textAlign: 'right' }}>{t}</th>)}
                      <th style={{ textAlign: 'right' }}>{L('Total leads', 'Tổng leads')}</th>
                      <th style={{ textAlign: 'right' }}>{L('New this month', 'Mới tháng này')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Convert %', 'Tỉ lệ %')}</th>
                      <th style={{ textAlign: 'right' }} title={L('First-ever successful contact', 'Lần đầu liên hệ thành công')}>{L('New', 'Mới')}</th>
                      <th style={{ textAlign: 'right' }} title={L('Follow-up successful contacts', 'Liên hệ lại thành công')}>{L('Ongoing', 'Tiếp tục')}</th>
                      <th style={{ textAlign: 'right' }} title={L('Không bắt máy', 'Không bắt máy')}>{L('KBM', 'KBM')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Calls', 'Cuộc gọi')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Calls KPI', 'KPI cuộc gọi')}</th>
                      <th style={{ textAlign: 'right' }}>{L('% Calls KPI', '% KPI cuộc gọi')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Basic Counseling Letter', 'Thư tư vấn sơ bộ')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Final Counseling Letter', 'Thư tư vấn cuối')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.teamPerformance || []).map((r) => {
                      const cellKey = expandedTeamCell?.startsWith(`${r.staffId}|`) ? expandedTeamCell.slice(String(r.staffId).length + 1) : null;
                      const drilldownLeads = cellKey ? filterContractedDetail(r.contractedDetail, cellKey) : null;
                      const toggleCell = (key, count) => {
                        if (!count) return;
                        setExpandedTeamCell((k) => (k === `${r.staffId}|${key}` ? null : `${r.staffId}|${key}`));
                      };
                      const clickableStyle = (count) => ({ textAlign: 'right', cursor: count ? 'pointer' : 'default', textDecoration: count ? 'underline dotted' : 'none' });
                      return (
                        <Fragment key={r.staffId}>
                          <tr>
                            <td>{r.fullName}</td>
                            <td style={{ textAlign: 'right' }} title={r.isFallback ? L('Default target', 'Chỉ tiêu mặc định') : ''}>{r.target}{r.isFallback ? '*' : ''}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.contractedTotal}</td>
                            <td style={clickableStyle(r.inSystem)} onClick={() => toggleCell('inSystem', r.inSystem)}>{r.inSystem}</td>
                            <td style={clickableStyle(r.outSystem + r.unclassified)} onClick={() => toggleCell('outSystem', r.outSystem + r.unclassified)}>
                              {r.outSystem}{r.unclassified ? ` (+${r.unclassified} ?)` : ''}
                            </td>
                            <td style={{ textAlign: 'right' }}>{r.target ? fmtPct(Math.round((r.contractedTotal / r.target) * 1000) / 10) : '—'}</td>
                            {CASE_TYPES.map((t) => (
                              <td key={t} style={clickableStyle(r.byCaseType[t])} onClick={() => toggleCell(`caseType:${t}`, r.byCaseType[t])}>
                                {r.byCaseType[t] || 0}
                              </td>
                            ))}
                            <td style={{ textAlign: 'right' }}>{r.totalLeads}</td>
                            <td style={{ textAlign: 'right' }}>{r.newLeadsThisMonth}</td>
                            <td style={{ textAlign: 'right' }}>{fmtPct(r.convertRate)}</td>
                            <td style={{ textAlign: 'right' }}>{r.newCalls}</td>
                            <td style={{ textAlign: 'right' }}>{r.ongoingCalls}</td>
                            <td style={{ textAlign: 'right' }}>{r.kbmCalls}</td>
                            <td style={{ textAlign: 'right' }}>{r.calls}</td>
                            <td style={{ textAlign: 'right' }}>{r.callsKpi}</td>
                            <td style={{ textAlign: 'right' }}>{fmtPct(r.pctCallsKpi)}</td>
                            <td style={{ textAlign: 'right' }}>{r.basicLetters}</td>
                            <td style={{ textAlign: 'right' }}>{r.finalLetters}</td>
                          </tr>
                          {drilldownLeads && (
                            <tr>
                              <td colSpan={21} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                <table className="leads-data-table" style={{ width: '100%' }}>
                                  <thead><tr>
                                    <th style={{ textAlign: 'left' }}>{L('Name', 'Tên')}</th>
                                    <th style={{ width: '40px' }}></th>
                                  </tr></thead>
                                  <tbody>
                                    {drilldownLeads.map((l) => (
                                      <tr key={l.leadId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.studentId}`)}>
                                        <td style={{ fontWeight: 500 }}>{l.fullName || '—'}</td>
                                        <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
                                      </tr>
                                    ))}
                                    {!drilldownLeads.length && (
                                      <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '0.75rem' }}>
                                        {L('Nothing here', 'Không có dữ liệu')}
                                      </td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {!(report.teamPerformance || []).length && (
                      <tr><td colSpan={21} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                        {L('No counselors found', 'Không tìm thấy tư vấn viên')}
                      </td></tr>
                    )}
                  </tbody>
                  {(report.teamPerformance || []).length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                        <td>{L('Total', 'Tổng cộng')}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.target}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.contractedTotal}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.inSystem}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.outSystem}{teamTotals.unclassified ? ` (+${teamTotals.unclassified} ?)` : ''}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPct(teamTotals.pct)}</td>
                        {CASE_TYPES.map((t) => <td key={t} style={{ textAlign: 'right' }}>{teamTotals.byCaseType[t]}</td>)}
                        <td style={{ textAlign: 'right' }}>{teamTotals.totalLeads}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.newLeadsThisMonth}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPct(teamTotals.convertRate)}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.newCalls}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.ongoingCalls}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.kbmCalls}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.calls}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.callsKpi}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPct(teamTotals.pctCallsKpi)}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.basicLetters}</td>
                        <td style={{ textAlign: 'right' }}>{teamTotals.finalLetters}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                * {L('Target not set for this month — showing the staff-level default.', 'Chưa đặt chỉ tiêu cho tháng này — hiển thị chỉ tiêu mặc định.')}
                {' '}{L('Total row: % KPI, Convert %, and % Calls KPI are company-wide (sum ÷ sum), not an average of each row.', 'Dòng tổng: % KPI, Tỉ lệ % và % KPI cuộc gọi tính theo toàn công ty (tổng ÷ tổng), không phải trung bình từng dòng.')}
                {' '}{L('Calls KPI is auto-computed from the per-weekday counselor call targets (same ones Weekly Report uses), summed across every day actually in the month.', 'KPI cuộc gọi tự tính từ chỉ tiêu cuộc gọi theo ngày trong tuần của tư vấn viên (giống Báo cáo tuần), cộng dồn theo đúng số ngày trong tháng.')}
              </div>

              {teamChartData.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center' }}>
                    {L('Target vs Contracted', 'Chỉ tiêu vs Đã ký HĐ')}
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={teamChartData} barGap={2} margin={{ top: 24, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} angle={-30} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                      <Tooltip />
                      <Legend verticalAlign="top" align="center" wrapperStyle={{ fontSize: '0.7rem', paddingBottom: '6px' }} />
                      <Bar dataKey="target" name={L('Target', 'Chỉ tiêu')} fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="inSystem" name={L('In system', 'Trong hệ thống')} fill={CATEGORICAL[1]} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="outSystem" name={L('Out system', 'Ngoài hệ thống')} fill={CATEGORICAL[2]} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ── Contract Sources ── */}
            <div className="section-card">
              <div className="section-header"><span className="section-title">{L('Contract Sources (Nguồn HĐ)', 'Nguồn hợp đồng')}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: (report.contractResources || []).length ? '1fr 320px' : '1fr', gap: '1rem', alignItems: 'start' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="leads-data-table" style={{ width: '100%' }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left' }}>{L('Source', 'Nguồn')}</th>
                    <th style={{ textAlign: 'right' }}>{L('Contracts', 'Số HĐ')}</th>
                  </tr></thead>
                  <tbody>
                    {(report.contractResources || []).map((r) => (
                      <tr key={r.sourceLabel}>
                        <td>{r.sourceLabel}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.count}</td>
                      </tr>
                    ))}
                    {!(report.contractResources || []).length && (
                      <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                        {L('No contracts this month', 'Chưa có hợp đồng nào trong tháng')}
                      </td></tr>
                    )}
                  </tbody>
                  {(report.contractResources || []).length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                        <td>{L('Total', 'Tổng cộng')}</td>
                        <td style={{ textAlign: 'right' }}>{contractResourcesTotal}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {(report.contractResources || []).length > 0 && (
                <PieCard title={L('Share by source', 'Tỉ trọng theo nguồn')} data={contractResourcesPieData} colorFor={pieColor} />
              )}
              </div>
            </div>

            {/* ── Pre-sales stats ── */}
            <div className="section-card">
              <div className="section-header"><span className="section-title">{L('Pre-sales', 'Pre-sales')}</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table className="leads-data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{L('Staff', 'Nhân viên')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Total Call Hour KPI', 'Giờ gọi (thủ công)')}</th>
                      <th style={{ textAlign: 'right' }} title={L('First-ever successful contact', 'Lần đầu liên hệ thành công')}>{L('New', 'Mới')}</th>
                      <th style={{ textAlign: 'right' }} title={L('Follow-up successful contacts', 'Liên hệ lại thành công')}>{L('Ongoing', 'Tiếp tục')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Total calls', 'Tổng cuộc gọi')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Calls KPI', 'KPI cuộc gọi')}</th>
                      <th style={{ textAlign: 'right' }}>{L('% Calls KPI', '% KPI cuộc gọi')}</th>
                      <th style={{ textAlign: 'right' }}>{L('KBM (unanswered)', 'Số cuộc KBM')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Avg KBM/hour', 'TB KBM/giờ')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Meetings', 'Cuộc hẹn')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Transferred to Sales', 'Khách chuyển')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.presalesReport || []).map((r) => {
                      const callCellKey = expandedCallCell?.startsWith(`${r.staffId}|`) ? expandedCallCell.slice(String(r.staffId).length + 1) : null;
                      const callDrilldownNotes = callCellKey ? filterCallDetail(r.callDetail, callCellKey) : null;
                      const toggleCallCell = (key, count) => {
                        if (!count) return;
                        setExpandedCallCell((k) => (k === `${r.staffId}|${key}` ? null : `${r.staffId}|${key}`));
                      };
                      const clickableStyle = (count) => ({ textAlign: 'right', cursor: count ? 'pointer' : 'default', textDecoration: count ? 'underline dotted' : 'none' });
                      return (
                        <Fragment key={r.staffId}>
                          <tr>
                            <td>{r.fullName}</td>
                            <td style={{ textAlign: 'right' }}>
                              <EditableHours value={r.hours} onSave={(v) => handleSaveHours(r.staffId, v)} placeholder={L('— (click to enter)', '— (bấm để nhập)')} />
                            </td>
                            <td style={clickableStyle(r.newCalls)} onClick={() => toggleCallCell('new', r.newCalls)}>{r.newCalls}</td>
                            <td style={clickableStyle(r.ongoingCalls)} onClick={() => toggleCallCell('ongoing', r.ongoingCalls)}>{r.ongoingCalls}</td>
                            <td style={clickableStyle(r.totalCalls)} onClick={() => toggleCallCell('total', r.totalCalls)}>{r.totalCalls}</td>
                            <td style={{ textAlign: 'right' }}>{r.callsKpi}</td>
                            <td style={{ textAlign: 'right' }}>{fmtPct(r.pctCallsKpi)}</td>
                            <td style={clickableStyle(r.kbmCount)} onClick={() => toggleCallCell('kbm', r.kbmCount)}>{r.kbmCount}</td>
                            <td style={{ textAlign: 'right' }}>{r.avgKbmPerHour == null ? '—' : r.avgKbmPerHour}</td>
                            <td style={{ textAlign: 'right' }}>{r.meetingsCount}</td>
                            <td style={{ textAlign: 'right', cursor: r.transferred.length ? 'pointer' : 'default' }}
                              onClick={() => r.transferred.length && toggleTransfers(r.staffId)}>
                              {r.transferred.length ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  {expandedTransfers.has(r.staffId) ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                                  {r.transferred.length}
                                </span>
                              ) : 0}
                            </td>
                          </tr>
                          {expandedTransfers.has(r.staffId) && r.transferred.length > 0 && (
                            <tr key={`${r.staffId}-transfers`}>
                              <td colSpan={11} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                <table className="leads-data-table" style={{ width: '100%' }}>
                                  <thead><tr>
                                    <th style={{ textAlign: 'left' }}>{L('Name', 'Tên')}</th>
                                    <th style={{ textAlign: 'left' }}>{L('Country', 'Quốc gia')}</th>
                                    <th style={{ textAlign: 'left' }}>{L('Received by', 'Người nhận')}</th>
                                    <th style={{ textAlign: 'left' }}>{L('Transferred', 'Ngày chuyển')}</th>
                                    <th style={{ width: '40px' }}></th>
                                  </tr></thead>
                                  <tbody>
                                    {r.transferred.map((t) => (
                                      <tr key={t.leadId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${t.studentId}`)}>
                                        <td>{t.fullName}</td>
                                        <td>{t.country || '—'}</td>
                                        <td>{t.receivedBy || '—'}</td>
                                        <td>{t.transferredAt ? new Date(t.transferredAt).toLocaleDateString('vi-VN') : '—'}</td>
                                        <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                          {callDrilldownNotes && (
                            <tr key={`${r.staffId}-calls`}>
                              <td colSpan={11} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                <CallDetailDrilldownPanel notes={callDrilldownNotes} navigate={navigate} L={L} language={language} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {!(report.presalesReport || []).length && (
                      <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                        {L('No pre-sales staff found', 'Không tìm thấy nhân viên pre-sales')}
                      </td></tr>
                    )}
                  </tbody>
                  {(report.presalesReport || []).length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                        <td>{L('Total', 'Tổng cộng')}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.hasHours ? presalesTotals.hours : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.newCalls}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.ongoingCalls}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.totalCalls}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.callsKpi}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPct(presalesTotals.pctCallsKpi)}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.kbmCount}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.avgKbmPerHour == null ? '—' : presalesTotals.avgKbmPerHour}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.meetingsCount}</td>
                        <td style={{ textAlign: 'right' }}>{presalesTotals.transferred}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {presalesCountData.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center' }}>
                      {L('Total calls vs KBM', 'Tổng cuộc gọi vs KBM')}
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={presalesCountData} barGap={2} margin={{ top: 24, right: 8, left: 0, bottom: 48 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                        <Tooltip />
                        <Legend verticalAlign="top" align="center" wrapperStyle={{ fontSize: '0.7rem', paddingBottom: '6px' }} />
                        <Bar dataKey="totalCalls" name={L('Total calls', 'Tổng cuộc gọi')} fill={COLORS.good} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="kbmCount" name={L('KBM (unanswered)', 'Số cuộc KBM')} fill={COLORS.warn} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center' }}>
                      {L('Avg KBM/hour', 'TB KBM/giờ')}
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={presalesRateData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                        <Tooltip />
                        <Bar dataKey="rate" name={L('Avg KBM/hour', 'TB KBM/giờ')} fill={COLORS.warn} radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="rate" position="top" style={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {presalesRateData.length < presalesCountData.length && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.25rem' }}>
                        {L('Staff with no Giờ gọi entered are omitted here (no rate to show).', 'Nhân viên chưa nhập Giờ gọi không hiển thị ở đây.')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                {L(
                  'KBM = "Không Bắt Máy" (didn\'t pick up). Counted from the answered/not-answered toggle where it was used; falls back to scanning the note text for unanswered-call phrasing when the toggle wasn\'t used at all (shown as "No (keyword)") — an explicit "Yes" always wins over any keyword match. Transferred = handoffs logged through the normal lead-edit flow only.',
                  'KBM = "Không Bắt Máy". Tính theo nút xác nhận nếu có dùng; nếu không dùng nút, hệ thống dò từ khóa trong ghi chú (hiển thị "Không (từ khóa)") — nếu đã xác nhận "Có" thì luôn ưu tiên, không bị từ khóa ghi đè. Khách chuyển chỉ tính các trường hợp ghi nhận qua luồng chỉnh sửa lead thông thường.'
                )}
              </div>
            </div>

            {/* ── Marketing activities (per-event lead counts, funnel, cost) ── */}
            <div className="section-card">
              <div className="section-header"><span className="section-title">{L('Marketing Activities', 'Hoạt động Marketing')}</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table className="leads-data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{L('Activity', 'Hoạt động')}</th>
                      <th style={{ textAlign: 'left' }}>{L('Type', 'Loại')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Leads', 'Số leads')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Cost (planned)', 'Chi phí (Kế hoạch)')}</th>
                      <th style={{ textAlign: 'right' }}>{L('Cost (actual)', 'Chi phí (Thực tế)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.activities || []).map((a) => (
                      <Fragment key={a.eventId}>
                        <tr style={{ cursor: 'pointer' }} onClick={() => toggleActivity(a.eventId)}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              {expandedActivities.has(a.eventId) ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                              {a.name}
                            </span>
                          </td>
                          <td>{a.eventType}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{a.leadCount}</td>
                          <td style={{ textAlign: 'right' }}>{fmtVnd(a.totalCostPlanned)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtVnd(a.totalCostActual)}</td>
                        </tr>
                        {expandedActivities.has(a.eventId) && (
                          <tr>
                            <td colSpan={5} style={{ padding: '0.5rem 1rem', background: 'var(--bg-secondary)' }}>
                              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                {Object.entries(a.byStatus).map(([status, count]) => (
                                  <span key={status}>
                                    <strong>{LEAD_STATUS_LABELS[language]?.[status] || status}:</strong> {count}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    {!(report.activities || []).length && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                        {L('No activity-linked leads this month', 'Chưa có lead nào gắn với hoạt động trong tháng')}
                      </td></tr>
                    )}
                  </tbody>
                  {(report.activities || []).length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                        <td colSpan={2}>{L('Total', 'Tổng cộng')}</td>
                        <td style={{ textAlign: 'right' }}>{activitiesTotals.leadCount}</td>
                        <td style={{ textAlign: 'right' }}>{activitiesTotals.hasCostPlanned ? fmtVnd(activitiesTotals.totalCostPlanned) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{activitiesTotals.hasCostActual ? fmtVnd(activitiesTotals.totalCostActual) : '—'}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {activitiesLeadCountData.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center' }}>
                      {L('Leads by activity', 'Số leads theo hoạt động')}
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={activitiesLeadCountData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="leads" name={L('Leads', 'Số leads')} fill={COLORS.primary} radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="leads" position="top" style={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center' }}>
                      {L('Funnel by activity', 'Phễu theo hoạt động')}
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={activitiesFunnelData} margin={{ top: 36, right: 8, left: 0, bottom: 48 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                        <Tooltip formatter={(v, key) => [v, LEAD_STATUS_LABELS[language]?.[key] || (key === '__other__' ? L('Other', 'Khác') : key)]} />
                        <Legend
                          verticalAlign="top" align="center"
                          wrapperStyle={{ fontSize: '0.68rem', paddingBottom: '6px' }}
                          formatter={(key) => LEAD_STATUS_LABELS[language]?.[key] || (key === '__other__' ? L('Other', 'Khác') : key)}
                        />
                        {funnelStatusKeys.map((status, i) => (
                          <Bar key={status} dataKey={status} stackId="funnel" fill={CATEGORICAL[i % CATEGORICAL.length]} />
                        ))}
                        {activitiesFunnelFolded && (
                          <Bar dataKey="__other__" stackId="funnel" fill={OTHER_COLOR} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                {L(
                  'Only shows leads registered through the Event/Campaign source mode against a real Marketing Events entry — activities not entered there won\'t appear here.',
                  'Chỉ hiển thị các lead đăng ký qua chế độ Sự kiện/Chiến dịch với một hoạt động đã tạo trong Sự kiện Marketing — hoạt động chưa được tạo sẽ không hiển thị ở đây.'
                )}
              </div>
            </div>

            {/* ── Notes (Top/Underperformer commentary, Recommendations) ── */}
            <div className="section-card">
              <div className="section-header"><span className="section-title">{L('Notes', 'Ghi chú')}</span></div>
              <textarea
                className="form-input"
                rows={6}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={L('Top/underperformer commentary, recommendations for next month...', 'Nhận xét nhân viên nổi bật/chưa đạt, đề xuất cho tháng sau...')}
                style={{ width: '100%', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button className="btn btn--primary btn--sm" onClick={handleSaveNotes} disabled={notesSaving}>
                  {notesSaving ? L('Saving…', 'Đang lưu…') : L('Save notes', 'Lưu ghi chú')}
                </button>
                {notesMsg && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{notesMsg}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
