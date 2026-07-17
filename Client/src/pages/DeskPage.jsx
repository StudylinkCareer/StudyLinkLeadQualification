// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Client/src/pages/DeskPage.jsx
// ─────────────────────────────────────────────────────────────────────
// Phase 2.2c — PUBLIC rep desk page (mobile-first). Reached at /desk?rep=<token>.
// Flow: enter PIN → (auto desk for institution reps / pick desk for roving SL
// staff) → scan student QR → see NAME ONLY → write a note + optional 1–10
// rating → saved as a stamped segment under the event topic. No LM login.
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { eventDeskAPI } from '../services/api';
import InlineQrScanner from '../components/Camera/InlineQrScanner';
import quartzImg   from '../Assets/Stones/quartz.png';
import agateImg    from '../Assets/Stones/agate.png';
import sapphireImg from '../Assets/Stones/sapphire.png';
import rubyImg     from '../Assets/Stones/ruby.png';
import diamondImg  from '../Assets/Stones/diamond.png';

// Stone art keyed by the tier returned with the scan lookup.
const STONE_IMAGES = { Quartz: quartzImg, Agate: agateImg, Sapphire: sapphireImg, Ruby: rubyImg, Diamond: diamondImg };

const SS_KEY = 'studylink_desk_auth';

const wrap  = { maxWidth: 520, margin: '0 auto', padding: '16px', fontFamily: 'system-ui, sans-serif' };
const card  = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 14 };
const label = { fontSize: 13, color: '#6b7280', fontWeight: 600 };
const input = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 16, boxSizing: 'border-box' };
const btn   = { width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { padding: '10px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', fontSize: 14, cursor: 'pointer' };

export default function DeskPage() {
  const repToken   = new URLSearchParams(window.location.search).get('rep') || '';
  const pinFromUrl = new URLSearchParams(window.location.search).get('pin') || '';

  const [auth, setAuth]   = useState(() => sessionStorage.getItem(SS_KEY) || '');
  const [rep, setRep]     = useState(null);
  const [phase, setPhase] = useState('login');   // login | pickDesk | desk
  const [pin, setPin]     = useState('');
  // One-click links carry &pin=. If present (and not already signed in), we
  // sign in automatically and show a brief "Signing you in..." screen.
  const [autoSigningIn, setAutoSigningIn] = useState(
    () => Boolean(repToken && pinFromUrl && !sessionStorage.getItem(SS_KEY))
  );
  const [desk, setDesk]   = useState(null);      // { institutionId, institutionName }
  const [desks, setDesks] = useState([]);
  const [student, setStudent] = useState(null);  // { studentUniqueId, fullName }
  const [note, setNote]   = useState('');
  const [rating, setRating] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const loadDesks = useCallback(async (authToken) => {
    try { const res = await eventDeskAPI.desks(authToken); setDesks(res.data || []); }
    catch (e) { setError(e.message || 'Failed to load desks'); }
  }, []);

  const routeAfterLogin = useCallback(async (authToken, r) => {
    if (r.institutionId) {
      try {
        await eventDeskAPI.signInDesk(authToken, r.institutionId);
        setDesk({ institutionId: r.institutionId, institutionName: r.institutionName });
        setPhase('desk');
        return;
      } catch { /* fall through to manual pick */ }
    }
    setPhase('pickDesk');
    loadDesks(authToken);
  }, [loadDesks]);

  // Resume an existing session on load (e.g. after a refresh).
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await eventDeskAPI.me(auth);
        if (cancelled) return;
        const { rep: r, deskSession } = res.data;
        setRep(r);
        if (deskSession) { setDesk({ institutionId: deskSession.institutionId, institutionName: deskSession.institutionName }); setPhase('desk'); }
        else { await routeAfterLogin(auth, r); }
      } catch {
        if (cancelled) return;
        sessionStorage.removeItem(SS_KEY); setAuth(''); setRep(null); setPhase('login');
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One-click sign-in: if the link carries &pin= and we're not already signed
  // in, log in automatically, then strip the PIN out of the URL.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    if (auth || !repToken || !pinFromUrl) { setAutoSigningIn(false); return; }
    autoTried.current = true;
    (async () => {
      setError('');
      try {
        const res = await eventDeskAPI.login(repToken, pinFromUrl);
        const { authToken, rep: r } = res.data;
        sessionStorage.setItem(SS_KEY, authToken);
        setAuth(authToken); setRep(r);
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('pin');
          window.history.replaceState({}, '', u.pathname + u.search);
        } catch { /* ignore */ }
        await routeAfterLogin(authToken, r);
      } catch (e) {
        setError(e.message || 'Sign-in failed — enter your PIN to continue.');
      } finally {
        setAutoSigningIn(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doLogin = async () => {
    if (!repToken) { setError('This link is missing its rep code — use the link from your event organiser.'); return; }
    if (!pin.trim()) return;
    setBusy(true); setError('');
    try {
      const res = await eventDeskAPI.login(repToken, pin.trim());
      const { authToken, rep: r } = res.data;
      sessionStorage.setItem(SS_KEY, authToken);
      setAuth(authToken); setRep(r); setPin('');
      await routeAfterLogin(authToken, r);
    } catch (e) { setError(e.message || 'Sign-in failed'); }
    finally { setBusy(false); }
  };

  const chooseDesk = async (d) => {
    setBusy(true); setError('');
    try { await eventDeskAPI.signInDesk(auth, d.institutionId); setDesk(d); setPhase('desk'); }
    catch (e) { setError(e.message || 'Could not sign into that desk'); }
    finally { setBusy(false); }
  };

  const onScan = useCallback(async (decodedText) => {
    setError('');
    try {
      const res = await eventDeskAPI.lookup(auth, decodedText);
      setStudent(res.data);
    } catch (e) { setError(e.message || 'Not recognised'); }
  }, [auth]);

  const saveVisit = async () => {
    if (!note.trim()) { setError('Vui lòng nhập ghi chú trước khi lưu.'); return; }
    setBusy(true); setError('');
    try {
      await eventDeskAPI.visit(auth, { studentUniqueId: student.studentUniqueId, note: note.trim(), repRating: rating || null });
      setToast(`Đã lưu · ${student.fullName}`);
      setStudent(null); setNote(''); setRating('');
      setTimeout(() => setToast(''), 2500);
    } catch (e) { setError(e.message || 'Failed to save'); }
    finally { setBusy(false); }
  };

  const cancelStudent = () => { setStudent(null); setNote(''); setRating(''); setError(''); };

  const switchDesk = () => { setStudent(null); setPhase('pickDesk'); loadDesks(auth); };
  const signOut = async () => {
    try { await eventDeskAPI.signOutDesk(auth); } catch { /* ignore */ }
    sessionStorage.removeItem(SS_KEY);
    setAuth(''); setRep(null); setDesk(null); setStudent(null); setPin(''); setPhase('login');
  };

  const errBox = error && (
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 14 }}>{error}</div>
  );
  const toastBox = toast && (
    <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>{toast}</div>
  );

  // ── AUTO SIGN-IN (one-click link) ──
  if (autoSigningIn) {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 2px' }}>StudyLink — Desk sign-in</h1>
        <div style={card}>
          <p style={{ color: '#6b7280', margin: 0, fontSize: 14 }}>Signing you in…</p>
        </div>
      </div>
    );
  }

  // ── LOGIN ──
  if (phase === 'login') {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 2px' }}>StudyLink — Desk sign-in</h1>
        <p style={{ color: '#6b7280', margin: '0 0 18px', fontSize: 14 }}>Enter your PIN to start.</p>
        <div style={card}>
          {errBox}
          <label style={label}>Your PIN</label>
          <input
            style={{ ...input, marginTop: 6, marginBottom: 14, letterSpacing: '0.3em', textAlign: 'center', fontSize: 22 }}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
            inputMode="numeric"
            placeholder="••••"
            autoFocus
          />
          <button style={{ ...btn, opacity: busy || !pin.trim() ? 0.6 : 1 }} disabled={busy || !pin.trim()} onClick={doLogin}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>
    );
  }

  // ── PICK DESK (roving) ──
  if (phase === 'pickDesk') {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '8px 0 2px' }}>Choose a desk</h1>
        <p style={{ color: '#6b7280', margin: '0 0 14px', fontSize: 14 }}>{rep ? `Signed in as ${rep.fullName}` : ''}</p>
        {errBox}
        <div style={card}>
          {desks.length === 0 && <p style={{ color: '#6b7280', fontSize: 14 }}>No desks set up for this event yet.</p>}
          {desks.map((d) => (
            <button key={d.institutionId} style={{ ...btnGhost, width: '100%', textAlign: 'left', padding: '14px', marginBottom: 8, fontSize: 16, fontWeight: 600 }} disabled={busy} onClick={() => chooseDesk(d)}>
              {d.institutionName}
            </button>
          ))}
        </div>
        <button style={{ ...btnGhost, width: '100%' }} onClick={signOut}>Sign out</button>
      </div>
    );
  }

  // ── DESK (scan + note) ──
  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{desk ? desk.institutionName : 'Desk'}</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>{rep ? rep.fullName : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnGhost} onClick={switchDesk}>Switch</button>
          <button style={btnGhost} onClick={signOut}>Sign out</button>
        </div>
      </div>

      {toastBox}
      {errBox}

      {!student && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Quét mã QR của học sinh</div>
          <InlineQrScanner active onScan={onScan} />
        </div>
      )}

      {student && (
        <div style={card}>
          {/* Questionnaire title + the student's stone (image + name), kept on
              ONE row even on phone widths: the chip never shrinks or wraps,
              the title flexes (and is sized to fit beside the chip). */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8, margin: '0 0 12px' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#c8102e', lineHeight: 1.3 }}>
              Giải Mã Chỉ Số Xuất Ngoại
            </div>
            {student.stoneTier && STONE_IMAGES[student.stoneTier] && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, background: '#fdf4f5', border: '1px solid #f3d6da', borderRadius: 8, padding: '3px 10px' }}>
                <img src={STONE_IMAGES[student.stoneTier]} alt={student.stoneTier}
                     style={{ width: 24, height: 24, objectFit: 'contain' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#c8102e', whiteSpace: 'nowrap' }}>{student.stoneTier}</span>
              </span>
            )}
          </div>

          <div style={label}>Học sinh</div>
          <div style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 14px' }}>{student.fullName}</div>

          {student.profile && student.profile.length > 0 ? (
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 12px', margin: '0 0 16px' }}>
              {student.profile.map((f, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 14, borderTop: i ? '1px solid #eef0f2' : 'none' }}>
                  <span style={{ color: '#6b7280' }}>{f.label}</span>
                  <span style={{ fontWeight: 600, textAlign: 'right' }}>{f.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', margin: '0 0 16px', fontSize: 13, color: '#92400e' }}>
              Học sinh chưa trả lời bảng câu hỏi — mời bạn ấy mở liên kết trên thẻ để hoàn thành.
            </div>
          )}

          <label style={label}>Ghi chú</label>
          <textarea
            style={{ ...input, marginTop: 6, marginBottom: 14, minHeight: 120, resize: 'vertical' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Bạn đã trao đổi những gì tại bàn tư vấn?"
            autoFocus
          />

          <label style={label}>Mức độ quan tâm (không bắt buộc, 1–10)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 16px' }}>
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button
                key={n}
                onClick={() => setRating(String(n))}
                style={{
                  width: 40, height: 40, borderRadius: 8, cursor: 'pointer', fontWeight: 700,
                  border: '1px solid ' + (String(n) === rating ? '#2563eb' : '#d1d5db'),
                  background: String(n) === rating ? '#2563eb' : '#fff',
                  color: String(n) === rating ? '#fff' : '#374151',
                }}
              >{n}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveVisit}>{busy ? 'Đang lưu…' : 'Lưu ghi chú'}</button>
            <button style={{ ...btnGhost, flexShrink: 0 }} onClick={cancelStudent}>Hủy</button>
          </div>
        </div>
      )}
    </div>
  );
}
