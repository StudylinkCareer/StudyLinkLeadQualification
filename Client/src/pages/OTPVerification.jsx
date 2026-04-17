// client/src/pages/OTPVerification.jsx
// CHANGES: Passes selectedRecordId, recordsToDeactivate, and fullName through to Dashboard

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

  // Pull all state from navigation (Home.jsx passes these)
  const {
    email,
    phone,
    fullName,
    mode,
    selectedRecordId,
    recordsToDeactivate,
    yearOfBirth,
    placeOfResidence,
    studyPlan,
    referralSource,
    preferredSocial,
    connectWithYou,
    campaignType,
    campaignName,
    campaignStart,
    campaignEnd,
  } = location.state || {};

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!email) {
      navigate('/', { replace: true });
      return;
    }
    inputRef.current?.focus();
  }, [email, navigate]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleVerify = async () => {
    setError('');
    if (code.length !== 6) return setError(t('enterCode', language));

    setLoading(true);
    try {
      const result = await authAPI.verifyOTP(email, code, fullName, phone);
      login(result.email, null, result.isCounselor);

      navigate('/dashboard', {
        state: {
          email, phone, fullName, mode,
          selectedRecordId, recordsToDeactivate,
          yearOfBirth, placeOfResidence, studyPlan,
          referralSource, preferredSocial, connectWithYou,
          campaignType, campaignName, campaignStart, campaignEnd,
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
    try {
      await authAPI.requestOTP(email);
      setResendTimer(60);
    } catch (err) {
      setError(err.message || t('resendFailed', language));
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleVerify();
  };

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
              onKeyDown={handleKeyDown}
              placeholder={t('otpPlaceholder', language)}
              disabled={loading}
            />
            <button
              type="button"
              className="btn btn--ghost otp-paste-btn"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  const digits = text.replace(/\D/g, '').slice(0, 6);
                  if (digits.length === 6) setCode(digits);
                } catch { /* clipboard not available */ }
              }}
            >
              {t('paste', language)}
            </button>
          </div>

          <p className="otp-hint">{t('otpHint', language)}</p>

          {error && <div className="home-error">{error}</div>}

          <button
            className="btn btn--primary btn--full"
            onClick={handleVerify}
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
    </div>
  );
}
