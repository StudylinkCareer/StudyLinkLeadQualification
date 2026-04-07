// src/services/api.js

import { objectToCamelCase } from '../utils/caseConvert';

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');

  // Universal camelCase conversion — applies to all API responses
  if (Array.isArray(data.data)) {
    data.data = data.data.map(objectToCamelCase);
  } else if (data.data && typeof data.data === 'object') {
    data.data = objectToCamelCase(data.data);
  }

  return data;
}

// ── Auth ──
export const authAPI = {
  login:        (email, password) => request('POST', '/api/staff/login', { email, password }),
  logout:       ()                => request('POST', '/api/staff/logout'),
  checkSession: ()                => request('GET',  '/api/staff/session'),
};

// ── Staff ──
export const staffAPI = {
  list:           ()                         => request('GET',  '/api/staff'),
  listActive:     ()                         => request('GET',  '/api/staff/active'),
  create:         (data)                     => request('POST', '/api/staff', data),
  update:         (id, data)                 => request('PUT',  `/api/staff/${id}`, data),
  resetPassword:  (id, password)             => request('PUT',  `/api/staff/${id}/password`, { password }),
  deactivate:     (id)                       => request('PUT',  `/api/staff/${id}/deactivate`),
  assign:         (studentId, data)          => request('PUT',  `/api/staff/assign/${studentId}`, data),
  massAssign:     (studentIds, field, value) => request('PUT',  '/api/staff/mass-assign', { studentIds, field, value }),
};

// ── Students ──
export const studentAPI = {
  search: (q)        => request('GET', `/api/staff/students/search?q=${encodeURIComponent(q || '')}`),
  get:    (id)       => request('GET', `/api/staff/students/${id}`),
  update: (id, data) => request('PUT', `/api/staff/students/${id}`, data),
};

// ── Notes ──
export const notesAPI = {
  list:   (studentId)                    => request('GET',    `/api/notes/${studentId}`),
  add:    (studentId, noteType, content) => request('POST',   `/api/notes/${studentId}`, { noteType, content }),
  delete: (id)                           => request('DELETE', `/api/notes/${id}`),
};

// ── Column Config ──
export const columnConfigAPI = {
  get:  (screen)         => request('GET', `/api/staff/column-config/${screen}`),
  save: (screen, config) => request('PUT', `/api/staff/column-config/${screen}`, { config }),
};