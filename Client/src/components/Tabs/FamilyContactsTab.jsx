import TextInput from '../Form/TextInput';
import PhoneInput from '../Form/PhoneInput';
import { CONTACT_MEDIUMS, PHONE_MEDIUMS, EMAIL_MEDIUMS, DUAL_MEDIUMS } from '../../utils/formFields';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

export default function FamilyContactsTab({ formData, updateField, saving, lastSaved, familyErrors = {} }) {
  const { language } = useLanguage();

  const renderContactDetail = (pfx, medium, ccField, detailField) => {
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
      // Facebook/Instagram — ask for the profile LINK, not a username: a
      // link is unambiguous and lets staff open it directly, where a typed
      // username/profile name can be misspelled or belong to someone else.
      if (formData[ccField] !== 'N/A') updateField(ccField, 'N/A');
      return (
        <input
          className="form-input contact-detail-input"
          type="url"
          value={formData[detailField] || ''}
          onChange={(e) => updateField(detailField, e.target.value)}
          placeholder={`${medium} profile link`}
        />
      );
    }

    // Plain text
    if (formData[ccField] !== 'N/A') updateField(ccField, 'N/A');
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

  const handleMediumChange = (pfx, ccField, detailField, newMedium) => {
    updateField(`${pfx}ContactMedium`, newMedium);
    // Only Facebook/Instagram remain, both link-based — no phone-number
    // branch needed any more.
    updateField(ccField, 'N/A');
    updateField(detailField, '');
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('familyContactsTitle', language)}</h2>
        <div className="save-status">
          {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              {t('savedAt', language)} {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="family-details-col">

        {/* Mother's details */}
        <div className="form-section">
          <h3 className="form-section-title">{t('motherDetails', language)}</h3>

          <TextInput
            label={t('familyFullName', language)}
            name="motherFullName"
            value={formData.motherFullName}
            onChange={updateField}
            placeholder={t('motherNamePlaceholder', language)}
            mandatory
            error={familyErrors.motherFullName}
          />

          <PhoneInput
            label={t('phoneField', language)}
            countryCodeName="motherPhoneCountryCode"
            numberName="motherPhone"
            countryCodeValue={formData.motherPhoneCountryCode || '+84'}
            numberValue={formData.motherPhone || '0'}
            onChange={updateField}
            mandatory
            error={familyErrors.motherPhone}
          />

          <TextInput
            label={t('familyEmail', language)}
            name="motherEmail"
            type="email"
            value={formData.motherEmail}
            onChange={updateField}
            placeholder={t('motherEmailPlaceholder', language)}
            mandatory
            error={familyErrors.motherEmail}
          />

          <div className="form-field">
            <label className="form-label">{t('familyContactMedium', language)}</label>
            <div className="contact-pair-row">
              <select
                className="form-select contact-medium-select"
                value={formData.motherContactMedium || ''}
                onChange={(e) => handleMediumChange('mother', 'motherContactCC', 'motherContactDetail', e.target.value)}
              >
                <option value="">{t('selectMedium', language)}</option>
                {CONTACT_MEDIUMS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {renderContactDetail(
                'mother',
                formData.motherContactMedium || '',
                'motherContactCC',
                'motherContactDetail'
              )}
            </div>
          </div>
        </div>

        {/* Father's details */}
        <div className="form-section">
          <h3 className="form-section-title">{t('fatherDetails', language)}</h3>

          <TextInput
            label={t('familyFullName', language)}
            name="fatherFullName"
            value={formData.fatherFullName}
            onChange={updateField}
            placeholder={t('fatherNamePlaceholder', language)}
            mandatory
            error={familyErrors.fatherFullName}
          />

          <PhoneInput
            label={t('phoneField', language)}
            countryCodeName="fatherPhoneCountryCode"
            numberName="fatherPhone"
            countryCodeValue={formData.fatherPhoneCountryCode || '+84'}
            numberValue={formData.fatherPhone || '0'}
            onChange={updateField}
            mandatory
            error={familyErrors.fatherPhone}
          />

          <TextInput
            label={t('familyEmail', language)}
            name="fatherEmail"
            type="email"
            value={formData.fatherEmail}
            onChange={updateField}
            placeholder={t('fatherEmailPlaceholder', language)}
            mandatory
            error={familyErrors.fatherEmail}
          />

          <div className="form-field">
            <label className="form-label">{t('familyContactMedium', language)}</label>
            <div className="contact-pair-row">
              <select
                className="form-select contact-medium-select"
                value={formData.fatherContactMedium || ''}
                onChange={(e) => handleMediumChange('father', 'fatherContactCC', 'fatherContactDetail', e.target.value)}
              >
                <option value="">{t('selectMedium', language)}</option>
                {CONTACT_MEDIUMS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {renderContactDetail(
                'father',
                formData.fatherContactMedium || '',
                'fatherContactCC',
                'fatherContactDetail'
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
