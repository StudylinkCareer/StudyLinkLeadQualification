// server/src/services/driveService.js
// Handles document upload and listing via Google Drive API
// Uses the same service account as emailService (no extra credentials needed)

const { google } = require('googleapis');
const config = require('../config');

const MIME_MAP = {
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf:  'application/pdf',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  csv:  'text/csv',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:  'text/plain',
  rtf:  'application/rtf',
  md:   'text/markdown',
};

function getAuthClient() {
  return new google.auth.JWT({
    email: config.gmail.serviceEmail,
    key:   config.gmail.privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

function getMimeType(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// Get or create a subfolder for the student inside the root StudyLink Documents folder
async function getOrCreateStudentFolder(drive, studentId) {
  const rootFolderId = config.drive.rootFolderId;

  // Search for existing folder
  const search = await drive.files.list({
    q: `name='${studentId}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (search.data.files.length > 0) {
    return search.data.files[0].id;
  }

  // Create new folder
  const folder = await drive.files.create({
    requestBody: {
      name: studentId,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
    },
    fields: 'id',
  });

  return folder.data.id;
}

async function uploadDocument(studentId, { fileName, type, description, fileData }) {
  const auth  = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  // Parse base64 data URL
  let mimeType = getMimeType(fileName);
  let base64Content = fileData;

  if (fileData.startsWith('data:')) {
    const semiIdx  = fileData.indexOf(';');
    const commaIdx = fileData.indexOf(',');
    if (semiIdx > 0)  mimeType     = fileData.substring(5, semiIdx);
    if (commaIdx > 0) base64Content = fileData.substring(commaIdx + 1);
  }

  const fileBuffer = Buffer.from(base64Content, 'base64');
  const folderId   = await getOrCreateStudentFolder(drive, studentId);

  // Upload file to Drive
  const uploaded = await drive.files.create({
    requestBody: {
      name:    fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: require('stream').Readable.from(fileBuffer),
    },
    fields: 'id, name, webViewLink',
  });

  // Make file viewable by anyone with the link
  await drive.permissions.create({
    fileId:      uploaded.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const fileId  = uploaded.data.id;
  const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  return { fileId, viewUrl, folderUrl, fileName, type, description };
}

async function getFolderUrl(studentId) {
  try {
    const auth  = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const folderId = await getOrCreateStudentFolder(drive, studentId);
    return `https://drive.google.com/drive/folders/${folderId}`;
  } catch {
    return '';
  }
}

module.exports = { uploadDocument, getFolderUrl };
