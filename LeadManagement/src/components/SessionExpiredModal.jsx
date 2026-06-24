// LeadManagement/src/components/SessionExpiredModal.jsx
//
// Shows a modal when the API layer (services/api.js request()) fires a global
// 'session-expired' event on any 401. It renders OVER the current page, so the
// page never unmounts and the user's unsaved edits stay in React state.
//
// "Log in again" opens /login in a NEW TAB. Once the user signs in there, the
// session cookie refreshes for THIS tab too (cookies are shared per domain),
// so they can come back, click "I've logged in", and retry their save with
// their edits intact. No navigation here = no lost work.

import { useState, useEffect } from 'react';

export default function SessionExpiredModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onExpired = () => setOpen(true);
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, []);

  if (!open) return null;

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000,
  };
  const card = {
    background: '#fff', borderRadius: 14, padding: 28, maxWidth: 440, width: '90%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)', textAlign: 'center',
  };
  const primaryBtn = {
    padding: '11px 20px', borderRadius: 10, border: 'none',
    background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer',
  };
  const secondaryBtn = {
    padding: '11px 20px', borderRadius: 10, border: '1px solid #d1d5db',
    background: '#fff', color: '#374151', fontWeight: 600, cursor: 'pointer',
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
      <div style={card}>
        <div
          id="session-expired-title"
          style={{ fontSize: 22, fontWeight: 800, marginBottom: 10, color: '#111827' }}
        >
          Session expired
        </div>
        <p style={{ color: '#4b5563', fontSize: 15, lineHeight: 1.5, margin: '0 0 8px' }}>
          You have been signed out because your session timed out.
        </p>
        <p style={{ color: '#4b5563', fontSize: 15, lineHeight: 1.5, margin: '0 0 22px' }}>
          Your unsaved changes are still here on this page. Log in again in the new
          tab, then come back and click <strong>I&apos;ve logged in</strong> to continue
          and save.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            style={primaryBtn}
            onClick={() => window.open('/login', '_blank', 'noopener')}
          >
            Log in again (new tab)
          </button>
          <button
            style={secondaryBtn}
            onClick={() => setOpen(false)}
          >
            I&apos;ve logged in - continue
          </button>
        </div>
      </div>
    </div>
  );
}
