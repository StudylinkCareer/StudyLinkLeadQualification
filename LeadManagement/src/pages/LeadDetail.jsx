// src/pages/LeadDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI, notesAPI, auditAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiArrowLeft, FiSend, FiTrash2, FiEdit2, FiX, FiSave, FiChevronDown, FiChevronUp } from 'react-icons/fi';

// ── Permissions config — update roles here to change access ──────────────────
const PERMS = {
  canEdit:           ['Counselor', 'Manager', 'Admin', 'Director'],
  canEditStatus:     ['Counselor', 'Manager', 'Admin', 'Director'],
  canEditInfo:       ['Counselor', 'Manager', 'Admin', 'Director'],
  canEditAssessment: ['Counselor', 'Manager', 'Admin', 'Director'],
  canEditAssignment: ['Manager', 'Admin'],
  canWriteNote: {
    counselor:  ['Counselor', 'Manager', 'Admin'],
    presales:   ['Counselor', 'Manager', 'Admin'],
    management: ['Director',  'Manager', 'Admin'],
  },
};

const LEAD_STATUSES   = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];
const CONFIDENCE_OPTS = ['Low (0-30%)','Medium (31-60%)','High (61-90%)','Committed (91-100%)'];
const NOTE_TYPES      = { counselor: 'Counselor Note', presales: 'PreSales Note', management: 'Management Note' };

const ENGLISH_LEVELS   = ['Beginner','IELTS 4-4.5','IELTS 5-5.5','IELTS 6-6.5','IELTS 7+'];
const GPA_OPTIONS      = ['< 6.5','6.5-6.9','7-7.9','8-8.9','9+'];
const BUDGET_OPTIONS   = ['< 300M VND','300-500M VND','500-800M VND','800M-1B VND','1-1.5B VND'];
const SCHOLARSHIP_OPTS = ['100% scholarship','60-90% scholarship','30-50% scholarship','20-25% scholarship','No scholarship needed'];
const IMMIGRATION_OPTS = ['Visa rejection (self)','Rejection/overstay (family)','No travel history','Travelled in Asia','Travelled to Western countries'];
const SPONSOR_OPTS     = ['< 300M VND','300-500M VND','500-800M VND','800M-1B VND','1-1.5B VND'];
const INCOME_OPTS      = ['0% documented','30-35% documented','50% documented','70-75% documented','100% documented'];
const STUDY_GAP_OPTS   = ['Different major, 5+ year gap','Different major, 2-5 year gap','Same major, 2-5 year gap','Same major, < 2 year gap','Same major, no gap'];
const OBJECTIVE_OPTS   = ['Migration only','Work only','Study but work more','Study for migration pathway','Study only'];
const STUDY_PLAN_OPTS  = ['Study Abroad','English Summer Camp','Study in Vietnam','Do not study'];
const TIMELINE_OPTS    = ['Next 6 months','6-12 months','12-24 months','24-36 months','36+ months'];
const INTERACTION_OPTS = ['Only left contact','Queries','Fill lead form partly','Fill lead form fully','Call in-Walk in'];
const LEAD_SOURCE_OPTS = ['Databases','FB-Zalo-GG-TikTok ads','School outreach','Subagent referrals','Ex-client'];

// Human-readable field name mapping for audit log display
const FIELD_LABELS = {
  leadStatus: 'Status', closeDate: 'Close Date', confidence: 'Confidence',
  studyPlans: 'Study Plans', leadSource: 'Lead Source', interaction: 'Interaction',
  destinationCountry: 'Destination', timeline: 'Timeline', schoolEvent: 'School/Event',
  budget: 'Budget', scholarshipDemand: 'Scholarship Demand', englishLevel: 'English Level',
  gpa: 'GPA', immigrationHistory: 'Immigration History', sponsorIncome: 'Sponsor Income',
  incomeEvidence: 'Income Evidence', studyPlanGap: 'Study Plan & Gap',
  ultimateObjective: 'Ultimate Objective', counselor: 'Counselor',
  seniorCounselor: 'Senior Counselor', presales: 'Pre-Sales', marketingStaff: 'Marketing Staff',
  riskScore: 'Risk Score', stoneTier: 'Stone Tier',
};

