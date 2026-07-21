// LeadManagement/src/pages/EventReport.jsx
//
// PURPOSE
//   Event-level analytics dashboard (Report -> Event Report). Modeled on
//   ActivityReport.jsx's pattern: fetch -> client-side aggregation -> click a
//   row to drill into the underlying lead list. Two modes:
//     Single Event  — one event's lead-source breakdown (Đăng ký/Xác nhận/
//                     Tham dự + percentages + CPL), planned vs actual budget,
//                     source/tier contribution pie charts.
//     Compare       — event-level totals side by side across up to 6 events.
//
// WHAT'S NOT SHOWN / CAVEATS
//   - "Khách K" (non-lead guests - club members, performers, etc. who never
//     fill out the LQ form) can't be derived from any existing data, since
//     they never enter the lead pipeline at all. It's a manual field in the
//     Budget section, left blank/unknown until someone enters it.
//   - Per-source spend is a MANUAL field, not auto-mapped from the budget
//     ledger — the ledger is organized by campaign/vendor, lead sources are
//     organized by channel/staff/partner/school; there's no clean join.
//   - "Contracted" is a single combined count (not split into during/after
//     the event), matching how the source Excel reports count it.

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiPlus, FiTrash2, FiEdit2, FiArrowRight, FiRefreshCw, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { eventConsoleAPI } from '../services/api';
import { stoneLabel } from '../utils/stoneLabels';
import { STONE_IMAGES } from '../utils/stones';
import Watermark from '../components/Watermark';

const COLORS = { primary: '#2563EB', good: '#10B981', warn: '#F59E0B', danger: '#DC2626', neutral: '#94A3B8' };
// Matches ActivityReport.jsx's STONE_COLORS exactly, for visual consistency
// with the rest of the app wherever Stone Tier is shown.
const STONE_COLORS = { Diamond: '#8B5CF6', Ruby: '#DC2626', Sapphire: '#2563EB', Agate: '#F59E0B', Quartz: '#94A3B8', Unscored: '#6B7280' };
// dataviz skill's validated default categorical palette (8 slots, light
// mode) — see the skill's references/palette.md. Used for the "by source"
// pies since sources are unbounded/dynamic and there's no existing app-wide
// categorical convention to reuse (unlike Stone Tier, which already has one).
const CATEGORICAL = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#94A3B8';
const PIE_MAX_SLICES = 7; // + 1 folded "Khác/Other" slice, keeps within the validated 8-slot categorical set

const BUDGET_CATEGORIES = ['Quảng cáo', 'Đối tác truyền thông', 'In ấn', 'Vận hành sự kiện', 'Quà tặng'];
const BUDGET_TABS = [
  { type: 'planned', en: 'Planned', vi: 'Kế hoạch' },
  { type: 'actual', en: 'Actual', vi: 'Thực tế' },
];
const COMPARE_MAX = 6;

function fmtVnd(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('vi-VN') + ' đ';
}
function fmtPct(n) {
  return n == null ? '—' : `${n}%`;
}
function fmtInt(n) {
  return n == null ? '—' : n;
}

// Build pie-chart-ready data from a bySource/byTier rollup: {name, value, key}
// sorted descending, folded to a max slice count (+ one "Other" slice) so the
// chart never exceeds the validated categorical palette size.
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

// ── Stat card (matches ActivityReport.jsx / Dashboard.jsx) ─────
function StatCard({ label, value, sub, color, title }) {
  return (
    <div title={title} style={{
      background: 'var(--bg-primary)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '1rem 1.25rem',
      borderLeft: `4px solid ${color || 'var(--border)'}`,
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', marginTop: '3px', width: '100%', minWidth: '60px' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: COLORS.primary, borderRadius: '2px', transition: 'width 0.3s' }} />
    </div>
  );
}

// ── Editable inline field (click to edit, Enter/blur to save) ──
function EditableNumber({ value, onSave, placeholder, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to edit"
        style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border)', ...style }}>
        {value == null ? (placeholder || '— (click to enter)') : fmtVnd(value)}
      </span>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      className="form-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft === '' ? null : Number(draft)); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); onSave(draft === '' ? null : Number(draft)); }
        if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); }
      }}
      style={{ width: '140px', ...style }}
    />
  );
}

