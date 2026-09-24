import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LookupProvider } from './contexts/LookupContext';
import Login from './pages/Login';
import DeskPage from './pages/DeskPage';
import BadgePage from './pages/BadgePage';
import ProfilePage from './pages/ProfilePage';
import WizardApp from './wizard/WizardApp';

// Old entry points keep working: event-QR links still point at "/" with
// ?sol=&eid=&ename=&counsellor=, so the query string travels to the wizard.
function ToWizard({ to = '/app' }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

function App() {
  return (
    <AuthProvider>
      <LookupProvider>
        <div className="app">
          <Routes>
            <Route path="/" element={<ToWizard />} />
            <Route path="/app/*" element={<WizardApp />} />
            <Route path="/login" element={<Login />} />
            <Route path="/desk" element={<DeskPage />} />
            <Route path="/badge/:token" element={<BadgePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* retired screens — old bookmarks land in the wizard */}
            <Route path="/dashboard" element={<ToWizard to="/app/hub" />} />
            <Route path="/verify" element={<ToWizard />} />
            <Route path="*" element={<ToWizard />} />
          </Routes>
        </div>
      </LookupProvider>
    </AuthProvider>
  );
}

export default App;
