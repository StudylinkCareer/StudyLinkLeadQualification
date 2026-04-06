// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [staff, setStaff]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authAPI.checkSession()
      .then(data => {
        if (data.authenticated) setStaff(data.staff);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function login(staffData) {
    setStaff(staffData);
  }

  async function logout() {
    await authAPI.logout().catch(() => {});
    setStaff(null);
  }

  const isAdmin    = staff?.role === 'Admin';
  const isManager  = ['Admin', 'Manager'].includes(staff?.role);
  const isDirector = ['Admin', 'Manager', 'Director'].includes(staff?.role);

  return (
    <AuthContext.Provider value={{ staff, loading, login, logout, isAdmin, isManager, isDirector }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
