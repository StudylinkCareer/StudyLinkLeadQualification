// src/App.jsx
// -----------------------------------------------------------------------------
// CHANGES (mobile banner nav):
//   - Replaced <MobileBottomNav /> with <MobilePageNav /> (top-right banner).
//   - Kept <FloatingExpandButton /> — used on DESKTOP when sidebar is
//     collapsed. Hidden on mobile via CSS (banner Menu button replaces it).
//   - Kept <SidebarBackdrop /> — dims content when the mobile drawer is open
//     and tap-to-close.
// -----------------------------------------------------------------------------

import { Routes, Route, Navigate } from 'react-router-dom';
import { FiMenu } from 'react-icons/fi';
import { useAuth } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { NavCollapseProvider, useNavCollapse } from './contexts/NavCollapseContext';
import Sidebar from './components/Sidebar';
import MobilePageNav from './components/MobilePageNav';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Staff from './pages/Staff';
import ColumnLayoutSettings from './pages/ColumnLayoutSettings';

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
    <div className={`app-layout ${collapsed ? 'nav-collapsed' : ''}`}>
      <Sidebar />
      <SidebarBackdrop />
      <FloatingExpandButton />
      <MobilePageNav />
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
  if (!staff)   return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

export default function App() {
  return (
    <LanguageProvider>
      <NavCollapseProvider>
        <Routes>
          <Route path="/login"            element={<Login />} />
          <Route path="/dashboard"        element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
          <Route path="/leads"            element={<ProtectedLayout><Leads /></ProtectedLayout>} />
          <Route path="/leads/:id"        element={<ProtectedLayout><LeadDetail /></ProtectedLayout>} />
          <Route path="/staff"            element={<ProtectedLayout><Staff /></ProtectedLayout>} />
          <Route path="/settings/columns" element={<AdminRoute><ColumnLayoutSettings /></AdminRoute>} />
          <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </NavCollapseProvider>
    </LanguageProvider>
  );
}
