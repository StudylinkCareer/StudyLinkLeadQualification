// LeadManagement/src/components/LeadEventsSection.jsx
// ─────────────────────────────────────────────────────────────────────
// The "Events" card on the Client Detail page. Lists a student's linked
// events (lead_events) with status + per-event "how heard about this event",
// and an add-event picker from the catalog. Self-contained: own fetches
// against /api/lead-events. Auto-saves edits.
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';

const STATUS_OPTS = ['Confirmed', 'Uncertain', 'Declined'];
const HEARD_TYPES = ['Channel', 'Referral'];
const REF_KINDS   = ['Sub-agent', 'Partner', 'Ex-client'];

const sel = {
  padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)',
  fontSize: '0.8125rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit',
};

// "How heard about this event" — dependent controls. Patches flow up via onPatch.
function HeardControls({ v, onPatch, options }) {
  const [who, setWho] = useState(v.evReferralWho || '');
  useEffect(() => { setWho(v.evReferralWho || ''); }, [v.evReferralWho]);

  const whoList = v.evReferralKind === 'Sub-agent' ? options.subagents
                : v.evReferralKind === 'Partner'   ? options.partners
                : null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Heard about event via</span>
      <select style={sel} value={v.evHeardType || ''}
              onChange={e => onPatch({ evHeardType: e.target.value || null, evChannel: null, evReferralKind: null, evReferralWho: null })}>
        <option value="">—</option>
        {HEARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {v.evHeardType === 'Channel' && (
        <select style={sel} value={v.evChannel || ''} onChange={e => onPatch({ evChannel: e.target.value || null })}>
          <option value="">channel…</option>
          {options.channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {v.evHeardType === 'Referral' && (
        <>
          <select style={sel} value={v.evReferralKind || ''}
                  onChange={e => onPatch({ evReferralKind: e.target.value || null, evReferralWho: null })}>
            <option value="">kind…</option>
            {REF_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          {whoList && (
            <select style={sel} value={v.evReferralWho || ''} onChange={e => onPatch({ evReferralWho: e.target.value || null })}>
              <option value="">who…</option>
              {whoList.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}
            </select>
          )}
          {v.evReferralKind === 'Ex-client' && (
            <input style={{ ...sel, minWidth: 160 }} placeholder="ex-client name"
                   value={who} onChange={e => setWho(e.target.value)}
                   onBlur={() => { if ((v.evReferralWho || '') !== who) onPatch({ evReferralWho: who || null }); }} />
          )}
        </>
      )}
    </div>
  );
}

export default function LeadEventsSection({ studentId }) {
  const [links, setLinks]     = useState([]);
  const [options, setOptions] = useState({ events: [], channels: [], subagents: [], partners: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [addEventId, setAddEventId] = useState('');
  const [addStatus, setAddStatus]   = useState('');
  const [addHeard, setAddHeard]     = useState({ evHeardType: null, evChannel: null, evReferralKind: null, evReferralWho: null });
  const [adding, setAdding]         = useState(false);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const [lr, or] = await Promise.all([
        fetch(`/api/lead-events?studentId=${encodeURIComponent(studentId)}`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/lead-events/options`, { credentials: 'include' }).then(r => r.json()),
      ]);
      if (lr.success) setLinks(lr.data || []);
      if (or.success) setOptions(or.data || { events: [], channels: [], subagents: [], partners: [] });
      setError('');
    } catch {
      setError('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [studentId]);
  useEffect(() => { load(); }, [load]);

  async function patchLink(id, patch) {
    setLinks(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));   // optimistic
    try {
      await fetch(`/api/lead-events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
    } catch { load(); }
  }

  async function removeLink(id, name) {
    if (!window.confirm(`Remove "${name}" from this student's events?`)) return;
    try {
      await fetch(`/api/lead-events/${id}`, { method: 'DELETE', credentials: 'include' });
      load();
    } catch { setError('Failed to remove'); }
  }

  async function addLink() {
    if (!addEventId) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/lead-events`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, eventId: Number(addEventId), status: addStatus || null, ...addHeard }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add failed');
      setAddEventId(''); setAddStatus('');
      setAddHeard({ evHeardType: null, evChannel: null, evReferralKind: null, evReferralWho: null });
      load();
    } catch (e) {
      setError(e.message || 'Failed to add event');
    } finally {
      setAdding(false);
    }
  }

  const linkedIds = new Set(links.map(l => l.eventId));
  const available = options.events.filter(e => !linkedIds.has(e.id));

  return (
    <div className="section-card">
      <div className="section-header"><span className="section-title">Events</span></div>
      {error && <div style={{ color: '#dc2626', fontSize: '0.8125rem', marginBottom: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading…</div>
      ) : (
        <>
          {links.length === 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 12 }}>No events linked yet.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {links.map(l => (
              <div key={l.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{l.name}</div>
                  <span style={{ fontSize: '0.72rem', padding: '2px 7px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                    {l.group} · {l.type}
                  </span>
                  {(l.startDate || l.endDate) && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {l.startDate || '—'}{l.endDate ? ` → ${l.endDate}` : ''}
                    </span>
                  )}
                  <select style={{ ...sel, marginLeft: 'auto' }} value={l.status || ''}
                          onChange={e => patchLink(l.id, { status: e.target.value || null })}>
                    <option value="">status…</option>
                    {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => removeLink(l.id, l.name)} title="Remove"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                    <FiTrash2 size={15} />
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <HeardControls v={l} onPatch={p => patchLink(l.id, p)} options={options} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <select style={{ ...sel, minWidth: 240 }} value={addEventId} onChange={e => setAddEventId(e.target.value)}>
                <option value="">+ add an event…</option>
                {available.map(e => <option key={e.id} value={e.id}>{e.group} · {e.type} — {e.name}</option>)}
              </select>
              <select style={sel} value={addStatus} onChange={e => setAddStatus(e.target.value)}>
                <option value="">status…</option>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={addLink} disabled={!addEventId || adding}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.9rem', borderRadius: 6, border: 'none',
                               background: 'var(--primary)', color: '#fff', fontWeight: 600,
                               cursor: (!addEventId || adding) ? 'not-allowed' : 'pointer', fontSize: '0.8125rem' }}>
                <FiPlus size={13} /> Add
              </button>
            </div>
            {addEventId && (
              <div style={{ marginTop: 8 }}>
                <HeardControls v={addHeard} onPatch={p => setAddHeard(h => ({ ...h, ...p }))} options={options} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
