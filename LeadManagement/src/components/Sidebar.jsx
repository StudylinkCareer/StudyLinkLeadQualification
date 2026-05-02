// src/components/Sidebar.jsx
// -----------------------------------------------------------------------------
// CHANGES:
//   - Collapse button (<) in sidebar header.
//   - All visible strings via t(key, language).
//   - LanguageSelector in sidebar footer above the staff badge.
//
// CHANGES (mobile drawer + reset on Leads):
//   - On mobile (<=768px), tapping a nav item also closes the drawer.
//   - The Leads link passes state.reset=true so Leads.jsx clears any
//     drill-down filters/state and shows the full list. (Without this,
//     navigating to /leads while already on /leads doesn't remount the
//     component, so previously-applied filters would persist.)
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

const MOBILE_BREAKPOINT = 768;

export default function Sidebar() {
  const { staff, logout, isAdmin } = useAuth();
  const { toggle, setCollapsed }   = useNavCollapse();
  const { language }               = useLanguage();
  const navigate                   = useNavigate();
  const location                   = useLocation();

  const isActive = (path) => location.pathname.startsWith(path);

  // Navigate; close mobile drawer; optionally pass router state.
  function go(path, state) {
    navigate(path, state ? { state } : undefined);
    if (typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT) {
      setCollapsed(true);
    }
  }

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
          onClick={() => go('/dashboard')}
        >
          <FiGrid size={16} /> {t('sidebar.dashboard', language)}
        </button>

        <button
          className={`nav-item ${isActive('/leads') ? 'active' : ''}`}
          onClick={() => go('/leads', { reset: true })}
        >
          <FiUsers size={16} /> {t('sidebar.leads', language)}
        </button>

        {isAdmin && (
          <>
            <span className="nav-section">{t('sidebar.section.admin', language)}</span>
            <button
              className={`nav-item ${isActive('/staff') ? 'active' : ''}`}
              onClick={() => go('/staff')}
            >
              <FiUserCheck size={16} /> {t('sidebar.staff', language)}
            </button>
            <button
              className={`nav-item ${isActive('/settings/columns') ? 'active' : ''}`}
              onClick={() => go('/settings/columns')}
            >
              <FiLayout size={16} /> {t('sidebar.columnSettings', language)}
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
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
