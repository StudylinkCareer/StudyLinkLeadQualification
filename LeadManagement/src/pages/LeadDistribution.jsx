// LeadManagement/src/pages/LeadDistribution.jsx
//
// Distribution console (Admin/Manager/Director — self-gated on
// distribution.manage). Tabs: Release / Upload / Coverage / Redistribute.
// api.js camelCases server keys -> read s.fullName, c.fullName (NOT full_name).

import { useState, useEffect, useCallback } from 'react';
import { distributionAPI } from '../services/api';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';

const card = { border: '1px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', background: '#fff', marginBottom: '1.25rem' };
const th = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontWeight: 600, fontSize: '.85rem' };
const td = { padding: '6px 10px', borderBottom: '1px solid #f3f4f6' };
const btn = (primary) => ({ padding: '9px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : '1px solid #2563eb', background: primary ? '#2563eb' : '#fff', color: primary ? '#fff' : '#2563eb' });
const field = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8 };
const tabBtn = (on) => ({ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600,
  background: on ? '#2563eb' : '#eef2ff', color: on ? '#fff' : '#3730a3' });

export default function LeadDistribution() {
  const { canDo, loading: permsLoading } = usePermissions();
  const { language } = useLanguage();
  const vi = language === 'vi';
  const allowed = canDo('distribution', 'manage');

  const [tab, setTab] = useState('redistribute');
  const [offices, setOffices] = useState([]);
  const [pool, setPool] = useState([]);
  const [coverage, setCoverage] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // release
  const [office, setOffice] = useState('');
  const [perHead, setPerHead] = useState(50);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  // upload
  const [fileB64, setFileB64] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploadOffice, setUploadOffice] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  // notes upload
  const [notesB64, setNotesB64] = useState('');
  const [notesName, setNotesName] = useState('');
  const [notesResult, setNotesResult] = useState(null);
  // coverage add
  const [newStaff, setNewStaff] = useState('');
  const [newOffice, setNewOffice] = useState('');
  const [newWeight, setNewWeight] = useState(1.0);
  // redistribute
  const [recallStaff, setRecallStaff] = useState('');
  const [recallResult, setRecallResult] = useState(null);
  const [unsel, setUnsel] = useState({});
  // review
  const [reviewLeads, setReviewLeads] = useState([]);
  const [reviewSel, setReviewSel] = useState([]);      // selected unique_ids
  const [reviewCounselor, setReviewCounselor] = useState('');
  const [reviewMsg, setReviewMsg] = useState('');

  const loadAll = useCallback(async () => {
    try {
      setError('');
      const [off, pl, cov, st, un, rv] = await Promise.all([
        distributionAPI.offices(), distributionAPI.pool(), distributionAPI.coverage(),
        distributionAPI.staff(), distributionAPI.unassigned(), distributionAPI.review(),
      ]);
      setOffices(off.data || []);
      setPool(pl.data || []);
      setCoverage(cov.data || []);
      setStaffList(st.data || []);
      setUnassigned(un.data || []);
      setReviewLeads(rv.data || []);
      setOffice((c) => c || (off.data?.[0]?.code ?? ''));
      setNewOffice((c) => c || (off.data?.[0]?.code ?? ''));
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { if (allowed) loadAll(); }, [allowed, loadAll]);

  if (permsLoading) return <div style={{ padding: '2rem' }}>{vi ? 'Đang tải...' : 'Loading...'}</div>;
  if (!allowed) return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '1.4rem' }}>{vi ? 'Phân bổ Lead' : 'Lead Distribution'}</h1>
      <p style={{ color: '#b91c1c' }}>{vi ? 'Bạn cần quyền Quản trị, Quản lý hoặc Giám đốc.' : 'Admin, Manager or Director access required.'}</p>
    </div>
  );

  const totals = {};
  for (const r of pool) totals[r.office] = (totals[r.office] || 0) + Number(r.cnt);
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);

  async function run(fn) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }

  const handlePreview = () => run(async () => { setResult(null); const r = await distributionAPI.preview(office, Number(perHead) || 50); setPreview(r.data); });
  const handleRelease = () => run(async () => { const r = await distributionAPI.release(office, Number(perHead) || 50); setResult(r.data); setPreview(null); await loadAll(); });

  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setUploadResult(null);
    const reader = new FileReader();
    reader.onload = () => setFileB64(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(f);
  }
  const handleDownloadTemplate = () => run(async () => { await distributionAPI.downloadTemplate(); });
  const handleUpload = () => run(async () => {
    if (!fileB64) throw new Error(vi ? 'Chưa chọn tệp.' : 'No file selected.');
    const r = await distributionAPI.upload(fileB64, uploadOffice || null);
    setUploadResult(r.data); await loadAll();
  });

  function onNotesFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setNotesName(f.name); setNotesResult(null);
    const reader = new FileReader();
    reader.onload = () => setNotesB64(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(f);
  }
  const handleDownloadNotesTemplate = () => run(async () => { await distributionAPI.downloadNotesTemplate(); });
  const handleUploadNotes = () => run(async () => {
    if (!notesB64) throw new Error(vi ? 'Chưa chọn tệp.' : 'No file selected.');
    const r = await distributionAPI.uploadNotes(notesB64);
    setNotesResult(r.data);
  });
  const downloadB64Xlsx = (b64, name) => {
    const bytes = atob(b64); const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const handlePoolToReview = () => run(async () => {
    if (!window.confirm(vi ? `Chuyển toàn bộ lead trong nhóm chờ của ${office} sang Xem xét?` : `Move all pooled ${office} leads back to Review?`)) return;
    await distributionAPI.poolToReview(office);
    await loadAll();
  });

  const handleAddCoverage = () => run(async () => {
    if (!newStaff || !newOffice) throw new Error(vi ? 'Chọn nhân viên và văn phòng.' : 'Pick a counsellor and office.');
    await distributionAPI.addCoverage(Number(newStaff), newOffice, Number(newWeight) || 1.0);
    setNewStaff(''); await loadAll();
  });
  const handleRemoveCoverage = (id) => run(async () => { await distributionAPI.removeCoverage(id); await loadAll(); });
  const handleWeight = (id, weight) => run(async () => { await distributionAPI.updateCoverage(id, Number(weight) || 1.0); await loadAll(); });

  const handleRecall = () => run(async () => {
    if (!recallStaff) throw new Error(vi ? 'Chọn nhân viên.' : 'Pick a counsellor.');
    const name = staffList.find((s) => String(s.id) === String(recallStaff))?.fullName;
    const dry = await distributionAPI.recall(name, true);
    const n = dry.data?.wouldRecall || 0;
    if (n === 0) { setRecallResult({ recalled: 0, counsellor: name }); return; }
    if (!window.confirm(vi ? `Chuyển ${n} lead của ${name} về nhóm chờ?` : `Move ${n} open leads from ${name} back to the pool?`)) return;
    const res = await distributionAPI.recall(name, false);
    setRecallResult(res.data); await loadAll();
  });
  const handlePoolExisting = (residency) => run(async () => {
    const off = unsel[residency] || offices[0]?.code;
    if (!off) throw new Error(vi ? 'Chọn văn phòng.' : 'Pick an office.');
    await distributionAPI.poolExisting(residency, off);
    await loadAll();
  });

  const toggleReview = (uid) => setReviewSel((s) => s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid]);
  const toggleReviewAll = () => setReviewSel((s) => s.length === reviewLeads.length ? [] : reviewLeads.map((l) => l.uniqueId));
  const handleAssignManual = () => run(async () => {
    if (reviewSel.length === 0) throw new Error(vi ? 'Chưa chọn lead.' : 'No leads selected.');
    if (!reviewCounselor) throw new Error(vi ? 'Chọn nhân viên.' : 'Pick a counsellor.');
    const name = staffList.find((s) => String(s.id) === String(reviewCounselor))?.fullName;
    const r = await distributionAPI.assignManual(reviewSel, name);
    setReviewMsg(vi ? `Đã giao ${r.data.assigned} lead cho ${name}.` : `Assigned ${r.data.assigned} lead(s) to ${name}.`);
    setReviewSel([]); setReviewCounselor(''); await loadAll();
  });
  const handleCommitPool = () => run(async () => {
    const remaining = reviewLeads.length;
    if (remaining === 0) { setReviewMsg(vi ? 'Không còn lead để chuyển.' : 'Nothing left to commit.'); return; }
    if (!window.confirm(vi ? `Chuyển ${remaining} lead còn lại vào nhóm chờ để chia tự động?` : `Commit the ${remaining} remaining lead(s) to the pool for auto-distribution?`)) return;
    const r = await distributionAPI.commitPool();
    setReviewMsg(vi ? `Đã chuyển ${r.data.committed} vào nhóm chờ${r.data.blockedNoOffice ? `; ${r.data.blockedNoOffice} thiếu Office` : ''}.`
      : `Committed ${r.data.committed} to the pool${r.data.blockedNoOffice ? `; ${r.data.blockedNoOffice} still need an Office` : ''}.`);
    setReviewSel([]); await loadAll();
  });

  const covByOffice = {};
  for (const c of coverage) (covByOffice[c.office] ||= []).push(c);

  const tabs = [
    ['redistribute', vi ? 'Tái phân bổ Lead' : 'Redistribute Leads'],
    ['upload', vi ? 'Tải Lead' : 'Upload Leads'],
    ['notes', vi ? 'Tải Ghi chú' : 'Upload Notes'],
    ['review', `${vi ? 'Xem xét' : 'Review'}${reviewLeads.length ? ` (${reviewLeads.length})` : ''}`],
    ['release', vi ? 'Phát hành' : 'Release'],
    ['coverage', vi ? 'Phân công văn phòng' : 'Coverage'],
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '.25rem' }}>{vi ? 'Phân bổ Lead' : 'Lead Distribution'}</h1>
      <p style={{ color: '#6b7280', marginBottom: '1.25rem' }}>{vi ? 'Tải lead, quản lý văn phòng, và phát hành theo đợt.' : 'Upload leads, manage office coverage, and release in tranches.'}</p>

      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabs.map(([k, label]) => <button key={k} style={tabBtn(tab === k)} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {error && <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#b91c1c' }}>{error}</div>}

      {/* ───────── RELEASE ───────── */}
      {tab === 'release' && (
        <>
          <div style={card}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 .75rem' }}>{vi ? 'Nhóm chờ' : 'Waiting pool'} {grand > 0 && `(${grand})`}</h2>
            {pool.length === 0 ? <p style={{ color: '#6b7280', margin: 0 }}>{vi ? 'Không có lead nào đang chờ.' : 'No leads waiting in the pool.'}</p> : (
              <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 560 }}>
                <thead><tr><th style={th}>{vi ? 'Văn phòng' : 'Office'}</th><th style={th}>{vi ? 'Hạng' : 'Tier'}</th><th style={{ ...th, textAlign: 'right' }}>{vi ? 'SL' : 'Count'}</th></tr></thead>
                <tbody>{pool.map((r, i) => <tr key={i}><td style={td}>{r.office}</td><td style={td}>{r.tier}</td><td style={{ ...td, textAlign: 'right' }}>{r.cnt}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div style={card}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 .75rem' }}>{vi ? 'Phát hành đợt' : 'Release a tranche'}</h2>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Văn phòng' : 'Office'}
                <select value={office} onChange={(e) => { setOffice(e.target.value); setPreview(null); setResult(null); }} style={{ ...field, marginTop: 4, minWidth: 200 }}>
                  {offices.map((o) => <option key={o.code} value={o.code}>{o.label} ({totals[o.code] || 0})</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Lead / nhân viên' : 'Leads per counsellor'}
                <input type="number" min={1} value={perHead} onChange={(e) => { setPerHead(e.target.value); setPreview(null); }} style={{ ...field, marginTop: 4, width: 120 }} />
              </label>
              <button onClick={handlePreview} disabled={busy || !office} style={btn(false)}>{busy ? '…' : (vi ? 'Xem trước' : 'Preview')}</button>
            </div>
            <div style={{ marginTop: '.85rem', borderTop: '1px solid #f3f4f6', paddingTop: '.85rem' }}>
              <button onClick={handlePoolToReview} disabled={busy || !office || !(totals[office] > 0)} style={{ ...btn(false), border: '1px solid #d1d5db', color: '#374151' }}>{busy ? '…' : (vi ? `↩ Chuyển nhóm chờ ${office} sang Xem xét` : `↩ Send ${office} pool back to Review`)}</button>
              <span style={{ color: '#6b7280', fontSize: '.8rem', marginLeft: 8 }}>{vi ? 'để chỉnh/giao tay trước khi chia.' : 'to edit / hand-assign before distributing.'}</span>
            </div>
          </div>
          {preview && (
            <div style={{ ...card, borderColor: '#bfdbfe', background: '#f8fafc' }}>
              <p style={{ color: '#374151', marginTop: 0 }}>{vi ? 'Sẽ phân bổ' : 'Will assign'} <b>{preview.released}</b>; <b>{preview.leftInPool}</b> {vi ? 'còn lại.' : 'left in pool.'}</p>
              <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 520, marginBottom: '1rem' }}>
                <thead><tr><th style={th}>{vi ? 'Nhân viên' : 'Counsellor'}</th><th style={{ ...th, textAlign: 'right' }}>{vi ? 'Trọng số' : 'Weight'}</th><th style={{ ...th, textAlign: 'right' }}>{vi ? 'Giao' : 'Assigned'}</th></tr></thead>
                <tbody>{(preview.perCounsellor || []).map((c, i) => <tr key={i}><td style={td}>{c.name}</td><td style={{ ...td, textAlign: 'right' }}>{c.weight}</td><td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{c.assigned}</td></tr>)}</tbody>
              </table>
              {preview.tierMix && Object.keys(preview.tierMix).length > 0 && <p style={{ fontSize: '.9rem', color: '#374151' }}>{vi ? 'Theo hạng: ' : 'Tier mix: '}{Object.entries(preview.tierMix).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}</p>}
              <div style={{ display: 'flex', gap: '.75rem' }}>
                <button onClick={handleRelease} disabled={busy || preview.released === 0} style={btn(true)}>{busy ? '…' : (vi ? `Phát hành ${preview.released}` : `Release ${preview.released}`)}</button>
                <button onClick={() => setPreview(null)} disabled={busy} style={{ ...btn(false), border: '1px solid #d1d5db', color: '#374151' }}>{vi ? 'Hủy' : 'Cancel'}</button>
              </div>
            </div>
          )}
          {result && <div style={{ ...card, borderColor: '#86efac', background: '#f0fdf4' }}><b>{result.released}</b> {vi ? 'lead đã phân bổ.' : 'leads assigned.'} {result.batchId && <span style={{ color: '#6b7280' }}>batch: {result.batchId}</span>}</div>}
        </>
      )}

      {/* ───────── UPLOAD ───────── */}
      {tab === 'upload' && (
        <div style={card}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 .25rem' }}>{vi ? 'Tải lead' : 'Upload leads'}</h2>
          <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Mẫu chứa toàn bộ cột của hồ sơ lead — điền những gì bạn có (cần unique_id). Lead chưa có nhân viên sẽ vào tab Xem xét; lead đã có nhân viên sẽ nhập như đã giao. Chấp nhận .xlsx, .xls, .csv; trùng unique_id bị bỏ qua.' : "The template has every lead-profile column — fill what you have (unique_id required). Leads with no counsellor go to the Review tab; leads that already name a counsellor import as already-owned. Accepts .xlsx, .xls or .csv; duplicate unique_ids are skipped."}</p>
          <div style={{ marginBottom: '1rem' }}>
            <button onClick={handleDownloadTemplate} disabled={busy} style={btn(false)}>{vi ? '⬇ Tải mẫu Excel (đầy đủ)' : '⬇ Download full Excel template'}</button>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Tệp' : 'File'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ marginTop: 6 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Văn phòng mặc định' : 'Default office'}
              <select value={uploadOffice} onChange={(e) => setUploadOffice(e.target.value)} style={{ ...field, marginTop: 4, minWidth: 220 }}>
                <option value="">{vi ? "— dùng cột office của từng dòng —" : "— use each row's office —"}</option>
                {offices.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </label>
            <button onClick={handleUpload} disabled={busy || !fileB64} style={btn(true)}>{busy ? '…' : (vi ? 'Tải lên' : 'Upload')}</button>
          </div>
          {fileName && <p style={{ color: '#6b7280', fontSize: '.85rem', marginBottom: 0 }}>{fileName}</p>}
          {uploadResult && (
            <div style={{ marginTop: '1rem', padding: '.75rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
              {vi ? 'Đã thêm' : 'Added'} <b>{uploadResult.inserted}</b> · {uploadResult.review} {vi ? 'sang Xem xét' : 'to Review'} · {uploadResult.owned} {vi ? 'đã có nhân viên' : 'already-owned'} · {vi ? 'bỏ qua (trùng)' : 'skipped (dupes)'} {uploadResult.skipped} · {vi ? 'lỗi' : 'failed'} {uploadResult.failed}
              {uploadResult.review > 0 && <div style={{ marginTop: 6, fontSize: '.85rem', color: '#374151' }}>{vi ? 'Vào tab Xem xét để giao tay hoặc chuyển vào nhóm chờ.' : 'Go to the Review tab to hand-assign or commit to the pool.'}</div>}
              {uploadResult.untagged > 0 && <div style={{ color: '#92400e', marginTop: 6, fontSize: '.85rem' }}>{vi ? `${uploadResult.untagged} lead trong Xem xét chưa có Office — chưa thể chuyển vào nhóm chờ.` : `${uploadResult.untagged} review lead(s) have no Office — can't be committed to the pool until set.`}</div>}
              {uploadResult.failed > 0 && uploadResult.firstError && <div style={{ color: '#b91c1c', marginTop: 6, fontSize: '.8rem' }}>{vi ? 'Lỗi đầu tiên: ' : 'First error: '}{uploadResult.firstError}</div>}
            </div>
          )}
        </div>
      )}

      {/* ───────── NOTES ───────── */}
      {tab === 'notes' && (
        <div style={card}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 .25rem' }}>{vi ? 'Tải ghi chú hàng loạt (dữ liệu cũ)' : 'Bulk-upload notes (legacy data)'}</h2>
          <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Mỗi dòng là một ghi chú gắn vào lead theo unique_id. Cột: unique_id, note_type, content (+ author_name, author_id, created_at không bắt buộc). Lead không khớp sẽ bị bỏ qua.' : 'Each row is one note attached to a lead by unique_id. Columns: unique_id, note_type, content (+ optional author_name, author_id, created_at). Rows whose unique_id is not found are skipped.'}</p>
          <div style={{ marginBottom: '1rem' }}>
            <button onClick={handleDownloadNotesTemplate} disabled={busy} style={btn(false)}>{vi ? '⬇ Tải mẫu ghi chú' : '⬇ Download notes template'}</button>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Tệp' : 'File'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onNotesFile} style={{ marginTop: 6 }} />
            </label>
            <button onClick={handleUploadNotes} disabled={busy || !notesB64} style={btn(true)}>{busy ? '…' : (vi ? 'Tải lên' : 'Upload')}</button>
          </div>
          {notesName && <p style={{ color: '#6b7280', fontSize: '.85rem', marginBottom: 0 }}>{notesName}</p>}
          {notesResult && (
            <div style={{ marginTop: '1rem', padding: '.75rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
              {vi ? 'Đã thêm' : 'Added'} <b>{notesResult.inserted}</b> {vi ? 'ghi chú' : 'notes'} · {vi ? 'không khớp lead' : 'unmatched'} {notesResult.unmatched} · {vi ? 'lỗi' : 'failed'} {notesResult.failed}
              {notesResult.errorFileBase64 && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => downloadB64Xlsx(notesResult.errorFileBase64, `unmatched_notes_${new Date().toISOString().slice(0, 10)}.xlsx`)} style={{ ...btn(false), borderColor: '#b45309', color: '#b45309' }}>
                    {vi ? `⬇ Tải nhật ký lỗi (${notesResult.unmatched + notesResult.failed} dòng)` : `⬇ Download error log (${notesResult.unmatched + notesResult.failed} rows)`}
                  </button>
                  <span style={{ color: '#6b7280', fontSize: '.8rem', marginLeft: 8 }}>{vi ? 'gồm cột lý do để xử lý lại.' : 'includes a reason column for reprocessing.'}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ───────── REVIEW ───────── */}
      {tab === 'review' && (
        <div style={card}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 .25rem' }}>{vi ? 'Xem xét trước khi vào nhóm chờ' : 'Review before committing to the pool'}</h2>
          <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Lead từ Tải lên, Tái phân bổ và quét lead cũ nằm ở đây. Chọn một số để giao tay cho một nhân viên, rồi chuyển phần còn lại vào nhóm chờ để chia tự động.' : 'Leads from Upload, Redistribute and sweeps land here. Select some to assign manually to one counsellor, then commit the rest to the pool for auto-distribution.'}</p>
          {reviewMsg && <div style={{ marginBottom: '1rem', padding: '.6rem 1rem', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a' }}>{reviewMsg}</div>}
          {reviewLeads.length === 0 ? <p style={{ color: '#6b7280', margin: 0 }}>{vi ? 'Không có lead nào đang chờ xem xét.' : 'No leads waiting for review.'}</p> : (
            <>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? `Giao ${reviewSel.length} lead đã chọn cho` : `Assign ${reviewSel.length} selected to`}
                  <select value={reviewCounselor} onChange={(e) => setReviewCounselor(e.target.value)} style={{ ...field, marginTop: 4, minWidth: 240 }}>
                    <option value="">{vi ? '— chọn nhân viên —' : '— select counsellor —'}</option>
                    {staffList.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                  </select>
                </label>
                <button onClick={handleAssignManual} disabled={busy || reviewSel.length === 0 || !reviewCounselor} style={btn(true)}>{busy ? '…' : (vi ? 'Giao tay' : 'Assign')}</button>
                <button onClick={handleCommitPool} disabled={busy} style={{ ...btn(false) }}>{busy ? '…' : (vi ? `Chuyển ${reviewLeads.length} còn lại vào nhóm chờ` : `Commit ${reviewLeads.length} remaining to pool`)}</button>
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  <th style={{ ...th, width: 34 }}><input type="checkbox" checked={reviewSel.length === reviewLeads.length && reviewLeads.length > 0} onChange={toggleReviewAll} /></th>
                  <th style={th}>ID</th><th style={th}>{vi ? 'Tên' : 'Name'}</th><th style={th}>{vi ? 'Văn phòng' : 'Office'}</th><th style={th}>{vi ? 'Hạng' : 'Tier'}</th><th style={th}>{vi ? 'Từ (cũ)' : 'From (prev)'}</th>
                </tr></thead>
                <tbody>
                  {reviewLeads.map((l) => (
                    <tr key={l.uniqueId} style={reviewSel.includes(l.uniqueId) ? { background: '#eff6ff' } : undefined}>
                      <td style={td}><input type="checkbox" checked={reviewSel.includes(l.uniqueId)} onChange={() => toggleReview(l.uniqueId)} /></td>
                      <td style={td}>{l.uniqueId}</td>
                      <td style={td}>{l.fullName}</td>
                      <td style={{ ...td, color: l.office ? undefined : '#b45309' }}>{l.office || (vi ? '(thiếu)' : '(none)')}</td>
                      <td style={td}>{l.stoneTier || '—'}</td>
                      <td style={td}>{l.prevCounselor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ───────── COVERAGE ───────── */}
      {tab === 'coverage' && (
        <>
          <div style={card}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 .75rem' }}>{vi ? 'Thêm phân công' : 'Add coverage'}</h2>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Nhân viên' : 'Counsellor'}
                <select value={newStaff} onChange={(e) => setNewStaff(e.target.value)} style={{ ...field, marginTop: 4, minWidth: 220 }}>
                  <option value="">{vi ? '— chọn —' : '— select —'}</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Văn phòng' : 'Office'}
                <select value={newOffice} onChange={(e) => setNewOffice(e.target.value)} style={{ ...field, marginTop: 4, minWidth: 160 }}>
                  {offices.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Trọng số' : 'Weight'}
                <input type="number" step="0.05" min="0" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} style={{ ...field, marginTop: 4, width: 100 }} />
              </label>
              <button onClick={handleAddCoverage} disabled={busy} style={btn(true)}>{busy ? '…' : (vi ? 'Thêm' : 'Add')}</button>
            </div>
            <p style={{ color: '#6b7280', fontSize: '.82rem', marginBottom: 0 }}>{vi ? 'Trọng số = phần tương đối trong văn phòng (1.0 = trung bình, 1.5 = nhận 150%).' : 'Weight = share within the office (1.0 = average, 1.5 = takes 150%).'}</p>
          </div>
          {offices.map((o) => {
            const list = covByOffice[o.code] || [];
            const sum = list.reduce((a, c) => a + Number(c.weight), 0);
            return (
              <div style={card} key={o.code}>
                <h2 style={{ fontSize: '1.05rem', margin: '0 0 .5rem' }}>{o.label}</h2>
                {list.length === 0 ? <p style={{ color: '#6b7280', margin: 0 }}>{vi ? 'Chưa có nhân viên.' : 'No counsellors assigned.'}</p> : (
                  <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 600 }}>
                    <thead><tr><th style={th}>{vi ? 'Nhân viên' : 'Counsellor'}</th><th style={{ ...th, textAlign: 'right' }}>{vi ? 'Trọng số' : 'Weight'}</th><th style={{ ...th, textAlign: 'right' }}>%</th><th style={th}></th></tr></thead>
                    <tbody>
                      {list.map((c) => (
                        <tr key={c.id}>
                          <td style={td}>{c.fullName}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <input type="number" step="0.05" min="0" defaultValue={c.weight}
                              onBlur={(e) => { if (Number(e.target.value) !== Number(c.weight)) handleWeight(c.id, e.target.value); }}
                              style={{ ...field, width: 80, textAlign: 'right', padding: '4px 8px' }} />
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>{sum > 0 ? ((Number(c.weight) / sum) * 100).toFixed(1) : '0.0'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <button onClick={() => handleRemoveCoverage(c.id)} disabled={busy} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}>{vi ? 'Xóa' : 'Remove'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ───────── REDISTRIBUTE ───────── */}
      {tab === 'redistribute' && (
        <>
          <div style={card}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 .25rem' }}>{vi ? 'Nhân viên nghỉ việc' : 'Departing counsellor'}</h2>
            <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Chuyển toàn bộ lead đang mở của họ về nhóm chờ (giữ nguyên văn phòng), rồi vào tab Phát hành để chia lại. Nhớ xóa họ ở tab Phân công để không nhận lead mới.' : "Moves all their open leads back to the pool (office preserved), then use the Release tab to redistribute. Also remove them on the Coverage tab so they get no new leads."}</p>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '.85rem' }}>{vi ? 'Nhân viên' : 'Counsellor'}
                <select value={recallStaff} onChange={(e) => { setRecallStaff(e.target.value); setRecallResult(null); }} style={{ ...field, marginTop: 4, minWidth: 240 }}>
                  <option value="">{vi ? '— chọn —' : '— select —'}</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </label>
              <button onClick={handleRecall} disabled={busy || !recallStaff} style={btn(true)}>{busy ? '…' : (vi ? 'Chuyển sang Xem xét' : 'Recall to review')}</button>
            </div>
            {recallResult && <div style={{ marginTop: '1rem', padding: '.75rem 1rem', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
              {recallResult.recalled > 0 ? <span><b>{recallResult.recalled}</b> {vi ? 'lead đã chuyển sang tab Xem xét (giữ chủ cũ). Vào đó để giao tay hoặc chuyển vào nhóm chờ.' : 'leads moved to the Review tab (previous owner kept). Go there to assign manually or commit to the pool.'}</span>
                : <span style={{ color: '#6b7280' }}>{vi ? 'Không có lead đang mở.' : 'No open leads to recall.'}</span>}
            </div>}
          </div>

          <div style={card}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 .25rem' }}>{vi ? 'Lead chưa phân bổ trong hệ thống' : 'Unassigned leads in the system'}</h2>
            <p style={{ color: '#6b7280', marginTop: 0 }}>{vi ? 'Lead chưa có nhân viên và chưa được xử lý. Chọn văn phòng theo tỉnh rồi gửi sang Xem xét.' : 'Leads with no counsellor that have not been processed yet. Pick an office per province group and send them to Review.'}</p>
            {unassigned.length === 0 ? <p style={{ color: '#6b7280', margin: 0 }}>{vi ? 'Không có lead chưa phân bổ.' : 'No unassigned leads.'}</p> : (
              <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 680 }}>
                <thead><tr><th style={th}>{vi ? 'Tỉnh (residency)' : 'Province (residency)'}</th><th style={{ ...th, textAlign: 'right' }}>{vi ? 'SL' : 'Count'}</th><th style={th}>{vi ? 'Gán văn phòng' : 'Assign office'}</th><th style={th}></th></tr></thead>
                <tbody>
                  {unassigned.map((u) => (
                    <tr key={u.residency}>
                      <td style={td}>{u.residency}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{u.cnt}</td>
                      <td style={td}>
                        <select value={unsel[u.residency] || offices[0]?.code || ''} onChange={(e) => setUnsel((m) => ({ ...m, [u.residency]: e.target.value }))} style={{ ...field, padding: '4px 8px' }}>
                          {offices.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                        </select>
                      </td>
                      <td style={td}>
                        <button onClick={() => handlePoolExisting(u.residency)} disabled={busy} style={btn(false)}>{busy ? '…' : (vi ? 'Gửi sang Xem xét' : 'Send to review')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
