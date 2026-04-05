import { STONE_TIERS } from '../../utils/formFields';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';
import quartzImg from '../../Assets/Stones/quartz.png';
import agateImg from '../../Assets/Stones/agate.png';
import sapphireImg from '../../Assets/Stones/sapphire.png';
import rubyImg from '../../Assets/Stones/ruby.png';
import diamondImg from '../../Assets/Stones/diamond.png';

const STONE_IMAGES = {
  Quartz: quartzImg,
  Agate: agateImg,
  Sapphire: sapphireImg,
  Ruby: rubyImg,
  Diamond: diamondImg,
};

export default function RiskResult({ result }) {
  if (!result) return null;
  const { language } = useLanguage();
  const tier = STONE_TIERS.find((s) => s.name === result.stoneTier) || STONE_TIERS[0];
  const stoneImage = STONE_IMAGES[tier.name];

  return (
    <div className="risk-result">
      <div className="risk-result-header" style={{ borderColor: tier.color }}>
        <div className="risk-stone" style={{ background: 'transparent', border: `2px solid ${tier.color}`, overflow: 'hidden', borderRadius: '50%' }}>
          <img
            src={stoneImage}
            alt={tier.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <div className="risk-summary">
          <h3>{t('yourPotentialAs', language)}: <span style={{ color: tier.color }}>{t(`stone_${tier.name}`, language)}</span></h3>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            {t(`stoneSubtitle_${tier.name}`, language)}
          </p>
          <div className="risk-score-display">
            <span className="risk-score-number" style={{ color: tier.color }}>
              {result.totalScore}
            </span>
            <span className="risk-score-max">/ {result.maxScore}</span>
          </div>
        </div>
      </div>

      <div className="risk-scale">
        {STONE_TIERS.map((s) => (
          <div
            key={s.name}
            className={`risk-scale-segment ${s.name === tier.name ? 'risk-scale-segment--active' : ''}`}
            style={{ background: s.name === tier.name ? s.color : '#e5e7eb' }}
          >
            {/* translated stone name */}
            <span className="risk-scale-label">{t(`stone_${s.name}`, language)}</span>
            <span className="risk-scale-range">{s.min}-{s.max}</span>
          </div>
        ))}
      </div>

      <details className="risk-breakdown">
        <summary>{t('scoreBreakdown', language)}</summary>
        <table className="risk-table">
          <thead>
            <tr>
              <th>{t('colField', language)}</th>
              <th>{t('colValue', language)}</th>
              <th>{t('colTier', language)}</th>
              <th>{t('colScore', language)}</th>
            </tr>
          </thead>
          <tbody>
            {result.breakdown.map((item) => (
              <tr key={item.fieldKey}>
                <td>{t(item.fieldKey, language)}</td>
                <td>{item.value || '—'}</td>
                <td>{item.tierScore}</td>
                <td><strong>{item.weightedScore}</strong></td>
              </tr>
            ))}
            <tr className="risk-table-total">
              <td colSpan={3}><strong>{t('colTotal', language)}</strong></td>
              <td><strong>{result.totalScore}</strong></td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}
