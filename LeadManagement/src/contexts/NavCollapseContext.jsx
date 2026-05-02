// src/contexts/NavCollapseContext.jsx
// -----------------------------------------------------------------------------
// Tracks whether the left-hand navigation sidebar is collapsed.
// Persists across the current browser session via sessionStorage.
//
// Semantics:
//   - Desktop: collapsed=false means sidebar visible. Collapsed=true means
//              sidebar hidden, FloatingExpandButton visible to bring it back.
//   - Mobile:  collapsed=true is the default. Setting collapsed=false slides
//              the sidebar in as a drawer overlay.
// -----------------------------------------------------------------------------

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY       = 'studylink.navCollapsed';
const MOBILE_BREAKPOINT = 768;

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

const NavCollapseContext = createContext({
  collapsed:    false,
  toggle:       () => {},
  setCollapsed: () => {},
});

export function NavCollapseProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved === 'true')  return true;
      if (saved === 'false') return false;
      // No saved value yet — default to collapsed on mobile, expanded on desktop.
      return isMobileViewport();
    } catch {
      return false;
    }
  });

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
