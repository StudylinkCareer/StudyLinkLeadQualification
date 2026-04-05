import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

export default function CareerFitTab() {
  const { language } = useLanguage();

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('careerFitTitle', language)}</h2>
      </div>

      <div className="form-section" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-secondary)' }}>
        <p style={{ fontSize: '1.125rem', fontWeight: 500, marginBottom: '0.5rem' }}>
          {t('careerFitInBuild', language)}
        </p>
        <p style={{ fontSize: '0.9375rem' }}>
          {t('careerFitComeback', language)}
        </p>
      </div>
    </div>
  );
}
