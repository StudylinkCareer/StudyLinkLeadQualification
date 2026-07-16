// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Client/src/pages/ProfilePage.jsx
// ---------------------------------------------------------------------
// PUBLIC "Know you better" page. Reached from the badge email (and the
// Zalo badge message) at /profile?t=<attendance_token>.
//
// Landing view (what a student sees when the link opens, e.g. inside
// Zalo's in-app browser): their QR badge, the stone banner (when they
// have an evaluation), and a button that OPENS the questionnaire — the
// questionnaire never opens automatically.
//
// Submitting recalculates their evaluation server-side; the page then
// re-renders the badge with the stone glyph in the QR centre, posts it
// back (the server attaches it to the follow-up e-mail/Zalo), and shows
// the thank-you view. No login - the token is the credential. The QR
// encodes ONLY the bare token, exactly like BadgePage, so it scans
// identically at the desk.
// ---------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { profileAPI } from '../services/api';
import { renderBadgePng, dataUrlToBase64 } from '../utils/badgeRenderer';
import { STONE_GLYPHS } from '../utils/stoneGlyphs';

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
  const [badgeImg, setBadgeImg] = useState('');
  const [stone, setStone]       = useState(null);       // { tier, label, message } from GET (vi)
  const [invite, setInvite]     = useState(null);       // { time, venue, infoUrl } from events.meta.invite
  const [showForm, setShowForm] = useState(false);      // questionnaire opens only on demand
  const [evaluation, setEvaluation] = useState(null);   // { tier, label, message } after submit

  // Render the badge QR. Once the student has a stone, its flat glyph sits in
  // the centre of the QR in place of the StudyLink logo (error correction
  // level H keeps the code scannable).
  const renderBadge = (name, stoneTier) =>
    renderBadgePng({
      data: token,
      title: name,
      ...(stoneTier && STONE_GLYPHS[stoneTier] ? { logoUrl: STONE_GLYPHS[stoneTier] } : {}),
    });

  useEffect(() => {
    if (!token) { setError('Liên kết này thiếu mã. Vui lòng dùng liên kết trong tin nhắn đăng ký của bạn.'); setLoading(false); return; }
    (async () => {
      try {
        const res = await profileAPI.get(token);
        const d = res.data || {};
        const name = d.fullName || '';
        setFullName(name);
        setStone(d.stone || null);
        setInvite(d.invite || null);
        const fs = d.fields || [];
        setFields(fs);
        const init = {};
        fs.forEach((f) => { init[f.fieldKey] = f.value || ''; });
        setValues(init);

        // The badge is the page's centrepiece - never let a render hiccup
        // block the page, so swallow its errors.
        renderBadge(name, d.stoneTier).then(setBadgeImg).catch(() => {});
      } catch (e) {
        setError(e.message || 'Chúng tôi không tìm thấy đăng ký của bạn cho liên kết này.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const setVal = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await profileAPI.save(token, values);
      const evln = (res && res.data && res.data.evaluation) || null;
      setEvaluation(evln);
      setDone(true);

      // Render the UPDATED badge (stone glyph now in the centre) and post it
      // back — the server attaches it to the follow-up e-mail/Zalo. Best-effort
      // with one retry; the answers are already saved either way.
      if (evln && evln.tier) {
        renderBadge(fullName, evln.tier)
          .then(async (url) => {
            setBadgeImg(url);
            const png = dataUrlToBase64(url);
            try { await profileAPI.saveBadge(token, png); }
            catch { try { await profileAPI.saveBadge(token, png); } catch { /* answers already saved */ } }
          })
          .catch(() => {});
      }
    } catch (e) {
      setError(e.message || 'Không thể lưu câu trả lời của bạn. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  // Badge block - shown on the landing, form and thank-you views so the
  // student always keeps their QR.
  const badgeBlock = badgeImg ? (
    <div style={{ ...card, textAlign: 'center' }}>
      <img
        src={badgeImg}
        alt="Your registration badge"
        style={{ width: 280, maxWidth: '85%', height: 'auto' }}
      />
      <p style={{ color: '#6b7280', fontSize: 13, margin: '12px 0 0', lineHeight: 1.5 }}>
        Xuất trình mã QR này tại mỗi bàn của các trường để được quét. Nhấn giữ
        hình ảnh để lưu về điện thoại của bạn.
      </p>
    </div>
  ) : null;

  // Meeting-invite card (time / venue / info link, authored per event via
  // events.meta.invite) - mirrors the e-mail's "Bạn nhớ đừng quên" block so
  // Zalo recipients get the invite details too. Omitted when not configured.
  const inviteBlock = invite ? (
    <div style={{ ...card, background: '#fff1f2', border: '1px solid #fecdd3' }}>
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Bạn nhớ đừng quên</div>
      {invite.time && (
        <div style={{ fontSize: 14, marginBottom: 4 }}>📅 Thời gian: {invite.time}</div>
      )}
      {invite.venue && (
        <div style={{ fontSize: 14, marginBottom: invite.infoUrl ? 12 : 0 }}>📍 Địa điểm: {invite.venue}</div>
      )}
      {invite.infoUrl && (
        <div style={{ fontSize: 14 }}>
          Xem lại thông tin sự kiện tại:{' '}
          <a href={invite.infoUrl} style={{ color: '#2563eb', wordBreak: 'break-all' }}>{invite.infoUrl}</a>
        </div>
      )}
    </div>
  ) : null;

  // Stone banner (text only - the stone already shows inside the QR badge),
  // rendered directly below the badge whenever the student has an evaluation.
  const stoneBanner = (s) => s ? (
    <div style={{ ...card, background: '#fdf4f5', border: '1px solid #f3d6da' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#c8102e', marginBottom: 8, textAlign: 'center' }}>
        Chúc mừng Bạn! — {s.label || s.tier}
      </div>
      <div style={{ color: '#374151', fontSize: 14, lineHeight: 1.6 }}>
        {s.message}
      </div>
    </div>
  ) : null;

  if (loading) {
    return <div style={wrap}><div style={card}>Đang tải...</div></div>;
  }

  if (done) {
    return (
      <div style={wrap}>
        {badgeBlock}
        {inviteBlock}
        {stoneBanner(evaluation)}
        <div style={{ ...card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: '#15803d' }}>Cảm ơn bạn!</div>
          <div style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.5 }}>
            Câu trả lời của bạn đã được lưu.{evaluation ? ' Kết quả đánh giá và thẻ tham dự mới cũng đã được gửi tới bạn qua e-mail/Zalo.' : ''} Các
            trường tại triển lãm sẽ biết trước mục tiêu của bạn,
            giúp bạn dành thời gian cho những điều quan trọng. Hẹn gặp bạn tại sự kiện!
          </div>
        </div>
      </div>
    );
  }

  if (error && fields.length === 0) {
    return <div style={wrap}><div style={{ ...card, color: '#b91c1c' }}>{error}</div></div>;
  }

  // ── Landing view: badge + stone banner + "open the questionnaire" ──
  if (!showForm) {
    return (
      <div style={wrap}>
        {badgeBlock}
        {inviteBlock}
        {stoneBanner(stone)}
        <div style={{ ...card, textAlign: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 8px' }}>
            Tìm hiểu về bạn{fullName ? `, ${fullName}` : ''}
          </h2>
          <p style={{ color: '#6b7280', margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 }}>
            {stone
              ? 'Bạn đã hoàn thành bảng câu hỏi. Nếu có gì thay đổi, bạn có thể xem lại và cập nhật câu trả lời — thẻ tham dự và kết quả đánh giá sẽ được cập nhật theo.'
              : 'Vui lòng trả lời những câu hỏi ngắn để mỗi trường không phải hỏi lại bạn cùng một điều — tiết kiệm thời gian của bạn tại triển lãm.'}
          </p>
          <button style={btn} onClick={() => setShowForm(true)}>
            {stone ? 'Xem / cập nhật câu trả lời' : 'Mở bảng câu hỏi'}
          </button>
        </div>
      </div>
    );
  }

  // ── Questionnaire view (opened on demand, never automatically) ──
  return (
    <div style={wrap}>
      {/* Questionnaire title */}
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#c8102e', margin: '6px 0 10px' }}>
        Giải Mã Chỉ Số Xuất Ngoại
      </h1>

      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 8px' }}>
          Tìm hiểu về bạn{fullName ? `, ${fullName}` : ''}
        </h2>
        <p style={{ color: '#6b7280', margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Vui lòng trả lời những câu hỏi sau để mỗi trường không phải hỏi lại bạn cùng một điều.
          Điều này giúp bạn tiết kiệm thời gian và có trải nghiệm mượt mà hơn tại triển lãm.
        </p>
      </div>

      <div style={card}>
        {fields.map((f) => (
          <div key={f.fieldKey} style={{ marginBottom: 14 }}>
            <label style={label}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={values[f.fieldKey] || ''} onChange={(e) => setVal(f.fieldKey, e.target.value)} style={input}>
                <option value="">Chọn...</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input value={values[f.fieldKey] || ''} onChange={(e) => setVal(f.fieldKey, e.target.value)} style={input} />
            )}
          </div>
        ))}

        {error && <div style={{ color: '#b91c1c', fontSize: 14, marginBottom: 12 }}>{error}</div>}

        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
          {busy ? 'Đang lưu...' : 'Gửi câu trả lời'}
        </button>
        <button
          style={{ width: '100%', padding: '12px', marginTop: 10, borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          disabled={busy}
          onClick={() => setShowForm(false)}
        >
          Quay lại thẻ của tôi
        </button>
      </div>
    </div>
  );
}
