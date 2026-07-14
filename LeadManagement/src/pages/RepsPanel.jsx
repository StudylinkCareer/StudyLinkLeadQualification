// C:/Users/rhod_/Documents/StudyLinkLeadQualification/LeadManagement/src/pages/RepsPanel.jsx
// ─────────────────────────────────────────────────────────────────────
// Phase 2.2a — manage Event-staff reps for an exhibition.
// Add a rep (institution rep tied to a desk, or roving StudyLink staff),
// set their validity window, and hand out their PIN + personal sign-in link.
// Rendered inside EventConsole's "Reps" tab. Self-contained.
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { eventConsoleAPI } from '../services/api';

const LQ_BASE = import.meta.env.VITE_LQ_BASE_URL || '';

// 'YYYY-MM-DDTHH:mm' for <input type="datetime-local"> from an ISO/date string.
const toLocalInput = (iso, fallbackTime) => {
  if (!iso) return '';
  const datePart = String(iso).slice(0, 10);
  return `${datePart}T${fallbackTime}`;
};
const fmtWindow = (a, b) => {
  const f = (d) => { try { return d ? new Date(d).toLocaleString() : '—'; } catch { return '—'; } };
  return `${f(a)}  →  ${f(b)}`;
};

export default function RepsPanel({ eventId, selected }) {
  const [reps, setReps]       = useState([]);
  const [desks, setDesks]     = useState([]);   // event_institutions, for the desk picker
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState('');
  const [sendingId, setSendingId] = useState(null);

  // Add-rep form — pick existing staff OR type a new recruit's name.
  const [staffPool, setStaffPool]     = useState([]);
  const [staffId, setStaffId]         = useState('');
  const [newName, setNewName]         = useState('');   // new recruit (not in staff table)
  const [newCred, setNewCred]         = useState(null); // {logonId,password} to show the creator
  const [kind, setKind]               = useState('institution');   // 'institution' | 'studylink'
  const [institutionId, setInstId]    = useState('');
  const [validFrom, setValidFrom]     = useState('');
  const [validUntil, setValidUntil]   = useState('');

  const loadReps = useCallback(async (id) => {
    if (!id) { setReps([]); return; }
    setLoading(true); setError('');
    try {
      const res = await eventConsoleAPI.listEventReps(id);
      setReps(res.data || []);
    } catch (e) {
      setError(e.message || 'Failed to load reps');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDesks = useCallback(async (id) => {
    if (!id) { setDesks([]); return; }
    try {
      const res = await eventConsoleAPI.listEventDesks(id);
      setDesks(res.data || []);
    } catch { /* desk picker just stays empty */ }
  }, []);

  useEffect(() => { loadReps(eventId); loadDesks(eventId); }, [eventId, loadReps, loadDesks]);

  // Staff pool for the rep picker (real staff only; global, load once).
  useEffect(() => {
    (async () => {
      try { const res = await eventConsoleAPI.staffPool(); setStaffPool(res.data || []); }
      catch { /* picker just stays empty */ }
    })();
  }, []);

  // Default the validity window to the event's dates when the event changes.
  useEffect(() => {
    if (!selected) return;
    setValidFrom(toLocalInput(selected.startDate, '08:00'));
    setValidUntil(toLocalInput(selected.endDate || selected.startDate, '18:00'));
  }, [selected]);

  const resetForm = () => { setStaffId(''); setNewName(''); setKind('institution'); setInstId(''); };

  const handleAdd = async () => {
    const nm = newName.trim();
    if (!staffId && !nm) { setError('Pick a staff member, or type a new recruit’s name.'); return; }
    if (kind === 'institution' && !institutionId) { setError('Pick an institution, or switch type to StudyLink (roving).'); return; }
    setBusy(true); setError(''); setNewCred(null);
    try {
      const res = await eventConsoleAPI.addEventRep(eventId, {
        staffId: staffId || undefined,
        fullName: staffId ? undefined : nm,   // new recruit → create by name
        kind,
        institutionId: kind === 'institution' ? institutionId : null,
        validFrom:  validFrom  ? new Date(validFrom).toISOString()  : null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      });
      resetForm();
      await loadReps(eventId);
      // New recruit → surface the login they must forward.
      if (res?.account) setNewCred(res.account);
    } catch (e) {
      setError(e.message || 'Failed to add rep');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenPin = async (repId) => {
    setError('');
    try { await eventConsoleAPI.regenRepPin(eventId, repId); await loadReps(eventId); }
    catch (e) { setError(e.message || 'Failed to regenerate PIN'); }
  };

  const handleRemove = async (repId) => {
    if (!window.confirm('Deactivate this rep? They will no longer be able to sign in.')) return;
    setError('');
    try { await eventConsoleAPI.removeEventRep(eventId, repId); await loadReps(eventId); }
    catch (e) { setError(e.message || 'Failed to remove rep'); }
  };

  const copy = (text) => { try { navigator.clipboard.writeText(text); } catch { /* no-op */ } };
  const linkFor = (token) => `${LQ_BASE}/desk?rep=${token}`;

  const handleEmailLink = async (repId) => {
    setError(''); setNotice(''); setSendingId(repId);
    try {
      const res = await eventConsoleAPI.emailRepLink(eventId, repId, LQ_BASE);
      setNotice(`Sign-in link sent to ${res?.data?.email || 'the rep'}.`);
    } catch (e) {
      setError(e.message || 'Failed to send sign-in link');
    } finally {
      setSendingId(null);
    }
  };

  // styles (match EventConsole)
  const card  = { background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'16px 18px' };
  const th    = { textAlign:'left', fontSize:12, textTransform:'uppercase', letterSpacing:'0.04em', color:'#6b7280', padding:'10px 12px', borderBottom:'1px solid #e5e7eb' };
  const td    = { padding:'10px 12px', borderBottom:'1px solid #f1f5f9', fontSize:14, verticalAlign:'top' };
  const input = { padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 };
  const blue  = { padding:'9px 16px', borderRadius:8, border:'none', background:'#2563eb', color:'#fff', fontWeight:600, cursor:'pointer' };
  const ghost = { padding:'7px 12px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:13 };

  return (
    <>
      {/* Add rep */}
      <div style={{ ...card, marginBottom:12 }}>
        {/* Single row: staff + institution grow to fill; the validity window stays
            a tidy group; Add rep pins to the right. Wraps gracefully when narrow.
            Hidden by request: "New recruit" free-text and the rep-type selector —
            adds are always an existing staff member as an Institution rep
            (kind stays 'institution', newName stays ''). */}
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <select
            value={staffId}
            onChange={(e) => { setStaffId(e.target.value); if (e.target.value) setNewName(''); }}
            disabled={!eventId}
            style={{ ...input, flex:'2 1 220px' }}
          >
            <option value="">Select staff member…</option>
            {staffPool.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}{s.role ? ` — ${s.role}` : ''}
              </option>
            ))}
          </select>
          <select
            value={institutionId}
            onChange={(e) => setInstId(e.target.value)}
            style={{ ...input, flex:'1 1 180px' }}
          >
            <option value="">Pick institution…</option>
            {desks.map((d) => <option key={d.id} value={d.institutionId}>{d.institutionName}</option>)}
          </select>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <label style={{ fontSize:13, color:'#6b7280' }}>Valid from</label>
            <input type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} style={input} />
            <label style={{ fontSize:13, color:'#6b7280' }}>until</label>
            <input type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={input} />
          </div>
          <button
            onClick={handleAdd}
            disabled={busy || !eventId || !staffId}
            style={{ ...blue, opacity: (busy || !staffId) ? 0.6 : 1, marginLeft:'auto' }}
          >{busy ? 'Adding…' : 'Add rep'}</button>
        </div>
      </div>

      {newCred && (
        <div style={{ ...card, marginBottom:12, background:'#ecfdf5', border:'1px solid #a7f3d0' }}>
          <div style={{ fontWeight:600, marginBottom:6 }}>New recruit account created — forward these to them:</div>
          <div style={{ fontSize:14, fontFamily:'monospace' }}>
            Logon ID: <b>{newCred.logonId}</b><br/>
            Password: <b>{newCred.password}</b>
          </div>
          <button style={{ ...ghost, marginTop:8 }}
            onClick={() => { navigator.clipboard?.writeText(`Logon ID: ${newCred.logonId}\nPassword: ${newCred.password}`); }}>
            Copy
          </button>
          <button style={{ ...ghost, marginTop:8, marginLeft:8 }} onClick={() => setNewCred(null)}>Dismiss</button>
        </div>
      )}

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'10px 14px', borderRadius:8, marginBottom:12, fontSize:14 }}>
          {error}
        </div>
      )}

      {notice && (
        <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', color:'#15803d', padding:'10px 14px', borderRadius:8, marginBottom:12, fontSize:14 }}>
          {notice}
        </div>
      )}

      {/* Reps list */}
      <div style={{ ...card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Rep</th>
              <th style={th}>Desk</th>
              <th style={th}>PIN</th>
              <th style={th}>Sign-in link</th>
              <th style={th}>Valid</th>
              <th style={{ ...th, textAlign:'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={6}>Loading…</td></tr>}
            {!loading && reps.length === 0 && (
              <tr><td style={{ ...td, color:'#6b7280' }} colSpan={6}>No reps yet. Add one above.</td></tr>
            )}
            {!loading && reps.map((r) => (
              <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                <td style={td}>
                  <div style={{ fontWeight:600 }}>{r.fullName}</div>
                  <div style={{ color:'#9ca3af', fontSize:12 }}>{r.position}{r.isActive ? '' : ' · deactivated'}</div>
                </td>
                <td style={td}>{r.institutionName || <span style={{ color:'#6b7280' }}>Roving</span>}</td>
                <td style={td}>
                  <span style={{ fontFamily:'monospace', fontSize:18, fontWeight:700, letterSpacing:'0.08em' }}>{r.eventPin}</span>
                </td>
                <td style={td}>
                  <button style={ghost} onClick={() => copy(linkFor(r.eventLoginToken))} title={linkFor(r.eventLoginToken)}>
                    Copy link
                  </button>
                  {r.isActive && r.sourceStaffId && (
                    <button
                      style={{ ...ghost, marginLeft:8 }}
                      onClick={() => handleEmailLink(r.id)}
                      disabled={sendingId === r.id}
                      title="Email this rep their one-click sign-in link"
                    >
                      {sendingId === r.id ? 'Sending…' : 'Email link'}
                    </button>
                  )}
                </td>
                <td style={{ ...td, fontSize:12, color:'#6b7280', whiteSpace:'nowrap' }}>{fmtWindow(r.validFrom, r.validUntil)}</td>
                <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                  {r.isActive && (
                    <>
                      <button style={{ ...ghost, marginRight:8 }} onClick={() => handleRegenPin(r.id)}>New PIN</button>
                      <button style={{ ...ghost, border:'1px solid #fecaca', color:'#b91c1c' }} onClick={() => handleRemove(r.id)}>Deactivate</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
