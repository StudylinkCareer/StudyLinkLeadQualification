import { useLanguage } from '../contexts/LanguageContext';

// Flag images from flagcdn.com — works on all platforms including Windows.
// Ellipse/border removed via inline style overrides on the buttons.
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

  const activeBtnStyle = {
    ...btnStyle,
    opacity: 1,
  };

  return (
    <div className="language-selector">
      <button
        type="button"
        style={language === 'vi' ? activeBtnStyle : btnStyle}
        onClick={() => setLanguage('vi')}
        title="Tiếng Việt"
      >
        <img
          src="https://flagcdn.com/w40/vn.png"
          alt="Tiếng Việt"
          width="32"
          height="22"
          style={{ display: 'block', borderRadius: '3px' }}
        />
      </button>
      <button
        type="button"
        style={language === 'en' ? activeBtnStyle : btnStyle}
        onClick={() => setLanguage('en')}
        title="English"
      >
        <img
          src="https://flagcdn.com/w40/gb.png"
          alt="English"
          width="32"
          height="22"
          style={{ display: 'block', borderRadius: '3px' }}
        />
      </button>
    </div>
  );
}
