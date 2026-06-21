// Client/src/pages/BadgePage.jsx
// ---------------------------------------------------------------------
// Public, full-screen registration badge. A student opens this from the
// "View your badge" link in their email and keeps it on screen (or saves the
// image) to show at each institution booth.
//
// The token comes from the path (/badge/:token); the student name, event name
// and dates ride in the query string (n, e, d) so the page needs no server
// lookup. The QR still encodes ONLY the bare token, which is what the desk
// scanner resolves -- nothing sensitive is in the URL, just the caption text.
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { renderBadgePng } from '../utils/badgeRenderer';

export default function BadgePage() {
  const { token } = useParams();
  const [params]  = useSearchParams();
  const [img, setImg] = useState('');
  const [err, setErr] = useState('');

  const name  = params.get('n') || '';
  const event = params.get('e') || '';
  const dates = params.get('d') || '';

  useEffect(() => {
    if (!token) { setErr('Missing badge code.'); return; }
    renderBadgePng({
      data: token,
      title: name,
      metaLines: [event, dates].filter(Boolean),
    })
      .then(setImg)
      .catch((e) => setErr(e.message || 'Could not render your badge.'));
  }, [token, name, event, dates]);

  return (
    <div style={{
      minHeight: '100vh', background: '#f3f4f6', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px',
    }}>
      {err ? (
        <div style={{ color: '#b91c1c', fontSize: 15 }}>{err}</div>
      ) : img ? (
        <>
          <img src={img} alt="Registration badge" style={{ width: 300, maxWidth: '90vw', height: 'auto' }} />
          <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', maxWidth: 320, marginTop: 16, lineHeight: 1.5 }}>
            Show this at each institution desk to be scanned. Keep this page open,
            or press and hold the image to save it to your phone.
          </p>
        </>
      ) : (
        <div style={{ color: '#9ca3af', fontSize: 15 }}>Generating your badge...</div>
      )}
    </div>
  );
}