// Direct label placed outside each slice with a leader line back to it —
// the dataviz skill's prescribed fix for a label that doesn't reliably fit
// *inside* a mark (small slices here would clip or overflow). Text uses the
// muted ink token, never the slice's own color (skill: "text never wears
// the data color").
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

// ── Pie chart card — Recharts, first Pie usage in this codebase. Legend is
// always present (satisfies the dataviz skill's relief rule for the
// categorical palette's lower-contrast slots); direct labels supplement it
// with the exact count + percentage per slice; the tooltip repeats both on
// hover for anyone who wants the number in isolation.
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

// ── Budget line-item row form (used for both add-new and edit-in-place) ──
function BudgetItemForm({ initial, defaultType, onSave, onCancel, L }) {
  const [category, setCategory] = useState(initial?.category || BUDGET_CATEGORIES[0]);
  const [lineItem, setLineItem] = useState(initial?.lineItem || '');
  const [unit, setUnit] = useState(initial?.unit || '');
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [note, setNote] = useState(initial?.note || '');
  const [budgetType, setBudgetType] = useState(initial?.budgetType || defaultType || 'actual');
  // Amount auto-fills as unitPrice * quantity whenever either changes, UNLESS
  // the user has directly typed into Amount themselves - once touched, it stops
  // being overwritten so VAT/deduction/free-item rows (where Amount legitimately
  // isn't the naive product, per the real budget doc) can still be entered.
  const [amountTouched, setAmountTouched] = useState(false);
  const canSave = lineItem.trim() && amount !== '' && !isNaN(Number(amount));

  function recompute(nextUnitPrice, nextQuantity) {
    if (amountTouched) return;
    const up = nextUnitPrice === '' ? null : Number(nextUnitPrice);
    const qty = nextQuantity === '' ? null : Number(nextQuantity);
    if (up != null && qty != null && !isNaN(up) && !isNaN(qty)) {
      setAmount(String(up * qty));
    }
  }

  return (
    <tr style={{ background: 'var(--bg-secondary)' }}>
      <td style={{ padding: '4px' }}>
        <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={lineItem} onChange={(e) => setLineItem(e.target.value)} placeholder="Line item" />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: '70px' }} placeholder="e.g. Lead, Buổi, Cái" />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={unitPrice}
          onChange={(e) => { setUnitPrice(e.target.value); recompute(e.target.value, quantity); }}
          style={{ width: '100px' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={quantity}
          onChange={(e) => { setQuantity(e.target.value); recompute(unitPrice, e.target.value); }}
          style={{ width: '70px' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={amount}
          onChange={(e) => { setAmount(e.target.value); setAmountTouched(true); }}
          title={amountTouched ? 'Manually set - won\'t auto-update from unit price × quantity anymore' : 'Auto-filled from unit price × quantity'}
          style={{ width: '110px', fontStyle: amountTouched ? 'normal' : 'italic' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
      </td>
      <td style={{ padding: '4px' }}>
        <select className="form-input" value={budgetType} onChange={(e) => setBudgetType(e.target.value)} style={{ width: '90px' }}>
          {BUDGET_TABS.map((t) => <option key={t.type} value={t.type}>{L(t.en, t.vi)}</option>)}
        </select>
      </td>
      <td style={{ padding: '4px', whiteSpace: 'nowrap' }}>
        <button
          className="btn btn--primary btn--sm"
          disabled={!canSave}
          onClick={() => onSave({
            category, lineItem: lineItem.trim(),
            unit: unit || null,
            unitPrice: unitPrice === '' ? null : Number(unitPrice),
            quantity: quantity === '' ? null : Number(quantity),
            amount: Number(amount),
            note: note || null,
            budgetType,
          })}>
          Save
        </button>{' '}
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

export default function EventReport() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const [mode, setMode] = useState('single'); // 'single' | 'compare'

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');

  const [selectedEventId, setSelectedEventId] = useState(null);
  const [report, setReport] = useState(null);
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [compareIds, setCompareIds] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [compareBudgets, setCompareBudgets] = useState({});
  const [compareLoading, setCompareLoading] = useState(false);

  const [expandedSources, setExpandedSources] = useState(new Set());
  const [sortKey, setSortKey] = useState('registered');
  const [sortDir, setSortDir] = useState('desc');
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [budgetTab, setBudgetTab] = useState('planned');

  // ── Load the Exhibition/Fair event list once ──
  useEffect(() => {
    (async () => {
      setEventsLoading(true);
      try {
        const res = await eventConsoleAPI.listEvents();
        const list = res.data || [];
        setEvents(list);
        if (list.length) setSelectedEventId(list[0].id);
      } catch (e) {
        setEventsError(e.message || 'Failed to load events');
      } finally {
        setEventsLoading(false);
      }
    })();
  }, []);

  // ── Nav trail ──
  useEffect(() => {
    pushTrail({ label: L('Event Report', 'Báo cáo sự kiện'), path: '/reports/event' });
  }, [pushTrail, language]);

  const loadSingle = useCallback(async (eventId) => {
    if (!eventId) return;
    setLoading(true); setError(''); setExpandedSources(new Set());
    try {
      const [reportRes, budgetRes] = await Promise.all([
        eventConsoleAPI.sourceReport(eventId),
        eventConsoleAPI.getBudget(eventId),
      ]);
      setReport(reportRes.data || null);
      setBudget(budgetRes.data || null);
    } catch (e) {
      setError(e.message || 'Failed to load event report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'single' && selectedEventId) loadSingle(selectedEventId);
  }, [mode, selectedEventId, loadSingle]);

  useEffect(() => {
    if (mode !== 'compare' || compareIds.length < 2) { setCompareData(null); setCompareBudgets({}); return; }
    (async () => {
      setCompareLoading(true);
      try {
        const [cmpRes, budgetResults] = await Promise.all([
          eventConsoleAPI.eventsCompare(compareIds),
          Promise.all(compareIds.map((id) => eventConsoleAPI.getBudget(id).catch(() => ({ data: null })))),
        ]);
        setCompareData(cmpRes.data || null);
        const budgetMap = {};
        compareIds.forEach((id, i) => { budgetMap[id] = budgetResults[i]?.data || null; });
        setCompareBudgets(budgetMap);
      } catch (e) {
        setError(e.message || 'Failed to load comparison');
      } finally {
        setCompareLoading(false);
      }
    })();
  }, [mode, compareIds]);

  // ── Sorted source breakdown ──
  const sortedSources = useMemo(() => {
    if (!report?.bySource) return [];
    const rows = [...report.bySource];
    rows.sort((a, b) => {
      const av = a[sortKey] ?? -1, bv = b[sortKey] ?? -1;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [report, sortKey, sortDir]);

  const maxRegistered = useMemo(
    () => Math.max(1, ...(report?.bySource || []).map((s) => s.registered)),
    [report]
  );

  const pieData = useMemo(() => {
    if (!report) return null;
    const otherLabel = L('Other', 'Khác');
    return {
      srcRegistered: toPieData(report.bySource, 'registered', (s) => s.sourceLabel, (s) => s.sourceLabel, otherLabel),
      srcConfirmed: toPieData(report.bySource, 'confirmed', (s) => s.sourceLabel, (s) => s.sourceLabel, otherLabel),
      srcAttended: toPieData(report.bySource, 'attended', (s) => s.sourceLabel, (s) => s.sourceLabel, otherLabel),
      tierRegistered: toPieData(report.byTier, 'registered', (t) => stoneLabel(t.stoneTier, language), (t) => t.stoneTier, otherLabel),
      tierConfirmed: toPieData(report.byTier, 'confirmed', (t) => stoneLabel(t.stoneTier, language), (t) => t.stoneTier, otherLabel),
      tierAttended: toPieData(report.byTier, 'attended', (t) => stoneLabel(t.stoneTier, language), (t) => t.stoneTier, otherLabel),
    };
  }, [report, language]);

  function sourceColor(entry, i) {
    return entry.key === '__other__' ? OTHER_COLOR : CATEGORICAL[i % CATEGORICAL.length];
  }
  function tierColor(entry) {
    return STONE_COLORS[entry.key] || OTHER_COLOR;
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function toggleExpand(sourceLabel) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceLabel)) next.delete(sourceLabel); else next.add(sourceLabel);
      return next;
    });
  }

  function toggleCompareEvent(id) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPARE_MAX) return prev;
      return [...prev, id];
    });
  }

  // ── Budget CRUD ──
  async function handleSaveSponsorship(v) {
    const res = await eventConsoleAPI.setBudgetTotals(selectedEventId, { totalSponsorship: v, khachKCount: budget?.khachKCount });
    setBudget(res.data);
  }
  async function handleSaveKhachK(v) {
    const res = await eventConsoleAPI.setBudgetTotals(selectedEventId, { totalSponsorship: budget?.totalSponsorship, khachKCount: v });
    setBudget(res.data);
  }
  async function handleAddItem(item) {
    await eventConsoleAPI.addBudgetItem(selectedEventId, item);
    setAddingItem(false);
    const res = await eventConsoleAPI.getBudget(selectedEventId);
    setBudget(res.data);
  }
  async function handleUpdateItem(itemId, item) {
    await eventConsoleAPI.updateBudgetItem(selectedEventId, itemId, item);
    setEditingItemId(null);
    const res = await eventConsoleAPI.getBudget(selectedEventId);
    setBudget(res.data);
  }
  async function handleDeleteItem(itemId) {
    if (!window.confirm(L('Delete this budget line item?', 'Xóa dòng ngân sách này?'))) return;
    await eventConsoleAPI.deleteBudgetItem(selectedEventId, itemId);
    const res = await eventConsoleAPI.getBudget(selectedEventId);
    setBudget(res.data);
  }
  async function handleSaveSpend(sourceLabel, amount) {
    await eventConsoleAPI.setSourceSpend(selectedEventId, sourceLabel, amount);
    const res = await eventConsoleAPI.sourceReport(selectedEventId);
    setReport(res.data);
  }

  function exportToCsv() {
    if (!sortedSources.length) { alert('Nothing to export'); return; }
    const header = ['Source', 'Đăng ký', 'Xác nhận', 'Tham dự', 'Xác nhận/Đăng ký', 'Tham dự/Xác nhận', 'Tham dự/Đăng ký', 'Spend', 'CPL'];
    const rows = sortedSources.map((s) => [
      s.sourceLabel, s.registered, s.confirmed, s.attended,
      s.confirmedOverRegistered ?? '', s.attendedOverConfirmed ?? '', s.attendedOverRegistered ?? '',
      s.spendAmount ?? '', s.cpl ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-report-${selectedEventId}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (eventsLoading) return <div className="loading-center">{L('Loading...', 'Đang tải...')}</div>;
  if (eventsError) return <div className="page-body"><div className="alert alert--error">{eventsError}</div></div>;

  const ev = report?.event;
  const itemsForTab = (budget?.items || []).filter((i) => i.budgetType === budgetTab);
  const totalForTab = budgetTab === 'planned' ? budget?.totalCostPlanned : budget?.totalCostActual;

  return (
    <div>
      <Watermark />

      <div className="page-header">
        <span className="page-title">{L('Event Report', 'Báo cáo sự kiện')}</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <button
              className="btn btn--sm"
              onClick={() => setMode('single')}
              style={{ borderRadius: 0, background: mode === 'single' ? 'var(--primary-light)' : 'transparent' }}>
              {L('Single Event', 'Một sự kiện')}
            </button>
            <button
              className="btn btn--sm"
              onClick={() => setMode('compare')}
              style={{ borderRadius: 0, background: mode === 'compare' ? 'var(--primary-light)' : 'transparent' }}>
              {L('Compare Events', 'So sánh sự kiện')}
            </button>
          </div>
          {mode === 'single' && (
            <button className="btn btn--secondary btn--sm" onClick={exportToCsv} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <FiDownload size={13} /> {L('Export', 'Xuất')}
            </button>
          )}
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {mode === 'single' ? (
          <>
            {/* ── Event picker ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{L('Event', 'Sự kiện')}:</span>
              <select
                className="form-input"
                value={selectedEventId || ''}
                onChange={(e) => setSelectedEventId(Number(e.target.value))}
                style={{ maxWidth: '360px' }}>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.registeredCount ?? 0} {L('registered', 'đăng ký')})
                  </option>
                ))}
              </select>
              {loading && <FiRefreshCw size={14} className="spin" />}
            </div>

            {error && <div className="alert alert--error">{error}</div>}

            {ev && (
              <>
                {/* ── KPI strip ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                  <StatCard label={L('Registered', 'Đăng ký')} value={fmtInt(ev.registered)} color={COLORS.primary} />
                  <StatCard label={L('Confirmed', 'Xác nhận')} value={fmtInt(ev.confirmed)} sub={fmtPct(ev.confirmedOverRegistered)} color={COLORS.warn} />
                  <StatCard label={L('Attended', 'Tham dự')} value={fmtInt(ev.attended)} sub={fmtPct(ev.attendedOverRegistered)} color={COLORS.good} />
                  <StatCard label={L('Schools present', 'Số trường')} value={fmtInt(ev.schoolsCount)} color={COLORS.neutral} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <StatCard
                    label={L('Contracted', 'Ký hợp đồng')}
                    value={fmtInt(ev.contractedCount)}
                    color={COLORS.primary}
                    title={(ev.contractedLeads || []).map((c) => c.fullName).join(', ') || undefined}
                  />
                  <StatCard
                    label={L('CPL (registered)', 'CPL (đăng ký)')}
                    value={budget?.totalCostActual != null && ev.registered ? fmtVnd(Math.round(budget.totalCostActual / ev.registered)) : '—'}
                    sub={L('Actual cost ÷ registered', 'Chi phí thực tế ÷ đăng ký')}
                    color={COLORS.warn}
                  />
                  <StatCard
                    label={L('CPL (attended)', 'CPL (tham dự)')}
                    value={budget?.totalCostActual != null && ev.attended ? fmtVnd(Math.round(budget.totalCostActual / ev.attended)) : '—'}
                    sub={L('Actual cost ÷ attended', 'Chi phí thực tế ÷ tham dự')}
                    color={COLORS.good}
                  />
                </div>

                {/* ── Budget summary + ledger ── */}
                <div className="section-card">
                  <div className="section-header">
                    <span className="section-title">{L('Budget', 'Ngân sách')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', padding: '0.5rem 0 1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Total cost (planned)', 'Tổng chi phí (Kế hoạch)')}</div>
                      <div>{fmtVnd(budget?.totalCostPlanned)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Total cost (actual)', 'Tổng chi phí (Thực tế)')}</div>
                      <div style={{ fontWeight: 600 }}>{fmtVnd(budget?.totalCostActual)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Total sponsorship', 'Tổng tiền tài trợ')}</div>
                      <EditableNumber value={budget?.totalSponsorship} onSave={handleSaveSponsorship} />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Khách K (manual, non-lead guests)', 'Khách K (thủ công)')}</div>
                      <EditableNumber
                        value={budget?.khachKCount}
                        onSave={handleSaveKhachK}
                        placeholder={L('Unknown (click to enter)', 'Chưa xác định (bấm để nhập)')}
                        style={{}}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Budget (85%)', 'Ngân sách sự kiện 85%')}</div>
                      <div>{fmtVnd(budget?.budget85)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Remaining (vs actual)', 'Tiền còn lại (so với thực tế)')}</div>
                      <div style={{ color: budget?.remaining < 0 ? COLORS.danger : 'var(--text-primary)' }}>{fmtVnd(budget?.remaining)}</div>
                    </div>
                  </div>

                  {/* ── Planned / Actual tabs — the ledger is two separate lists, matching
                      how the source documents themselves are two separate things. ── */}
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '0.5rem' }}>
                    {BUDGET_TABS.map((t) => (
                      <button
                        key={t.type}
                        className="btn btn--sm"
                        onClick={() => setBudgetTab(t.type)}
                        style={{
                          borderRadius: '6px 6px 0 0',
                          background: budgetTab === t.type ? 'var(--bg-secondary)' : 'transparent',
                          fontWeight: budgetTab === t.type ? 600 : 400,
                          borderBottom: budgetTab === t.type ? '2px solid var(--primary, #2563EB)' : '2px solid transparent',
                        }}>
                        {L(t.en, t.vi)}
                      </button>
                    ))}
                    <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {L('Tab total', 'Tổng mục')}: {fmtVnd(totalForTab)}
                    </span>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table className="leads-data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>{L('Category', 'Hạng mục')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Line item', 'Nội dung')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Unit', 'Đơn vị')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Unit price', 'Đơn giá')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Qty', 'SL')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Amount', 'Thành tiền')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Note', 'Ghi chú')}</th>
                          <th style={{ width: '90px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsForTab.map((item) => (
                          editingItemId === item.id ? (
                            <BudgetItemForm
                              key={item.id}
                              initial={item}
                              defaultType={budgetTab}
                              onSave={(data) => handleUpdateItem(item.id, data)}
                              onCancel={() => setEditingItemId(null)}
                              L={L}
                            />
                          ) : (
                            <tr key={item.id}>
                              <td>{item.category}</td>
                              <td>{item.lineItem}</td>
                              <td>{item.unit || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{item.unitPrice != null ? fmtVnd(item.unitPrice) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{item.quantity ?? '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtVnd(item.amount)}</td>
                              <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.note || ''}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="btn btn--ghost btn--sm" title="Edit" onClick={() => setEditingItemId(item.id)}>
                                  <FiEdit2 size={13} />
                                </button>
                                <button className="btn btn--ghost btn--sm" title="Delete" onClick={() => handleDeleteItem(item.id)}>
                                  <FiTrash2 size={13} color={COLORS.danger} />
                                </button>
                              </td>
                            </tr>
                          )
                        ))}
                        {addingItem && (
                          <BudgetItemForm defaultType={budgetTab} onSave={handleAddItem} onCancel={() => setAddingItem(false)} L={L} />
                        )}
                        {!itemsForTab.length && !addingItem && (
                          <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                            {L('No line items yet in this tab', 'Chưa có dòng nào trong mục này')}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {!addingItem && (
                    <button className="btn btn--secondary btn--sm" onClick={() => setAddingItem(true)} style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <FiPlus size={13} /> {L('Add line item', 'Thêm dòng')}
                    </button>
                  )}
                </div>

                {/* ── Source breakdown (Total row + collapsible per-source leads) ── */}
                <div className="section-card">
                  <div className="section-header">
                    <span className="section-title">{L('Breakdown by source', 'Thống kê theo nguồn')}</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leads-data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>{L('Source', 'Nguồn')}</th>
                          <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('registered')}>{L('Registered', 'Đăng ký')}</th>
                          <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('confirmed')}>{L('Confirmed', 'Xác nhận')}</th>
                          <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('attended')}>{L('Attended', 'Tham dự')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Confirm/Reg', 'Xác nhận/Đăng ký')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Attend/Confirm', 'Tham dự/Xác nhận')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Attend/Reg', 'Tham dự/Đăng ký')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Spend', 'Chi phí')}</th>
                          <th style={{ textAlign: 'right' }}>CPL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Total row — pinned, not clickable/expandable */}
                        <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                          <td>{L('Total', 'Tổng cộng')}</td>
                          <td style={{ textAlign: 'right' }}>{ev.registered}</td>
                          <td style={{ textAlign: 'right' }}>{ev.confirmed}</td>
                          <td style={{ textAlign: 'right' }}>{ev.attended}</td>
                          <td style={{ textAlign: 'right' }}>{fmtPct(ev.confirmedOverRegistered)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtPct(ev.attendedOverConfirmed)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtPct(ev.attendedOverRegistered)}</td>
                          <td style={{ textAlign: 'right' }}>—</td>
                          <td style={{ textAlign: 'right' }}>—</td>
                        </tr>

                        {sortedSources.map((s) => {
                          const expanded = expandedSources.has(s.sourceLabel);
                          const leadsForSource = report.byLead.filter((l) => l.sourceLabel === s.sourceLabel);
                          return (
                            <Fragment key={s.sourceLabel}>
                              <tr
                                onClick={() => toggleExpand(s.sourceLabel)}
                                style={{ cursor: 'pointer', background: expanded ? 'var(--primary-light)' : 'transparent' }}>
                                <td>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    {expanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
                                    {s.sourceLabel}
                                  </span>
                                  <MiniBar value={s.registered} max={maxRegistered} />
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.registered}</td>
                                <td style={{ textAlign: 'right' }}>{s.confirmed}</td>
                                <td style={{ textAlign: 'right' }}>{s.attended}</td>
                                <td style={{ textAlign: 'right' }}>{fmtPct(s.confirmedOverRegistered)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtPct(s.attendedOverConfirmed)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtPct(s.attendedOverRegistered)}</td>
                                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                  <EditableNumber
                                    value={s.spendAmount}
                                    onSave={(v) => handleSaveSpend(s.sourceLabel, v)}
                                    placeholder="—"
                                    style={{ fontSize: '0.8rem' }}
                                  />
                                </td>
                                <td style={{ textAlign: 'right' }}>{s.cpl != null ? fmtVnd(s.cpl) : '—'}</td>
                              </tr>
                              {expanded && (
                                <tr key={`${s.sourceLabel}-detail`}>
                                  <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                    <table className="leads-data-table" style={{ width: '100%' }}>
                                      <thead>
                                        <tr>
                                          <th style={{ textAlign: 'left' }}>{L('Name', 'Tên')}</th>
                                          <th style={{ textAlign: 'left' }}>{L('Status', 'Trạng thái')}</th>
                                          <th style={{ textAlign: 'center' }}>{L('Confirmed', 'Xác nhận')}</th>
                                          <th style={{ textAlign: 'center' }}>{L('Attended', 'Tham dự')}</th>
                                          <th style={{ textAlign: 'center' }}>{L('Contracted', 'Ký HĐ')}</th>
                                          <th style={{ textAlign: 'left' }}>{L('Stone', 'Đá')}</th>
                                          <th style={{ textAlign: 'left' }}>{L('Counselor', 'Tư vấn viên')}</th>
                                          <th style={{ width: '40px' }}></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {leadsForSource.map((l) => (
                                          <tr key={l.studentId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.studentId}`)}>
                                            <td style={{ fontWeight: 500 }}>{l.fullName || '—'}</td>
                                            <td>{l.status || '—'}</td>
                                            <td style={{ textAlign: 'center', color: l.confirmed ? COLORS.good : 'var(--text-secondary)' }}>{l.confirmed ? '✓' : '—'}</td>
                                            <td style={{ textAlign: 'center', color: l.attended ? COLORS.good : 'var(--text-secondary)' }}>{l.attended ? '✓' : '—'}</td>
                                            <td style={{ textAlign: 'center', color: l.isContracted ? COLORS.good : 'var(--text-secondary)' }} title={l.leadStatus || ''}>{l.isContracted ? '✓' : '—'}</td>
                                            <td>
                                              {STONE_IMAGES[l.stoneTier] ? (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                  <img src={STONE_IMAGES[l.stoneTier]} alt={l.stoneTier} title={stoneLabel(l.stoneTier, language)}
                                                    style={{ width: '20px', height: '20px', objectFit: 'contain', flexShrink: 0 }} />
                                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{stoneLabel(l.stoneTier, language)}</span>
                                                </span>
                                              ) : (
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{stoneLabel(l.stoneTier, language)}</span>
                                              )}
                                            </td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.counselor}</td>
                                            <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {!sortedSources.length && (
                          <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                            {L('No registrations for this event', 'Chưa có đăng ký nào cho sự kiện này')}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Contribution pie charts — by source, then by Stone Tier ── */}
                {pieData && (
                  <>
                    <div className="section-header"><span className="section-title">{L('Contribution by source', 'Tỉ trọng theo nguồn')}</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                      <PieCard title={L('Registered', 'Đăng ký')} data={pieData.srcRegistered} colorFor={sourceColor} />
                      <PieCard title={L('Confirmed', 'Xác nhận')} data={pieData.srcConfirmed} colorFor={sourceColor} />
                      <PieCard title={L('Attended', 'Tham dự')} data={pieData.srcAttended} colorFor={sourceColor} />
                    </div>

                    <div className="section-header"><span className="section-title">{L('Contribution by Stone Tier', 'Tỉ trọng theo hạng đá')}</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                      <PieCard title={L('Registered', 'Đăng ký')} data={pieData.tierRegistered} colorFor={tierColor} />
                      <PieCard title={L('Confirmed', 'Xác nhận')} data={pieData.tierConfirmed} colorFor={tierColor} />
                      <PieCard title={L('Attended', 'Tham dự')} data={pieData.tierAttended} colorFor={tierColor} />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {/* ── Compare mode ── */}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {L(`Select up to ${COMPARE_MAX} events to compare:`, `Chọn tối đa ${COMPARE_MAX} sự kiện để so sánh:`)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {events.map((e) => (
                <label key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 10px', borderRadius: '14px', fontSize: '0.75rem',
                  border: '1px solid var(--border)',
                  background: compareIds.includes(e.id) ? 'var(--primary-light)' : 'var(--bg-primary)',
                  cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={compareIds.includes(e.id)} onChange={() => toggleCompareEvent(e.id)} />
                  {e.name}
                </label>
              ))}
            </div>

            {compareLoading && <div className="loading-center">{L('Loading...', 'Đang tải...')}</div>}

            {compareData?.events?.length > 0 && (
              <div className="section-card">
                <div style={{ overflowX: 'auto' }}>
                  <table className="leads-data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>{L('Metric', 'Chỉ số')}</th>
                        {compareData.events.map((e) => (
                          <th key={e.eventId} style={{ textAlign: 'right' }}>
                            {events.find((ev2) => ev2.id === e.eventId)?.name || e.eventId}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>{L('Registered', 'Đăng ký')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.registered}</td>)}</tr>
                      <tr><td>{L('Confirmed', 'Xác nhận')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.confirmed}</td>)}</tr>
                      <tr><td>{L('Attended', 'Tham dự')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.attended}</td>)}</tr>
                      <tr><td>{L('Schools present', 'Số trường')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.schoolsCount}</td>)}</tr>
                      <tr><td>{L('Confirm/Reg', 'Xác nhận/Đăng ký')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtPct(e.confirmedOverRegistered)}</td>)}</tr>
                      <tr><td>{L('Attend/Confirm', 'Tham dự/Xác nhận')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtPct(e.attendedOverConfirmed)}</td>)}</tr>
                      <tr><td>{L('Attend/Reg', 'Tham dự/Đăng ký')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtPct(e.attendedOverRegistered)}</td>)}</tr>
                      <tr><td>{L('Total Cost (Planned)', 'Tổng chi phí (Kế hoạch)')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtVnd(compareBudgets[e.eventId]?.totalCostPlanned)}</td>)}</tr>
                      <tr><td>{L('Total Cost (Actual)', 'Tổng chi phí (Thực tế)')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtVnd(compareBudgets[e.eventId]?.totalCostActual)}</td>)}</tr>
                      <tr><td>{L('Sponsorship', 'Tiền tài trợ')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtVnd(compareBudgets[e.eventId]?.totalSponsorship)}</td>)}</tr>
                      <tr><td>{L('Khách K', 'Khách K')}</td>{compareData.events.map((e) => {
                        const kk = compareBudgets[e.eventId]?.khachKCount;
                        return <td key={e.eventId} style={{ textAlign: 'right' }}>{kk == null ? L('Unknown', 'Chưa xác định') : kk}</td>;
                      })}</tr>
                      <tr><td>{`CPL (${L('registered', 'đăng ký')})`}</td>{compareData.events.map((e) => {
                        const cost = compareBudgets[e.eventId]?.totalCostActual;
                        const cpl = cost != null && e.registered ? Math.round(cost / e.registered) : null;
                        return <td key={e.eventId} style={{ textAlign: 'right' }}>{cpl != null ? fmtVnd(cpl) : '—'}</td>;
                      })}</tr>
                      <tr><td>{L('Contracted', 'Ký hợp đồng')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.contractedCount}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {mode === 'compare' && compareIds.length < 2 && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '1rem', textAlign: 'center' }}>
                {L('Select at least 2 events to see a comparison.', 'Chọn ít nhất 2 sự kiện để so sánh.')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
