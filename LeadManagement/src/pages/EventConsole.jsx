// C:/Users/rhod_/Documents/StudyLinkLeadQualification/LeadManagement/src/pages/EventConsole.jsx
// ─────────────────────────────────────────────────────────────────────
// Event Management console.
//   Tab 1 — Roster & check-in (Phase 1): pick an exhibition/fair event, view
//           its roster (registered leads), search, and check attendees in.
//   Tab 2 — Desks (Phase 2.1): configure which institutions have a desk at
//           the event; each desk gets a token + 4-digit PIN to hand to the
//           rep staffing it. Up to 50 desks per event.
// All calls go through the shared api.js eventConsoleAPI helpers, so
// responses arrive camelCased (deskToken, deskPin, institutionName, …).
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { eventConsoleAPI } from '../services/api';
import RepsPanel from './RepsPanel';
import QualificationPanel from './QualificationPanel';
import { QRCodeSVG } from 'qrcode.react';
import { renderBadgePng, dataUrlToBase64 } from '../utils/badgeRenderer';

const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString() : ''; } catch { return ''; } };
const fmtTime = (d) => { try { return d ? new Date(d).toLocaleString()    : ''; } catch { return ''; } };

export default function EventConsole() {
  const [events, setEvents]   = useState([]);
  const [eventId, setEventId] = useState('');
  const [tab, setTab]         = useState('roster');   // 'roster' | 'desks'
  const [error, setError]     = useState('');

  // Roster tab state
  const [roster, setRoster]   = useState([]);
  const [q, setQ]             = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId]   = useState(null);   // uniqueId being checked in
  const [qrStudent, setQrStudent] = useState(null); // roster row whose QR modal is open

  // Badge email modal state
  const [badgeStudent, setBadgeStudent] = useState(null); // roster row whose badge modal is open
  const [badgePreview, setBadgePreview] = useState('');   // rendered badge data URL (also reused on send)
  const [badgeEmail, setBadgeEmail]     = useState('');   // editable recipient
  const [badgeBusy, setBadgeBusy]       = useState(false);// sending in progress
  const [badgeMsg, setBadgeMsg]         = useState('');   // success / error line

  // Desks tab state
  const [desks, setDesks]             = useState([]);
  const [institutions, setInstitutions] = useState([]);  // master list (datalist)
  const [deskName, setDeskName]       = useState('');
  const [deskLoading, setDeskLoading] = useState(false);
  const [deskBusy, setDeskBusy]       = useState(false);

  // Load exhibition/fair events on mount; default to the first (newest).
  useEffect(() => {
    (async () => {
      try {
        const res = await eventConsoleAPI.listEvents();
        const list = res.data || [];
        setEvents(list);
        if (list.length) setEventId(String(list[0].id));
      } catch (e) {
        setError(e.message || 'Failed to load events');
      }
    })();
  }, []);

  // Load the institution master list once (for the add-desk autocomplete).
  useEffect(() => {
    (async () => {
      try {
        const res = await eventConsoleAPI.listInstitutions();
        setInstitutions(res.data || []);
      } catch { /* non-fatal: typing a new name still works */ }
    })();
  }, []);

  const loadRoster = useCallback(async (id, query) => {
    if (!id) { setRoster([]); return; }
    setLoading(true); setError('');
    try {
      const res = await eventConsoleAPI.roster(id, query);
      setRoster(res.data || []);
    } catch (e) {
      setError(e.message || 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDesks = useCallback(async (id) => {
    if (!id) { setDesks([]); return; }
    setDeskLoading(true); setError('');
    try {
      const res = await eventConsoleAPI.listEventDesks(id);
      setDesks(res.data || []);
    } catch (e) {
      setError(e.message || 'Failed to load desks');
    } finally {
      setDeskLoading(false);
    }
  }, []);

  // Reload roster when the event changes (and clear any search).
  useEffect(() => { setQ(''); loadRoster(eventId, ''); }, [eventId, loadRoster]);

  // Load desks when the Desks tab is active for the selected event.
  useEffect(() => { if (tab === 'desks') loadDesks(eventId); }, [tab, eventId, loadDesks]);

  const handleCheckin = async (uniqueId) => {
    setBusyId(uniqueId); setError('');
    try {
      await eventConsoleAPI.checkin(eventId, uniqueId);
      await loadRoster(eventId, q);
    } catch (e) {
      setError(e.message || 'Check-in failed');
    } finally {
      setBusyId(null);
    }
  };

  // ── Badge email ──────────────────────────────────────────────────
  // Open the modal and render the styled badge (same renderer as Marketing
  // Events) encoding this student's attendance token. The preview doubles as
  // an on-screen badge a walk-in can be shown immediately.
  const openBadge = (r) => {
    setBadgeStudent(r);
    setBadgeEmail(r.email || '');
    setBadgeMsg('');
    setBadgePreview('');
    const ev = events.find((e) => String(e.id) === String(eventId));
    const dateStr = (ev && ev.startDate && ev.endDate)
      ? `${fmtDate(ev.startDate)} - ${fmtDate(ev.endDate)}`
      : (ev ? (fmtDate(ev.startDate) || fmtDate(ev.endDate) || '') : '');
    renderBadgePng({
      data: r.attendanceToken,
      title: r.fullName || r.uniqueId,
      metaLines: [ev && ev.name, dateStr].filter(Boolean),
    })
      .then((url) => setBadgePreview(url))
      .catch((e) => setBadgeMsg(e.message || 'Failed to render badge'));
  };

  const sendBadge = async () => {
    if (!badgeStudent || !badgePreview) return;
    const to = badgeEmail.trim();
    if (!to) { setBadgeMsg('Enter an email address.'); return; }
    setBadgeBusy(true); setBadgeMsg('');
    try {
      await eventConsoleAPI.emailBadge({
        uniqueId: badgeStudent.uniqueId,
        eventId,
        email: to,
        badgePng: dataUrlToBase64(badgePreview),
      });
      setBadgeMsg(`Sent to ${to}.`);
      await loadRoster(eventId, q);   // refresh so the emailed status updates
    } catch (e) {
      setBadgeMsg(e.message || 'Failed to send badge');
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleAddDesk = async () => {
    const name = deskName.trim();
    if (!name) return;
    setDeskBusy(true); setError('');
    try {
      await eventConsoleAPI.addEventDesk(eventId, { name });
      setDeskName('');
      await loadDesks(eventId);
      // refresh master list so the new institution appears in the datalist
      try { const r = await eventConsoleAPI.listInstitutions(); setInstitutions(r.data || []); } catch { /* ignore */ }
    } catch (e) {
      setError(e.message || 'Failed to add desk');
    } finally {
      setDeskBusy(false);
    }
  };

  const handleRegenPin = async (eiId) => {
    setError('');
    try {
      await eventConsoleAPI.regenDeskPin(eventId, eiId);
      await loadDesks(eventId);
    } catch (e) {
      setError(e.message || 'Failed to regenerate PIN');
    }
  };

  const handleRemoveDesk = async (eiId) => {
    if (!window.confirm('Remove this desk from the event?')) return;
    setError('');
    try {
      await eventConsoleAPI.removeEventDesk(eventId, eiId);
      await loadDesks(eventId);
    } catch (e) {
      setError(e.message || 'Failed to remove desk');
    }
  };

  const selected      = events.find(ev => String(ev.id) === String(eventId));
  const attendedCount = roster.filter(r => r.attendedAt).length;

  // ── inline styles (kept self-contained; restyle to match later) ──
  const card = { background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'16px 18px' };
  const th   = { textAlign:'left', fontSize:12, textTransform:'uppercase', letterSpacing:'0.04em', color:'#6b7280', padding:'10px 12px', borderBottom:'1px solid #e5e7eb' };
  const td   = { padding:'10px 12px', borderBottom:'1px solid #f1f5f9', fontSize:14, verticalAlign:'top' };
  const tabBtn = (active) => ({
    padding:'8px 16px', borderRadius:8, border:'1px solid', cursor:'pointer', fontSize:14, fontWeight:600,
    background: active ? '#2563eb' : '#fff', color: active ? '#fff' : '#374151',
    borderColor: active ? '#2563eb' : '#d1d5db',
  });

  return (
    <div style={{ padding:'8px 4px', maxWidth:1000 }}>
      <h1 style={{ fontSize:22, fontWeight:700, margin:'0 0 4px' }}>Event Management</h1>
      <p style={{ color:'#6b7280', margin:'0 0 18px', fontSize:14 }}>
        Run an exhibition: check pre-registered students in, and set up institution desks.
      </p>

      {/* Event picker (shared by both tabs) */}
      <div style={{ ...card, marginBottom:16, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <label style={{ fontWeight:600, fontSize:14 }}>Event:</label>
        <select
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          style={{ padding:'8px 10px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14, minWidth:300 }}
        >
          {events.length === 0 && <option value="">No exhibition / fair events found</option>}
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        {selected && (
          <span style={{ color:'#6b7280', fontSize:13 }}>
            {fmtDate(selected.startDate)}{selected.endDate ? ` – ${fmtDate(selected.endDate)}` : ''}
            {'  ·  '}<strong>{selected.registeredCount}</strong> registered
            {'  ·  '}<strong>{attendedCount}</strong> attended
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        <button style={tabBtn(tab === 'roster')} onClick={() => setTab('roster')}>Roster &amp; check-in</button>
        <button style={tabBtn(tab === 'desks')}  onClick={() => setTab('desks')}>Desks</button>
        <button style={tabBtn(tab === 'reps')}   onClick={() => setTab('reps')}>Reps</button>
        <button style={tabBtn(tab === 'qualification')} onClick={() => setTab('qualification')}>Qualification</button>
      </div>

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'10px 14px', borderRadius:8, marginBottom:12, fontSize:14 }}>
          {error}
        </div>
      )}

      {/* ── TAB: Roster & check-in ── */}
      {tab === 'roster' && (
        <>
          {/* Search */}
          <div style={{ display:'flex', gap:8, marginBottom:12 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadRoster(eventId, q); }}
              placeholder="Search name, email or phone…"
              style={{ flex:1, padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 }}
            />
            <button
              onClick={() => loadRoster(eventId, q)}
              style={{ padding:'9px 16px', borderRadius:8, border:'none', background:'#2563eb', color:'#fff', fontWeight:600, cursor:'pointer' }}
            >Search</button>
            <button
              onClick={() => loadRoster(eventId, q)}
              disabled={loading || !eventId}
              title="Re-pull the latest roster status (e.g. after QR codes are issued elsewhere)"
              style={{ padding:'9px 16px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontWeight:600, color:'#374151', opacity:(loading || !eventId) ? 0.6 : 1 }}
            >{loading ? 'Refreshing...' : 'Refresh'}</button>
            {q && (
              <button
                onClick={() => { setQ(''); loadRoster(eventId, ''); }}
                style={{ padding:'9px 16px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer' }}
              >Clear</button>
            )}
          </div>

          {/* Roster */}
          <div style={{ ...card, padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Contact</th>
                  <th style={th}>Status</th>
                  <th style={th}>Attended</th>
                  <th style={{ ...th, textAlign:'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td style={td} colSpan={5}>Loading…</td></tr>}
                {!loading && roster.length === 0 && (
                  <tr><td style={{ ...td, color:'#6b7280' }} colSpan={5}>
                    No registered students{q ? ' match your search' : ''}.
                  </td></tr>
                )}
                {!loading && roster.map((r) => (
                  <tr key={r.uniqueId}>
                    <td style={td}>
                      <div style={{ fontWeight:600 }}>{r.fullName || '—'}</div>
                      <div style={{ color:'#9ca3af', fontSize:12 }}>{r.uniqueId}</div>
                    </td>
                    <td style={td}>
                      <div>{r.email || '—'}</div>
                      <div style={{ color:'#6b7280', fontSize:13 }}>{r.phone || ''}</div>
                    </td>
                    <td style={td}>{r.status || '—'}</td>
                    <td style={td}>
                      {r.attendedAt
                        ? <span style={{ color:'#15803d', fontWeight:600 }}>✓ {fmtTime(r.attendedAt)}</span>
                        : r.attendanceToken
                          ? <span style={{ color:'#b45309', fontWeight:600 }}>QR issued</span>
                          : <span style={{ color:'#9ca3af' }}>—</span>}
                    </td>
                    <td style={{ ...td, textAlign:'right' }}>
                      <div style={{ display:'inline-flex', gap:8, alignItems:'center', justifyContent:'flex-end', flexWrap:'wrap' }}>
                        {r.attendedAt && (
                          <span style={{ color:'#6b7280', fontSize:13 }}>
                            Checked in{r.checkedInByName ? ` · ${r.checkedInByName}` : ''}
                          </span>
                        )}
                        {r.attendanceToken && (
                          <button
                            onClick={() => setQrStudent(r)}
                            style={{ padding:'7px 12px', borderRadius:8, border:'1px solid #2563eb', background:'#fff', color:'#2563eb', fontWeight:600, cursor:'pointer' }}
                          >Show QR</button>
                        )}
                        {r.attendanceToken && (
                          <button
                            onClick={() => openBadge(r)}
                            title={r.badgeEmailedAt ? `Emailed ${fmtTime(r.badgeEmailedAt)}${r.badgeEmailedTo ? ' to ' + r.badgeEmailedTo : ''}` : 'Email registration badge'}
                            style={{ padding:'7px 12px', borderRadius:8, border:'1px solid #c8102e', background:'#fff', color:'#c8102e', fontWeight:600, cursor:'pointer' }}
                          >{r.badgeEmailedAt ? 'Badge (sent)' : 'Badge'}</button>
                        )}
                        {!r.attendedAt && (
                          <button
                            onClick={() => handleCheckin(r.uniqueId)}
                            disabled={busyId === r.uniqueId}
                            style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'#16a34a', color:'#fff', fontWeight:600, cursor:'pointer', opacity: busyId === r.uniqueId ? 0.6 : 1 }}
                          >{busyId === r.uniqueId ? 'Checking in…' : 'Check in'}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── TAB: Desks ── */}
      {tab === 'desks' && (
        <>
          {/* Add desk */}
          <div style={{ ...card, marginBottom:12, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <label style={{ fontWeight:600, fontSize:14 }}>Add desk:</label>
            <input
              list="inst-list"
              value={deskName}
              onChange={(e) => setDeskName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddDesk(); }}
              placeholder="Institution name…"
              disabled={!eventId}
              style={{ flex:1, minWidth:240, padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 }}
            />
            <datalist id="inst-list">
              {institutions.map((i) => <option key={i.id} value={i.name} />)}
            </datalist>
            <button
              onClick={handleAddDesk}
              disabled={deskBusy || !eventId || !deskName.trim()}
              style={{ padding:'9px 16px', borderRadius:8, border:'none', background:'#2563eb', color:'#fff', fontWeight:600, cursor:'pointer', opacity: (deskBusy || !deskName.trim()) ? 0.6 : 1 }}
            >{deskBusy ? 'Adding…' : 'Add desk'}</button>
            <span style={{ color:'#6b7280', fontSize:13 }}>{desks.length}/50 desks</span>
          </div>

          {/* Desks list */}
          <div style={{ ...card, padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Institution</th>
                  <th style={th}>Desk PIN</th>
                  <th style={th}>Desk token</th>
                  <th style={th}>Visits</th>
                  <th style={{ ...th, textAlign:'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {deskLoading && <tr><td style={td} colSpan={5}>Loading…</td></tr>}
                {!deskLoading && desks.length === 0 && (
                  <tr><td style={{ ...td, color:'#6b7280' }} colSpan={5}>
                    No desks yet. Add an institution above.
                  </td></tr>
                )}
                {!deskLoading && desks.map((d) => (
                  <tr key={d.id}>
                    <td style={td}>
                      <div style={{ fontWeight:600 }}>{d.institutionName || '—'}</div>
                      {d.country && <div style={{ color:'#9ca3af', fontSize:12 }}>{d.country}</div>}
                    </td>
                    <td style={td}>
                      <span style={{ fontFamily:'monospace', fontSize:18, fontWeight:700, letterSpacing:'0.08em' }}>{d.deskPin}</span>
                    </td>
                    <td style={td}>
                      <code style={{ fontSize:12, color:'#6b7280', wordBreak:'break-all' }}>{d.deskToken}</code>
                    </td>
                    <td style={td}>{d.visitCount ?? 0}</td>
                    <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                      <button
                        onClick={() => handleRegenPin(d.id)}
                        style={{ padding:'7px 12px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:13, marginRight:8 }}
                      >New PIN</button>
                      <button
                        onClick={() => handleRemoveDesk(d.id)}
                        style={{ padding:'7px 12px', borderRadius:8, border:'1px solid #fecaca', background:'#fff', color:'#b91c1c', cursor:'pointer', fontSize:13 }}
                      >Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'reps' && (
        <RepsPanel eventId={eventId} selected={selected} />
      )}

      {tab === 'qualification' && (
        <QualificationPanel />
      )}

      {/* ── QR modal: render a student's attendance token for scanning ── */}
      {qrStudent && (
        <div
          onClick={() => setQrStudent(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:16, padding:28, textAlign:'center', maxWidth:360, width:'90%' }}
          >
            <div style={{ fontSize:20, fontWeight:800, marginBottom:4 }}>{qrStudent.fullName}</div>
            <div style={{ color:'#9ca3af', fontSize:13, marginBottom:18 }}>{qrStudent.uniqueId}</div>
            <div style={{ display:'inline-block', padding:16, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12 }}>
              <QRCodeSVG value={qrStudent.attendanceToken || ''} size={220} level="M" includeMargin />
            </div>
            <div style={{ color:'#6b7280', fontSize:13, margin:'16px 0 18px' }}>Scan at any institution desk to log a visit.</div>
            <button
              onClick={() => setQrStudent(null)}
              style={{ padding:'10px 20px', borderRadius:10, border:'none', background:'#2563eb', color:'#fff', fontWeight:700, cursor:'pointer' }}
            >Close</button>
          </div>
        </div>
      )}

      {/* ── Badge modal: render + email the styled registration badge ── */}
      {badgeStudent && (
        <div
          onClick={() => setBadgeStudent(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:16, padding:24, textAlign:'center', maxWidth:360, width:'90%', maxHeight:'90vh', overflowY:'auto' }}
          >
            <div style={{ fontSize:18, fontWeight:800, marginBottom:2 }}>{badgeStudent.fullName || badgeStudent.uniqueId}</div>
            <div style={{ color:'#9ca3af', fontSize:13, marginBottom:14 }}>Registration badge</div>

            <div style={{ minHeight:160, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
              {badgePreview
                ? <img src={badgePreview} alt="Registration badge" style={{ width:240, maxWidth:'100%' }} />
                : <span style={{ color:'#9ca3af', fontSize:14 }}>Generating...</span>}
            </div>

            {badgeStudent.badgeEmailedAt && (
              <div style={{ fontSize:12, color:'#6b7280', marginBottom:10 }}>
                Last emailed {fmtTime(badgeStudent.badgeEmailedAt)}{badgeStudent.badgeEmailedTo ? ` to ${badgeStudent.badgeEmailedTo}` : ''}
              </div>
            )}

            <label style={{ display:'block', textAlign:'left', fontSize:13, fontWeight:600, marginBottom:4 }}>Send to</label>
            <input
              type="email"
              value={badgeEmail}
              onChange={(e) => setBadgeEmail(e.target.value)}
              placeholder="email@example.com"
              style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14, marginBottom:12 }}
            />

            {badgeMsg && (
              <div style={{ fontSize:13, color: badgeMsg.startsWith('Sent') ? '#15803d' : '#b91c1c', marginBottom:12 }}>{badgeMsg}</div>
            )}

            <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
              <button
                onClick={() => setBadgeStudent(null)}
                style={{ padding:'9px 16px', borderRadius:10, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontWeight:600 }}
              >Close</button>
              <button
                onClick={sendBadge}
                disabled={badgeBusy || !badgePreview || !badgeEmail.trim()}
                style={{ padding:'9px 18px', borderRadius:10, border:'none', background:'#c8102e', color:'#fff', fontWeight:700, cursor:'pointer', opacity:(badgeBusy || !badgePreview || !badgeEmail.trim()) ? 0.6 : 1 }}
              >{badgeBusy ? 'Sending...' : (badgeStudent.badgeEmailedAt ? 'Re-send' : 'Send badge')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
