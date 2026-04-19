// src/App.jsx
// -----------------------------------------------------------------------------
// CHANGES:
//   - Imports NavCollapseProvider and useNavCollapse
//   - Wraps route tree in <NavCollapseProvider>
//   - ProtectedLayout and AdminRoute now:
//       * apply 'nav-collapsed' class when collapsed
//       * render a floating expand button (top-left of content) when collapsed
//
// CHANGES (i18n Phase 1):
//   - Imports LanguageProvider from contexts/LanguageContext
//   - Wraps route tree in <LanguageProvider> (outer-most)
//     so every page has access to the current language and the t() helper.
// -----------------------------------------------------------------------------

import { Routes, Route, Navigate } from 'react-router-dom';
import { FiMenu } from 'react-icons/fi';
import { useAuth } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { NavCollapseProvider, useNavCollapse } from './contexts/NavCollapseContext';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Staff from './pages/Staff';
import ColumnLayoutSettings from './pages/ColumnLayoutSettings';

// Floating "expand" button shown only when the sidebar is collapsed.
// Sits top-left of the content area so the user can bring the nav back.
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

// Shared shell used by both protected and admin routes.
// Handles the collapsed class + floating expand button so the logic lives in
// exactly one place.
function ConsoleShell({ children }) {
  const { collapsed } = useNavCollapse();
  return (
    <div className={`app-layout ${collapsed ? 'nav-collapsed' : ''}`}>
      <Sidebar />
      <FloatingExpandButton />
      <main className="main-content">{children}</main>
    </div>
  );
}

function ProtectedLayout({ children }) {
  const { staff, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#6b7280' }}>Loading...</div>;
  if (!staff)  return <Navigate to="/login" replace />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

function AdminRoute({ children }) {
  const { staff, isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!staff)  return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

export default function App() {
  return (
    <LanguageProvider>
      <NavCollapseProvider>
        <Routes>
          <Route path="/login"                element={<Login />} />
          <Route path="/dashboard"            element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
          <Route path="/leads"                element={<ProtectedLayout><Leads /></ProtectedLayout>} />
          <Route path="/leads/:id"            element={<ProtectedLayout><LeadDetail /></ProtectedLayout>} />
          <Route path="/staff"                element={<ProtectedLayout><Staff /></ProtectedLayout>} />
          <Route path="/settings/columns"     element={<AdminRoute><ColumnLayoutSettings /></AdminRoute>} />
          <Route path="*"                     element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </NavCollapseProvider>
    </LanguageProvider>
  );
}
