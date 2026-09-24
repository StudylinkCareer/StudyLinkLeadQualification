import { useEffect, useRef } from 'react';

export function NavButton({ children, className = '', ...rest }) {
  return <button type="button" className={`wz-btn ${className}`} {...rest}>{children}</button>;
}

export function PillButton({ children, icon, className = '', ...rest }) {
  return <button type="button" className={`wz-pill ${className}`} {...rest}>{icon}{children}</button>;
}

export function Field({ id, label, required, hint, children }) {
  return (
    <div className="wz-field">
      {label && (
        <label className="wz-label" htmlFor={id}>
          {label}{required && <span className="wz-req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="wz-hint">{hint}</p>}
    </div>
  );
}

export function TextField({ id, label, required, invalid, hint, ...rest }) {
  return (
    <Field id={id} label={label} required={required} hint={hint}>
      <input id={id} className={`wz-input${invalid ? ' wz-invalid' : ''}`} required={required}
        aria-invalid={invalid || undefined} {...rest} />
    </Field>
  );
}

// options: [{ value, label }]
export function SelectField({ id, label, required, invalid, hint, value, onChange, options, placeholder, disabled }) {
  return (
    <Field id={id} label={label} required={required} hint={hint}>
      <select id={id} className={`wz-select${invalid ? ' wz-invalid' : ''}`} value={value}
        onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required}
        aria-invalid={invalid || undefined}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function RadioGroup({ name, label, required, invalid, value, onChange, options }) {
  return (
    <div className={`wz-radios${invalid ? ' wz-invalid' : ''}`} role="radiogroup" aria-label={label}>
      <span className="wz-label">{label}{required && <span className="wz-req" aria-hidden="true">*</span>}</span>
      <div className="wz-radiogroup">
        {options.map((o) => (
          <label key={o.value} className="wz-radio">
            <input type="radio" name={name} value={o.value} checked={value === o.value}
              onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Accessible modal: role=dialog, Esc closes, focus moves in and is restored, Tab is trapped.
export function Dialog({ title, heading, onClose, closeLabel, wide, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusables = () => el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (focusables()[0] || el).focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = [...focusables()].filter((n) => !n.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  }, [onClose]);

  return (
    <div className="wz-backdrop">
      <div className={`wz-dialog${wide ? ' wz-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        {closeLabel ? (
          <div className="wz-dialog-top">
            <h2>{heading || title}</h2>
            <button type="button" className="wz-x" onClick={onClose} aria-label={closeLabel}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        ) : <h2>{heading || title}</h2>}
        {children}
      </div>
    </div>
  );
}
