import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { useAuth } from '../../hooks/useAuth';

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[parts.length - 1][0] || '').toUpperCase();
}

// Red header: logo, EN/VN toggle, avatar (photo or initial), ID badge, save status, sign out.
export function Header({ showAccount = true }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, setLanguage, w, student, saveState, flush, forget } = useWizard();
  const next = language === 'vi' ? 'en' : 'vi';
  const saveText = saveState === 'saving' ? w('saving') : saveState === 'saved' ? w('saved') : saveState === 'error' ? w('saveError') : '';

  // Sign out: push any unsaved edit first, end the server session, forget this
  // tab's student, then return to the splash — the next person starts clean.
  const signOut = async () => {
    try { await flush(); } catch { /* best effort */ }
    try { await logout(); } catch { /* the local state is cleared below either way */ }
    try { sessionStorage.removeItem('wz_studentId'); sessionStorage.removeItem('wz_qr'); } catch { /* private mode */ }
    forget();
    navigate('/app', { replace: true });
  };

  return (
    <header className="wz-header">
      <div className="wz-header-row">
        <div className="wz-brand"><img src="/wizard/logo-white.png" alt={w('appName')} /></div>
        <div className="wz-lang">
          <button type="button" className="wz-langbtn" onClick={() => setLanguage(next)}
            aria-label={`${w('langToggle')}: ${next.toUpperCase()}`}>
            <span>EN</span>
            <span className="wz-toggle" data-lang={language} aria-hidden="true" />
            <span>VN</span>
          </button>
          {showAccount && student && (
            <div className="wz-avatar" aria-hidden="true">
              {student.headshotUrl ? <img src={student.headshotUrl} alt="" /> : initialsOf(student.fullName)}
            </div>
          )}
        </div>
      </div>
      {showAccount && student && (
        <div className="wz-idrow">
          <span className="wz-id">{w('idLabel')}: {student.studentId}</span>
          <span className="wz-saved" role="status" aria-live="polite">{saveText}</span>
          <button type="button" className="wz-signout" onClick={signOut}>{w('signOut')}</button>
        </div>
      )}
    </header>
  );
}

// Standard inner screen: red header + white sheet.
export function Screen({ children, showAccount = true }) {
  return (
    <div className="wz-frame">
      <Header showAccount={showAccount} />
      <main className="wz-sheet">{children}</main>
    </div>
  );
}
