import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { captureQrParams } from '../lib/qrParams';

// Campaign splash: the whole screen is the tap target (the designer dropped the CTA).
// The artwork is a flat image (text baked in) — Hoàng will supply an updated one.
export default function Splash() {
  const navigate = useNavigate();
  const { status, w } = useWizard();
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : null));

  // Keep an event-QR link's parameters alive across the tap and any reload.
  useEffect(() => { captureQrParams(); }, []);

  // Real-device report (2026-09-30, mobile Safari): a white gap below the
  // splash art, even though the CSS's 100dvh computes a pixel-perfect fill in
  // both Chromium and WebKit headless tests — no gap reproducible without a
  // real dynamic toolbar. iOS Safari's dvh unit is known to not always
  // reflow when its collapsible toolbar settles, effectively "sticking" to
  // whatever value it computed at an earlier, different toolbar state.
  // window.innerHeight has no such caching quirk — it's a live query — so
  // this screen (the one place a scroll never happens, making a plain pixel
  // height perfectly safe) measures it directly and keeps it in sync instead
  // of trusting the CSS unit. `.wz-splash`'s own `min-height:100dvh` stays as
  // the pre-hydration/no-JS fallback.
  useEffect(() => {
    const update = () => setVh(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  const go = () => navigate(status === 'ready' ? '/app/hub' : '/app/reg');

  return (
    <div className="wz-frame">
      <button type="button" className="wz-splash" onClick={go} aria-label={w('splashHint')}
        style={vh ? { minHeight: `${vh}px` } : undefined}>
        <span className="wz-splash-dots" aria-hidden="true"><i /><i /><i /></span>
      </button>
    </div>
  );
}
