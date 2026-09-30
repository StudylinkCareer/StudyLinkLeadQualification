// src/components/reports/YearQuarterPicker.jsx
// -----------------------------------------------------------------------------
// Shared Quarter + Year dropdown pair for PeriodPicker.jsx's Quarterly option,
// mirroring YearMonthPicker.jsx exactly (same two-plain-<select>s approach —
// see that file's header note on why native date-ish inputs are avoided here).
//
// `value`: 'YYYY-Q#' (Q1-Q4), always a complete value. `onChange(next: 'YYYY-Q#')`.
// -----------------------------------------------------------------------------
const sel = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border,#e5e7eb)' };

const QUARTER_LABELS = [
  ['Q1', 'Quý 1'], ['Q2', 'Quý 2'], ['Q3', 'Quý 3'], ['Q4', 'Quý 4'],
];

export default function YearQuarterPicker({ value, onChange, L, yearsBack = 5, yearsForward = 1, style }) {
  const [y, q] = String(value || '').split('-Q');
  const nowYear = new Date().getFullYear();
  const years = [];
  for (let yr = nowYear + yearsForward; yr >= nowYear - yearsBack; yr--) years.push(yr);
  if (y && !years.includes(Number(y))) years.push(Number(y));
  years.sort((a, b) => b - a);

  return (
    <span style={{ display: 'inline-flex', gap: '0.4rem', ...style }}>
      <select value={q} onChange={e => onChange(`${y}-Q${e.target.value}`)} style={sel}>
        {QUARTER_LABELS.map(([en, vi], i) => (
          <option key={i + 1} value={i + 1}>{L(en, vi)}</option>
        ))}
      </select>
      <select value={y} onChange={e => onChange(`${e.target.value}-Q${q}`)} style={sel}>
        {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
      </select>
    </span>
  );
}
