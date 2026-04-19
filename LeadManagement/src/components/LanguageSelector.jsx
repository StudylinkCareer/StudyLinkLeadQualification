// src/components/LanguageSelector.jsx
// -----------------------------------------------------------------------------
// Small flag-button pair. Active language shows full opacity; inactive is 0.5.
// Designed to sit in the sidebar footer.
// -----------------------------------------------------------------------------

import { useLanguage } from '../contexts/LanguageContext';

export default function LanguageSelector() {
  const { language, setLanguage } = useLanguage();

  const btnStyle = {
    border: 'none',
    background: 'transparent',
    padding: '2px',
    cursor: 'pointer',
    borderRadius: '4px',
    opacity: 0.5,
    transition: 'opacity 0.2s',
  };

  const activeBtnStyle = { ...btnStyle, opacity: 1 };

  return (
    <div className="language-selector">
      <button
        type="button"
        style={language === 'vi' ? activeBtnStyle : btnStyle}
        onClick={() => setLanguage('vi')}
        title="Tiếng Việt"
        aria-label="Tiếng Việt"
      >
        <img
          src="https://flagcdn.com/w40/vn.png"
          alt="Tiếng Việt"
          width="28"
          height="20"
          style={{ display: 'block', borderRadius: '3px' }}
        />
      </button>
      <button
        type="button"
        style={language === 'en' ? activeBtnStyle : btnStyle}
        onClick={() => setLanguage('en')}
        title="English"
        aria-label="English"
      >
        <img
          src="https://flagcdn.com/w40/gb.png"
          alt="English"
          width="28"
          height="20"
          style={{ display: 'block', borderRadius: '3px' }}
        />
      </button>
    </div>
  );
}
