// client/src/components/Form/MultiSelectInput.jsx
//
// CHANGES:
//   - groups[].countries items can now be either plain strings (legacy)
//     OR {value, label} objects (new, used for language-aware display).
//     The stored selection always uses the `value` field, never the label,
//     so the DB sees canonical English codes regardless of UI language.

import './Form.css';

export default function MultiSelectInput({ label, name, value = [], onChange, options, groups, max, mandatory, error, disabled }) {
  const selected = Array.isArray(value) ? value : (value ? value.split(', ').filter(Boolean) : []);

  const handleToggle = (optionValue) => {
    if (selected.includes(optionValue)) {
      onChange(name, selected.filter((v) => v !== optionValue));
    } else {
      if (max && selected.length >= max) return; // enforce max
      onChange(name, [...selected, optionValue]);
    }
  };

  const renderCheckbox = (optValue, optLabel) => {
    const isSelected = selected.includes(optValue);
    const isDisabled = disabled || (!isSelected && max && selected.length >= max);
    return (
      <label key={optValue} className={`form-checkbox-label ${isDisabled ? 'form-checkbox-label--disabled' : ''}`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => handleToggle(optValue)}
          disabled={isDisabled}
        />
        <span>{optLabel}</span>
      </label>
    );
  };

  return (
    <div className={`form-field ${error ? 'form-field--error' : ''}`}>
      <label className="form-label">
        {label}{mandatory && <span className="form-mandatory">*</span>}
        {max && <span className="form-label-hint"> (max {max})</span>}
      </label>

      {/* Grouped rendering */}
      {groups ? (
        <div className="form-checkbox-groups">
          {groups.map((group) => (
            <div key={group.region} className="form-checkbox-group-section">
              <div className="form-checkbox-group-heading">{group.region}</div>
              <div className="form-checkbox-group">
                {group.countries.map((country) => {
                  // Backwards-compat: support plain strings AND {value,label} objects.
                  const optValue = typeof country === 'object' ? country.value : country;
                  const optLabel = typeof country === 'object' ? country.label : country;
                  return renderCheckbox(optValue, optLabel);
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="form-checkbox-group">
          {options.map((opt) => {
            const optValue = typeof opt === 'object' ? opt.value : opt;
            const optLabel = typeof opt === 'object' ? opt.label : opt;
            return renderCheckbox(optValue, optLabel);
          })}
        </div>
      )}

      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
