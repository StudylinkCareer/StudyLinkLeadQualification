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

  // Real-device report (2026-09-30, mobile Safari): the top of the art is cut
  // off and a gray/white gap sits at the bottom EVEN AT REST — not just a
  // transient overscroll-bounce flash — and the page is genuinely scrollable
  // (confirmed: scrolling moves the art further, growing the gap). The CSS's
  // 100dvh computed a pixel-perfect fill in both Chromium and WebKit headless
  // tests, so this isn't the button's own sizing — it's `.wz-frame` (the
  // parent) ALSO needing this fix: an earlier pass only pinned `.wz-splash`'s
  // min-height, but `.wz-frame` still had its own separate `min-height:100dvh`
  // via wizard.css, and a FLEX COLUMN parent with a plain min-height (not a
  // fixed height) sizes to max(its own floor, child's size) — so if the
  // parent's dvh reading is even slightly taller than the child's now-correct
  // pixel height, the frame ends up taller than the viewport, the page
  // becomes scrollable, and the extra space shows through as this gap.
  // Pinning BOTH to the same live window.innerHeight — with `.wz-frame` at an
  // EXACT height (not just a floor) — removes any way for the two to
  // disagree, and removes the scrollability itself, not just its symptom.
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
    <div className="wz-frame" style={vh ? { height: `${vh}px`, minHeight: `${vh}px` } : undefined}>
      <button type="button" className="wz-splash" onClick={go} aria-label={w('splashHint')}
        style={vh ? { height: `${vh}px`, minHeight: `${vh}px` } : undefined}>
        <span className="wz-splash-dots" aria-hidden="true"><i /><i /><i /></span>
      </button>
    </div>
  );
}
