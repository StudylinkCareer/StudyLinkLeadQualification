// client/src/components/DuplicateModal.jsx
// Popup for conflict scenario — multiple active records, user picks which to keep

import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';

export default function DuplicateModal({ scenario, matches, onSelectRecord, onCancel }) {
  const { language } = useLanguage();
  const [selectedId, setSelectedId] = useState(null);

  // ── Conflict scenario: multiple active records ──
  if (scenario === 'conflict') {
    return (
      <div className="modal-overlay">
        <div className="modal-card">
          <h2 className="modal-title">{t('conflictTitle', language)}</h2>
          <p className="modal-message">{t('conflictMessage', language)}</p>

          <div className="modal-matches">
            {matches.map((m) => {
              const matchedBy = (m._matchedBy || []).join(' & ');
              return (
                <label
                  key={m.studentId}
                  className={`modal-match-row modal-match-row--selectable ${selectedId === m.studentId ? 'modal-match-row--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="selectedRecord"
                    value={m.studentId}
                    checked={selectedId === m.studentId}
                    onChange={() => setSelectedId(m.studentId)}
                  />
                  <div className="modal-match-info">
                    <div className="modal-match-name">
                      {m.fullName || t('noName', language)}
                    </div>
                    <div className="modal-match-detail">
                      {m.email && <span>{m.email}</span>}
                      {m.phone && <span> · {m.phone}</span>}
                    </div>
                    <div className="modal-match-meta">
                      {t('matchedBy', language)}: {matchedBy}
                      {' · '}ID: {m.studentId}
                    </div>
                  </div>
                  <span className="modal-match-status modal-match-status--active">
                    {t('statusActive', language)}
                  </span>
                </label>
              );
            })}
          </div>

          <p className="modal-hint">{t('conflictHint', language)}</p>

          <div className="modal-actions">
            <button
              className="btn btn--primary"
              onClick={() => selectedId && onSelectRecord(selectedId)}
              disabled={!selectedId}
            >
              {t('keepSelected', language)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
