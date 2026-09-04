// src/components/reports/YearMonthPicker.jsx
// -----------------------------------------------------------------------------
// Shared Month + Year dropdown pair for anywhere a 'YYYY-MM' string is
// picked — Individual/Company Report's Monthly period (PeriodPicker.jsx) and
// Staff Targets' two month-scoped grids (Daily Call Quotas, Pre-sales
// Working Hours). Replaces the native <input type="month"> in all three
// (2026-09, requested — the native control's calendar-picker UI and date
// format vary by browser/OS, and like every native date-ish input it can
// fire onChange with an incomplete value mid-edit; see PeriodPicker.jsx's
// header note on that whole bug class). Two plain <select>s only ever hold
// a complete value, so there's nothing to validate here.
//
// `value`: 'YYYY-MM' (required, always a complete value — callers own
// picking a sensible default before first render, same as the native input
// they're replacing). `onChange(next: 'YYYY-MM')`. `L` is the same
// `L(en, vi)` translator every other report/target component here already
// takes — kept consistent rather than adding a second, parallel `language`
// string prop.
// -----------------------------------------------------------------------------
const sel = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border,#e5e7eb)' };

const MONTH_LABELS = [
  ['January', 'Tháng 1'], ['February', 'Tháng 2'], ['March', 'Tháng 3'], ['April', 'Tháng 4'],
  ['May', 'Tháng 5'], ['June', 'Tháng 6'], ['July', 'Tháng 7'], ['August', 'Tháng 8'],
  ['September', 'Tháng 9'], ['October', 'Tháng 10'], ['November', 'Tháng 11'], ['December', 'Tháng 12'],
];

export default function YearMonthPicker({ value, onChange, L, yearsBack = 5, yearsForward = 1, style }) {
  const [y, m] = String(value || '').split('-');
  const nowYear = new Date().getFullYear();
  const years = [];
  for (let yr = nowYear + yearsForward; yr >= nowYear - yearsBack; yr--) years.push(yr);
  // The selected year might be older than yearsBack (e.g. real historical
  // data) — always include it so the dropdown never silently shows a
  // different year than `value` actually holds.
  if (y && !years.includes(Number(y))) years.push(Number(y));
  years.sort((a, b) => b - a);

  return (
    <span style={{ display: 'inline-flex', gap: '0.4rem', ...style }}>
      <select value={m} onChange={e => onChange(`${y}-${e.target.value}`)} style={sel}>
        {MONTH_LABELS.map(([en, vi], i) => {
          const mm = String(i + 1).padStart(2, '0');
          return <option key={mm} value={mm}>{L(en, vi)}</option>;
        })}
      </select>
      <select value={y} onChange={e => onChange(`${e.target.value}-${m}`)} style={sel}>
        {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
      </select>
    </span>
  );
}
