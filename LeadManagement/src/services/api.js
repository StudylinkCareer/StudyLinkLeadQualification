// src/services/api.js

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
  return data;
}

// ── Auth ──
export const authAPI = {
  login:        (email, password) => request('POST', '/staff/login', { email, password }),
  logout:       ()                => request('POST', '/staff/logout'),
  checkSession: ()                => request('GET',  '/staff/session'),
};

// ── Staff ──
export const staffAPI = {
  list:           ()                         => request('GET',  '/staff'),
  listActive:     ()                         => request('GET',  '/staff/active'),
  create:         (data)                     => request('POST', '/staff', data),
  update:         (id, data)                 => request('PUT',  `/staff/${id}`, data),
  resetPassword:  (id, password)             => request('PUT',  `/staff/${id}/password`, { password }),
  deactivate:     (id)                       => request('PUT',  `/staff/${id}/deactivate`),
  assign:         (studentId, data)          => request('PUT',  `/staff/assign/${studentId}`, data),
  massAssign:     (studentIds, field, value) => request('PUT',  '/staff/mass-assign', { studentIds, field, value }),
};

// ── Students ──
export const studentAPI = {
  search: (q) => request('GET', `/students/search?q=${encodeURIComponent(q || '')}`),
  get:    (id) => request('GET', `/students/${id}`),
  update: (id, data) => request('PUT', `/students/${id}`, data),
};

// ── Notes ──
export const notesAPI = {
  list:   (studentId)                    => request('GET',    `/notes/${studentId}`),
  add:    (studentId, noteType