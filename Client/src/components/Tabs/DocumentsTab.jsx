// client/src/components/Tabs/DocumentsTab.jsx
// CHANGES:
//   - Replaced inline table-row upload form with a stacked card form
//   - Description field is now full-width and clearly labelled on all screen sizes
//   - Type selector and file drop zone are also full-width stacked on mobile

import { useState, useRef, useCallback } from 'react';
import { FiPlus, FiUpload, FiFile, FiX, FiExternalLink, FiFolder } from 'react-icons/fi';
import { documentAPI } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

const DOCUMENT_TYPES = [
  'MS Word',
  'PDF',
  'Excel',
  'PowerPoint',
  'Notes',
  'Google Sheet',
];

const EXT_TYPE_MAP = {
  doc: 'MS Word', docx: 'MS Word', pdf: 'PDF',
  xls: 'Excel', xlsx: 'Excel', xlsm: 'Excel', csv: 'Excel',
  ppt: 'PowerPoint', pptx: 'PowerPoint',
  txt: 'Notes', rtf: 'Notes', md: 'Notes',
  gsheet: 'Google Sheet',
};

function detectType(filename) {
  if (!filename) return '';
  const ext = filename.split('.').pop().toLowerCase();
  return EXT_TYPE_MAP[ext] || '';
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function DocumentsTab({ formData, updateField, saving, lastSaved }) {
  const { language } = useLanguage();
  const studentId = formData.studentId || '';

  const [documents, setDocuments] = useState([]);
  const [folderUrl, setFolderUrl] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docsError, setDocsError] = useState('');

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadType, setUploadType] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!studentId) return;
    setLoadingDocs(true);
    setDocsError('');
    try {
      const res = await documentAPI.list(studentId);
      setDocuments(res.data || []);
      setFolderUrl(res.folderUrl || '');
      setDocsLoaded(true);
    } catch (err) {
      setDocsError(err.message || 'Failed to load documents');
    } finally {
      setLoadingDocs(false);
    }
  }, [studentId]);

  if (!docsLoaded && !loadingDocs && studentId) {
    loadDocuments();
  }

  const handleFileSelected = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setUploadError(t('fileTooLarge', language));
      return;
    }
    setSelectedFile(file);
    setSelectedFileName(file.name);
    setUploadError('');
    const detected = detectType(file.name);
    if (detected) setUploadType(detected);
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
    e.target.value = '';
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !studentId) return;
    if (!uploadDescription.trim()) {
      setUploadError(t('descRequired', language));
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(selectedFile);
      });
      await documentAPI.upload(studentId, {
        fileName: selectedFileName,
        type: uploadType || detectType(selectedFileName) || '',
        description: uploadDescription.trim(),
        fileData: base64,
      });
      setShowUploadForm(false);
      setUploadDescription('');
      setUploadType('');
      setSelectedFile(null);
      setSelectedFileName('');
      await loadDocuments();
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleCancelUpload = () => {
    setShowUploadForm(false);
    setUploadDescription('');
    setUploadType('');
    setSelectedFile(null);
    setSelectedFileName('');
    setUploadError('');
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('documentsTitle', language)}</h2>
        <div className="save-status">
          {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              {t('savedAt', language)} {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="documents-description">
        {t('documentsDescription', language)}
      </div>

      {folderUrl && (
        <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="documents-drive-link">
          <FiFolder /> {t('viewInDrive', language)}
          <FiExternalLink size={14} />
        </a>
      )}

      {docsError && (
        <div className="home-error" style={{ marginBottom: '1rem' }}>
          {docsError}
          <button className="btn btn--sm btn--ghost" onClick={loadDocuments} style={{ marginLeft: '0.5rem' }}>
            {t('retry', language)}
          </button>
        </div>
      )}

      {/* ── Documents table ── */}
      <div className="form-section documents-table-wrapper">
        <div className="documents-table">
          <div className="documents-row documents-header-row">
            <div className="documents-cell documents-cell-type">{t('typeColumn', language)}</div>
            <div className="documents-cell documents-cell-id">{t('docIdColumn', language)}</div>
            <div className="documents-cell documents-cell-desc">{t('descColumn', language)}</div>
            <div className="documents-cell documents-cell-date">{t('dateColumn', language)}</div>
          </div>

          {loadingDocs && (
            <div className="documents-row">
              <div className="documents-cell" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {t('loadingDocuments', language)}
              </div>
            </div>
          )}

          {!loadingDocs && documents.map((doc, idx) => (
            <div className="documents-row" key={doc.documentId || idx}>
              <div className="documents-cell documents-cell-type">
                <span className="documents-type-badge">{doc.type || '—'}</span>
              </div>
              <div className="documents-cell documents-cell-id">
                {doc.viewUrl ? (
                  <a href={doc.viewUrl} target="_blank" rel="noopener noreferrer" className="documents-link">
                    {doc.documentId}
                  </a>
                ) : (
                  <span>{doc.documentId}</span>
                )}
              </div>
              <div className="documents-cell documents-cell-desc">{doc.description || ''}</div>
              <div className="documents-cell documents-cell-date">{doc.timestamp || ''}</div>
            </div>
          ))}

          {!loadingDocs && documents.length === 0 && !showUploadForm && (
            <div className="documents-row">
              <div className="documents-cell" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 1rem' }}>
                {t('noDocumentsYet', language)}
              </div>
            </div>
          )}
        </div>

        {/* ── Add button ── */}
        {!showUploadForm && (
          <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
            <button
              className="documents-add-btn"
              onClick={() => setShowUploadForm(true)}
              title={t('uploadDocument', language)}
            >
              <FiPlus />
            </button>
          </div>
        )}
      </div>

      {/* ── Upload form — stacked card, mobile friendly ── */}
      {showUploadForm && (
        <div className="form-section" style={{ marginTop: '1rem' }}>
          <h3 className="form-section-title" style={{ marginBottom: '1rem' }}>
            {t('uploadDocument', language)}
          </h3>

          {/* Document type */}
          <div className="form-field" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t('typeColumn', language)}</label>
            <select
              className="form-select"
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              disabled={uploading}
            >
              <option value="">{t('autoType', language)}</option>
              {DOCUMENT_TYPES.map((dt) => (
                <option key={dt} value={dt}>{dt}</option>
              ))}
            </select>
          </div>

          {/* Description — full width, clearly labelled */}
          <div className="form-field" style={{ marginBottom: '1rem' }}>
            <label className="form-label">
              {t('descColumn', language)}<span className="form-mandatory">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder={t('descPlaceholder', language)}
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              disabled={uploading}
              autoFocus
            />
          </div>

          {/* File drop zone */}
          <div
            ref={dropZoneRef}
            className={`documents-dropzone ${dragOver ? 'documents-dropzone--active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ marginBottom: '1rem' }}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileInputChange}
              accept=".doc,.docx,.pdf,.xls,.xlsx,.xlsm,.csv,.ppt,.pptx,.txt,.rtf,.md"
              style={{ display: 'none' }}
            />
            {selectedFile ? (
              <div className="documents-file-selected">
                <FiFile size={24} />
                <div>
                  <div className="documents-file-name">{selectedFileName}</div>
                  <div className="documents-file-size">{(selectedFile.size / 1024).toFixed(1)} KB</div>
                </div>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setSelectedFileName(''); }}
                >
                  <FiX />
                </button>
              </div>
            ) : (
              <div className="documents-dropzone-content">
                <FiUpload size={28} />
                <p><strong>{t('dropFileHere', language)}</strong> {t('orClickBrowse', language)}</p>
                <p className="documents-dropzone-hint">{t('supportedFormats', language)}</p>
              </div>
            )}
          </div>

          {uploadError && (
            <div className="home-error" style={{ marginBottom: '0.75rem' }}>{uploadError}</div>
          )}

          {/* Action buttons */}
          <div className="documents-upload-actions">
            <button
              className="btn btn--primary"
              onClick={handleUpload}
              disabled={uploading || !selectedFile}
            >
              <FiUpload /> {uploading ? t('uploading', language) : t('uploadDocument', language)}
            </button>
            <button
              className="btn btn--secondary"
              onClick={handleCancelUpload}
              disabled={uploading}
            >
              {t('cancel', language)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
