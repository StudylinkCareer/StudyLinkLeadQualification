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
  // ── Source-of-Lead picker state ──
  const [sourceOfLead, setSourceOfLead]         = useState('');
  const [source, setSource]                     = useState('');
  const [sourceDetail, setSourceDetail]         = useState('');
  const [b2bType, setB2bType]                   = useState('');
  const [sourceUnverified, setSourceUnverified] = useState(false);
  const [eventId, setEventId]                   = useState(null);
  const [counsellor, setCounsellor]             = useState('');
  const [sourceOptions, setSourceOptions]       = useState({ sourceOfLead: [], source: {}, b2bType: [], b2bParty: {} });
  const [counsellorOptions, setCounsellorOptions] = useState([]);
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

    fetch('/api/reference-data/public/source-options')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => setSourceOptions(j.data || { sourceOfLead: [], source: {}, b2bType: [], b2bParty: {} }))
      .catch(e => console.warn('source-options fetch failed:', e));

    fetch('/api/reference-data/public/counsellors')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => setCounsellorOptions(j.data || []))
      .catch(e => console.warn('counsellors fetch failed:', e));

    fetch('/api/lookups/public/vietnam_province')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => setProvinceOptions(j.data || []))
      .catch(e => console.warn('vietnam_province fetch failed:', e));
  }, []);

  // Prefill from event-QR deep-link
  //   ?sol=Event/Campaign&eid=<id>&ename=<name>&counsellor=<name>
  // Matches by event id first (exact), then a diacritic/case-insensitive name.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sol = p.get('sol');
    const eid = p.get('eid');
    const ename = p.get('ename') || p.get('en');
    const qc = p.get('counsellor');
    if (qc) setCounsellor(prev => prev || qc);
    if (sol === 'Event/Campaign' || eid || ename) {
      setSourceOfLead('Event/Campaign');
      if (referralSourceOptions.length) {
        const norm = (x) => (x || '').toString()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
          .trim().toLowerCase();
        let ev = null;
        if (eid) ev = referralSourceOptions.find(o => String(o.id) === String(eid));
        if (!ev && ename) ev = referralSourceOptions.find(o =>
          norm(o.name) === norm(ename) ||
          norm(o.labelEn) === norm(ename) ||
          norm(o.labelVi) === norm(ename));
        if (ev) {
          setEventId(ev.id);
          setSource(ev.name);
          if (ev.dedicatedCounsellor) setCounsellor(prev => prev || ev.dedicatedCounsellor);
        } else if (ename) {
          setSource(ename);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referralSourceOptions]);

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

  const L = (en, vi) => (language === 'vi' ? vi : en);
  const currentMode = (sourceOptions.sourceOfLead.find(s => s.code === sourceOfLead) || {}).mode || '';

  const getExtraFields = () => ({
    yearOfBirth, placeOfResidence, studyPlan,
    preferredSocial, connectWithYou,
    sourceOfLead, source, sourceDetail, sourceUnverified, counsellor, eventId,
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
    if (!sourceOfLead)             errors.sourceOfLead = true;
    else if (!source.trim())       errors.source = true;
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
        case 'single_active': await sendOtpAndNavigate('change', { selectedRecordId: activeRecord.studentId }); break;
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
      .filter((m) => m.status === 'Active' && m.studentId !== selectedId)
      .map((m) => m.studentId);
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
            <label className="home-row-label" htmlFor="sourceOfLead">
              {L('Source of Lead', 'Nguồn khách hàng')}<span className="home-mandatory">*</span>
            </label>
            <select id="sourceOfLead" className={`home-row-input${fieldErrors.sourceOfLead ? ' home-input--error' : ''}`}
              value={sourceOfLead}
              onChange={(e) => {
                setSourceOfLead(e.target.value);
                setSource(''); setSourceDetail(''); setB2bType('');
                setSourceUnverified(false); setEventId(null);
                setFieldErrors((p) => ({ ...p, sourceOfLead: false, source: false }));
              }}
              disabled={loading || isLockedOut}>
              <option value="">{t('selectDefault', language)}</option>
              {sourceOptions.sourceOfLead.map((o) => (
                <option key={o.code} value={o.code}>
                  {language === 'vi' ? (o.labelVi || o.code) : (o.labelEn || o.code)}
                </option>
              ))}
            </select>
          </div>

          {/* Databases / On-line */}
          {currentMode === 'list' && (
            <div className="home-row">
              <label className="home-row-label" htmlFor="sourceList">
                {L('Source', 'Nguồn')}<span className="home-mandatory">*</span>
              </label>
              <select id="sourceList" className={`home-row-input${fieldErrors.source ? ' home-input--error' : ''}`}
                value={source}
                onChange={(e) => { setSource(e.target.value); setFieldErrors((p) => ({ ...p, source: false })); }}
                disabled={loading || isLockedOut}>
                <option value="">{t('selectDefault', language)}</option>
                {(sourceOptions.source[sourceOfLead] || []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {language === 'vi' ? (o.labelVi || o.code) : (o.labelEn || o.code)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Event / Campaign */}
          {currentMode === 'events' && (
            <div className="home-row">
              <label className="home-row-label" htmlFor="sourceEvent">
                {L('Event', 'Sự kiện')}<span className="home-mandatory">*</span>
              </label>
              <select id="sourceEvent" className={`home-row-input${fieldErrors.source ? ' home-input--error' : ''}`}
                value={eventId || ''}
                onChange={(e) => {
                  const ev = referralSourceOptions.find((o) => String(o.id) === e.target.value);
                  setEventId(ev ? ev.id : null);
                  setSource(ev ? ev.name : '');
                  if (ev && ev.dedicatedCounsellor && !counsellor.trim()) setCounsellor(ev.dedicatedCounsellor);
                  setFieldErrors((p) => ({ ...p, source: false }));
                }}
                disabled={loading || isLockedOut}>
                <option value="">{t('selectDefault', language)}</option>
                {referralSourceOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {(language === 'vi' ? opt.labelVi : opt.labelEn) || opt.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Personal referrals: source + free-text name */}
          {currentMode === 'list_freetext' && (
            <>
              <div className="home-row">
                <label className="home-row-label" htmlFor="sourcePersonal">
                  {L('Source', 'Nguồn')}<span className="home-mandatory">*</span>
                </label>
                <select id="sourcePersonal" className={`home-row-input${fieldErrors.source ? ' home-input--error' : ''}`}
                  value={source}
                  onChange={(e) => { setSource(e.target.value); setFieldErrors((p) => ({ ...p, source: false })); }}
                  disabled={loading || isLockedOut}>
                  <option value="">{t('selectDefault', language)}</option>
                  {(sourceOptions.source[sourceOfLead] || []).map((o) => (
                    <option key={o.code} value={o.code}>
                      {language === 'vi' ? (o.labelVi || o.code) : (o.labelEn || o.code)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="home-row">
                <label className="home-row-label" htmlFor="referrerName">
                  {L("Referrer's name", 'Tên người giới thiệu')}
                </label>
                <input id="referrerName" className="home-row-input"
                  value={sourceDetail} maxLength={40}
                  onChange={(e) => setSourceDetail(e.target.value)}
                  placeholder={L('Optional', 'Không bắt buộc')}
                  disabled={loading || isLockedOut} />
              </div>
            </>
          )}

          {/* B2B referrals: type + party (free-text fallback) */}
          {currentMode === 'b2b' && (
            <>
              <div className="home-row">
                <label className="home-row-label" htmlFor="b2bType">
                  {L('Referral type', 'Loại đối tác')}<span className="home-mandatory">*</span>
                </label>
                <select id="b2bType" className={`home-row-input${fieldErrors.source ? ' home-input--error' : ''}`}
                  value={b2bType}
                  onChange={(e) => {
                    setB2bType(e.target.value); setSource(e.target.value);
                    setSourceDetail(''); setSourceUnverified(false);
                    setFieldErrors((p) => ({ ...p, source: false }));
                  }}
                  disabled={loading || isLockedOut}>
                  <option value="">{t('selectDefault', language)}</option>
                  {sourceOptions.b2bType.map((o) => (
                    <option key={o.code} value={o.code}>
                      {language === 'vi' ? (o.labelVi || o.code) : (o.labelEn || o.code)}
                    </option>
                  ))}
                </select>
              </div>
              {b2bType && (
                <div className="home-row">
                  <label className="home-row-label" htmlFor="b2bParty">
                    {L('Partner / organisation', 'Đối tác / tổ chức')}
                  </label>
                  <input id="b2bParty" className="home-row-input" list="b2bPartyList"
                    value={sourceDetail}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSourceDetail(v);
                      const known = (sourceOptions.b2bParty[b2bType] || []).some((x) => x.code === v);
                      setSourceUnverified(v.trim() !== '' && !known);
                    }}
                    placeholder={L('Select or type a name', 'Chọn hoặc nhập tên')}
                    disabled={loading || isLockedOut} />
                  <datalist id="b2bPartyList">
                    {(sourceOptions.b2bParty[b2bType] || []).map((o) => (
                      <option key={o.code} value={o.code} />
                    ))}
                  </datalist>
                  {sourceUnverified && (
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#b45309', marginTop: '0.25rem' }}>
                      {L('Not in our list \u2014 we will verify this.', 'Không có trong danh sách \u2014 chúng tôi sẽ xác minh.')}
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {/* Counsellor (prefilled from event/QR, editable) */}
          <div className="home-row">
            <label className="home-row-label" htmlFor="counsellor">
              {L('Counsellor', 'Tư vấn viên')}
            </label>
            <select id="counsellor" className="home-row-input"
              value={counsellor}
              onChange={(e) => setCounsellor(e.target.value)}
              disabled={loading || isLockedOut}>
              <option value="">{L('Optional', 'Không bắt buộc')}</option>
              {[...new Set([...counsellorOptions, counsellor].filter(Boolean))].map((c) => (
                <option key={c} value={c}>{c}</option>
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