// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Client/src/pages/ProfilePage.jsx
// ---------------------------------------------------------------------
// PUBLIC "Know you better" page. Reached from the badge email (and, later,
// the Zalo badge message) at /profile?t=<attendance_token>. Shows the
// student's registration badge (QR) at the top so a single link serves as
// both their check-in badge and their profile form. The student answers the
// qualification questions (dropdowns from the lookup lists); submitting
// writes the answers back to their lead. No login - the token is the
// credential. The QR encodes ONLY the bare token, exactly like BadgePage,
// so it scans identically at the desk.
// ---------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { profileAPI } from '../services/api';
import { renderBadgePng, dataUrlToBase64 } from '../utils/badgeRenderer';
import quartzImg   from '../Assets/Stones/quartz.png';
import agateImg    from '../Assets/Stones/agate.png';
import sapphireImg from '../Assets/Stones/sapphire.png';
import rubyImg     from '../Assets/Stones/ruby.png';
import diamondImg  from '../Assets/Stones/diamond.png';

// Local stone art keyed by the canonical tier returned in the evaluation.
const STONE_IMAGES = { Quartz: quartzImg, Agate: agateImg, Sapphire: sapphireImg, Ruby: rubyImg, Diamond: diamondImg };

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
  const [evaluation, setEvaluation] = useState(null);  // { tier, label, message, imageUrl } after submit

  // Render the badge QR. Once the student has a stone, it sits in the centre
  // of the QR in place of the StudyLink logo (error correction level H keeps
  // the code scannable).
  const renderBadge = (name, stoneTier) =>
    renderBadgePng({
      data: token,
      title: name,
      ...(stoneTier && STONE_IMAGES[stoneTier] ? { logoUrl: STONE_IMAGES[stoneTier] } : {}),
    });

  useEffect(() => {
    if (!token) { setError('Liên kết này thiếu mã. Vui lòng dùng liên kết trong tin nhắn đăng ký của bạn.'); setLoading(false); return; }
    (async () => {
      try {
        const res = await profileAPI.get(token);
        const d = res.data || {};
        const name = d.fullName || '';
        setFullName(name);
        const fs = d.fields || [];
        setFields(fs);
        const init = {};
        fs.forEach((f) => { init[f.fieldKey] = f.value || ''; });
        setValues(init);

        // The badge is a bonus on top of the form - never let a render hiccup
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

      // Render the UPDATED badge (stone now in the centre) and post it back —
      // the server attaches it to the follow-up e-mail/Zalo. Best-effort with
      // one retry; the answers are already saved either way.
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

  // Badge block - shown once rendered, on both the form view and the
  // post-submit "thank you" view so the student always keeps their QR.
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

  if (loading) {
    return <div style={wrap}><div style={card}>Đang tải...</div></div>;
  }

  if (done) {
    const stoneImg = evaluation && (STONE_IMAGES[evaluation.tier] || evaluation.imageUrl || '');
    return (
      <div style={wrap}>
        {/* Stone reveal — the evaluation of the questionnaire. Also sent to the
            student via e-mail/Zalo; this is their instant on-screen copy. */}
        {evaluation && (
          <div style={{ ...card, textAlign: 'center', padding: 28, background: 'linear-gradient(180deg,#fff 0%,#fdf4f5 100%)', border: '1px solid #f3d6da' }}>
            {stoneImg && (
              <img src={stoneImg} alt={evaluation.label || evaluation.tier} style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 10 }} />
            )}
            <div style={{ fontSize: 20, fontWeight: 800, color: '#c8102e', marginBottom: 8 }}>
              Chúc mừng Bạn! {evaluation.label ? `— ${evaluation.label}` : ''}
            </div>
            <div style={{ color: '#374151', fontSize: 14, lineHeight: 1.6, textAlign: 'left' }}>
              {evaluation.message}
            </div>
          </div>
        )}
        {badgeBlock}
        <div style={{ ...card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: '#15803d' }}>Cảm ơn bạn!</div>
          <div style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.5 }}>
            Câu trả lời của bạn đã được lưu.{evaluation ? ' Kết quả đánh giá cũng đã được gửi tới bạn qua e-mail/Zalo.' : ''} Các
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

  return (
    <div style={wrap}>
      {badgeBlock}

      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 8px' }}>
          Tìm hiểu về bạn{fullName ? `, ${fullName}` : ''}
        </h1>
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
      </div>
    </div>
  );
}
