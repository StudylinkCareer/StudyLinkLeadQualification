import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { captureQrParams } from '../lib/qrParams';

// Campaign splash: the whole screen is the tap target (the designer dropped the CTA).
// The artwork is a flat image (text baked in) — Hoàng will supply an updated one.
//
// 2026-09-30: went through cover (crops whatever doesn't match the screen's
// ratio — cropped the top logo) and contain (never crops, but leaves visible
// letterbox gaps on a mismatched ratio — reported as "shrunken, gaps on all
// sides") before landing here, at the owner's suggestion: crop NOTHING,
// scale the image to the full screen WIDTH, and let the page scroll if the
// resulting height (image's own aspect ratio × screen width) is taller than
// the viewport — same as the image being embedded inline rather than as a
// CSS background. A real <img> is required for this (a background-image
// never affects its element's box height, so the earlier background-based
// version had no way to become "taller than viewport" in the first place —
// the container had to be told a height from outside; now the image tells
// it). Landing on a phone shows the top (logo/headline/CTA) filling the
// screen exactly as before; scrolling reveals the rest at full quality, no
// crop, no gap, ever, regardless of screen ratio.
export default function Splash() {
  const navigate = useNavigate();
  const { status, w } = useWizard();
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : null));

  // Keep an event-QR link's parameters alive across the tap and any reload.
  useEffect(() => { captureQrParams(); }, []);

  // Only a FLOOR now (min-height, not an exact height) — on a screen taller
  // than the image's own rendered height (rare: the image's ratio is near
  // the tall end of real devices already), this keeps the frame filling the
  // viewport instead of leaving it short; on a shorter screen the image's
  // own height naturally exceeds this floor and the page scrolls, which is
  // now the intended behavior, not a bug to eliminate.
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
    <div className="wz-frame" style={vh ? { minHeight: `${vh}px` } : undefined}>
      <button type="button" className="wz-splash" onClick={go} aria-label={w('splashHint')}
        style={vh ? { minHeight: `${vh}px` } : undefined}>
        <img className="wz-splash-img" src="/wizard/splash.jpg" alt="" />
        <span className="wz-splash-dots" aria-hidden="true"><i /><i /><i /></span>
      </button>
    </div>
  );
}
