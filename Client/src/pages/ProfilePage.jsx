// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Client/src/pages/ProfilePage.jsx
// ---------------------------------------------------------------------
// PUBLIC "Know you better" page. Reached from the badge email at
// /profile?t=<attendance_token>. The student answers the qualification
// questions (dropdowns from the lookup lists); submitting writes the
// answers back to their lead. No login - the token is the credential.
// ---------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { profileAPI } from '../services/api';

const wrap  = { maxWidth: 560, margin: '0 auto', padding: '16px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' };
const card  = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 14 };
const label = { display: 'block', fontSize: 13, color: '#374151', fontWeight: 600, marginBottom: 4 };
const input = { width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 16, boxSizing: 'border-box', background: '#fff' };
const btn   = { width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: '#c8102e', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' };

export default function ProfilePage() {
  const token = new URLSearchParams(window.location.search).get('t') || '';

  const [loading, setLoading]   = useState(true);
  const [fullName, setFullName] = useState('');
  const [fields, setFields]     = useState([]);
  const [values, setValues]     = useState({});
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  useEffect(() => {
    if (!token) { setError('This link is missing its code. Please use the link from your registration email.'); setLoading(false); return; }
    (async () => {
      try {
        const res = await profileAPI.get(token);
        const d = res.data || {};
        setFullName(d.fullName || '');
        const fs = d.fields || [];
        setFields(fs);
        const init = {};
        fs.forEach((f) => { init[f.fieldKey] = f.value || ''; });
        setValues(init);
      } catch (e) {
        setError(e.message || 'We could not find your registration for this link.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const setVal = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await profileAPI.save(token, values);
      setDone(true);
    } catch (e) {
      setError(e.message || 'Could not save your answers. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={wrap}><div style={card}>Loading...</div></div>;
  }

  if (done) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: '#15803d' }}>Thank you!</div>
          <div style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.5 }}>
            Your answers are saved. The institutions at our exhibition will already know your goals,
            so you can spend your time on what matters. See you there!
          </div>
        </div>
      </div>
    );
  }

  if (error && fields.length === 0) {
    return <div style={wrap}><div style={{ ...card, color: '#b91c1c' }}>{error}</div></div>;
  }

  return (
    <div style={wrap}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 8px' }}>
          Know you better{fullName ? `, ${fullName}` : ''}
        </h1>
        <p style={{ color: '#6b7280', margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Please answer these questions so each institution does not have to ask you the same things.
          It saves you time and makes your experience at our exhibition smoother.
        </p>
      </div>

      <div style={card}>
        {fields.map((f) => (
          <div key={f.fieldKey} style={{ marginBottom: 14 }}>
            <label style={label}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={values[f.fieldKey] || ''} onChange={(e) => setVal(f.fieldKey, e.target.value)} style={input}>
                <option value="">Select...</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input value={values[f.fieldKey] || ''} onChange={(e) => setVal(f.fieldKey, e.target.value)} style={input} />
            )}
          </div>
        ))}

        {error && <div style={{ color: '#b91c1c', fontSize: 14, marginBottom: 12 }}>{error}</div>}

        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
          {busy ? 'Saving...' : 'Submit my answers'}
        </button>
      </div>
    </div>
  );
}
