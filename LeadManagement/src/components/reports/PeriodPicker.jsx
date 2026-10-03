// src/components/reports/PeriodPicker.jsx
// -----------------------------------------------------------------------------
// Shared weekly/monthly/quarterly/yearly/custom-range period control for
// Individual Report and Company Report (2026-08 Weekly/Monthly Report merge;
// Quarterly added 2026-09-30). No such reusable date-range component existed
// before the original merge — every prior report page hand-rolled its own
// pair of <input type="date">s (confirmed during planning). `value` /
// `onChange` carry exactly the shape the new /api/reports/individual and
// /group endpoints expect as query params:
//   { period: 'weekly',    weekStart: 'YYYY-MM-DD' }
//   { period: 'monthly',   month: 'YYYY-MM' }
//   { period: 'quarterly', quarter: 'YYYY-Q#' }
//   { period: 'yearly',    year: 'YYYY' }
//   { period: 'custom',    from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//
// The dropdown's displayed period type is tracked as its OWN local state
// (`uiPeriod`), deliberately NOT derived from `value.period` — switching the
// dropdown never immediately calls onChange with a stale/blank value.
//
// EVERY control here validates its value against the expected shape before
// calling onChange — found 2026-09 testing the branch-deploy: this was
// first fixed only for Custom range (which started genuinely blank), but
// the same class of bug also hit Monthly (native <input type="month"> could
// fire onChange with an incomplete value while the user was still typing,
// depending on browser/OS — since replaced by YearMonthPicker's two plain
// <select>s, which can't hold a partial value in the first place) and would
// have hit Yearly too (a plain <input type="number"> fires onChange on
// every keystroke — typing "2026" fires with "2", "20", "202" first).
// Weekly uses a regex guard on the native date input's own onChange; Yearly
// uses an uncommitted local draft, only propagated on blur/Enter once it's
// a valid 4-digit year; Custom already required its own explicit Apply
// button since it has no sensible default to begin with.
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import YearMonthPicker from './YearMonthPicker';
import YearQuarterPicker from './YearQuarterPicker';

const sel = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border,#e5e7eb)' };
const btn = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border,#e5e7eb)', background: 'var(--bg-primary,#fff)', cursor: 'pointer' };

// Read a Date's LOCAL calendar fields directly — never round-trip through
// toISOString().slice(0,10), which converts to UTC first. For a VN browser
// (UTC+7), a Date built at local midnight serializes to 17:00 the PREVIOUS
// day in UTC, so slicing it gives the wrong date — confirmed 2026-10-03 as
// the cause of "previous week" showing Sun-Sat instead of Mon-Sun (shiftWeek
// builds its date at exactly local midnight, so it hit this on every call;
// mondayOf only avoided it by accident, inheriting new Date()'s current
// time-of-day, which falls outside the danger window except before ~7am VN).
function toYmdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// VN-local Monday of the week containing `d` (a Date), as YYYY-MM-DD.
function mondayOf(d) {
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - dow);
  return toYmdLocal(mon);
}
function shiftWeek(weekStart, deltaWeeks) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + deltaWeeks * 7);
  return toYmdLocal(d);
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export default function PeriodPicker({ value, onChange, L }) {
  const [uiPeriod, setUiPeriod] = useState(value?.period || 'weekly');
  const [customFrom, setCustomFrom] = useState(value?.from || '');
  const [customTo,   setCustomTo]   = useState(value?.to   || '');
  // Yearly's own uncommitted draft — only propagated on blur/Enter once valid.
  const [yearDraft, setYearDraft] = useState(value?.year || String(new Date().getFullYear()));
  useEffect(() => { if (value?.period === 'yearly') setYearDraft(value.year); }, [value]);

  function setPeriod(p) {
    setUiPeriod(p);
    // weekly/monthly/yearly always have a sensible default to fall back to
    // when switching in from another period type, so they fire immediately;
    // custom genuinely has nothing valid until both dates are picked, so it
    // waits for the explicit Apply click below instead.
    if (p === 'weekly')    onChange({ period: p, weekStart: value?.period === 'weekly'    ? value.weekStart : mondayOf(new Date()) });
    if (p === 'monthly')   onChange({ period: p, month:     value?.period === 'monthly'   ? value.month     : currentMonth() });
    if (p === 'quarterly') onChange({ period: p, quarter:   value?.period === 'quarterly' ? value.quarter   : currentQuarter() });
    if (p === 'yearly')    onChange({ period: p, year:      value?.period === 'yearly'    ? value.year      : String(new Date().getFullYear()) });
  }

  function commitYear() {
    if (/^\d{4}$/.test(yearDraft)) onChange({ period: 'yearly', year: yearDraft });
    else setYearDraft(value?.year || String(new Date().getFullYear())); // invalid — snap back
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <select value={uiPeriod} onChange={e => setPeriod(e.target.value)} style={sel}>
        <option value="weekly">{L('Weekly', 'Theo tuần')}</option>
        <option value="monthly">{L('Monthly', 'Theo tháng')}</option>
        <option value="quarterly">{L('Quarterly', 'Theo quý')}</option>
        <option value="yearly">{L('Yearly', 'Theo năm')}</option>
        <option value="custom">{L('Custom range', 'Tùy chọn')}</option>
      </select>

      {uiPeriod === 'weekly' && value?.period === 'weekly' && (
        <>
          <button style={btn} onClick={() => onChange({ period: 'weekly', weekStart: shiftWeek(value.weekStart, -1) })}>←</button>
          <input type="date" value={value.weekStart}
            onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onChange({ period: 'weekly', weekStart: mondayOf(new Date(e.target.value + 'T00:00:00')) }); }}
            style={sel} />
          <button style={btn} onClick={() => onChange({ period: 'weekly', weekStart: shiftWeek(value.weekStart, 1) })}>→</button>
        </>
      )}
      {uiPeriod === 'monthly' && value?.period === 'monthly' && (
        <YearMonthPicker value={value.month} onChange={month => onChange({ period: 'monthly', month })} L={L} />
      )}
      {uiPeriod === 'quarterly' && value?.period === 'quarterly' && (
        <YearQuarterPicker value={value.quarter} onChange={quarter => onChange({ period: 'quarterly', quarter })} L={L} />
      )}
      {uiPeriod === 'yearly' && value?.period === 'yearly' && (
        <input type="number" min="2020" max="2100" value={yearDraft}
          onChange={e => setYearDraft(e.target.value)}
          onBlur={commitYear}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
          style={{ ...sel, width: 90 }} />
      )}
      {uiPeriod === 'custom' && (
        <>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={sel} />
          <span style={{ color: 'var(--text-secondary,#9ca3af)' }}>{L('to', 'đến')}</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={sel} />
          <button style={btn} disabled={!customFrom || !customTo} onClick={() => onChange({ period: 'custom', from: customFrom, to: customTo })}>
            {L('Apply', 'Áp dụng')}
          </button>
        </>
      )}
    </div>
  );
}
