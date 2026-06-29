// src/pages/Lead.jsx
// -----------------------------------------------------------------------------
// Lead (ENGAGEMENT) Detail — first pass of the richer screen.
// Route: /lead/:leadId.
//   * Sectioned, editable lead fields (Status & Assignment / Academic & Target /
//     Self Assessment / Source & Marketing / Rationale)
//   * Inherited-from-student context (read-only): identity, family, OCEAN
//   * Lead-level Notes (topic allowed) and lead-level Documents
//
// First-pass notes: inputs are plain text for now — staff-list / lookup dropdowns
// and the full structured note form are the next refinement.
// -----------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { leadAPI, studentAPI, staffAPI, notesAPI, documentsAPI } from '../services/api';
import { useLookup } from '../contexts/LookupContext';
import { FIELD_OPTIONS, STAFF_FIELDS, statusColor } from '../utils/fieldOptions';
import { FiArrowLeft, FiEdit2, FiSave, FiX, FiPlus, FiUploadCloud, FiExternalLink } from 'react-icons/fi';

const card    = { background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem 1.5rem', marginBottom: '1.25rem' };
const h2      = { fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1rem' };
const lbl     = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4 };
const val     = { fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: 2, wordBreak: 'break-word' };
const inp     = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit' };
const grid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' };
const backBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '1rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.875rem' };
const linkBtn = { background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' };
const iconBtn = { display: 'inline-flex', alignItems: 'center', gap: 6 };

const SECTIONS = [
  { title: 'Status', fields: [
    ['leadStatus', 'Status'], ['confidence', 'Confidence'], ['closeDate', 'Projected close date', 'date'], ['distributionStatus', 'Distribution'],
  ] },
  { title: 'Assignment', fields: [
    ['counselor', 'Counsellor'], ['seniorCounselor', 'Senior Counsellor'], ['presales', 'Pre-Sales'], ['marketingStaff', 'Marketing'],
  ] },
  { title: 'Academic & Target', fields: [
    ['intake', 'Intake'], ['degreeLevel', 'Degree'], ['targetInstitution', 'Target Institution'],
    ['major', 'Major'], ['destinationCountry', 'Destination'], ['timeline', 'Timeline'],
    ['studyPlans', 'Study Plans'], ['processApplication', 'Process'],
  ] },
];
const ALL_KEYS = [...SECTIONS.flatMap(s => s.fields.map(f => f[0])), 'rationale'];
const NOTE_TYPES = ['counselor', 'presales', 'management'];

function fmtDate(v) { if (!v) return '—'; try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v); } }
function fmtDateTime(v) { if (!v) return ''; try { return new Date(v).toISOString().replace('T', ' ').slice(0, 16); } catch { return String(v); } }
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function Chip({ status }) {
  if (!status) return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
  return <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: statusColor(status), padding: '2px 10px', borderRadius: 20 }}>{status}</span>;
}

