// src/App.jsx
// -----------------------------------------------------------------------------
// CHANGES (mobile banner nav):
//   - Replaced <MobileBottomNav /> with <MobilePageNav /> (top-right banner).
//   - Kept <FloatingExpandButton /> — used on DESKTOP when sidebar is
//     collapsed. Hidden on mobile via CSS (banner Menu button replaces it).
//   - Kept <SidebarBackdrop /> — dims content when the mobile drawer is open
//     and tap-to-close.
//
// CHANGES (table-driven RBAC):
//   - Added <PermissionsProvider> inside <AuthProvider>'s tree (here it's
//     inside LanguageProvider / NavCollapseProvider, but the AuthProvider
//     wrapping happens further up in main.jsx — see note below).
//   - AdminRoute no longer reads isAdmin from useAuth(). It reads
//     canDo('column_config', 'manage') from usePermissions(). The only route
//     using AdminRoute today is /settings/columns; if you add more admin
//     routes that need different permissions, wrap them in their own gate.
// -----------------------------------------------------------------------------
//
// NOTE on provider order: if main.jsx already wraps <App /> in
// <AuthProvider>, then PermissionsProvider needs to live INSIDE that wrap
// (because it reads useAuth() to know when staff is logged in). The
// simplest place is here, inside App's tree.

import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { FiMenu } from 'react-icons/fi';
import { useAuth } from './contexts/AuthContext';
import { canViewEventAnalytics } from './utils/roleProfiles';
import { LanguageProvider } from './contexts/LanguageContext';
import { NavCollapseProvider, useNavCollapse } from './contexts/NavCollapseContext';
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext';
import { LookupProvider } from './contexts/LookupContext';
import { NavTrailProvider } from './contexts/NavTrailContext';
import { NoteDraftsProvider } from './contexts/NoteDraftsContext';
import Sidebar from './components/Sidebar';
import MobilePageNav from './components/MobilePageNav';
import TrailBreadcrumb from './components/TrailBreadcrumb';
import SessionExpiredModal from './components/SessionExpiredModal';
import DevBadge from './components/DevBadge';
import PendingDraftsBanner from './components/PendingDraftsBanner';
import Login from './pages/Login';
import PendingDrafts from './pages/PendingDrafts';
import NoteDraftsDashboard from './pages/NoteDraftsDashboard';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadsList from './pages/LeadsList';
import LeadDetail from './pages/LeadDetail';
import Lead from './pages/Lead';
import Staff from './pages/Staff';
import ColumnLayoutSettings from './pages/ColumnLayoutSettings';
import MarketingEvents from './pages/MarketingEvents';
import ActivityReport from './pages/ActivityReport';
import ClientFollowup from './pages/ClientFollowup';
import WeeklyReport from './pages/WeeklyReport';
import MonthlyReport from './pages/MonthlyReport';
import IndividualReport from './pages/IndividualReport';
import GroupReport from './pages/GroupReport';
import EventReport from './pages/EventReport';
import ReferralSources from './pages/ReferralSources';
import ReferenceData from './pages/ReferenceData';
import LeadDistribution from './pages/LeadDistribution';
import DataCleanup from './pages/DataCleanup';
import AdminMaintenance from './pages/AdminMaintenance';
import StaffTargets from './pages/StaffTargets';

// Event Management — lazy-loaded section so it stays out of the main bundle.
const EventConsole = lazy(() => import('./pages/EventConsole'));

// Floating "expand" button shown when the sidebar is collapsed on DESKTOP only.
// Hidden on mobile via CSS — the banner Menu button is the mobile equivalent.
function FloatingExpandButton() {
  const { collapsed, toggle } = useNavCollapse();
  if (!collapsed) return null;
  return (
    <button
      className="nav-expand-btn"
      onClick={toggle}
      title="Expand navigation"
      aria-label="Expand navigation"
    >
      <FiMenu size={18} />
    </button>
  );
}

// Backdrop behind the open drawer. Visible on mobile only via CSS.
// Tapping it closes the drawer.
function SidebarBackdrop() {
  const { collapsed, setCollapsed } = useNavCollapse();
  if (collapsed) return null;
  return (
    <div
      className="sidebar-backdrop"
      onClick={() => setCollapsed(true)}
      aria-hidden="true"
    />
  );
}

// Shared shell used by both protected and admin routes.
function ConsoleShell({ children }) {
  const { collapsed } = useNavCollapse();
  return (
    <NoteDraftsProvider>
      <div className={`app-layout ${collapsed ? 'nav-collapsed' : ''}`}>
        <Sidebar />
        <SidebarBackdrop />
        <FloatingExpandButton />
        <MobilePageNav />
        <main className="main-content">
          <TrailBreadcrumb />
          <PendingDraftsBanner />
          {children}
        </main>
      </div>
    </NoteDraftsProvider>
  );
}

