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

  // ── Session expiry vs. bad login ─────────────────────────────
  // A 401 on an AUTHENTICATED request means the session timed out / the server
  // restarted — fire the global "session expired" modal and HALT without
  // throwing (so save handlers don't also pop a native alert). By returning a
  // promise that never settles, the caller simply stops here; the modal handles
  // the message + redirect, and it's discarded on the login reload.
  //
  // BUT a 401 from the LOGIN endpoint just means wrong email/password — it must
  // NOT show the "rolling out updates" modal. Let it fall through so the login
  // form displays the credentials error inline.
  const isLoginAttempt = path.endsWith('/login');
  if (res.status === 401 && !isLoginAttempt) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('session-expired'));
    }
    return new Promise(() => {});
  }

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
  massMovePhase:   (studentIds, toPhase, staffName, position) => request('PUT', '/api/staff/mass-move-phase', { studentIds, toPhase, staffName, position }),
  listStaleReminders: (status) => request('GET', `/api/staff/maintenance/stale-reminders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  closeReminders:     (reminderIds) => request('POST', '/api/staff/maintenance/close-reminders', { reminderIds }),
  changePhase:     (studentId, data)          => request('PUT',  `/api/staff/phase/${studentId}`, data),
  setAssignment:   (studentId, data)          => request('PUT',  `/api/staff/assignment/${studentId}`, data),
  massAssign:      (studentIds, field, value) => request('PUT',  '/api/staff/mass-assign', { studentIds, field, value }),
  setTarget:       (id, target)               => request('PUT',  `/api/staff/${id}/target`, { target }),
  setCallTarget:   (id, target)               => request('PUT',  `/api/staff/${id}/call-target`, { target }),
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
// Deep Cleanse — schema-adaptive cleanup tool (Admin/Director only; destructive
// calls carry confirm:true). Reads are non-destructive previews.
export const cleanupAPI = {
  schema:       ()        => request('GET',  '/api/cleanup/schema'),
  preview:      (ids)     => request('POST', '/api/cleanup/preview', { ids }),
  apply:        (ids)     => request('POST', '/api/cleanup/apply', { ids, confirm: true }),
  orphans:      ()        => request('GET',  '/api/cleanup/orphans'),
  orphanKeys:   ()        => request('GET',  '/api/cleanup/orphans/keys'),
  purgeOrphans: (ids)     => request('POST', '/api/cleanup/orphans/purge', { confirm: true, ids: ids || null }),
  byPattern:    (pattern) => request('GET',  `/api/cleanup/by-pattern?pattern=${encodeURIComponent(pattern || '')}`),
  duplicates:   (by)      => request('GET',  `/api/cleanup/duplicates?by=${encodeURIComponent(by || 'email')}`),
  leadsByPattern: (pattern) => request('GET',  `/api/cleanup/leads-by-pattern?pattern=${encodeURIComponent(pattern || '')}`),
  leadPreview:    (leadIds) => request('POST', '/api/cleanup/lead-preview', { leadIds }),
  leadApply:      (leadIds) => request('POST', '/api/cleanup/lead-apply', { leadIds, confirm: true }),
};

export const studentAPI = {
  search:         (q)        => request('GET',  `/api/staff/students/search?q=${encodeURIComponent(q || '')}`),
  searchLeads:    (q)        => request('GET',  `/api/staff/lead-list?q=${encodeURIComponent(q || '')}`),
  get:            (id)       => request('GET',  `/api/staff/students/${id}`),
  update:         (id, data) => request('PUT',  `/api/staff/students/${id}`, data),
  calculateRisk:  (id)       => request('POST', `/api/staff/students/${id}/calculate-risk`),
  calculateOcean: (id)       => request('POST', `/api/staff/students/${id}/calculate-ocean`),
  deleteRecords:  (ids)      => request('DELETE', '/api/staff/students', { studentIds: ids }),
  deletePreview:  (ids)      => request('POST', '/api/staff/students/delete-preview', { studentIds: ids }),
  getOrphans:     ()         => request('GET',  '/api/staff/cleanup/orphans'),
  purgeOrphans:   ()         => request('POST', '/api/staff/cleanup/orphans/purge'),

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

// ── Leads (engagements) — many per student ────────────────────
export const leadAPI = {
  listAll:        ()             => request('GET',  '/api/leads'),
  listForStudent: (studentId)    => request('GET',  `/api/leads/student/${encodeURIComponent(studentId)}`),
  get:            (leadId)       => request('GET',  `/api/leads/${leadId}`),
  create:         (studentId, d) => request('POST', `/api/leads/student/${encodeURIComponent(studentId)}`, d || {}),
  update:         (leadId, d)    => request('PUT',  `/api/leads/${leadId}`, d || {}),
};

// ── Counsellor AI Agent (weekly Top-10 + feedback) ────────────
export const aiAPI = {
  recommendations: (counselor)     => request('GET',  `/api/ai/recommendations${counselor ? `?counselor=${encodeURIComponent(counselor)}` : ''}`),
  feedback:        (id, d)         => request('POST', `/api/ai/recommendations/${id}/feedback`, d),
  forLead:         (leadId)        => request('GET',  `/api/ai/leads/${leadId}/recommendation`),
  statusReason:    (leadId, d)     => request('POST', `/api/ai/leads/${leadId}/status-reason`, d),
  runNow:          (counselor)     => request('POST', '/api/ai/run', counselor ? { counselor } : {}),
  // Letters (P2/P3) — drafts only; counsellor sends from their own channels.
  generateLetter:  (leadId, d)     => request('POST', `/api/ai/leads/${leadId}/letters`, d),
  listLetters:     (leadId)        => request('GET',  `/api/ai/leads/${leadId}/letters`),
  updateLetter:    (id, d)         => request('PUT',  `/api/ai/letters/${id}`, d),
  markLetterSent:  (id, via, comment) => request('POST', `/api/ai/letters/${id}/sent`, { via, comment }),
  markLetterResponded: (id, comment)  => request('POST', `/api/ai/letters/${id}/responded`, { comment }),
  letterQueue:     (phase, counselor) => request('GET', `/api/ai/letter-queue?phase=${encodeURIComponent(phase)}${counselor ? `&counselor=${encodeURIComponent(counselor)}` : ''}`),
  recordMeeting:   (leadId, d)     => request('POST', `/api/ai/leads/${leadId}/meetings`, d),
  listMeetings:    (leadId)        => request('GET',  `/api/ai/leads/${leadId}/meetings`),
};

// ── Lead registrations (events) ───────────────────────────────
export const leadEventsAPI = {
  list:         (studentId)  => request('GET', `/api/lead-events?studentId=${encodeURIComponent(studentId)}`),
  options:      ()           => request('GET', '/api/lead-events/options'),
  add:          (body)       => request('POST', '/api/lead-events', body),
  update:       (id, body)   => request('PUT', `/api/lead-events/${id}`, body),
  updateStatus: (id, status) => request('PUT', `/api/lead-events/${id}`, { status }),
};

// ── Event Management console (Phase 1: roster + check-in) ──────
// Backend mounts at /api/event-console. Responses are camelCased by request().
export const eventConsoleAPI = {
  listEvents: ()             => request('GET',  '/api/event-console/events'),
  getEvent:   (id)           => request('GET',  `/api/event-console/events/${id}`),
  roster:     (id, q)        => request('GET',  `/api/event-console/events/${id}/roster${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  checkin:    (id, studentId, fields) => request('POST', `/api/event-console/events/${id}/checkin`, { studentId, fields }),
  checkinFields: (id, studentId) => request('GET', `/api/event-console/events/${id}/checkin-fields/${encodeURIComponent(studentId)}`),
  issueToken: (id, studentId) => request('POST', `/api/event-console/events/${id}/issue-token/${encodeURIComponent(studentId)}`),
  emailBadge: (body)         => request('POST', '/api/event-console/email-badge', body),
  zaloBadge:  (body)         => request('POST', '/api/event-console/zalo-badge', body),
  // Feature 3 — event follow-up (survey) send, one student per call.
  zaloFollowup:  (body)      => request('POST', '/api/event-console/zalo-followup', body),
  emailFollowup: (body)      => request('POST', '/api/event-console/email-followup', body),

  // ── Desk setup (Phase 2.1) ──
  listInstitutions: ()         => request('GET',    '/api/event-console/institutions'),
  listEventDesks:   (id)       => request('GET',    `/api/event-console/events/${id}/institutions`),
  addEventDesk:     (id, body) => request('POST',   `/api/event-console/events/${id}/institutions`, body),
  regenDeskPin:     (id, eiId) => request('POST',   `/api/event-console/events/${id}/institutions/${eiId}/regen-pin`),
  removeEventDesk:  (id, eiId) => request('DELETE', `/api/event-console/events/${id}/institutions/${eiId}`),

// ── Event reps (Phase 2.2a) ──
  listEventReps:  (id)             => request('GET',    `/api/event-console/events/${id}/reps`),
  staffPool:      ()               => request('GET',    `/api/event-console/staff-pool`),
  emailRepLink:   (id, repId, baseUrl) => request('POST', `/api/event-console/events/${id}/reps/${repId}/email-link`, { baseUrl }),
  addEventRep:    (id, body)       => request('POST',   `/api/event-console/events/${id}/reps`, body),
  updateEventRep: (id, repId, b)   => request('PATCH',  `/api/event-console/events/${id}/reps/${repId}`, b),
  deskSessions:   (id)             => request('GET',    `/api/event-console/events/${id}/desk-sessions`),
  regenRepPin:    (id, repId)      => request('POST',   `/api/event-console/events/${id}/reps/${repId}/regen-pin`),
  removeEventRep: (id, repId)      => request('DELETE', `/api/event-console/events/${id}/reps/${repId}`),

// ── Event reports (per-event uploaded report files) ──
  listEventReports:  (id)          => request('GET',    `/api/event-console/events/${id}/reports`),
  generateEventReport: (id, mode)  => request('POST',   `/api/event-console/events/${id}/reports/generate`, { mode: mode || 'full' }),
  uploadEventReport: (id, body)    => request('POST',   `/api/event-console/events/${id}/reports`, body),
  deleteEventReport: (id, reportId)=> request('DELETE', `/api/event-console/events/${id}/reports/${reportId}`),
  // Streams the file back and triggers a browser download.
  downloadEventReport: async (id, reportId, fileName) => {
    const res = await fetch(`${BASE_URL}/api/event-console/events/${id}/reports/${reportId}/download`, {
      method: 'GET', credentials: 'include',
    });
    if (!res.ok) {
      let msg = `Download failed (${res.status})`;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* binary */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = fileName || `event-report-${reportId}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },

// ── Qualification config (Admin only) ──
  qualificationFields:     ()       => request('GET', '/api/event-console/qualification-fields'),
  saveQualificationFields: (fields) => request('PUT', '/api/event-console/qualification-fields', { fields }),

// ── Event Report dashboard (Report -> Event Report) ──
  sourceReport:     (id)                  => request('GET',    `/api/event-console/events/${id}/source-report`),
  eventsCompare:    (ids)                 => request('GET',    `/api/event-console/events-compare?ids=${ids.join(',')}`),
  getBudget:        (id)                  => request('GET',    `/api/event-console/events/${id}/budget`),
  setBudgetTotals:  (id, totals)          => request('PUT',    `/api/event-console/events/${id}/budget-totals`, totals),
  addBudgetItem:    (id, item)            => request('POST',   `/api/event-console/events/${id}/budget-items`, item),
  updateBudgetItem: (id, itemId, item)    => request('PUT',    `/api/event-console/events/${id}/budget-items/${itemId}`, item),
  deleteBudgetItem: (id, itemId)          => request('DELETE', `/api/event-console/events/${id}/budget-items/${itemId}`),
  importBudgetCsv:  (id, csvText)         => request('POST',   `/api/event-console/events/${id}/budget-import`, { csvText }),
  saveBudgetApprovalNote: (id, itemIds, note) => request('PUT', `/api/event-console/events/${id}/budget-approval-note`, { itemIds, note }),
  approveBudget:    (id, budgetType)      => request('POST',   `/api/event-console/events/${id}/budget-approve`, { budgetType }),
  setSourceSpend:   (id, sourceLabel, amount) => request('PUT', `/api/event-console/events/${id}/source-spend`, { sourceLabel, amount }),
  getSponsors:      (id)                  => request('GET',    `/api/event-console/events/${id}/sponsors`),
  addSponsor:       (id, item)            => request('POST',   `/api/event-console/events/${id}/sponsors`, item),
  updateSponsor:    (id, itemId, item)    => request('PUT',    `/api/event-console/events/${id}/sponsors/${itemId}`, item),
  deleteSponsor:    (id, itemId)          => request('DELETE', `/api/event-console/events/${id}/sponsors/${itemId}`),
  importSponsorsCsv: (id, csvText)        => request('POST',   `/api/event-console/events/${id}/sponsors-import`, { csvText }),

};

// ── Notes ─────────────────────────────────────────────────────
export const notesAPI = {
  list:   (studentId)                    => request('GET',    `/api/notes/${studentId}`),

  // Lead-level notes (topic allowed).
  listForLead: (leadId) => request('GET', `/api/notes/lead/${leadId}`),
  addForLead:  (leadId, noteType, content, extra = {}) =>
    request('POST', `/api/notes/lead/${leadId}`, {
      noteType, content,
      topic:           extra.topic           || null,
      followUpDate:    extra.followUpDate    || null,
      contactPlatform: extra.contactPlatform || null,
      meetingLocation: extra.meetingLocation || null,
      // ?? not || — callAnswered can legitimately be `false` (didn't pick up),
      // which || would wrongly collapse to null.
      callAnswered:    extra.callAnswered ?? null,
      // Set when this note completes a pending draft (cross-device note
      // drafts, confirmed 2026-08) — the backend marks the draft resolved.
      draftId:         extra.draftId || null,
    }),

  // Student-level notes (topic-less for now).
  listStudentLevel: (studentId) => request('GET', `/api/notes/student-level/${encodeURIComponent(studentId)}`),
  addStudentLevel:  (studentId, noteType, content, extra = {}) =>
    request('POST', `/api/notes/student-level/${encodeURIComponent(studentId)}`, {
      noteType, content,
      followUpDate:    extra.followUpDate    || null,
      contactPlatform: extra.contactPlatform || null,
      meetingLocation: extra.meetingLocation || null,
      // ?? not || — callAnswered can legitimately be `false` (didn't pick up).
      callAnswered:    extra.callAnswered ?? null,
      draftId:         extra.draftId || null,
    }),

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
      meetingLocation: extra.meetingLocation || null,
    }),

  // Append a new addendum block to an existing note (existing content immutable).
  append:            (id, text, followUpDate) =>
    request('PATCH', `/api/notes/${id}/append`, { text, followUpDate }),
  getReminders:      ()             => request('GET',    '/api/notes/reminders'),
  getCommunications: ()             => request('GET',    '/api/notes/communications'),
  updateReminder:    (id, data)     => request('PATCH',  `/api/notes/${id}/reminder`, data),
  // Edit a note's own content — author-only, 48-hour window, full audit
  // trail (confirmed 2026-08). Replaces delete as the correction mechanism.
  edit:              (id, content)  => request('PATCH',  `/api/notes/${id}/edit`, { content }),
  getEditHistory:    (id)           => request('GET',    `/api/notes/${id}/edits`),
};

// ── Note drafts (cross-device, confirmed 2026-08) ────────────────
// A draft is created the moment a staffer clicks the platform action button
// (Make phone call / Open Zalo / etc.) — that's now the "lock" moment; the
// note form itself isn't fillable before that. Stays pending until resumed
// (from any device) or manually discarded — no auto-expiry.
export const noteDraftsAPI = {
  create:   (data)      => request('POST',   '/api/note-drafts', data),
  listMine: ()           => request('GET',    '/api/note-drafts'),
  get:      (id)         => request('GET',    `/api/note-drafts/${id}`),
  discard:  (id)         => request('DELETE', `/api/note-drafts/${id}`),
};

// ── Documents ─────────────────────────────────────────────────
export const documentsAPI = {
  listForLead:      (leadId)        => request('GET',  `/api/documents/lead/${leadId}`),
  uploadForLead:    (leadId, d)     => request('POST', `/api/documents/lead/${leadId}/upload`, d),
  listStudentLevel: (studentId)     => request('GET',  `/api/documents/student-level/${encodeURIComponent(studentId)}`),
  uploadForStudent: (studentId, d)  => request('POST', `/api/documents/${encodeURIComponent(studentId)}/upload`, d),
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
  contractedStats: (counselor) => request('GET', `/api/reports/contracted-stats${counselor ? `?counselor=${encodeURIComponent(counselor)}` : ''}`),
  weeklyReport: (weekStart, mode, resources) => {
    const qs = new URLSearchParams();
    if (weekStart) qs.set('weekStart', weekStart);
    if (mode) qs.set('mode', mode);
    if (resources && resources.length) qs.set('resources', resources.join(','));
    const s = qs.toString();
    return request('GET', `/api/reports/weekly${s ? `?${s}` : ''}`);
  },
  getRecommendation: (weekStart, mode, resources) => {
    const qs = new URLSearchParams();
    if (weekStart) qs.set('weekStart', weekStart);
    if (mode) qs.set('mode', mode);
    if (resources && resources.length) qs.set('resources', resources.join(','));
    return request('GET', `/api/reports/weekly-recommendation?${qs.toString()}`);
  },
  saveRecommendation: (weekStart, mode, resources, content) =>
    request('PUT', '/api/reports/weekly-recommendation', {
      weekStart, mode, resources: resources || [], content: content || '',
    }),
  // Manually re-publish (re-freeze) a week's snapshot.
  regenerateWeekly: (weekStart) =>
    request('POST', `/api/reports/weekly/regenerate${weekStart ? `?weekStart=${weekStart}` : ''}`),
  monthlyTargets:     ()                       => request('GET',    '/api/reports/monthly-targets'),
  saveMonthlyTarget:  (staffId, month, target) => request('PUT',    '/api/reports/monthly-targets', { staffId, month, target }),
  addTrackedStaff:    (staffId)                => request('POST',   '/api/reports/tracked-staff', { staffId }),
  removeTrackedStaff: (staffId)                => request('DELETE', `/api/reports/tracked-staff/${staffId}`),
  callTargets:            ()                       => request('GET',    '/api/reports/call-targets'),
  saveCallTarget:         (staffId, month, target) => request('PUT',    '/api/reports/call-targets', { staffId, month, target }),
  addCallTargetStaff:     (staffId)                => request('POST',   '/api/reports/call-target-staff', { staffId }),
  removeCallTargetStaff:  (staffId)                => request('DELETE', `/api/reports/call-target-staff/${staffId}`),
  uncontactableRoster:       ()        => request('GET',    '/api/reports/uncontactable-roster'),
  addUncontactableStaff:     (staffId) => request('POST',   '/api/reports/uncontactable-roster', { staffId }),
  removeUncontactableStaff:  (staffId) => request('DELETE', `/api/reports/uncontactable-roster/${staffId}`),

  // ── Sales + Marketing Monthly Report ──
  monthlyReport:  (month)                     => request('GET', `/api/reports/monthly?month=${month}`),
  callHours:      (month)                     => request('GET', `/api/reports/call-hours?month=${month}`),
  saveCallHours:  (staffId, month, hours)     => request('PUT', '/api/reports/call-hours', { staffId, month, hours }),
  monthlyNotes:   (month)                     => request('GET', `/api/reports/monthly-notes?month=${month}`),
  saveMonthlyNotes: (month, content)          => request('PUT', '/api/reports/monthly-notes', { month, content }),
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

// ── Lead Distribution ─────────────────────────────────────────
// Admin/Manager/Director only (gated server-side on distribution.manage).
export const distributionAPI = {
  offices: ()                   => request('GET',  '/api/distribution/offices'),
  pool:    ()                   => request('GET',  '/api/distribution/pool'),
  preview: (office, perHead)    => request('POST', '/api/distribution/preview', { office, perHead }),
  release: (office, perHead)    => request('POST', '/api/distribution/release', { office, perHead }),
  recall:  (counsellor, dryRun) => request('POST', '/api/distribution/recall', { counsellor, dryRun }),
  transferExceptions: (resolved = false) => request('GET', `/api/distribution/transfer-exceptions?resolved=${resolved}`),

  // Excel/CSV upload into the pool (file sent as base64)
  upload:  (fileBase64, office)  => request('POST', '/api/distribution/upload', { fileBase64, office }),

  // Download the .xlsx capture template (binary -> browser download)
  downloadTemplate: async () => {
    const res = await fetch(`${BASE_URL}/api/distribution/template`, { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error(`Template download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'lead_upload_template.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },

  // Office-coverage management
  staff:           ()                       => request('GET',    '/api/distribution/staff'),
  coverage:        ()                       => request('GET',    '/api/distribution/coverage'),
  addCoverage:     (staffId, office, weight)=> request('POST',   '/api/distribution/coverage', { staffId, office, weight }),
  updateCoverage:  (id, weight)             => request('PATCH',  `/api/distribution/coverage/${id}`, { weight }),
  removeCoverage:  (id)                      => request('DELETE', `/api/distribution/coverage/${id}`),

  // Existing unassigned leads
  unassigned:    ()                  => request('GET',  '/api/distribution/unassigned'),
  poolExisting:  (residency, office) => request('POST', '/api/distribution/pool-existing', { residency, office }),

  // Review staging
  review:        ()                     => request('GET',  '/api/distribution/review'),
  assignManual:  (leadIds, counselor) => request('POST', '/api/distribution/assign-manual', { leadIds, counselor }),
  commitPool:    ()                     => request('POST', '/api/distribution/commit-pool'),
  poolToReview:  (office)               => request('POST', '/api/distribution/pool-to-review', { office }),

  // Duplicates to review
  duplicates:        ()                       => request('GET',  '/api/distribution/duplicates'),
  resolveDuplicate:  (id, action, studentId)  => request('POST', `/api/distribution/duplicates/${id}/resolve`, { action, studentId }),

  // Notes bulk upload
  uploadNotes:   (fileBase64)           => request('POST', '/api/distribution/upload-notes', { fileBase64 }),
  downloadNotesTemplate: async () => {
    const res = await fetch(`${BASE_URL}/api/distribution/notes-template`, { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error(`Template download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'notes_upload_template.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
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