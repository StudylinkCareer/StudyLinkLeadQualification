// client/src/components/Tabs/PersonalDetailsTab.jsx
import { useState } from 'react';
import { FiMaximize } from 'react-icons/fi';
import TextInput from '../Form/TextInput';
import SelectInput from '../Form/SelectInput';
import PhoneInput from '../Form/PhoneInput';
import QrScanner from '../Camera/QrScanner';
import { parseQrContent, isFacebookUrl } from '../../utils/qrCodeParser';
import { CONTACT_MEDIUMS, PHONE_MEDIUMS, EMAIL_MEDIUMS, DUAL_MEDIUMS } from '../../utils/formFields';
import { getTranslatedOptions } from '../../utils/formFields';
import { useLanguage } from '../../contexts/LanguageContext';
import { useLookup } from '../../contexts/LookupContext';
import { t } from '../../i18n';

const MAX_CONTACTS = 2;

export default function PersonalDetailsTab({
  formData,
  updateField,
  saving,
  lastSaved,
  saveAll,
  pendingHeadshot,
  pendingQrImage,
  personalErrors = {},
  onNewHeadshot,
  onNewQrImage,
  onOpenHeadshot,
  onOpenQrScanner,
}) {
  const { language } = useLanguage();
  const studyPlanLookups = useLookup('study_plan');
  const [scanningForSlot, setScanningForSlot] = useState(null);
  const [scanningFamily, setScanningFamily] = useState(false);
  const [selectedParent, setSelectedParent] = useState('mother');

  const [dualMode, setDualMode] = useState({});
  const getDualMode = (slot) => dualMode[slot] || 'email';
  const setSlotDualMode = (slot, mode) => setDualMode((prev) => ({ ...prev, [slot]: mode }));

  const [familyDualMode, setFamilyDualMode] = useState({});
  const getFamilyDualMode = (pfx) => familyDualMode[pfx] || 'email';
  const setFamilyContactDualMode = (pfx, mode) => setFamilyDualMode((prev) => ({ ...prev, [pfx]: mode }));

  // ── Contact slots ──
  const activeContacts = [];
  for (let i = 1; i <= MAX_CONTACTS; i++) {
    if (formData[`contactMedium${i}`]) activeContacts.push(i);
  }

  const nextSlot = (() => {
    for (let i = 1; i <= MAX_CONTACTS; i++) {
      if (!formData[`contactMedium${i}`]) return i;
    }
    return null;
  })();

  const usedMediums = new Set();
  for (let i = 1; i <= MAX_CONTACTS; i++) {
    if (formData[`contactMedium${i}`]) usedMediums.add(formData[`contactMedium${i}`]);
  }

  const handleRemoveContact = (slot) => {
    updateField(`contactMedium${slot}`, '');
    updateField(`contactDetail${slot}`, '');
    updateField(`phoneCountryCode${slot}`, '');
  };

  const slotsToShow = [...activeContacts];
  if (nextSlot) slotsToShow.push(nextSlot);

  // ── Render detail input based on medium type ──
  const renderDetailInput = (slot, medium) => {
    if (!medium) {
      return (
        <input
          className="form-input contact-detail-input"
          type="text"
          value=""
          disabled
          placeholder={t('selectMediumFirst', language)}
        />
      );
    }

    if (PHONE_MEDIUMS.includes(medium) && !DUAL_MEDIUMS.includes(medium)) {
      return (
        <div style={{ display: 'flex', gap: '0.25rem', flex: 1 }}>
          <PhoneInput
            countryCodeName={`phoneCountryCode${slot}`}
            numberName={`contactDetail${slot}`}
            countryCodeValue={formData[`phoneCountryCode${slot}`] || '+84'}
            numberValue={formData[`contactDetail${slot}`] || '0'}
            onChange={updateField}
          />
        </div>
      );
    }

    if (EMAIL_MEDIUMS.includes(medium) && !DUAL_MEDIUMS.includes(medium)) {
      return (
        <input
          className="form-input contact-detail-input"
          type="email"
          value={formData[`contactDetail${slot}`] || ''}
          onChange={(e) => updateField(`contactDetail${slot}`, e.target.value)}
          placeholder={`${medium} email`}
        />
      );
    }

    if (DUAL_MEDIUMS.includes(medium)) {
      const mode = getDualMode(slot);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              type="button"
              className={`btn btn--sm ${mode === 'email' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setSlotDualMode(slot, 'email');
                updateField(`phoneCountryCode${slot}`, 'N/A');
                updateField(`contactDetail${slot}`, '');
              }}
            >
              ✉ Email
            </button>
            <button
              type="button"
              className={`btn btn--sm ${mode === 'phone' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setSlotDualMode(slot, 'phone');
                updateField(`phoneCountryCode${slot}`, '+84');
                updateField(`contactDetail${slot}`, '0');
              }}
            >
              📱 Phone
            </button>
          </div>
          {mode === 'email' ? (
            <input
              className="form-input contact-detail-input"
              type="email"
              value={formData[`contactDetail${slot}`] || ''}
              onChange={(e) => updateField(`contactDetail${slot}`, e.target.value)}
              placeholder={`${medium} email`}
            />
          ) : (
            <PhoneInput
              countryCodeName={`phoneCountryCode${slot}`}
              numberName={`contactDetail${slot}`}
              countryCodeValue={formData[`phoneCountryCode${slot}`] || '+84'}
              numberValue={formData[`contactDetail${slot}`] || '0'}
              onChange={updateField}
            />
          )}
        </div>
      );
    }

    // Plain text (Messenger, etc.)
    return (
      <input
        className="form-input contact-detail-input"
        type="text"
        value={formData[`contactDetail${slot}`] || ''}
        onChange={(e) => updateField(`contactDetail${slot}`, e.target.value)}
        placeholder={t('enterDetails', language).replace('{medium}', medium)}
      />
    );
  };

  // ── Render family contact detail input ──
  const renderFamilyDetailInput = (pfx, medium, ccField, detailField) => {
    if (!medium) {
      return (
        <input
          className="form-input contact-detail-input"
          type="text"
          value=""
          disabled
          placeholder={t('selectMediumFirst', language)}
        />
      );
    }

    if (PHONE_MEDIUMS.includes(medium) && !DUAL_MEDIUMS.includes(medium)) {
      return (
        <PhoneInput
          countryCodeName={ccField}
          numberName={detailField}
          countryCodeValue={formData[ccField] || '+84'}
          numberValue={formData[detailField] || '0'}
          onChange={updateField}
        />
      );
    }

    if (EMAIL_MEDIUMS.includes(medium) && !DUAL_MEDIUMS.includes(medium)) {
      return (
        <input
          className="form-input contact-detail-input"
          type="email"
          value={formData[detailField] || ''}
          onChange={(e) => updateField(detailField, e.target.value)}
          placeholder={`${medium} email`}
        />
      );
    }

    if (DUAL_MEDIUMS.includes(medium)) {
      const mode = getFamilyDualMode(pfx);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              type="button"
              className={`btn btn--sm ${mode === 'email' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setFamilyContactDualMode(pfx, 'email');
                updateField(ccField, 'N/A');
                updateField(detailField, '');
              }}
            >
              ✉ Email
            </button>
            <button
              type="button"
              className={`btn btn--sm ${mode === 'phone' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => {
                setFamilyContactDualMode(pfx, 'phone');
                updateField(ccField, '+84');
                updateField(detailField, '0');
              }}
            >
              📱 Phone
            </button>
          </div>
          {mode === 'email' ? (
            <input
              className="form-input contact-detail-input"
              type="email"
              value={formData[detailField] || ''}
              onChange={(e) => updateField(detailField, e.target.value)}
              placeholder={`${medium} email`}
            />
          ) : (
            <PhoneInput
              countryCodeName={ccField}
              numberName={detailField}
              countryCodeValue={formData[ccField] || '+84'}
              numberValue={formData[detailField] || '0'}
              onChange={updateField}
            />
          )}
        </div>
      );
    }

    // Plain text
    return (
      <input
        className="form-input contact-detail-input"
        type="text"
        value={formData[detailField] || ''}
        onChange={(e) => updateField(detailField, e.target.value)}
        placeholder={t('enterDetails', language).replace('{medium}', medium)}
      />
    );
  };

  // ── QR scan for contact slots ──
  const handleSlotQrScan = async (decodedText, frameImage) => {
    setScanningForSlot(null);
    const parsed = parseQrContent(decodedText);
    const slot = scanningForSlot;
    if (slot) {
      if (parsed.medium) updateField(`contactMedium${slot}`, parsed.medium);
      updateField(`contactDetail${slot}`, parsed.detail || decodedText);
    }
    if (frameImage && onNewQrImage) onNewQrImage(frameImage);
    if (isFacebookUrl(decodedText) && !formData.facebookProfile) {
      updateField('facebookProfile', decodedText);
    }
    if (saveAll) {
      try { await saveAll(); } catch { /* handled by Dashboard */ }
    }
  };

  // ── QR scan for family contact ──
  const handleFamilyQrScan = async (decodedText, frameImage) => {
    setScanningFamily(false);
    const parsed = parseQrContent(decodedText);
    const pfx = selectedParent;
    if (parsed.medium) updateField(`${pfx}ContactMedium`, parsed.medium);
    updateField(`${pfx}ContactDetail`, parsed.detail || decodedText);
    if (frameImage && onNewQrImage) onNewQrImage(frameImage);
    if (saveAll) {
      try { await saveAll(); } catch { /* handled by Dashboard */ }
    }
  };

  // ── Dynamic field names based on selected parent ──
  const pfx = selectedParent;
  const familyFields = {
    fullName:      `${pfx}FullName`,
    email:         `${pfx}Email`,
    phone:         `${pfx}Phone`,
    countryCode:   `${pfx}PhoneCountryCode`,
    contactMedium: `${pfx}ContactMedium`,
    contactCC:     `${pfx}ContactCC`,
    contactDetail: `${pfx}ContactDetail`,
  };

  const parentOptions = [
    { value: 'mother', label: t('parentMother', language) },
    { value: 'father', label: t('parentFather', language) },
  ];

  const emailLocked = false;

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('personalDetailsTitle', language)}</h2>
        <div className="save-status">
          {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              {t('savedAt', language)} {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Student details ── */}
      <div className="form-section">
        <TextInput
          label={t('fullName', language)}
          name="fullName"
          value={formData.fullName}
          onChange={updateField}
          mandatory
          placeholder={t('fullNamePlaceholder', language)}
          error={personalErrors.fullName}
        />

        <div className="form-field">
          <label className="form-label">
            {t('contactDetailsLabel', language)}
          </label>
          <div className="contact-pairs">
            {slotsToShow.map((slot) => {
              const medium = formData[`contactMedium${slot}`] || '';
              const isActive = !!medium;
              const available = CONTACT_MEDIUMS.filter(
                (m) => !usedMediums.has(m) || m === medium
              );
              return (
                <div key={slot} className="contact-pair-row">
                  <select
                    className="form-select contact-medium-select"
                    value={medium}
                    onChange={(e) => {
                      const newMedium = e.target.value;
                      if (!newMedium && isActive) {
                        handleRemoveContact(slot);
                      } else {
                        updateField(`contactMedium${slot}`, newMedium);
                        if (PHONE_MEDIUMS.includes(newMedium) && !DUAL_MEDIUMS.includes(newMedium)) {
                          updateField(`phoneCountryCode${slot}`, '+84');
                          updateField(`contactDetail${slot}`, '0');
                        } else if (DUAL_MEDIUMS.includes(newMedium)) {
                          const mode = getDualMode(slot);
                          if (mode === 'phone') {
                            updateField(`phoneCountryCode${slot}`, '+84');
                            updateField(`contactDetail${slot}`, '0');
                          } else {
                            updateField(`phoneCountryCode${slot}`, 'N/A');
                            updateField(`contactDetail${slot}`, '');
                          }
                        } else {
                          updateField(`phoneCountryCode${slot}`, 'N/A');
                          updateField(`contactDetail${slot}`, '');
                        }
                      }
                    }}
                  >
                    <option value="">{t('selectMedium', language)}</option>
                    {available.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>

                  {renderDetailInput(slot, medium)}

                  <button
                    type="button"
                    className="contact-qr-btn"
                    onClick={() => setScanningForSlot(slot)}
                    title={t('scanQrToFill', language)}
                  >
                    <FiMaximize size={14} />
                  </button>
                  {isActive && (
                    <button
                      type="button"
                      className="btn btn--icon contact-remove-btn"
                      onClick={() => handleRemoveContact(slot)}
                      title={t('remove', language)}
                    >
                      &times;
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <TextInput
          label={t('emailField', language)}
          name="email"
          value={formData.email}
          onChange={updateField}
          type="email"
          mandatory
          disabled={emailLocked}
          error={personalErrors.email}
        />

        <TextInput
          label={t('phoneField', language)}
          name="phone"
          value={formData.phone}
          onChange={updateField}
          type="tel"
          mandatory
          placeholder="+84"
          error={personalErrors.phone}
        />

        <SelectInput
          label={t('studyPlansLabel', language)}
          name="studyPlans"
          value={formData.studyPlans}
          onChange={updateField}
          options={
            // MIGRATED: was getTranslatedOptions('studyPlan', language) reading
            // hardcoded STUDY_PLANS constant. Now reads from lookup_values
            // (category='study_plan') — same source LM uses, so any edit via the
            // admin UI flows through immediately.
            studyPlanLookups.length > 0
              ? studyPlanLookups.map(item => ({
                  value: item.code,
                  label: language === 'vi'
                    ? (item.labelVi || item.code)
                    : (item.labelEn || item.code),
                }))
              : getTranslatedOptions('studyPlan', language)  // fallback while lookups load
          }
          mandatory
          error={personalErrors.studyPlans}
        />
      </div>

      {/* ── Event / Campaign Information (read-only, from QR code) ── */}
      {(formData.campaignType || formData.campaignName || formData.campaignStart) && (
        <div className="form-section">
          <h3 className="form-section-title">{t('campaignSection', language)}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-field">
              <label className="form-label">{t('campaignType', language)}</label>
              <input className="form-input" type="text" value={formData.campaignType || ''} disabled readOnly />
            </div>
            <div className="form-field">
              <label className="form-label">{t('campaignName', language)}</label>
              <input className="form-input" type="text" value={formData.campaignName || ''} disabled readOnly />
            </div>
            <div className="form-field">
              <label className="form-label">{t('campaignStart', language)}</label>
              <input className="form-input" type="text" value={formData.campaignStart ? String(formData.campaignStart).slice(0, 10) : ''} disabled readOnly />
            </div>
            <div className="form-field">
              <label className="form-label">{t('campaignEnd', language)}</label>
              <input className="form-input" type="text" value={formData.campaignEnd ? String(formData.campaignEnd).slice(0, 10) : ''} disabled readOnly />
            </div>
          </div>

          {/* Editable, mandatory referral source */}
          <TextInput
            label={t('referralSource', language)}
            name="referralSource"
            value={formData.referralSource}
            onChange={updateField}
            mandatory
            placeholder={t('referralSourcePlaceholder', language)}
            error={personalErrors.referralSource}
          />
        </div>
      )}

      {/* ── Family Contact section ── */}
      <div className="form-section">
        <h3 className="form-section-title">{t('familyContactSection', language)}</h3>

        <div className="form-field">
          <label className="form-label">{t('parentType', language)}</label>
          <select
            className="form-select"
            value={selectedParent}
            onChange={(e) => setSelectedParent(e.target.value)}
          >
            {parentOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <TextInput
          label={t('familyFullName', language)}
          name={familyFields.fullName}
          value={formData[familyFields.fullName] || ''}
          onChange={updateField}
          placeholder={
            selectedParent === 'mother'
              ? t('motherNamePlaceholder', language)
              : t('fatherNamePlaceholder', language)
          }
          mandatory
        />

        <PhoneInput
          label={t('phoneField', language)}
          countryCodeName={familyFields.countryCode}
          numberName={familyFields.phone}
          countryCodeValue={formData[familyFields.countryCode] || '+84'}
          numberValue={formData[familyFields.phone] || ''}
          onChange={updateField}
          mandatory
        />

        <TextInput
          label={t('familyEmail', language)}
          name={familyFields.email}
          type="email"
          value={formData[familyFields.email] || ''}
          onChange={updateField}
          placeholder={
            selectedParent === 'mother'
              ? t('motherEmailPlaceholder', language)
              : t('fatherEmailPlaceholder', language)
          }
          mandatory
        />

        <div className="form-field">
          <label className="form-label">{t('familyContactMedium', language)}</label>
          <div className="contact-pair-row">
            <select
              className="form-select contact-medium-select"
              value={formData[familyFields.contactMedium] || ''}
              onChange={(e) => {
                const newMedium = e.target.value;
                updateField(familyFields.contactMedium, newMedium);
                if (PHONE_MEDIUMS.includes(newMedium) && !DUAL_MEDIUMS.includes(newMedium)) {
                  updateField(familyFields.contactCC, '+84');
                  updateField(familyFields.contactDetail, '0');
                } else if (DUAL_MEDIUMS.includes(newMedium)) {
                  const mode = getFamilyDualMode(pfx);
                  updateField(familyFields.contactCC, mode === 'phone' ? '+84' : 'N/A');
                  updateField(familyFields.contactDetail, mode === 'phone' ? '0' : '');
                } else {
                  updateField(familyFields.contactCC, 'N/A');
                  updateField(familyFields.contactDetail, '');
                }
              }}
            >
              <option value="">{t('selectMedium', language)}</option>
              {CONTACT_MEDIUMS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            {renderFamilyDetailInput(
              pfx,
              formData[familyFields.contactMedium] || '',
              familyFields.contactCC,
              familyFields.contactDetail
            )}

            <button
              type="button"
              className="contact-qr-btn"
              onClick={() => setScanningFamily(true)}
              title={t('scanQrToFill', language)}
            >
              <FiMaximize size={14} />
            </button>
          </div>
        </div>
      </div>

      <QrScanner
        isOpen={!!scanningForSlot}
        onScan={handleSlotQrScan}
        onClose={() => setScanningForSlot(null)}
      />

      <QrScanner
        isOpen={scanningFamily}
        onScan={handleFamilyQrScan}
        onClose={() => setScanningFamily(false)}
      />
    </div>
  );
}
