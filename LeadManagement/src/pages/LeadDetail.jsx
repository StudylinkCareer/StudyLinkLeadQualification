// src/pages/LeadDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI, notesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiArrowLeft, FiSend, FiTrash2 } from 'react-icons/fi';

const LEAD_STATUSES   = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];
const CONFIDENCE_OPTS = ['Low (0-30%)','Medium (31-60%)','High (61-90%)','Committed (91-100%)'];
const NOTE_TYPES      = { counselor: 'Counselor Note', presales: 'PreSales Note', management: 'Management Note' };

function canWriteNote(role, type) {
  if (type === 'counselor')  return ['Counselor','Manager'].includes(role);
  if (type === 'presales')   return ['Counselor','Manager'].includes(role);
  if (type === 'management') return ['Director','Manager'].includes(role);
  return false;
}

function formatDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

export default function LeadDetail() {
  const { id }              = useParams();
  const navigate            = useNavigate();
  const { staff, isManager } = useAuth();

  const [lead, setLead]         = useState(null);
  const [notes, setNotes]       = useState([]);
  const [staffList, setStaff]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // Assignment fields
  const [assign, setAssign]     = useState({});

  // Lead status fields
  const [leadStatus, setLeadStatus]   = useState('');
  const [closeDate, setCloseDate]     = useState('');
  const [confidence, setConfidence]   = useState('');

  // Notes
  const [noteType, setNoteType]   = useState('counselor');
  const [noteText, setNoteText]   = useState('');
  const [addingNote, setAdding]   = useState(false);

  useEffect(() => {
    Promise.all([
      studentAPI.get(id),
      notesAPI.list(id),
      staffAPI.listActive(),
    ]).then(([ld, nt, st]) => {
      const l = ld.data;
      setLead(l);
      setNotes(nt.data || []);
      setStaff(st.data || []);
      setAssign({
        counselor:       l.counselor        || '',
        senior_counselor: l.senior_counselor || '',
        presales:        l.presales          || '',
        marketing_staff: l.marketing_staff  || '',
      });
      setLeadStatus(l.lead_status || l.leadStatus || 'New');
      setCloseDate(l.close_date ? l.close_date.split('T')[0] : '');
      setConfidence(l.confidence || '');
    }).catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [id]);

  async function saveAssignment() {
    setSaving(true);
    try {
      await staffAPI.assign(id, {
        counselor:      assign.counselor,
        seniorCounselor: assign.senior_counselor,
        presales:       assign.presales,
        marketingStaff: assign.marketing_staff,
      });
      await studentAPI.update(id, {
        lead_status: leadStatus,
        close_date:  closeDate || null,
        confidence,
      });
      alert('Saved successfully');
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setAdding(true);
    try {
      const data = await notesAPI.add(id, noteType, noteText.trim());
      setNotes(n => [data.data, ...n]);
      setNoteText('');
    } catch (e) {
      alert(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await notesAPI.delete(noteId);
      setNotes(n => n.filter(x => x.id !== noteId));
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading) return <div className="loading-center">Loading...</div>;
  if (!lead)   return <div className="page-body"><div className="alert alert--error">Lead not found</div></div>;

  const staffByRole = (role) => staffList.filter(s => s.role === role || s.position.toLowerCase().includes(role.toLowerCase()));

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/leads')}>
            <FiArrowLeft size={16} />
          </button>
          <span className="page-title">{lead.fullName || 'Lead Detail'}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'DM Mono' }}>
            {lead.uniqueId}
          </span>
        </div>
        {isManager && (
          <button className="btn btn--primary btn--sm" onClick={saveAssignment} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1rem', alignItems: 'start' }}>

        {/* Left: Lead info + Notes */}
        <div>
          {/* Lead Status */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Lead Status</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={leadStatus}
                  onChange={e => setLeadStatus(e.target.value)}
                  disabled={!isManager && staff?.role !== 'Counselor'}>
                  {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Close Date</label>
                <input className="form-input" type="date" value={closeDate}
                  onChange={e => setCloseDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Confidence</label>
                <select className="form-select" value={confidence} onChange={e => setConfidence(e.target.value)}>
                  <option value="">Select...</option>
                  {CONFIDENCE_OPTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Lead Info */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Lead Information</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
              {[
                ['Email', lead.email],
                ['Phone', lead.phone],
                ['Study Plans', lead.studyPlans],
                ['Destination', lead.destinationCountry],
                ['Timeline', lead.timeline],
                ['English Level', lead.englishLevel],
                ['GPA', lead.gpa],
                ['Budget', lead.budget],
                ['Lead Source', lead.leadSource],
                ['Interaction', lead.interaction],
                ['School/Event', lead.schoolEvent],
                ['Stone Tier', lead.stoneTier],
                ['Risk Score', lead.riskScore],
                ['Created', lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
                  <span>{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Notes</span>
            </div>

            {/* Add note */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                {Object.entries(NOTE_TYPES).map(([type, label]) => (
                  canWriteNote(staff?.role, type) && (
                    <button key={type}
                      className={`btn btn--sm ${noteType === type ? 'btn--primary' : 'btn--secondary'}`}
                      onClick={() => setNoteType(type)}>
                      {label}
                    </button>
                  )
                ))}
              </div>
              {canWriteNote(staff?.role, noteType) && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder={`Add a ${NOTE_TYPES[noteType]}...`}
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    style={{ resize: 'vertical', flex: 1 }}
                  />
                  <button className="btn btn--primary btn--icon" onClick={addNote} disabled={addingNote || !noteText.trim()}>
                    <FiSend size={15} />
                  </button>
                </div>
              )}
            </div>

            {/* Notes list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {notes.length === 0 && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No notes yet</div>
              )}
              {notes.map(note => (
                <div key={note.id} style={{
                  padding: '0.875rem', borderRadius: '8px',
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className={`badge badge--${note.note_type === 'management' ? 'director' : note.note_type === 'presales' ? 'manager' : 'counselor'}`}>
                        {NOTE_TYPES[note.note_type]}
                      </span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{note.author_name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'DM Mono' }}>
                        {formatDate(note.created_at)}
                      </span>
                      {note.author_id === staff?.id && (
                        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => deleteNote(note.id)}
                          style={{ color: 'var(--danger)' }}>
                          <FiTrash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.9375rem', whiteSpace: 'pre-wrap' }}>{note.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Assignment panel */}
        {isManager && (
          <div className="section-card" style={{ position: 'sticky', top: '72px' }}>
            <div className="section-header">
              <span className="section-title">Staff Assignment</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { key: 'counselor',        label: 'Counselor' },
                { key: 'senior_counselor', label: 'Senior Counselor' },
                { key: 'presales',         label: 'PreSales' },
                { key: 'marketing_staff',  label: 'Marketing Staff' },
              ].map(({ key, label }) => (
                <div className="form-group" key={key}>
                  <label className="form-label">{label}</label>
                  <select className="form-select" value={assign[key] || ''}
                    onChange={e => setAssign(a => ({ ...a, [key]: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {staffList.map(s => (
                      <option key={s.id} value={s.full_name}>{s.full_name} ({s.position})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
