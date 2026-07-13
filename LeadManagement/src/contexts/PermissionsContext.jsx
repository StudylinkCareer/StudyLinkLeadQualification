// LeadManagement/src/contexts/PermissionsContext.jsx
//
// Single source of truth for what the current user is allowed to do.
// Fetches /api/staff/permissions once after login and exposes helpers.
// No component should hardcode role names like 'Counselor' / 'Manager' /
// 'Admin' / 'Director' for permission purposes — all checks go through
// this hook. The DB (role_permissions + role_field_permissions) is the
// source of truth.
//
// SHAPE-AGNOSTIC: the normalize() function handles two likely server-side
// response shapes so the rest of the app doesn't care:
//
//   Shape A (nested objects):
//     {
//       role: 'Counselor',
//       resources: { leads: { view_list, view_detail, edit, ... }, notes: {...} },
//       fields:    { leads: { fullName: { list, detail }, ... } }
//     }
//
//   Shape B (flat arrays of rows):
//     {
//       role: 'Counselor',
//       resourcePermissions: [{ resource, operation, scope }, ...],
//       fieldPermissions:    [{ fieldName, listPermission, detailPermission }, ...]
//     }
//
// If neither shape matches, the context logs the raw response (look in
// browser DevTools console for "[PermissionsContext] raw permissions
// response:") so we can adjust normalize() once.

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { staffAPI } from '../services/api';

const PermissionsContext = createContext(null);

// ── Normalize the raw API response into {role, resources, fields} ────
function normalize(raw) {
  if (!raw || typeof raw !== 'object') {
    return { role: null, resources: {}, fields: {} };
  }

  const role = raw.role || null;

  // ── Resources ──
  let resources = {};
  // API may return this key as either `resources` (plural) or `resource`
  // (singular) depending on backend version. Accept both.
  const rawResources = raw.resources || raw.resource;
  if (rawResources && typeof rawResources === 'object' && !Array.isArray(rawResources)) {
    // Shape A — nested object
    resources = rawResources;
  } else if (Array.isArray(raw.resourcePermissions)) {
    // Shape B — flat array of {resource, operation, scope}
    for (const row of raw.resourcePermissions) {
      if (!row?.resource || !row?.operation) continue;
      if (!resources[row.resource]) resources[row.resource] = {};
      resources[row.resource][row.operation] = row.scope || 'none';
    }
  } else if (Array.isArray(raw.resources)) {
    // Fallback — array shape under `resources` key
    for (const row of raw.resources) {
      if (!row?.resource || !row?.operation) continue;
      if (!resources[row.resource]) resources[row.resource] = {};
      resources[row.resource][row.operation] = row.scope || 'none';
    }
  }

  // ── Fields ──
  let fields = {};
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    // Shape A — nested object, e.g. { leads: { fullName: { list, detail } } }
    fields = raw.fields;
  } else if (Array.isArray(raw.fieldPermissions)) {
    // Shape B — flat array. Assume all rows are for resource 'leads' unless
    // a row carries an explicit `resource` field.
    const out = {};
    for (const row of raw.fieldPermissions) {
      const fieldName = row.fieldName || row.field || row.field_name;
      if (!fieldName) continue;
      const resource = row.resource || 'leads';
      if (!out[resource]) out[resource] = {};
      out[resource][fieldName] = {
        list:   row.listPermission   || row.list   || row.list_permission   || 'view',
        detail: row.detailPermission || row.detail || row.detail_permission || 'edit',
      };
    }
    fields = out;
  }

  return { role, resources, fields };
}

