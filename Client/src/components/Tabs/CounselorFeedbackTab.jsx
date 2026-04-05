import { useState } from 'react';
import { FiSend } from 'react-icons/fi';
import SelectInput from '../Form/SelectInput';
import { useAuth } from '../../hooks/useAuth';
import { getTranslatedOptions } from '../../utils/formFields';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';

const NOTE_SECTIONS = [
  { key: 'managementNotes', labelKey: 'managementLabel', id: '5.LT' },
  { key: 'counselingNotes', labelKey: 'counselingLabel', id: '3.LT' },
  { key: 'caseOfficerNotes', labelKey: 'caseOfficerLabel', id: '4.LT' },
];

function parseNotes(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function NotesBox({ label, id, notes, onAddNote, saving, language }) {
  const [draft, setDraft] = useState('');

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    onAddNote(text);
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="notes-box">
      <div className="notes-box-header">
        <h3 className="notes-box-title">{label}</h3>
      </div>

      <div className="notes-list">
        {notes.length === 0 && (
          <div className="notes-empty">{t('noNotesYet', language)}</div>
        )}
        {notes.map((note, idx) => (
          <div className="notes-entry" key={idx}>
            <div className="notes-entry-text">{note.text}</div>
            <div className="notes-entry-meta">
              <span className="notes-entry-author">{note.author}</span>
              <span className="notes-entry-time">{note.timestamp}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="notes-input-row">
        <textarea
          className="notes-textarea"
          placeholder={`${t('addNotePrefix', language)} ${label.toLowerCase()} ${t('addNoteSuffix', language)}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          rows={2}
        />
        <button
          className="btn btn--primary btn--sm notes-send-btn"
          onClick={handleSubmit}
          disabled={saving || !draft.trim()}
          title={t('addNotePrefix', language)}
        >
          <FiSend />
        </button>
      </div>
    </div>
  );
}

export default function CounselorFeedbackTab({ formData, updateField, saving, lastSaved }) {
  const { email: currentUserEmail } = useAuth();
  const { language } = useLanguage();

  const handleAddNote = (sectionKey, text) => {
    const existing = parseNotes(formData[sectionKey]);
    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    const newNote = {
      text,
      author: currentUserEmail || 'Unknown',
      timestamp,
    };

    const updated = [...existing, newNote];
    updateField(sectionKey, JSON.stringify(updated));
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('counselorFeedbackTitle', language)}</h2>
        <div className="save-status">
          {saving && <span className="save-indicator saving">{t('savingStatus', language)}</span>}
          {!saving && lastSaved && (
            <span className="save-indicator saved">
              {t('savedAt', language)} {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="form-section">
        <h3 className="form-section-title">{t('marketingSection', language)}</h3>
        <SelectInput
          label={t('leadSource', language)}
          name="leadSource"
          value={formData.leadSource}
          onChange={updateField}
          options={getTranslatedOptions('leadSource', language)}
          mandatory
        />
        <SelectInput
          label={t('interaction', language)}
          name="interaction"
          value={formData.interaction}
          onChange={updateField}
          options={getTranslatedOptions('interaction', language)}
          mandatory
        />
      </div>

      <div className="counselor-notes-grid">
        {NOTE_SECTIONS.map((section) => (
          <NotesBox
            key={section.key}
            label={t(section.labelKey, language)}
            id={section.id}
            notes={parseNotes(formData[section.key])}
            onAddNote={(text) => handleAddNote(section.key, text)}
            saving={saving}
            language={language}
          />
        ))}
      </div>
    </div>
  );
}
