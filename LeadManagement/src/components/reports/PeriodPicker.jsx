// src/components/reports/PeriodPicker.jsx
// -----------------------------------------------------------------------------
// Shared weekly/monthly/yearly/custom-range period control for Individual
// Report and Company Report (2026-08 Weekly/Monthly Report merge). No such
// reusable date-range component existed before this — every prior report
// page hand-rolled its own pair of <input type="date">s (confirmed during
// planning). `value` / `onChange` carry exactly the shape the new
// /api/reports/individual and /group endpoints expect as query params:
//   { period: 'weekly',  weekStart: 'YYYY-MM-DD' }
//   { period: 'monthly', month: 'YYYY-MM' }
//   { period: 'yearly',  year: 'YYYY' }
//   { period: 'custom',  from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
// -----------------------------------------------------------------------------
import { useState } from 'react';

const sel = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border,#e5e7eb)' };
const btn = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border,#e5e7eb)', background: 'var(--bg-primary,#fff)', cursor: 'pointer' };

// VN-local Monday of the week containing `d` (a Date), as YYYY-MM-DD.
function mondayOf(d) {
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - dow);
  return mon.toISOString().slice(0, 10);
}
function shiftWeek(weekStart, deltaWeeks) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PeriodPicker({ value, onChange, L }) {
  const period = value?.period || 'weekly';
  const [customFrom, setCustomFrom] = useState(value?.from || '');
  const [customTo,   setCustomTo]   = useState(value?.to   || '');

  function setPeriod(p) {
    if (p === 'weekly')  onChange({ period: p, weekStart: value?.weekStart || mondayOf(new Date()) });
    if (p === 'monthly') onChange({ period: p, month: value?.month || currentMonth() });
    if (p === 'yearly')  onChange({ period: p, year: value?.year || String(new Date().getFullYear()) });
    if (p === 'custom')  onChange({ period: p, from: customFrom, to: customTo });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <select value={period} onChange={e => setPeriod(e.target.value)} style={sel}>
        <option value="weekly">{L('Weekly', 'Theo tuần')}</option>
        <option value="monthly">{L('Monthly', 'Theo tháng')}</option>
        <option value="yearly">{L('Yearly', 'Theo năm')}</option>
        <option value="custom">{L('Custom range', 'Tùy chọn')}</option>
      </select>

      {period === 'weekly' && (
        <>
          <button style={btn} onClick={() => onChange({ period, weekStart: shiftWeek(value.weekStart, -1) })}>←</button>
          <input type="date" value={value.weekStart} onChange={e => onChange({ period, weekStart: mondayOf(new Date(e.target.value + 'T00:00:00')) })} style={sel} />
          <button style={btn} onClick={() => onChange({ period, weekStart: shiftWeek(value.weekStart, 1) })}>→</button>
        </>
      )}
      {period === 'monthly' && (
        <input type="month" value={value.month} onChange={e => onChange({ period, month: e.target.value })} style={sel} />
      )}
      {period === 'yearly' && (
        <input type="number" min="2020" max="2100" value={value.year} onChange={e => onChange({ period, year: e.target.value })} style={{ ...sel, width: 90 }} />
      )}
      {period === 'custom' && (
        <>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={sel} />
          <span style={{ color: 'var(--text-secondary,#9ca3af)' }}>{L('to', 'đến')}</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={sel} />
          <button style={btn} disabled={!customFrom || !customTo} onClick={() => onChange({ period, from: customFrom, to: customTo })}>
            {L('Apply', 'Áp dụng')}
          </button>
        </>
      )}
    </div>
  );
}