export function PermissionsProvider({ children }) {
  const { staff } = useAuth();
  const [perms, setPerms]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchPerms = useCallback(async () => {
    if (!staff?.id) {
      setPerms(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await staffAPI.getPermissions();
      // Debug log so we can verify the shape on first deploy. Remove or
      // wrap in import.meta.env.DEV once the shape is confirmed.
      // eslint-disable-next-line no-console
      console.log('[PermissionsContext] raw permissions response:', res.data);
      setPerms(normalize(res.data));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PermissionsContext] fetch failed:', e);
      setError(e.message);
      setPerms(null);
    } finally {
      setLoading(false);
    }
  }, [staff?.id]);

  useEffect(() => { fetchPerms(); }, [fetchPerms]);

  // ── Helpers ────────────────────────────────────────────────
  // All helpers fail-safe (return 'none' / false) while loading.

  const scope = useCallback((resource, operation) => {
    return perms?.resources?.[resource]?.[operation] || 'none';
  }, [perms]);

  // canDo: true if scope grants the operation at all ('all', 'own', or 'team').
  // For ownership-aware checks ('own'/'team' writes) use canDoOnLead.
  const canDo = useCallback((resource, operation) => {
    const s = scope(resource, operation);
    return s === 'all' || s === 'own' || s === 'team';
  }, [scope]);

  // canDoOnLead: ownership-aware. 'all' always passes; 'team' is read-all
  // (view passes) + edit team-only (writes use the ownership check, same as
  // 'own'); 'own' passes only if the lead is assigned to the current user.
  const canDoOnLead = useCallback((resource, operation, lead) => {
    const s = scope(resource, operation);
    if (s === 'all')  return true;
    if (s === 'none') return false;
    if (s === 'team' && (operation === 'view_detail' || operation === 'view_list')) return true;
    if (s === 'own' || s === 'team') {
      if (!lead || !staff?.fullName) return false;
      // Normalize: trim whitespace and compare case-insensitively. This avoids
      // false negatives when DB values have trailing spaces or different casing
      // than the staff record (e.g. "TestCounselor" vs "testcounselor ").
      const me = (staff.fullName || '').trim().toLowerCase();
      const norm = v => (v || '').trim().toLowerCase();
      const matches = (
        norm(lead.counselor)       === me ||
        norm(lead.seniorCounselor) === me ||
        norm(lead.presales)        === me ||
        norm(lead.marketingStaff)  === me
      );
      // One-time log per lead to help diagnose data mismatches. Remove after verified.
      if (!matches && typeof window !== 'undefined' && !window.__perm_logged?.[lead.studentId]) {
        window.__perm_logged = window.__perm_logged || {};
        window.__perm_logged[lead.studentId] = true;
        console.log('[canDoOnLead] OWN check failed:', {
          staff:    staff.fullName,
          counselor:       lead.counselor,
          seniorCounselor: lead.seniorCounselor,
          presales:        lead.presales,
          marketingStaff:  lead.marketingStaff,
          leadId: lead.studentId,
        });
      }
      return matches;
    }
    return false;
  }, [scope, staff?.fullName]);

  // Field permissions — list vs detail context.
  // Defaults: 'view' in list, 'edit' in detail (matches the backend default
  // for unknown fields). 'none' means the field shouldn't render at all.
  const fieldList = useCallback((field) => {
    return perms?.fields?.leads?.[field]?.list || 'view';
  }, [perms]);

  const fieldDetail = useCallback((field) => {
    return perms?.fields?.leads?.[field]?.detail || 'edit';
  }, [perms]);

  const canEditField = useCallback((field) => {
    return fieldDetail(field) === 'edit';
  }, [fieldDetail]);

  const isFieldMasked = useCallback((field, context = 'detail') => {
    const p = context === 'list' ? fieldList(field) : fieldDetail(field);
    return p === 'view_masked';
  }, [fieldList, fieldDetail]);

  const value = useMemo(() => ({
    perms,
    loading,
    error,
    refresh: fetchPerms,
    role: perms?.role || null,
    scope,
    canDo,
    canDoOnLead,
    fieldList,
    fieldDetail,
    canEditField,
    isFieldMasked,
  }), [perms, loading, error, fetchPerms, scope, canDo, canDoOnLead, fieldList, fieldDetail, canEditField, isFieldMasked]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error('usePermissions must be used inside a <PermissionsProvider>');
  }
  return ctx;
}
