import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LookupProvider } from './contexts/LookupContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import OTPVerification from './pages/OTPVerification';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <AuthProvider>
      <LookupProvider>
        <div className="app">
          <Routes>
            <Route path="/" element={<Home />} />
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
