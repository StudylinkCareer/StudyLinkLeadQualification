// LeadManagement/src/pages/DataCleanup.jsx
// Admin-only data cleansing: purge test records (with a per-table preview +
// confirm) and sweep rows orphaned by past deletions. Backend enforces the
// full leads.delete gate; this page mirrors it. All deletes are permanent.

import { useState, useEffect, useCallback } from 'react';
import { studentAPI } from '../services/api';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';

const card = { border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', background: '#fff', marginBottom: '1.25rem' };
const td   = { padding: '6px 10px', borderBottom: '1px solid #f3f4f6' };
const btn  = (primary, color) => ({ padding: '9px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : `1px solid ${color || '#2563eb'}`, background: primary ? (color || '#2563eb') : '#fff', color: primary ? '#fff' : (color || '#2563eb') });

const LABELS = {
  students: 'Students (people)', leads: 'Leads', notes: 'Notes', documents: 'Documents',
  leadEvents: 'Event registrations', eventAttendees: 'Event attendees', eventDeskVisits: 'Event desk visits',
  auditLog: 'Audit-log entries', duplicateReviews: 'Parked duplicates',
};
const ORDER = ['students', 'leads', 'notes', 'documents', 'leadEvents', 'eventAttendees', 'eventDeskVisits', 'duplicateReviews', 'auditLog'];

export default function DataCleanup() {
  const { canDo } = usePermissions();
  const { language } = useLanguage();
  const vi = language === 'vi';
  const allowed = canDo('leads', 'delete');

  const [idText, setIdText]     = useState('');
  const [preview, setPreview]   = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [delResult, setDelResult] = useState(null);
  const [err, setErr] = useState('');

  const [orphans, setOrphans]     = useState(null);
  const [orphBusy, setOrphBusy]   = useState(false);
  const [orphResult, setOrphResult] = useState(null);

  // One ID PER LINE — split on newlines only, so IDs containing spaces/commas
  // (e.g. the junk id ',300-500M VND,,4') survive intact.
  const parseIds = () => [...new Set(idText.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];

  const loadOrphans = useCallback(async () => {
    try { const r = await studentAPI.getOrphans(); setOrphans(r.data); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { if (allowed) loadOrphans(); }, [allowed, loadOrphans]);

  if (!allowed) return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '1.5rem' }}>{vi ? 'Dọn dữ liệu' : 'Data Cleanup'}</h1>
      <p style={{ color: '#b91c1c' }}>{vi ? 'Cần quyền xóa đầy đủ.' : 'You need unrestricted delete permission.'}</p>
    </div>
  );

  const ids = parseIds();

  const doPreview = async () => {
    setErr(''); setDelResult(null); setPreview(null);
    if (!ids.length) { setErr(vi ? 'Nhập ít nhất một mã.' : 'Enter at least one student ID.'); return; }
    try { const r = await studentAPI.deletePreview(ids); setPreview(r.data); } catch (e) { setErr(e.message); }
  };
  const doDelete = async () => {
    if (!preview) return;
    if (!window.confirm(vi ? `Xóa vĩnh viễn ${ids.length} hồ sơ và toàn bộ dữ liệu liên quan?` : `Permanently delete ${ids.length} record(s) and ALL related data? This cannot be undone.`)) return;
    setDeleting(true); setErr('');
    try {
      const r = await studentAPI.deleteRecords(ids);
      setDelResult(r); setPreview(null); setIdText('');
      await loadOrphans();
    } catch (e) { setErr(e.message); } finally { setDeleting(false); }
  };
  const doPurgeOrphans = async () => {
    if (!orphans || !orphans.total) return;
    if (!window.confirm(vi ? `Dọn ${orphans.total} dòng mồ côi?` : `Purge ${orphans.total} orphaned row(s)? This cannot be undone.`)) return;
    setOrphBusy(true); setErr('');
    try { const r = await studentAPI.purgeOrphans(); setOrphResult(r.data); await loadOrphans(); }
    catch (e) { setErr(e.message); } finally { setOrphBusy(false); }
  };

  const summarise = (obj) => Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `${v} ${LABELS[k] || k}`).join(', ');

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '.25rem' }}>{vi ? 'Dọn dữ liệu' : 'Data Cleanup'}</h1>
      <p style={{ color: '#6b7280', marginBottom: '1.25rem' }}>{vi ? 'Xóa dữ liệu thử nghiệm và dọn dữ liệu mồ côi. Mọi thao tác xóa là vĩnh viễn.' : 'Purge test records and sweep orphaned data. All deletes are permanent.'}</p>
      {err && <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#b91c1c' }}>{err}</div>}

      {/* Purge test records */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{vi ? 'Xóa hồ sơ thử nghiệm' : 'Purge test records'}</h2>
        <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Dán mã sinh viên — MỖI DÒNG MỘT MÃ (mã có thể chứa dấu cách/phẩy).' : 'Paste student IDs — ONE PER LINE (IDs may contain spaces or commas).'}</p>
        <textarea value={idText} onChange={e => { setIdText(e.target.value); setPreview(null); setDelResult(null); }} rows={3}
          placeholder={"20260627-91\n,300-500M VND,,4"}
          style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontFamily: 'monospace', fontSize: '.85rem', boxSizing: 'border-box' }} />
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={doPreview} disabled={!ids.length} style={btn(false)}>{vi ? 'Xem trước' : 'Preview'}{ids.length ? ` (${ids.length})` : ''}</button>
          {preview && <button onClick={doDelete} disabled={deleting} style={btn(true, '#dc2626')}>{deleting ? (vi ? 'Đang xóa…' : 'Deleting…') : (vi ? 'Xác nhận xóa' : 'Confirm delete')}</button>}
        </div>

        {preview && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontWeight: 600, margin: '0 0 6px' }}>{vi ? 'Sẽ xóa:' : 'Will delete:'}</p>
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 420 }}>
              <tbody>
                {ORDER.filter(k => k in preview).map(k => (
                  <tr key={k}><td style={td}>{LABELS[k] || k}</td><td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{preview[k]}</td></tr>
                ))}
              </tbody>
            </table>
            {!preview.students && <p style={{ color: '#b45309', marginTop: 8 }}>{vi ? 'Không tìm thấy hồ sơ khớp — kiểm tra lại mã.' : 'No matching students found — check the IDs.'}</p>}
          </div>
        )}
        {delResult && (
          <div style={{ ...card, marginTop: 12, marginBottom: 0, borderColor: '#86efac', background: '#f0fdf4' }}>
            <b>{delResult.deleted}</b> {vi ? 'hồ sơ đã xóa.' : 'record(s) deleted.'} {delResult.purged && <span style={{ color: '#6b7280' }}>({summarise(delResult.purged)})</span>}
          </div>
        )}
      </div>

      {/* Orphan sweep */}
      <div style={card}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{vi ? 'Dữ liệu mồ côi' : 'Orphaned data'}</h2>
        <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Dòng còn sót từ các lần xóa trước (sinh viên không còn tồn tại).' : 'Rows left behind by past deletions — the student no longer exists.'}</p>
        {!orphans ? <p style={{ color: '#6b7280' }}>{vi ? 'Đang tải…' : 'Loading…'}</p> : orphans.total === 0 ? (
          <p style={{ color: '#16a34a', margin: 0 }}>{vi ? 'Không có dữ liệu mồ côi. ✓' : 'No orphaned data. ✓'}</p>
        ) : (
          <>
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 420 }}>
              <tbody>
                {Object.entries(orphans.counts).filter(([, v]) => v).map(([k, v]) => (
                  <tr key={k}><td style={td}>{LABELS[k] || k}</td><td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{v}</td></tr>
                ))}
                <tr><td style={{ ...td, fontWeight: 700 }}>{vi ? 'Tổng' : 'Total'}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{orphans.total}</td></tr>
              </tbody>
            </table>
            <button onClick={doPurgeOrphans} disabled={orphBusy} style={{ ...btn(true, '#dc2626'), marginTop: 10 }}>{orphBusy ? (vi ? 'Đang dọn…' : 'Purging…') : (vi ? 'Dọn dữ liệu mồ côi' : 'Purge orphans')}</button>
          </>
        )}
        {orphResult && (
          <div style={{ ...card, marginTop: 12, marginBottom: 0, borderColor: '#86efac', background: '#f0fdf4' }}>
            {vi ? 'Đã dọn' : 'Purged'} <b>{orphResult.total}</b> {vi ? 'dòng mồ côi.' : 'orphaned row(s).'}
          </div>
        )}
      </div>
    </div>
  );
}
