const dataService = require('../services/dataService');
const { google } = require('googleapis');
const { Readable } = require('stream');

const MAX_FILE_BASE64_LENGTH = 10 * 1024 * 1024 * 1.34;

async function listDocuments(req, res, next) {
  try {
    const { studentId } = req.params;
    const result = await dataService.listDocuments(studentId);
    res.json({
      success: true,
      data: result?.documents || [],
      folderUrl: result?.folderUrl || '',
    });
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

    // Extract MIME type and base64 content
    let mimeType = 'application/octet-stream';
    let base64Content = fileData;
    if (fileData.startsWith('data:')) {
      const semiIdx = fileData.indexOf(';');
      const commaIdx = fileData.indexOf(',');
      if (semiIdx > 0) mimeType = fileData.substring(5, semiIdx);
      if (commaIdx > 0) base64Content = fileData.substring(commaIdx + 1);
    }

    // Upload to Google Drive
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const buffer = Buffer.from(base64Content, 'base64');
    const stream = Readable.from(buffer);

    const driveResponse = await drive.files.create({
      requestBody: {
        name: fileName || 'document',
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
      media: { mimeType, body: stream },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });

    const driveFileId = driveResponse.data.id;
    const viewUrl = driveResponse.data.webViewLink;

    // Make file publicly viewable
    await drive.permissions.create({
      fileId: driveFileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });

    // Save metadata to PostgreSQL
    const result = await dataService.saveDocument(studentId, {
      type:        type || '',
      description: description.trim(),
      fileName:    fileName || 'document',
      driveFileId,
      viewUrl,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { listDocuments, uploadDocument };