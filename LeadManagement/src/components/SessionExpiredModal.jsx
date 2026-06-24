// LeadManagement/src/components/SessionExpiredModal.jsx
//
// Shown when the API layer (services/api.js) fires a global 'session-expired'
// event on a 401. Displays one clear message and one button that takes the
// user to a fresh login. We do NOT try to preserve unsaved edits - the user
// is told up front that they will need to re-enter them.

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
    padding: '11px 24px', borderRadius: 10, border: 'none',
    background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer',
    fontSize: 15,
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
      <div style={card}>
        <div
          id="session-expired-title"
          style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, color: '#111827' }}
        >
          Session expired
        </div>
        <p style={{ color: '#4b5563', fontSize: 15, lineHeight: 1.55, margin: '0 0 24px' }}>
          We are currently rolling out updates, so you have been signed out.
          Please log in again. Any unsaved changes on this page will need to be
          re-entered.
        </p>
        <button
          style={primaryBtn}
          onClick={() => { window.location.href = '/login'; }}
        >
          Log in again
        </button>
      </div>
    </div>
  );
}
