// LeadManagement/src/pages/DataCleanup.jsx
// ---------------------------------------------------------------------------
// Deep Cleanse — standalone, SCHEMA-ADAPTIVE admin tool. Talks only to
// /api/cleanup/* (see cleanupAPI). The backend detects old-vs-new schema at
// runtime, so this same page works on current PROD and post-restructure.
//
// Tools:
//   1. Targeted purge  — build a record set (search-and-add OR paste IDs) →
//                        preview per-table footprint → confirm cascade delete.
//   2. Search          — partial, case-insensitive search across name/id/email/phone
//                        → add them to the set.
//   3. Orphan sweep    — count + purge child rows whose student no longer exists.
//   4. Duplicates      — list persons sharing an email/phone → add the unwanted
//                        one to the set for deletion.
// Gated to Admin/Director here AND on the server. Every delete is confirmed.
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { cleanupAPI, studentAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const card = { border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', background: '#fff', marginBottom: '1.25rem' };
const td   = { padding: '6px 10px', borderBottom: '1px solid #f3f4f6' };
const input = { width: '100%', padding: '9px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '.9rem', boxSizing: 'border-box' };
const btn  = (primary, color = '#2563eb') => ({ padding: '9px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : `1px solid ${color}`, background: primary ? color : '#fff', color: primary ? '#fff' : color });

const LABELS = {
  students: 'Students (people)', leads: 'Leads', student_notes: 'Notes', documents: 'Documents',
  lead_events: 'Event registrations', event_attendees: 'Event attendees', event_desk_visits: 'Event desk visits',
  audit_log: 'Audit-log entries', duplicate_reviews: 'Parked duplicates',
};
const lbl = (k) => LABELS[k] || k;

export default function DataCleanup() {
  const { staff } = useAuth();
  const isAdmin = ['Admin', 'Director'].includes(staff?.role);

  const [schema, setSchema]   = useState(null);
  const [err, setErr]         = useState('');

  // Selected record set: [{ id, name }]
  const [selected, setSelected] = useState([]);
  const addSel    = (rows) => setSelected(prev => {
    const seen = new Set(prev.map(p => p.id));
    return [...prev, ...rows.filter(r => r.id && !seen.has(r.id))];
  });
  const removeSel = (id) => setSelected(prev => prev.filter(p => p.id !== id));
  const ids = selected.map(s => s.id);

  // Pickers
  const [q, setQ]             = useState('');
  const [results, setResults] = useState(null);
  const [idText, setIdText]   = useState('');

  // Preview / delete
  const [preview, setPreview] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState(null);

  // Search (name / id / email / phone — partial, case-insensitive)
  const [pattern, setPattern] = useState('');
  const [matches, setMatches] = useState(null);

  // Orphans — selectable list of missing-student "owners"
  const [orphanKeys, setOrphanKeys] = useState(null);
  const [orphanSel, setOrphanSel]   = useState(() => new Set());
  const lastOrphanIdx = useRef(-1);

  // Duplicates
  const [dupBy, setDupBy] = useState('email');
  const [dups, setDups]   = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    cleanupAPI.schema().then(r => setSchema(r.data)).catch(e => setErr(e.message));
    cleanupAPI.orphanKeys().then(r => setOrphanKeys(r.data)).catch(() => {});
  }, [isAdmin]);

  if (!isAdmin) return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Deep Cleanse</h1>
      <p style={{ color: '#b91c1c' }}>Restricted to Admin / Director.</p>
    </div>
  );

  const doSearch = async () => {
    setErr(''); setResults(null);
    try {
      const r = await studentAPI.search(q);
      const rows = (r.data || []).map(s => ({
        id:   s.studentId || s.student_id || s.uniqueId || s.unique_id,
        name: s.fullName || s.full_name || '',
      })).filter(x => x.id);
      setResults(rows);
    } catch (e) { setErr(e.message); }
  };
  const addPasted = () => {
    // One ID PER LINE — split on newlines only so IDs with spaces/commas
    // (e.g. ',300-500M VND,,4') survive intact.
    const parsed = [...new Set(idText.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
    addSel(parsed.map(id => ({ id, name: '' })));
    setIdText('');
  };
  const doPreview = async () => {
    setErr(''); setResult(null); setPreview(null);
    if (!ids.length) { setErr('Add at least one record first.'); return; }
    try { const r = await cleanupAPI.preview(ids); setPreview(r.data); } catch (e) { setErr(e.message); }
  };
  const doDelete = async () => {
    if (!preview) return;
    if (!window.confirm(`Permanently delete ${ids.length} record(s) and ALL related data? This cannot be undone.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await cleanupAPI.apply(ids);
      setResult(r.data); setPreview(null); setSelected([]);
      cleanupAPI.orphanKeys().then(x => setOrphanKeys(x.data)).catch(() => {});
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const doPattern = async () => {
    setErr(''); setMatches(null);
    try { const r = await cleanupAPI.byPattern(pattern); setMatches(r.data.matches || []); } catch (e) { setErr(e.message); }
  };
  const orphanRowTotal = orphanKeys ? orphanKeys.keys.reduce((s, k) => s + k.total, 0) : 0;
  const toggleOrphan = (id, idx, shift) => {
    setOrphanSel(prev => {
      const next = new Set(prev);
      if (shift && lastOrphanIdx.current >= 0 && orphanKeys) {
        const [a, b] = [lastOrphanIdx.current, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(orphanKeys.keys[i].id);   // block select
      } else if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
    lastOrphanIdx.current = idx;
  };
  const allOrphansSelected = !!orphanKeys && orphanKeys.keys.length > 0 && orphanKeys.keys.every(k => orphanSel.has(k.id));
  const toggleAllOrphans = () => setOrphanSel(allOrphansSelected ? new Set() : new Set((orphanKeys?.keys || []).map(k => k.id)));
  const doPurgeOrphans = async () => {
    const sel = [...orphanSel];
    if (!orphanKeys?.count) return;
    const label = sel.length ? `${sel.length} selected missing student(s)` : `ALL ${orphanKeys.count} missing students`;
    if (!window.confirm(`Purge orphaned rows for ${label}? This cannot be undone.`)) return;
    setErr('');
    try {
      await cleanupAPI.purgeOrphans(sel.length ? sel : null);
      const x = await cleanupAPI.orphanKeys(); setOrphanKeys(x.data); setOrphanSel(new Set());
    } catch (e) { setErr(e.message); }
  };
  const doDuplicates = async () => {
    setErr(''); setDups(null);
    try { const r = await cleanupAPI.duplicates(dupBy); setDups(r.data.groups || []); } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 980 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '.25rem' }}>Deep Cleanse</h1>
      <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
        Schema-adaptive cleanup. All deletes are <b>permanent</b> — take a database backup first.
      </p>

      {schema && (
        <div style={{ ...card, padding: '0.6rem 1rem', display: 'flex', gap: '1.5rem', alignItems: 'center', fontSize: '.85rem' }}>
          <span><b>Schema:</b> {schema.schema} (students key: <code>{schema.studentPk}</code>)</span>
          <span><b>Cascades:</b> {schema.childTables.join(', ') || '—'}</span>
        </div>
      )}
      {err && <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#b91c1c' }}>{err}</div>}

      {/* 1. Targeted purge */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>1. Targeted purge</h2>

        {/* search picker */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={input} value={q} placeholder="Search name / id / email…"
            onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} />
          <button onClick={doSearch} style={btn(false)}>Search</button>
        </div>
        {results && (
          <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #eee', borderRadius: 8, marginBottom: 8 }}>
            {results.length === 0 ? <div style={{ padding: 10, color: '#6b7280' }}>No matches.</div> :
              results.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #f3f4f6' }}>
                  <span>{r.name || '—'} <code style={{ color: '#6b7280' }}>{r.id}</code></span>
                  <button onClick={() => addSel([r])} style={btn(false)}>Add</button>
                </div>
              ))}
          </div>
        )}

        {/* paste ids — ONE PER LINE so IDs with spaces/commas survive */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
          <textarea style={{ ...input, fontFamily: 'monospace', minHeight: 56, resize: 'vertical' }} value={idText} rows={2}
            placeholder={"…or paste student IDs, one per line:\n20260627-91\n,300-500M VND,,4"}
            onChange={e => setIdText(e.target.value)} />
          <button onClick={addPasted} style={btn(false)}>Add IDs</button>
        </div>

        {/* selection */}
        <div style={{ margin: '10px 0' }}>
          <b>Selected ({selected.length})</b>
          {selected.length > 0 && <button onClick={() => setSelected([])} style={{ ...btn(false), marginLeft: 10, padding: '4px 10px' }}>Clear</button>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {selected.map(s => (
              <span key={s.id} style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 16, padding: '3px 10px', fontSize: '.8rem' }}>
                {s.name ? `${s.name} · ` : ''}{s.id}
                <span onClick={() => removeSel(s.id)} style={{ marginLeft: 6, cursor: 'pointer', color: '#6b7280' }}>✕</span>
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={doPreview} disabled={!ids.length} style={btn(false)}>Preview{ids.length ? ` (${ids.length})` : ''}</button>
          {preview && <button onClick={doDelete} disabled={busy} style={btn(true, '#dc2626')}>{busy ? 'Deleting…' : 'Confirm delete'}</button>}
        </div>

        {preview && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontWeight: 600, margin: '0 0 6px' }}>Will delete (schema: {preview.schema}):</p>
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 440 }}>
              <tbody>
                <tr><td style={td}>{lbl('students')}</td><td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{preview.students}</td></tr>
                {Object.entries(preview.counts || {}).map(([k, v]) => (
                  <tr key={k}><td style={td}>{lbl(k)}</td><td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
            {!preview.students && <p style={{ color: '#b45309', marginTop: 8 }}>No matching students — check the IDs.</p>}
          </div>
        )}
        {result && (
          <div style={{ ...card, marginTop: 12, marginBottom: 0, borderColor: '#86efac', background: '#f0fdf4' }}>
            Deleted <b>{result.deleted?.students || 0}</b> students + dependents
            {result.deleted && <span style={{ color: '#6b7280' }}> ({Object.entries(result.deleted).filter(([k, v]) => v && k !== 'students').map(([k, v]) => `${v} ${lbl(k)}`).join(', ')})</span>}.
          </div>
        )}
      </div>

      {/* 2. Search */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>2. Search students</h2>
        <p style={{ color: '#6b7280', marginTop: 0 }}>
          Partial word, not case-sensitive, no wildcards needed — searches name, student ID, email and phone.
          Type e.g. <code>joyce</code>, <code>20260617</code>, <code>@gmail</code> or <code>0915</code>.
          (Advanced: include a <code>%</code> for a literal SQL pattern such as <code>TEST-UPLOAD-%</code>.)
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={input} value={pattern} onChange={e => setPattern(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') doPattern(); }} placeholder="Search by name, ID, email or phone…" />
          <button onClick={doPattern} style={btn(false)}>Search</button>
        </div>
        {matches && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span><b>{matches.length}</b> match(es){matches.length >= 500 ? ' (showing first 500 — refine the search)' : ''}.</span>
              {matches.length > 0 && <button onClick={() => addSel(matches.map(m => ({ id: m.id, name: m.name })))} style={btn(false)}>Add all to selection</button>}
            </div>
            {matches.length > 0 && (
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr>
                    <th style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Name</th>
                    <th style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Student ID</th>
                    <th style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Email</th>
                    <th style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Phone</th>
                    <th style={{ ...td, width: 60 }}></th>
                  </tr></thead>
                  <tbody>
                    {matches.map(m => (
                      <tr key={m.id}>
                        <td style={td}>{m.name || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td style={{ ...td, fontFamily: 'monospace' }}>{m.id}</td>
                        <td style={td}>{m.email || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td style={td}>{m.phone || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td style={td}>
                          <button onClick={() => addSel([{ id: m.id, name: m.name }])} style={btn(false)}>Add</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Orphan sweep — review & select missing students */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>3. Orphaned data — review &amp; select</h2>
        <p style={{ color: '#6b7280', marginTop: 0 }}>Child rows whose student no longer exists. Tick the missing students to purge (Shift-click for a block), or purge all.</p>
        {!orphanKeys ? <p style={{ color: '#6b7280' }}>Loading…</p> : orphanKeys.count === 0 ? (
          <p style={{ color: '#16a34a', margin: 0 }}>No orphaned data. ✓</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: '.85rem' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={allOrphansSelected} onChange={toggleAllOrphans} /> Select all
              </label>
              <span>{orphanKeys.count} missing students · {orphanRowTotal} orphan rows · <b>{orphanSel.size} selected</b></span>
            </div>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={{ ...td, width: 30 }}></th>
                  <th style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Missing student</th>
                  <th style={{ ...td, textAlign: 'right', fontWeight: 700 }}>Rows</th>
                  <th style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Breakdown</th>
                </tr></thead>
                <tbody>
                  {orphanKeys.keys.map((k, idx) => (
                    <tr key={k.id} style={{ background: orphanSel.has(k.id) ? '#eef2ff' : 'transparent' }}>
                      <td style={td}><input type="checkbox" checked={orphanSel.has(k.id)}
                        onClick={e => toggleOrphan(k.id, idx, e.shiftKey)} onChange={() => {}} /></td>
                      <td style={td}><code>{k.id}</code></td>
                      <td style={{ ...td, textAlign: 'right' }}>{k.total}</td>
                      <td style={{ ...td, color: '#6b7280', fontSize: '.8rem' }}>{Object.entries(k.tables).map(([t, n]) => `${lbl(t)}: ${n}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={doPurgeOrphans} style={{ ...btn(true, '#dc2626'), marginTop: 10 }}>
              {orphanSel.size ? `Purge selected (${orphanSel.size})` : `Purge ALL (${orphanKeys.count})`}
            </button>
          </>
        )}
      </div>

      {/* 4. Duplicates */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>4. Duplicate persons</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={dupBy} onChange={e => setDupBy(e.target.value)} style={{ ...input, width: 'auto' }}>
            <option value="email">By email</option>
            <option value="phone">By phone</option>
          </select>
          <button onClick={doDuplicates} style={btn(false)}>Find duplicates</button>
        </div>
        {dups && (
          <div style={{ marginTop: 10 }}>
            {dups.length === 0 ? <p style={{ color: '#16a34a', margin: 0 }}>No duplicates. ✓</p> :
              dups.map((g, i) => (
                <div key={i} style={{ borderBottom: '1px solid #f3f4f6', padding: '8px 0' }}>
                  <div style={{ fontSize: '.8rem', color: '#6b7280' }}>{g.keyval} — {g.n} records</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {(g.ids || []).map((id, j) => (
                      <button key={id} onClick={() => addSel([{ id, name: (g.names || [])[j] || '' }])}
                        style={{ ...btn(false), padding: '3px 10px', fontSize: '.8rem' }}>
                        + {(g.names || [])[j] || ''} {id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            {dups.length > 0 && <p style={{ ...td, color: '#6b7280', border: 0 }}>Add the record(s) to delete to the selection above, then Preview → Confirm.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
