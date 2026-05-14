// client/src/contexts/LookupContext.jsx
//
// Loads the entire lookup catalog (GET /api/lookups) once after auth and
// exposes it to the rest of the LQ form via hooks. Backend caches the
// response for 5 min, so this hits the cache on subsequent loads.
//
// Why this exists (in the LQ app):
//   Previously, dropdown options lived in three separate places —
//     - hardcoded constants in `utils/formFields.js`
//     - Vietnamese labels in `utils/optionLabels.js`
//     - parallel arrays in `i18n/en.js` and `i18n/vi.js`
//   That drift caused bugs like the "English Summer Camp" / "English Summer
//   School" mismatch. This context replaces all three with a single source
//   of truth: the `lookup_values` table on the server, shared with LM.
//
// Usage in any form component:
//
//   import { useLookup } from '../../contexts/LookupContext';
//
//   const studyPlans = useLookup('study_plan');
//   // → [{ code: 'Study Abroad', labelVi: 'Du học dài hạn', meta: {...} }, ...]
//
//   <SelectInput
//     options={studyPlans.map(item => ({
//       value: item.code,
//       label: language === 'vi' ? (item.labelVi || item.code) : (item.labelEn || item.code),
//     }))}
//   />

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { lookupAPI } from '../services/api';

const LookupContext = createContext(null);

export function LookupProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [lookups, setLookups] = useState({});       // { study_plan: [...], country: [...], ... }
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Load (or clear) the catalog whenever auth state changes.
  const load = useCallback(async () => {
    if (!isAuthenticated) {
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
  }, [isAuthenticated]);

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

  // getSubcategoryItems(category, subcategory) → items filtered by subcategory.
  // Useful for things like ui_string sub-buckets or contact_medium grouped by idType.
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
    reload: load,
    getList,
    getItem,
    getSubcategoryItems,
  }), [lookups, loading, error, load, getList, getItem, getSubcategoryItems]);

  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
}

// ── Hooks ───────────────────────────────────────────────────────

// Full context (for pages that need loading / error / reload)
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
