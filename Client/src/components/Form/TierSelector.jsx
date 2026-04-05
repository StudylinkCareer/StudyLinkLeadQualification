import './Form.css';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

export default function TierSelector({ label, description, name, value, onChange, tiers, weight }) {
  const { language } = useLanguage();

  return (
    <div className="tier-selector">
      <div className="tier-header">
        <span className="tier-label">{label}</span>
        {/* weight display hidden — value still used in calculations */}
      </div>
      {description && <p className="tier-description">{description}</p>}
      <div className="tier-options">
        {tiers.map((tier, idx) => (
          <button
            key={tier.value}
            type="button"
            className={`tier-option tier-option--${idx + 1} ${value === tier.value ? 'tier-option--selected' : ''}`}
            onClick={() => onChange(name, tier.value)}
          >
            <span className="tier-option-number">{idx + 1}</span>
            <span className="tier-option-label">{tier.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
