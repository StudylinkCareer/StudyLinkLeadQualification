// LeadManagement/src/contexts/LookupContext.jsx
//
// Loads the entire lookup catalog (GET /api/lookups) once after auth and
// exposes it to the rest of the app via hooks. Backend already caches the
// response for 5 min, so this hits the cache on subsequent loads.
//
// Usage:
//
//   // Get all values for a category
//   const countries = useLookup('country');
//   // → [{ code: 'Australia', labelVi: 'Úc', meta: { aliases: [...] }}, ...]
//
//   // Look up a single entry by its canonical code
//   const country = useLookupItem('country', 'Australia');
//   // → { code: 'Australia', labelVi: 'Úc', ... }
//
//   // Full context — for admin/edit pages that need reload, loading, error
//   const { lookups, loading, error, reload } = useLookups();

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { lookupAPI } from '../services/api';

const LookupContext = createContext(null);

export function LookupProvider({ children }) {
  const { staff } = useAuth();
  console.log('[LookupProvider] render — staff:', staff);   // ← add this line
  const [lookups, setLookups] = useState({});       // { country: [...], study_plan: [...], ... }
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Load (or clear) the catalog whenever auth state changes.
  const load = useCallback(async () => {
    if (!staff) {
      setLookups({});
      setLoading(false);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      const res = await lookupAPI.getAll();
      setLookups(res.data || {});
      setError(null);
    } catch (e) {
      console.error('LookupContext: failed to load /api/lookups', e);
      setError(e.message || 'Failed to load lookups');
      setLookups({});
    } finally {
      setLoading(false);
    }
  }, [staff]);

  useEffect(() => { load(); }, [load]);

  // ── Public accessors ──────────────────────────────────────────
  // getList(category) → array of items for a category (empty if missing)
  const getList = useCallback(
    (category) => lookups[category] || [],
    [lookups]
  );

  // getItem(category, code) → single item or null
  const getItem = useCallback(
    (category, code) => {
      const list = lookups[category] || [];
      return list.find(item => item.code === code) || null;
    },
    [lookups]
  );

  // getSubcategoryItems(category, subcategory) → items filtered by subcategory
  // Useful for things like ocean_narrative_phrase where subcategory = trait.
  const getSubcategoryItems = useCallback(
    (category, subcategory) => {
      const list = lookups[category] || [];
      return list.filter(item => item.subcategory === subcategory);
    },
    [lookups]
  );

  const value = useMemo(() => ({
    lookups,
    loading,
    error,
    reload: load,                  // call after admin edits to refresh
    getList,
    getItem,
    getSubcategoryItems,
  }), [lookups, loading, error, load, getList, getItem, getSubcategoryItems]);

  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
}

// ── Hooks ───────────────────────────────────────────────────────

// Full context (for admin pages, error handling, etc.)
export function useLookups() {
  const ctx = useContext(LookupContext);
  if (!ctx) throw new Error('useLookups must be used within <LookupProvider>');
  return ctx;
}

// Convenience: just the list for one category
export function useLookup(category) {
  const { getList } = useLookups();
  return getList(category);
}

// Convenience: a single item by its canonical code
export function useLookupItem(category, code) {
  const { getItem } = useLookups();
  return getItem(category, code);
}
