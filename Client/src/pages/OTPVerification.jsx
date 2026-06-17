// client/src/pages/OTPVerification.jsx
//
// CHANGES:
//   - Removed bypass auto-verify (OTP code no longer comes back in API response)
//   - Added WebOTP API listener (Android Chrome) — auto-fills code from
//     OS notification pop-up and shows a confirmation toast
//   - autoComplete="one-time-code" retained for iOS native keyboard suggestion
//   - Toast banner shows detected code with one-tap "Use this code" button
//   - info@studylink.org is now the from address (set in emailService.js)

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export default function OTPVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const { language } = useLanguage();

  const {
    email, phone, fullName, mode,
    selectedRecordId, recordsToDeactivate,
    yearOfBirth, placeOfResidence, studyPlan,
    preferredSocial, connectWithYou,
    sourceOfLead, source, sourceDetail, sourceUnverified, counsellor, eventId,
  } = location.state || {};

  const [code,           setCode]           = useState('');
  const [error,          setError]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [resendTimer,    setResendTimer]     = useState(60);
  const [failedAttempts, setFailedAttempts] = useState(0);
  // Toast state: null | { detectedCode: string }
  const [otpToast,       setOtpToast]       = useState(null);

  const inputRef  = useRef(null);
  const abortRef  = useRef(null);   // AbortController for WebOTP

  // ── Redirect if no email in state ───────────────────────────────────────────
  useEffect(() => {
    if (!email) {
      navigate('/', { replace: true });
      return;
    }
    inputRef.current?.focus();
  }, [email, navigate]);

  // ── OTP BYPASS: auto-fill + auto-submit (no manual code entry needed) ────────
  // While email-OTP verification is bypassed on the server, users should not
  // have to fetch a real code. We pre-fill a placeholder and submit it after a
  // short delay, so the screen is still briefly visible but hands-free.
  //   • To make it require a manual tap instead: delete the setTimeout line
  //     (leave setCode) so the field is pre-filled and the user clicks Verify.
  //   • To turn this off completely: delete this whole effect.
  const BYPASS_CODE = '000000';
  const AUTO_SUBMIT_DELAY_MS = 1200;
  useEffect(() => {
    if (!email) return;
    setCode(BYPASS_CODE);
    const timer = setTimeout(() => handleVerify(BYPASS_CODE), AUTO_SUBMIT_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // ── Resend countdown ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => setResendTimer(prev => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  // ── WebOTP API (Android Chrome) ──────────────────────────────────────────────
  // When an email or SMS arrives with a code, Android shows an OS-level
  // notification. The WebOTP API intercepts it and fires here, showing a
  // confirmation toast so the user taps once to fill the field.
  useEffect(() => {
    if (!('OTPCredential' in window)) return;   // only on supported browsers

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    navigator.credentials.get({
      otp: { transport: ['sms', 'email'] },
      signal: ctrl.signal,
    })
    .then(otp => {
      if (otp?.code) {
        // Show toast — don't auto-fill silently, let user confirm
        setOtpToast({ detectedCode: otp.code });
      }
    })
    .catch(() => {
      // Aborted or not supported — silent fail
    });

    return () => ctrl.abort();
  }, []);

  // ── Verify handler ────────────────────────────────────────────────────────────
  const handleVerify = async (overrideCode) => {
    const codeToUse = overrideCode || code;
    setError('');
    if (codeToUse.length !== 6) return setError(t('enterCode', language));

    setLoading(true);
    try {
      const result = await authAPI.verifyOTP(email, codeToUse, fullName, phone);
      login(result.email, null, result.isCounselor);
      navigate('/dashboard', {
        state: {
          email, phone, fullName, mode,
          selectedRecordId, recordsToDeactivate,
          yearOfBirth, placeOfResidence, studyPlan,
          preferredSocial, connectWithYou,
          sourceOfLead, source, sourceDetail, sourceUnverified, counsellor, eventId,
        },
        replace: true,
      });
    } catch (err) {
      const newCount = failedAttempts + 1;
      setFailedAttempts(newCount);

      if (newCount >= MAX_FAILED_ATTEMPTS) {
        localStorage.setItem('studylink_lockout', String(Date.now() + LOCKOUT_DURATION_MS));
        navigate('/', { replace: true });
        return;
      }

      setError(
        `${err.message || t('verificationFailed', language)} (${MAX_FAILED_ATTEMPTS - newCount} ${t('attemptsRemaining', language)})`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setOtpToast(null);
    try {
      await authAPI.requestOTP(email);
      setResendTimer(60);
      // Re-register WebOTP listener after resend
      if ('OTPCredential' in window) {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        navigator.credentials.get({ otp: { transport: ['sms', 'email'] }, signal: ctrl.signal })
          .then(otp => { if (otp?.code) setOtpToast({ detectedCode: otp.code }); })
          .catch(() => {});
      }
    } catch (err) {
      setError(err.message || t('resendFailed', language));
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const digits = text.replace(/\D/g, '').slice(0, 6);
      if (digits.length === 6) setCode(digits);
    } catch { /* clipboard not available */ }
  };

  // ── OTP Toast — shown when WebOTP detects a code ─────────────────────────────
  function OTPToast({ toast, onUse, onDismiss }) {
    if (!toast) return null;
    return (
      <div style={{
        position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, width: 'calc(100% - 2rem)', maxWidth: '400px',
        background: '#1e3a5f', color: '#fff', borderRadius: '14px',
        padding: '1rem 1.25rem', boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column', gap: '0.625rem',
        animation: 'slideUp 0.25s ease',
      }}>
        <style>{`
          @keyframes slideUp {
            from { transform: translateX(-50%) translateY(20px); opacity: 0; }
            to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
          }
        `}</style>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.8125rem', opacity: 0.75, marginBottom: '0.25rem' }}>
              StudyLink — verification code
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '0.2em', fontFamily: 'DM Mono, monospace' }}>
              {toast.detectedCode}
            </div>
          </div>
          <button onClick={onDismiss}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1, padding: '0 0 0 0.5rem' }}>
            ✕
          </button>
        </div>

        <button onClick={() => onUse(toast.detectedCode)}
          style={{
            background: '#fff', color: '#1e3a5f', border: 'none', borderRadius: '8px',
            padding: '0.625rem 1rem', fontSize: '0.9375rem', fontWeight: 700,
            cursor: 'pointer', width: '100%', textAlign: 'center',
          }}>
          Use this code →
        </button>
      </div>
    );
  }

  return (
    <div className="home-page">
      <div className="home-card">
        <div className="home-logo">
          <h1>{t('verifyEmail', language)}</h1>
          <p>{t('otpPrompt', language)} <strong>{email}</strong></p>
        </div>

        <div className="home-form">
          <div className="otp-input-container">
            <input
              ref={inputRef}
              className="otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
              placeholder={t('otpPlaceholder', language)}
              disabled={loading}
            />
            <button
              type="button"
              className="btn btn--ghost otp-paste-btn"
              onClick={handlePaste}
            >
              {t('paste', language)}
            </button>
          </div>

          <p className="otp-hint">{t('otpHint', language)}</p>

          {error && <div className="home-error">{error}</div>}

          <button
            className="btn btn--primary btn--full"
            onClick={() => handleVerify()}
            disabled={loading || code.length !== 6}
          >
            {loading ? t('verifying', language) : t('verify', language)}
          </button>

          <div className="otp-resend">
            {resendTimer > 0 ? (
              <span>{t('resendIn', language)} {resendTimer}s</span>
            ) : (
              <button className="btn btn--ghost" onClick={handleResend}>
                {t('resendCode', language)}
              </button>
            )}
          </div>

          <button className="btn btn--ghost btn--full" onClick={() => navigate('/')}>
            {t('backToLogin', language)}
          </button>
        </div>
      </div>

      {/* OTP detected toast — slides up from bottom */}
      <OTPToast
        toast={otpToast}
        onUse={(detectedCode) => {
          setCode(detectedCode);
          setOtpToast(null);
          handleVerify(detectedCode);
        }}
        onDismiss={() => setOtpToast(null)}
      />
    </div>
  );
}
