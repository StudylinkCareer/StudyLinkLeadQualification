import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { captureQrParams } from '../lib/qrParams';

// Campaign splash: the whole screen is the tap target (the designer dropped the CTA).
// The artwork is a flat image (text baked in) — Hoàng will supply an updated one.
export default function Splash() {
  const navigate = useNavigate();
  const { status, w } = useWizard();

  // Keep an event-QR link's parameters alive across the tap and any reload.
  useEffect(() => { captureQrParams(); }, []);

  const go = () => navigate(status === 'ready' ? '/app/hub' : '/app/reg');

  return (
    <div className="wz-frame">
      <button type="button" className="wz-splash" onClick={go} aria-label={w('splashHint')}>
        <span className="wz-splash-dots" aria-hidden="true"><i /><i /><i /></span>
      </button>
    </div>
  );
}
