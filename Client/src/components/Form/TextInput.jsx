import './Form.css';

export default function TextInput({ label, name, value, onChange, type = 'text', mandatory, error, placeholder, disabled }) {
  return (
    <div className={`form-field ${error ? 'form-field--error' : ''}`}>
      <label className="form-label" htmlFor={name}>
        {label}{mandatory && <span className="form-mandatory">*</span>}
      </label>
      <input
        className="form-input"
        id={name}
        name={name}
        type={type}
        value={value || ''}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