export default function Lead() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const topicOptions = useLookup('note_topic');
  const [staffNames, setStaffNames] = useState([]);

  const [lead, setLead]       = useState(null);
  const [student, setStudent] = useState(null);
  const [notes, setNotes]     = useState([]);
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState({});
  const [saving, setSaving]   = useState(false);

  // note form
  const [noteType, setNoteType] = useState('counselor');
  const [noteTopic, setNoteTopic] = useState('');
  const [noteSummary, setNoteSummary] = useState('');
  const [noteNextSteps, setNoteNextSteps] = useState('');
  const [noteFollowUp, setNoteFollowUp] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  // doc upload
  const [docFile, setDocFile] = useState(null);
  const [docType, setDocType] = useState('');
  const [docDesc, setDocDesc] = useState('');
  const [docSaving, setDocSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const lRes = await leadAPI.get(leadId);
        if (!alive) return;
        const ld = lRes.data;
        setLead(ld);
        const [sRes, nRes, dRes] = await Promise.all([
          ld?.studentId ? studentAPI.get(ld.studentId).catch(() => null) : Promise.resolve(null),
          notesAPI.listForLead(leadId).catch(() => ({ data: [] })),
          documentsAPI.listForLead(leadId).catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        setStudent(sRes?.data || null);
        setNotes(nRes?.data || []);
        setDocs(dRes?.data || []);
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load lead');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [leadId]);

  useEffect(() => {
    staffAPI.listActive()
      .then(r => setStaffNames((r.data || []).map(s => s.fullName || s.name).filter(Boolean)))
      .catch(() => {});
  }, []);

  function startEdit() {
    const d = {};
    for (const k of ALL_KEYS) d[k] = lead[k] ?? '';
    setDraft(d); setEditing(true);
  }
  function cancelEdit() { setEditing(false); setDraft({}); }
  async function save() {
    setSaving(true);
    try { const res = await leadAPI.update(leadId, draft); setLead(res.data); setEditing(false); setDraft({}); }
    catch (e) { alert(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function addNote() {
    if (!noteSummary.trim()) { alert('Summary is required.'); return; }
    setNoteSaving(true);
    try {
      const content = [
        `Summary: ${noteSummary.trim()}`,
        noteNextSteps.trim() ? `Next Steps: ${noteNextSteps.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      const res = await notesAPI.addForLead(leadId, noteType, content, { topic: noteTopic || null, followUpDate: noteFollowUp || null });
      setNotes(prev => [res.data, ...prev]);
      setNoteTopic(''); setNoteSummary(''); setNoteNextSteps(''); setNoteFollowUp('');
    } catch (e) { alert(e.message || 'Could not add note'); }
    finally { setNoteSaving(false); }
  }

  async function uploadDoc() {
    if (!docFile) { alert('Choose a file.'); return; }
    if (!docDesc.trim()) { alert('Description is required.'); return; }
    setDocSaving(true);
    try {
      const fileData = await fileToBase64(docFile);
      const res = await documentsAPI.uploadForLead(leadId, { fileName: docFile.name, type: docType || '', description: docDesc.trim(), fileData });
      setDocs(prev => [...prev, res.data]);
      setDocFile(null); setDocType(''); setDocDesc('');
    } catch (e) { alert(e.message || 'Upload failed'); }
    finally { setDocSaving(false); }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading…</div>;
  if (error)   return <div style={{ padding: 24, color: '#dc2626' }}>{error}</div>;
  if (!lead)   return <div style={{ padding: 24 }}>Lead not found.</div>;

  const optList = (opts, cur) => (cur && !opts.includes(cur) ? [cur, ...opts] : opts);
  const renderField = ([key, label, type]) => {
    const onCh = e => setDraft(d => ({ ...d, [key]: e.target.value }));
    let control;
    if (!editing) {
      control = key === 'leadStatus'
        ? <div style={val}><Chip status={lead.leadStatus} /></div>
        : <div style={val}>{lead[key] || '—'}</div>;
    } else if (STAFF_FIELDS.has(key)) {
      control = (
        <select style={inp} value={draft[key] ?? ''} onChange={onCh}>
          <option value="">—</option>
          {optList(staffNames, draft[key]).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    } else if (FIELD_OPTIONS[key]) {
      control = (
        <select style={inp} value={draft[key] ?? ''} onChange={onCh}>
          <option value="">—</option>
          {optList(FIELD_OPTIONS[key], draft[key]).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else {
      control = <input type={type || 'text'} style={inp} value={draft[key] ?? ''} onChange={onCh} />;
    }
    return <div key={key}><label style={lbl}>{label}</label>{control}</div>;
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <button onClick={() => navigate(-1)} style={backBtn}><FiArrowLeft size={15} /> Back</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Lead #{lead.leadId}</h1>
          <div style={{ marginTop: 6, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Student:{' '}
            <button onClick={() => navigate(`/students/${lead.studentId}`)} style={linkBtn}>
              {student?.fullName || lead.studentId} <span style={{ fontFamily: 'monospace' }}>({lead.studentId})</span>
            </button>
          </div>
        </div>
        {!editing
          ? <button className="btn btn--primary" onClick={startEdit} style={iconBtn}><FiEdit2 size={14} /> Edit</button>
          : <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={cancelEdit} style={iconBtn}><FiX size={14} /> Cancel</button>
              <button className="btn btn--primary" onClick={save} disabled={saving} style={iconBtn}><FiSave size={14} /> {saving ? 'Saving…' : 'Save Changes'}</button>
            </div>}
      </div>

      {/* Editable lead sections */}
      {SECTIONS.map(sec => (
        <div style={card} key={sec.title}>
          <h2 style={h2}>{sec.title}</h2>
          <div style={grid}>{sec.fields.map(renderField)}</div>
        </div>
      ))}

      {/* Rationale */}
      <div style={card}>
        <h2 style={h2}>Rationale</h2>
        {editing
          ? <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={draft.rationale ?? ''} onChange={e => setDraft(d => ({ ...d, rationale: e.target.value }))} />
          : <div style={val}>{lead.rationale || '—'}</div>}
      </div>

      {/* Identity / family / OCEAN / Self Assessment / Source live on the Student screen — not duplicated here. */}

      {/* Lead notes */}
      <div style={card}>
        <h2 style={h2}>Notes <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>({notes.length})</span></h2>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.875rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', marginBottom: '0.6rem' }}>
            <div><label style={lbl}>Type</label>
              <select style={inp} value={noteType} onChange={e => setNoteType(e.target.value)}>
                {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><label style={lbl}>Topic</label>
              <select style={inp} value={noteTopic} onChange={e => setNoteTopic(e.target.value)}>
                <option value="">— optional —</option>
                {topicOptions.map(o => <option key={o.code} value={o.code}>{o.labelEn || o.labelVi || o.code}</option>)}
              </select></div>
            <div><label style={lbl}>Follow-up</label><input type="date" style={inp} value={noteFollowUp} onChange={e => setNoteFollowUp(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: '0.6rem' }}><label style={lbl}>Summary <span style={{ color: '#dc2626' }}>*</span></label>
            <textarea rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="What was discussed?" value={noteSummary} onChange={e => setNoteSummary(e.target.value)} /></div>
          <div style={{ marginBottom: '0.6rem' }}><label style={lbl}>Next Steps</label>
            <textarea rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="What happens next?" value={noteNextSteps} onChange={e => setNoteNextSteps(e.target.value)} /></div>
          <button className="btn btn--primary" onClick={addNote} disabled={noteSaving} style={iconBtn}><FiPlus size={13} /> {noteSaving ? 'Adding…' : 'Add Note'}</button>
        </div>
        {notes.length === 0 ? <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No notes yet.</div> : notes.map(n => (
          <div key={n.id} style={{ borderTop: '1px solid var(--border)', padding: '0.625rem 0' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{n.noteType}</strong>{n.topic ? ` · ${n.topic}` : ''} · {n.authorName || '—'} · {fmtDateTime(n.createdAt)}
              {n.followUpDate ? ` · follow-up ${fmtDate(n.followUpDate)}` : ''}
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{n.content}</div>
          </div>
        ))}
      </div>

      {/* Lead documents */}
      <div style={card}>
        <h2 style={h2}>Documents <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>({docs.length})</span>
          <span style={{ fontWeight: 500, color: 'var(--text-secondary)', fontSize: '0.78rem' }}> — study / finance / lead-specific</span>
        </h2>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.875rem', marginBottom: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={lbl}>File</label><input type="file" onChange={e => setDocFile(e.target.files?.[0] || null)} style={{ fontSize: '0.8rem' }} /></div>
          <div style={{ flex: '1 1 140px' }}><label style={lbl}>Type</label><input style={inp} value={docType} onChange={e => setDocType(e.target.value)} placeholder="e.g. Finance" /></div>
          <div style={{ flex: '2 1 200px' }}><label style={lbl}>Description</label><input style={inp} value={docDesc} onChange={e => setDocDesc(e.target.value)} placeholder="required" /></div>
          <button className="btn btn--primary" onClick={uploadDoc} disabled={docSaving} style={iconBtn}><FiUploadCloud size={14} /> {docSaving ? 'Uploading…' : 'Upload'}</button>
        </div>
        {docs.length === 0 ? <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No documents yet.</div> : docs.map(d => (
          <div key={d.documentId} style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0', display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.875rem' }}>
            <div><strong>{d.description || d.fileName}</strong> <span style={{ color: 'var(--text-secondary)' }}>{d.type ? `· ${d.type}` : ''} · {fmtDate(d.timestamp)}</span></div>
            {d.viewUrl ? <a href={d.viewUrl} target="_blank" rel="noreferrer" style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Open <FiExternalLink size={12} /></a> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