function ProtectedLayout({ children }) {
  const { staff, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#6b7280' }}>Loading...</div>;
  if (!staff)  return <Navigate to="/login" replace />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

// Admin route: gated on the column_config.manage permission rather than the
// old isAdmin boolean. Permissions are fetched once /api/staff/permissions
// returns — we wait for that to finish before deciding.
function AdminRoute({ children }) {
  const { staff, loading: authLoading } = useAuth();
  const { canDo, loading: permsLoading } = usePermissions();

  if (authLoading || permsLoading) return null;
  if (!staff)                       return <Navigate to="/login" replace />;
  if (!canDo('column_config', 'manage')) return <Navigate to="/dashboard" replace />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

// Event Report route: gated on the same profile allowlist (EVENT_REPORT_PROFILES)
// as the Event Console -> Reports tab, not the reports.view RBAC permission —
// keeps continuity with who already sees event-level reports today.
function EventReportRoute({ children }) {
  const { staff, loading } = useAuth();
  if (loading) return null;
  if (!staff) return <Navigate to="/login" replace />;
  if (!canViewEventAnalytics(staff.position)) return <Navigate to="/dashboard" replace />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

export default function App() {
  return (
    <LanguageProvider>
      <NavCollapseProvider>
        <PermissionsProvider>
          <LookupProvider>
            <NavTrailProvider>
              <Routes>
              <Route path="/login"            element={<Login />} />
              <Route path="/dashboard"        element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
              <Route path="/leads"            element={<ProtectedLayout><Leads /></ProtectedLayout>} />
              <Route path="/leads/:id"        element={<ProtectedLayout><LeadDetail /></ProtectedLayout>} />
              <Route path="/students/:id"     element={<ProtectedLayout><LeadDetail /></ProtectedLayout>} />
              <Route path="/lead/:id"         element={<ProtectedLayout><LeadDetail /></ProtectedLayout>} />
              <Route path="/staff"            element={<ProtectedLayout><Staff /></ProtectedLayout>} />
              <Route path="/notes/drafts"     element={<ProtectedLayout><PendingDrafts /></ProtectedLayout>} />
              <Route path="/admin/note-drafts" element={<ProtectedLayout><NoteDraftsDashboard /></ProtectedLayout>} />
              <Route path="/distribution"     element={<ProtectedLayout><LeadDistribution /></ProtectedLayout>} />
              <Route path="/events"           element={<ProtectedLayout><Suspense fallback={<div style={{ padding:24, color:'#6b7280' }}>Loading…</div>}><EventConsole /></Suspense></ProtectedLayout>} />
              <Route path="/settings/columns" element={<ProtectedLayout><ColumnLayoutSettings /></ProtectedLayout>} />
              <Route path="/marketing-events" element={<ProtectedLayout><MarketingEvents/></ProtectedLayout>} />
              <Route path="/reports/activity" element={<ProtectedLayout><ActivityReport /></ProtectedLayout>} />
              <Route path="/client-followup" element={<ProtectedLayout><ClientFollowup /></ProtectedLayout>} />
              <Route path="/reports/weekly"   element={<ProtectedLayout><WeeklyReport /></ProtectedLayout>} />
              <Route path="/reports/monthly"  element={<ProtectedLayout><MonthlyReport /></ProtectedLayout>} />
              {/* New Individual/Group Report (2026-08 merge) — additive, old
                  routes above stay untouched until cutover is verified. */}
              <Route path="/reports/individual" element={<ProtectedLayout><IndividualReport /></ProtectedLayout>} />
              <Route path="/reports/group"      element={<ProtectedLayout><GroupReport /></ProtectedLayout>} />
              <Route path="/reports/event"    element={<EventReportRoute><EventReport /></EventReportRoute>} />
              <Route path="/reference-data" element={<ProtectedLayout><ReferenceData /></ProtectedLayout>} />
              <Route path="/admin/cleanup"  element={<ProtectedLayout><DataCleanup /></ProtectedLayout>} />
              <Route path="/admin/maintenance" element={<ProtectedLayout><AdminMaintenance /></ProtectedLayout>} />
              <Route path="/admin/staff-targets" element={<ProtectedLayout><StaffTargets /></ProtectedLayout>} />
              <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
            </Routes>
              <SessionExpiredModal />
              <DevBadge />
            </NavTrailProvider>
          </LookupProvider>
        </PermissionsProvider>
      </NavCollapseProvider>
    </LanguageProvider>
  );
}
