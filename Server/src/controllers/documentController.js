// server/src/controllers/documentController.js

const driveService = require('../services/driveService');
const Document     = require('../models/Document');
const Lead         = require('../models/Lead');

// Max ~10 MB base64
const MAX_FILE_BASE64_LENGTH = 10 * 1024 * 1024 * 1.34;

async function listDocuments(req, res, next) {
  try {
    const { studentId } = req.params;
    const documents  = await Document.listByStudent(studentId);
    const folderUrl  = await driveService.getFolderUrl(studentId);
    res.json({ success: true, data: documents, folderUrl });
  } catch (err) {
    next(err);
  }
}

// Shared upload: pushes the file to the student's Drive folder, then saves
// metadata at the given level (leadId NULL => student-level, set => lead-level).
async function performUpload(req, res, studentId, leadId) {
  const { fileName, type, description, fileData } = req.body;

  if (!fileData || typeof fileData !== 'string') {
    return res.status(400).json({ success: false, error: 'File data is required' });
  }
  if (!description || !description.trim()) {
    return res.status(400).json({ success: false, error: 'Description is required' });
  }
  if (fileData.length > MAX_FILE_BASE64_LENGTH) {
    return res.status(400).json({ success: false, error: 'File exceeds 10 MB size limit' });
  }

  const { fileId, viewUrl, folderUrl } = await driveService.uploadDocument(studentId, {
    fileName:    fileName || 'document',
    type:        type || '',
    description: description.trim(),
    fileData,
  });

  const doc = await Document.create({
    studentId,
    leadId,
    type:        type || '',
    description: description.trim(),
    fileName:    fileName || 'document',
    driveFileId: fileId,
    viewUrl,
  });

  return res.json({ success: true, data: { ...doc, folderUrl } });
}

// POST /api/documents/:studentId/upload — student-level (no lead).
async function uploadDocument(req, res, next) {
  try {
    return await performUpload(req, res, req.params.studentId, null);
  } catch (err) { next(err); }
}

// ── Lead-level documents (study / finance / lead-specific) ───────────────────
async function getLeadDocuments(req, res, next) {
  try {
    const documents = await Document.listByLead(req.params.leadId);
    res.json({ success: true, data: documents });
  } catch (err) { next(err); }
}

async function uploadLeadDocument(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    return await performUpload(req, res, lead.studentId, Number(req.params.leadId));
  } catch (err) { next(err); }
}

// ── Student-level documents (family / identity; lead_id NULL) ─────────────────
async function getStudentLevelDocuments(req, res, next) {
  try {
    const documents = await Document.listStudentLevel(req.params.studentId);
    const folderUrl = await driveService.getFolderUrl(req.params.studentId);
    res.json({ success: true, data: documents, folderUrl });
  } catch (err) { next(err); }
}

module.exports = { listDocuments, uploadDocument, getLeadDocuments, uploadLeadDocument, getStudentLevelDocuments };
