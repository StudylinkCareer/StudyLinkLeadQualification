// client/src/pages/Login.jsx
// New (2026-08): separate Login flow for RETURNING students — phone or
// email + a real OTP. Registration (`Home.jsx`, `/`) is completely
// unchanged and untouched by this file; this page only ever resolves to an
// EXISTING record (via /auth/login-lookup) or sends the user back to
// registration if nothing is found.

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import DuplicateModal from '../components/DuplicateModal';
import { COUNTRY_CODES } from '../utils/formFields';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';
import '../components/DuplicateModal.css';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { language } = useLanguage();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const [channel, setChannel] = useState('email'); // 'email' | 'phone'
  const [email, setEmail] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('+84');
  const [phoneNumber, setPhoneNumber] = useState('0');

  const [channels, setChannels] = useState({ email: true, phone: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(null);

  // Ask the server which OTP channels are actually live before offering
  // phone as an option — an unconfigured SMS gateway shows as "coming soon"
  // instead of a dead button that fails after the user commits to it.
  useEffect(() => {
    authAPI.otpChannels()
      .then((res) => setChannels(res.data || { email: true, phone: false }))
      .catch(() => setChannels({ email: true, phone: false }));
  }, []);

  const identifier = channel === 'email'
    ? email.trim()
    : `${phoneCountryCode} ${phoneNumber}`.trim();

  // OTP TEMPORARILY DISABLED for login (2026-08) — studylink.org isn't
  // verified with Resend yet (DNS pending) and no SMS gateway is chosen, so
  // neither channel can actually deliver a real code right now. Bypassing
  // exactly the way registration already does — the server accepts any
  // code when the call carries no `purpose`, so this establishes the
  // session directly instead of routing through /verify.
  // TO RE-ENABLE once Resend/SMS are live: swap this back to
  //   await authAPI.requestOTP(identifier, { identifier, channel, purpose: 'login' });
  //   navigate('/verify', { state: { identifier, channel, purpose: 'login', mode: 'change', selectedRecordId: studentId } });
  const goVerify = async (studentId) => {
    setError('');
    setLoading(true);
    try {
      const result = await authAPI.verifyOTP(identifier, '000000');
      login(result.email, null, result.isCounselor);
      navigate('/dashboard', {
        state: {
          email: channel === 'email' ? identifier : '',
          phone: channel === 'phone' ? identifier : '',
          mode: 'change',
          selectedRecordId: studentId,
        },
        replace: true,
      });
    } catch (err) {
      setError(err.message || L('Something went wrong. Please try again.', 'Đã có lỗi xảy ra. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    setError('');
    setNotFound(false);
    setDuplicateModal(null);

    if (channel === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(identifier)) {
        setError(L('Please enter a valid email address.', 'Vui lòng nhập địa chỉ email hợp lệ.'));
        return;
      }
    } else if (!phoneNumber.trim() || phoneNumber.trim() === '0') {
      setError(L('Please enter your phone number.', 'Vui lòng nhập số điện thoại.'));
      return;
    }

    setLoading(true);
    try {
      const result = await authAPI.loginLookup(identifier, channel);
      if (result.found === false) {
        setNotFound(true);
      } else if (result.found === 'multiple') {
        setDuplicateModal(result.matches);
      } else if (result.found === true) {
        await goVerify(result.studentId);
        return; // goVerify manages its own loading state
      }
    } catch (err) {
      setError(err.message || L('Something went wrong. Please try again.', 'Đã có lỗi xảy ra. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-page">
      <div className="home-header">
        <LanguageSelector />
      </div>

      <div className="home-card">
        <div className="home-logo-circle">
          <img src="/studylink-logo.png" alt="StudyLink" className="home-logo-img" />
        </div>

        <div className="home-logo">
          <h1>{L('Log in', 'Đăng nhập')}</h1>
          <p className="home-subtitle">
            {L('Already registered with us? Enter your phone or email to pick up where you left off.',
               'Đã đăng ký với chúng tôi? Nhập số điện thoại hoặc email để tiếp tục hồ sơ của bạn.')}
          </p>
        </div>

        <div className="home-form">
          <div className="home-row-radios" style={{ marginBottom: '1rem' }}>
            <label className="home-radio-label">
              <input type="radio" name="channel" checked={channel === 'email'}
                onChange={() => { setChannel('email'); setError(''); setNotFound(false); }} disabled={loading} />
              {L('Email', 'Email')}
            </label>
            <label className="home-radio-label">
              <input type="radio" name="channel" checked={channel === 'phone'}
                onChange={() => { setChannel('phone'); setError(''); setNotFound(false); }}
                disabled={loading || !channels.phone} />
              {L('Phone', 'Điện thoại')}
              {!channels.phone && <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#9ca3af' }}>{L('(coming soon)', '(sắp ra mắt)')}</span>}
            </label>
          </div>

          {channel === 'email' ? (
            <div className="home-row">
              <label className="home-row-label" htmlFor="loginEmail">{L('Email', 'Email')}</label>
              <input id="loginEmail" className="home-row-input" type="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={L('you@example.com', 'ban@example.com')}
                disabled={loading} onKeyDown={(e) => { if (e.key === 'Enter') handleSendCode(); }} />
            </div>
          ) : (
            <div className="home-row">
              <label className="home-row-label">{L('Phone number', 'Số điện thoại')}</label>
              <div className="home-phone-row">
                <select className="home-phone-code" value={phoneCountryCode}
                  onChange={(e) => setPhoneCountryCode(e.target.value)} disabled={loading}>
                  {COUNTRY_CODES.map((c) => (
                    <option key={`${c.code}-${c.country}`} value={c.code}>{c.code}</option>
                  ))}
                </select>
                <input className="home-row-input" type="tel" value={phoneNumber}
                  onChange={(e) => {
                    let digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    if (!digits.startsWith('0')) digits = '0' + digits.slice(0, 9);
                    const formatted = digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits;
                    setPhoneNumber(formatted);
                  }}
                  placeholder="e.g. 098 1234567" disabled={loading}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendCode(); }} />
              </div>
            </div>
          )}

          {notFound && (
            <div className="home-error">
              {L("We couldn't find an account with that ", "Chúng tôi không tìm thấy hồ sơ với ")}
              {L(channel === 'email' ? 'email.' : 'phone number.', channel === 'email' ? 'email này.' : 'số điện thoại này.')}
              {' '}
              <Link to="/">{L('New here? Register', 'Chưa có hồ sơ? Đăng ký')}</Link>
            </div>
          )}

          {error && <div className="home-error">{error}</div>}
          {loading && <div className="home-loading">{L('Please wait…', 'Vui lòng chờ…')}</div>}

          <div className="home-actions">
            <button className="btn btn--primary" onClick={handleSendCode}
              disabled={loading} style={{ width: '100%' }}>
              {L('Continue', 'Tiếp tục')}
            </button>
          </div>

          <div className="home-actions" style={{ marginTop: '0.5rem' }}>
            <Link to="/">{L('New here? Register instead', 'Chưa có hồ sơ? Đăng ký tại đây')}</Link>
          </div>
        </div>
      </div>

      {duplicateModal && (
        <DuplicateModal
          scenario="conflict"
          matches={duplicateModal}
          onSelectRecord={(id) => { setDuplicateModal(null); goVerify(id); }}
          onCancel={() => setDuplicateModal(null)}
        />
      )}
    </div>
  );
}
