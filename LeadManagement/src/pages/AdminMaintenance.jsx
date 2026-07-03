// AdminMaintenance — admin tools. Reminder cleanup: review open reminders on
// Leads in a closed/non-contactable status, select, and close them.
// Admin or Tech Support only.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const STATUSES = ['Contracted', 'Lost', 'Archived', 'Not contactable'];

export default function AdminMaintenance() {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const allowed = staff?.role === 'Admin' || staff?.position === 'Tech Support';

  const [statusFilter, setStatusFilter] = useState('');   // '' = all
  const [search, setSearch] = useState('');               // name / Sales ID filter
  const [rows, setRows]   = useState([]);
  const [sel,  setSel]    = useState(() => new Set());
  const [busy, setBusy]   = useState(false);
  const [msg,  setMsg]    = useState('');

  const shown = search.trim()
    ? rows.filter(r => `${r.studentName || ''} ${r.studentId || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    : rows;

  async function load() {
    setBusy(true); setMsg('');
    try {
      const r = await staffAPI.listStaleReminders(statusFilter || undefined);
      setRows(r.data || []);
      setSel(new Set());
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  useEffect(() => { if (allowed) load(); /* eslint-disable-next-line */ }, [allowed, statusFilter]);

  function toggle(id) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    const allShown = shown.length > 0 && shown.every(r => sel.has(r.reminderId));
    setSel(prev => {
      const n = new Set(prev);
      shown.forEach(r => allShown ? n.delete(r.reminderId) : n.add(r.reminderId));
      return n;
    });
  }

  async function closeSelected() {
    if (sel.size === 0) return;
    if (!window.confirm(`Close ${sel.size} reminder(s)? This cannot be undone.`)) return;
    setBusy(true); setMsg('');
    try {
      const r = await staffAPI.closeReminders([...sel]);
      setMsg(`✓ Closed ${r.data.closed} reminder(s).`);
      await load();
    } catch (e) { setMsg('Failed: ' + e.message); }
    setBusy(false);
  }

  if (!allowed) return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Admin or Tech Support only.</div>;

  const fmt = d => d ? String(d).slice(0, 10) : '—';
  const th = { textAlign: 'left', padding: '0.5rem 0.625rem', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' };
  const td = { padding: '0.5rem 0.625rem', fontSize: '0.8125rem', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Maintenance</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
        Open reminders on Leads that are <b>Contracted / Lost / Archived / Not contactable</b>. These auto-close on status change;
        this is the manual review + close for any that remain.
      </p>

      <div className="section-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
          <label style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Status:</label>
          <select className="form-select" style={{ maxWidth: 200 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="form-input" style={{ maxWidth: 220 }} placeholder="Search name / Sales ID…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{shown.length} of {rows.length}</span>
          <button className="btn btn--sm" disabled={busy} onClick={load}>Refresh</button>
          <button className="btn btn--primary btn--sm" style={{ marginLeft: 'auto' }}
            disabled={busy || sel.size === 0} onClick={closeSelected}>
            {busy ? 'Working…' : `Close selected (${sel.size})`}
          </button>
        </div>
        {msg && <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>{msg}</div>}

        {rows.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', padding: '1rem 0' }}>
            {busy ? 'Loading…' : 'No open reminders on Leads in these statuses. 🎉'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 32 }}>
                    <input type="checkbox" checked={shown.length > 0 && shown.every(r => sel.has(r.reminderId))} onChange={toggleAll} />
                  </th>
                  <th style={th}>Name</th>
                  <th style={th}>Lead status</th>
                  <th style={th}>Due</th>
                  <th style={th}>Topic</th>
                  <th style={th}>Author</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.reminderId}>
                    <td style={td}><input type="checkbox" checked={sel.has(r.reminderId)} onChange={() => toggle(r.reminderId)} /></td>
                    <td style={td}>
                      <button onClick={() => navigate(`/students/${r.studentId}`)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary)', fontWeight: 600, fontSize: '0.8125rem' }}>
                        {r.studentName || r.studentId}
                      </button>
                    </td>
                    <td style={td}>{r.leadStatus}</td>
                    <td style={td}>{fmt(r.rescheduledDate || r.followUpDate)}</td>
                    <td style={td}>{r.topic || '—'}</td>
                    <td style={td}>{r.authorName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
