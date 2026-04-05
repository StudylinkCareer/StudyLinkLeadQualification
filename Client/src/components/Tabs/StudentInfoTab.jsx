import SelectInput from '../Form/SelectInput';
import MultiSelectInput from '../Form/MultiSelectInput';
import {
  DESTINATION_COUNTRIES_GROUPED, VIETNAM_PROVINCES,
} from '../../utils/formFields';
import { getTranslatedOptions } from '../../utils/formFields';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

export default function StudentInfoTab({ formData, updateField, saving, lastSaved }) {
  const { language } = useLanguage();

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('studyInfoTitle', language)}</h2>
        <div className="save-status">
          {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              {t('savedAt', language)} {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="form-section">
        <MultiSelectInput
          label={t('destinationCountry', language)}
          name="destinationCountry"
          value={
            Array.isArray(formData.destinationCountry)
              ? formData.destinationCountry
              : (formData.destinationCountry ? formData.destinationCountry.split(', ').filter(Boolean) : [])
          }
          onChange={updateField}
          groups={DESTINATION_COUNTRIES_GROUPED}
          max={3}
        />

        <SelectInput
          label={t('timeline', language)}
          name="timeline"
          value={formData.timeline}
          onChange={updateField}
          options={getTranslatedOptions('timeline', language)}
        />

        <SelectInput
          label={t('processApplication', language)}
          name="processApplication"
          value={formData.processApplication}
          onChange={updateField}
          options={getTranslatedOptions('processApplication', language)}
        />

        <SelectInput
          label={t('residencyProvince', language)}
          name="residency"
          value={formData.residency}
          onChange={updateField}
          options={VIETNAM_PROVINCES}
        />
      </div>
    </div>
  );
}
