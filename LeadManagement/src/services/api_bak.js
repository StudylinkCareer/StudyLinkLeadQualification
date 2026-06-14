// src/services/api.js
//
// CHANGES:
//   - Added staffAPI.me() helper for GET /api/staff/me, which returns the
//     current logged-in user's own staff record (including target,
//     targetSetBy, targetSetAt). Replaces the previous approach of calling
//     staffAPI.list() which is Admin-only and fails for Counselors.
//   - Added studentAPI.exportExcel() helper which calls
//     POST /api/staff/students/export-excel and triggers a browser download
//     of the resulting .xlsx file.
//   - Added staffAPI.getPermissions() for GET /api/staff/permissions,
//     returning the full RBAC permission set for the logged-in user's role.
//     Used by PermissionsContext on mount to drive all UI affordances.
//
// CHANGES (safe JSON parsing — fixes "Unexpected end of JSON input"):
//   - request() now reads the response body with res.text() first, then
//     attempts JSON.parse(). Previously it called res.json() directly, which
//     throws "Unexpected end of JSON input" when the server returns an empty
//     body (e.g. on a crash, timeout, or cold-start). The new approach gives
//     a readable error message instead of a cryptic alert.
//   - Note: lookupRequest() intentionally keeps res.json() since lookup
//     endpoints always return valid JSON and must not camelCase category names.

import { objectToCamelCase } from '../utils/caseConvert';

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // ── Safe response parsing ────────────────────────────────────
  // Read as text first so we never crash on an empty body or an HTML
  // error page (both of which cause res.json() to throw "Unexpected
  // end of JSON input").
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server error (${res.status}): response was not valid JSON`);
  }
  if (!data.success) throw new Error(data.error || 'Request failed');

  // Only convert actual objects to camelCase — strings, numbers, null,
  // and arrays of primitives pass through unchanged. Without this guard,
  // endpoints that return arrays of strings (e.g. GET /api/staff/roles
  // returns ['Admin','Counselor',...]) would have each string spread into
  // an object with numeric keys ({0:'C',1:'o',...}), causing React
  // "objects are not valid as a child" errors when rendered.
  const isPlainObject = v =>
    v != null && typeof v === 'object' && !Array.isArray(v);

  if (Array.isArray(data.data)) {
    data.data = data.data.map(item => isPlainObject(item) ? objectToCamelCase(item) : item);
  } else if (isPlainObject(data.data)) {
    data.data = objectToCamelCase(data.data);
  }

  return data;
}

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  login:        (email, password) => request('POST', '/api/staff/login', { email, password }),
  logout:       ()                => request('POST', '/api/staff/logout'),
  checkSession: ()                => request('GET',  '/api/staff/session'),
};

// ── Staff ─────────────────────────────────────────────────────
export const staffAPI = {
  list:            ()                         => request('GET',  '/api/staff'),
  listActive:      ()                         => request('GET',  '/api/staff/active'),
  listRoles:       ()                         => request('GET',  '/api/staff/roles'),
  listColumns:     ()                         => request('GET',  '/api/staff/columns'),
  me:              ()                         => request('GET',  '/api/staff/me'),
  getPermissions:  ()                         => request('GET',  '/api/staff/permissions'),
  create:          (data)                     => request('POST', '/api/staff', data),
  update:          (id, data)                 => request('PUT',  `/api/staff/${id}`, data),
  resetPassword:   (id, password)             => request('PUT',  `/api/staff/${id}/password`, { password }),
  deactivate:      (id)                       => request('PUT',  `/api/staff/${id}/deactivate`),
  assign:          (studentId, data)          => request('PUT',  `/api/staff/assign/${studentId}`, data),
  massAssign:      (studentIds, field, value) => request('PUT',  '/api/staff/mass-assign', { studentIds, field, value }),
  setTarget:       (id, target)               => request('PUT',  `/api/staff/${id}/target`, { target }),
};

// ── Layout variants ───────────────────────────────────────────
// Per-user named saved layouts for the Leads page (columns + filters + sort).
export const variantsAPI = {
  list:   (page = 'leads')      => request('GET',    `/api/staff/variants?page=${page}`),
  create: (data)                => request('POST',   '/api/staff/variants', data),
  update: (id, data)            => request('PUT',    `/api/staff/variants/${id}`, data),
  remove: (id)                  => request('DELETE', `/api/staff/variants/${id}`),
  delete: (id)                  => request('DELETE', `/api/staff/variants/${id}`),
};

// ── Students ──────────────────────────────────────────────────
export const studentAPI = {
  search:         (q)        => request('GET',  `/api/staff/students/search?q=${encodeURIComponent(q || '')}`),
  get:            (id)       => request('GET',  `/api/staff/students/${id}`),
  update:         (id, data) => request('PUT',  `/api/staff/students/${id}`, data),
  calculateRisk:  (id)       => request('POST', `/api/staff/students/${id}/calculate-risk`),
  calculateOcean: (id)       => request('POST', `/api/staff/students/${id}/calculate-ocean`),
  deleteRecords:  (ids)      => request('DELETE', '/api/staff/students', { uniqueIds: ids }),

  // ── Excel export ──────────────────────────────────────────
  // Returns the binary .xlsx file; we trigger a browser download here.
  exportExcel: async ({ startDate, endDate, dateField, fields, includeNotes }) => {
    const res = await fetch(`${BASE_URL}/api/staff/students/export-excel`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ startDate, endDate, dateField, fields, includeNotes }),
    });
    if (!res.ok) {
      let msg = `Export failed (${res.status})`;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* binary, no JSON */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const cd   = res.headers.get('Content-Disposition') || '';
    const m    = /filename="([^"]+)"/.exec(cd);
    a.download = m ? m[1] : `leads-export-${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { rowCount: Number(res.headers.get('X-Export-Row-Count') || 0) };
  },
};

