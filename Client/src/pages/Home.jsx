// client/src/pages/Home.jsx
// CHANGES:
//   - Replaced schoolEvent field with referralSource (mandatory, captured here and copied to PersonalDetails as read-only)
//   - Event/School field removed from the form

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCamera } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import HeadshotCapture from '../components/Camera/HeadshotCapture';
import DuplicateModal from '../components/DuplicateModal';
import { parseQrContent, isFacebookUrl } from '../utils/qrCodeParser';
import { CONTACT_MEDIUMS, EMAIL_MEDIUMS, VIETNAM_PROVINCES, COUNTRY_CODES, STUDY_PLANS } from '../utils/formFields';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';
import LanguageSelector from '../components/LanguageSelector';
import '../components/DuplicateModal.css';

function Home() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, login, setStudentId, checkSession } = useAuth();
  const { language } = useLanguage();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('+84');
  const [phoneNumber, setPhoneNumber] = useState('0');
  const [yearOfBirth, setYearOfBirth] = useState('');
  const [placeOfResidence, setPlaceOfResidence] = useState('');
  const [studyPlan, setStudyPlan] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [preferredSocial, setPreferredSocial] = useState('Zalo');
  const [connectWithYou, setConnectWithYou] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [showHeadshot, setShowHeadshot] = useState(false);
  const [headshotPreview, setHeadshotPreview] = useState(null);
  const [pendingQrScan, setPendingQrScan] = useState(null);
  const [lockoutUntil, setLockoutUntil] = useState(null);
  const [pendingNav, setPendingNav] = useState(null);
  const [duplicateModal, setDuplicateModal] = useState(null);

  const [campaignType]  = useState(() => new URLSearchParams(window.location.search).get('ct')  || '');
  const [campaignName]  = useState(() => new URLSearchParams(window.location.search).get('en')  || '');
  const [campaignStart] = useState(() => new URLSearchParams(window.location.search).get('sd')  || '');
  const [campaignEnd]   = useState(() => new URLSearchParams(window.location.search).get('ed')  || '');

  // Pre-login lookup lists.
  // - referralSourceOptions: marketing events, filtered server-side to hide
  //   events outside their active window unless an authorised user has
  //   activated them for today. Returned newest-first (sort_order DESC).
  //   Endpoint: /api/marketing-events/public  (no auth required)
  // - provinceOptions: residency dropdown with language-aware labels.
  //   Endpoint: /api/lookups/public/vietnam_province
  const [referralSourceOptions, setReferralSourceOptions] = useState([]);
  const [provinceOptions, setProvinceOptions] = useState([]);

  useEffect(() => {
    // Both fetches are independent and best-effort. Failure falls back to
    // an empty list (will show only the placeholder). Errors are logged but
    // do not block the login form.
    fetch('/api/marketing-events/public')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => setReferralSourceOptions(j.data || []))
      .catch(e => console.warn('marketing-events fetch failed:', e));

    fetch('/api/lookups/public/vietnam_province')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => setProvinceOptions(j.data || []))
      .catch(e => console.warn('vietnam_province fetch failed:', e));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('studylink_lockout');
    if (stored) {
      const until = parseInt(stored, 10);
      if (Date.now() < until) {
        setLockoutUntil(until);
      } else {
        localStorage.removeItem('studylink_lockout');
      }
    }
  }, []);

  useEffect(() => {
    if (pendingNav && isAuthenticated) {
      navigate('/dashboard', { state: pendingNav, replace: true });
      setPendingNav(null);
    }
  }, [pendingNav, isAuthenticated, navigate]);

  const isLockedOut = lockoutUntil && Date.now() < lockoutUntil;

  if (authLoading) {
    return (
      <div className="home-page">
        <div className="home-card"><p>{t('loading', language)}</p></div>
      </div>
    );
  }

  const getExtraFields = () => ({
    yearOfBirth, placeOfResidence, studyPlan, referralSource,
    preferredSocial, connectWithYou,
    campaignType, campaignName, campaignStart, campaignEnd,
  });

  const sendOtpAndNavigate = async (mode, extraState = {}) => {
    setLoadingMessage(t('sendingOtp', language));
    try {
      await authAPI.requestOTP(email);
      const phone = `${phoneCountryCode} ${phoneNumber}`;
      navigate('/verify', { state: { email, phone, fullName, mode, ...getExtraFields(), ...extraState } });
    } catch (err) {
      setError(err.message || t('otpFailed', language));
    }
  };

  const handleLogin = async () => {
    setError('');
    setDuplicateModal(null);

    const errors = {};
    if (!fullName.trim())          errors.fullName = true;
    if (!email.trim())             errors.email = true;
    if (!phoneNumber.trim())       errors.phoneNumber = true;
    if (!yearOfBirth.trim())       errors.yearOfBirth = true;
    if (!referralSource.trim())    errors.referralSource = true;
    if (!placeOfResidence)         errors.placeOfResidence = true;
    if (!studyPlan)                errors.studyPlan = true;
    if (!connectWithYou)           errors.connectWithYou = true;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return setError(t('loginFieldsRequired', language));
    }

    // Year-of-birth range validation: must be an integer between 1980 and 2018.
    // Together with type="number" + min/max + onChange digit-stripping, this
    // catches the cases where the browser still let something invalid through.
    const yobNum = parseInt(yearOfBirth, 10);
    if (isNaN(yobNum) || yobNum < 1980 || yobNum > 2018) {
      setFieldErrors({ yearOfBirth: true });
      return setError(t('invalidYearOfBirth', language) || 'Year of birth must be between 1980 and 2018.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setFieldErrors({ email: true });
      return setError(t('invalidEmail', language));
    }

    setFieldErrors({});
    setLoading(true);
    setLoadingMessage(t('checking', language));
    try {
      const phone = `${phoneCountryCode} ${phoneNumber}`;
      const result = await authAPI.checkLogin(email.trim(), phone.trim(), fullName.trim());
      const { scenario, matches, activeRecord } = result;
      switch (scenario) {
        case 'counselor': await sendOtpAndNavigate('counselor'); break;
        case 'no_match': await sendOtpAndNavigate('create'); break;
        case 'single_active': await sendOtpAndNavigate('change', { selectedRecordId: activeRecord.uniqueId }); break;
        case 'conflict': setDuplicateModal({ scenario: 'conflict', matches }); break;
        default: await sendOtpAndNavigate('create');
      }
    } catch (err) {
      setError(err.message || t('loginCheckFailed', language));
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleSelectRecord = async (selectedId) => {
    const recordsToDeactivate = (duplicateModal?.matches || [])
      .filter((m) => m.status === 'Active' && m.uniqueId !== selectedId)
      .map((m) => m.uniqueId);
    setDuplicateModal(null);
    setLoading(true);
    try {
      await sendOtpAndNavigate('change', { selectedRecordId: selectedId, recordsToDeactivate });
    } finally {
      setLoading(false);
    }
  };

  const navigateWithQr = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await authAPI.qrLogin({ email: email.trim() || undefined });
      await checkSession();
      const safeEmail = (result.email && !result.email.includes('@studylink.temp')) ? result.email : '';
      const phone = `${phoneCountryCode} ${phoneNumber}`;
      setPendingNav({ email: safeEmail, phone, fullName, mode: 'create', ...getExtraFields() });
    } catch (err) {
      setError(err.message || t('qrLoginFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const handleQrScanned = (decodedText, frameImageDataUrl) => {
    const parsed = parseQrContent(decodedText);
    if (frameImageDataUrl) sessionStorage.setItem('studylink_qr_image', frameImageDataUrl);
    if (isFacebookUrl(decodedText)) sessionStorage.setItem('studylink_facebook_profile', decodedText);
    finalizeQrAndNavigate(parsed.medium, parsed.detail, frameImageDataUrl);
  };

  const finalizeQrAndNavigate = (medium, detail) => {
    sessionStorage.setItem('studylink_qr_contact', JSON.stringify({ medium, detail }));
    setPendingQrScan(null);
    navigateWithQr();
  };

  const handlePlatformPick = (medium) => {
    if (!pendingQrScan) return;
    finalizeQrAndNavigate(medium, pendingQrScan.detail);
  };

  const handleDismissQrPicker = () => {
    if (pendingQrScan) {
      sessionStorage.setItem('studylink_qr_contact', JSON.stringify({ medium: null, detail: pendingQrScan.detail }));
    }
    setPendingQrScan(null);
    navigateWithQr();
  };

  const isFbUrl = pendingQrScan && isFacebookUrl(pendingQrScan.detail);
  const pickerMediums = isFbUrl ? CONTACT_MEDIUMS.filter((m) => m !== 'Messenger') : CONTACT_MEDIUMS;

  return (
    <div className="home-page">

      {/* ── Red header banner ── */}
      <div className="home-header">
        <div
          className="home-headshot-circle"
          onClick={() => setShowHeadshot(true)}
          title={t('takePhoto', language)}
        >
          {headshotPreview ? (
            <img src={headshotPreview} alt="Headshot" className="home-headshot-img" />
          ) : (
            <div className="home-headshot-placeholder">
              <FiCamera size={24} />
            </div>
          )}
        </div>

        <LanguageSelector />
      </div>

      {/* ── White card ── */}
      <div className="home-card">

        <div className="home-logo-circle">
          <img src="/studylink-logo.png" alt="StudyLink" className="home-logo-img" />
        </div>

        <div className="home-logo">
          <p className="home-subtitle">{t('appSubtitle', language)}</p>
        </div>

        <div className="home-tagline">
          <span className="home-tagline-text">{t('homePrizeTitle', language)}</span>
        </div>

        <div className="home-form">

          <div className="home-row">
            <label className="home-row-label" htmlFor="fullName">
              {t('fullName', language)}<span className="home-mandatory">*</span>
            </label>
            <input id="fullName" className={`home-row-input${fieldErrors.fullName ? ' home-input--error' : ''}`} type="text"
              value={fullName} onChange={(e) => { setFullName(e.target.value); setFieldErrors((p) => ({ ...p, fullName: false })); }}
              placeholder={t('fullNamePlaceholder', language)} disabled={loading || isLockedOut} />
          </div>

          <div className="home-row">
            <label className="home-row-label" htmlFor="email">
              {t('emailLabel', language)}<span className="home-mandatory">*</span>
            </label>
            <input id="email" className={`home-row-input${fieldErrors.email ? ' home-input--error' : ''}`} type="email"
              value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors((p) => ({ ...p, email: false })); }}
              placeholder={t('emailPlaceholder', language)} disabled={loading || isLockedOut} />
          </div>

          <div className="home-row">
            <label className="home-row-label">
              {t('phoneLabel', language)}<span className="home-mandatory">*</span>
            </label>
            <div className={`home-phone-row${fieldErrors.phoneNumber ? ' home-input--error' : ''}`}>
              <select
                className="home-phone-code"
                value={phoneCountryCode}
                onChange={(e) => setPhoneCountryCode(e.target.value)}
                disabled={loading || isLockedOut}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={`${c.code}-${c.country}`} value={c.code}>{c.code}</option>
                ))}
              </select>
              <input
                className="home-row-input"
                type="tel"
                value={phoneNumber}
                onChange={(e) => {
                  let digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                  if (!digits.startsWith('0')) digits = '0' + digits.slice(0, 9);
                  const formatted = digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits;
                  setPhoneNumber(formatted);
                  setFieldErrors((p) => ({ ...p, phoneNumber: false }));
                }}
                placeholder="e.g. 098 1234567"
                disabled={loading || isLockedOut}
              />
            </div>
          </div>

          <div className="home-row">
            <label className="home-row-label" htmlFor="yearOfBirth">
              {t('yearOfBirth', language)}<span className="home-mandatory">*</span>
            </label>
            <input id="yearOfBirth" className={`home-row-input${fieldErrors.yearOfBirth ? ' home-input--error' : ''}`}
              type="number"
              inputMode="numeric"
              min="1980"
              max="2018"
              step="1"
              value={yearOfBirth}
              onChange={(e) => {
                // Strip anything that isn't a digit so the field can NEVER hold "chưa biết"
                // or other free text. type="number" already enforces this on most browsers
                // but iOS Safari historically lets non-numerics through.
                const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
                setYearOfBirth(cleaned);
                setFieldErrors((p) => ({ ...p, yearOfBirth: false }));
              }}
              placeholder={t('yearOfBirthPlaceholder', language)}
              disabled={loading || isLockedOut} />
          </div>

          <div className="home-row">
            <label className="home-row-label" htmlFor="referralSource">
              {t('referralSource', language)}<span className="home-mandatory">*</span>
            </label>
            <select id="referralSource" className={`home-row-input${fieldErrors.referralSource ? ' home-input--error' : ''}`}
              value={referralSource}
              onChange={(e) => { setReferralSource(e.target.value); setFieldErrors((p) => ({ ...p, referralSource: false })); }}
              disabled={loading || isLockedOut}>
              <option value="">{t('selectDefault', language)}</option>
              {/* Server returns events newest-first (sort_order DESC) and
                  already filtered to hide out-of-window events. */}
              {referralSourceOptions.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {language === 'vi' ? (opt.labelVi || opt.code) : (opt.labelEn || opt.code)}
                </option>
              ))}
            </select>
          </div>

          <div className="home-row">
            <label className="home-row-label" htmlFor="placeOfResidence">
              {t('placeOfResidence', language)}<span className="home-mandatory">*</span>
            </label>
            <select id="placeOfResidence" className={`home-row-input${fieldErrors.placeOfResidence ? ' home-input--error' : ''}`}
              value={placeOfResidence} onChange={(e) => { setPlaceOfResidence(e.target.value); setFieldErrors((p) => ({ ...p, placeOfResidence: false })); }}
              disabled={loading || isLockedOut}>
              <option value="">{t('selectDefault', language)}</option>
              {provinceOptions.length > 0
                // Migrated: language-aware labels, ASCII canonical as the stored value.
                ? provinceOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {language === 'vi' ? (opt.labelVi || opt.code) : (opt.labelEn || opt.code)}
                    </option>
                  ))
                // Fallback while the public lookup is still loading.
                : VIETNAM_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)
              }
            </select>
          </div>

          <div className="home-row">
            <label className="home-row-label" htmlFor="studyPlan">
              {t('studyPlansLabel', language)}<span className="home-mandatory">*</span>
            </label>
            <select id="studyPlan" className={`home-row-input${fieldErrors.studyPlan ? ' home-input--error' : ''}`}
              value={studyPlan} onChange={(e) => { setStudyPlan(e.target.value); setFieldErrors((p) => ({ ...p, studyPlan: false })); }}
              disabled={loading || isLockedOut}>
              <option value="">{t('selectDefault', language)}</option>
              {STUDY_PLANS.map((value, i) => {
                const labels = t('studyPlanOptions', language);
                const label = Array.isArray(labels) ? labels[i] : value;
                return <option key={value} value={value}>{label}</option>;
              })}
            </select>
          </div>

          <div className="home-row">
            <label className="home-row-label" htmlFor="preferredSocial">
              {t('preferredSocial', language)}<span className="home-mandatory">*</span>
            </label>
            <select id="preferredSocial" className="home-row-input"
              value={preferredSocial} onChange={(e) => setPreferredSocial(e.target.value)}
              disabled={loading || isLockedOut}>
              {CONTACT_MEDIUMS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="home-row">
            <label className="home-row-label">
              {t('connectWithYou', language)}<span className="home-mandatory">*</span>
            </label>
            <div className={`home-row-radios${fieldErrors.connectWithYou ? ' home-input--error' : ''}`}>
              <label className="home-radio-label">
                <input type="radio" name="connectWithYou" value="Yes"
                  checked={connectWithYou === 'Yes'} onChange={() => { setConnectWithYou('Yes'); setFieldErrors((p) => ({ ...p, connectWithYou: false })); }}
                  disabled={loading || isLockedOut} />
                {t('yes', language)}
              </label>
              <label className="home-radio-label">
                <input type="radio" name="connectWithYou" value="No"
                  checked={connectWithYou === 'No'} onChange={() => { setConnectWithYou('No'); setFieldErrors((p) => ({ ...p, connectWithYou: false })); }}
                  disabled={loading || isLockedOut} />
                {t('no', language)}
              </label>
            </div>
          </div>

          {pendingQrScan && (
            <div className="qr-platform-picker">
              {isFbUrl && <div className="home-fb-notice">{t('fbNotice', language)}</div>}
              <p>{t('qrScanned', language)}</p>
              <div className="qr-decoded-text">{pendingQrScan.detail}</div>
              <div className="qr-platform-buttons">
                {pickerMediums.map((m) => (
                  <button key={m} type="button" className="qr-platform-btn" onClick={() => handlePlatformPick(m)}>{m}</button>
                ))}
                <button type="button" className="qr-platform-btn" onClick={handleDismissQrPicker}>{t('skip', language)}</button>
              </div>
            </div>
          )}

          {isLockedOut && <div className="home-error">{t('lockedOut', language)}</div>}
          {error && <div className="home-error">{error}</div>}
          {loading && <div className="home-loading">{loadingMessage || t('connecting', language)}</div>}

          <div className="home-actions">
            <button className="btn btn--primary" onClick={handleLogin}
              disabled={loading || isLockedOut} style={{ width: '100%' }}>
              {loading ? loadingMessage : t('loginBtn', language)}
            </button>
          </div>

        </div>
      </div>

      {duplicateModal && (
        <DuplicateModal
          scenario={duplicateModal.scenario}
          matches={duplicateModal.matches}
          onSelectRecord={handleSelectRecord}
          onCancel={() => setDuplicateModal(null)}
        />
      )}

      <HeadshotCapture
        isOpen={showHeadshot}
        onCapture={(dataUrl) => {
          setShowHeadshot(false);
          setHeadshotPreview(dataUrl);
          sessionStorage.setItem('studylink_headshot', dataUrl);
        }}
        onClose={() => setShowHeadshot(false)}
      />
    </div>
  );
}

export default Home;