// src/components/reports/BarChartCard.jsx
// -----------------------------------------------------------------------------
// Ported from Weekly Report's original inline BarChart component (2026-09,
// per explicit request — "these graphs from weekly report are helpful,
// add them where applicable"). Simplified for single-group use: Individual
// Report and Company Report each render exactly one person's or one
// company's numbers at a time, never Weekly Report's old side-by-side
// multi-group comparison, so the groups-array plumbing from the original
// isn't needed here.
//
// `bars`: [{ key, label, value, color, items, cols }] — a bar is clickable
// (opens `items` in the DrillPanel via onOpen) only when `items` is a
// non-empty array; omit items/cols entirely for a bar with no drill-down.
// -----------------------------------------------------------------------------
const sub = { fontSize: '0.8rem', color: 'var(--text-secondary,#6b7280)' };

export default function BarChartCard({ title, subtitle, bars, onOpen }) {
  const H = 140;
  const max = Math.max(1, ...bars.map(b => b.value || 0));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={sub}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', padding: '0 0.25rem', overflowX: 'auto' }}>
        {bars.map(b => {
          const v = b.value || 0;
          const clickable = Array.isArray(b.items) && b.items.length > 0;
          const ph = Math.round((v / max) * (H - 20));
          return (
            <div key={b.key} style={{ flex: '1 1 0', minWidth: 50, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', height: H }}>
                <div
                  title={clickable ? 'Click to view leads' : String(v)}
                  onClick={clickable ? () => onOpen({ title: b.label, cols: b.cols || [{ key: 'fullName', label: 'Name' }], items: b.items }) : undefined}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: clickable ? 'pointer' : 'default' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, marginBottom: 3, color: 'var(--text-primary,#111827)' }}>{v}</div>
                  <div style={{ width: 34, height: Math.max(ph, v > 0 ? 6 : 2),
                    background: v > 0 ? (b.color || '#2563eb') : 'var(--border,#e5e7eb)', borderRadius: '4px 4px 0 0', transition: 'height .25s' }} />
                </div>
              </div>
              <div style={{ ...sub, marginTop: 8, textAlign: 'center', lineHeight: 1.2 }}>{b.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
