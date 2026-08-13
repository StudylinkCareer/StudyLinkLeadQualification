// src/components/Sidebar.jsx
// -----------------------------------------------------------------------------
// CHANGES:
//   - Removed isAdmin hardcoded check.
//   - Staff nav item now driven by `staff.manage` RBAC permission.
//   - Column Settings nav item now driven by `column_config.manage` RBAC permission.
//   - Admin section header only renders if at least one admin nav item is visible.
// -----------------------------------------------------------------------------

import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { isManagerOrAdmin, canManageTargets, canViewEventAnalytics } from '../utils/roleProfiles';
import { useNavCollapse } from '../contexts/NavCollapseContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { useNoteDrafts } from '../contexts/NoteDraftsContext';
import { t } from '../i18n';
import LanguageSelector from './LanguageSelector';
import {
  FiGrid, FiUsers, FiUserCheck, FiLogOut, FiLayout, FiChevronLeft, FiCalendar, FiPhoneCall, FiBell, FiFileText, FiShare2, FiShuffle, FiCheckSquare, FiTrash2, FiTool, FiUserPlus, FiTarget, FiBarChart2, FiClock,
} from 'react-icons/fi';

export default function Sidebar() {
  const { staff, logout }    = useAuth();
  const { canDo }            = usePermissions();
  const { toggle }           = useNavCollapse();
  const { language }         = useLanguage();
  const { clear: clearTrail } = useNavTrail();
  const { count: pendingDraftCount } = useNoteDrafts();
  const navigate             = useNavigate();
  const location             = useLocation();

  const isActive = (path) => location.pathname.startsWith(path);

  const canCreateSales        = canDo('leads', 'create_sales');
  const canManageStaff        = canDo('staff', 'manage');
  const canManageColumns      = canDo('column_config', 'manage');
  const canViewReports        = canDo('reports', 'view');
  const canManageDistribution = canDo('distribution', 'manage');
  const canDeleteLeads        = canDo('leads', 'delete');
  // Admin-page navs match their backend guards so nothing is "visible but 403":
  //   • Maintenance    → data-driven maintenance.use (staff.js requirePermission)
  //   • Marketing/Refdata → isManagerOrAdmin (marketingEvents/referenceData routes)
  //   • Deep Cleanse   → isAdminProfile (cleanup.js requireAdmin) — gated on its page
  const canMaintenance        = canDo('maintenance', 'use');
  const canStaffTargets       = canManageTargets(staff?.position);   // CEO / COO / HR Manager / Tech Manager
  const showAdminSection      = canManageStaff || canManageDistribution || canDeleteLeads || canMaintenance || canStaffTargets;

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  // Create Sales/Lead — opens the LQ intake app (VITE_LQ_BASE_URL) in a new tab.
  // It's an action, not a route, so it has no active state.
  function handleCreateSales() {
    const base = (import.meta.env.VITE_LQ_BASE_URL || '').replace(/\/+$/, '');
    if (!base) { alert('LQ app URL not configured (VITE_LQ_BASE_URL).'); return; }
    window.open(`${base}/?src=console`, '_blank', 'noopener');
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
          onClick={() => { clearTrail(); navigate('/dashboard'); }}
        >
          <FiGrid size={16} /> {t('sidebar.dashboard', language)}
        </button>

        <button
          className={`nav-item ${isActive('/leads') ? 'active' : ''}`}
          onClick={() => navigate('/leads')}
        >
          <FiUsers size={16} /> {t('sidebar.leads', language)}
        </button>

        {canCreateSales && (
          <button
            className="nav-item"
            onClick={handleCreateSales}
            title={language === 'vi' ? 'Mở ứng dụng nhập liệu để tạo Sales/Lead mới' : 'Open the intake app to create a new Sales/Lead'}
          >
            <FiUserPlus size={16} /> {language === 'vi' ? 'Tạo Sales/Lead' : 'Create Sales/Lead'}
          </button>
        )}

        <button
          className={`nav-item ${isActive('/client-followup') ? 'active' : ''}`}
          onClick={() => navigate('/client-followup')}
        >
          <FiBell size={16} /> {language === 'vi' ? 'Theo dõi Sales' : 'Sales Followup'}
        </button>

        <button
          className={`nav-item ${isActive('/notes/drafts') ? 'active' : ''}`}
          onClick={() => navigate('/notes/drafts')}
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}
        >
          <span style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <FiClock size={16} /> {language === 'vi' ? 'Ghi chú đang chờ' : 'Pending Notes'}
          </span>
          {pendingDraftCount > 0 && (
            <span style={{ background:'#f59e0b', color:'#fff', borderRadius:'999px', minWidth:'18px', height:'18px', padding:'0 5px', fontSize:'0.6875rem', fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
              {pendingDraftCount}
            </span>
          )}
        </button>

        {isManagerOrAdmin(staff?.position) && (
        <button
          className={`nav-item ${isActive('/marketing-events') ? 'active' : ''}`}
          onClick={() => navigate('/marketing-events')}
        >
          <FiCalendar size={16} /> {language === 'vi' ? 'Sự kiện Marketing' : 'Marketing Events'}
        </button>
      )}

        <button
          className={`nav-item ${isActive('/events') ? 'active' : ''}`}
          onClick={() => navigate('/events')}
        >
          <FiCheckSquare size={16} /> {language === 'vi' ? 'Điểm danh sự kiện' : 'Event Check-in'}
        </button>

        <span className="nav-section">{t('sidebar.section.report', language)}</span>

        {canViewReports && (
          <button
            className={`nav-item ${isActive('/reports/activity') ? 'active' : ''}`}
            onClick={() => navigate('/reports/activity')}
          >
            <FiPhoneCall size={16} /> {language === 'vi' ? 'Báo cáo hoạt động' : 'Activity Report'}
          </button>
        )}

        <button
          className={`nav-item ${isActive('/reports/weekly') ? 'active' : ''}`}
          onClick={() => navigate('/reports/weekly')}
        >
          <FiFileText size={16} /> {language === 'vi' ? 'Báo cáo tuần (tĩnh)' : 'Weekly Report (static)'}
        </button>

        {canViewReports && (
          <button
            className={`nav-item ${isActive('/reports/monthly') ? 'active' : ''}`}
            onClick={() => navigate('/reports/monthly')}
          >
            <FiFileText size={16} /> {language === 'vi' ? 'Báo cáo tháng' : 'Monthly Report'}
          </button>
        )}

        {canViewEventAnalytics(staff?.position) && (
          <button
            className={`nav-item ${isActive('/reports/event') ? 'active' : ''}`}
            onClick={() => navigate('/reports/event')}
          >
            <FiBarChart2 size={16} /> {language === 'vi' ? 'Báo cáo sự kiện' : 'Event Report'}
          </button>
        )}

        {isManagerOrAdmin(staff?.position) && (
        <button
          className={`nav-item ${isActive('/reference-data') ? 'active' : ''}`}
          onClick={() => navigate('/reference-data')}
        >
          <FiShare2 size={16} /> {language === 'vi' ? 'Dữ liệu tham chiếu' : 'Reference Data'}
        </button>
      )}

        {/* Layout variants — every user manages their own */}
        <button
          className={`nav-item ${isActive('/settings/columns') ? 'active' : ''}`}
          onClick={() => navigate('/settings/columns')}
        >
          <FiLayout size={16} /> {t('sidebar.columnSettings', language)}
        </button>

        {showAdminSection && (
          <>
            <span className="nav-section">{t('sidebar.section.admin', language)}</span>
            {canManageStaff && (
              <button
                className={`nav-item ${isActive('/staff') ? 'active' : ''}`}
                onClick={() => navigate('/staff')}
              >
                <FiUserCheck size={16} /> {t('sidebar.staff', language)}
              </button>
            )}
            {canManageDistribution && (
              <button
                className={`nav-item ${isActive('/distribution') ? 'active' : ''}`}
                onClick={() => navigate('/distribution')}
              >
                <FiShuffle size={16} /> {language === 'vi' ? 'Phân bổ Lead' : 'Lead Distribution'}
              </button>
            )}
            {canDeleteLeads && (
              <button
                className={`nav-item ${isActive('/admin/cleanup') ? 'active' : ''}`}
                onClick={() => navigate('/admin/cleanup')}
              >
                <FiTrash2 size={16} /> {language === 'vi' ? 'Dọn dữ liệu' : 'Deep Cleanse'}
              </button>
            )}
            {canMaintenance && (
              <button
                className={`nav-item ${isActive('/admin/maintenance') ? 'active' : ''}`}
                onClick={() => navigate('/admin/maintenance')}
              >
                <FiTool size={16} /> {language === 'vi' ? 'Bảo trì' : 'Maintenance'}
              </button>
            )}
            {canStaffTargets && (
              <button
                className={`nav-item ${isActive('/admin/staff-targets') ? 'active' : ''}`}
                onClick={() => navigate('/admin/staff-targets')}
              >
                <FiTarget size={16} /> {language === 'vi' ? 'Chỉ tiêu nhân viên' : 'Staff Targets'}
              </button>
            )}
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
