import { useState } from 'react';
import { Dialog } from './ui';
import { IconLink } from './Icons';
import { useWizard } from '../context/WizardContext';

// Shares a GENERIC StudyLink link only — nothing about the student (name, gem,
// persona) is ever put in the link or text. Where the device has a native share
// sheet (phones), Zalo / Instagram use it so the user can pick the app; otherwise
// they copy the link.
export default function ShareDialog({ onClose }) {
  const { w } = useWizard();
  const [toast, setToast] = useState('');
  const url = `${window.location.origin}/app`;
  const text = w('shareText');
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (hint) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more we can do */ }
      document.body.removeChild(ta);
    }
    setToast(hint || w('shareCopied'));
  };

  const nativeOrCopy = async () => {
    if (canNativeShare) {
      try { await navigator.share({ title: 'StudyLink', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copy(w('shareCopiedHint'));
  };

  const enc = encodeURIComponent;
  const options = [
    { key: 'facebook', label: 'Facebook', img: '/wizard/share-facebook.png', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { key: 'instagram', label: 'Instagram', img: '/wizard/share-instagram.png', onClick: nativeOrCopy },
    { key: 'threads', label: 'Threads', img: '/wizard/share-threads.png', href: `https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}` },
    { key: 'zalo', label: 'Zalo', img: '/wizard/share-zalo.png', onClick: nativeOrCopy },
  ];

  return (
    <Dialog title={`${w('shareTitle1')}${w('shareTitleHl')}${w('shareTitle2')}`} onClose={onClose} closeLabel={w('close')}
      heading={<>{w('shareTitle1')}<span className="wz-hl">{w('shareTitleHl')}</span>{w('shareTitle2')}</>}>
      <div className="wz-share-opts">
        {options.map((o) => (
          o.href
            ? <a key={o.key} className="wz-share-opt" href={o.href} target="_blank" rel="noopener noreferrer">
                <img src={o.img} alt="" />{o.label}
              </a>
            : <button key={o.key} type="button" className="wz-share-opt" onClick={o.onClick}>
                <img src={o.img} alt="" />{o.label}
              </button>
        ))}
        <button type="button" className="wz-share-opt" onClick={() => copy()}>
          <span className="wz-linkcircle"><IconLink width={20} height={20} /></span>{w('shareCopy')}
        </button>
      </div>
      <p className="wz-toast" role="status" aria-live="polite">{toast}</p>
    </Dialog>
  );
}
