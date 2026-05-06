// LeadManagement/src/components/ExportLeadsModal.jsx
//
// A modal for admins to export leads to Excel with:
//   - Date range picker (with selectable date field)
//   - Field selection grouped by section, with select-all/none + presets
//
// Submits to POST /api/students/export-excel and triggers a file download.

import { useState, useMemo } from 'react';
import { FiX, FiDownload } from 'react-icons/fi';
import { studentAPI } from '../services/api';
import './ExportLeadsModal.css';

// ── Field groups ──────────────────────────────────────────────
// Mirrors MASTER_COLUMNS in pages/Leads.jsx, organized by section.
const FIELD_GROUPS = [
  {
    label: 'Personal Details',
    fields: [
      { key: 'fullName',         label: 'Name' },
      { key: 'email',            label: 'Email' },
      { key: 'phone',            label: 'Phone' },
      { key: 'yearOfBirth',      label: 'Year of Birth' },
      { key: 'residency',        label: 'Residency' },
      { key: 'schoolEvent',      label: 'School / Event' },
      { key: 'preferredSocial',  label: 'Social Platform' },
      { key: 'socialConsent',    label: 'Connect With Us' },
    ],
  },
  {
    label: 'Lead Management',
    fields: [
      { key: 'leadStatus',         label: 'Status' },
      { key: 'createdAt',          label: 'Created' },
      { key: 'updatedAt',          label: 'Last Updated' },
      { key: 'leadSource',         label: 'Lead Source' },
      { key: 'interaction',        label: 'Interaction' },
      { key: 'studyPlans',         label: 'Study Plans' },
      { key: 'destinationCountry', label: 'Destination' },
      { key: 'timeline',           label: 'Timeline' },
      { key: 'stoneTier',          label: 'Stone' },
      { key: 'riskScore',          label: 'Score' },
      { key: 'counselor',          label: 'Counselor' },
      { key: 'seniorCounselor',    label: 'Sr. Counselor' },
      { key: 'presales',           label: 'Pre-Sales' },
      { key: 'marketingStaff',     label: 'Marketing' },
      { key: 'closeDate',          label: 'Close Date' },
      { key: 'confidence',         label: 'Confidence' },
    ],
  },
  {
    label: 'Self Assessment',
    fields: [
      { key: 'budget',             label: 'Budget' },
      { key: 'scholarshipDemand',  label: 'Scholarship' },
      { key: 'englishLevel',       label: 'English' },
      { key: 'gpa',                label: 'GPA' },
      { key: 'immigrationHistory', label: 'Immigration' },
      { key: 'sponsorIncome',      label: 'Sponsor Income' },
      { key: 'incomeEvidence',     label: 'Income Evidence' },
      { key: 'studyPlanGap',       label: 'Study Plan Gap' },
      { key: 'ultimateObjective',  label: 'Objective' },
    ],
  },
  {
    label: 'Family Contacts',
    fields: [
      { key: 'motherFullName',      label: 'Mother Name' },
      { key: 'motherEmail',         label: 'Mother Email' },
      { key: 'motherPhone',         label: 'Mother Phone' },
      { key: 'motherContactMedium', label: 'Mother Medium' },
      { key: 'fatherFullName',      label: 'Father Name' },
      { key: 'fatherEmail',         label: 'Father Email' },
      { key: 'fatherPhone',         label: 'Father Phone' },
      { key: 'fatherContactMedium', label: 'Father Medium' },
    ],
  },
  {
    label: 'OCEAN Profile',
    fields: [
      { key: 'oceanExtraversion',      label: 'Extraversion' },
      { key: 'oceanAgreeableness',     label: 'Agreeableness' },
      { key: 'oceanConscientiousness', label: 'Conscientiousness' },
      { key: 'oceanNeuroticism',       label: 'Neuroticism' },
      { key: 'oceanOpenness',          label: 'Openness' },
    ],
  },
  {
    label: 'Campaign / Event',
    fields: [
      { key: 'campaignType',  label: 'Campaign Type' },
      { key: 'campaignName',  label: 'Campaign Name' },
      { key: 'campaignStart', label: 'Camp. Start' },
      { key: 'campaignEnd',   label: 'Camp. End' },
    ],
  },
];

const ALL_FIELD_KEYS = FIELD_GROUPS.flatMap(g => g.fields.map(f => f.key));

// Default fields = roughly what's visible by default in the Leads table
const DEFAULT_FIELDS = [
  'fullName', 'email', 'phone', 'leadStatus', 'createdAt',
  'leadSource', 'destinationCountry', 'timeline', 'stoneTier', 'riskScore',
  'counselor', 'closeDate',
];

