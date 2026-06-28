import { createContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [studentId, setUniqueId] = useState('');
  const [isCounselor, setIsCounselor] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const data = await authAPI.checkSession();
      if (data.authenticated) {
        setIsAuthenticated(true);
        // Strip temp QR-login emails so the rest of the app sees blank
        const safeEmail = (data.email && data.email.includes('@studylink.temp'))
          ? '' : (data.email || '');
        setEmail(safeEmail);
        setUniqueId(data.studentId || '');
        setIsCounselor(data.isCounselor || false);
      } else {
        setIsAuthenticated(false);
        setEmail('');
        setUniqueId('');
        setIsCounselor(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = (userEmail, id, counselorFlag = false) => {
    setIsAuthenticated(true);
    setEmail(userEmail);
    setUniqueId(id || '');
    setIsCounselor(counselorFlag);
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch { /* ignore */ }
    setIsAuthenticated(false);
    setEmail('');
    setUniqueId('');
    setIsCounselor(false);
  };

  const setStudentId = (id) => setUniqueId(id);

  return (
    <AuthContext.Provider value={{
      isAuthenticated, email, studentId, isCounselor, loading,
      login, logout, setStudentId, checkSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
