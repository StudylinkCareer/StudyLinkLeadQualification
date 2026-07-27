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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNavTrail } from '../contexts/NavTrailContext';
import { eventConsoleAPI } from '../services/api';
import RepsPanel from './RepsPanel';
import QualificationPanel from './QualificationPanel';
import EventReportsPanel from './EventReportsPanel';
import { useAuth } from '../contexts/AuthContext';
import { canViewEventReports } from '../utils/roleProfiles';
import { renderBadgePng, dataUrlToBase64 } from '../utils/badgeRenderer';
import { STONE_IMAGES } from '../utils/stones';
import { STONE_GLYPHS } from '../utils/stoneGlyphs';

const fmtDate = (d) => { try { return d ? new Date(d).toLocaleDateString() : ''; } catch { return ''; } };
const fmtTime = (d) => { try { return d ? new Date(d).toLocaleString()    : ''; } catch { return ''; } };

export default function EventConsole() {
  const navigate = useNavigate();
  const trailCtx = useNavTrail();
  const [events, setEvents]   = useState([]);
  const [eventId, setEventId] = useState('');
  const [tab, setTab]         = useState('roster');   // 'roster' | 'desks' | 'reps' | 'qualification' | 'reports'
  const { staff } = useAuth();
  const canReports = canViewEventReports(staff?.position);   // Executives / Managers / Data Quality
  const [error, setError]     = useState('');

  // Roster tab state
  const [roster, setRoster]   = useState([]);
  const [q, setQ]             = useState('');
  const [fStatus, setFStatus]     = useState('all'); // 'all' | Confirmed | Uncertain | Declined
  const [fAttended, setFAttended] = useState('all'); // 'all' | 'yes' | 'no'
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId]   = useState(null);   // studentId being checked in

  // Badge email modal state
  const [badgeStudent, setBadgeStudent] = useState(null); // roster row whose badge modal is open
  const [badgePreview, setBadgePreview] = useState('');   // rendered badge data URL (also reused on send)
  const [badgeEmail, setBadgeEmail]     = useState('');   // editable recipient
  const [badgeBusy, setBadgeBusy]       = useState(false);// sending in progress
  const [badgeMsg, setBadgeMsg]         = useState('');   // success / error line

  // ── Bulk badge send (roster mass-processing) ──────────────────
  // Tick registrants in the roster, then issue their QR badge invitation to
  // one/some/all at once. Zalo-first with an email backup by default. The
  // batch runs entirely client-side (the badge PNG is rendered in-browser),
  // reusing the same per-student endpoints as the single-send modal.
  const [selectedIds, setSelectedIds]   = useState(() => new Set()); // studentIds ticked
  const [bulkOpen, setBulkOpen]         = useState(false);           // bulk dialog visible
  const [bulkKind, setBulkKind]         = useState('badge');         // 'badge' | 'followup'
  const [bulkChannel, setBulkChannel]   = useState('zalo_first');    // 'zalo_first' | 'zalo_only' | 'email_only'
  const [bulkSkipSent, setBulkSkipSent] = useState(true);            // skip people already invited
  const [bulkRunning, setBulkRunning]   = useState(false);           // a batch is in progress
  const [bulkResults, setBulkResults]   = useState([]);              // [{ studentId, name, status, via, reason }]
  const [bulkTotal, setBulkTotal]       = useState(0);               // rows to process in this batch
  const bulkCancel = useRef(false);                                  // set true to stop mid-batch

  // Check-in form (gate) state
  const [ciStudent, setCiStudent] = useState(null);  // roster row being checked in via the form
  const [ciFields, setCiFields]   = useState([]);    // [{ fieldKey, label, type, options, value }]
  const [ciValues, setCiValues]   = useState({});    // { fieldKey: value }
  const [ciBusy, setCiBusy]       = useState(false);
  const [ciError, setCiError]     = useState('');

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

  // Reload roster when the event changes (and clear any search + selection).
  useEffect(() => { setQ(''); setSelectedIds(new Set()); loadRoster(eventId, ''); }, [eventId, loadRoster]);

  // Drop an "Event Check-in" crumb so a lead opened from the roster links back here.
  useEffect(() => { trailCtx?.push?.({ label: 'Event Check-in', path: '/events' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load desks when the Desks tab is active for the selected event.
  useEffect(() => { if (tab === 'desks') loadDesks(eventId); }, [tab, eventId, loadDesks]);

  const handleCheckin = async (studentId, row) => {
    setBusyId(studentId); setError('');
    try {
      // Ask the server what's required and whether this student already passes.
      const res = await eventConsoleAPI.checkinFields(eventId, studentId);
      const data = res.data || {};
      if (data.qualified) {
        await eventConsoleAPI.checkin(eventId, studentId);
        await loadRoster(eventId, '');
      } else {
        // Open the form to fill the required fields before check-in completes.
        const fields = data.fields || [];
        const init = {};
        fields.forEach((f) => { init[f.fieldKey] = f.value || ''; });
        setCiFields(fields);
        setCiValues(init);
        setCiError('');
        setCiStudent(row || { studentId });
      }
    } catch (e) {
      setError(e.message || 'Check-in failed');
    } finally {
      setBusyId(null);
    }
  };

  const submitCheckin = async () => {
    if (!ciStudent) return;
    setCiBusy(true); setCiError('');
    try {
      await eventConsoleAPI.checkin(eventId, ciStudent.studentId, ciValues);
      setCiStudent(null); setCiFields([]); setCiValues({});
      await loadRoster(eventId, '');
    } catch (e) {
      setCiError(e.message || 'Some required fields are still missing');
    } finally {
      setCiBusy(false);
    }
  };

  // ── Badge email ──────────────────────────────────────────────────
  // Open the modal and render the styled badge (same renderer as Marketing
  // Events) encoding this student's attendance token. The preview doubles as
  // an on-screen badge a walk-in can be shown immediately.
  const openBadge = async (r) => {
    setBadgeStudent(r);
    setBadgeEmail(r.email || '');
    setBadgeMsg('');
    setBadgePreview('');

    // Mint an advance token on demand if this registrant has none yet, so the
    // badge QR and the form link have a token to encode. Idempotent server-side.
    let row = r;
    if (!row.attendanceToken) {
      try {
        const res = await eventConsoleAPI.issueToken(eventId, r.studentId);
        const token = res && res.data && res.data.attendanceToken;
        if (token) {
          row = { ...row, attendanceToken: token };
          setBadgeStudent(row);
          setRoster((rows) => rows.map((x) => x.studentId === r.studentId ? { ...x, attendanceToken: token } : x));
        }
      } catch (e) {
        setBadgeMsg(e.message || 'Could not issue a badge token');
        return;
      }
    }

    const ev = events.find((e) => String(e.id) === String(eventId));
    const dateStr = (ev && ev.startDate && ev.endDate)
      ? `${fmtDate(ev.startDate)} - ${fmtDate(ev.endDate)}`
      : (ev ? (fmtDate(ev.startDate) || fmtDate(ev.endDate) || '') : '');
    renderBadgePng({
      data: row.attendanceToken,
      title: row.fullName || row.studentId,
      metaLines: [ev && ev.name, dateStr].filter(Boolean),
      // Evaluated students get their tier's flat gem glyph in the QR centre
      // (logo-style treatment); unscored students keep the StudyLink logo.
      ...(STONE_GLYPHS[row.stoneTier] ? { logoUrl: STONE_GLYPHS[row.stoneTier] } : {}),
    })
      .then((url) => setBadgePreview(url))
      .catch((e) => setBadgeMsg(e.message || 'Failed to render badge'));
  };

  // Build the "View your badge" link for the email. The page lives in the LQ
  // (Client) app; name/event/dates ride in the query so it needs no lookup.
  // Returns '' if VITE_LQ_BASE_URL is unset -> email omits the button.
  const buildBadgeUrl = (r) => {
    const base = (import.meta.env.VITE_LQ_BASE_URL || '').replace(/\/+$/, '');
    if (!base || !r.attendanceToken) return '';
    const ev = events.find((e) => String(e.id) === String(eventId));
    const dateStr = (ev && ev.startDate && ev.endDate)
      ? `${fmtDate(ev.startDate)} - ${fmtDate(ev.endDate)}`
      : (ev ? (fmtDate(ev.startDate) || fmtDate(ev.endDate) || '') : '');
    const p = new URLSearchParams();
    if (r.fullName) p.set('n', r.fullName);
    if (ev && ev.name) p.set('e', ev.name);
    if (dateStr) p.set('d', dateStr);
    return `${base}/badge/${encodeURIComponent(r.attendanceToken)}?${p.toString()}`;
  };

  const sendZalo = async () => {
    if (!badgeStudent) return;
    setBadgeBusy(true); setBadgeMsg('');
    try {
      await eventConsoleAPI.zaloBadge({
        studentId: badgeStudent.studentId,
        eventId,
        baseUrl: (import.meta.env.VITE_LQ_BASE_URL || '').replace(/\/+$/, ''),
      });
      setBadgeMsg('Sent via Zalo.');
      await loadRoster(eventId, '');
    } catch (e) {
      // The automated ZNS send failed (commonly: not a Zalo user). Show the
      // reason and STOP - do NOT open zalo.me/<number>, which for a non-Zalo
      // number just renders Zalo's useless "Truyen File" fallback page. The
      // roster already flags the failure; we copy the badge link so staff can
      // paste it manually if they still want to.
      const base  = (import.meta.env.VITE_LQ_BASE_URL || '').replace(/\/+$/, '');
      const token = badgeStudent.attendanceToken || '';
      const profileUrl = base && token ? base + '/profile?t=' + encodeURIComponent(token) : '';
      if (profileUrl) { try { await navigator.clipboard.writeText(profileUrl); } catch (_) {} }
      setBadgeMsg('Zalo failed: ' + (e.message || 'could not send') + (profileUrl ? ' - badge link copied' : ''));
    } finally {
      setBadgeBusy(false);
    }
  };

  // Send the badge via BOTH email and Zalo (email first, then Zalo).
  const sendBoth = async () => {
    await sendBadge();
    await sendZalo();
  };

  const sendBadge = async () => {
    if (!badgeStudent || !badgePreview) return;
    const to = badgeEmail.trim();
    if (!to) { setBadgeMsg('Enter an email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setBadgeMsg('That email address looks invalid - please check it.'); return; }
    setBadgeBusy(true); setBadgeMsg('');
    try {
      await eventConsoleAPI.emailBadge({
        studentId: badgeStudent.studentId,
        eventId,
        email: to,
        badgePng: dataUrlToBase64(badgePreview),
        badgeUrl: buildBadgeUrl(badgeStudent),
        baseUrl: (import.meta.env.VITE_LQ_BASE_URL || '').replace(/\/+$/, ''),
      });
      setBadgeMsg(`Sent to ${to}.`);
      await loadRoster(eventId, '');   // refresh so the emailed status updates
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
  // Summary counts come from the FULL roster (not the filtered view) so they stay
  // stable while the operator filters the list.
  const countStatus    = (s) => roster.filter(r => (r.status || '') === s).length;
  const confirmedCount = countStatus('Confirmed');
  const uncertainCount = countStatus('Uncertain');
  const declinedCount  = countStatus('Declined');

  // Client-side filtering: name/phone/email text + status + attended.
  const filteredRoster = roster.filter(r => {
    if (fStatus !== 'all' && (r.status || '') !== fStatus) return false;
    if (fAttended === 'yes' && !r.attendedAt) return false;
    if (fAttended === 'no'  &&  r.attendedAt) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const hay = `${r.fullName || ''} ${r.phone || ''} ${r.email || ''} ${r.studentId || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const anyFilter = !!q.trim() || fStatus !== 'all' || fAttended !== 'all';

  // ── Selection (bulk badge) derived state ──────────────────────
  // Selection is scoped to the CURRENTLY VISIBLE (filtered) rows: the header
  // checkbox and the count both track what's on screen, and a batch only ever
  // sends to selected rows that are still visible — so changing a filter can
  // never silently send to someone the operator can't see.
  const filteredIds          = filteredRoster.map((r) => r.studentId);
  const selectedVisible      = filteredIds.filter((id) => selectedIds.has(id));
  const selectedCount        = selectedVisible.length;
  const allFilteredSelected  = filteredIds.length > 0 && selectedCount === filteredIds.length;
  const someFilteredSelected = selectedCount > 0 && !allFilteredSelected;

  const toggleOne = (studentId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else                     filteredIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // ── Bulk badge helpers ────────────────────────────────────────
  const sleep        = (ms) => new Promise((res) => setTimeout(res, ms));
  const isValidEmail = (e)  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
  const lqBase       = ()   => (import.meta.env.VITE_LQ_BASE_URL || '').replace(/\/+$/, '');

  // Has this registrant already been sent this kind of message on the relevant
  // channel(s)? 'badge' checks the badge_* columns; 'followup' the followup_*.
  const alreadyInvited = (r, channel, kind = 'badge') => {
    const zaloSent = kind === 'followup'
      ? !!(r.followupZaloSentAt || r.followupZaloStatus === 'accepted')
      : !!(r.badgeZaloSentAt || r.badgeZaloStatus === 'accepted' || r.badgeZaloStatus === 'delivered');
    const emailSent = kind === 'followup' ? !!r.followupEmailedAt : !!r.badgeEmailedAt;
    if (channel === 'zalo_only')  return zaloSent;
    if (channel === 'email_only') return emailSent;
    return zaloSent || emailSent;   // zalo_first: any successful send counts
  };

  // Render this row's badge PNG (identical styling to the single-send modal).
  const renderRowBadge = async (row) => {
    const ev = events.find((e) => String(e.id) === String(eventId));
    const dateStr = (ev && ev.startDate && ev.endDate)
      ? `${fmtDate(ev.startDate)} - ${fmtDate(ev.endDate)}`
      : (ev ? (fmtDate(ev.startDate) || fmtDate(ev.endDate) || '') : '');
    return renderBadgePng({
      data: row.attendanceToken,
      title: row.fullName || row.studentId,
      metaLines: [ev && ev.name, dateStr].filter(Boolean),
      ...(STONE_GLYPHS[row.stoneTier] ? { logoUrl: STONE_GLYPHS[row.stoneTier] } : {}),
    });
  };

  // Mint a token on demand if missing; returns the row with attendanceToken set.
  const ensureToken = async (row) => {
    if (row.attendanceToken) return row;
    const res   = await eventConsoleAPI.issueToken(eventId, row.studentId);
    const token = res && res.data && res.data.attendanceToken;
    if (!token) throw new Error('could not issue a badge token');
    setRoster((rows) => rows.map((x) => x.studentId === row.studentId ? { ...x, attendanceToken: token } : x));
    return { ...row, attendanceToken: token };
  };

  // Email the badge to one row. Throws on failure (incl. missing/invalid email).
  const emailRowBadge = async (row) => {
    const to = String(row.email || '').trim();
    if (!isValidEmail(to)) throw new Error('no valid email');
    const png = await renderRowBadge(row);
    await eventConsoleAPI.emailBadge({
      studentId: row.studentId,
      eventId,
      email: to,
      badgePng: dataUrlToBase64(png),
      badgeUrl: buildBadgeUrl(row),
      baseUrl: lqBase(),
    });
  };

  // Zalo the badge to one row. Throws on failure (e.g. "not a Zalo user").
  const zaloRowBadge = (row) =>
    eventConsoleAPI.zaloBadge({ studentId: row.studentId, eventId, baseUrl: lqBase() });

  // ── Follow-up (survey) senders — no token / no badge image needed ─────
  const zaloRowFollowup = (row) =>
    eventConsoleAPI.zaloFollowup({ studentId: row.studentId, eventId });

  const emailRowFollowup = async (row) => {
    const to = String(row.email || '').trim();
    if (!isValidEmail(to)) throw new Error('no valid email');
    await eventConsoleAPI.emailFollowup({ studentId: row.studentId, eventId, email: to });
  };

  // Process a single row per the chosen channel and kind ('badge' | 'followup').
  // NEVER throws — always returns a result record so one bad row can't halt the
  // batch. Zalo-first falls back to email; email failures surface a reason.
  const processRow = async (row, channel, kind = 'badge') => {
    const base = { studentId: row.studentId, name: row.fullName || row.studentId };
    const sendZalo  = kind === 'followup' ? zaloRowFollowup  : zaloRowBadge;
    const sendEmail = kind === 'followup' ? emailRowFollowup : emailRowBadge;
    try {
      // Badges encode an attendance token (mint if missing); follow-ups don't.
      const r = kind === 'badge' ? await ensureToken(row) : row;

      if (channel === 'email_only') {
        await sendEmail(r);
        return { ...base, status: 'sent', via: 'email' };
      }

      // zalo_only / zalo_first → try Zalo first
      try {
        await sendZalo(r);
        return { ...base, status: 'sent', via: 'zalo' };
      } catch (zErr) {
        const zMsg = zErr.message || 'Zalo send failed';
        if (channel === 'zalo_only') {
          return { ...base, status: 'failed', via: 'zalo', reason: zMsg };
        }
        // zalo_first → email backup
        try {
          await sendEmail(r);
          return { ...base, status: 'sent', via: 'email', reason: `Zalo failed (${zMsg}) — emailed instead` };
        } catch (eErr) {
          const why = eErr.message === 'no valid email'
            ? `Zalo failed (${zMsg}); no valid email on file`
            : `Zalo failed (${zMsg}); email also failed (${eErr.message || 'error'})`;
          return { ...base, status: 'failed', via: 'both', reason: why };
        }
      }
    } catch (err) {
      return { ...base, status: 'failed', via: '-', reason: err.message || 'Failed' };
    }
  };

  // Run the batch over the current selection (∩ the visible/filtered rows).
  const runBulk = async () => {
    let targets = filteredRoster.filter((r) => selectedIds.has(r.studentId));
    const pre = [];
    if (bulkSkipSent) {
      const keep = [];
      targets.forEach((r) => {
        if (alreadyInvited(r, bulkChannel, bulkKind)) {
          pre.push({ studentId: r.studentId, name: r.fullName || r.studentId, status: 'skipped', reason: 'already sent' });
        } else {
          keep.push(r);
        }
      });
      targets = keep;
    }

    setBulkRunning(true);
    setBulkTotal(targets.length);
    setBulkResults([...pre]);
    bulkCancel.current = false;

    for (let i = 0; i < targets.length; i++) {
      if (bulkCancel.current) {
        setBulkResults((prev) => [...prev, { studentId: '-', name: `Stopped — ${targets.length - i} not processed`, status: 'skipped', reason: 'cancelled' }]);
        break;
      }
      const rec = await processRow(targets[i], bulkChannel, bulkKind);
      setBulkResults((prev) => [...prev, rec]);
      // Gentle jittered gap (~0.9–1.6s) so we don't hammer the send relays.
      if (i < targets.length - 1) await sleep(900 + Math.floor(Math.random() * 700));
    }

    setBulkRunning(false);
    await loadRoster(eventId, '');   // refresh delivery-status pills
  };

  const openBulk  = (kind = 'badge') => { setBulkKind(kind); setBulkResults([]); setBulkTotal(0); bulkCancel.current = false; setBulkOpen(true); };
  const closeBulk = () => { if (!bulkRunning) setBulkOpen(false); };

  // Live tallies for the progress panel.
  const bulkAttempted = bulkResults.filter((r) => r.via).length;              // rows actually sent to
  const bulkSent      = bulkResults.filter((r) => r.status === 'sent').length;
  const bulkFailed    = bulkResults.filter((r) => r.status === 'failed').length;
  const bulkSkipped   = bulkResults.filter((r) => r.status === 'skipped').length;
  const bulkPct       = bulkTotal ? Math.round((bulkAttempted / bulkTotal) * 100) : (bulkResults.length ? 100 : 0);

  // Labels that switch between the badge and follow-up (survey) flows.
  const bulkIsFollowup = bulkKind === 'followup';
  const bulkNoun       = bulkIsFollowup ? 'survey follow-up' : 'badge';

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
    <div style={{ padding:'8px 4px', maxWidth:1440 }}>
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
            {'  ·  '}<strong>{confirmedCount}</strong> confirmed
            {'  ·  '}<strong>{uncertainCount}</strong> uncertain
            {'  ·  '}<strong>{declinedCount}</strong> declined
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
        {canReports && (
          <button style={tabBtn(tab === 'reports')} onClick={() => setTab('reports')}>Reports</button>
        )}
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
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name, phone or email…"
              style={{ flex:1, minWidth:220, padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 }}
            />
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              title="Filter by registration status"
              style={{ padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 }}
            >
              <option value="all">All statuses</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Uncertain">Uncertain</option>
              <option value="Declined">Declined</option>
            </select>
            <select
              value={fAttended}
              onChange={(e) => setFAttended(e.target.value)}
              title="Filter by attendance"
              style={{ padding:'9px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 }}
            >
              <option value="all">All</option>
              <option value="yes">Attended</option>
              <option value="no">Not attended</option>
            </select>
            <button
              onClick={() => loadRoster(eventId, '')}
              disabled={loading || !eventId}
              title="Re-pull the latest roster from the server"
              style={{ padding:'9px 16px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontWeight:600, color:'#374151', opacity:(loading || !eventId) ? 0.6 : 1 }}
            >{loading ? 'Refreshing...' : 'Refresh'}</button>
            {anyFilter && (
              <button
                onClick={() => { setQ(''); setFStatus('all'); setFAttended('all'); }}
                style={{ padding:'9px 16px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer' }}
              >Clear filters</button>
            )}
          </div>

          {/* Bulk action bar — appears once at least one visible row is ticked */}
          {selectedCount > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, padding:'10px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, flexWrap:'wrap' }}>
              <strong style={{ fontSize:14, color:'#1e3a8a' }}>{selectedCount} selected</strong>
              <button
                onClick={() => openBulk('badge')}
                style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#2563eb', color:'#fff', fontWeight:600, cursor:'pointer' }}
              >Send badges…</button>
              <button
                onClick={() => openBulk('followup')}
                title="Send the survey follow-up (Zalo template + email backup)"
                style={{ padding:'8px 16px', borderRadius:8, border:'none', background:'#7c3aed', color:'#fff', fontWeight:600, cursor:'pointer' }}
              >Send follow-up…</button>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{ padding:'8px 14px', borderRadius:8, border:'1px solid #bfdbfe', background:'#fff', color:'#1e40af', cursor:'pointer', fontWeight:600 }}
              >Clear selection</button>
            </div>
          )}

          {/* Roster */}
          <div style={{ ...card, padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width:36, paddingRight:0 }}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      ref={(el) => { if (el) el.indeterminate = someFilteredSelected; }}
                      onChange={toggleSelectAll}
                      disabled={filteredIds.length === 0}
                      title="Select all (filtered)"
                      style={{ cursor:'pointer', width:16, height:16 }}
                    />
                  </th>
                  <th style={{ ...th, minWidth:200 }}>Name</th>
                  <th style={th}>Contact</th>
                  <th style={th}>Status</th>
                  <th style={th}>Attended</th>
                  <th style={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td style={td} colSpan={6}>Loading…</td></tr>}
                {!loading && filteredRoster.length === 0 && (
                  <tr><td style={{ ...td, color:'#6b7280' }} colSpan={6}>
                    {roster.length === 0 ? 'No registered students.' : 'No students match your filters.'}
                  </td></tr>
                )}
                {!loading && filteredRoster.map((r) => (
                  <tr key={r.studentId} style={selectedIds.has(r.studentId) ? { background:'#f5f9ff' } : undefined}>
                    <td style={{ ...td, width:36, paddingRight:0 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.studentId)}
                        onChange={() => toggleOne(r.studentId)}
                        style={{ cursor:'pointer', width:16, height:16 }}
                      />
                    </td>
                    <td style={{ ...td, minWidth:200 }}>
                      <div
                        onClick={() => navigate(`/leads/${r.studentId}`)}
                        style={{ fontWeight:600, color:'#2563eb', cursor:'pointer' }}
                        title="Open lead record"
                      >{r.fullName || '—'}</div>
                      <div style={{ color:'#9ca3af', fontSize:12 }}>{r.studentId}</div>
                    </td>
                    <td style={td}>
                      <div style={{ wordBreak:'break-word' }}>{r.email || '—'}</div>
                      <div style={{ color:'#6b7280', fontSize:13 }}>{r.phone || ''}</div>
                    </td>
                    <td style={td}>{r.status || '—'}</td>
                    <td style={td}>
                      {r.attendedAt
                        ? <span style={{ color:'#15803d', fontWeight:600 }}>✓ {fmtTime(r.attendedAt)}</span>
                        : <span style={{ color:'#9ca3af' }}>—</span>}
                    </td>
                    <td style={td}>
                      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'nowrap' }}>
                        <button
                          onClick={() => openBadge(r)}
                          title="Send badge (e-mail / Zalo) + profile form"
                          style={{ padding:'7px 14px', borderRadius:8, border:'1px solid #c8102e', background:'#fff', color:'#c8102e', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}
                        >Send badge</button>
                        <button
                          onClick={() => { setSelectedIds(new Set([r.studentId])); openBulk('followup'); }}
                          title="Send the survey follow-up to just this person (Zalo + email backup)"
                          style={{ padding:'7px 14px', borderRadius:8, border:'1px solid #7c3aed', background:'#fff', color:'#7c3aed', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}
                        >Follow-up</button>
                        {!r.attendedAt ? (
                          <button
                            onClick={() => handleCheckin(r.studentId, r)}
                            disabled={busyId === r.studentId}
                            style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'#16a34a', color:'#fff', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', opacity: busyId === r.studentId ? 0.6 : 1 }}
                          >{busyId === r.studentId ? 'Checking in…' : 'Check in'}</button>
                        ) : (
                          <span style={{ color:'#6b7280', fontSize:13, whiteSpace:'nowrap' }}>
                            ✓ Checked in{r.checkedInByName ? ` · ${r.checkedInByName}` : ''}
                          </span>
                        )}
                        {STONE_IMAGES[r.stoneTier] && (
                          <img
                            src={STONE_IMAGES[r.stoneTier]}
                            alt={r.stoneTier}
                            title={r.stoneTier}
                            style={{ width:30, height:30, objectFit:'contain', flexShrink:0 }}
                          />
                        )}
                        {r.badgeEmailedAt ? (
                          <span title={`Emailed ${fmtTime(r.badgeEmailedAt)}${r.badgeEmailedTo ? ' to ' + r.badgeEmailedTo : ''}`}
                                style={{ fontSize:12, color:'#15803d', fontWeight:600, whiteSpace:'nowrap' }}>E-mail ✓ sent</span>
                        ) : (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email).trim())) ? (
                          <span title="This email address looks invalid - fix it on the record"
                                style={{ fontSize:12, color:'#c8102e', fontWeight:600, cursor:'help', whiteSpace:'nowrap' }}>E-mail ✗ invalid</span>
                        ) : null}
                        {r.badgeZaloStatus === 'failed' ? (
                          <span title={r.badgeZaloError || 'Zalo send failed'}
                                style={{ fontSize:12, color:'#c8102e', fontWeight:600, cursor:'help', whiteSpace:'nowrap' }}>Zalo ✗ failed</span>
                        ) : (r.badgeZaloSentAt || r.badgeZaloStatus === 'accepted' || r.badgeZaloStatus === 'delivered') ? (
                          <>
                            <span title={`Sent to Zalo ${fmtTime(r.badgeZaloSentAt)}`}
                                  style={{ fontSize:12, color:'#2563eb', fontWeight:600, whiteSpace:'nowrap' }}>Zalo ✓ sent</span>
                            {r.badgeZaloStatus === 'delivered' && (
                              <span title={`Received on the recipient's phone ${fmtTime(r.badgeZaloDeliveredAt || r.badgeZaloSentAt)}`}
                                    style={{ fontSize:13, color:'#15803d', fontWeight:700, whiteSpace:'nowrap' }}>🟢 Zalo received</span>
                            )}
                          </>
                        ) : null}
                        {(r.followupZaloSentAt || r.followupZaloStatus === 'accepted' || r.followupEmailedAt) ? (
                          <span title={`Follow-up sent${r.followupZaloSentAt ? ' · Zalo ' + fmtTime(r.followupZaloSentAt) : ''}${r.followupEmailedAt ? ' · emailed ' + fmtTime(r.followupEmailedAt) : ''}`}
                                style={{ fontSize:12, color:'#7c3aed', fontWeight:600, whiteSpace:'nowrap' }}>Survey ✓ sent</span>
                        ) : r.followupZaloStatus === 'failed' ? (
                          <span title={r.followupZaloError || 'Follow-up Zalo send failed'}
                                style={{ fontSize:12, color:'#c8102e', fontWeight:600, cursor:'help', whiteSpace:'nowrap' }}>Survey ✗ failed</span>
                        ) : null}
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

      {tab === 'reports' && canReports && (
        <EventReportsPanel eventId={eventId} />
      )}

      {tab === 'qualification' && (
        <QualificationPanel />
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
            <div style={{ fontSize:18, fontWeight:800, marginBottom:2 }}>{badgeStudent.fullName || badgeStudent.studentId}</div>
            <div style={{ color:'#9ca3af', fontSize:13, marginBottom:14 }}>Registration badge</div>

            <div style={{ minHeight:160, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
              {badgePreview
                ? <img src={badgePreview} alt="Registration badge" style={{ width:240, maxWidth:'100%' }} />
                : <span style={{ color:'#9ca3af', fontSize:14 }}>Generating...</span>}
            </div>

            {(badgeStudent.badgeEmailedAt || badgeStudent.badgeZaloSentAt) && (
              <div style={{ fontSize:13, marginBottom:14, lineHeight:1.7, textAlign:'left', color:'#374151' }}>
                {badgeStudent.badgeEmailedAt && (
                  <div>
                    <span style={{ fontWeight:600, display:'inline-block', minWidth:104 }}>Last e-mailed:</span>
                    {fmtTime(badgeStudent.badgeEmailedAt)}
                  </div>
                )}
                {badgeStudent.badgeZaloSentAt && (
                  <div>
                    <span style={{ fontWeight:600, display:'inline-block', minWidth:104 }}>Last Zalo:</span>
                    {fmtTime(badgeStudent.badgeZaloSentAt)}
                  </div>
                )}
              </div>
            )}

            <div style={{ textAlign:'left', marginBottom:14 }}>
              <div style={{ marginBottom:10 }}>
                <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:4 }}>E-mail <span style={{ fontWeight:400, color:'#9ca3af' }}>(for e-mail / both)</span></label>
                <input
                  type="email"
                  value={badgeEmail}
                  onChange={(e) => setBadgeEmail(e.target.value)}
                  placeholder="email@example.com"
                  style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:14 }}
                />
              </div>
              <div>
                <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:4 }}>Phone number <span style={{ fontWeight:400, color:'#9ca3af' }}>(for Zalo / both)</span></label>
                <div style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px', borderRadius:8, border:'1px solid #e5e7eb', background:'#f9fafb', fontSize:14, color:'#111827' }}>{badgeStudent.phone || '—'}</div>
              </div>
            </div>

            {badgeMsg && (
              <div style={{ fontSize:13, color: (badgeMsg.startsWith('Sent') || badgeMsg.startsWith('Opened')) ? '#15803d' : '#b91c1c', marginBottom:12 }}>{badgeMsg}</div>
            )}

            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <button
                onClick={sendBadge}
                disabled={badgeBusy || !badgePreview || !badgeEmail.trim()}
                style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:'#c8102e', color:'#fff', fontWeight:700, fontSize:15, cursor:'pointer', opacity:(badgeBusy || !badgePreview || !badgeEmail.trim()) ? 0.6 : 1 }}
              >{badgeBusy ? 'Sending...' : 'Send via e-mail'}</button>
              <button
                onClick={sendZalo}
                disabled={badgeBusy}
                style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:'#0068FF', color:'#fff', fontWeight:700, fontSize:15, cursor:'pointer', opacity: badgeBusy ? 0.6 : 1 }}
              >{badgeBusy ? 'Sending...' : 'Send via Zalo'}</button>
              <button
                onClick={sendBoth}
                disabled={badgeBusy || !badgePreview || !badgeEmail.trim()}
                style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:'#7c3aed', color:'#fff', fontWeight:700, fontSize:15, cursor:'pointer', opacity:(badgeBusy || !badgePreview || !badgeEmail.trim()) ? 0.6 : 1 }}
              >{badgeBusy ? 'Sending...' : 'Send via both'}</button>
              <button
                onClick={() => setBadgeStudent(null)}
                style={{ width:'100%', padding:'11px', borderRadius:10, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontWeight:600, fontSize:14 }}
              >Close</button>
            </div>
          </div>
        </div>
      )}
      {ciStudent && (
        <div
          onClick={() => !ciBusy && setCiStudent(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:16, padding:24, maxWidth:480, width:'92%', maxHeight:'90vh', overflowY:'auto' }}
          >
            <div style={{ fontSize:18, fontWeight:800, marginBottom:2 }}>{ciStudent.fullName || ciStudent.studentId}</div>
            <div style={{ color:'#9ca3af', fontSize:13, marginBottom:14 }}>Complete required fields to check in</div>

            {ciFields.map((f) => {
              const empty = !ciValues[f.fieldKey];
              const bd = empty ? '#fca5a5' : '#d1d5db';
              return (
                <div key={f.fieldKey} style={{ marginBottom:12 }}>
                  <label style={{ display:'block', fontSize:13, fontWeight:600, marginBottom:4 }}>
                    {f.label}{empty && <span style={{ color:'#dc2626' }}> *</span>}
                  </label>
                  {f.type === 'select' ? (
                    <select
                      value={ciValues[f.fieldKey] || ''}
                      onChange={(e) => setCiValues((v) => ({ ...v, [f.fieldKey]: e.target.value }))}
                      style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', borderRadius:8, border:`1px solid ${bd}`, fontSize:14, background:'#fff' }}
                    >
                      <option value="">Select...</option>
                      {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      value={ciValues[f.fieldKey] || ''}
                      onChange={(e) => setCiValues((v) => ({ ...v, [f.fieldKey]: e.target.value }))}
                      style={{ width:'100%', boxSizing:'border-box', padding:'9px 12px', borderRadius:8, border:`1px solid ${bd}`, fontSize:14 }}
                    />
                  )}
                </div>
              );
            })}

            {ciError && (
              <div style={{ fontSize:13, color:'#b91c1c', margin:'4px 0 12px' }}>{ciError}</div>
            )}

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
              <button
                onClick={() => setCiStudent(null)}
                disabled={ciBusy}
                style={{ padding:'9px 16px', borderRadius:10, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontWeight:600 }}
              >Cancel</button>
              <button
                onClick={submitCheckin}
                disabled={ciBusy || ciFields.some((f) => !ciValues[f.fieldKey])}
                style={{ padding:'9px 18px', borderRadius:10, border:'none', background:'#16a34a', color:'#fff', fontWeight:700, cursor:'pointer', opacity:(ciBusy || ciFields.some((f) => !ciValues[f.fieldKey])) ? 0.6 : 1 }}
              >{ciBusy ? 'Saving...' : 'Save & check in'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk badge send dialog ── */}
      {bulkOpen && (
        <div
          onClick={closeBulk}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:16, padding:24, maxWidth:460, width:'92%', maxHeight:'90vh', overflowY:'auto' }}
          >
            <div style={{ fontSize:18, fontWeight:800, marginBottom:2 }}>
              {bulkIsFollowup ? 'Send survey follow-up' : 'Send badge invitations'}
            </div>
            <div style={{ color:'#9ca3af', fontSize:13, marginBottom:16 }}>
              {selectedCount} registrant{selectedCount === 1 ? '' : 's'} selected
              {bulkIsFollowup ? ' · tip: filter to “Not attended” to target no-shows' : ''}
            </div>

            {/* Setup step — before a batch has started */}
            {!bulkRunning && bulkResults.length === 0 && (
              <>
                <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:8 }}>Channel</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
                  {[
                    { v:'zalo_first', label:'Zalo first, email backup', hint:`Try Zalo; if it fails or they don’t use Zalo, email the ${bulkNoun} instead.` },
                    { v:'zalo_only',  label:'Zalo only',               hint:'Only send via Zalo. No email fallback.' },
                    { v:'email_only', label:'Email only',              hint:`Only email the ${bulkNoun} (needs a valid email on file).` },
                  ].map((opt) => (
                    <label key={opt.v} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'10px 12px', border:`1px solid ${bulkChannel === opt.v ? '#2563eb' : '#e5e7eb'}`, borderRadius:10, cursor:'pointer', background: bulkChannel === opt.v ? '#eff6ff' : '#fff' }}>
                      <input type="radio" name="bulkChannel" value={opt.v} checked={bulkChannel === opt.v} onChange={() => setBulkChannel(opt.v)} style={{ marginTop:3 }} />
                      <span>
                        <span style={{ fontSize:14, fontWeight:600, color:'#111827' }}>{opt.label}</span>
                        <span style={{ display:'block', fontSize:12, color:'#6b7280', marginTop:2 }}>{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <label style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16, cursor:'pointer' }}>
                  <input type="checkbox" checked={bulkSkipSent} onChange={(e) => setBulkSkipSent(e.target.checked)} />
                  <span style={{ fontSize:14, color:'#374151' }}>Skip people already sent this {bulkIsFollowup ? 'follow-up' : 'badge'}</span>
                </label>

                <div style={{ fontSize:12, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 10px', marginBottom:16, lineHeight:1.5 }}>
                  {bulkIsFollowup
                    ? 'Keep this tab open until the batch finishes — each person is sent one at a time. A large batch takes roughly one to two seconds per person.'
                    : 'Keep this tab open until the batch finishes — badges are generated here in your browser. A large batch takes roughly one to two seconds per person.'}
                </div>

                <div style={{ display:'flex', gap:10 }}>
                  <button
                    onClick={runBulk}
                    style={{ flex:1, padding:'12px', borderRadius:10, border:'none', background:'#2563eb', color:'#fff', fontWeight:700, fontSize:15, cursor:'pointer' }}
                  >Send to {selectedCount}</button>
                  <button
                    onClick={() => setBulkOpen(false)}
                    style={{ padding:'12px 18px', borderRadius:10, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontWeight:600 }}
                  >Cancel</button>
                </div>
              </>
            )}

            {/* Progress + results */}
            {(bulkRunning || bulkResults.length > 0) && (
              <>
                <div style={{ height:10, background:'#e5e7eb', borderRadius:6, overflow:'hidden', marginBottom:10 }}>
                  <div style={{ height:'100%', width:`${bulkPct}%`, background:'#2563eb', transition:'width 0.25s' }} />
                </div>
                <div style={{ fontSize:13, color:'#374151', marginBottom:12 }}>
                  {bulkRunning ? `Sending… ${bulkAttempted}/${bulkTotal}` : `Done · ${bulkAttempted}/${bulkTotal} processed`}
                  {'  ·  '}<span style={{ color:'#15803d', fontWeight:600 }}>{bulkSent} sent</span>
                  {bulkFailed > 0 && <>{'  ·  '}<span style={{ color:'#b91c1c', fontWeight:600 }}>{bulkFailed} failed</span></>}
                  {bulkSkipped > 0 && <>{'  ·  '}<span style={{ color:'#6b7280', fontWeight:600 }}>{bulkSkipped} skipped</span></>}
                </div>

                <div style={{ maxHeight:280, overflowY:'auto', border:'1px solid #f1f5f9', borderRadius:8, marginBottom:16 }}>
                  {bulkResults.map((res, i) => {
                    const colour = res.status === 'sent' ? '#15803d' : res.status === 'failed' ? '#b91c1c' : '#6b7280';
                    const mark   = res.status === 'sent' ? '✓' : res.status === 'failed' ? '✗' : '–';
                    return (
                      <div key={`${res.studentId}-${i}`} style={{ display:'flex', gap:8, padding:'7px 12px', borderBottom:'1px solid #f8fafc', fontSize:13, alignItems:'baseline' }}>
                        <span style={{ color:colour, fontWeight:700, width:14, flexShrink:0 }}>{mark}</span>
                        <span style={{ flex:1, minWidth:0 }}>
                          <span style={{ fontWeight:600, color:'#111827' }}>{res.name}</span>
                          {res.via && res.via !== '-' && res.status === 'sent' && (
                            <span style={{ color:'#6b7280' }}> · {res.via}</span>
                          )}
                          {res.reason && (
                            <span style={{ display:'block', color:'#9ca3af', fontSize:12 }}>{res.reason}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {bulkRunning ? (
                  <button
                    onClick={() => { bulkCancel.current = true; }}
                    style={{ width:'100%', padding:'12px', borderRadius:10, border:'1px solid #fecaca', background:'#fff', color:'#b91c1c', fontWeight:700, fontSize:15, cursor:'pointer' }}
                  >Stop</button>
                ) : (
                  <button
                    onClick={() => setBulkOpen(false)}
                    style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:'#2563eb', color:'#fff', fontWeight:700, fontSize:15, cursor:'pointer' }}
                  >Close</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