// ── Notes ─────────────────────────────────────────────────────
export const notesAPI = {
  list:   (studentId)                    => request('GET',    `/api/notes/${studentId}`),

  // extra = { topic, followUpDate, reminderStatus, rescheduledDate, contactPlatform }
  add:    (studentId, noteType, content, extra = {}) =>
    request('POST', `/api/notes/${studentId}`, {
      noteType,
      content,
      topic:           extra.topic           || null,
      followUpDate:    extra.followUpDate    || null,
      reminderStatus:  extra.reminderStatus  || null,
      rescheduledDate: extra.rescheduledDate || null,
      contactPlatform: extra.contactPlatform || null,
    }),

  delete:            (id)             => request('DELETE', `/api/notes/${id}`),
  // Append a new addendum block to an existing note (existing content immutable).
  append:            (id, text, followUpDate) =>
    request('PATCH', `/api/notes/${id}/append`, { text, followUpDate }),
  getReminders:      ()             => request('GET',    '/api/notes/reminders'),
  getCommunications: ()             => request('GET',    '/api/notes/communications'),
  updateReminder:    (id, data)     => request('PATCH',  `/api/notes/${id}/reminder`, data),
};

// ── Reports ───────────────────────────────────────────────────
// Activity Report aggregates note activity across leads. Accepts optional
// query params (all ISO dates / strings):
//   dateFrom, dateTo, staffName, tier, status, noteType
export const reportsAPI = {
  notesActivity: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') qs.set(k, v);
    }
    const qsStr = qs.toString();
    return request('GET', `/api/reports/notes-activity${qsStr ? `?${qsStr}` : ''}`);
  },
  contractedStats: () => request('GET', '/api/reports/contracted-stats'),
};

// ── Column Config ─────────────────────────────────────────────
export const columnConfigAPI = {
  get:  (screen)         => request('GET', `/api/staff/column-config/${screen}`),
  save: (screen, config) => request('PUT', `/api/staff/column-config/${screen}`, { config }),
};

// ── Audit Log ─────────────────────────────────────────────────
export const auditAPI = {
  getForStudent: (studentId) => request('GET', `/api/staff/audit/${studentId}`),
  getRange:      (from, to)  => request('GET', `/api/staff/audit-range?from=${from}&to=${to}`),
};

// Lookups use their own request helper because the category names
// (`lead_status`, `ui_string`, etc.) are canonical identifiers and must NOT
// be camelCased. The shared `request()` helper above would corrupt them.
async function lookupRequest(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Lookups request failed');
  return data;
}

export const lookupAPI = {
  // Public reads — cached on the backend
  getAll:      ()         => lookupRequest('GET',  '/api/lookups'),
  getCategory: (category) => lookupRequest('GET',  `/api/lookups/${encodeURIComponent(category)}`),
  // Admin reads (includes inactive rows)
  adminGetAll: (includeInactive) =>
    lookupRequest('GET',  `/api/lookups/admin/all${includeInactive ? '?includeInactive=true' : ''}`),
  // Admin writes
  create:     (body)     => lookupRequest('POST',   '/api/lookups', body),
  update:     (id, body) => lookupRequest('PUT',    `/api/lookups/${id}`, body),
  remove:     (id)       => lookupRequest('DELETE', `/api/lookups/${id}`),
  reactivate: (id)       => lookupRequest('POST',   `/api/lookups/${id}/reactivate`),
  bustCache:  ()         => lookupRequest('POST',   '/api/lookups/cache/invalidate'),
};