// client/src/pages/Dashboard.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiUser, FiBook, FiBarChart2, FiUsers, FiClipboard, FiSave, FiX, FiArrowLeft, FiFileText, FiTarget, FiLogOut } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import { studentAPI } from '../services/api';
import { useFormState } from '../hooks/useFormState';
import { checkMandatoryFields, checkFamilyMandatoryFields, checkSelfAssessmentPrereqs } from '../utils/validation';
import AppLayout from '../components/Layout/AppLayout';
import PhotoDisplay from '../components/Photos/PhotoDisplay';
import HeadshotCapture from '../components/Camera/HeadshotCapture';
import QrScanner from '../components/Camera/QrScanner';
import PersonalDetailsTab from '../components/Tabs/PersonalDetailsTab';
import StudentInfoTab from '../components/Tabs/StudentInfoTab';
import SelfAssessmentTab from '../components/Tabs/SelfAssessmentTab';
import CareerFitTab from '../components/Tabs/CareerFitTab';
import FamilyContactsTab from '../components/Tabs/FamilyContactsTab';
import CounselorFeedbackTab from '../components/Tabs/CounselorFeedbackTab';
import DocumentsTab from '../components/Tabs/DocumentsTab';
import StudentSearch from '../components/Search/StudentSearch';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';
import LanguageSelector from '../components/LanguageSelector';

const TAB_LABELS = {
  personal:  { label: 'tabPersonal',   short: 'tabPersonalShort' },
  study:     { label: 'tabStudy',      short: 'tabStudyShort' },
  assessment:{ label: 'tabAssessment', short: 'tabAssessmentShort' },
  career:    { label: 'tabCareer',     short: 'tabCareerShort' },
  family:    { label: 'tabFamily',     short: 'tabFamilyShort' },
  counselor: { label: 'tabCounselor',  short: 'tabCounselorShort' },
  documents: { label: 'tabDocuments',  short: 'tabDocumentsShort' },
};

const TAB_ICONS = {
  personal: <FiUser />,
  study: <FiBook />,
  assessment: <FiBarChart2 />,
  career: <FiTarget />,
  family: <FiUsers />,
  counselor: <FiClipboard />,
  documents: <FiFileText />,
};

const TAB_KEYS = [
  { key: 'personal' },
  { key: 'study' },
  { key: 'assessment' },
  { key: 'career' },
//  { key: 'family' },
  { key: 'counselor', counselorOnly: true },
  { key: 'documents', counselorOnly: true },
];

