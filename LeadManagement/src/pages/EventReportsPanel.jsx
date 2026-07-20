// src/pages/EventReportsPanel.jsx
// -----------------------------------------------------------------------------
// Event Check-in → Reports tab. Per-event store for the generated event /
// attendance report files (Excel, PDF, …): upload, download, delete. Manager /
// admin only (gated in the tab AND on every /reports endpoint). Files are held
// as bytea in Postgres and streamed back on download.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from 'react';
import { eventConsoleAPI } from '../services/api';

const card  = { background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:'16px 18px' };
const th    = { textAlign:'left', fontSize:12, textTransform:'uppercase', letterSpacing:'0.04em', color:'#6b7280', padding:'10px 12px', borderBottom:'1px solid #e5e7eb' };
const td    = { padding:'10px 12px', borderBottom:'1px solid #f1f5f9', fontSize:14, verticalAlign:'middle' };
const blue  = { padding:'9px 16px', borderRadius:8, border:'none', background:'#2563eb', color:'#fff', fontWeight:600, cursor:'pointer' };
const ghost = { padding:'7px 12px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:13 };

const fmtSize = (n) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
};
const fmtDate = (d) => { try { return d ? new Date(d).toLocaleString() : '—'; } catch { return '—'; } };

export default function EventReportsPanel({ eventId }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError]     = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async (id) => {
    if (!id) { setReports([]); return; }
    setLoading(true); setError('');
    try {
      const res = await eventConsoleAPI.listEventReports(id);
      setReports(res.data || []);
    } catch (e) { setError(e.message || 'Failed to load reports'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(eventId); }, [eventId, load]);

  // Poll while any report is still generating.
  useEffect(() => {
    if (!reports.some(r => r.status === 'generating')) return;
    const t = setInterval(() => load(eventId), 5000);
    return () => clearInterval(t);
  }, [reports, eventId, load]);

  const onGenerate = async (mode) => {
    if (!eventId) return;
    const msg = mode === 'data'
      ? 'Generate the data-only report (attendance, engagement ratings, missed-engagement, contract data)? No AI narrative — no credits used.'
      : 'Generate the full AI report? This analyses the desk notes + qualification and can take a minute.';
    if (!window.confirm(msg)) return;
    setGenerating(true); setError('');
    try { await eventConsoleAPI.generateEventReport(eventId, mode); await load(eventId); }
    catch (e) { setError(e.message || 'Could not start generation'); }
    finally { setGenerating(false); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    setBusy(true); setError('');
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
      await eventConsoleAPI.uploadEventReport(eventId, { fileName: file.name, mimeType: file.type, dataBase64 });
      await load(eventId);
    } catch (err) { setError(err.message || 'Upload failed'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const onDownload = (rpt) =>
    eventConsoleAPI.downloadEventReport(eventId, rpt.id, rpt.file_name).catch(e => setError(e.message));

  const onDelete = (rpt) => {
    if (!window.confirm(`Delete "${rpt.file_name}"? This cannot be undone.`)) return;
    setError('');
    eventConsoleAPI.deleteEventReport(eventId, rpt.id).then(() => load(eventId)).catch(e => setError(e.message));
  };

  if (!eventId) return <div style={{ ...card, color:'#6b7280' }}>Select an event above to manage its reports.</div>;

  return (
    <>
      <div style={{ ...card, marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontWeight:600 }}>Event reports</div>
          <div style={{ fontSize:13, color:'#6b7280' }}>Generate the AI report from this event's data, or upload a file. Manager / admin only.</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button style={{ ...blue, opacity: (generating || busy) ? 0.6 : 1 }} disabled={generating || busy}
            onClick={() => onGenerate('full')} title="Analyse desk notes + qualification and produce the full narrative report">
            {generating ? 'Starting…' : '✨ Generate (AI)'}
          </button>
          <button style={{ ...ghost, opacity: (generating || busy) ? 0.6 : 1 }} disabled={generating || busy}
            onClick={() => onGenerate('data')} title="Data sheets only — no AI narrative, no credits used">
            Generate (data only)
          </button>
          <input ref={fileRef} type="file" onChange={onFile} disabled={busy}
            style={{ display:'none' }} id="evt-report-file"
            accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf" />
          <button style={{ ...ghost, opacity: busy ? 0.6 : 1 }} disabled={busy}
            onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : '＋ Upload'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'10px 14px', borderRadius:8, marginBottom:12, fontSize:14 }}>
          {error}
        </div>
      )}

      <div style={{ ...card, padding:0, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th}>File</th>
              <th style={th}>Size</th>
              <th style={th}>Uploaded by</th>
              <th style={th}>When</th>
              <th style={{ ...th, textAlign:'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={td} colSpan={5}>Loading…</td></tr>}
            {!loading && reports.length === 0 && (
              <tr><td style={{ ...td, color:'#6b7280' }} colSpan={5}>No reports uploaded for this event yet.</td></tr>
            )}
            {!loading && reports.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight:500 }}>
                  {r.file_name}
                  {r.source === 'generated' && (
                    <span style={{ marginLeft:8, fontSize:11, color:'#6d28d9', background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:10, padding:'1px 7px' }}>AI</span>
                  )}
                  {r.status === 'failed' && r.error && (
                    <div style={{ fontSize:12, color:'#b91c1c', marginTop:2 }}>{r.error}</div>
                  )}
                </td>
                <td style={{ ...td, color:'#6b7280', whiteSpace:'nowrap' }}>{r.status === 'ready' ? fmtSize(r.byte_size) : '—'}</td>
                <td style={td}>{r.uploaded_by || <span style={{ color:'#9ca3af' }}>—</span>}</td>
                <td style={{ ...td, color:'#6b7280', whiteSpace:'nowrap' }}>{fmtDate(r.uploaded_at)}</td>
                <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                  {r.status === 'generating' ? (
                    <span style={{ color:'#6d28d9', fontSize:13 }}>Generating…</span>
                  ) : r.status === 'failed' ? (
                    <span style={{ color:'#b91c1c', fontSize:13 }}>Failed</span>
                  ) : (
                    <button style={ghost} onClick={() => onDownload(r)}>Download</button>
                  )}
                  <button style={{ ...ghost, marginLeft:8, border:'1px solid #fecaca', color:'#b91c1c' }}
                    onClick={() => onDelete(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
