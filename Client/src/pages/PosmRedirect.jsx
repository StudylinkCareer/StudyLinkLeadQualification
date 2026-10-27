import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { savePosm, clearPosm } from '../wizard/lib/posm';

// Printed POSM QR target: /q/<code>. The code never changes once printed, so
// where it leads is decided here, not in the QR. Unknown or hidden codes still
// land on the sign-up form, just untagged.
export default function PosmRedirect() {
  const { code } = useParams();
  const navigate = useNavigate();
  const started = useRef(false);   // each lookup counts a scan: run it once

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try { sessionStorage.removeItem('wz_qr'); } catch { /* private mode */ }
    fetch(`/api/posm/public/${encodeURIComponent(code || '')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.data) savePosm({ code: j.data.code, name: j.data.name, events: j.data.events || [] });
        else clearPosm();
      })
      .catch(() => clearPosm())
      .finally(() => navigate('/app/reg', { replace: true }));
  }, [code, navigate]);

  return <div style={{ padding: 32, textAlign: 'center', fontFamily: 'sans-serif', color: '#666' }}>…</div>;
}
