// src/components/Sidebar.jsx
// -----------------------------------------------------------------------------
// CHANGES:
//   - Added collapse button (<) in the sidebar header, top-right.
//     Clicking it calls toggle() from NavCollapseContext which sets
//     `collapsed = true`; the .nav-collapsed class on .app-layout then
//     hides the sidebar via CSS.
//
// CHANGES (i18n Phase 1):
//   - All visible strings (labels, section headers, tooltips) now go
//     through t(key, language) from the i18n module.
//   - LanguageSelector added to the sidebar footer, above the staff badge.
//   - Subtitle text uses translation so Vietnamese users see a Vietnamese
//     product descriptor. "StudyLink" is a brand — not translated.
// -----------------------------------------------------------------------------

import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNavCollapse } from '../contexts/NavCollapseContext';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';
import LanguageSelector from './LanguageSelector';
import {
  FiGrid, FiUsers, FiUserCheck, FiLogOut, FiLayout, FiChevronLeft,
} from 'react-icons/fi';

export default function Sidebar() {
  const { staff, logout, isAdmin } = useAuth();
  const { toggle }                 = useNavCollapse();
  const { language }               = useLanguage();
  const navigate                   = useNavigate();
  const location                   = useLocation();

  const isActive = (path) => location.pathname.startsWith(path);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <div>
            <div className="sidebar-logo">{t('sidebar.productName', language)}</div>
            <div className="sidebar-subtitle">{t('sidebar.productSubtitle', language)}</div>
          </div>
          <button
            className="nav-collapse-btn"
            onClick={toggle}
            title={t('sidebar.collapse', language)}
            aria-label={t('sidebar.collapse', language)}
          >
            <FiChevronLeft size={16} />
          </button>
        </div>
      </div>

      <nav className="sidebar-nav">
        <span className="nav-section">{t('sidebar.section.main', language)}</span>

        <button
          className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
          onClick={() => navigate('/dashboard')}
        >
          <FiGrid size={16} /> {t('sidebar.dashboard', language)}
        </button>

        <button
          className={`nav-item ${isActive('/leads') ? 'active' : ''}`}
          onClick={() => navigate('/leads', { state: { refresh: Date.now() } })}
        >
          <FiUsers size={16} /> {t('sidebar.leads', language)}
        </button>

        {isAdmin && (
          <>
            <span className="nav-section">{t('sidebar.section.admin', language)}</span>
            <button
              className={`nav-item ${isActive('/staff') ? 'active' : ''}`}
              onClick={() => navigate('/staff')}
            >
              <FiUserCheck size={16} /> {t('sidebar.staff', language)}
            </button>
            <button
              className={`nav-item ${isActive('/settings/columns') ? 'active' : ''}`}
              onClick={() => navigate('/settings/columns')}
            >
              <FiLayout size={16} /> {t('sidebar.columnSettings', language)}
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {/* Language toggle — Vietnam/UK flag buttons */}
        <div className="sidebar-lang-row">
          <LanguageSelector />
        </div>

        <div className="staff-badge">
          <div className="staff-avatar">
            {staff?.fullName?.charAt(0) || '?'}
          </div>
          <div className="staff-info">
            <div className="staff-name">{staff?.fullName}</div>
            <div className="staff-role">{staff?.role}</div>
          </div>
          <button
            className="btn btn--ghost btn--icon"
            onClick={handleLogout}
            title={t('sidebar.signOut', language)}
            aria-label={t('sidebar.signOut', language)}
          >
            <FiLogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
