// LeadManagement/src/pages/MarketingEvents.jsx
// ─────────────────────────────────────────────────────────────────────
// Manage marketing events:
//   - Add (top form)
//   - Edit (modal — pencil icon per row)
//   - Delete (trash icon per row, soft delete)
//   - "Hide from list" checkbox per row — controls visibility on the LQ
//     student-facing dropdown.
//
// VISIBILITY MODEL (computed server-side, mirrored here for UI):
//   The checkbox is ALWAYS interactive. Each click toggles the visibility
//   for TODAY ONLY.
//   - Auto-active event + click  → manualHideDate = today (force-hide today)
//   - Auto-hidden event + click  → manualShowDate = today (force-show today)
//   - Re-clicking when an override is active for today clears that override
//     (revert to auto behaviour).
//   - Both overrides are single-day. Tomorrow they expire automatically.
//   - User may re-set as often as required.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiX, FiCheck } from 'react-icons/fi';
import { useLanguage } from '../contexts/LanguageContext';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function MarketingEvents() {
  const { language } = useLanguage();
  const [events, setEvents]    = useState([]);
  const [loading, setLoading]  = useState(true);
  const [error,   setError]    = useState('');

  // ── Add form state ──
  const [code, setCode]            = useState('');
  const [labelEn, setLabelEn]      = useState('');
  const [labelVi, setLabelVi]      = useState('');
  const [startDate, setStartDate]  = useState('');
  const [endDate, setEndDate]      = useState('');
  const [adding, setAdding]        = useState(false);

  const [editing, setEditing]    = useState(null);
  const [togglingId, setTogglingId] = useState(null);

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
        body: JSON.stringify({
          code: code.trim(), labelEn: labelEn.trim(), labelVi: labelVi.trim(),
          startDate, endDate,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add failed');
      setCode(''); setLabelEn(''); setLabelVi(''); setStartDate(''); setEndDate('');
      setError('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to add event');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id, codeLabel) {
    if (!window.confirm(`Delete "${codeLabel}"? Existing leads with this event keep their assignment.`)) return;
    try {
      const r = await fetch(`/api/marketing-events/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Delete failed');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete event');
    }
  }

  async function handleSaveEdit(ev) {
    try {
      const r = await fetch(`/api/marketing-events/${ev.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labelEn:   ev.labelEn   || '',
          labelVi:   ev.labelVi   || '',
          startDate: ev.startDate || '',
          endDate:   ev.endDate   || '',
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Update failed');
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to update event');
    }
  }

  /**
   * Toggle the visibility override for a single event. Always togglable.
   *
   *                          Current state          → Action sent to server
   * ─────────────────────────────────────────────────────────────────────────
   * Auto-active, no override (hidden=false)         → set manualHideDate=today
   * Showing via manualShowDate=today (hidden=false) → clear manualShowDate (revert to auto-hidden)
   * Auto-hidden, no override (hidden=true)          → set manualShowDate=today
   * Hidden via manualHideDate=today (hidden=true)   → clear manualHideDate (revert to auto-active)
   *
   * In all cases we explicitly clear the OPPOSITE override too so we never
   * end up with both set on the same row.
   */
  async function handleToggleHidden(ev) {
    const today = todayISO();
    let payload;

    if (ev.hidden) {
      // Currently hidden. If hidden by a today-override, just clear it.
      if (ev.manualHideDate === today) {
        payload = { manualHideDate: '', manualShowDate: '' };
      } else {
        // Auto-hidden → force-show today.
        payload = { manualShowDate: today, manualHideDate: '' };
      }
    } else {
      // Currently visible. If visible by today-override, just clear it.
      if (ev.manualShowDate === today) {
        payload = { manualShowDate: '', manualHideDate: '' };
      } else {
        // Auto-active → force-hide today.
        payload = { manualHideDate: today, manualShowDate: '' };
      }
    }

    setTogglingId(ev.id);
    try {
      const r = await fetch(`/api/marketing-events/${ev.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Toggle failed');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to toggle visibility');
    } finally {
      setTogglingId(null);
    }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' };
  const lbl        = { display:'block', fontSize:'0.8rem', fontWeight:600, marginBottom:4 };

  const today = todayISO();

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ marginBottom: 8 }}>
        {language === 'vi' ? 'Sự kiện Marketing' : 'Marketing Events'}
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {language === 'vi'
          ? 'Danh sách các sự kiện hiển thị trong dropdown "Chiến dịch/Sự kiện" trên trang đăng ký của học sinh. Sắp xếp từ mới nhất đến cũ nhất.'
          : 'These events appear in the "Campaign/Event" dropdown on the student intake form. Ordered newest to oldest.'}
      </p>

      {error && (
        <div style={{
          padding: 10, marginBottom: 16, borderRadius: 6,
          background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca',
        }}>{error}</div>
      )}

      {/* ── Add form ────────────────────────────────────────── */}
      <form onSubmit={handleAdd} style={{
        background: 'var(--bg-secondary)', padding: 16, borderRadius: 8, marginBottom: 24,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1.5fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Tên sự kiện (bắt buộc)' : 'Event name (required)'}</label>
            <input value={code} onChange={e => setCode(e.target.value)}
                   placeholder={language === 'vi' ? 'VD: Hội chợ T6' : 'e.g. June Fair'} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>English label (optional)</label>
            <input value={labelEn} onChange={e => setLabelEn(e.target.value)}
                   placeholder="Defaults to event name" style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Nhãn tiếng Việt (tùy chọn)</label>
            <input value={labelVi} onChange={e => setLabelVi(e.target.value)}
                   placeholder="Mặc định là tên sự kiện" style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Bắt đầu' : 'Start date'}</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Kết thúc' : 'End date'}</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
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
        </div>
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
              <th style={{ padding: '8px 4px', width: 40 }}>#</th>
              <th style={{ padding: '8px 4px' }}>{language === 'vi' ? 'Tên sự kiện' : 'Event Name'}</th>
              <th style={{ padding: '8px 4px' }}>English label</th>
              <th style={{ padding: '8px 4px' }}>Nhãn tiếng Việt</th>
              <th style={{ padding: '8px 4px', width: 110 }}>{language === 'vi' ? 'Bắt đầu' : 'Start'}</th>
              <th style={{ padding: '8px 4px', width: 110 }}>{language === 'vi' ? 'Kết thúc' : 'End'}</th>
              <th style={{ padding: '8px 4px', width: 120, textAlign: 'center' }}>
                {language === 'vi' ? 'Ẩn khỏi danh sách' : 'Hide from list'}
              </th>
              <th style={{ padding: '8px 4px', width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, idx) => {
              const showOverrideToday = ev.manualShowDate === today;
              const hideOverrideToday = ev.manualHideDate === today;
              const overridden        = showOverrideToday || hideOverrideToday;
              const saving            = togglingId === ev.id;
              return (
                <tr key={ev.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                  <td style={{ padding: '10px 4px', fontWeight: 500 }}>{ev.code}</td>
                  <td style={{ padding: '10px 4px', color: ev.labelEn ? 'inherit' : 'var(--text-secondary)' }}>
                    {ev.labelEn || <em>(defaults to event name)</em>}
                  </td>
                  <td style={{ padding: '10px 4px', color: ev.labelVi ? 'inherit' : 'var(--text-secondary)' }}>
                    {ev.labelVi || <em>(mặc định)</em>}
                  </td>
                  <td style={{ padding: '10px 4px', color: ev.startDate ? 'inherit' : 'var(--text-secondary)' }}>
                    {ev.startDate || '—'}
                  </td>
                  <td style={{ padding: '10px 4px', color: ev.endDate ? 'inherit' : 'var(--text-secondary)' }}>
                    {ev.endDate || '—'}
                  </td>
                  <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                    <label
                      title={
                        saving
                          ? (language === 'vi' ? 'Đang lưu…' : 'Saving…')
                          : ev.hidden
                            ? (hideOverrideToday
                                ? (language === 'vi' ? 'Đã ẩn hôm nay. Bấm để khôi phục.' : 'Hidden today (override). Click to revert.')
                                : (language === 'vi' ? 'Tự động ẩn. Bấm để hiển thị hôm nay.' : 'Auto-hidden. Click to show for today.'))
                            : (showOverrideToday
                                ? (language === 'vi' ? 'Hiển thị hôm nay (ghi đè). Bấm để khôi phục.' : 'Showing today (override). Click to revert.')
                                : (language === 'vi' ? 'Đang hoạt động. Bấm để ẩn hôm nay.' : 'Auto-active. Click to hide for today.'))
                      }
                      style={{ display:'inline-flex', alignItems:'center', cursor: saving ? 'wait' : 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={ev.hidden}
                        disabled={saving}
                        onChange={() => handleToggleHidden(ev)}
                        style={{ width:18, height:18, cursor: saving ? 'wait' : 'pointer' }}
                      />
                    </label>
                    {overridden && (
                      <div style={{ fontSize:'0.7rem', color:'#2563eb', marginTop:2 }}>
                        {language === 'vi' ? 'hôm nay' : 'today only'}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing({ ...ev })}
                            title={language === 'vi' ? 'Sửa' : 'Edit'}
                            style={{ background:'transparent', border:'none', cursor:'pointer', color:'#2563eb', padding:4, marginRight:4 }}>
                      <FiEdit2 size={16}/>
                    </button>
                    <button onClick={() => handleDelete(ev.id, ev.code)}
                            title={language === 'vi' ? 'Xóa' : 'Delete'}
                            style={{ background:'transparent', border:'none', cursor:'pointer', color:'#dc2626', padding:4 }}>
                      <FiTrash2 size={16}/>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ── Edit modal ─────────────────────────────────────── */}
      {editing && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.4)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:100,
        }} onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background:'white', padding:24, borderRadius:8, width:'100%', maxWidth:500,
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <h2 style={{ margin:0 }}>{language === 'vi' ? 'Sửa sự kiện' : 'Edit event'}</h2>
              <button onClick={() => setEditing(null)} style={{ background:'transparent', border:'none', cursor:'pointer' }}>
                <FiX size={20}/>
              </button>
            </div>

            <div style={{ marginBottom:12 }}>
              <label style={lbl}>{language === 'vi' ? 'Tên sự kiện' : 'Event name'}</label>
              <input value={editing.code} disabled style={{ ...inputStyle, background:'#f3f4f6', color:'#6b7280' }} />
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:4 }}>
                {language === 'vi'
                  ? 'Tên không thể thay đổi vì các leads đã chọn sự kiện này đang sử dụng tên đó.'
                  : 'Name is fixed — existing leads reference it. Delete + re-add to rename.'}
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={lbl}>English label</label>
              <input value={editing.labelEn || ''} onChange={e => setEditing({...editing, labelEn: e.target.value})}
                     style={inputStyle} />
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={lbl}>Nhãn tiếng Việt</label>
              <input value={editing.labelVi || ''} onChange={e => setEditing({...editing, labelVi: e.target.value})}
                     style={inputStyle} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Bắt đầu' : 'Start date'}</label>
                <input type="date" value={editing.startDate || ''}
                       onChange={e => setEditing({...editing, startDate: e.target.value})} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Kết thúc' : 'End date'}</label>
                <input type="date" value={editing.endDate || ''}
                       onChange={e => setEditing({...editing, endDate: e.target.value})} style={inputStyle} />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button onClick={() => setEditing(null)} style={{
                padding:'8px 16px', borderRadius:4, border:'1px solid var(--border)',
                background:'white', cursor:'pointer',
              }}>
                {language === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={() => handleSaveEdit(editing)} style={{
                padding:'8px 16px', borderRadius:4, border:'none',
                background:'var(--primary)', color:'white', fontWeight:600, cursor:'pointer',
                display:'inline-flex', alignItems:'center', gap:6,
              }}>
                <FiCheck size={14}/> {language === 'vi' ? 'Lưu' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
