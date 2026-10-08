import { useEffect, useState } from 'react';
import { useWizard } from '../context/WizardContext';
import { studentAPI } from '../../services/api';
import { renderBadgePng, dataUrlToBase64 } from '../../utils/badgeRenderer';
import { STONE_GLYPHS } from '../../utils/stoneGlyphs';

// On-site event check-in: the student's event QR, shown on the hub right after
// registration and sent to them by e-mail + Zalo. Booth staff scan it to take
// notes (and complete the gem if it's still missing). Renders nothing unless
// the student is registered for an on-site event (events.meta.checkinFlow).
// The send is attempted once per browser session per event; the server skips
// any channel that already went out.
const SENT_KEY = (eventId) => `wz_pass_sent_${eventId}`;

export default function EventPassCard() {
  const { student, w, language } = useWizard();
  const id = student && student.studentId;
  const name = (student && student.fullName) || '';
  const tier = (student && student.stoneTier) || '';
  const [passes, setPasses] = useState([]);   // [{ eventId, eventName, token, img, emailed, zaloSent }]

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    (async () => {
      let list = [];
      try { list = (await studentAPI.eventPasses(id)).data || []; } catch { return; }
      if (cancelled || !list.length) return;
      setPasses(list);
      for (const p of list) {
        let img = '';
        try {
          img = await renderBadgePng({
            data: p.token,
            title: name,
            metaLines: [language === 'vi' ? p.eventName : p.eventNameEn],
            ...(STONE_GLYPHS[tier] ? { logoUrl: STONE_GLYPHS[tier] } : {}),
          });
        } catch { continue; }
        if (cancelled) return;
        setPasses((cur) => cur.map((x) => (x.eventId === p.eventId ? { ...x, img } : x)));

        let tried = false;
        try { tried = !!sessionStorage.getItem(SENT_KEY(p.eventId)); } catch { /* private mode */ }
        if ((p.emailed && p.zaloSent) || tried) continue;
        try { sessionStorage.setItem(SENT_KEY(p.eventId), '1'); } catch { /* private mode */ }
        try {
          const r = (await studentAPI.sendEventPass(id, p.eventId, dataUrlToBase64(img))).data || {};
          if (!cancelled) {
            setPasses((cur) => cur.map((x) => (x.eventId === p.eventId ? { ...x, emailed: !!r.emailed, zaloSent: !!r.zaloSent } : x)));
          }
        } catch { /* the QR is on screen either way */ }
      }
    })();
    return () => { cancelled = true; };
  }, [id, name, tier, language]);

  if (!passes.length) return null;

  return passes.map((p) => {
    const channels = [p.zaloSent && 'Zalo', p.emailed && 'Email'].filter(Boolean);
    return (
      <section key={p.eventId} className="wz-pass" aria-label={w('passTitle')}>
        <h2 className="wz-pass-title">{w('passTitle')}</h2>
        <p className="wz-pass-event">{language === 'vi' ? p.eventName : p.eventNameEn}</p>
        {p.img
          ? <img className="wz-pass-qr" src={p.img} alt={w('passTitle')} />
          : <div className="wz-pass-qr wz-pass-qr--loading">{w('loading')}</div>}
        <p className="wz-pass-hint">{w('passHint')}</p>
        <p className="wz-pass-sent">
          {channels.length ? `${w('passSentVia')} ${channels.join(' & ')}` : w('passSave')}
        </p>
      </section>
    );
  });
}
