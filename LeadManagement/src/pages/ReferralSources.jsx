// LeadManagement/src/pages/ReferralSources.jsx
// ─────────────────────────────────────────────────────────────────────
// Two-tab admin for the referral lists used in lead attribution:
//   Sub-agents  → /api/referral-sources/subagents
//   Partners    → /api/referral-sources/partners
// Both share the same shape: name, type, phone, email, notes. Add / edit
// (pencil) / delete (trash, soft). Type is free text — marketing finalises.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiX, FiCheck } from 'react-icons/fi';
import { useLanguage } from '../contexts/LanguageContext';

const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' };
const lbl        = { display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 };

function RefList({ resource, typeHint, language }) {
  const base = `/api/referral-sources/${resource}`;
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [name, setName]   = useState('');
  const [type, setType]   = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(base, { credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Load failed');
      setRows(j.data || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [resource]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(base, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, phone, email, notes }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add failed');
      setName(''); setType(''); setPhone(''); setEmail(''); setNotes('');
      setError(''); await load();
    } catch (err) {
      setError(err.message || 'Failed to add');
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(ev) {
    if (!ev.name || !ev.name.trim()) { setError('Name cannot be empty'); return; }
    try {
      const r = await fetch(`${base}/${ev.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ev.name.trim(), type: ev.type || '', phone: ev.phone || '',
          email: ev.email || '', notes: ev.notes || '',
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Update failed');
      setEditing(null); await load();
    } catch (err) {
      setError(err.message || 'Failed to update');
    }
  }

  async function handleDelete(id, label) {
    if (!window.confirm(`Delete "${label}"? Leads that reference it keep the name they recorded.`)) return;
    try {
      const r = await fetch(`${base}/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Delete failed');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  }

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
            <label style={lbl}>{language === 'vi' ? 'Tên (bắt buộc)' : 'Name (required)'}</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Loại' : 'Type'}</label>
            <input value={type} onChange={e => setType(e.target.value)} placeholder={typeHint} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Điện thoại' : 'Phone'}</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ gridColumn: 'span 2', minWidth: 200 }}>
            <label style={lbl}>{language === 'vi' ? 'Ghi chú' : 'Notes'}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle} />
          </div>
          <button type="submit" disabled={adding || !name.trim()}
                  style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
                           cursor: (adding || !name.trim()) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FiPlus size={14} /> {language === 'vi' ? 'Thêm' : 'Add'}
          </button>
        </div>
      </form>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          {language === 'vi' ? 'Đang tải...' : 'Loading...'}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          {language === 'vi' ? 'Chưa có mục nào.' : 'Nothing here yet. Add one above.'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px', width: 40 }}>#</th>
              <th style={{ padding: '8px 4px' }}>{language === 'vi' ? 'Tên' : 'Name'}</th>
              <th style={{ padding: '8px 4px', width: 200 }}>{language === 'vi' ? 'Loại' : 'Type'}</th>
              <th style={{ padding: '8px 4px', width: 140 }}>{language === 'vi' ? 'Điện thoại' : 'Phone'}</th>
              <th style={{ padding: '8px 4px', width: 200 }}>Email</th>
              <th style={{ padding: '8px 4px', width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                <td style={{ padding: '10px 4px', fontWeight: 500 }}>{row.name}</td>
                <td style={{ padding: '10px 4px', color: row.type ? 'inherit' : 'var(--text-secondary)' }}>{row.type || '—'}</td>
                <td style={{ padding: '10px 4px', color: row.phone ? 'inherit' : 'var(--text-secondary)' }}>{row.phone || '—'}</td>
                <td style={{ padding: '10px 4px', color: row.email ? 'inherit' : 'var(--text-secondary)' }}>{row.email || '—'}</td>
                <td style={{ padding: '10px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditing({ ...row })} title={language === 'vi' ? 'Sửa' : 'Edit'}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 4, marginRight: 4 }}>
                    <FiEdit2 size={16} />
                  </button>
                  <button onClick={() => handleDelete(row.id, row.name)} title={language === 'vi' ? 'Xóa' : 'Delete'}
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
              <button onClick={() => setEditing(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <FiX size={20} />
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{language === 'vi' ? 'Tên' : 'Name'}</label>
              <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Loại' : 'Type'}</label>
                <input value={editing.type || ''} onChange={e => setEditing({ ...editing, type: e.target.value })} placeholder={typeHint} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Điện thoại' : 'Phone'}</label>
                <input value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Email</label>
              <input value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>{language === 'vi' ? 'Ghi chú' : 'Notes'}</label>
              <input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} style={inputStyle} />
            </div>
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

export default function ReferralSources() {
  const { language } = useLanguage();
  const [tab, setTab] = useState('subagents');

  const tabBtn = (key, label) => (
    <button onClick={() => setTab(key)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', fontWeight: 600,
              background: 'transparent', color: tab === key ? 'var(--primary)' : 'var(--text-secondary)',
              borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
            }}>
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ marginBottom: 8 }}>{language === 'vi' ? 'Nguồn giới thiệu' : 'Referral Sources'}</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
        {language === 'vi'
          ? 'Danh sách sub-agent và đối tác dùng khi ghi nhận nguồn giới thiệu của khách hàng.'
          : 'The sub-agent and partner lists used when recording how a lead was referred.'}
      </p>

      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 24, display: 'flex', gap: 8 }}>
        {tabBtn('subagents', language === 'vi' ? 'Sub-agent' : 'Sub-agents')}
        {tabBtn('partners',  language === 'vi' ? 'Đối tác' : 'Partners')}
      </div>

      {tab === 'subagents'
        ? <RefList resource="subagents" language={language} typeHint="e.g. Agency" />
        : <RefList resource="partners"  language={language} typeHint="e.g. Banking, Language school" />}
    </div>
  );
}
