import './Form.css';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

export default function SelectInput({ label, name, value, onChange, options, mandatory, error, placeholder, disabled }) {
  const { language } = useLanguage();

  return (
    <div className={`form-field ${error ? 'form-field--error' : ''}`}>
      <label className="form-label" htmlFor={name}>
        {label}{mandatory && <span className="form-mandatory">*</span>}
      </label>
      <select
        className="form-select"
        id={name}
        name={name}
        value={value || ''}
        onChange={(e) => onChange(name, e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder || t('selectDefault', language)}</option>
        {options.map((opt) => {
          const optValue = typeof opt === 'object' ? opt.value : opt;
          const optLabel = typeof opt === 'object' ? opt.label : opt;
          return (
            <option key={optValue} value={optValue}>{optLabel}</option>
          );
        })}
      </select>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
