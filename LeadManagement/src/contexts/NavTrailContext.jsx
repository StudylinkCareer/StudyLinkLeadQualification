// src/contexts/NavTrailContext.jsx
//
// PURPOSE
//   Maintains a breadcrumb "trail" of pages visited within the LM Console.
//   Backs both:
//     - <TrailBreadcrumb /> (visible chips at top of page)
//     - <TrailBackButton /> (single-step back arrow)
//
// STORAGE
//   sessionStorage, key 'nav-trail'. Trail survives within-tab navigation
//   but resets on tab close. Cleared explicitly when the user clicks
//   "Dashboard" in the sidebar.
//
// SHAPE
//   Trail is an array of entries:
//     { label: string, path: string, state?: object }
//   The last entry in the array is the CURRENT page.
//
// HOOK API
//   push(entry)         — append an entry (or no-op if same path as top)
//   pop()               — remove top entry, navigate to new top
//   jumpTo(index)       — truncate trail to [0..index], navigate to that
//   clear()             — wipe trail
//   trail               — current array (read-only snapshot)
//
// CAP
//   Trail is capped at MAX_ENTRIES; oldest entries dropped on overflow.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const STORAGE_KEY = 'nav-trail';
const MAX_ENTRIES = 10;

const NavTrailContext = createContext(null);

function loadInitial() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(trail) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail));
  } catch {
    // sessionStorage can fail in private mode — silently ignore.
  }
}

export function NavTrailProvider({ children }) {
  const navigate    = useNavigate();
  const [trail, setTrail] = useState(loadInitial);

  // Sync to sessionStorage on every change.
  useEffect(() => { persist(trail); }, [trail]);

  // push — append entry, but skip duplicates of the current top
  // (so refreshing or re-mounting the same page doesn't grow the stack).
  // Also de-dupes by PATH only — label changes (e.g. filter context update)
  // overwrite the existing entry rather than stacking.
  const push = useCallback((entry) => {
    if (!entry || !entry.path) return;
    setTrail(prev => {
      const top = prev[prev.length - 1];
      if (top && top.path === entry.path) {
        // Same path — update label/state in place (no new entry).
        const next = prev.slice(0, -1);
        next.push({ ...top, ...entry });
        return next;
      }
      const next = [...prev, entry];
      // Cap the trail length.
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  // pop — remove top, navigate to new top. If we're already at depth 1,
  // do nothing (the back button should be disabled in that case anyway).
  const pop = useCallback(() => {
    setTrail(prev => {
      if (prev.length < 2) return prev;
      const next = prev.slice(0, -1);
      const target = next[next.length - 1];
      // Navigate AFTER state has been written (the next render will
      // have the new top in place).
      setTimeout(() => navigate(target.path, { state: target.state || null }), 0);
      return next;
    });
  }, [navigate]);

  // jumpTo — truncate to index+1, navigate to that entry. Used by clicking
  // an earlier breadcrumb chip.
  const jumpTo = useCallback((index) => {
    setTrail(prev => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice(0, index + 1);
      const target = next[next.length - 1];
      setTimeout(() => navigate(target.path, { state: target.state || null }), 0);
      return next;
    });
  }, [navigate]);

  const clear = useCallback(() => setTrail([]), []);

  return (
    <NavTrailContext.Provider value={{ trail, push, pop, jumpTo, clear }}>
      {children}
    </NavTrailContext.Provider>
  );
}

export function useNavTrail() {
  const ctx = useContext(NavTrailContext);
  if (!ctx) {
    throw new Error('useNavTrail() must be used within <NavTrailProvider>');
  }
  return ctx;
}