// Selectable date fields for filtering
const DATE_FIELD_OPTIONS = [
  { value: 'createdAt',     label: 'Created Date' },
  { value: 'updatedAt',     label: 'Last Updated' },
  { value: 'closeDate',     label: 'Close Date' },
  { value: 'campaignStart', label: 'Campaign Start' },
  { value: 'campaignEnd',   label: 'Campaign End' },
];

// ── Component ─────────────────────────────────────────────────
export default function ExportLeadsModal({
  open,
  onClose,
  initiallyVisibleFields = [],   // pass `visibleColKeys` from Leads.jsx for the "Use Visible" preset
}) {
  // Default range — last 90 days
  const today        = new Date().toISOString().slice(0, 10);
  const defaultStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate,   setEndDate]   = useState(today);
  const [dateField, setDateField] = useState('createdAt');
  const [selected,  setSelected]  = useState(new Set(DEFAULT_FIELDS));
  const [exporting, setExporting] = useState(false);
  const [error,     setError]     = useState('');

  if (!open) return null;

  const toggle = key => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAll      = ()       => setSelected(new Set(ALL_FIELD_KEYS));
  const setNone     = ()       => setSelected(new Set());
  const setDefault  = ()       => setSelected(new Set(DEFAULT_FIELDS));
  const setVisible  = ()       => setSelected(new Set(initiallyVisibleFields));
  const setGroup    = (group)  => {
    const keys = group.fields.map(f => f.key);
    const allInGroup = keys.every(k => selected.has(k));
    setSelected(prev => {
      const next = new Set(prev);
      if (allInGroup) keys.forEach(k => next.delete(k));
      else            keys.forEach(k => next.add(k));
      return next;
    });
  };

  const totalSelected = selected.size;
  const dateLabel     = useMemo(
    () => DATE_FIELD_OPTIONS.find(o => o.value === dateField)?.label || dateField,
    [dateField]
  );

  async function handleExport() {
    setError('');
    if (totalSelected === 0) {
      setError('Please select at least one field.');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError('Start date must be before end date.');
      return;
    }

    setExporting(true);
    try {
      await studentAPI.exportExcel({
        startDate: startDate || null,
        endDate:   endDate   || null,
        dateField,
        fields: [...selected],
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="export-modal__backdrop" onClick={onClose}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <header className="export-modal__header">
          <h2>Export Leads to Excel</h2>
          <button className="export-modal__close" onClick={onClose} aria-label="Close">
            <FiX size={20}/>
          </button>
        </header>

        <div className="export-modal__body">
          {/* ── Date range section ───────────────────── */}
          <section className="export-modal__section">
            <h3>Date Range</h3>
            <div className="export-modal__row">
              <label>
                Filter by:
                <select value={dateField} onChange={e => setDateField(e.target.value)}>
                  {DATE_FIELD_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="export-modal__row">
              <label>
                From:
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </label>
              <label>
                To:
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </label>
            </div>
            <p className="export-modal__hint">
              Including leads where <strong>{dateLabel}</strong> falls in this range. Leave a date blank for "no limit".
            </p>
          </section>

          {/* ── Field selection ──────────────────────── */}
          <section className="export-modal__section">
            <div className="export-modal__section-head">
              <h3>Fields to Include ({totalSelected})</h3>
              <div className="export-modal__presets">
                <button type="button" onClick={setAll}>All</button>
                <button type="button" onClick={setNone}>None</button>
                <button type="button" onClick={setDefault}>Defaults</button>
                {initiallyVisibleFields.length > 0 && (
                  <button type="button" onClick={setVisible}>Visible columns</button>
                )}
              </div>
            </div>

            <div className="export-modal__groups">
              {FIELD_GROUPS.map(group => {
                const groupKeys = group.fields.map(f => f.key);
                const groupSel  = groupKeys.filter(k => selected.has(k)).length;
                const allSel    = groupSel === groupKeys.length;
                return (
                  <div key={group.label} className="export-modal__group">
                    <div className="export-modal__group-head">
                      <button
                        type="button"
                        className="export-modal__group-toggle"
                        onClick={() => setGroup(group)}
                      >
                        {group.label} <span>({groupSel}/{groupKeys.length})</span>
                      </button>
                    </div>
                    <div className="export-modal__group-fields">
                      {group.fields.map(f => (
                        <label key={f.key} className="export-modal__check">
                          <input
                            type="checkbox"
                            checked={selected.has(f.key)}
                            onChange={() => toggle(f.key)}
                          />
                          <span>{f.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {error && <div className="export-modal__error">{error}</div>}
        </div>

        <footer className="export-modal__footer">
          <button className="btn btn--secondary" onClick={onClose} disabled={exporting}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleExport} disabled={exporting || totalSelected === 0}>
            <FiDownload size={14}/> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </footer>
      </div>
    </div>
  );
}
