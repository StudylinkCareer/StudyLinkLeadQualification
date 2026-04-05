// server/src/services/dataService.js
// CHANGES:
//   - gasRequest() reads text first to give clean error on HTML responses
//   - checkCounselor() now passes fullName + phone to GAS, returns boolean

const config = require('../config');

async function gasRequest(action, data = {}) {
  const url = config.gas.sheetsUrl;
  if (!url) throw new Error('GAS_SHEETS_URL not configured');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
    redirect: 'follow',
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`[GAS] HTTP ${response.status} for action "${action}". Body: ${text.slice(0, 300)}`);
    throw new Error(`GAS sheets request failed: ${response.status}`);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch (parseErr) {
    console.error(`[GAS] Non-JSON response for action "${action}". Status: ${response.status}. Body: ${text.slice(0, 500)}`);
    throw new Error(`GAS returned an unexpected response (not JSON). Check GAS deployment settings — "Who has access" must be set to "Anyone".`);
  }

  if (!result.success) {
    throw new Error(result.error || 'GAS sheets operation failed');
  }

  return result.data;
}

async function getStudentByEmail(email) {
  return gasRequest('getByEmail', { email });
}

async function getStudentById(uniqueId) {
  return gasRequest('getById', { uniqueId });
}

async function createStudentRow(data) {
  return gasRequest('create', { row: data });
}

async function updateStudentRow(uniqueId, data) {
  return gasRequest('update', { uniqueId, row: data });
}

async function getNextSequenceNumber(datePrefix) {
  return gasRequest('getNextSeq', { datePrefix });
}

async function searchDuplicates(email, phone) {
  return gasRequest('searchDuplicates', { email, phone });
}

async function deactivateRecords(uniqueIds) {
  return gasRequest('deactivateRecords', { uniqueIds });
}

async function searchStudents(query) {
  return gasRequest('searchStudents', { query });
}

// Updated: passes fullName + phone so GAS can validate all counselor credentials.
// GAS now returns { valid: true/false } — we extract the boolean here so
// callers don't need to change.
async function checkCounselor(email, fullName, phone) {
  const result = await gasRequest('isCounselor', { email, fullName: fullName || '', phone: phone || '' });
  // GAS returns { valid: true } or { valid: false, reason: '...' }
  return result === true || result?.valid === true;  
}

async function uploadPhotos(uniqueId, photos) {
  return gasRequest('uploadPhotos', { uniqueId, photos });
}

async function listDocuments(studentId) {
  return gasRequest('listDocuments', { studentId });
}

async function uploadDocument(studentId, docData) {
  return gasRequest('uploadDocument', { studentId, ...docData });
}

module.exports = {
  getStudentByEmail,
  getStudentById,
  createStudentRow,
  updateStudentRow,
  getNextSequenceNumber,
  searchDuplicates,
  deactivateRecords,
  searchStudents,
  checkCounselor,
  uploadPhotos,
  listDocuments,
  uploadDocument,
};