function canDo(perm, role) {
  return Array.isArray(perm) ? perm.includes(role) : false;
}

function formatDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function Field({ label, value }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.125rem' }}>
      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500 }}>{label}</span>
      <span style={{ fontSize:'0.875rem' }}>{value || '—'}</span>
    </div>
  );
}

function EditField({ label, name, value, onChange, type='text', options }) {
  return (
    <div className="form-group" style={{ margin:0 }}>
      <label className="form-label">{label}</label>
      {options ? (
        <select className="form-select" value={value||''} onChange={e=>onChange(name, e.target.value)}>
          <option value="">—</option>
          {options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="form-input" type={type} value={value||''} onChange={e=>onChange(name, e.target.value)}/>
      )}
    </div>
  );
}

export default function LeadDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { staff } = useAuth();
  const role      = staff?.role || '';

  const [lead, setLead]         = useState(null);
  const [notes, setNotes]       = useState([]);
  const [staffList, setStaff]   = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [assign, setAssign]     = useState({});
  const [noteType, setNoteType] = useState('counselor');
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      studentAPI.get(id),
      notesAPI.list(id),
      staffAPI.listActive(),
      auditAPI.getForStudent(id),
    ]).then(([ld, nt, st, al]) => {
      const l = ld.data;
      setLead(l);
      setNotes(nt.data || []);
      setStaff(st.data || []);
      setAuditLog(al.data || []);
      setAssign({
        counselor:       l.counselor      || '',
        seniorCounselor: l.seniorCounselor || '',
        presales:        l.presales        || '',
        marketingStaff:  l.marketingStaff  || '',
      });
    }).catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [id]);

  function enterEdit() { setEditData({ ...lead }); setEditMode(true); }
  function cancelEdit() { setEditData({}); setEditMode(false); }
  function updateEdit(name, value) { setEditData(d => ({ ...d, [name]: value })); }

  async function saveAll() {
    setSaving(true);
    try {
      if (editMode) {
        await studentAPI.update(id, {
          leadStatus:         editData.leadStatus,
          closeDate:          editData.closeDate || null,
          confidence:         editData.confidence,
          studyPlans:         editData.studyPlans,
          leadSource:         editData.leadSource,
          interaction:        editData.interaction,
          destinationCountry: editData.destinationCountry,
          timeline:           editData.timeline,
          schoolEvent:        editData.schoolEvent,
          budget:             editData.budget,
          scholarshipDemand:  editData.scholarshipDemand,
          englishLevel:       editData.englishLevel,
          gpa:                editData.gpa,
          immigrationHistory: editData.immigrationHistory,
          sponsorIncome:      editData.sponsorIncome,
          incomeEvidence:     editData.incomeEvidence,
          studyPlanGap:       editData.studyPlanGap,
          ultimateObjective:  editData.ultimateObjective,
        });
        setLead(l => ({ ...l, ...editData }));
        setEditMode(false);
        setEditData({});
      }
      if (canDo(PERMS.canEditAssignment, role)) {
        await staffAPI.assign(id, {
          counselor:       assign.counselor,
          seniorCounselor: assign.seniorCounselor,
          presales:        assign.presales,
          marketingStaff:  assign.marketingStaff,
        });
      }
      // Refresh audit log after save
      const al = await auditAPI.getForStudent(id);
      setAuditLog(al.data || []);
      alert('Saved successfully');
    } catch(e) {
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
    } catch(e) { alert(e.message); }
    finally { setAdding(false); }
  }

  async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await notesAPI.delete(noteId);
      setNotes(n => n.filter(x => x.id !== noteId));
    } catch(e) { alert(e.message); }
  }

  if (loading) return <div className="loading-center">Loading...</div>;
  if (!lead)   return <div className="page-body"><div className="alert alert--error">Lead not found</div></div>;

  const canEdit   = canDo(PERMS.canEdit, role);
  const canAssign = canDo(PERMS.canEditAssignment, role);
  const d         = editMode ? editData : lead;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/leads')}>
            <FiArrowLeft size={16}/>
          </button>
          <span className="page-title">{lead.fullName || 'Lead Detail'}</span>
          <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono' }}>
            {lead.uniqueId}
          </span>
        </div>
        <div style={{ display:'flex', gap:'0.5rem' }}>
          {canEdit && !editMode && (
            <button className="btn btn--secondary btn--sm" onClick={enterEdit}>
              <FiEdit2 size={13}/> Edit
            </button>
          )}
          {editMode && (
            <button className="btn btn--ghost btn--sm" onClick={cancelEdit}>
              <FiX size={13}/> Cancel
            </button>
          )}
          {(editMode || canAssign) && (
            <button className="btn btn--primary btn--sm" onClick={saveAll} disabled={saving}>
              <FiSave size={13}/> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      <div className="page-body" style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:'1rem', alignItems:'start' }}>

        {/* ── Left column ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

          {/* Lead Status */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Lead Status</span>
            </div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <EditField label="Status"     name="leadStatus" value={d.leadStatus} onChange={updateEdit} options={LEAD_STATUSES}/>
                <EditField label="Close Date" name="closeDate"  value={d.closeDate ? d.closeDate.split('T')[0] : ''} onChange={updateEdit} type="date"/>
                <EditField label="Confidence" name="confidence" value={d.confidence} onChange={updateEdit} options={CONFIDENCE_OPTS}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <Field label="Status"     value={lead.leadStatus || 'New'}/>
                <Field label="Close Date" value={lead.closeDate ? new Date(lead.closeDate).toLocaleDateString() : null}/>
                <Field label="Confidence" value={lead.confidence}/>
              </div>
            )}
          </div>

          {/* Lead Information */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Lead Information</span>
            </div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <EditField label="Study Plans"  name="studyPlans"         value={d.studyPlans}         onChange={updateEdit} options={STUDY_PLAN_OPTS}/>
                <EditField label="Lead Source"  name="leadSource"         value={d.leadSource}         onChange={updateEdit} options={LEAD_SOURCE_OPTS}/>
                <EditField label="Interaction"  name="interaction"        value={d.interaction}        onChange={updateEdit} options={INTERACTION_OPTS}/>
                <EditField label="Destination"  name="destinationCountry" value={d.destinationCountry} onChange={updateEdit}/>
                <EditField label="Timeline"     name="timeline"           value={d.timeline}           onChange={updateEdit} options={TIMELINE_OPTS}/>
                <EditField label="School/Event" name="schoolEvent"        value={d.schoolEvent}        onChange={updateEdit}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <Field label="Email"         value={lead.email}/>
                <Field label="Phone"         value={lead.phone}/>
                <Field label="Study Plans"   value={lead.studyPlans}/>
                <Field label="Lead Source"   value={lead.leadSource}/>
                <Field label="Interaction"   value={lead.interaction}/>
                <Field label="Destination"   value={lead.destinationCountry}/>
                <Field label="Timeline"      value={lead.timeline}/>
                <Field label="School/Event"  value={lead.schoolEvent}/>
                <Field label="Year of Birth" value={lead.yearOfBirth}/>
                <Field label="Residency"     value={lead.residency}/>
                <Field label="Stone Tier"    value={lead.stoneTier}/>
                <Field label="Risk Score"    value={lead.riskScore}/>
                <Field label="Created"       value={lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : null}/>
                <Field label="Updated"       value={lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString() : null}/>
              </div>
            )}
          </div>

          {/* Assessment Fields */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Self Assessment</span>
            </div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <EditField label="Budget"              name="budget"            value={d.budget}            onChange={updateEdit} options={BUDGET_OPTIONS}/>
                <EditField label="Scholarship Demand"  name="scholarshipDemand" value={d.scholarshipDemand} onChange={updateEdit} options={SCHOLARSHIP_OPTS}/>
                <EditField label="English Level"       name="englishLevel"      value={d.englishLevel}      onChange={updateEdit} options={ENGLISH_LEVELS}/>
                <EditField label="GPA"                 name="gpa"               value={d.gpa}               onChange={updateEdit} options={GPA_OPTIONS}/>
                <EditField label="Immigration History" name="immigrationHistory" value={d.immigrationHistory} onChange={updateEdit} options={IMMIGRATION_OPTS}/>
                <EditField label="Sponsor Income"      name="sponsorIncome"     value={d.sponsorIncome}     onChange={updateEdit} options={SPONSOR_OPTS}/>
                <EditField label="Income Evidence"     name="incomeEvidence"    value={d.incomeEvidence}    onChange={updateEdit} options={INCOME_OPTS}/>
                <EditField label="Study Plan & Gap"    name="studyPlanGap"      value={d.studyPlanGap}      onChange={updateEdit} options={STUDY_GAP_OPTS}/>
                <EditField label="Ultimate Objective"  name="ultimateObjective" value={d.ultimateObjective} onChange={updateEdit} options={OBJECTIVE_OPTS}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <Field label="Budget"              value={lead.budget}/>
                <Field label="Scholarship Demand"  value={lead.scholarshipDemand}/>
                <Field label="English Level"       value={lead.englishLevel}/>
                <Field label="GPA"                 value={lead.gpa}/>
                <Field label="Immigration History" value={lead.immigrationHistory}/>
                <Field label="Sponsor Income"      value={lead.sponsorIncome}/>
                <Field label="Income Evidence"     value={lead.incomeEvidence}/>
                <Field label="Study Plan & Gap"    value={lead.studyPlanGap}/>
                <Field label="Ultimate Objective"  value={lead.ultimateObjective}/>
              </div>
            )}
          </div>

          {/* Family Contacts */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Family Contacts</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.8125rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Mother</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  <Field label="Name"           value={lead.motherFullName}/>
                  <Field label="Email"          value={lead.motherEmail}/>
                  <Field label="Phone"          value={lead.motherPhone}/>
                  <Field label="Contact Medium" value={lead.motherContactMedium}/>
                  <Field label="Contact Detail" value={lead.motherContactDetail}/>
                </div>
              </div>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.8125rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Father</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  <Field label="Name"           value={lead.fatherFullName}/>
                  <Field label="Email"          value={lead.fatherEmail}/>
                  <Field label="Phone"          value={lead.fatherPhone}/>
                  <Field label="Contact Medium" value={lead.fatherContactMedium}/>
                  <Field label="Contact Detail" value={lead.fatherContactDetail}/>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Notes</span>
            </div>
            <div style={{ marginBottom:'1.25rem' }}>
              <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.75rem' }}>
                {Object.entries(NOTE_TYPES).map(([type, label]) => (
                  PERMS.canWriteNote[type]?.includes(role) && (
                    <button key={type}
                      className={`btn btn--sm ${noteType===type ? 'btn--primary' : 'btn--secondary'}`}
                      onClick={() => setNoteType(type)}>
                      {label}
                    </button>
                  )
                ))}
              </div>
              {PERMS.canWriteNote[noteType]?.includes(role) && (
                <div style={{ display:'flex', gap:'0.75rem' }}>
                  <textarea className="form-input" rows={3}
                    placeholder={`Add a ${NOTE_TYPES[noteType]}...`}
                    value={noteText} onChange={e=>setNoteText(e.target.value)}
                    style={{ resize:'vertical', flex:1 }}/>
                  <button className="btn btn--primary btn--icon"
                    onClick={addNote} disabled={addingNote || !noteText.trim()}>
                    <FiSend size={15}/>
                  </button>
                </div>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              {notes.length===0 && (
                <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No notes yet</div>
              )}
              {notes.map(note => (
                <div key={note.id} style={{
                  padding:'0.875rem', borderRadius:'8px',
                  background:'var(--bg-secondary)', border:'1px solid var(--border)',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <span className={`badge badge--${note.noteType==='management'?'director':note.noteType==='presales'?'manager':'counselor'}`}>
                        {NOTE_TYPES[note.noteType]}
                      </span>
                      <span style={{ fontSize:'0.8125rem', fontWeight:500 }}>{note.authorName}</span>
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono' }}>
                        {formatDate(note.createdAt)}
                      </span>
                      {note.authorId === staff?.id && (
                        <button className="btn btn--ghost btn--icon btn--sm"
                          onClick={() => deleteNote(note.id)}
                          style={{ color:'var(--danger)' }}>
                          <FiTrash2 size={13}/>
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize:'0.9375rem', whiteSpace:'pre-wrap' }}>{note.content}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Change History */}
          <div className="section-card">
            <div className="section-header" style={{ cursor:'pointer' }}
              onClick={() => setShowHistory(h => !h)}>
              <span className="section-title">Change History ({auditLog.length})</span>
              {showHistory ? <FiChevronUp size={15}/> : <FiChevronDown size={15}/>}
            </div>
            {showHistory && (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {auditLog.length === 0 && (
                  <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No changes recorded yet</div>
                )}
                {auditLog.map(entry => (
                  <div key={entry.id} style={{
                    display:'grid', gridTemplateColumns:'140px 1fr',
                    gap:'0.5rem', padding:'0.5rem 0',
                    borderBottom:'1px solid var(--border)',
                    fontSize:'0.8125rem',
                  }}>
                    <div style={{ color:'var(--text-secondary)' }}>
                      <div style={{ fontFamily:'DM Mono', fontSize:'0.75rem' }}>{formatDate(entry.changedAt)}</div>
                      <div style={{ fontWeight:500, marginTop:'0.125rem' }}>{entry.changedBy}</div>
                    </div>
                    <div>
                      <span style={{ fontWeight:500 }}>{FIELD_LABELS[entry.fieldName] || entry.fieldName}</span>
                      <div style={{ marginTop:'0.25rem', display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                        <span style={{
                          background:'var(--bg-secondary)', padding:'0.125rem 0.5rem',
                          borderRadius:'4px', color:'var(--danger)', fontSize:'0.75rem',
                          textDecoration:'line-through',
                        }}>
                          {entry.oldValue || '—'}
                        </span>
                        <span style={{ color:'var(--text-secondary)', fontSize:'0.75rem' }}>→</span>
                        <span style={{
                          background:'var(--bg-secondary)', padding:'0.125rem 0.5rem',
                          borderRadius:'4px', color:'var(--success, #16a34a)', fontSize:'0.75rem',
                        }}>
                          {entry.newValue || '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem', position:'sticky', top:'72px' }}>

          {/* Staff Assignment */}
          {canAssign && (
            <div className="section-card">
              <div className="section-header">
                <span className="section-title">Staff Assignment</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                {[
                  { key:'counselor',       label:'Counselor' },
                  { key:'seniorCounselor', label:'Senior Counselor' },
                  { key:'presales',        label:'Pre-Sales' },
                  { key:'marketingStaff',  label:'Marketing Staff' },
                ].map(({ key, label }) => (
                  <div className="form-group" key={key}>
                    <label className="form-label">{label}</label>
                    <select className="form-select" value={assign[key]||''}
                      onChange={e => setAssign(a => ({ ...a, [key]: e.target.value }))}>
                      <option value="">Unassigned</option>
                      {staffList.map(s => (
                        <option key={s.id} value={s.fullName}>{s.fullName} ({s.position})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Summary</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              <Field label="Counselor"        value={lead.counselor}/>
              <Field label="Senior Counselor" value={lead.seniorCounselor}/>
              <Field label="Pre-Sales"        value={lead.presales}/>
              <Field label="Marketing Staff"  value={lead.marketingStaff}/>
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:'0.5rem', marginTop:'0.25rem' }}>
                <Field label="Stone Tier"  value={lead.stoneTier}/>
                <Field label="Risk Score"  value={lead.riskScore}/>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
