// server/src/controllers/documentController.js

const driveService = require('../services/driveService');
const Document     = require('../models/Document');

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

async function uploadDocument(req, res, next) {
  try {
    const { studentId } = req.params;
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

    // 1. Upload file to Google Drive
    const { fileId, viewUrl, folderUrl } = await driveService.uploadDocument(studentId, {
      fileName:    fileName || 'document',
      type:        type || '',
      description: description.trim(),
      fileData,
    });

    // 2. Save metadata to PostgreSQL
    const doc = await Document.create({
      studentId,
      type:        type || '',
      description: description.trim(),
      fileName:    fileName || 'document',
      driveFileId: fileId,
      viewUrl,
    });

    res.json({ success: true, data: { ...doc, folderUrl } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listDocuments, uploadDocument };
