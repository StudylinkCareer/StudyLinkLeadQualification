// LeadManagement/src/pages/MarketingEvents.jsx
// ─────────────────────────────────────────────────────────────────────
// Simple staff-facing page to manage marketing events.
// Backed by lookup_values WHERE category='referral_source'.
//
// Features:
//   - List active events in display order (sort_order ASC = earliest to latest)
//   - Add a new event (auto-assigned next sort_order)
//   - Soft-delete an event (sets active = false)
//
// Routes: /marketing-events (mounted in App.jsx)
// API:    /api/marketing-events
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { useLanguage } from '../contexts/LanguageContext';

export default function MarketingEvents() {
  const { language } = useLanguage();
  const [events, setEvents]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState('');
  const [code,    setCode]        = useState('');
  const [labelEn, setLabelEn]     = useState('');
  const [labelVi, setLabelVi]     = useState('');
  const [adding,  setAdding]      = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/marketing-events', { credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Load failed');
      setEvents(j.data || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setAdding(true);
    try {
      const r = await fetch('/api/marketing-events', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), labelEn: labelEn.trim(), labelVi: labelVi.trim() }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add failed');
      setCode(''); setLabelEn(''); setLabelVi('');
      setError('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to add event');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id, codeLabel) {
    if (!confirm(`Delete "${codeLabel}"? Existing leads with this event keep their assignment.`)) return;
    try {
      const r = await fetch(`/api/marketing-events/${id}`, {
        method: 'DELETE', credentials: 'include',
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Delete failed');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete event');
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ marginBottom: 8 }}>
        {language === 'vi' ? 'Sự kiện Marketing' : 'Marketing Events'}
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {language === 'vi'
          ? 'Danh sách các sự kiện hiển thị trong dropdown "Nguồn giới thiệu" trên trang đăng ký của học sinh. Sắp xếp theo thứ tự sớm nhất đến muộn nhất.'
          : 'These events appear in the "Referral Source" dropdown on the student intake form. Ordered earliest to latest.'}
      </p>

      {error && (
        <div style={{
          padding: 10, marginBottom: 16, borderRadius: 6,
          background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca',
        }}>
          {error}
        </div>
      )}

      {/* ── Add form ────────────────────────────────────────── */}
      <form onSubmit={handleAdd} style={{
        background: 'var(--bg-secondary)', padding: 16, borderRadius: 8, marginBottom: 24,
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end',
      }}>
        <div>
          <label style={{ display:'block', fontSize:'0.8rem', fontWeight:600, marginBottom:4 }}>
            {language === 'vi' ? 'Tên sự kiện (bắt buộc)' : 'Event name (required)'}
          </label>
          <input value={code} onChange={e => setCode(e.target.value)}
                 placeholder={language === 'vi' ? 'VD: Hội chợ du học T6' : 'e.g. June Study Abroad Fair'}
                 style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }} />
        </div>
        <div>
          <label style={{ display:'block', fontSize:'0.8rem', fontWeight:600, marginBottom:4 }}>
            English label (optional)
          </label>
          <input value={labelEn} onChange={e => setLabelEn(e.target.value)}
                 placeholder="Defaults to event name"
                 style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }} />
        </div>
        <div>
          <label style={{ display:'block', fontSize:'0.8rem', fontWeight:600, marginBottom:4 }}>
            Nhãn tiếng Việt (tùy chọn)
          </label>
          <input value={labelVi} onChange={e => setLabelVi(e.target.value)}
                 placeholder="Mặc định là tên sự kiện"
                 style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }} />
        </div>
        <button type="submit" disabled={adding || !code.trim()}
                style={{
                  padding: '8px 16px', borderRadius: 4, border: 'none',
                  background: 'var(--primary)', color: 'white', fontWeight: 600,
                  cursor: adding || !code.trim() ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
          <FiPlus size={14}/> {language === 'vi' ? 'Thêm' : 'Add'}
        </button>
      </form>

      {/* ── List ─────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          {language === 'vi' ? 'Đang tải...' : 'Loading...'}
        </div>
      ) : events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          {language === 'vi' ? 'Chưa có sự kiện nào.' : 'No events yet. Add one above.'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px', width: 50 }}>#</th>
              <th style={{ padding: '8px 4px' }}>
                {language === 'vi' ? 'Tên sự kiện' : 'Event Name'}
              </th>
              <th style={{ padding: '8px 4px' }}>English label</th>
              <th style={{ padding: '8px 4px' }}>Nhãn tiếng Việt</th>
              <th style={{ padding: '8px 4px', width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, idx) => (
              <tr key={ev.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                <td style={{ padding: '10px 4px', fontWeight: 500 }}>{ev.code}</td>
                <td style={{ padding: '10px 4px', color: ev.labelEn ? 'inherit' : 'var(--text-secondary)' }}>
                  {ev.labelEn || <em>(defaults to event name)</em>}
                </td>
                <td style={{ padding: '10px 4px', color: ev.labelVi ? 'inherit' : 'var(--text-secondary)' }}>
                  {ev.labelVi || <em>(mặc định)</em>}
                </td>
                <td style={{ padding: '10px 4px', textAlign: 'right' }}>
                  <button onClick={() => handleDelete(ev.id, ev.code)}
                          title={language === 'vi' ? 'Xóa' : 'Delete'}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: '#dc2626', padding: 4, borderRadius: 4,
                          }}>
                    <FiTrash2 size={16}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
