// src/components/TrailBreadcrumb.jsx
//
// PURPOSE
//   Renders the current navigation trail as a chip strip:
//     Dashboard › Leads (Status: Lost) › Lead: Tran Van B
//
//   - Last chip is the current page (not clickable, bold)
//   - Earlier chips are clickable — clicking jumps to that step
//   - Hidden when trail has fewer than 2 entries (no point showing
//     just "Dashboard" by itself).
//
//   Designed to sit just under the page header. Consumers should not
//   need to pass any props.

import { useNavTrail } from '../contexts/NavTrailContext';

export default function TrailBreadcrumb() {
  const { trail, jumpTo } = useNavTrail();

  // Don't render anything if the trail is empty or has only the current page.
  if (!trail || trail.length < 2) return null;

  return (
    <nav
      aria-label="Navigation trail"
      style={{
        display:'flex', flexWrap:'wrap', alignItems:'center',
        gap:'4px', padding:'6px 10px',
        fontSize:'0.75rem',
        color:'var(--text-secondary)',
        background:'var(--bg-secondary)',
        borderBottom:'1px solid var(--border)',
      }}>
      {trail.map((entry, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={`${i}-${entry.path}`} style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
            {isLast ? (
              <span style={{
                fontWeight:600,
                color:'var(--text-primary)',
                padding:'2px 6px',
              }}>
                {entry.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => jumpTo(i)}
                title={`Go back to ${entry.label}`}
                style={{
                  background:'transparent', border:'none',
                  color:'var(--primary)', cursor:'pointer',
                  padding:'2px 6px', borderRadius:'4px',
                  fontSize:'inherit',
                  textDecoration:'underline',
                  textUnderlineOffset:'2px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {entry.label}
              </button>
            )}
            {!isLast && (
              <span aria-hidden="true" style={{ color:'var(--text-secondary)', opacity:0.6 }}>
                ›
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
