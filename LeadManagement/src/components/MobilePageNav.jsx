// src/components/MobilePageNav.jsx
// -----------------------------------------------------------------------------
// Three icon buttons fixed to the top-right of the viewport.
// Visible only on mobile (display:none on desktop via CSS).
//
// Buttons:
//   1. Dashboard — navigates to /dashboard
//   2. Leads     — navigates to /leads with state.reset=true so Leads.jsx
//                  clears any drill-down filters and shows the full list
//   3. Menu      — toggles the sidebar drawer overlay
//
// The active page's button is highlighted.
// -----------------------------------------------------------------------------

import { useNavigate, useLocation } from 'react-router-dom';
import { useNavCollapse } from '../contexts/NavCollapseContext';
import { FiGrid, FiUsers, FiMenu } from 'react-icons/fi';

export default function MobilePageNav() {
  const navigate              = useNavigate();
  const location              = useLocation();
  const { collapsed, toggle } = useNavCollapse();

  const onDashboard = location.pathname.startsWith('/dashboard');
  const onLeads     = location.pathname.startsWith('/leads');
  const drawerOpen  = !collapsed;

  return (
    <div className="mobile-page-nav" role="navigation" aria-label="Page navigation">
      <button
        type="button"
        className={`mobile-page-nav__btn ${onDashboard ? 'is-active' : ''}`}
        onClick={() => navigate('/dashboard')}
        aria-label="Dashboard"
        title="Dashboard"
      >
        <FiGrid size={18} />
      </button>

      <button
        type="button"
        className={`mobile-page-nav__btn ${onLeads ? 'is-active' : ''}`}
        onClick={() => navigate('/leads', { state: { reset: true } })}
        aria-label="Leads"
        title="Leads"
      >
        <FiUsers size={18} />
      </button>

      <button
        type="button"
        className={`mobile-page-nav__btn ${drawerOpen ? 'is-active' : ''}`}
        onClick={toggle}
        aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
        title="Menu"
      >
        <FiMenu size={18} />
      </button>
    </div>
  );
}
