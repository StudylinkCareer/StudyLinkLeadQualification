// src/pages/PendingDrafts.jsx
// Cross-device note drafts (2026-08) — list of the current staffer's
// pending "locked but not yet filled in" notes, wherever they were started
// (this device or another). Resume opens the right Lead/Student page with
// the draft already locked in, ready to fill; Discard abandons it.
import { useNavigate } from 'react-router-dom';
import { noteDraftsAPI } from '../services/api';
import { useNoteDrafts } from '../contexts/NoteDraftsContext';

const CONTACT_LABELS = { call:'Phone Call', sms:'Text Message', zalo:'Zalo', whatsapp:'WhatsApp', messenger:'Messenger', email:'Email' };
const CONTACT_ICONS  = { call:'📞', sms:'💬', zalo:'Z', whatsapp:'W', messenger:'M', email:'✉' };

function formatDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

export default function PendingDrafts() {
  const { drafts, loading, refresh } = useNoteDrafts();
  const navigate = useNavigate();

  async function resume(draft) {
    // Lead-level draft (contactModal opened from a Lead page) vs. a
    // student-level one (opened from the Sales/Student page) — route to
    // whichever page originally hosted it. Either page's ContactLogModal
    // recognizes ?resumeDraft=<id> and reopens already-locked.
    const target = draft.leadId ? `/leads/${draft.leadId}` : `/students/${draft.studentId}`;
    navigate(`${target}?resumeDraft=${draft.id}`);
  }

  async function discard(draft) {
    if (!window.confirm(`Discard this pending ${CONTACT_LABELS[draft.method] || draft.method} note for ${draft.contactName || draft.studentId}? This cannot be undone.`)) return;
    try {
      await noteDraftsAPI.discard(draft.id);
      refresh();
    } catch (e) { alert(e.message); }
  }

  return (
    <div style={{ padding:'1.5rem', maxWidth:'900px', margin:'0 auto' }}>
      <h1 style={{ fontSize:'1.375rem', fontWeight:700, marginBottom:'0.25rem' }}>Pending Notes</h1>
      <p style={{ color:'var(--text-secondary)', fontSize:'0.875rem', marginBottom:'1.25rem' }}>
        Notes locked by a "Make phone call" (or similar) click — started but not yet filled in and saved.
        These stay pending indefinitely until you finish or discard them.
      </p>

      {loading ? (
        <div style={{ color:'var(--text-secondary)' }}>Loading…</div>
      ) : drafts.length === 0 ? (
        <div style={{ color:'var(--text-secondary)' }}>No pending notes — you're all caught up.</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
          {drafts.map(d => (
            <div key={d.id} style={{ background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'10px', padding:'0.875rem 1rem', display:'flex', alignItems:'center', gap:'0.875rem', flexWrap:'wrap' }}>
              <div style={{ fontSize:'1.25rem', width:'2rem', textAlign:'center' }}>{CONTACT_ICONS[d.method] || '📝'}</div>
              <div style={{ flex:1, minWidth:'220px' }}>
                <div style={{ fontWeight:600, fontSize:'0.9375rem' }}>
                  {CONTACT_LABELS[d.method] || d.method} — {d.contactName || d.studentFullName || d.studentId}
                </div>
                <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                  Started {formatDate(d.createdAt)}{d.studentFullName ? ` · Student: ${d.studentFullName}` : ''}
                </div>
              </div>
              <button onClick={() => resume(d)}
                style={{ padding:'0.4rem 0.875rem', borderRadius:'8px', border:'none', background:'var(--primary)', color:'#fff', fontWeight:600, fontSize:'0.8125rem', cursor:'pointer' }}>
                Resume
              </button>
              <button onClick={() => discard(d)}
                style={{ padding:'0.4rem 0.875rem', borderRadius:'8px', border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', fontWeight:600, fontSize:'0.8125rem', cursor:'pointer' }}>
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
