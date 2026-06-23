import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LookupProvider } from './contexts/LookupContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import OTPVerification from './pages/OTPVerification';
import Dashboard from './pages/Dashboard';
import DeskPage from './pages/DeskPage';
import BadgePage from './pages/BadgePage';
import ProfilePage from './pages/ProfilePage';

function App() {
  return (
    <AuthProvider>
      <LookupProvider>
        <div className="app">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/desk" element={<DeskPage />} />
            <Route path="/badge/:token" element={<BadgePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/verify" element={<OTPVerification />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </LookupProvider>
    </AuthProvider>
  );
}

export default App;
