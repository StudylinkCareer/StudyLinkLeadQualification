// C:/Users/rhod_/Documents/StudyLinkLeadQualification/LeadManagement/src/pages/LeadDetail.jsx
// CHANGES (this session):
//   - Family Contacts section now editable in Edit mode (mother/father name,
//     email, phone, contact medium, contact detail)
//   - Family contact fields added to saveAll() update payload
//   - Added CONTACT_MEDIUM_OPTS constant for Contact Medium dropdowns
//   - enterEdit() now seeds editData with _raw_ (unmasked) values so saving
//     never writes masked display values back to the database
// PREVIOUS CHANGES:
//   - Added campaignType, campaignName, campaignStart, campaignEnd to FIELD_LABELS
//   - Added 4 read-only campaign fields to Student Information view section
//   - Event/Campaign block now renders unconditionally; <Field> shows '—' for empty values.
//   - Permissions are now fully table-driven via usePermissions(). The
//     previous PERMS object (hardcoded role-name arrays) and canDo() helper
//     have been removed. Each check now reads role_permissions through
//     the RBAC tables. Mapping from the old PERMS rules to the new helpers:
//       canEdit              → canDoOnLead('leads', 'edit', lead)
//       canEditAssignment    → canDoOnLead('leads', 'assign', lead)
//       canRecalculate       → canDoOnLead('leads', 'recalculate', lead)
//       canDelayCloseDate    → canDoOnLead('leads', 'delay_close_date', lead)
//       canWriteNote.<kind>  → canDo('notes', 'write_<kind>')

import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { studentAPI, leadAPI, staffAPI, notesAPI, auditAPI, leadEventsAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLookup } from '../contexts/LookupContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import Watermark from '../components/Watermark';
import TrailBackButton from '../components/TrailBackButton';
import LeadEventsSection from '../components/LeadEventsSection';
import { FiArrowLeft, FiPlus, FiSend, FiTrash2, FiEdit2, FiX, FiSave, FiChevronDown, FiChevronUp, FiRefreshCw, FiUser, FiGrid, FiPhone } from 'react-icons/fi';
import { getArchetype, GROUP_COLORS } from '../utils/oceanArchetypes';
import { containsPhoneMention } from '../utils/phoneAliases';

// ── NoteForm ─────────────────────────────────────────────────────────────────
// Unified structured note form. All 5 fields mandatory.
// onSubmit receives: { topic, summary, nextSteps, reason, followUpDate }
function NoteForm({ onSubmit, saving, topicOptions, disabled }) {
  const [topic,        setTopic]        = useState('');
  const [summary,      setSummary]      = useState('');
  const [nextSteps,    setNextSteps]    = useState('');
  const [reason,       setReason]       = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const fld = { display:'block', fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.375rem' };
  const inp = { width:'100%', resize:'vertical', boxSizing:'border-box', padding:'0.625rem 0.75rem', borderRadius:'8px', border:'1px solid var(--border)', fontSize:'0.875rem', background:'var(--bg-secondary)', color:'var(--text-primary)', fontFamily:'inherit', lineHeight:1.5 };
  const sel = { ...inp, resize:'none', cursor:'pointer' };
  const isValid = topic && summary.trim() && nextSteps.trim() && reason.trim() && followUpDate;

  function handleSubmit() {
    if (!topic)            { alert('Topic / Objective is required.'); return; }
    if (!summary.trim())   { alert('Summary is required.'); return; }
    if (!nextSteps.trim()) { alert('Next Steps is required.'); return; }
    if (!reason.trim())    { alert('Reason is required.'); return; }
    if (!followUpDate)     { alert('Follow-up Date is required.'); return; }
    onSubmit({ topic, summary: summary.trim(), nextSteps: nextSteps.trim(), reason: reason.trim(), followUpDate });
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
      <div>
        <label style={fld}>Topic / Objective <span style={{ color:'#dc2626' }}>*</span></label>
        <select value={topic} onChange={e=>setTopic(e.target.value)} disabled={disabled} style={sel}>
          <option value="">— Select topic —</option>
          {(topicOptions||[]).map(o=><option key={o.code} value={o.code}>{o.labelEn||o.code}</option>)}
        </select>
      </div>
      <div>
        <label style={fld}>Summary <span style={{ color:'#dc2626' }}>*</span></label>
        <textarea rows={3} placeholder="What was discussed?" value={summary}
          onChange={e=>setSummary(e.target.value)} disabled={disabled} style={inp}/>
      </div>
      <div>
        <label style={fld}>Next Steps <span style={{ color:'#dc2626' }}>*</span></label>
        <textarea rows={2} placeholder="What needs to happen next?" value={nextSteps}
          onChange={e=>setNextSteps(e.target.value)} disabled={disabled} style={inp}/>
      </div>
      <div>
        <label style={fld}>Reason <span style={{ color:'#dc2626' }}>*</span></label>
        <textarea rows={2} placeholder="Why is this action / follow-up needed?" value={reason}
          onChange={e=>setReason(e.target.value)} disabled={disabled} style={inp}/>
      </div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:'1rem', flexWrap:'wrap' }}>
        <div>
          <label style={fld}>Follow-up Date <span style={{ color:'#dc2626' }}>*</span></label>
          <input type="date" value={followUpDate} onChange={e=>setFollowUpDate(e.target.value)}
            disabled={disabled}
            style={{ padding:'0.5rem 0.75rem', borderRadius:'8px', border:'1px solid var(--border)', fontSize:'0.875rem', background:'var(--bg-secondary)', color:'var(--text-primary)', fontFamily:'inherit', opacity:disabled?0.6:1 }}/>
        </div>
        <button className="btn btn--primary" onClick={handleSubmit}
          disabled={saving||!isValid||disabled}
          style={{ display:'flex', alignItems:'center', gap:'0.4rem', opacity:(saving||!isValid||disabled)?0.5:1, cursor:(saving||!isValid||disabled)?'not-allowed':'pointer' }}>
          <FiSave size={13}/>{saving?'Saving...':'Save Note'}
        </button>
      </div>
    </div>
  );
}

