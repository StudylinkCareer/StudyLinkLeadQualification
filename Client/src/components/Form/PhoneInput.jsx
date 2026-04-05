import { useState, useRef, useEffect } from 'react';
import { COUNTRY_CODES } from '../../utils/formFields';
import './Form.css';

export default function PhoneInput({ label, countryCodeName, numberName, countryCodeValue, numberValue, onChange, mandatory, error, disabled }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  const selectedCode = countryCodeValue || '+84';
  const filtered = COUNTRY_CODES.filter(
    (c) =>
      c.country.toLowerCase().includes(search.toLowerCase()) ||
      c.code.includes(search)
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  // Initialise country code to +84 if not yet set — re-runs when field name changes (e.g. mother→father)
  useEffect(() => {
    if (!countryCodeValue && countryCodeName && onChange) {
      onChange(countryCodeName, '+84');
    }
  }, [countryCodeName]);

  const handleSelect = (code) => {
    onChange(countryCodeName, code);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className={`form-field ${error ? 'form-field--error' : ''}`}>
      <label className="form-label">
        {label}{mandatory && <span className="form-mandatory">*</span>}
      </label>
      <div className="phone-input-row">
        {/* Custom country code selector */}
        <div className="phone-country-wrapper" ref={dropdownRef}>
          <button
            type="button"
            className="phone-country-btn"
            onClick={() => !disabled && setOpen(!open)}
            disabled={disabled}
          >
            {selectedCode.split(' ')[0]}
            <span className="phone-country-arrow">▾</span>
          </button>

          {open && (
            <div className="phone-country-dropdown">
              <input
                ref={searchRef}
                className="phone-country-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country..."
              />
              <ul className="phone-country-list">
                {filtered.map((c) => (
                  <li
                    key={`${c.country}-${c.code}`}
                    className={`phone-country-option ${c.code === selectedCode ? 'phone-country-option--selected' : ''}`}
                    onClick={() => handleSelect(c.code)}
                  >
                    <span className="phone-country-name">{c.country}</span>
                    <span className="phone-country-code">{c.code}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Phone number input */}
        <input
          className="form-input phone-number"
          type="tel"
          value={numberValue || '0'}
          onChange={(e) => {
  
            let digits = e.target.value.replace(/\D/g, '');
            if (!digits.startsWith('0')) digits = '0' + digits.replace(/^0*/, '');
            if (digits === '') digits = '0';
            digits = digits.slice(0, 10);
            const formatted = digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits;
            onChange(numberName, formatted);  

          }}
          placeholder="e.g. 098 1234567"
          disabled={disabled}
        />
      </div>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
