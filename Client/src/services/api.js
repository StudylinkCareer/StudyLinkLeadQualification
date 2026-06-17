// client/src/services/api.js
// CHANGES: Added authAPI.checkLogin(), studentAPI.deactivateRecords(), studentAPI.calculateOcean with language

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request(method, endpoint, data) {
  const options = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (data) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: `Server returned invalid JSON (${res.status})` };
  }
  if (!res.ok) {
    const err = new Error(json.error || `${method} ${endpoint} failed (${res.status})`);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json;
}

const api = {
  get: (endpoint) => request('GET', endpoint),
  post: (endpoint, data) => request('POST', endpoint, data),
  put: (endpoint, data) => request('PUT', endpoint, data),
  delete: (endpoint) => request('DELETE', endpoint),
};

export const authAPI = {
  checkLogin: (email, phone) => api.post('/auth/check-login', { email, phone }),
  requestOTP: (email) => api.post('/auth/request-otp', { email }),
  verifyOTP: (email, code) => api.post('/auth/verify-otp', { email, code }),
  checkSession: () => api.get('/auth/session'),
  logout: () => api.post('/auth/logout'),
  qrLogin: (data) => api.post('/auth/qr-login', data),
};

export const studentAPI = {
  register: (data) => api.post('/students/register', data),
  addRegistration: (id, data) => api.post(`/students/${encodeURIComponent(id)}/add-registration`, data),
  getById: (id) => api.get(`/students/${encodeURIComponent(id)}`),
  getByEmail: (email) => api.get(`/students/by-email?email=${encodeURIComponent(email)}`),
  update: (id, data) => api.put(`/students/${encodeURIComponent(id)}`, data),
  checkDuplicate: (email, phone) => {
    const params = new URLSearchParams();
    if (email) params.set('email', email);
    if (phone) params.set('phone', phone);
    return api.get(`/students/check-duplicate?${params}`);
  },
  deactivateRecords: (uniqueIds) => api.post('/students/deactivate', { uniqueIds }),
  search: (query) => api.get(`/students/search?q=${encodeURIComponent(query || '')}`),
  calculateRisk: (id) => api.post(`/students/${encodeURIComponent(id)}/calculate-risk`),
  calculateOcean: (id, language = 'en') => api.post(`/students/${encodeURIComponent(id)}/calculate-ocean?language=${language}`),
  uploadPhotos: (id, photos) => api.post(`/students/${encodeURIComponent(id)}/upload-photos`, photos),
};

export const documentAPI = {
  list: (studentId) => api.get(`/documents/${encodeURIComponent(studentId)}`),
  upload: (studentId, data) => api.post(`/documents/${encodeURIComponent(studentId)}/upload`, data),
};

export const lookupAPI = {
  getAll:         ()        => api.get('/lookups'),
  getByCategory:  (cat)     => api.get(`/lookups/${cat}`),
};

export default api;