// ── NoteCard ─────────────────────────────────────────────────────────────────
// isLatest=true shows reminder controls + append panel.
function NoteCard({ note, staff, canAppend, onDelete, onAppend, onUpdateReminder, isLatest }) {
  const [appendOpen,     setAppendOpen]     = useState(false);
  const [appSaving,      setAppSaving]      = useState(false);
  const [appSummary,     setAppSummary]     = useState('');
  const [appSteps,       setAppSteps]       = useState('');
  const [appReason,      setAppReason]      = useState('');
  const [appDate,        setAppDate]        = useState('');
  const [reschedOpen,    setReschedOpen]    = useState(false);
  const [newDate,        setNewDate]        = useState('');
  const [reminderSaving, setReminderSaving] = useState(false);

  const fld = { display:'block', fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.375rem' };
  const inp = { width:'100%', resize:'vertical', boxSizing:'border-box', padding:'0.5rem 0.625rem', borderRadius:'8px', border:'1px solid var(--border)', fontSize:'0.875rem', background:'var(--bg-primary)', color:'var(--text-primary)', fontFamily:'inherit', lineHeight:1.5 };
  const appValid = appSummary.trim() && appSteps.trim() && appReason.trim() && appDate;

  const STATUS_COLORS = { active:'#10b981', closed:'#6b7280', rescheduled:'#f59e0b', superseded:'#d1d5db' };
  const STATUS_LABELS = { active:'Active', closed:'Closed', rescheduled:'Rescheduled', superseded:'Superseded' };
  const reminderStatus = note.reminderStatus || 'active';
  const hasReminder    = !!note.followUpDate;
  const effDate        = note.rescheduledDate || note.followUpDate;

  async function handleAppend() {
    if (!appSummary.trim()) { alert('Summary is required.'); return; }
    if (!appSteps.trim())   { alert('Next Steps is required.'); return; }
    if (!appReason.trim())  { alert('Reason is required.'); return; }
    if (!appDate)           { alert('Follow-up Date is required.'); return; }
    setAppSaving(true);
    try {
      const now = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const addendum = [
        '\n─────────────────────────────────',
        'Addendum — ' + (staff?.fullName||'') + '  |  ' + now,
        '',
        'Summary:\n' + appSummary.trim(),
        '\nNext Steps:\n' + appSteps.trim(),
        '\nReason:\n' + appReason.trim(),
        '\nFollow-up Date: ' + appDate,
      ].join('\n');
      await onAppend(note.id, addendum, appDate);
      setAppSummary(''); setAppSteps(''); setAppReason(''); setAppDate('');
      setAppendOpen(false);
    } catch(e) { alert(e.message); }
    finally { setAppSaving(false); }
  }

  async function handleClose() {
    setReminderSaving(true);
    try { await onUpdateReminder(note.id, { reminderStatus:'closed' }); }
    catch(e) { alert(e.message); }
    finally { setReminderSaving(false); }
  }

  async function handleReschedule() {
    if (!newDate) return;
    setReminderSaving(true);
    try {
      await onUpdateReminder(note.id, { reminderStatus:'rescheduled', rescheduledDate:newDate });
      setReschedOpen(false); setNewDate('');
    } catch(e) { alert(e.message); }
    finally { setReminderSaving(false); }
  }

  return (
    <div style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'8px', overflow:'hidden',
      borderLeft: hasReminder ? `3px solid ${STATUS_COLORS[reminderStatus]}` : undefined }}>
      <div style={{ padding:'0.625rem 0.875rem', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem', background:'var(--bg-secondary)' }}>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.8125rem', fontWeight:500, color:'var(--text-secondary)' }}>{note.authorName}</span>
          {hasReminder && (
            <span style={{ fontSize:'0.7rem', fontWeight:700, borderRadius:'4px', padding:'1px 7px',
              background:STATUS_COLORS[reminderStatus]+'22', color:STATUS_COLORS[reminderStatus],
              border:`1px solid ${STATUS_COLORS[reminderStatus]}44` }}>
              {STATUS_LABELS[reminderStatus]}
              {effDate && ` · ${new Date(effDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`}
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono' }}>{formatDate(note.createdAt)}</span>
          {note.authorId===staff?.id && (
            <button className="btn btn--ghost btn--icon btn--sm" onClick={()=>onDelete(note.id)} style={{ color:'var(--danger)' }}>
              <FiTrash2 size={13}/>
            </button>
          )}
        </div>
      </div>
      <div style={{ padding:'0.75rem 0.875rem', fontSize:'0.9375rem', whiteSpace:'pre-wrap' }}>{note.content}</div>
      {isLatest && hasReminder && (reminderStatus==='active'||reminderStatus==='rescheduled') && (
        <div style={{ padding:'0 0.875rem 0.75rem', display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
          {!reschedOpen ? (
            <>
              <button disabled={reminderSaving} onClick={handleClose}
                style={{ padding:'0.25rem 0.75rem', borderRadius:'6px', border:'1px solid var(--border)', background:'var(--bg-secondary)', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer', color:'#6b7280' }}>
                ✓ Close reminder
              </button>
              <button disabled={reminderSaving} onClick={()=>setReschedOpen(true)}
                style={{ padding:'0.25rem 0.75rem', borderRadius:'6px', border:'1px solid #f59e0b', background:'#fef3c7', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer', color:'#92400e' }}>
                ↻ Reschedule
              </button>
            </>
          ) : (
            <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:'0.8125rem', fontWeight:600 }}>New date:</span>
              <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)}
                style={{ padding:'0.3rem 0.5rem', borderRadius:'6px', border:'1px solid var(--border)', fontSize:'0.8125rem' }}/>
              <button disabled={reminderSaving||!newDate} onClick={handleReschedule}
                style={{ padding:'0.25rem 0.75rem', borderRadius:'6px', border:'none', background:'var(--primary)', color:'#fff', fontSize:'0.8125rem', fontWeight:600, cursor:newDate?'pointer':'not-allowed', opacity:newDate?1:0.5 }}>
                {reminderSaving?'Saving…':'Confirm'}
              </button>
              <button onClick={()=>{setReschedOpen(false);setNewDate('');}}
                style={{ padding:'0.25rem 0.5rem', borderRadius:'6px', border:'1px solid var(--border)', background:'transparent', fontSize:'0.8125rem', cursor:'pointer' }}>Cancel</button>
            </div>
          )}
        </div>
      )}
      {isLatest && canAppend && reminderStatus!=='closed' && (
        <div style={{ borderTop:'1px solid var(--border)' }}>
          <button onClick={()=>setAppendOpen(o=>!o)}
            style={{ width:'100%', padding:'0.5rem 0.875rem', background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.8125rem', fontWeight:600, color:'var(--primary)', textAlign:'left' }}>
            <FiEdit2 size={13}/>{appendOpen?'Cancel':'Add Update / Reschedule'}
          </button>
          {appendOpen && (
            <div style={{ padding:'0.875rem', background:'var(--bg-secondary)', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', fontStyle:'italic' }}>
                Add an update to this thread. The new follow-up date will become the active reminder.
              </div>
              <div>
                <label style={fld}>Summary <span style={{ color:'#dc2626' }}>*</span></label>
                <textarea rows={2} placeholder="What has changed / been discussed?" value={appSummary} onChange={e=>setAppSummary(e.target.value)} style={inp}/>
              </div>
              <div>
                <label style={fld}>Next Steps <span style={{ color:'#dc2626' }}>*</span></label>
                <textarea rows={2} placeholder="Updated next steps" value={appSteps} onChange={e=>setAppSteps(e.target.value)} style={inp}/>
              </div>
              <div>
                <label style={fld}>Reason <span style={{ color:'#dc2626' }}>*</span></label>
                <textarea rows={2} placeholder="Why is the follow-up date being changed?" value={appReason} onChange={e=>setAppReason(e.target.value)} style={inp}/>
              </div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:'1rem', flexWrap:'wrap' }}>
                <div>
                  <label style={fld}>New Follow-up Date <span style={{ color:'#dc2626' }}>*</span></label>
                  <input type="date" value={appDate} onChange={e=>setAppDate(e.target.value)}
                    style={{ padding:'0.5rem 0.625rem', borderRadius:'8px', border:'1px solid var(--border)', fontSize:'0.875rem', background:'var(--bg-secondary)', color:'var(--text-primary)', fontFamily:'inherit' }}/>
                </div>
                <button className="btn btn--primary" onClick={handleAppend} disabled={appSaving||!appValid}
                  style={{ display:'flex', alignItems:'center', gap:'0.4rem', opacity:appValid?1:0.5, cursor:appValid?'pointer':'not-allowed' }}>
                  <FiSave size={13}/>{appSaving?'Saving...':'Save Update'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── NoteThread ────────────────────────────────────────────────────────────────
function NoteThread({ topic, notes, staff, canAppend, onDelete, onAppend, onUpdateReminder, matchFn }) {
  const [expanded, setExpanded] = useState(false);
  const sorted     = [...notes].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const latest     = sorted[sorted.length-1];
  const history    = sorted.slice(0, sorted.length-1);
  const hasHistory = history.length > 0;
  const STATUS_COLORS = { active:'#10b981', closed:'#6b7280', rescheduled:'#f59e0b', superseded:'#d1d5db' };
  const threadStatus  = latest?.reminderStatus || 'active';
  const isClosed      = threadStatus === 'closed';
  // Filter mode: show ONLY entries that match, newest-first, as read-only search
  // results. The reminder/append workflow stays in the unfiltered full view.
  const filtering = typeof matchFn === 'function';
  const matches   = filtering ? sorted.filter(matchFn) : sorted;   // ascending
  if (filtering && matches.length === 0) return null;

  return (
    <div style={{ borderRadius:'10px', border:'1px solid var(--border)', overflow:'hidden', opacity:isClosed?0.65:1 }}>
      <div style={{ padding:'0.5rem 0.875rem', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'0.625rem', flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.875rem', fontWeight:700, color:'var(--primary)' }}>{topic||'General'}</span>
          <span style={{ fontSize:'0.7rem', fontWeight:700, borderRadius:'4px', padding:'1px 7px',
            background:STATUS_COLORS[threadStatus]+'22', color:STATUS_COLORS[threadStatus],
            border:`1px solid ${STATUS_COLORS[threadStatus]}44` }}>
            {threadStatus.charAt(0).toUpperCase()+threadStatus.slice(1)}
          </span>
          <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
            {filtering
              ? `${matches.length} of ${notes.length} match`
              : `${notes.length} ${notes.length===1?'entry':'entries'}`}
          </span>
        </div>
        {!filtering && hasHistory && (
          <button onClick={()=>setExpanded(e=>!e)}
            style={{ background:'none', border:'1px solid var(--border)', borderRadius:'6px', cursor:'pointer',
              padding:'2px 10px', fontSize:'0.8125rem', fontWeight:700, color:'var(--text-secondary)',
              display:'flex', alignItems:'center', gap:'4px' }}>
            {expanded?'−':`+${history.length}`}
            <span style={{ fontSize:'0.7rem', fontWeight:400 }}>{expanded?'collapse':'history'}</span>
          </button>
        )}
      </div>
      {filtering ? (
        // Only the matching entries, newest-first, read-only.
        [...matches].reverse().map((note, i)=>(
          <div key={note.id} style={{ borderTop: i>0 ? '1px solid var(--border)' : undefined }}>
            <NoteCard note={note} staff={staff} canAppend={false}
              onDelete={onDelete} onAppend={onAppend} onUpdateReminder={onUpdateReminder} isLatest={false}/>
          </div>
        ))
      ) : (
        // Newest-first: the latest (active) entry on top, history below in
        // reverse-chronological order.
        <>
          <NoteCard note={latest} staff={staff} canAppend={canAppend}
            onDelete={onDelete} onAppend={onAppend} onUpdateReminder={onUpdateReminder} isLatest={true}/>
          {expanded && [...history].reverse().map(note=>(
            <div key={note.id} style={{ borderTop:'1px solid var(--border)', opacity:0.75 }}>
              <NoteCard note={note} staff={staff} canAppend={false}
                onDelete={onDelete} onAppend={onAppend} onUpdateReminder={onUpdateReminder} isLatest={false}/>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── MessengerSearch ──────────────────────────────────────────────────────────
// Two-step flow: Step 1 copies the name, Step 2 opens Messenger.
// Kept as a separate component so useState works cleanly without
// browser clipboard/popup security conflicts.
function MessengerSearch({ studentName, actionBtnStyle, onContacted }) {
  const [searchName, setSearchName] = useState(studentName || '');
  const [copied, setCopied]         = useState(false);

  function handleCopy() {
    const el = document.createElement('textarea');
    el.value = searchName;
    el.style.position = 'fixed';
    el.style.opacity  = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setCopied(true);
    if (onContacted) onContacted();
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.5rem', lineHeight:1.5 }}>
        Step 1 — copy the name (edit if needed), then Step 2 — open Messenger and paste into the search box:
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.625rem' }}>
        <input
          value={searchName}
          onChange={e => { setSearchName(e.target.value); setCopied(false); }}
          style={{ flex:1, padding:'0.5rem 0.75rem', borderRadius:'6px', border:'1px solid var(--border)', fontSize:'0.9375rem', fontWeight:600, color:'var(--text-primary)', background:'var(--bg-primary)', fontFamily:'inherit' }}
        />
        <button onClick={handleCopy}
          style={{ padding:'0.5rem 0.875rem', borderRadius:'6px', border:'none', background: copied ? '#16a34a' : 'var(--primary)', color:'#fff', cursor:'pointer', fontSize:'0.8125rem', fontWeight:600, whiteSpace:'nowrap', transition:'background 0.2s' }}>
          {copied ? '✓ Copied!' : 'Copy Name'}
        </button>
      </div>
      <a href="https://www.messenger.com/" target="_blank" rel="noreferrer"
        style={{ ...actionBtnStyle('#0084ff'), opacity: copied ? 1 : 0.5, pointerEvents: copied ? 'auto' : 'none', display:'inline-flex' }}>
        M Open Messenger {!copied && '(copy name first)'}
      </a>
      {copied && (
        <div style={{ fontSize:'0.75rem', color:'#16a34a', marginTop:'0.5rem' }}>
          Name copied — paste it into the Messenger search box.
        </div>
      )}
      <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', marginTop:'0.625rem', lineHeight:1.5 }}>
        Tip: save the student’s Facebook username to the “Connect With Us” field for a direct link next time.
      </div>
    </div>
  );
}

// ── Contact Log Modal ────────────────────────────────────────────────────────
// Handles all contact methods. Email shows Outlook+Gmail launchers with
// pre-filled subject/body. SMS/WhatsApp pre-fill opening message.
// All methods capture summary, next steps, follow-up date and log a note.
const EMAIL_SUBJECT = 'We at StudyLink are proud to serve you';
const CONTACT_COLORS = { call:'#16a34a', sms:'#2563eb', zalo:'#0068ff', whatsapp:'#25d366', messenger:'#0084ff', email:'#0072c6', gmail:'#ea4335' };
const CONTACT_LABELS = { call:'Phone Call', sms:'Text Message', zalo:'Zalo', whatsapp:'WhatsApp', messenger:'Messenger', email:'Email' };
const CONTACT_ICONS  = { call:'📞', sms:'💬', zalo:'Z', whatsapp:'W', messenger:'M', email:'✉' };

function toIntlPhone(phone) {
  if (!phone) return '';
  const d = String(phone).replace(/[^0-9]/g, '');
  return d.startsWith('0') ? '84' + d.slice(1) : d;
}

function ContactLogModal({ method, studentName, studentEmail, studentPhone, connectWithUs, staffName, timestamp, documents, onSave, onCancel, topicOptions }) {
  const [saving, setSaving] = useState(false);
  // Once the counsellor opens a communication medium (clicks an action button),
  // the note becomes mandatory — they cannot cancel or close until saved.
  const [contacted,    setContacted]    = useState(false);

  // Block browser close/refresh/navigation while note is mandatory
  useEffect(() => {
    if (!contacted) return;
    const handler = e => {
      e.preventDefault();
      e.returnValue = 'You must save the contact note before leaving.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [contacted]);

  const isEmail    = method === 'email';
  const isSMS      = method === 'sms';
  const isWhatsApp = method === 'whatsapp';
  const isZalo     = method === 'zalo';
  const isMessenger= method === 'messenger';

  const icon  = CONTACT_ICONS[method]  || '📞';
  const label = CONTACT_LABELS[method] || 'Contact';
  const color = CONTACT_COLORS[method] || '#2563eb';

  const displayTime = new Date(timestamp).toLocaleString('en-GB', {
    day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit',
  });

  const intlPhone = toIntlPhone(studentPhone);
  const dearLine  = 'Dear ' + (studentName || 'Student') + ',';

  // Pre-filled message body for SMS and WhatsApp
  const defaultMessage = dearLine + '\n\n';

  // Email deep links — Outlook Web and Gmail
  const emailSubjectEnc = encodeURIComponent(EMAIL_SUBJECT);
  const emailBodyEnc    = encodeURIComponent(dearLine + '\n\n');
  const outlookUrl = 'https://outlook.office.com/mail/deeplink/compose?to=' + encodeURIComponent(studentEmail||'') + '&subject=' + emailSubjectEnc + '&body=' + emailBodyEnc;
  const gmailUrl   = 'https://mail.google.com/mail/?view=cm&to=' + encodeURIComponent(studentEmail||'') + '&su=' + emailSubjectEnc + '&body=' + emailBodyEnc;

  // SMS and WhatsApp links with pre-filled message
  const smsUrl      = 'sms:' + (studentPhone||'') + '?body=' + encodeURIComponent(defaultMessage);
  const whatsappUrl = 'https://wa.me/' + intlPhone + '?text=' + encodeURIComponent(defaultMessage);

  // Zalo — opens to contact profile or add-friend
  const zaloUrl = 'https://zalo.me/' + intlPhone;

  // Messenger — use connectWithUs (username/URL) if available,
  // otherwise open messenger.com so the counsellor can search by name.
  const messengerUrl = connectWithUs
    ? (connectWithUs.startsWith('http') ? connectWithUs : 'https://m.me/' + connectWithUs)
    : 'https://www.messenger.com/';

  function openLink(url) {
    if (!url) return;
    setContacted(true);
    const isDevice = url.startsWith('tel:') || url.startsWith('sms:');
    if (isDevice) window.location.href = url;
    else window.open(url, '_blank');
  }

  // handleSave replaced by NoteForm onSubmit inline

  const inputStyle = { width:'100%', resize:'vertical', boxSizing:'border-box', padding:'0.625rem 0.75rem', borderRadius:'8px', border:'1px solid var(--border)', fontSize:'0.875rem', background:'var(--bg-secondary)', color:'var(--text-primary)', fontFamily:'inherit', lineHeight:1.5 };
  const labelStyle = { display:'block', fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.375rem' };
  const actionBtnStyle = (bg) => ({ display:'inline-flex', alignItems:'center', gap:'0.5rem', padding:'0.5rem 1rem', borderRadius:'8px', border:'none', background:bg, color:'#fff', cursor:'pointer', fontSize:'0.8125rem', fontWeight:600, textDecoration:'none' });

  if (typeof window === 'undefined') return null;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:'48px' }}
      onClick={e => { if (e.target === e.currentTarget && !contacted) onCancel(); }}>
      <div style={{ background:'var(--bg-primary)', borderRadius:'14px', boxShadow:'0 20px 60px rgba(0,0,0,0.3)', width:'min(600px, calc(100vw - 32px))', maxHeight:'calc(100vh - 96px)', overflowY:'auto', display:'flex', flexDirection:'column' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'1.25rem 1.5rem 1rem', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
            <span style={{ width:'36px', height:'36px', borderRadius:'8px', background:color, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', fontWeight:700 }}>{icon}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:'1rem', color:'var(--text-primary)' }}>{label} — {studentName}</div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'2px' }}>{staffName} · {displayTime}</div>
            </div>
          </div>
          {contacted ? (
            <div title="Save the note before closing" style={{ padding:'4px', color:'var(--text-secondary)', opacity:0.3, cursor:'not-allowed' }}>
              <FiX size={18}/>
            </div>
          ) : (
            <button onClick={onCancel} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)', padding:'4px' }}><FiX size={18}/></button>
          )}
        </div>

        <div style={{ padding:'1.25rem 1.5rem', display:'flex', flexDirection:'column', gap:'1.25rem' }}>

          {/* ── EMAIL: Outlook + Gmail launchers ── */}
          {isEmail && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>Open email composer</div>
              <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', marginBottom:'0.75rem' }}>
                <a href={outlookUrl} target="_blank" rel="noreferrer" onClick={() => setContacted(true)} style={actionBtnStyle('#0072c6')}>
                  ✉ Outlook
                </a>
                <a href={gmailUrl} target="_blank" rel="noreferrer" onClick={() => setContacted(true)} style={actionBtnStyle('#ea4335')}>
                  ✉ Gmail
                </a>
              </div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', lineHeight:1.5 }}>
                Opens your email client pre-filled with:<br/>
                <strong>To:</strong> {studentEmail}<br/>
                <strong>Subject:</strong> {EMAIL_SUBJECT}<br/>
                <strong>Body:</strong> {dearLine} [your message]
              </div>
              {documents && documents.length > 0 && (
                <div style={{ marginTop:'0.75rem', paddingTop:'0.75rem', borderTop:'1px solid var(--border)' }}>
                  <div style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.5rem' }}>
                    📎 Attach from student documents (open the file, then attach manually):
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.25rem' }}>
                    {documents.map((doc, i) => (
                      <a key={i} href={doc.url || doc.fileUrl} target="_blank" rel="noreferrer"
                         style={{ fontSize:'0.8125rem', color:'var(--primary)', textDecoration:'none' }}>
                        📄 {doc.fileName || doc.name || 'Document ' + (i+1)}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── CALL: tel: hyperlink so counsellor can dial directly ── */}
          {method === 'call' && studentPhone && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>Make phone call</div>
              <a href={'tel:' + studentPhone}
                 onClick={() => setContacted(true)}
                 style={{ display:'inline-flex', alignItems:'center', gap:'0.5rem', padding:'0.5rem 1rem', borderRadius:'8px', background:'#16a34a', color:'#fff', fontSize:'0.8125rem', fontWeight:600, textDecoration:'none' }}>
                📞 Call {studentPhone}
              </a>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.625rem' }}>
                Opens your device dialler with {studentPhone} ready to dial.
              </div>
            </div>
          )}

          {/* ── SMS: open device SMS app ── */}
          {isSMS && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>Send text message</div>
              <a href={smsUrl} onClick={() => setContacted(true)} style={actionBtnStyle('#2563eb')}>
                💬 Open SMS — {studentPhone}
              </a>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.625rem', lineHeight:1.5 }}>
                Opens your phone’s SMS app with {studentPhone} and “Dear {studentName},” pre-filled.
              </div>
            </div>
          )}

          {/* ── WHATSAPP: open WhatsApp with pre-filled message ── */}
          {isWhatsApp && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>Open WhatsApp</div>
              <a href={whatsappUrl} target="_blank" rel="noreferrer" onClick={() => setContacted(true)} style={actionBtnStyle('#25d366')}>
                W Open WhatsApp — {studentPhone}
              </a>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.625rem', lineHeight:1.5 }}>
                Opens WhatsApp chat with {studentName}. Message pre-filled with “Dear {studentName},” — complete and send in WhatsApp.
              </div>
            </div>
          )}

          {/* ── ZALO: open Zalo to contact/add-friend ── */}
          {isZalo && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>Open Zalo</div>
              <a href={zaloUrl} target="_blank" rel="noreferrer" onClick={() => setContacted(true)} style={actionBtnStyle('#0068ff')}>
                Z Open Zalo — {studentPhone}
              </a>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.625rem', lineHeight:1.5 }}>
                Opens Zalo to {studentName}’s profile. If already a contact, opens the chat. If not, shows the Add Friend screen.
              </div>
            </div>
          )}

          {/* ── MESSENGER ── */}
          {isMessenger && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.75rem' }}>Open Messenger</div>
              {connectWithUs ? (
                <a href={messengerUrl} target="_blank" rel="noreferrer" onClick={() => setContacted(true)} style={actionBtnStyle('#0084ff')}>
                  M Open Messenger — {connectWithUs}
                </a>
              ) : (
                <>
                  {/* Step 1: Copy name. Step 2: Open Messenger. Two separate actions
                      because browsers block clipboard writes inside window.open calls. */}
                  <MessengerSearch studentName={studentName} actionBtnStyle={actionBtnStyle} onContacted={() => setContacted(true)}/>
                </>
              )}
            </div>
          )}

          {/* ── Documents panel (non-email methods) ── */}
          {!isEmail && documents && documents.length > 0 && (
            <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem' }}>
              <div style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.5rem' }}>
                📎 Student documents (open to share manually):
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.25rem' }}>
                {documents.map((doc, i) => (
                  <a key={i} href={doc.url || doc.fileUrl} target="_blank" rel="noreferrer"
                     style={{ fontSize:'0.8125rem', color:'var(--primary)', textDecoration:'none' }}>
                    📄 {doc.fileName || doc.name || 'Document ' + (i+1)}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ── Unified NoteForm ── */}
          <NoteForm
            topicOptions={topicOptions}
            saving={saving}
            onSubmit={async ({ topic, summary, nextSteps, reason, followUpDate }) => {
              setSaving(true);
              const parts = [
                icon + ' ' + label + ' — ' + studentName,
                'By: ' + staffName + '  |  ' + displayTime,
                'Topic: ' + topic,
                '',
                'Summary:\n' + summary,
                '\nNext Steps:\n' + nextSteps,
                '\nReason:\n' + reason,
                '\nFollow-up Date: ' + followUpDate,
              ];
              await onSave({ noteText: parts.join('\n'), topic, followUpDate, contactPlatform: label });
              setSaving(false);
            }}
          />
        </div>

        {/* Footer */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:'0.75rem', padding:'1rem 1.5rem', borderTop:'1px solid var(--border)', background:'var(--bg-secondary)', borderRadius:'0 0 14px 14px' }}>
          {contacted ? (
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flex:1 }}>
              <span style={{ fontSize:'0.8125rem', color:'var(--danger, #dc2626)', fontWeight:500 }}>
                ⚠️ Note required — please complete and save before continuing
              </span>
            </div>
          ) : (
            <button onClick={onCancel} style={{ padding:'0.5rem 1.25rem', borderRadius:'8px', border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', cursor:'pointer', fontSize:'0.875rem' }}>Cancel</button>
          )}
          {/* Save button rendered inside NoteForm */}
        </div>

      </div>
    </div>
  );
}

// ── Stone images ──────────────────────────────────────────────────────────────
import quartzImg   from '../Assets/Stones/quartz.png';
import agateImg    from '../Assets/Stones/agate.png';
import sapphireImg from '../Assets/Stones/sapphire.png';
import rubyImg     from '../Assets/Stones/ruby.png';
import diamondImg  from '../Assets/Stones/diamond.png';

const STONE_IMAGES = {
  Quartz:   quartzImg,
  Agate:    agateImg,
  Sapphire: sapphireImg,
  Ruby:     rubyImg,
  Diamond:  diamondImg,
};

const STONE_MESSAGES = {
  Quartz:   'StudyLink will support you with International Programs locally with Scholarships — a smart decision to enjoy world-class education while staying close to your family.',
  Agate:    'A journey to Asian and European cultures will help you broaden your mindset and develop excellent adaptability. StudyLink will be your Companion on this abroad journey, starting RIGHT NOW!',
  Sapphire: 'You possess a practical vision, and Europe or Australasia is the perfect environment for you to maximize your potential. StudyLink will be your Companion on this abroad journey, starting RIGHT NOW!',
  Ruby:     'You are ready to conquer great and beautiful challenges at leading educational powerhouses across 5 continents. StudyLink will be your Companion on this study abroad journey, starting RIGHT NOW!',
  Diamond:  'You can aim at the global "cathedrals" of knowledge, places reserved for the most excellent individuals. StudyLink will be your Companion on this study abroad journey, starting RIGHT NOW!',
};

// (Hardcoded PERMS object removed — all permission checks now go through
//  usePermissions(). See header comment above for the mapping.)

const LEAD_STATUSES = [
  'New',
  'Not contactable',
  'Engaged',
  'Vetted',
  'Met with customer and family',
  'Proposal',
  'Family negotiation/review',
  'Contracted',
  'Lost',
  'Nurturing',
  'Archived',
  'Cancelled',
];
const CONFIDENCE_OPTS = ['Low (0-30%)','Medium (31-60%)','High (61-90%)','Committed (91-100%)'];
const NOTE_TYPES      = { counselor:'Counselor Note', presales:'PreSales Note', management:'Management Note' };
const ENGLISH_LEVELS  = ['Beginner','IELTS 4-4.5','IELTS 5-5.5','IELTS 6-6.5','IELTS 7+'];
const GPA_OPTIONS     = ['< 6.5','6.5-6.9','7-7.9','8-8.9','9+'];
const BUDGET_OPTIONS  = ['< 300M VND','300-500M VND','500-800M VND','800M-1B VND','1-1.5B VND'];
const SCHOLARSHIP_OPTS= ['100% scholarship','60-90% scholarship','30-50% scholarship','20-25% scholarship','No scholarship needed'];
const IMMIGRATION_OPTS= ['Visa rejection (self)','Rejection/overstay (family)','No travel history','Travelled in Asia','Travelled to Western countries'];
const SPONSOR_OPTS    = ['< 300M VND','300-500M VND','500-800M VND','800M-1B VND','1-1.5B VND'];
const INCOME_OPTS     = ['0% documented','30-35% documented','50% documented','70-75% documented','100% documented'];
const STUDY_GAP_OPTS  = ['Different major, 5+ year gap','Different major, 2-5 year gap','Same major, 2-5 year gap','Same major, < 2 year gap','Same major, no gap'];
const OBJECTIVE_OPTS  = ['Migration only','Work only','Study but work more','Study for migration pathway','Study only'];
const STUDY_PLAN_OPTS = ['Study Abroad','English Summer Camp','Study in Vietnam','Do not study'];
const TIMELINE_OPTS   = ['Next 6 months','6-12 months','12-24 months','24-36 months','36+ months'];
const INTERACTION_OPTS= ['Only left contact','Queries','Fill lead form partly','Fill lead form fully','Call in-Walk in'];
const LEAD_SOURCE_OPTS= ['Databases','FB-Zalo-GG-TikTok ads','School outreach','Subagent referrals','Ex-client'];
const CONTACT_MEDIUM_OPTS = ['Phone','Zalo','Facebook','Messenger','WhatsApp','Email','Instagram','Threads','TikTok','Line','Telegram','Viber','YouTube','Skype'];

const LIKERT_LABELS = ['','Strongly Disagree','Disagree','Neutral','Agree','Strongly Agree'];

const OCEAN_QUESTIONS = [
  { id:1,  text:'I am the life of the party and enjoy being the center of attention.' },
  { id:2,  text:"I sympathize with others' feelings and feel for those less fortunate." },
  { id:3,  text:'I am always prepared and keep my belongings organized.' },
  { id:4,  text:'I have frequent mood swings and get stressed easily.' },
  { id:5,  text:'I have a vivid imagination and enjoy thinking about abstract ideas.' },
  { id:6,  text:"I don't talk a lot and tend to keep to myself." },
  { id:7,  text:"I am not really interested in others' problems or feelings." },
  { id:8,  text:'I often forget to put things back in their proper place.' },
  { id:9,  text:"I am relaxed most of the time and don't worry much." },
  { id:10, text:'I am not interested in theoretical or philosophical discussions.' },
  { id:11, text:'I feel comfortable around people and start conversations easily.' },
  { id:12, text:'I have a soft heart and try to make people feel at ease.' },
  { id:13, text:'I pay attention to details and like to get chores done right away.' },
  { id:14, text:'I get upset easily and often feel blue or anxious.' },
  { id:15, text:'I enjoy hearing new ideas and looking at art or nature.' },
];

const FIELD_LABELS = {
  leadStatus:'Status', closeDate:'Projected close date', confidence:'Confidence',
  studyPlans:'Study Plans', leadSource:'Source of Lead', source:'Source', sourceDetail:'Source detail', interaction:'Interaction',
  destinationCountry:'Destination', timeline:'Timeline', schoolEvent:'School/Event',
  budget:'Budget', scholarshipDemand:'Scholarship Demand', englishLevel:'English Level',
  gpa:'GPA', immigrationHistory:'Immigration History', sponsorIncome:'Sponsor Income',
  incomeEvidence:'Income Evidence', studyPlanGap:'Study Plan & Gap',
  ultimateObjective:'Ultimate Objective', counselor:'Counselor',
  seniorCounselor:'Senior Counselor', presales:'Pre-Sales', marketingStaff:'Marketing Staff',
  riskScore:'Risk Score', stoneTier:'Stone Tier',
  // ── Campaign fields ──
  campaignType:'Campaign Type', campaignName:'Campaign Name',
  campaignStart:'Campaign Start', campaignEnd:'Campaign End',
};

// (canDo helper removed — permissions come from usePermissions().)

// Maps each legacy staff-assignment field to its canonical staff.position, so
// the person view can gate a field as editable only when that position is
// active in the Order's current phase (phase_positions / editablePositions).
// Positions with no legacy field (Quality, Tech Support, Case Officer…) are
// owned via the phase-change flow instead.
const FIELD_POSITION = {
  counselor:       'Counselor',
  seniorCounselor: 'Senior Counselor',
  presales:        'PreSales',
  marketingStaff:  'Marketing Staff',
};

// Every assignable position, in display order. Rows with `field` mirror a legacy
// students/leads column (saved via staffAPI.assign + cascade); rows without live
// only in order_assignments (saved via staffAPI.setAssignment). A row is editable
// only when its position is active in the Order's current phase.
const ASSIGN_ROWS = [
  { position:'Counselor',            label:'Counselor',            field:'counselor' },
  { position:'Senior Counselor',     label:'Senior Counselor',     field:'seniorCounselor' },
  { position:'PreSales',             label:'Pre-Sales',            field:'presales' },
  { position:'Marketing Staff',      label:'Marketing Staff',      field:'marketingStaff' },
  { position:'Quality',              label:'Quality' },
  { position:'Tech Support',         label:'Tech Support' },
  { position:'Case Officer, Direct', label:'Case Officer (Direct)' },
  { position:'Case Officer, Sub',    label:'Case Officer (Sub)' },
  { position:'Customer Service',     label:'Customer Service' },
];
const EXTRA_POSITIONS = ASSIGN_ROWS.filter(r => !r.field).map(r => r.position);

// Which staff positions are valid in each phase (mirrors the phase_positions
// seed). Used to filter the staff dropdowns so you can only pick a recipient
// whose position belongs to the phase being assigned.
// Which positions can OWN an order in each phase. After the profile migration
// staff.position holds profile names, so these list the profiles first; legacy
// position values are kept so un-migrated staff still resolve.
const PHASE_POSITIONS = {
  'Marketing':            ['Staff, Marketing', 'Manager, Marketing', 'Marketing Staff', 'Marketing Manager'],
  'Counselling':          ['Staff, Counsellor', 'Lead, Counsellor', 'Counselor', 'Senior Counselor'],
  'Presales':             ['Staff, Pre-sales', 'Lead, Pre-sales', 'PreSales'],
  'Pool':                 ['Staff, Data Quality', 'Staff, Technical Support', 'Manager, Technical Support', 'Administrator, Office', 'Quality', 'Tech Support'],
  'Business Development': ['Staff, Business Development', 'Manager, Business Development'],
  'Case Officer - Dir':   ['Staff, Case Officer - Dir', 'Lead, Case Officer', 'Case Officer, Direct'],
  'Case Officer - Sub':   ['Staff, Case Officer - Sub', 'Case Officer, Sub'],
  'Archived - Dir':       ['Staff, Data Quality', 'Staff, Technical Support', 'Quality', 'Tech Support'],
  'Archived - Sub':       ['Staff, Data Quality', 'Staff, Technical Support', 'Quality', 'Tech Support'],
};

// Canonical phase model — KEEP IN SYNC with Server/src/utils/orderPhase.js.
// The slot(s) a phase can be assigned to; a move picks phase → position → staff.
const PHASE_SLOTS = {
  'Marketing':            ['Marketing Staff'],
  'Counselling':          ['Counselor'],
  'Presales':             ['PreSales'],
  'Pool':                 ['Quality', 'Tech Support'],
  'Business Development':  ['Business Development'],
  'Case Officers':        ['Case Officer, Direct', 'Case Officer, Sub'],
};
const RECIPIENT_REQUIRED = new Set(['Counselling', 'Presales', 'Case Officers']);
const POSITION_LABEL = {
  'Marketing Staff': 'Marketing Staff', 'Counselor': 'Counsellor', 'PreSales': 'Pre-Sales',
  'Quality': 'Quality', 'Tech Support': 'Tech Support', 'Business Development': 'Business Development',
  'Case Officer, Direct': 'Case Officer (Direct)', 'Case Officer, Sub': 'Case Officer (Sub)',
};

function formatDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function formatShortDate(dt) {
  if (!dt) return null;
  return String(dt).slice(0, 10);
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
        <select className="form-select" value={value||''} onChange={e=>onChange(name,e.target.value)}>
          <option value="">—</option>
          {options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="form-input" type={type} value={value||''} onChange={e=>onChange(name,e.target.value)}/>
      )}
    </div>
  );
}

// ── Multi-select dropdown for comma-separated fields (e.g. Destination) ───────
// Mirrors the LQ app's country picker: choose up to `max` from a fixed list,
// stored as a comma-separated string. Tolerant of pre-existing values that are
// not in the option list (legacy data) so they can still be seen/removed.
function MultiSelectField({ label, name, value, onChange, options, max = 3 }) {
  const [open, setOpen] = useState(false);
  const selected = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const allOpts  = [...options, ...selected.filter(s => !options.includes(s))];
  const toggle = (opt) => {
    const next = selected.includes(opt)
      ? selected.filter(s => s !== opt)
      : (selected.length >= max ? selected : [...selected, opt]);
    onChange(name, next.join(', '));
  };
  return (
    <div className="form-group" style={{ margin:0, position:'relative' }}>
      <label className="form-label">{label}</label>
      <button type="button" className="form-select" onClick={() => setOpen(o => !o)}
              style={{ textAlign:'left', cursor:'pointer', width:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {selected.length ? selected.join(', ') : '—'}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:40 }} />
          <div style={{ position:'absolute', zIndex:41, top:'100%', left:0, right:0, maxHeight:240, overflowY:'auto',
                        background:'var(--bg-primary,#fff)', border:'1px solid var(--border)', borderRadius:6,
                        boxShadow:'0 4px 12px rgba(0,0,0,0.15)', marginTop:4, padding:'4px 0' }}>
            <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', padding:'4px 10px' }}>
              Select up to {max} ({selected.length}/{max})
            </div>
            {allOpts.map(opt => {
              const on = selected.includes(opt);
              const disabled = !on && selected.length >= max;
              return (
                <label key={opt} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
                          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, fontSize:'0.85rem' }}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(opt)} />
                  {opt}
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Photo placeholder ─────────────────────────────────────────────────────────
function PhotoThumb({ url, label, isRound }) {
  return (
    <div style={{ textAlign:'center' }}>
      {url ? (
        <img src={url} alt={label} style={{
          width:'56px', height:'56px', objectFit:'cover',
          borderRadius: isRound ? '50%' : '6px',
          border:'2px solid var(--border)',
        }}/>
      ) : (
        <div style={{
          width:'56px', height:'56px',
          borderRadius: isRound ? '50%' : '6px',
          background:'var(--bg-secondary)',
          border:'2px dashed var(--border)',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'var(--text-secondary)',
        }}>
          {isRound ? <FiUser size={20}/> : <FiGrid size={20}/>}
        </div>
      )}
      <div style={{ fontSize:'0.65rem', color:'var(--text-secondary)', marginTop:'0.25rem' }}>{label}</div>
    </div>
  );
}

export default function LeadDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const location  = useLocation();
  // /students/:id is the person (Sales) view; /lead/:id and a NUMERIC /leads/:id are engagement
  // views. Student ids are non-numeric ("20260626-02" / "WISE-DN-0319") while lead ids are numeric,
  // so a non-numeric id on /leads/:id is really a person link (roster, activity report, reminders) —
  // treat it as the person view instead of 500-ing on leadAPI.get(<studentId>).
  const isStudentView = location.pathname.startsWith('/students') || !/^\d+$/.test(id || '');
  const { staff } = useAuth();

  // ── Registrations (lead_events) ──
  const [registrations, setRegistrations] = useState([]);
  const [regLoading, setRegLoading]       = useState(false);
  const [studentLeads, setStudentLeads]   = useState([]);   // all leads for this person
  const [eventOptions, setEventOptions]   = useState([]);   // event catalog for the "add event" picker
  const [addEventId, setAddEventId]       = useState('');
  const [addEventStatus, setAddEventStatus] = useState('');
  const [addSourceOfLead, setAddSourceOfLead] = useState('');
  const [addSource, setAddSource]         = useState('');
  const [addingEvent, setAddingEvent]     = useState(false);
  // Registrations (lead_events) are person-level; they're loaded by the main
  // fetch below once the owning student id is known.
  async function handleRegStatus(regId, status) {
    try {
      await leadEventsAPI.updateStatus(regId, status);
      setRegistrations(rs => rs.map(r => r.id === regId ? { ...r, status } : r));
    } catch (e) {
      alert(e.message || 'Failed to update status');
    }
  }
  // Load the event catalog once (Sales view only) so the "add event" picker has options.
  useEffect(() => {
    if (!isStudentView) return;
    leadEventsAPI.options().then(r => setEventOptions(r.data?.events || [])).catch(() => {});
  }, [isStudentView]);
  // Persist an edited field (source of lead / source) on a registration row.
  async function handleRegField(regId, patch) {
    setRegistrations(rs => rs.map(r => r.id === regId ? { ...r, ...patch } : r));   // optimistic
    try {
      await leadEventsAPI.update(regId, patch);
    } catch (e) {
      alert(e.message || 'Failed to save');
    }
  }
  // Link a new event registration to this person, then reload the list.
  async function addRegistration() {
    const sid = lead?.studentId;
    if (!addEventId || !sid) return;
    setAddingEvent(true);
    try {
      await leadEventsAPI.add({
        studentId: sid, eventId: Number(addEventId), status: addEventStatus || null,
        sourceOfLead: addSourceOfLead || null, source: addSource || null,
      });
      const regs = await leadEventsAPI.list(sid);
      setRegistrations(regs.data || []);
      setAddEventId(''); setAddEventStatus(''); setAddSourceOfLead(''); setAddSource('');
    } catch (e) {
      alert(e.message || 'Failed to add event');
    } finally {
      setAddingEvent(false);
    }
  }
  const availableEvents = eventOptions.filter(ev => !registrations.some(r => r.eventId === ev.id));
  const { canDo, canDoOnLead, canEditField, scope } = usePermissions();
  const { push: pushTrail } = useNavTrail();

  const [lead, setLead]         = useState(null);
  const [notes, setNotes]       = useState([]);
  const [staffList, setStaff]   = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [refOptions, setRefOptions] = useState({ channels: [], subagents: [], partners: [] });
  useEffect(() => {
    fetch('/api/lead-events/options', { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (j.success && j.data) setRefOptions({ channels: j.data.channels || [], subagents: j.data.subagents || [], partners: j.data.partners || [] }); })
      .catch(() => {});
  }, []);
  const [showHistory, setShowHistory]               = useState(false);
  const [showOceanQuestions, setShowOceanQuestions] = useState(false);
  const [assign, setAssign]     = useState({});
  // Phase-driven assignment context (from getStudent / changePhase responses):
  //   editablePositions — staff positions the CURRENT phase allows editing
  //   nextPhases        — legal phase moves from here (allowed transitions)
  const [phaseInfo, setPhaseInfo] = useState({ editablePositions: [], nextPhases: [] });
  const [phaseTarget,   setPhaseTarget]   = useState('');   // selected next phase
  const [phasePosition, setPhasePosition] = useState('');   // chosen slot within that phase
  const [phaseOwner,    setPhaseOwner]    = useState('');   // owner to set for that phase
  const [movingPhase, setMovingPhase] = useState(false);
  // Owners for the non-legacy positions (Quality, Tech Support, Case Officer…),
  // which live only in order_assignments. Keyed by canonical position string.
  const [posAssign, setPosAssign] = useState({});

  // Staff options for an assignment dropdown, filtered to the given position(s).
  // Always keeps the current value visible (even if that person's position no
  // longer matches), and falls back to all staff for an unknown phase.
  function staffFor(positions, current) {
    const set = (Array.isArray(positions) ? positions : [positions]).filter(Boolean);
    let opts = set.length ? staffList.filter(s => set.includes(s.position)) : staffList;
    if (current && !opts.some(s => s.fullName === current)) {
      opts = [{ id: '_cur', fullName: current, position: '(current)' }, ...opts];
    }
    return opts;
  }
  const topicOptions = useLookup('note_topic');
  // ── Source-of-Lead picker (mode-aware) ──
  const solItems     = useLookup('source_of_lead');
  const sourceList   = useLookup('source');
  const b2bTypeList  = useLookup('b2b_type');
  const b2bPartyList = useLookup('b2b_party');
  const countries    = useLookup('country');
  const countryOpts  = countries.map(c => c.code).filter(Boolean);
  const sourceOfLeadOpts = solItems.map(o => o.code);
  const SOL_MODE = { 'Databases':'list', 'On-line':'list', 'Event/Campaign':'events', 'B2B referrals':'b2b', 'Personal referrals':'list_freetext' };
  const modeOf = (code) => ((solItems.find(o => o.code === code) || {}).meta || {}).mode || SOL_MODE[code] || '';
  const withCur = (opts, val) => opts ? [...new Set([...opts, val].filter(Boolean))] : undefined;
  const sourceOptsFor = (sol) => {
    const m = modeOf(sol);
    if (m === 'list' || m === 'list_freetext') return sourceList.filter(o => o.subcategory === sol).map(o => o.code);
    if (m === 'b2b') return b2bTypeList.map(o => o.code);
    return undefined;
  };
  const sourceDetailOptsFor = (sol, src) =>
    modeOf(sol) === 'b2b' ? b2bPartyList.filter(o => o.subcategory === src).map(o => o.code) : undefined;
  const [noteType,     setNoteType]     = useState('counselor');
  const [addingNote,   setAdding]       = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  // Notes filter bar (per-lead). Keyword matches content/author/topic; type
  // narrows by note_type; phoneOnly uses the Activity-Report phone matcher.
  const [noteSearch,     setNoteSearch]     = useState('');
  const [noteTypeFilter, setNoteTypeFilter] = useState('all');
  const [notePhoneOnly,  setNotePhoneOnly]  = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcOcean, setRecalcOcean]     = useState(false);
  const [oceanResult, setOceanResult]     = useState(null);
  const [accessDenied, setAccessDenied]   = useState(false);

  // ── Contact log modal ──────────────────────────────────────────────────────
  const [contactModal, setContactModal] = useState(null);

  function openContactModal(method) {
    setContactModal({ method, openedAt: new Date().toISOString() });
  }

  async function handleContactSave({ noteText, topic, followUpDate, contactPlatform }) {
    try {
      const data = await notesAPI.addForLead(id, 'counselor', noteText, {
        topic,
        followUpDate,
        contactPlatform,
        reminderStatus: followUpDate ? 'active' : null,
      });
      setNotes(n => [data.data, ...n]);
    } catch(e) { alert('Failed to save note: ' + e.message); }
    setContactModal(null);
  }

  function handleContactCancel() {
    setContactModal(null);
  }


  // id (route param) is the LEAD id. Load the lead, then its owning student, and
  // MERGE into one object so the (unchanged) render sees person + engagement.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        let ld = {};
        let sid = id;                                  // /students/:id => id IS the student id
        if (!isStudentView) {
          const leadRes = await leadAPI.get(id);
          ld  = leadRes.data;
          sid = ld.studentId;
        }
        const [stu, nt, st, al, regs, sleads] = await Promise.all([
          studentAPI.get(sid),
          isStudentView ? Promise.resolve({ data: [] }) : notesAPI.listForLead(id),
          staffAPI.listActive(),
          auditAPI.getForStudent(sid),
          leadEventsAPI.list(sid).catch(() => ({ data: [] })),
          leadAPI.listForStudent(sid).catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        const l = { ...stu.data, ...ld, studentId: sid, leadId: isStudentView ? null : id };   // lead wins on overlap
        // Sales/person view: staff assignment lives on the leads, not the student
        // row (those columns were dropped in the restructure). Overlay the LATEST
        // ACTIVE lead's assignment so the Summary shows the owner and the 'own'
        // permission checks (Edit button etc.) resolve correctly. Closed leads
        // (Contracted/Lost/Archived) are display-only, so derive from active first.
        if (isStudentView) {
          const leadsForPerson = sleads.data || [];
          const TERMINAL = ['Contracted', 'Lost', 'Archived', 'Cancelled'];   // closed leads don't own the person
          const byLatest = (a, b) => (Number(b.leadId) || 0) - (Number(a.leadId) || 0);
          const owner = leadsForPerson.filter(x => !TERMINAL.includes(x.leadStatus)).sort(byLatest)[0]
                     || leadsForPerson.slice().sort(byLatest)[0];
          if (owner) {
            for (const f of ['counselor', 'seniorCounselor', 'presales', 'marketingStaff']) {
              if (owner[f] != null && owner[f] !== '') l[f] = owner[f];
            }
          }
        }
        setLead(l);
        setNotes(nt.data || []);
        setStaff(st.data || []);
        setAuditLog(al.data || []);
        setRegistrations(regs.data || []);
        setStudentLeads(sleads.data || []);
        setRegLoading(false);
        setAssign({
          counselor:       l.counselor       || '',
          seniorCounselor: l.seniorCounselor || '',
          presales:        l.presales        || '',
          marketingStaff:  l.marketingStaff  || '',
        });
        // Phase-driven gating context — which positions this phase lets us edit,
        // and where the Order may move next.
        setPhaseInfo({
          editablePositions: stu.data.editablePositions || [],
          nextPhases:        stu.data.nextPhases || [],
        });
        // Non-legacy position owners (order_assignments), for the extended window.
        const asg = stu.data.assignments || {};
        setPosAssign(Object.fromEntries(EXTRA_POSITIONS.map(p => [p, asg[p] || ''])));
        if (l.oceanExtraversion) {
          const scores = {
            extraversion:      l.oceanExtraversion,
            agreeableness:     l.oceanAgreeableness,
            conscientiousness: l.oceanConscientiousness,
            neuroticism:       l.oceanNeuroticism,
            openness:          l.oceanOpenness,
          };
          setOceanResult({ scores, narrative: l.oceanNarrative || '', ...getArchetype(scores) });
        }
      } catch (e) {
        // Backend returns 403 with this phrasing when a Counselor opens a lead
        // they're not assigned to.
        if (e?.message && /access denied|do not have permission|assigned to another/i.test(e.message)) {
          if (alive) setAccessDenied(true);
        } else {
          console.error(e);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, isStudentView]);

  // Push a trail entry once the lead has loaded. push() de-dupes by path,
  // so re-renders after data fetches don't grow the stack.
  useEffect(() => {
    if (lead?.fullName) {
      pushTrail({
        label: isStudentView ? `Sales: ${lead.fullName}` : `Lead ${id}: ${lead.fullName}`,
        path:  isStudentView ? `/students/${id}` : `/lead/${id}`,
      });
    }
  }, [lead?.fullName, id, isStudentView, pushTrail]);

  function enterEdit() {
    // Seed edit data with raw (unmasked) values where the server provided
    // them, so saving never writes masked display values back to the DB.
    const base = { ...lead };
    Object.keys(lead || {}).forEach(k => {
      if (k.startsWith('_raw_')) base[k.slice(5)] = lead[k];
    });
    setEditData(base);
    setEditMode(true);
  }
  function cancelEdit() { setEditData({}); setEditMode(false); }
  function updateEdit(name, value) { setEditData(d=>({...d,[name]:value})); }

  // Create a fresh lead for this student and jump straight to it.
  async function createNewLead() {
    try {
      const res = await leadAPI.create(lead.studentId, {});
      const newId = res?.data?.leadId;
      if (newId) navigate(`/lead/${newId}`);
      else alert('Lead created, but no id was returned.');
    } catch (e) { alert(e.message); }
  }

  async function saveAll() {
    // ── Mandatory fields before save (when in edit mode) ──
    if (editMode) {
      const missing = [];
      if (isStudentView) {
        // Source of Lead + Interaction are person-level — enforced on the Student record.
        if (!editData.leadSource)  missing.push('Source of Lead');
        if (!editData.interaction) missing.push('Interaction');
      } else {
        // Lead-level mandatory fields only — required once the lead is past 'New'.
        const status = editData.leadStatus || 'New';
        if (status !== 'New') {
          if (!editData.closeDate)  missing.push('Close Date');
          if (!editData.confidence) missing.push('Confidence');
        }
      }
      if (missing.length) {
        alert(`Please complete the following before saving:\n\n• ${missing.join('\n• ')}`);
        return;
      }

      // ── Close Date direction rule ──
      // Counselors (and other non-privileged roles) cannot push the Close Date later
      // once the lead has moved past 'New'. Manager/Admin/Director are allowed to delay.
      if (status !== 'New' && editData.closeDate && lead.closeDate) {
        const oldDate = new Date(lead.closeDate);
        const newDate = new Date(editData.closeDate);
        const dateChanged = oldDate.getTime() !== newDate.getTime();
        const isLater     = newDate > oldDate;
        if (dateChanged && isLater && !canDoOnLead('leads', 'delay_close_date', lead)) {
          alert(
            'You cannot push the Close Date later once the lead has progressed past "New".\n\n' +
            'Only Managers, Admins, or Directors can delay a Close Date.'
          );
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (editMode) {
        // Engagement fields -> the lead; person fields -> the student.
        const leadRes = isStudentView ? null : await leadAPI.update(id, {
          leadStatus:         editData.leadStatus,
          closeDate:          editData.closeDate || null,
          confidence:         editData.confidence,
          intake:             editData.intake,
          degreeLevel:        editData.degreeLevel,
          targetInstitution:  editData.targetInstitution,
          rationale:          editData.rationale,
          studyPlans:         editData.studyPlans,
          destinationCountry: editData.destinationCountry,
          timeline:           editData.timeline,
          major:              editData.major,
        });
        const studentRes = await studentAPI.update(lead.studentId, {
          fullName:           editData.fullName,
          leadSource:         editData.leadSource,
          interaction:        editData.interaction,
          budget:             editData.budget,
          scholarshipDemand:  editData.scholarshipDemand,
          englishLevel:       editData.englishLevel,
          gpa:                editData.gpa,
          immigrationHistory: editData.immigrationHistory,
          sponsorIncome:      editData.sponsorIncome,
          incomeEvidence:     editData.incomeEvidence,
          studyPlanGap:       editData.studyPlanGap,
          ultimateObjective:  editData.ultimateObjective,
          schoolAttended:     editData.schoolAttended,
          ward:               editData.ward,
          source:             editData.source,
          sourceDetail:       editData.sourceDetail,
          motherFullName:      editData.motherFullName,
          motherEmail:         editData.motherEmail,
          motherPhone:         editData.motherPhone,
          motherContactMedium: editData.motherContactMedium,
          motherContactDetail: editData.motherContactDetail,
          fatherFullName:      editData.fatherFullName,
          fatherEmail:         editData.fatherEmail,
          fatherPhone:         editData.fatherPhone,
          fatherContactMedium: editData.fatherContactMedium,
          fatherContactDetail: editData.fatherContactDetail,
          ...Object.fromEntries(
            Array.from({length:15}, (_,i) => [`oceanQ${i+1}`, editData[`oceanQ${i+1}`] || null])
          ),
        });
        // Only treat the save as done if the server actually accepted it.
        // (A lapsed session returns success:false / 401 — without this guard the
        // UI would clear edit mode and report "Saved successfully" while the DB
        // kept the old values, silently losing the edits.)
        if ((!studentRes || studentRes.success === false) || (leadRes && leadRes.success === false)) {
          throw new Error(
            (studentRes && studentRes.error) || (leadRes && leadRes.error) ||
            'Save failed - you may have been logged out. Log in again and retry; your changes are still here.'
          );
        }
        setLead(l=>({...l,...editData}));
        setEditMode(false);
        setEditData({});
      }
      // Order-driven: staff is assigned on the Sales Order (person view) and
      // cascades to the person's ACTIVE leads. The lead view no longer assigns.
      if (isStudentView && canDoOnLead('leads', 'assign', lead)) {
        // Only re-save the 4 legacy staff slots when the CURRENT phase actually
        // edits one of them (Counselling/Pre-Sales/Marketing). In Pool / Case
        // Officers etc. those slots are greyed (retained history) — re-saving them
        // would call syncOrderPhase on the old counselor and REVERT the phase move.
        const LEGACY_POS = ['Counselor', 'Senior Counselor', 'PreSales', 'Marketing Staff'];
        if (LEGACY_POS.some(p => phaseInfo.editablePositions.includes(p))) {
          await staffAPI.assign(lead.studentId, {
            counselor:       assign.counselor,
            seniorCounselor: assign.seniorCounselor,
            presales:        assign.presales,
            marketingStaff:  assign.marketingStaff,
          });
          setLead(l=>({...l,...assign}));
        }
        // Persist the non-legacy positions this phase lets us edit (order_assignments).
        for (const pos of EXTRA_POSITIONS) {
          if (phaseInfo.editablePositions.includes(pos)) {
            await staffAPI.setAssignment(lead.studentId, { position: pos, staffName: posAssign[pos] || '' });
          }
        }
      }
      const al = await auditAPI.getForStudent(lead.studentId);
      setAuditLog(al.data || []);
      alert('Saved successfully');
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  // Move the Sales Order to another phase. The backend validates the transition
  // against phase_transitions, assigns `phaseOwner` to the target phase's active
  // position, mirrors to the legacy column + cascades to ACTIVE leads, and
  // returns the fresh assignment context.
  async function handleMovePhase() {
    if (!phaseTarget) return;
    // Connected-unit rule: a working phase needs an active lead. If this record
    // has none (all leads terminal), the move mints a new active lead — warn first.
    // Pool is exempt (it can hold records with no active lead).
    if (phaseTarget !== 'Pool') {
      const TERMINAL = ['Contracted', 'Lost', 'Archived', 'Cancelled'];
      const hasActive = (studentLeads || []).some(x => !TERMINAL.includes(x.leadStatus || 'New'));
      if (!hasActive &&
          !confirm(`This record has no active lead.\n\nA new active lead will be created so it can be worked in ${phaseTarget}.\n\nContinue?`)) return;
    }
    setMovingPhase(true);
    try {
      // position: the chosen slot (single-slot phases resolve it server-side).
      const res = await staffAPI.changePhase(lead.studentId, {
        toPhase:   phaseTarget,
        position:  phasePosition || (PHASE_SLOTS[phaseTarget] || [])[0] || '',
        staffName: phaseOwner,
      });
      if (!res || res.success === false) throw new Error(res?.error || 'Phase change failed');
      const data = res.data || {};
      // Reflect the new phase, owner and gating context locally.
      setLead(l => ({ ...l, orderPhase: data.orderPhase || phaseTarget, ...(data.assignments || {}) }));
      setPhaseInfo({
        editablePositions: data.editablePositions || [],
        nextPhases:        data.nextPhases || [],
      });
      // Model-B: the move only touched the target phase's position — the legacy
      // slots (counselor etc.) keep their retained staff and show greyed.
      setAssign(a => ({
        ...a,
        counselor:       (data.assignments && data.assignments['Counselor'])        ?? a.counselor,
        seniorCounselor: (data.assignments && data.assignments['Senior Counselor']) ?? a.seniorCounselor,
        presales:        (data.assignments && data.assignments['PreSales'])         ?? a.presales,
        marketingStaff:  (data.assignments && data.assignments['Marketing Staff'])  ?? a.marketingStaff,
      }));
      if (data.assignments) {
        setPosAssign(Object.fromEntries(EXTRA_POSITIONS.map(p => [p, data.assignments[p] || ''])));
      }
      setPhaseTarget('');
      setPhasePosition('');
      setPhaseOwner('');
      const al = await auditAPI.getForStudent(lead.studentId);
      setAuditLog(al.data || []);
      // A new active lead may have been minted (record had none) — refresh the list.
      if (data.createdLeadId) {
        const sl = await leadAPI.listForStudent(lead.studentId).catch(() => null);
        if (sl?.data) setStudentLeads(sl.data);
      }
      alert(`Moved to ${data.orderPhase || phaseTarget}` +
            (data.createdLeadId ? `\nCreated new active lead #${data.createdLeadId} (record had no active lead).` : ''));
    } catch (e) { alert(e.message); }
    finally { setMovingPhase(false); }
  }

  async function handleRecalculateRisk() {
    setRecalculating(true);
    try {
      const res = await studentAPI.calculateRisk(lead.studentId);
      setLead(l => ({ ...l, riskScore: String(res.data.totalScore), stoneTier: res.data.stoneTier }));
      alert(`Risk recalculated: ${res.data.stoneTier} (${res.data.totalScore})`);
    } catch(e) { alert(e.message); }
    finally { setRecalculating(false); }
  }

  async function handleRecalculateOcean() {
    setRecalcOcean(true);
    try {
      const res = await studentAPI.calculateOcean(lead.studentId);
      const scores = res.data.scores;
      const archetypeData = getArchetype(scores);
      setOceanResult({ ...res.data, ...archetypeData });
      setLead(l => ({
        ...l,
        oceanExtraversion:      scores.extraversion,
        oceanAgreeableness:     scores.agreeableness,
        oceanConscientiousness: scores.conscientiousness,
        oceanNeuroticism:       scores.neuroticism,
        oceanOpenness:          scores.openness,
        oceanArchetype:         archetypeData.archetype?.name || '',
      }));
      if (archetypeData.archetype) {
        await studentAPI.update(lead.studentId, { oceanArchetype: archetypeData.archetype.name });
      }
      alert('Career Fit profile updated successfully');
    } catch(e) { alert(e.message); }
    finally { setRecalcOcean(false); }
  }

  async function addNote({ topic, summary, nextSteps, reason, followUpDate }) {
    setAdding(true);
    try {
      const now = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const parts = [
        NOTE_TYPES[noteType] + ' — ' + (lead?.fullName || ''),
        'By: ' + (staff?.fullName || '') + '  |  ' + now,
        'Topic: ' + topic, '',
        'Summary:\n' + summary,
        '\nNext Steps:\n' + nextSteps,
        '\nReason:\n' + reason,
        '\nFollow-up Date: ' + followUpDate,
      ];
      const data = await notesAPI.addForLead(id, noteType, parts.join('\n'), { topic, followUpDate, reminderStatus:'active', contactPlatform:null });
      setNotes(n=>[data.data,...n]);
    } catch(e) { alert(e.message); }
    finally { setAdding(false); }
  }

  async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await notesAPI.delete(noteId);
      setNotes(n=>n.filter(x=>x.id!==noteId));
    } catch(e) { alert(e.message); }
  }

  if (loading) return <div className="loading-center">Loading...</div>;
  // Stale-flash guard: during a lead->lead navigation, `lead` still holds the
  // PREVIOUS lead until the new fetch lands (effects run after render) — which
  // briefly showed e.g. lead 1259's "Lost" on sibling 4464. Don't render a lead
  // whose id doesn't match the current URL; show the loader until the fetch lands.
  if (!isStudentView && lead && String(lead.leadId) !== String(id))
    return <div className="loading-center">Loading...</div>;

  if (accessDenied) return (
    <div>
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <TrailBackButton />
          <span className="page-title">Access denied</span>
        </div>
      </div>
      <div className="page-body">
        <div className="alert alert--error" style={{ marginBottom:'1rem' }}>
          You don't have permission to view this lead. It's assigned to another staff member.
        </div>
        <button className="btn btn--secondary btn--sm" onClick={() => navigate('/leads')}>
          ← Back to Leads
        </button>
      </div>
    </div>
  );

  if (!lead) return (
    <div>
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <TrailBackButton />
          <span className="page-title">Lead not found</span>
        </div>
      </div>
      <div className="page-body">
        <div className="alert alert--error" style={{ marginBottom:'1rem' }}>
          This lead doesn't exist or may have been deleted.
        </div>
        <button className="btn btn--secondary btn--sm" onClick={() => navigate('/leads')}>
          ← Back to Leads
        </button>
      </div>
    </div>
  );

  // Terminal lockdown: a closed lead (Lost / Archived / Cancelled) is
  // display-only for everyone except Admin/Director/Manager, who can "re-open" it.
  // Contracted now stays OPEN (editable) per business change. Only applies on the
  // Lead view (the Student record has no lead_status).
  const TERMINAL_STATUSES = ['Lost', 'Archived', 'Cancelled'];
  const isAdminRole = ['Admin', 'Director', 'Manager'].includes(staff?.role);
  const leadLocked  = !isStudentView && TERMINAL_STATUSES.includes(lead.leadStatus) && !isAdminRole;

  // Phase chip (Sales Order department) — colour + label for the header.
  const orderPhase  = lead.orderPhase || null;
  const phaseBg     = { Counselling:'#059669', Presales:'#2563eb', Pool:'#d97706' }[orderPhase] || '#6b7280';
  const phaseLabel  = orderPhase === 'Presales' ? 'Pre-Sales' : orderPhase;

  const canEdit   = canDoOnLead('leads', 'edit',        lead) && !leadLocked;
  const canAssign = canDoOnLead('leads', 'assign',      lead) && !leadLocked;
  const canRecalc = canDoOnLead('leads', 'recalculate', lead) && !leadLocked;
  const d         = editMode ? editData : lead;

  const oceanAnsweredCount = Array.from({length:15}, (_,i) => lead[`oceanQ${i+1}`]).filter(Boolean).length;

  // ── Notes are blocked until these 2 fields are set on the lead ──
  // Close Date and Confidence are required for SAVE (when status != 'New')
  // but should NOT block note-taking. Notes only need Lead Source + Interaction.
  const notesRequired = {
    'Source of Lead':  lead.leadSource,
    'Interaction':  lead.interaction,
  };
  const notesMissing = Object.entries(notesRequired)
    .filter(([_, v]) => !v)
    .map(([k]) => k);
  // Source of Lead + Interaction are person-level, entered on the Student record.
  // The lock therefore applies only on the Student view (where lead.* === the
  // student's values); Lead notes are never blocked by these person fields.
  const canAddNotes = isStudentView ? notesMissing.length === 0 : true;

  return (
    <>
    <div>
      <Watermark />

      {/* Header */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <TrailBackButton />
          <span style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', padding:'2px 8px', borderRadius:'4px', background: isStudentView ? '#7c3aed' : '#2563eb', color:'#fff' }}>
            {isStudentView ? 'Sales' : 'Lead'}
          </span>
          <span className="page-title">
            {lead.fullName || (isStudentView ? 'Sales Detail' : 'Lead Detail')}
            {` | ${lead.studentId}`}
            {!isStudentView && ` | ${lead.leadId || id}`}
          </span>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {orderPhase && (
            <span style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
                           padding:'2px 8px', borderRadius:'4px', background: phaseBg, color:'#fff' }}
                  title="Sales Order phase">
              {phaseLabel}
            </span>
          )}
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
          {(editMode || (isStudentView && canAssign)) && (
            <button className="btn btn--primary btn--sm" onClick={saveAll} disabled={saving}>
              <FiSave size={13}/> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {leadLocked && (
        <div className="page-body" style={{ paddingTop:0, paddingBottom:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.75rem 1rem',
                        background:'#fef3c7', border:'1px solid #f59e0b', borderRadius:'8px',
                        color:'#92400e', fontSize:'0.875rem', marginBottom:'0.25rem' }}>
            🔒 This lead is <strong>&nbsp;{lead.leadStatus}&nbsp;</strong> and locked for editing. Ask an Admin to re-open it for any belated changes.
          </div>
        </div>
      )}

      <div className="page-body" style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:'1rem', alignItems:'start' }}>

        {/* ── Left column ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

          {!isStudentView && (
          <div className="section-card">
            <div className="section-header"><span className="section-title">Lead Status</span></div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <EditField label="Status"     name="leadStatus" value={d.leadStatus} onChange={updateEdit} options={LEAD_STATUSES}/>
                <EditField label="Projected close date" name="closeDate"  value={d.closeDate?d.closeDate.split('T')[0]:''} onChange={updateEdit} type="date"/>
                <EditField label="Confidence" name="confidence" value={d.confidence} onChange={updateEdit} options={CONFIDENCE_OPTS}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <Field label="Status"     value={lead.leadStatus||'New'}/>
                <Field label="Projected close date" value={formatShortDate(lead.closeDate)}/>
                <Field label="Confidence" value={lead.confidence}/>
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem', marginTop:'0.75rem' }}>
              <Field label="Actual Close Date" value={formatShortDate(lead.actualCloseDate)}/>
              <Field label="Cancellation date" value={formatShortDate(lead.cancellationDate)}/>
            </div>
          </div>
          )}

          {/* Student Information */}
          <div className="section-card">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem', paddingBottom:'0.75rem', borderBottom:'1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <span className="section-title">{isStudentView ? 'Sales Information' : 'Lead — Academic & Target'}</span>
                {editMode ? (
                  <div style={{ marginTop:'0.5rem', maxWidth:'400px' }}>
                    <EditField label="Full Name" name="fullName" value={d.fullName} onChange={updateEdit}/>
                  </div>
                ) : (
                  <div style={{ fontSize:'1.25rem', fontWeight:600, color:'var(--primary)', marginTop:'0.25rem', cursor: !isStudentView && lead.studentId ? 'pointer' : 'default' }}
                       title={!isStudentView ? 'Open Sales profile' : undefined}
                       onClick={() => { if (!isStudentView && lead.studentId) navigate(`/students/${lead.studentId}`); }}>
                    {lead.fullName || '—'}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap:'0.75rem', flexShrink:0 }}>
                <PhotoThumb url={lead.headshotUrl}    label="Headshot" isRound={true}/>
                <PhotoThumb url={lead.qrCodeImageUrl} label="QR Code"  isRound={false}/>
              </div>
            </div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                {/* Contact — only render edit input if user has 'edit' perm.
                    Otherwise show the masked/read-only value so users still
                    see what's there but can't change it. */}
                {canEditField('email')
                  ? <EditField label="Email" name="email" value={d.email} onChange={updateEdit} type="email"/>
                  : <Field label="Email" value={lead.email}/>}
                {canEditField('phone')
                  ? <EditField label="Phone" name="phone" value={d.phone} onChange={updateEdit}/>
                  : <Field label="Phone" value={lead.phone}/>}
                {!isStudentView && (<>
                <EditField label="Intake"          name="intake"             value={d.intake}             onChange={updateEdit}/>
                <EditField label="Degree"          name="degreeLevel"        value={d.degreeLevel}        onChange={updateEdit}/>
                <EditField label="Institution"     name="targetInstitution"  value={d.targetInstitution}  onChange={updateEdit}/>
                <EditField label="Major"           name="major"              value={d.major}              onChange={updateEdit}/>
                <EditField label="Study Plans"     name="studyPlans"         value={d.studyPlans}         onChange={updateEdit} options={STUDY_PLAN_OPTS}/>
                <MultiSelectField label="Destination" name="destinationCountry" value={d.destinationCountry} onChange={updateEdit} options={countryOpts} max={3}/>
                <EditField label="Timeline"        name="timeline"           value={d.timeline}           onChange={updateEdit} options={TIMELINE_OPTS}/>
                <EditField label="Rationale"       name="rationale"          value={d.rationale}          onChange={updateEdit}/>
                </>)}
                {isStudentView && (<>
                <EditField label="Year of Birth"   name="yearOfBirth"        value={d.yearOfBirth}        onChange={updateEdit}/>
                <EditField label="School Attended" name="schoolAttended"     value={d.schoolAttended}     onChange={updateEdit}/>
                <EditField label="Residency"       name="residency"          value={d.residency}          onChange={updateEdit}/>
                <EditField label="Ward"            name="ward"               value={d.ward}               onChange={updateEdit}/>
                </>)}
                {/* Stone Tier / Risk Score are person-derived — student view only (lead shows them in the right-hand Summary) */}
                {isStudentView && (<>
                <Field label="Stone Tier"    value={lead.stoneTier}/>
                <Field label="Risk Score"    value={lead.riskScore}/>
                </>)}
                {/* Lifecycle dates — level follows the view (lead vs person).
                    Row 1: Created / Updated · Row 2: Assigned in / Assigned out */}
                <Field label="Created"       value={formatShortDate(lead.createdAt)}/>
                <Field label="Updated"       value={formatShortDate(lead.updatedAt)}/>
                <Field label="Assigned in"   value={formatShortDate(lead.assignedIn)}/>
                <Field label="Assigned out"  value={formatShortDate(lead.assignedOut)}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                {/* Email with Outlook + Gmail launchers */}
                <div style={{ display:'flex', flexDirection:'column', gap:'0.125rem' }}>
                  <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500 }}>Email</span>
                  <span style={{ fontSize:'0.875rem' }}>{lead.email || '—'}</span>
                  {!isStudentView && lead.email && (
                    <div style={{ display:'flex', gap:'0.35rem', marginTop:'0.25rem' }}>
                      <a href="#" title="Send Email (Outlook / Gmail)"
                         onClick={e => { e.preventDefault(); openContactModal('email'); }}
                         style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'28px', height:'28px', borderRadius:'6px', background:'#0072c6', color:'#fff', fontSize:'0.75rem', fontWeight:700, textDecoration:'none', cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,0.15)' }}>
                        ✉
                      </a>
                    </div>
                  )}
                </div>
                {/* Phone with all contact method buttons */}
                <div style={{ display:'flex', flexDirection:'column', gap:'0.125rem' }}>
                  <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500 }}>Phone</span>
                  <span style={{ fontSize:'0.875rem' }}>
                    {lead.phone
                      ? (isStudentView
                          ? lead.phone
                          : <a href="#" style={{ color:'var(--primary)', textDecoration:'none' }}
                               onClick={e => { e.preventDefault(); openContactModal('call'); }}>
                              {lead.phone}
                            </a>)
                      : '—'}
                  </span>
                  {!isStudentView && lead.phone && (
                    <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap', marginTop:'0.25rem' }}>
                      {[
                        { key:'call',     label:'Call',     color:'#16a34a', icon:'📞' },
                        { key:'sms',      label:'SMS',      color:'#2563eb', icon:'💬' },
                        { key:'zalo',     label:'Zalo',     color:'#0068ff', icon:'Z'  },
                        { key:'whatsapp', label:'WhatsApp', color:'#25d366', icon:'W'  },
                      ].map(({key, label, color, icon}) => (
                        <a key={key} href="#" title={label}
                           onClick={e => { e.preventDefault(); openContactModal(key); }}
                           style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'28px', height:'28px', borderRadius:'6px', background:color, color:'#fff', fontSize: icon.length > 1 ? '0.6rem' : '0.875rem', fontWeight:700, textDecoration:'none', cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,0.15)' }}>
                          {icon}
                        </a>
                      ))}
                      <a href="#" title="Messenger"
                           onClick={e => { e.preventDefault(); openContactModal('messenger'); }}
                           style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'28px', height:'28px', borderRadius:'6px', background:'#0084ff', color:'#fff', fontSize:'0.6rem', fontWeight:700, textDecoration:'none', cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,0.15)' }}>
                          M
                        </a>
                    </div>
                  )}
                </div>
                {isStudentView && (<>
                <Field label="Stone Tier"      value={lead.stoneTier}/>
                <Field label="Risk Score"      value={lead.riskScore}/>
                </>)}
                {!isStudentView && (<>
                <Field label="Intake"          value={lead.intake}/>
                <Field label="Degree"          value={lead.degreeLevel}/>
                <Field label="Institution"     value={lead.targetInstitution}/>
                <Field label="Major"           value={lead.major}/>
                <Field label="Study Plans"     value={lead.studyPlans}/>
                <Field label="Destination"     value={lead.destinationCountry}/>
                <Field label="Timeline"        value={lead.timeline}/>
                <Field label="Rationale"       value={lead.rationale}/>
                </>)}
                {isStudentView && (<>
                <Field label="Year of Birth"   value={lead.yearOfBirth}/>
                <Field label="School Attended" value={lead.schoolAttended}/>
                <Field label="Residency"       value={lead.residency}/>
                <Field label="Ward"            value={lead.ward}/>
                </>)}
                {/* Lifecycle dates — level follows the view (lead vs person).
                    Row 1: Created / Updated · Row 2: Assigned in / Assigned out */}
                <Field label="Created"         value={formatShortDate(lead.createdAt)}/>
                <Field label="Updated"         value={formatShortDate(lead.updatedAt)}/>
                <Field label="Assigned in"     value={formatShortDate(lead.assignedIn)}/>
                <Field label="Assigned out"    value={formatShortDate(lead.assignedOut)}/>
              </div>
            )}
          </div>

          {isStudentView && (<>
          {/* Event Registrations */}
          <div className="section-card">
            <div className="section-header">
              <span className="section-title">Event Registrations</span>
            </div>
            {regLoading ? (
              <div style={{ padding:'1rem', color:'var(--text-secondary)', fontSize:'0.875rem' }}>Loading…</div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid var(--border)', textAlign:'left', color:'var(--text-secondary)' }}>
                      <th style={{ padding:'0.5rem', fontWeight:600 }}>Source of Lead</th>
                      <th style={{ padding:'0.5rem', fontWeight:600 }}>Source</th>
                      <th style={{ padding:'0.5rem', fontWeight:600 }}>Event</th>
                      <th style={{ padding:'0.5rem', fontWeight:600 }}>Start</th>
                      <th style={{ padding:'0.5rem', fontWeight:600 }}>End</th>
                      <th style={{ padding:'0.5rem', fontWeight:600, width:'150px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registrations.map(r => (
                      <tr key={r.id} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'0.5rem' }}>
                          <input value={r.sourceOfLead || ''} placeholder={'\u2014'}
                                 onChange={e => setRegistrations(rs => rs.map(x => x.id === r.id ? { ...x, sourceOfLead: e.target.value } : x))}
                                 onBlur={e => handleRegField(r.id, { sourceOfLead: e.target.value.trim() || null })}
                                 style={{ width:'100%', padding:'0.25rem 0.4rem', borderRadius:4, border:'1px solid var(--border)', fontSize:'0.8rem', boxSizing:'border-box' }} />
                        </td>
                        <td style={{ padding:'0.5rem' }}>
                          <input value={r.source || ''} placeholder={'\u2014'}
                                 onChange={e => setRegistrations(rs => rs.map(x => x.id === r.id ? { ...x, source: e.target.value } : x))}
                                 onBlur={e => handleRegField(r.id, { source: e.target.value.trim() || null })}
                                 style={{ width:'100%', padding:'0.25rem 0.4rem', borderRadius:4, border:'1px solid var(--border)', fontSize:'0.8rem', boxSizing:'border-box' }} />
                        </td>
                        <td style={{ padding:'0.5rem' }}>{r.name || '\u2014'}</td>
                        <td style={{ padding:'0.5rem' }}>{r.startDate || '\u2014'}</td>
                        <td style={{ padding:'0.5rem' }}>{r.endDate || '\u2014'}</td>
                        <td style={{ padding:'0.5rem' }}>
                          <select value={r.status || ''} onChange={e => handleRegStatus(r.id, e.target.value)}
                                  style={{ padding:'0.25rem 0.5rem', borderRadius:'4px', border:'1px solid var(--border)', fontSize:'0.8rem' }}>
                            <option value="">Set status</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Uncertain">Uncertain</option>
                            <option value="Declined">Declined</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                    {/* Add-event row - inputs sit directly under their columns */}
                    <tr style={{ borderTop:'2px solid var(--border)' }}>
                      <td style={{ padding:'0.5rem' }}>
                        <input value={addSourceOfLead} onChange={e => setAddSourceOfLead(e.target.value)} placeholder="Source of lead"
                               style={{ width:'100%', padding:'0.25rem 0.4rem', borderRadius:4, border:'1px solid var(--border)', fontSize:'0.8rem', boxSizing:'border-box' }} />
                      </td>
                      <td style={{ padding:'0.5rem' }}>
                        <input value={addSource} onChange={e => setAddSource(e.target.value)} placeholder="Source"
                               style={{ width:'100%', padding:'0.25rem 0.4rem', borderRadius:4, border:'1px solid var(--border)', fontSize:'0.8rem', boxSizing:'border-box' }} />
                      </td>
                      <td style={{ padding:'0.5rem' }}>
                        <select value={addEventId} onChange={e => setAddEventId(e.target.value)}
                                style={{ width:'100%', padding:'0.25rem 0.4rem', borderRadius:4, border:'1px solid var(--border)', fontSize:'0.8rem', boxSizing:'border-box' }}>
                          <option value="">+ add an event...</option>
                          {availableEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.group ? (ev.group + ' - ') : ''}{ev.name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding:'0.5rem', color:'var(--text-secondary)' }}>-</td>
                      <td style={{ padding:'0.5rem', color:'var(--text-secondary)' }}>-</td>
                      <td style={{ padding:'0.5rem' }}>
                        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                          <select value={addEventStatus} onChange={e => setAddEventStatus(e.target.value)}
                                  style={{ padding:'0.25rem 0.4rem', borderRadius:4, border:'1px solid var(--border)', fontSize:'0.8rem' }}>
                            <option value="">Set status</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Uncertain">Uncertain</option>
                            <option value="Declined">Declined</option>
                          </select>
                          <button onClick={addRegistration} disabled={!addEventId || addingEvent}
                                  style={{ padding:'0.3rem 0.7rem', borderRadius:6, border:'none', background:'var(--primary)', color:'#fff', fontWeight:600, fontSize:'0.78rem', whiteSpace:'nowrap', cursor:(!addEventId||addingEvent)?'not-allowed':'pointer', opacity:(!addEventId||addingEvent)?0.6:1 }}>
                            {addingEvent ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {eventOptions.length > 0 && availableEvents.length === 0 && (
                  <div style={{ padding:'0.5rem 0', color:'var(--text-secondary)', fontSize:'0.8rem' }}>All events already linked.</div>
                )}
              </div>
            )}
          </div>

          {/* Self Assessment */}
          <div className="section-card">
            <div className="section-header" style={{ justifyContent:'space-between' }}>
              <span className="section-title">Self Assessment</span>
              {canRecalc && !editMode && (
                <button className="btn btn--secondary btn--sm" onClick={handleRecalculateRisk} disabled={recalculating}>
                  <FiRefreshCw size={12}/> {recalculating ? 'Recalculating...' : 'Recalculate Risk'}
                </button>
              )}
            </div>

            {lead.stoneTier && STONE_IMAGES[lead.stoneTier] && (
              <div style={{
                display:'flex', alignItems:'center', gap:'1rem',
                background:'var(--bg-secondary)', borderRadius:'10px',
                padding:'1rem', marginBottom:'1rem',
                border:'1px solid var(--border)',
              }}>
                <img src={STONE_IMAGES[lead.stoneTier]} alt={lead.stoneTier}
                  style={{ width:'56px', height:'56px', objectFit:'contain', flexShrink:0 }}/>
                <p style={{ margin:0, fontSize:'0.875rem', lineHeight:1.6, color:'var(--text-primary)' }}>
                  <strong>Congratulations! {lead.stoneTier}</strong> — {STONE_MESSAGES[lead.stoneTier]}
                </p>
              </div>
            )}

            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <EditField label="Source of Lead"      name="leadSource"        value={d.leadSource}        onChange={updateEdit} options={withCur(sourceOfLeadOpts, d.leadSource)}/>
                <EditField label="Source"              name="source"            value={d.source}            onChange={updateEdit} options={withCur(sourceOptsFor(d.leadSource), d.source)}/>
                <EditField label="Source detail"       name="sourceDetail"      value={d.sourceDetail}      onChange={updateEdit} options={withCur(sourceDetailOptsFor(d.leadSource, d.source), d.sourceDetail)}/>
                <EditField label="Interaction"         name="interaction"       value={d.interaction}       onChange={updateEdit} options={INTERACTION_OPTS}/>
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
                <Field label="Source of Lead"      value={lead.leadSource}/>
                <Field label="Source"              value={lead.source}/>
                <Field label="Source detail"       value={lead.sourceDetail}/>
                <Field label="Interaction"         value={lead.interaction}/>
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

          {/* Career Fit / OCEAN */}
          <div className="section-card">
            <div className="section-header" style={{ justifyContent:'space-between' }}>
              <span className="section-title">Career Fit — OCEAN Profile</span>
              {canRecalc && !editMode && oceanAnsweredCount === 15 && (
                <button className="btn btn--secondary btn--sm" onClick={handleRecalculateOcean} disabled={recalcOcean}>
                  <FiRefreshCw size={12}/> {recalcOcean ? 'Recalculating...' : 'Recalculate'}
                </button>
              )}
            </div>

            {oceanResult ? (
              <div style={{ marginBottom:'1rem' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3rem', alignItems:'start', marginBottom:'1rem' }}>

                  {/* LEFT: radar chart + single bar-style trait table */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'12px' }}>
                    <svg width="200" height="195" viewBox="-15 0 230 195" style={{ overflow:'visible' }}>
                      {(() => {
                        const cx=100, cy=100, r=70;
                        const keys = ['extraversion','agreeableness','conscientiousness','neuroticism','openness'];
                        const angles = keys.map((_,i) => (Math.PI*2*i)/5 - Math.PI/2);
                        const pt = (a, rad) => [cx + rad*Math.cos(a), cy + rad*Math.sin(a)];
                        const rings = [0.33,0.67,1.0];
                        const scorePoints = keys.map((k,i) => {
                          const v = Math.max(0, Math.min(15, Number(oceanResult.scores[k])||0));
                          return pt(angles[i], (v/15)*r);
                        });
                        const labels = ['Extraversion','Agree.','Conscient.','Neurotic.','Open.'];
                        const offsets = [{dx:0,dy:-14},{dx:14,dy:0},{dx:8,dy:14},{dx:-8,dy:14},{dx:-18,dy:0}];
                        const anchors = ['middle','start','middle','middle','end'];
                        return (<>
                          {rings.map((ratio,ri) => (
                            <polygon key={ri} points={angles.map(a=>pt(a,r*ratio).join(',')).join(' ')} fill="none" stroke="#e5e7eb" strokeWidth={ri===2?1:0.5}/>
                          ))}
                          {angles.map((a,i) => { const [x,y]=pt(a,r); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth="0.5"/>; })}
                          <polygon points={scorePoints.map(p=>p.join(',')).join(' ')} fill="rgba(234,170,60,0.2)" stroke="#EAA83C" strokeWidth="1.5"/>
                          {scorePoints.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3" fill="#EAA83C"/>)}
                          {labels.map((label,i) => {
                            const [bx,by]=pt(angles[i],r+14);
                            const {dx,dy}=offsets[i];
                            return <text key={i} x={bx+dx} y={by+dy} textAnchor={anchors[i]} fontSize="11" fill="#6b7280">{label}</text>;
                          })}
                        </>);
                      })()}
                    </svg>
                    <div style={{ width:'90%' }}>
                      {['extraversion','agreeableness','conscientiousness','neuroticism','openness'].map(k => {
                        const score = Number(oceanResult.scores[k]) || 0;
                        const lv = score >= 12 ? { label:'High', color:'var(--primary)' }
                                 : score >= 7  ? { label:'Average', color:'#EAA83C' }
                                 :               { label:'Low', color:'var(--text-secondary)' };
                        const pct = Math.round((score/15)*100);
                        return (
                          <div key={k} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'3px 0', borderBottom:'1px solid var(--border)', fontSize:'12px' }}>
                            <span style={{ width:'120px', color:'var(--text-secondary)', textTransform:'capitalize', flexShrink:0 }}>{k}</span>
                            <div style={{ flex:1, height:'6px', background:'var(--border)', borderRadius:'3px', overflow:'hidden' }}>
                              <div style={{ width:`${pct}%`, height:'100%', background:lv.color, borderRadius:'3px' }}/>
                            </div>
                            <span style={{ width:'56px', textAlign:'right', fontWeight:600, color:lv.color, flexShrink:0 }}>{lv.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* RIGHT: archetype */}
                  {oceanResult.archetype && (() => {
                    const arch   = oceanResult.archetype;
                    const colors = oceanResult.colors || GROUP_COLORS[arch.group] || { badge:'#4F46E5' };
                    return (
                      <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                        <span style={{ display:'inline-block', background:colors.badge, color:'#fff', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', padding:'3px 10px', borderRadius:'20px', alignSelf:'flex-start' }}>
                          {arch.group}
                        </span>
                        <div style={{ fontSize:'1.125rem', fontWeight:600, color:'var(--text-primary)', lineHeight:1.2 }}>
                          {arch.name}
                        </div>
                        <div>
                          <div style={{ fontSize:'11px', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' }}>Best Career Paths</div>
                          <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                            {arch.careers.map((c, i) => (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'0.8125rem' }}>
                                <span style={{ width:'18px', height:'18px', borderRadius:'50%', background:colors.badge, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:600, flexShrink:0 }}>{i+1}</span>
                                <span style={{ color:'var(--text-primary)' }}>{c}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {oceanResult.flexTraits?.length > 0 && (
                          <div>
                            <div style={{ fontSize:'11px', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' }}>Flex Potential</div>
                            <div style={{ fontSize:'13px', color:'var(--text-secondary)', lineHeight:1.5, marginBottom:'8px' }}>
                              With development these traits could unlock additional archetypes:
                            </div>
                            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                              {oceanResult.flexTraits.map((f, i) => (
                                <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', color:'var(--text-secondary)' }}>
                                  <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#EAA83C', flexShrink:0 }}/>
                                  {f.trait} (score {f.score})
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {oceanResult.narrative && (
                  <p style={{ fontSize:'0.875rem', lineHeight:1.6, color:'var(--text-secondary)', borderTop:'1px solid var(--border)', paddingTop:'1rem' }}>
                    {oceanResult.narrative}
                  </p>
                )}
              </div>
            ) : (
              <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem', marginBottom:'1rem', padding:'0.75rem', background:'var(--bg-secondary)', borderRadius:'8px' }}>
                {oceanAnsweredCount === 0
                  ? 'No OCEAN assessment completed yet.'
                  : `${oceanAnsweredCount}/15 questions answered — recalculate to generate profile.`}
              </div>
            )}

            <div>
              <button className="btn btn--ghost btn--sm" onClick={()=>setShowOceanQuestions(o=>!o)}
                style={{ marginBottom:'0.75rem' }}>
                {showOceanQuestions ? <FiChevronUp size={12}/> : <FiChevronDown size={12}/>}
                {showOceanQuestions ? ' Hide' : ' Show'} Question Responses
              </button>

              {showOceanQuestions && (
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  {OCEAN_QUESTIONS.map(({ id: qid, text }) => {
                    const val = editMode ? (editData[`oceanQ${qid}`] || null) : (lead[`oceanQ${qid}`] || null);
                    return (
                      <div key={qid} style={{
                        display:'grid', gridTemplateColumns:'24px 1fr auto',
                        gap:'0.5rem', alignItems:'center',
                        padding:'0.5rem', borderRadius:'6px',
                        background:'var(--bg-secondary)', fontSize:'0.8125rem',
                      }}>
                        <span style={{
                          background: val ? 'var(--primary)' : 'var(--border)',
                          color: val ? '#fff' : 'var(--text-secondary)',
                          borderRadius:'50%', width:'20px', height:'20px',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:'0.7rem', fontWeight:700, flexShrink:0,
                        }}>{qid}</span>
                        <span style={{ color:'var(--text-primary)' }}>{text}</span>
                        {editMode ? (
                          <select className="form-select"
                            style={{ width:'160px', fontSize:'0.75rem', padding:'0.25rem' }}
                            value={val||''}
                            onChange={e=>updateEdit(`oceanQ${qid}`, e.target.value ? Number(e.target.value) : null)}>
                            <option value="">—</option>
                            {[1,2,3,4,5].map(v=>(
                              <option key={v} value={v}>{v} — {LIKERT_LABELS[v]}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{
                            fontWeight:600, color: val ? 'var(--primary)' : 'var(--text-secondary)',
                            fontSize:'0.8125rem', minWidth:'80px', textAlign:'right',
                          }}>
                            {val ? `${val} — ${LIKERT_LABELS[val]}` : '—'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Family Contacts */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Family Contacts</span></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.8125rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Mother</div>
                {editMode ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                    <EditField label="Name"           name="motherFullName"      value={d.motherFullName}      onChange={updateEdit}/>
                    <EditField label="Email"          name="motherEmail"         value={d.motherEmail}         onChange={updateEdit} type="email"/>
                    <EditField label="Phone"          name="motherPhone"         value={d.motherPhone}         onChange={updateEdit}/>
                    <EditField label="Contact Medium" name="motherContactMedium" value={d.motherContactMedium} onChange={updateEdit} options={CONTACT_MEDIUM_OPTS}/>
                    <EditField label="Contact Detail" name="motherContactDetail" value={d.motherContactDetail} onChange={updateEdit}/>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                    <Field label="Name"           value={lead.motherFullName}/>
                    <Field label="Email"          value={lead.motherEmail}/>
                    <Field label="Phone"          value={lead.motherPhone}/>
                    <Field label="Contact Medium" value={lead.motherContactMedium}/>
                    <Field label="Contact Detail" value={lead.motherContactDetail}/>
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.8125rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Father</div>
                {editMode ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                    <EditField label="Name"           name="fatherFullName"      value={d.fatherFullName}      onChange={updateEdit}/>
                    <EditField label="Email"          name="fatherEmail"         value={d.fatherEmail}         onChange={updateEdit} type="email"/>
                    <EditField label="Phone"          name="fatherPhone"         value={d.fatherPhone}         onChange={updateEdit}/>
                    <EditField label="Contact Medium" name="fatherContactMedium" value={d.fatherContactMedium} onChange={updateEdit} options={CONTACT_MEDIUM_OPTS}/>
                    <EditField label="Contact Detail" name="fatherContactDetail" value={d.fatherContactDetail} onChange={updateEdit}/>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                    <Field label="Name"           value={lead.fatherFullName}/>
                    <Field label="Email"          value={lead.fatherEmail}/>
                    <Field label="Phone"          value={lead.fatherPhone}/>
                    <Field label="Contact Medium" value={lead.fatherContactMedium}/>
                    <Field label="Contact Detail" value={lead.fatherContactDetail}/>
                  </div>
                )}
              </div>
            </div>
          </div>
          </>)}

          {/* Notes — Lead-level only; hidden on the Sales-record (student) view */}
          {!isStudentView && (
          <div className="section-card">
            <div className="section-header"><span className="section-title">Notes</span></div>
            <div style={{ marginBottom:'1.25rem' }}>
              <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.75rem' }}>
                {Object.entries(NOTE_TYPES).map(([type, label]) => (
                  canDo('notes', `write_${type}`) && (
                    <button key={type}
                      className={`btn btn--sm ${noteType===type?'btn--primary':'btn--secondary'}`}
                      onClick={()=>setNoteType(type)}>
                      {label}
                    </button>
                  )
                ))}
              </div>
              {canDo('notes', `write_${noteType}`) && (
                <>
                  {!canAddNotes && (
                    <div style={{
                      marginBottom:'0.75rem', padding:'0.625rem 0.875rem',
                      background:'#fff7ed', border:'1px solid #fed7aa',
                      borderRadius:'6px', fontSize:'0.8125rem', color:'#9a3412',
                    }}>
                      <strong>Notes are locked.</strong> Please complete the following fields and save before adding notes:
                      <ul style={{ margin:'0.4rem 0 0 1.25rem', padding:0 }}>
                        {notesMissing.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {!showNoteForm ? (
                    <button onClick={()=>setShowNoteForm(true)} disabled={!canAddNotes}
                      className="btn btn--primary"
                      style={{ alignSelf:'flex-start', display:'flex', alignItems:'center', gap:'0.4rem', opacity:canAddNotes?1:0.5, cursor:canAddNotes?'pointer':'not-allowed' }}>
                      <FiPlus size={14}/> New Note
                    </button>
                  ) : (
                    <div style={{ background:'var(--bg-secondary)', borderRadius:'10px', padding:'1rem', border:'1px solid var(--border)' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.875rem' }}>
                        <span style={{ fontWeight:700, fontSize:'0.9375rem' }}>New Note</span>
                        <button onClick={()=>setShowNoteForm(false)}
                          style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.1rem', color:'var(--text-secondary)', lineHeight:1 }}>✕</button>
                      </div>
                      <NoteForm
                        topicOptions={topicOptions}
                        saving={addingNote}
                        disabled={!canAddNotes}
                        onSubmit={async (data) => { await addNote(data); setShowNoteForm(false); }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            {notes.length>0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem', alignItems:'center', marginBottom:'0.25rem' }}>
                <input
                  type="text"
                  value={noteSearch}
                  onChange={e=>setNoteSearch(e.target.value)}
                  placeholder="Search notes — author, institution, keyword…"
                  style={{ flex:'1 1 220px', minWidth:0, padding:'0.4rem 0.625rem', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg-secondary)', color:'var(--text-primary)', fontSize:'0.8125rem' }}
                />
                <select
                  value={noteTypeFilter}
                  onChange={e=>setNoteTypeFilter(e.target.value)}
                  style={{ padding:'0.4rem 0.625rem', borderRadius:'8px', border:'1px solid var(--border)', background:'var(--bg-secondary)', color:'var(--text-primary)', fontSize:'0.8125rem' }}>
                  <option value="all">All types</option>
                  <option value="counselor">Counsellor</option>
                  <option value="presales">Pre-sales</option>
                  <option value="management">Management</option>
                </select>
                <button
                  type="button"
                  onClick={()=>setNotePhoneOnly(v=>!v)}
                  title="Show only notes that mention a phone call (same rule as Activity Report)"
                  style={{ display:'flex', alignItems:'center', gap:'0.35rem', padding:'0.4rem 0.7rem', borderRadius:'8px', cursor:'pointer', fontSize:'0.8125rem', fontWeight:600,
                    border:`1px solid ${notePhoneOnly?'#10B981':'var(--border)'}`,
                    background:notePhoneOnly?'#10B98122':'var(--bg-secondary)',
                    color:notePhoneOnly?'#047857':'var(--text-secondary)' }}>
                  <FiPhone size={13}/> Phone calls
                </button>
                {(noteSearch||noteTypeFilter!=='all'||notePhoneOnly) && (
                  <button type="button" onClick={()=>{setNoteSearch('');setNoteTypeFilter('all');setNotePhoneOnly(false);}}
                    style={{ padding:'0.4rem 0.625rem', borderRadius:'8px', border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', fontSize:'0.8125rem', cursor:'pointer' }}>
                    Clear
                  </button>
                )}
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:'0.875rem' }}>
              {notes.length===0 && <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No notes yet</div>}
              {(() => {
                const q = noteSearch.trim().toLowerCase();
                const anyFilter = q!=='' || noteTypeFilter!=='all' || notePhoneOnly;
                // A note matches when it satisfies ALL active filters. Keyword
                // searches content + author + topic; institution and other
                // mentions live in the content.
                const noteMatches = (n) => {
                  if (noteTypeFilter!=='all' && n.noteType!==noteTypeFilter) return false;
                  if (notePhoneOnly && !containsPhoneMention(n.content)) return false;
                  if (q) {
                    const hay = `${n.content||''} ${n.authorName||''} ${n.topic||''}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                  }
                  return true;
                };
                const topicMap = new Map();
                [...notes].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).forEach(n=>{
                  const key = n.topic||'__none__';
                  if (!topicMap.has(key)) topicMap.set(key,[]);
                  topicMap.get(key).push(n);
                });
                let threads = [...topicMap.entries()].sort((a,b)=>{
                  const la=a[1][a[1].length-1], lb=b[1][b[1].length-1];
                  const ca=la?.reminderStatus==='closed', cb=lb?.reminderStatus==='closed';
                  if (ca!==cb) return ca?1:-1;
                  return new Date(lb.createdAt)-new Date(la.createdAt);
                });
                // Thread-level filtering: keep a thread when any of its entries
                // matches the active filters (preserves the reminder workflow).
                if (anyFilter) threads = threads.filter(([,tn]) => tn.some(noteMatches));
                if (anyFilter && threads.length===0)
                  return <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No notes match these filters.</div>;
                return threads.map(([key,threadNotes])=>(
                  <NoteThread key={key}
                    topic={key==='__none__'?null:key}
                    notes={threadNotes}
                    matchFn={anyFilter ? noteMatches : undefined}
                    staff={staff}
                    canAppend={canDo('notes','write_counselor')}
                    onDelete={deleteNote}
                    onAppend={async (noteId,appendText,appendFollowUpDate)=>{
                      try {
                        const data = await notesAPI.append(noteId,appendText,appendFollowUpDate);
                        setNotes(n=>n.map(x=>x.id===noteId?data.data:x));
                      } catch(e){ alert(e.message); }
                    }}
                    onUpdateReminder={async (noteId,update)=>{
                      try {
                        const data = await notesAPI.updateReminder(noteId,update);
                        setNotes(n=>n.map(x=>x.id===noteId?{...x,...data.data}:x));
                      } catch(e){ alert(e.message); }
                    }}
                  />
                ));
              })()}
            </div>
          </div>
          )}

          {isStudentView && (
          <div className="section-card">
            <div className="section-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span className="section-title">Sales leads ({studentLeads.length})</span>
              {canEdit && (
                <button className="btn btn--secondary btn--sm" onClick={createNewLead} title="Add a new lead for this student">
                  <FiPlus size={13}/> New Lead
                </button>
              )}
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['Lead','Intake','Institution','Status'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'0.5rem 0.75rem', borderBottom:'1px solid var(--border)', fontSize:'0.75rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.03em' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {studentLeads.map(sl => (
                  <tr key={sl.leadId} onClick={()=>navigate(`/lead/${sl.leadId}`)}
                    style={{ cursor:'pointer', background: String(sl.leadId)===String(id) ? 'var(--bg-secondary)' : 'transparent' }}>
                    <td style={{ padding:'0.5rem 0.75rem', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{sl.leadId}</td>
                    <td style={{ padding:'0.5rem 0.75rem', borderBottom:'1px solid var(--border)' }}>{sl.intake || '—'}</td>
                    <td style={{ padding:'0.5rem 0.75rem', borderBottom:'1px solid var(--border)' }}>{sl.targetInstitution || '—'}</td>
                    <td style={{ padding:'0.5rem 0.75rem', borderBottom:'1px solid var(--border)' }}>{sl.leadStatus || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* Change History */}
          <div className="section-card">
            <div className="section-header" style={{ cursor:'pointer' }}
              onClick={()=>setShowHistory(h=>!h)}>
              <span className="section-title">Change History ({auditLog.length})</span>
              {showHistory ? <FiChevronUp size={15}/> : <FiChevronDown size={15}/>}
            </div>
            {showHistory && (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {auditLog.length===0 && (
                  <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No changes recorded yet</div>
                )}
                {auditLog.map(entry=>(
                  <div key={entry.id} style={{
                    display:'grid', gridTemplateColumns:'140px 1fr',
                    gap:'0.5rem', padding:'0.5rem 0',
                    borderBottom:'1px solid var(--border)', fontSize:'0.8125rem',
                  }}>
                    <div style={{ color:'var(--text-secondary)' }}>
                      <div style={{ fontFamily:'DM Mono', fontSize:'0.75rem' }}>{formatDate(entry.changedAt)}</div>
                      <div style={{ fontWeight:500, marginTop:'0.125rem' }}>{entry.changedBy}</div>
                    </div>
                    <div>
                      <span style={{ fontWeight:500 }}>{FIELD_LABELS[entry.fieldName]||entry.fieldName}</span>
                      <div style={{ marginTop:'0.25rem', display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                        <span style={{ background:'var(--bg-secondary)', padding:'0.125rem 0.5rem', borderRadius:'4px', color:'var(--danger)', fontSize:'0.75rem', textDecoration:'line-through' }}>
                          {entry.oldValue||'—'}
                        </span>
                        <span style={{ color:'var(--text-secondary)', fontSize:'0.75rem' }}>→</span>
                        <span style={{ background:'var(--bg-secondary)', padding:'0.125rem 0.5rem', borderRadius:'4px', color:'#16a34a', fontSize:'0.75rem' }}>
                          {entry.newValue||'—'}
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

          {/* Summary */}
          <div className="section-card" style={{ maxHeight:'320px', overflowY:'auto' }}>
            <div className="section-header"><span className="section-title">Summary</span></div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              {(!isStudentView || !canAssign) && (<>
                <Field label="Counselor"        value={lead.counselor}/>
                <Field label="Senior Counselor" value={lead.seniorCounselor}/>
                <Field label="Pre-Sales"        value={lead.presales}/>
                <Field label="Marketing Staff"  value={lead.marketingStaff}/>
              </>)}
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:'0.5rem', marginTop:'0.25rem' }}>
                <Field label="Stone Tier" value={lead.stoneTier}/>
                <Field label="Risk Score" value={lead.riskScore}/>
              </div>
              {oceanResult && (
                <div style={{ borderTop:'1px solid var(--border)', paddingTop:'0.5rem', marginTop:'0.25rem' }}>
                  <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500, marginBottom:'0.25rem' }}>OCEAN Scores</div>
                  {Object.entries(oceanResult.scores).map(([trait, score]) => (
                    <div key={trait} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.8125rem', padding:'0.125rem 0' }}>
                      <span style={{ textTransform:'capitalize', color:'var(--text-secondary)' }}>{trait}</span>
                      <span style={{ fontWeight:600 }}>{score}/15</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sales Order Phase + Staff Assignment — set on the person view; cascades to active leads */}
          {isStudentView && canAssign && (
            <div className="section-card" style={{ maxHeight:'520px', overflowY:'auto' }}>

              {/* ── Phase mover ── the phase governs which positions below are editable */}
              <div className="section-header"><span className="section-title">Sales Order Phase</span></div>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem', marginBottom:'1.25rem' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                  <span style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>Current phase:</span>
                  <span style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
                                 padding:'2px 8px', borderRadius:'4px', background: phaseBg, color:'#fff' }}>
                    {phaseLabel || '—'}
                  </span>
                </div>
                {phaseInfo.nextPhases.length > 0 ? (
                  <>
                    <div className="form-group">
                      <label className="form-label">Move to phase</label>
                      <select className="form-select" value={phaseTarget}
                        onChange={e => { setPhaseTarget(e.target.value); setPhasePosition(''); setPhaseOwner(''); }}>
                        <option value="">— select —</option>
                        {phaseInfo.nextPhases.map(p => (
                          <option key={p} value={p}>{p === 'Presales' ? 'Pre-Sales' : p}</option>
                        ))}
                      </select>
                    </div>
                    {/* Position — only when the phase has more than one slot (Pool, Case Officers) */}
                    {phaseTarget && (PHASE_SLOTS[phaseTarget] || []).length > 1 && (
                      <div className="form-group">
                        <label className="form-label">Position</label>
                        <select className="form-select" value={phasePosition} onChange={e => setPhasePosition(e.target.value)}>
                          <option value="">— select position —</option>
                          {(PHASE_SLOTS[phaseTarget] || []).map(pos => (
                            <option key={pos} value={pos}>{POSITION_LABEL[pos] || pos}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {phaseTarget && (
                      <div className="form-group">
                        <label className="form-label">Recipient {RECIPIENT_REQUIRED.has(phaseTarget)
                          ? <span style={{ fontWeight:400, color:'var(--danger)' }}>(required)</span>
                          : <span style={{ fontWeight:400, color:'var(--text-secondary)' }}>(optional)</span>}</label>
                        <select className="form-select" value={phaseOwner} onChange={e => setPhaseOwner(e.target.value)}>
                          <option value="">Leave unassigned</option>
                          {staffFor(PHASE_POSITIONS[phaseTarget], phaseOwner).map(s => (
                            <option key={s.id} value={s.fullName}>{s.fullName} ({s.position})</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <button className="btn btn--primary btn--sm" style={{ alignSelf:'flex-start' }}
                      onClick={handleMovePhase}
                      disabled={movingPhase || !phaseTarget
                                || ((PHASE_SLOTS[phaseTarget] || []).length > 1 && !phasePosition)
                                || (RECIPIENT_REQUIRED.has(phaseTarget) && !phaseOwner)}>
                      {movingPhase ? 'Moving…' : 'Move Phase'}
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>No onward phases configured from here.</div>
                )}
              </div>

              {/* ── Staff assignment — a field is editable only when its position is active in the current phase ── */}
              <div className="section-header"><span className="section-title">Staff Assignment <span style={{ fontWeight:400, fontSize:'0.75rem', color:'var(--text-secondary)' }}>(Sales Order — cascades to active leads)</span></span></div>
              <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                {ASSIGN_ROWS.map(({ position, label, field }) => {
                  const editable = phaseInfo.editablePositions.includes(position);
                  const value    = field ? (assign[field] || '') : (posAssign[position] || '');
                  const onChange = field
                    ? (e => setAssign(a => ({ ...a, [field]: e.target.value })))
                    : (e => setPosAssign(p => ({ ...p, [position]: e.target.value })));
                  return (
                    <div className="form-group" key={position}>
                      <label className="form-label">
                        {label}
                        {!editable && <span style={{ fontWeight:400, fontSize:'0.6875rem', color:'var(--text-secondary)' }}> · not in current phase</span>}
                      </label>
                      <select className="form-select" value={value} disabled={!editable}
                        title={editable ? '' : 'This position is not editable in the current phase — move the Order to its phase to reassign.'}
                        onChange={onChange}>
                        <option value="">Unassigned</option>
                        {staffFor(position, value).map(s=>(
                          <option key={s.id} value={s.fullName}>{s.fullName} ({s.position})</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {contactModal && (
      <ContactLogModal
        topicOptions={topicOptions}
        method={contactModal.method}
        studentName={lead?.fullName || 'Student'}
        studentEmail={lead?._raw_email || lead?.email || ''}
        studentPhone={lead?._raw_phone || lead?.phone || ''}
        connectWithUs={lead?._raw_connectWithUs || lead?.connectWithUs || ''}
        staffName={staff?.fullName || 'Counselor'}
        timestamp={contactModal.openedAt}
        documents={[]}
        onSave={handleContactSave}
        onCancel={handleContactCancel}
      />
    )}
  </>
  );
}
