// src/components/DevBadge.jsx
// -----------------------------------------------------------------------------
// Tiny environment badge so you can tell at a glance that you're on a LOCAL
// DEV build, and WHICH git branch/worktree is being served. It renders ONLY in
// non-production builds: in the deployed Netlify build `import.meta.env.PROD`
// is true, so this returns null and nothing ever ships to real users.
//
// The branch string is injected at dev-server/build start by vite.config.js
// (define: __APP_BRANCH__ = output of `git rev-parse --abbrev-ref HEAD`), so a
// `deep-cleanse` worktree shows "DEV · deep-cleanse", this one shows
// "DEV · rename-unique-id-to-student-id", etc. — no hardcoding.
// -----------------------------------------------------------------------------

export default function DevBadge() {
  if (import.meta.env.PROD) return null; // never show on the live site

  const branch =
    (typeof __APP_BRANCH__ !== 'undefined' && __APP_BRANCH__) || 'local';

  return (
    <div
      title="Local DEV build — not production"
      style={{
        position: 'fixed',
        bottom: 10,
        left: 10,
        zIndex: 99999,
        pointerEvents: 'none', // never intercept clicks
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: '#b45309', // amber
        color: '#fff',
        font: '600 11px/1 system-ui, -apple-system, sans-serif',
        letterSpacing: '0.02em',
        padding: '5px 9px',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        opacity: 0.92,
        userSelect: 'none',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fde68a' }} />
      DEV · {branch}
    </div>
  );
}
