// LeadManagement/src/pages/ReferenceData.jsx
// ─────────────────────────────────────────────────────────────────────
// Replaces the old Referral Sources page. A left-nav reference-data editor
// over /api/reference-data (lookup_values, whitelisted categories):
//   Source of Lead (with mode) · Source ▸ Databases/On-line/Personal
//   referrals · B2B Type · B2B Party ▸ Subagents/Partners/School Outreach
//   · Attendance Status
// Event/Campaign Sources are NOT here — they live on the Marketing Events
// page. Each list: add / edit (pencil) / delete (trash, soft).
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiX, FiCheck } from 'react-icons/fi';
import { useLanguage } from '../contexts/LanguageContext';

const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' };
const lbl        = { display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 };

// mode is structural (drives how the LQ form behaves). Editable but rare.
const MODE_OPTIONS = [
  { value: 'list',          label: 'list — single dropdown' },
  { value: 'events',        label: 'events — from Marketing Events' },
  { value: 'b2b',           label: 'b2b — type + party' },
  { value: 'list_freetext', label: 'list_freetext — dropdown + free text' },
];

// Left-nav catalogue. Each leaf carries the category (+ subcategory) it edits.
const CATALOG = [
  { type: 'item', key: 'source_of_lead', label: 'Source of Lead', labelVi: 'Nguồn khách hàng',
    category: 'source_of_lead', subcategory: null, showMode: true },
  { type: 'group', label: 'Source', labelVi: 'Nguồn', items: [
    { key: 'source:Databases',          label: 'Databases',          labelVi: 'Cơ sở dữ liệu',     category: 'source', subcategory: 'Databases' },
    { key: 'source:On-line',            label: 'On-line',            labelVi: 'Trực tuyến',        category: 'source', subcategory: 'On-line' },
    { key: 'source:Personal referrals', label: 'Personal referrals', labelVi: 'Giới thiệu cá nhân', category: 'source', subcategory: 'Personal referrals' },
  ]},
  { type: 'item', key: 'b2b_type', label: 'B2B Type', labelVi: 'Loại B2B', category: 'b2b_type', subcategory: null },
  { type: 'group', label: 'B2B Party', labelVi: 'Đối tác B2B', items: [
    { key: 'b2b_party:Subagents',       label: 'Subagents',       labelVi: 'Sub-agent',           category: 'b2b_party', subcategory: 'Subagents' },
    { key: 'b2b_party:Partners',        label: 'Partners',        labelVi: 'Đối tác',             category: 'b2b_party', subcategory: 'Partners' },
    { key: 'b2b_party:School Outreach', label: 'School Outreach', labelVi: 'Tiếp cận trường học', category: 'b2b_party', subcategory: 'School Outreach' },
  ]},
  { type: 'item', key: 'attendance_status', label: 'Attendance Status', labelVi: 'Trạng thái tham dự', category: 'attendance_status', subcategory: null },
];