export default function Dashboard() {
  const { email, uniqueId, setStudentId, isCounselor } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState('personal');
  const [studentData, setStudentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);
  const [validationTriggered, setValidationTriggered] = useState(false);

  const [pendingHeadshot, setPendingHeadshot] = useState(null);
  const [pendingQrImage, setPendingQrImage] = useState(null);
  const [additionalQrImages, setAdditionalQrImages] = useState([]);
  const [showHeadshot, setShowHeadshot] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);

  const locationPhone = location.state?.phone;
  const locationEmail = location.state?.email;
  const locationMode = location.state?.mode;
  const locationFullName = location.state?.fullName;
  const locationPreferredSocial = location.state?.preferredSocial;
  const locationStudyPlan = location.state?.studyPlan;
  const locationYearOfBirth = location.state?.yearOfBirth;
  const locationSchoolEvent = location.state?.schoolEvent;
  const locationPlaceOfResidence = location.state?.placeOfResidence;
  const locationConnectWithYou = location.state?.connectWithYou;
  const locationSelectedRecordId = location.state?.selectedRecordId;
  const locationRecordsToDeactivate = location.state?.recordsToDeactivate;

  const [phone] = useState(() => {
    if (locationPhone) { sessionStorage.setItem('studylink_phone', locationPhone); return locationPhone; }
    return sessionStorage.getItem('studylink_phone') || '';
  });
  const [loginEmail] = useState(() => {
    const isTempEmail = (e) => e && e.includes('@studylink.temp');
    if (locationEmail && !isTempEmail(locationEmail)) { sessionStorage.setItem('studylink_email', locationEmail); return locationEmail; }
    const stored = sessionStorage.getItem('studylink_email') || '';
    return isTempEmail(stored) ? '' : stored;
  });
  const [mode] = useState(() => {
    if (locationMode) { sessionStorage.setItem('studylink_mode', locationMode); return locationMode; }
    return sessionStorage.getItem('studylink_mode') || 'change';
  });
  const [loginFullName] = useState(() => {
    if (locationFullName) { sessionStorage.setItem('studylink_fullName', locationFullName); return locationFullName; }
    return sessionStorage.getItem('studylink_fullName') || '';
  });
  const [loginPreferredSocial] = useState(() => {
    if (locationPreferredSocial) { sessionStorage.setItem('studylink_preferredSocial', locationPreferredSocial); return locationPreferredSocial; }
    return sessionStorage.getItem('studylink_preferredSocial') || '';
  });
  const [loginStudyPlan] = useState(() => {
    if (locationStudyPlan) { sessionStorage.setItem('studylink_studyPlan', locationStudyPlan); return locationStudyPlan; }
    return sessionStorage.getItem('studylink_studyPlan') || '';
  });
  const [loginYearOfBirth] = useState(() => {
    if (locationYearOfBirth) { sessionStorage.setItem('studylink_yearOfBirth', locationYearOfBirth); return locationYearOfBirth; }
    return sessionStorage.getItem('studylink_yearOfBirth') || '';
  });
  const [loginSchoolEvent] = useState(() => {
    if (locationSchoolEvent) { sessionStorage.setItem('studylink_schoolEvent', locationSchoolEvent); return locationSchoolEvent; }
    return sessionStorage.getItem('studylink_schoolEvent') || '';
  });
  const [loginPlaceOfResidence] = useState(() => {
    if (locationPlaceOfResidence) { sessionStorage.setItem('studylink_placeOfResidence', locationPlaceOfResidence); return locationPlaceOfResidence; }
    return sessionStorage.getItem('studylink_placeOfResidence') || '';
  });
  const [loginConnectWithYou] = useState(() => {
    if (locationConnectWithYou) { sessionStorage.setItem('studylink_connectWithYou', locationConnectWithYou); return locationConnectWithYou; }
    return sessionStorage.getItem('studylink_connectWithYou') || '';
  });
  const [selectedRecordId] = useState(() => {
    if (locationSelectedRecordId) { sessionStorage.setItem('studylink_selectedRecordId', locationSelectedRecordId); return locationSelectedRecordId; }
    return sessionStorage.getItem('studylink_selectedRecordId') || null;
  });

  const { formData, updateField, saving, lastSaved, dirty, saveAll, discard } = useFormState(
    studentData?.uniqueId,
    studentData || {}
  );

  const [counselorSearchMode, setCounselorSearchMode] = useState(
    (isCounselor || mode === 'counselor') && !uniqueId
  );

  const tabs = TAB_KEYS
    .filter((t) => !t.counselorOnly || isCounselor)
    .map((tab) => ({
      key: tab.key,
      label: t(TAB_LABELS[tab.key].label, language),
      shortLabel: t(TAB_LABELS[tab.key].short, language),
      icon: TAB_ICONS[tab.key],
      counselorOnly: tab.counselorOnly,
    }));

  useEffect(() => {
    if (counselorSearchMode) { setLoading(false); return; }
    loadStudent();
  }, [email, uniqueId, counselorSearchMode]);

  const deactivationDone = useRef(false);
  useEffect(() => {
    if (!deactivationDone.current && locationRecordsToDeactivate && locationRecordsToDeactivate.length > 0) {
      deactivationDone.current = true;
      studentAPI.deactivateRecords(locationRecordsToDeactivate)
        .then(() => { sessionStorage.removeItem('studylink_recordsToDeactivate'); })
        .catch((err) => { console.error('[DASHBOARD] Failed to deactivate records:', err.message); });
    }
  }, [locationRecordsToDeactivate]);

  useEffect(() => {
    if (!studentData?.uniqueId) return;

    const qrContactRaw = sessionStorage.getItem('studylink_qr_contact');
    if (qrContactRaw) {
      try {
        const { medium, detail } = JSON.parse(qrContactRaw);
        if (medium && detail) {
          for (let i = 1; i <= 2; i++) {
            if (!formData[`contactMedium${i}`]) {
              updateField(`contactMedium${i}`, medium);
              updateField(`contactDetail${i}`, detail);
              break;
            }
          }
        }
      } catch { /* ignore */ }
      sessionStorage.removeItem('studylink_qr_contact');
    }

    const isTempEmail = (e) => e && e.includes('@studylink.temp');
    if (!studentData.email && loginEmail && !isTempEmail(loginEmail)) updateField('email', loginEmail);
    if (!studentData.phone && phone) {
      const spaceIdx = phone.indexOf(' ');
      if (spaceIdx > 0) {
        updateField('phoneCountryCode', phone.slice(0, spaceIdx));
        updateField('phone', phone.slice(spaceIdx + 1));
      } else {
        updateField('phone', phone);
      }
    }
    if (isTempEmail(formData.email)) updateField('email', '');
    if (!studentData.fullName && loginFullName) { updateField('fullName', loginFullName); sessionStorage.removeItem('studylink_fullName'); }
    if (!studentData.contactMedium1 && loginPreferredSocial) { updateField('contactMedium1', loginPreferredSocial); sessionStorage.removeItem('studylink_preferredSocial'); }
    if (!studentData.studyPlans && loginStudyPlan) { updateField('studyPlans', loginStudyPlan); sessionStorage.removeItem('studylink_studyPlan'); }
    if (!studentData.yearOfBirth && loginYearOfBirth) { updateField('yearOfBirth', loginYearOfBirth); sessionStorage.removeItem('studylink_yearOfBirth'); }
    if (!studentData.schoolEvent && loginSchoolEvent) { updateField('schoolEvent', loginSchoolEvent); sessionStorage.removeItem('studylink_schoolEvent'); }
    if (!studentData.residency && loginPlaceOfResidence) { updateField('residency', loginPlaceOfResidence); sessionStorage.removeItem('studylink_placeOfResidence'); }
    if (!studentData.socialConsent && loginConnectWithYou) { 
       updateField('socialConsent', loginConnectWithYou);
       sessionStorage.removeItem('studylink_connectWithYou'); 
      }

    const headshot = sessionStorage.getItem('studylink_headshot');
    if (headshot) { setPendingHeadshot(headshot); sessionStorage.removeItem('studylink_headshot'); }
    const qrImage = sessionStorage.getItem('studylink_qr_image');
    if (qrImage) { setPendingQrImage(qrImage); sessionStorage.removeItem('studylink_qr_image'); }
  }, [studentData?.uniqueId]);

  const cleanTempData = (data) => {
    if (data && data.email && data.email.includes('@studylink.temp')) return { ...data, email: '' };
    return data;
  };

  const loadStudent = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      if (selectedRecordId) {
        const res = await studentAPI.getById(selectedRecordId);
        setStudentData(cleanTempData(res.data));
        setStudentId(res.data.uniqueId);
        sessionStorage.removeItem('studylink_selectedRecordId');
        return;
      }
      if (uniqueId) {
        const res = await studentAPI.getById(uniqueId);
        setStudentData(cleanTempData(res.data));
        return;
      }
      if (email && !email.includes('@studylink.temp')) {
        try {
          const res = await studentAPI.getByEmail(email);
          setStudentData(cleanTempData(res.data));
          setStudentId(res.data.uniqueId);
          return;
        } catch (err) {
          if (err.status !== 404) throw err;
        }
      }
      if (isCounselor) { setCounselorSearchMode(true); return; }
      if (mode === 'create' || !uniqueId) {
        try {
          const safeEmail = (email && !email.includes('@studylink.temp')) ? email : '';
          const spaceIdx = (phone || '').indexOf(' ');
          const phoneCode = spaceIdx > 0 ? phone.slice(0, spaceIdx) : '+84';
          const phoneNum  = spaceIdx > 0 ? phone.slice(spaceIdx + 1) : (phone || '');
          const res = await studentAPI.register({
            email:            safeEmail,
            phone:            phoneNum,
            phoneCountryCode: phoneCode,
            fullName:         loginFullName        || '',
            yearOfBirth:      loginYearOfBirth     || '',
            residency:        loginPlaceOfResidence|| '',
            schoolEvent:      loginSchoolEvent     || '',
            socialConsent:    loginConnectWithYou  || '',
            preferredSocial:  loginPreferredSocial || '',
            contactMedium1:   loginPreferredSocial || '',
            studyPlans:       loginStudyPlan       || '',
          });
          setStudentData(cleanTempData(res.data));
          setStudentId(res.data.uniqueId);
        } catch (regErr) {
          if (regErr.status === 409 && regErr.data?.existing) {
            setStudentData(cleanTempData(regErr.data.existing));
            setStudentId(regErr.data.existing.uniqueId);
          } else {
            throw regErr;
          }
        }
      }
    } catch (err) {
      setError(err.message || t('loadFailed', language));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveError('');
    try {
      if (pendingHeadshot || pendingQrImage || additionalQrImages.length > 0) {
        const photos = {};
        if (pendingHeadshot) photos.headshot = pendingHeadshot;
        if (pendingQrImage) photos.qrCodeImage = pendingQrImage;
        if (additionalQrImages.length > 0) photos.additionalQrImages = additionalQrImages;
        const uploadRes = await studentAPI.uploadPhotos(studentData.uniqueId, photos);
        if (uploadRes.data) {
          if (uploadRes.data.headshotUrl) updateField('headshotUrl', uploadRes.data.headshotUrl);
          if (uploadRes.data.qrCodeImageUrl) updateField('qrCodeImageUrl', uploadRes.data.qrCodeImageUrl);
        }
        setPendingHeadshot(null);
        setPendingQrImage(null);
        setAdditionalQrImages([]);
      }
      await saveAll();
    } catch (err) {
      setSaveError(err.message || t('saveFailed', language));
    } finally {
      savingRef.current = false;
    }
  }, [pendingHeadshot, pendingQrImage, additionalQrImages, studentData, saveAll, updateField, language]);

  const handleTabChange = useCallback(async (newTab) => {
    const hasUnsaved = dirty || !!pendingHeadshot || !!pendingQrImage || additionalQrImages.length > 0;
    if (hasUnsaved && !savingRef.current) await handleSave();
    setActiveTab(newTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [dirty, pendingHeadshot, pendingQrImage, additionalQrImages, handleSave]);

  const handleClose = useCallback(async () => {
    const hasUnsaved = dirty || !!pendingHeadshot || !!pendingQrImage || additionalQrImages.length > 0;
    if (hasUnsaved && !savingRef.current) await handleSave();
    navigate('/');
  }, [dirty, pendingHeadshot, pendingQrImage, additionalQrImages, handleSave, navigate]);

  const handleSelectStudent = async (selectedId) => {
    setCounselorSearchMode(false);
    setStudentId(selectedId);
    loadingRef.current = false;
    setLoading(true);
    try {
      const res = await studentAPI.getById(selectedId);
      setStudentData(cleanTempData(res.data));
    } catch (err) {
      setError(err.message || t('loadFailed', language));
    } finally {
      setLoading(false);
    }
  };

  const handleBackToSearch = () => {
    setStudentData(null);
    setCounselorSearchMode(true);
    setActiveTab('personal');
  };

  const handleCancel = () => { discard(); navigate('/'); };

  const { complete: mandatoryComplete, missing: mandatoryMissing, errorFields: personalErrors } = checkMandatoryFields(formData);
  const { complete: familyComplete, missing: familyMissing, errorFields: familyErrors } = checkFamilyMandatoryFields(formData);
  const hasChanges = dirty || !!pendingHeadshot || !!pendingQrImage || additionalQrImages.length > 0;

  const displayErrors = validationTriggered ? personalErrors : {};
  const displayFamilyErrors = validationTriggered ? familyErrors : {};

  const prereqs = checkSelfAssessmentPrereqs(formData, pendingHeadshot, pendingQrImage);
  const disabledTabs = {};
  if (!mandatoryComplete) {
    ['study', 'assessment', 'career', 'family', 'counselor', 'documents'].forEach(tab => {
      disabledTabs[tab] = `Complete required fields: ${mandatoryMissing.join(', ')}`;
    });
  } else if (!familyComplete) {
    ['assessment', 'career', 'counselor', 'documents'].forEach(tab => {
      disabledTabs[tab] = `Complete required fields: ${familyMissing.join(', ')}`;
    });
  }

  const handleNextWithValidation = () => {
    const isValid = activeTab === 'personal'
      ? mandatoryComplete && familyComplete
      : activeTab === 'family'
      ? familyComplete
      : true;

    if (!isValid) {
      setValidationTriggered(true);
    } else {
      setValidationTriggered(false);
      const vTabs = tabs.filter((tab) => !disabledTabs[tab.key]);
      const cIdx = vTabs.findIndex((tab) => tab.key === activeTab);
      const nTab = cIdx < vTabs.length - 1 ? vTabs[cIdx + 1] : null;
      if (nTab) handleTabChange(nTab.key);
    }
  };

  // Validation warning — reused in both header and footer
  const validationWarning = validationTriggered && (
    <div className="mandatory-warning">
      <strong>Required fields missing: </strong>
      {!mandatoryComplete ? mandatoryMissing.join(', ') : familyMissing.join(', ')}
    </div>
  );

  if (counselorSearchMode) {
    return (
      <AppLayout tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} disabledTabs={disabledTabs}>
        <StudentSearch onSelect={handleSelectStudent} />
      </AppLayout>
    );
  }

  if (loading) {
    return (
      <AppLayout tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} disabledTabs={disabledTabs}>
        <div className="loading-state">{t('loadingStudent', language)}</div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} disabledTabs={disabledTabs}>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn btn--primary" onClick={() => { loadingRef.current = false; loadStudent(); }}>{t('retry', language)}</button>
        </div>
      </AppLayout>
    );
  }

  const formProps = {
    formData, updateField, saving, lastSaved, saveAll,
    pendingHeadshot, pendingQrImage,
    personalErrors: displayErrors,
    familyErrors: displayFamilyErrors,
    onNewHeadshot: (dataUrl) => setPendingHeadshot(dataUrl),
    onNewQrImage: (dataUrl) => {
      if (!pendingQrImage && !formData.qrCodeImageUrl) setPendingQrImage(dataUrl);
      else setAdditionalQrImages((prev) => [...prev, dataUrl]);
    },
    onOpenHeadshot: () => setShowHeadshot(true),
    onOpenQrScanner: () => setShowQrScanner(true),
  };

  const visibleTabs = tabs.filter((tab) => !disabledTabs[tab.key]);
  const currentIdx = visibleTabs.findIndex((tab) => tab.key === activeTab);
  const prevTab = currentIdx > 0 ? visibleTabs[currentIdx - 1] : null;

  const allCurrentIdx = tabs.findIndex((tab) => tab.key === activeTab);
  const hasNextTab = allCurrentIdx < tabs.length - 1;

  return (
    <AppLayout tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} disabledTabs={disabledTabs}>

      {/* ---- Toolbar ---- */}
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-left">
          <PhotoDisplay
            formData={formData}
            pendingHeadshot={pendingHeadshot}
            pendingQrImage={pendingQrImage}
            onHeadshotClick={() => setShowHeadshot(true)}
            onQrClick={() => setShowQrScanner(true)}
            compact
          />
        </div>

        <div className="dashboard-toolbar-right">
          <LanguageSelector />
          <div className="dashboard-toolbar-buttons">
            {prevTab && (
              <button className="btn btn--secondary btn--sm" onClick={() => handleTabChange(prevTab.key)} disabled={saving} style={{ fontSize: '1.25rem', padding: '0.25rem 0.625rem', lineHeight: 1 }}>
                ‹
              </button>
            )}
            <button className="btn btn--outline btn--sm" onClick={handleClose} disabled={saving}>
              {t('close', language)}
            </button>
            {isCounselor && (
              <button className="btn btn--secondary btn--sm" onClick={handleBackToSearch} disabled={saving}>
                <FiArrowLeft /> {t('back', language)}
              </button>
            )}
            <button className="btn btn--secondary btn--sm" onClick={handleCancel} disabled={saving}>
              {t('cancel', language)}
            </button>
            {hasNextTab ? (
              <button className="btn btn--primary btn--sm" onClick={handleNextWithValidation} disabled={saving} style={{ fontSize: '1.25rem', padding: '0.25rem 0.625rem', lineHeight: 1 }}>
                ›
              </button>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving || !mandatoryComplete || !hasChanges}>
                <FiSave /> {saving ? t('savingStatus', language) : t('save', language)}
              </button>
            )}
          </div>
          <div className="dashboard-toolbar-status">
            {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
            {!saving && saveError && <span className="unsaved-indicator">{saveError}</span>}
            {!saving && !saveError && mandatoryComplete && hasChanges && <span className="unsaved-indicator">{t('unsavedChanges', language)}</span>}
            {!saving && !saveError && !hasChanges && lastSaved && (
              <span className="save-indicator saved">{t('savedAt', language)} {lastSaved.toLocaleTimeString()}</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- Mandatory fields warning — header ---- */}
      {validationWarning}

      {/* ---- Tab content ---- */}
      {activeTab === 'personal' && <PersonalDetailsTab {...formProps} />}
      {activeTab === 'study' && <StudentInfoTab {...formProps} />}
      {activeTab === 'assessment' && <SelfAssessmentTab {...formProps} />}
      {activeTab === 'career' && <CareerFitTab {...formProps} />}
      {activeTab === 'family' && <FamilyContactsTab {...formProps} />}
      {activeTab === 'counselor' && <CounselorFeedbackTab {...formProps} />}
      {activeTab === 'documents' && <DocumentsTab {...formProps} />}

      {/* ---- Bottom action bar ---- */}
      <div className="tab-nav-buttons">
        <div>
          {prevTab ? (
            <button className="btn btn--secondary btn--sm" onClick={() => handleTabChange(prevTab.key)} disabled={saving} style={{ fontSize: '1.25rem', padding: '0.25rem 0.625rem', lineHeight: 1 }}>
              ‹
            </button>
          ) : <div />}
        </div>

        {/* ---- Mandatory fields warning — footer ---- */}
        {validationWarning}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn--outline btn--sm" onClick={handleClose} disabled={saving}>
            {t('close', language)}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={handleCancel} disabled={saving}>
            {t('cancel', language)}
          </button>
          {hasNextTab ? (
            <button className="btn btn--primary btn--sm" onClick={handleNextWithValidation} disabled={saving} style={{ fontSize: '1.25rem', padding: '0.25rem 0.625rem', lineHeight: 1 }}>
              ›
            </button>
          ) : (
            <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving || !mandatoryComplete || !hasChanges}>
              <FiSave /> {saving ? t('savingStatus', language) : t('save', language)}
            </button>
          )}
        </div>
      </div>

      {/* Camera modals */}
      <HeadshotCapture
        isOpen={showHeadshot}
        onCapture={(dataUrl) => { setShowHeadshot(false); setPendingHeadshot(dataUrl); }}
        onClose={() => setShowHeadshot(false)}
      />
      <QrScanner
        isOpen={showQrScanner}
        onScan={(decodedText, frameImageDataUrl) => {
          setShowQrScanner(false);
          if (frameImageDataUrl) {
            if (!pendingQrImage && !formData.qrCodeImageUrl) setPendingQrImage(frameImageDataUrl);
            else setAdditionalQrImages((prev) => [...prev, frameImageDataUrl]);
          }
        }}
        onClose={() => setShowQrScanner(false)}
      />
    </AppLayout>
  );
}
