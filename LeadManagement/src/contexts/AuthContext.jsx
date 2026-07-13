// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';
import { isAdminProfile, isManagerOrAdmin } from '../utils/roleProfiles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [staff, setStaff]     = useState(null);
  const [loading, setLoading] = useState(true);

  // Reconcile the UI identity with the ACTUAL server session. The session
  // cookie is per-browser, so signing in as a second user (another tab, a
  // test account) silently replaces it — leaving this tab showing a stale
  // user whose data no longer matches the session (e.g. an admin view that
  // renders all-zeros because the live session is really a scope='own' user).
  // We re-check on mount AND whenever the tab regains focus, and update the
  // UI to whoever the server now says we are (or clear it if logged out).
  const reconcileSession = useCallback(async () => {
    try {
      const data = await authAPI.checkSession();
      setStaff(prev => {
        if (!data.authenticated) return prev ? null : prev;
        // Only replace when the identity actually changed, so we don't churn
        // React state (which would needlessly re-fetch permissions) on every
        // focus event for the common no-change case.
        if (prev && prev.id === data.staff.id && prev.role === data.staff.role) return prev;
        return data.staff;
      });
    } catch { /* network blip — keep current identity */ }
  }, []);

  useEffect(() => {
    reconcileSession().finally(() => setLoading(false));
    const onFocus = () => reconcileSession();
    const onVisible = () => { if (document.visibilityState === 'visible') reconcileSession(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reconcileSession]);

  function login(staffData) {
    setStaff(staffData);
  }

  async function logout() {
    await authAPI.logout().catch(() => {});
    setStaff(null);
  }

  // Derive from the auth PROFILE (staff.position), not staff.role — see
  // utils/roleProfiles.js. isManager/isDirector both mean "manager-or-above"
  // now that Director is folded into the admin profiles.
  const isAdmin    = isAdminProfile(staff?.position);
  const isManager  = isManagerOrAdmin(staff?.position);
  const isDirector = isManagerOrAdmin(staff?.position);

  return (
    <AuthContext.Provider value={{ staff, loading, login, logout, isAdmin, isManager, isDirector }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