function ListEditor({ node, language }) {
  const showMode = !!node.showMode;
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [code, setCode]       = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelVi, setLabelVi] = useState('');
  const [mode, setMode]       = useState('list');
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ category: node.category });
      if (node.subcategory) qs.set('subcategory', node.subcategory);
      const r = await fetch(`/api/reference-data?${qs.toString()}`, { credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Load failed');
      setRows(j.data || []); setError('');
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [node.key]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setAdding(true);
    try {
      const body = { category: node.category, subcategory: node.subcategory || undefined,
        code: code.trim(), labelEn: labelEn.trim(), labelVi: labelVi.trim() };
      if (showMode) body.mode = mode;
      const r = await fetch('/api/reference-data', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add failed');
      setCode(''); setLabelEn(''); setLabelVi(''); setMode('list'); setError(''); await load();
    } catch (err) {
      setError(err.message || 'Failed to add');
    } finally { setAdding(false); }
  }

  async function handleSave(ev) {
    if (!ev.code || !ev.code.trim()) { setError('Name cannot be empty'); return; }
    try {
      const body = { code: ev.code.trim(), labelEn: (ev.labelEn || '').trim(), labelVi: (ev.labelVi || '').trim() };
      if (showMode) body.mode = ev.mode || '';
      const r = await fetch(`/api/reference-data/${ev.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Update failed');
      setEditing(null); await load();
    } catch (err) {
      setError(err.message || 'Failed to update');
    }
  }

  async function handleDelete(id, label) {
    if (!window.confirm(`Delete "${label}"? Leads that already recorded it keep the value they saved.`)) return;
    try {
      const r = await fetch(`/api/reference-data/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Delete failed');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  }

  const nameLabel = language === 'vi' ? 'Tên (bắt buộc)' : 'Name (required)';

  return (
    <div>
      {error && (
        <div style={{ padding: 10, marginBottom: 16, borderRadius: 6, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleAdd} style={{ background: 'var(--bg-secondary)', padding: 16, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div style={{ gridColumn: 'span 2', minWidth: 200 }}>
            <label style={lbl}>{nameLabel}</label>
            <input value={code} onChange={e => setCode(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Nhãn tiếng Anh' : 'English label'}</label>
            <input value={labelEn} onChange={e => setLabelEn(e.target.value)} placeholder={language === 'vi' ? 'không bắt buộc' : 'optional'} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Nhãn tiếng Việt' : 'Vietnamese label'}</label>
            <input value={labelVi} onChange={e => setLabelVi(e.target.value)} placeholder={language === 'vi' ? 'không bắt buộc' : 'optional'} style={inputStyle} />
          </div>
          {showMode && (
            <div>
              <label style={lbl}>Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)} style={inputStyle}>
                {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
              </select>
            </div>
          )}
          <button type="submit" disabled={adding || !code.trim()}
                  style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
                           cursor: (adding || !code.trim()) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FiPlus size={14} /> {language === 'vi' ? 'Thêm' : 'Add'}
          </button>
        </div>
      </form>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Đang tải...' : 'Loading...'}</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Chưa có mục nào. Thêm ở trên.' : 'Nothing here yet. Add one above.'}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px', width: 40 }}>#</th>
              <th style={{ padding: '8px 4px' }}>{language === 'vi' ? 'Tên' : 'Name'}</th>
              <th style={{ padding: '8px 4px', width: 200 }}>{language === 'vi' ? 'Nhãn tiếng Anh' : 'English label'}</th>
              <th style={{ padding: '8px 4px', width: 200 }}>{language === 'vi' ? 'Nhãn tiếng Việt' : 'Vietnamese label'}</th>
              {showMode && <th style={{ padding: '8px 4px', width: 120 }}>Mode</th>}
              <th style={{ padding: '8px 4px', width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                <td style={{ padding: '10px 4px', fontWeight: 500 }}>{row.code}</td>
                <td style={{ padding: '10px 4px', color: row.labelEn ? 'inherit' : 'var(--text-secondary)' }}>{row.labelEn || '—'}</td>
                <td style={{ padding: '10px 4px', color: row.labelVi ? 'inherit' : 'var(--text-secondary)' }}>{row.labelVi || '—'}</td>
                {showMode && (
                  <td style={{ padding: '10px 4px' }}>
                    <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{row.mode || '—'}</span>
                  </td>
                )}
                <td style={{ padding: '10px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditing({ ...row })} title={language === 'vi' ? 'Sửa' : 'Edit'}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 4, marginRight: 4 }}>
                    <FiEdit2 size={16} />
                  </button>
                  <button onClick={() => handleDelete(row.id, row.code)} title={language === 'vi' ? 'Xóa' : 'Delete'}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                    <FiTrash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
             onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', padding: 24, borderRadius: 8, width: '100%', maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>{language === 'vi' ? 'Sửa' : 'Edit'}</h2>
              <button onClick={() => setEditing(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><FiX size={20} /></button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{language === 'vi' ? 'Tên' : 'Name'}</label>
              <input value={editing.code || ''} onChange={e => setEditing({ ...editing, code: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Nhãn tiếng Anh' : 'English label'}</label>
                <input value={editing.labelEn || ''} onChange={e => setEditing({ ...editing, labelEn: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Nhãn tiếng Việt' : 'Vietnamese label'}</label>
                <input value={editing.labelVi || ''} onChange={e => setEditing({ ...editing, labelVi: e.target.value })} style={inputStyle} />
              </div>
            </div>
            {showMode && (
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Mode</label>
                <select value={editing.mode || 'list'} onChange={e => setEditing({ ...editing, mode: e.target.value })} style={inputStyle}>
                  {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                  {language === 'vi' ? 'Chỉ thay đổi khi bạn hiểu rõ — mode quyết định cách form LQ hoạt động.' : 'Change only if you know what you are doing — mode drives how the LQ form behaves.'}
                </p>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>
                {language === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={() => handleSave(editing)} style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FiCheck size={14} /> {language === 'vi' ? 'Lưu' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReferenceData() {
  const { language } = useLanguage();
  const [activeKey, setActiveKey] = useState('source_of_lead');

  // flatten to find the active node
  const flat = [];
  CATALOG.forEach(n => { if (n.type === 'group') n.items.forEach(i => flat.push(i)); else flat.push(n); });
  const node = flat.find(n => n.key === activeKey) || flat[0];

  const navBtn = (n) => {
    const on = n.key === activeKey;
    return (
      <button key={n.key} onClick={() => setActiveKey(n.key)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                       background: on ? 'var(--primary)' : 'transparent', color: on ? 'white' : 'var(--text-primary, inherit)',
                       fontWeight: on ? 600 : 500, fontSize: '0.9rem', marginBottom: 2 }}>
        {language === 'vi' ? (n.labelVi || n.label) : n.label}
      </button>
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ marginBottom: 8 }}>{language === 'vi' ? 'Dữ liệu tham chiếu' : 'Reference Data'}</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {language === 'vi'
          ? 'Danh sách dùng cho phần Nguồn khách hàng. Nguồn Sự kiện/Chiến dịch được quản lý ở trang Marketing Events.'
          : 'The lists behind the Source of Lead picker. Event/Campaign Sources are managed on the Marketing Events page.'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, alignItems: 'start' }}>
        <nav style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, position: 'sticky', top: 16 }}>
          {CATALOG.map(n => n.type === 'group' ? (
            <div key={n.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', fontWeight: 700, padding: '8px 12px 4px' }}>
                {language === 'vi' ? (n.labelVi || n.label) : n.label}
              </div>
              {n.items.map(navBtn)}
            </div>
          ) : navBtn(n))}
        </nav>

        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>
            {language === 'vi' ? (node.labelVi || node.label) : node.label}
          </h2>
          <ListEditor node={node} language={language} />
        </div>
      </div>
    </div>
  );
}
