// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Staff from './pages/Staff';
import ColumnLayoutSettings from './pages/ColumnLayoutSettings';

function ProtectedLayout({ children }) {
  const { staff, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#6b7280' }}>Loading...</div>;
  if (!staff)  return <Navigate to="/login" replace />;
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}

function AdminRoute({ children }) {
  const { staff, isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!staff)  return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"                element={<Login />} />
      <Route path="/dashboard"            element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
      <Route path="/leads"                element={<ProtectedLayout><Leads /></ProtectedLayout>} />
      <Route path="/leads/:id"            element={<ProtectedLayout><LeadDetail /></ProtectedLayout>} />
      <Route path="/staff"                element={<ProtectedLayout><Staff /></ProtectedLayout>} />
      <Route path="/settings/columns"     element={<AdminRoute><ColumnLayoutSettings /></AdminRoute>} />
      <Route path="*"                     element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
