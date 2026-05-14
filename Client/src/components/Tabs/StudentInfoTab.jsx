// client/src/components/Tabs/StudentInfoTab.jsx
//
// CHANGES:
//   - residency:           was hardcoded VIETNAM_PROVINCES → now useLookup('vietnam_province')
//                          Displays labelVi (e.g., "Hồ Chí Minh") in VI mode,
//                          ASCII code (e.g., "Ho Chi Minh City") in EN mode.
//                          Stored value is always the ASCII canonical code so it
//                          reads back into the DB consistently regardless of UI language.
//   - destinationCountry:  was hardcoded DESTINATION_COUNTRIES_GROUPED → now useLookup('country')
//                          Grouped by meta.region from the lookup row. Display label
//                          switches by language, stored value stays canonical.
//   - timeline and processApplication: kept on getTranslatedOptions() pending Phase 3 migration.

import SelectInput from '../Form/SelectInput';
import MultiSelectInput from '../Form/MultiSelectInput';
import { getTranslatedOptions } from '../../utils/formFields';
import { useLanguage } from '../../contexts/LanguageContext';
import { useLookup } from '../../contexts/LookupContext';
import { t } from '../../i18n';

export default function StudentInfoTab({ formData, updateField, saving, lastSaved }) {
  const { language } = useLanguage();

  // ── Lookup-driven option lists ────────────────────────────────
  const provinces = useLookup('vietnam_province');
  const countries = useLookup('country');

  // Build province dropdown options: language-aware label, ASCII code as value.
  const provinceOptions = provinces.length > 0
    ? provinces.map(item => ({
        value: item.code,
        label: language === 'vi'
          ? (item.labelVi || item.code)
          : (item.labelEn || item.code),
      }))
    : [];

  // Build country groups by region for the MultiSelectInput.
  // Items inside each group are {value, label} pairs so the checkbox display
  // can show labelVi while still storing the canonical code.
  const countryGroups = (() => {
    if (countries.length === 0) return [];
    const byRegion = new Map();
    for (const item of countries) {
      const region = item.meta?.region || 'Other';
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region).push({
        value: item.code,
        label: language === 'vi' ? (item.labelVi || item.code) : (item.labelEn || item.code),
      });
    }
    // Sort countries within each region by display label.
    for (const arr of byRegion.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
    }
    // Stable region order matches the old hardcoded layout.
    const REGION_ORDER = ['Australasia', 'Europe', 'North America', 'Asia', 'Other'];
    return REGION_ORDER
      .filter(r => byRegion.has(r))
      .map(r => ({ region: r, countries: byRegion.get(r) }));
  })();

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
          groups={countryGroups}
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
          options={provinceOptions}
        />
      </div>
    </div>
  );
}
