// src/components/reports/KpiTiles.jsx
// -----------------------------------------------------------------------------
// Shared KPI tile row + drill-down side panel for Individual Report / Company
// Report (2026-08 merge). Weekly Report and Monthly Report each hand-rolled
// their own version of this before (confirmed during planning — zero shared
// UI code between them); this is the first actual shared building block.
// A "metric" is { key, label, value, items, cols, color }: `items` (if
// non-empty) makes the tile clickable, opening `cols`-shaped rows in the
// panel via `onOpen`.
// -----------------------------------------------------------------------------
export function KpiTiles({ metrics, onOpen }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
      {metrics.map(m => {
        const clickable = Array.isArray(m.items) && m.items.length > 0;
        return (
          <div key={m.key}
            onClick={() => clickable && onOpen({ title: m.label, cols: m.cols, items: m.items })}
            style={{
              flex: '1 1 140px', minWidth: 120, padding: '0.75rem 1rem', borderRadius: 8,
              border: `1px solid ${m.color || 'var(--border,#e5e7eb)'}`, borderLeftWidth: 4,
              background: 'var(--bg-primary,#fff)', cursor: clickable ? 'pointer' : 'default',
            }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary,#6b7280)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{m.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: m.color || 'inherit' }}>{m.value}</div>
          </div>
        );
      })}
    </div>
  );
}

// Fixed side panel, opened via KpiTiles' onOpen. `drill` = { title, cols, items } | null.
//
// Stacked label:value cards, not a wide table (2026-09, fixed after Hoàng's
// Contract Sources drilldown made this a real problem — 6 cols of names/
// dates/free text in a 420px panel forced a horizontal scrollbar to read
// the later columns). A table can't win here: fixed layout truncates real
// content, auto layout just overflows the panel. Cols stack per item
// instead, so width is only ever driven by the panel, not by column count —
// this scales to any number of cols without ever needing horizontal scroll,
// and costs nothing on the existing 1-4 col drills elsewhere (still reads
// as a compact list, just one line per field instead of one line per item).
export function DrillPanel({ drill, onClose, onRowClick, L }) {
  if (!drill) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px, 100vw)', background: 'var(--bg-primary,#fff)',
      borderLeft: '1px solid var(--border,#e5e7eb)', boxShadow: '-4px 0 12px rgba(0,0,0,0.08)', zIndex: 50,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border,#e5e7eb)' }}>
        <div style={{ fontWeight: 700 }}>{drill.title} ({drill.items.length})</div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {drill.items.map((it, i) => (
          <div key={it.studentId ? `${it.studentId}-${i}` : i}
            onClick={() => it.studentId && onRowClick && onRowClick(it.studentId)}
            style={{ padding: '0.5rem 1rem', cursor: it.studentId ? 'pointer' : 'default', borderBottom: '1px solid var(--border,#f1f5f9)' }}>
            {drill.cols.map(c => (
              <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.1rem 0', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-secondary,#6b7280)', flexShrink: 0 }}>{c.label}</span>
                <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{it[c.key] ?? ''}</span>
              </div>
            ))}
          </div>
        ))}
        {drill.items.length === 0 && (
          <div style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary,#9ca3af)' }}>{L ? L('No records', 'Không có') : 'No records'}</div>
        )}
      </div>
    </div>
  );
}
