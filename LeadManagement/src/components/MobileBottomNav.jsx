// src/components/MobileBottomNav.jsx
// -----------------------------------------------------------------------------
// Bottom tab bar shown only on mobile (display:none on desktop via CSS).
// Top 3 destinations:
//   - Dashboard
//   - Leads
//   - Menu (toggles the sidebar drawer for everything else: Staff, Column
//           Settings, Language, Sign out)
// -----------------------------------------------------------------------------

import { useNavigate, useLocation } from 'react-router-dom';
import { useNavCollapse } from '../contexts/NavCollapseContext';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';
import { FiGrid, FiUsers, FiMenu } from 'react-icons/fi';

export default function MobileBottomNav() {
  const { collapsed, toggle } = useNavCollapse();
  const { language }          = useLanguage();
  const navigate              = useNavigate();
  const location              = useLocation();

  const isActive = (path) => location.pathname.startsWith(path);

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      <button
        type="button"
        className={`mobile-bottom-nav__item ${isActive('/dashboard') ? 'is-active' : ''}`}
        onClick={() => navigate('/dashboard')}
      >
        <FiGrid size={20} />
        <span>{t('sidebar.dashboard', language)}</span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-nav__item ${isActive('/leads') ? 'is-active' : ''}`}
        onClick={() => navigate('/leads')}
      >
        <FiUsers size={20} />
        <span>{t('sidebar.leads', language)}</span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-nav__item ${!collapsed ? 'is-active' : ''}`}
        onClick={toggle}
        aria-label="Toggle full menu"
      >
        <FiMenu size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
