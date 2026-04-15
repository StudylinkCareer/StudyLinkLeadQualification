// src/components/Sidebar.jsx
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  FiGrid, FiUsers, FiUserCheck, FiLogOut, FiLayout,
} from 'react-icons/fi';

export default function Sidebar() {
  const { staff, logout, isAdmin, isManager } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const isActive = (path) => location.pathname.startsWith(path);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">StudyLink</div>
        <div className="sidebar-subtitle">Lead Management</div>
      </div>

      <nav className="sidebar-nav">
        <span className="nav-section">Main</span>

        <button
          className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
          onClick={() => navigate('/dashboard')}
        >
          <FiGrid size={16} /> Dashboard
        </button>

        <button
          className={`nav-item ${isActive('/leads') ? 'active' : ''}`}
          onClick={() => navigate('/leads')}
        >
          <FiUsers size={16} /> Leads
        </button>

        {isAdmin && (
          <>
            <span className="nav-section">Admin</span>
            <button
              className={`nav-item ${isActive('/staff') ? 'active' : ''}`}
              onClick={() => navigate('/staff')}
            >
              <FiUserCheck size={16} /> Staff
            </button>
            <button
              className={`nav-item ${isActive('/settings/columns') ? 'active' : ''}`}
              onClick={() => navigate('/settings/columns')}
            >
              <FiLayout size={16} /> Column Settings
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="staff-badge">
          <div className="staff-avatar">
            {staff?.fullName?.charAt(0) || '?'}
          </div>
          <div className="staff-info">
            <div className="staff-name">{staff?.fullName}</div>
            <div className="staff-role">{staff?.role}</div>
          </div>
          <button className="btn btn--ghost btn--icon" onClick={handleLogout} title="Sign out">
            <FiLogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
