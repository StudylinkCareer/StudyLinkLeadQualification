// src/contexts/NavCollapseContext.jsx
// -----------------------------------------------------------------------------
// Context that tracks whether the left-hand Navigation sidebar is collapsed.
// State persists for the current browser session only (sessionStorage).
//
// Consumers:
//   - Sidebar.jsx                 — renders a collapse button, hides itself
//                                   when `collapsed === true`
//   - App.jsx (ProtectedLayout)   — applies `.nav-collapsed` class to the
//                                   layout wrapper and renders the floating
//                                   expand button
//
// Usage:
//   import { useNavCollapse } from '../contexts/NavCollapseContext';
//   const { collapsed, toggle } = useNavCollapse();
// -----------------------------------------------------------------------------

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'studylink.navCollapsed';

const NavCollapseContext = createContext({
  collapsed: false,
  toggle:    () => {},
  setCollapsed: () => {},
});

export function NavCollapseProvider({ children }) {
  // Initialise from sessionStorage (per-session persistence, not permanent).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Write-through to sessionStorage on every change.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch { /* ignore quota / disabled-storage errors */ }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed(c => !c), []);

  return (
    <NavCollapseContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </NavCollapseContext.Provider>
  );
}

export function useNavCollapse() {
  return useContext(NavCollapseContext);
}
