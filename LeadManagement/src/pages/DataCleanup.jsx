// LeadManagement/src/pages/DataCleanup.jsx
// ---------------------------------------------------------------------------
// Deep Cleanse — standalone, SCHEMA-ADAPTIVE admin tool. Talks only to
// /api/cleanup/* (see cleanupAPI). The backend detects old-vs-new schema at
// runtime, so this same page works on current PROD and post-restructure.
//
// Tools:
//   1. Targeted purge  — build a record set (search-and-add OR paste IDs) →
//                        preview per-table footprint → confirm cascade delete.
//   2. By pattern      — find students whose id matches a LIKE (e.g. TEST-UPLOAD-%)
//                        → add them to the set.
//   3. Orphan sweep    — count + purge child rows whose student no longer exists.
//   4. Duplicates      — list persons sharing an email/phone → add the unwanted
//                        one to the set for deletion.
// Gated to Admin/Director here AND on the server. Every delete is confirmed.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
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

  // Pattern
  const [pattern, setPattern] = useState('TEST-UPLOAD-%');
  const [matches, setMatches] = useState(null);

  // Orphans
  const [orphans, setOrphans] = useState(null);

  // Duplicates
  const [dupBy, setDupBy] = useState('email');
  const [dups, setDups]   = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    cleanupAPI.schema().then(r => setSchema(r.data)).catch(e => setErr(e.message));
    cleanupAPI.orphans().then(r => setOrphans(r.data)).catch(() => {});
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
    const parsed = [...new Set(idText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
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
      cleanupAPI.orphans().then(x => setOrphans(x.data)).catch(() => {});
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const doPattern = async () => {
    setErr(''); setMatches(null);
    try { const r = await cleanupAPI.byPattern(pattern); setMatches(r.data.matches || []); } catch (e) { setErr(e.message); }
  };
  const doPurgeOrphans = async () => {
    if (!orphans?.total) return;
    if (!window.confirm(`Purge ${orphans.total} orphaned row(s)? This cannot be undone.`)) return;
    setErr('');
    try { await cleanupAPI.purgeOrphans(); const x = await cleanupAPI.orphans(); setOrphans(x.data); }
    catch (e) { setErr(e.message); }
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

        {/* paste ids */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ ...input, fontFamily: 'monospace' }} value={idText}
            placeholder="…or paste IDs: 20260627-91, 20260627-92"
            onChange={e => setIdText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPasted()} />
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

      {/* 2. By pattern */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>2. By pattern (bulk test-data)</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input, fontFamily: 'monospace' }} value={pattern} onChange={e => setPattern(e.target.value)} placeholder="TEST-UPLOAD-%" />
          <button onClick={doPattern} style={btn(false)}>Find</button>
        </div>
        {matches && (
          <div style={{ marginTop: 10 }}>
            <b>{matches.length}</b> match(es).
            {matches.length > 0 && <button onClick={() => addSel(matches.map(m => ({ id: m.id, name: m.name })))} style={{ ...btn(false), marginLeft: 10 }}>Add all to selection</button>}
          </div>
        )}
      </div>

      {/* 3. Orphan sweep */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>3. Orphaned data</h2>
        <p style={{ color: '#6b7280', marginTop: 0 }}>Child rows left behind by past deletions (the student no longer exists).</p>
        {!orphans ? <p style={{ color: '#6b7280' }}>Loading…</p> : orphans.total === 0 ? (
          <p style={{ color: '#16a34a', margin: 0 }}>No orphaned data. ✓</p>
        ) : (
          <>
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 440 }}>
              <tbody>
                {Object.entries(orphans.counts).filter(([, v]) => v).map(([k, v]) => (
                  <tr key={k}><td style={td}>{lbl(k)}</td><td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{v}</td></tr>
                ))}
                <tr><td style={{ ...td, fontWeight: 700 }}>Total</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{orphans.total}</td></tr>
              </tbody>
            </table>
            <button onClick={doPurgeOrphans} style={{ ...btn(true, '#dc2626'), marginTop: 10 }}>Purge orphans</button>
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
