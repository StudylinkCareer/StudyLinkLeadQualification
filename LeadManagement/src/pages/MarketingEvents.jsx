// LeadManagement/src/pages/MarketingEvents.jsx
// ─────────────────────────────────────────────────────────────────────
// Events admin (manages the `events` table) — FLAT format:
//   Event Type (marketing-editable dropdown, add new inline) + Event name,
//   optional English/Vietnamese labels, optional Dedicated counsellor,
//   Start / End dates, and a per-row "Hide from list" single-day override.
//   - Add (top form) · Edit (pencil modal) · Delete (trash, soft)
//   The dedicated counsellor feeds the event QR (R2b) and pre-tags single-
//   counsellor events on the LQ form.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiX, FiCheck, FiDownload } from 'react-icons/fi';
import QRCodeStyling from 'qr-code-styling';
import { useLanguage } from '../contexts/LanguageContext';

// Event QR. Put studylinklogo.png in LeadManagement/public/. The colours below
// drive the QR modules, the finder corners, and the frame + banner — tweak freely.
const LOGO_URL    = '/studylinklogo.png';
const DOT_COLOR   = '#1a1a1a';   // QR module (square) colour
const ACCENT      = '#c8102e';   // frame, banner, finder corners (StudyLink red)
const BANNER_TEXT = 'SCAN ME';

function todayISO() { return new Date().toISOString().slice(0, 10); }

const ADD_SENTINEL = '__add_new_type__';

export default function MarketingEvents() {
  const { language } = useLanguage();
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // ── Event Type list (flat, marketing-editable) ──
  const [eventTypes, setEventTypes] = useState([]);     // [{ code, labelEn, labelVi }]
  const [type, setType]             = useState('');
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType]       = useState('');
  const typeCodes = eventTypes.map(t => t.code);

  // ── Add-form state ──
  const [name, setName]             = useState('');
  const [labelEn, setLabelEn]       = useState('');
  const [labelVi, setLabelVi]       = useState('');
  const [counsellor, setCounsellor] = useState('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [adding, setAdding]         = useState(false);

  const [editing, setEditing]       = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  // ── Event QR (framed deep-link to the LQ form, SL logo centre) ──
  const [qrEvent, setQrEvent]     = useState(null);
  const [framedUrl, setFramedUrl] = useState('');   // composited PNG data URL
  const LQ_BASE = (((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LQ_BASE_URL) || '')).replace(/\/+$/, '');

  function buildEventUrl(ev) {
    const p = new URLSearchParams();
    p.set('sol', 'Event/Campaign');
    if (ev.eventType) p.set('etype', ev.eventType);
    if (ev.name) p.set('ename', ev.name);
    if (ev.id) p.set('eid', String(ev.id));
    if (ev.startDate) p.set('estart', ev.startDate);
    if (ev.endDate) p.set('eend', ev.endDate);
    if (ev.dedicatedCounsellor) p.set('counsellor', ev.dedicatedCounsellor);
    return `${LQ_BASE || ''}/?${p.toString()}`;
  }
  function qrOptions(ev, withImage) {
    const opts = {
      width: 600, height: 600, type: 'canvas', margin: 0,
      data: buildEventUrl(ev),
      qrOptions: { errorCorrectionLevel: 'H' },   // high EC so the centre logo doesn't break scanning
      dotsOptions:          { color: DOT_COLOR, type: 'rounded' },
      cornersSquareOptions: { color: ACCENT, type: 'extra-rounded' },
      cornersDotOptions:    { color: ACCENT },
      backgroundOptions:    { color: '#ffffff' },
    };
    if (withImage) {
      opts.image = LOGO_URL;
      opts.imageOptions = { crossOrigin: 'anonymous', margin: 8, imageSize: 0.25, hideBackgroundDots: true };
    }
    return opts;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }
  function loadOk(src) {
    return new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(true); im.onerror = () => resolve(false); im.src = src; });
  }
  function blobToImage(blob) {
    return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = URL.createObjectURL(blob); });
  }

  // Build the framed QR (banner + red frame + styled QR + centre logo) as one PNG.
  async function renderFramed(ev) {
    setFramedUrl('');
    try {
      const withImage = await loadOk(LOGO_URL);
      const qr = new QRCodeStyling(qrOptions(ev, withImage));
      const blob = await qr.getRawData('png');
      if (!blob) throw new Error('QR generation failed');
      const qrImg = await blobToImage(blob);

      // layout (logical px; canvas rendered at 2× for a crisp download)
      const S = 2, QR = 300, PAD = 22, BORDER = 16, RADIUS = 28;
      const BANNER_W = 150, BANNER_H = 50, TAIL = 12;
      const innerTop = BANNER_H * 0.55;
      const W = QR + PAD * 2 + BORDER * 2;

      // ── event caption lines (drawn inside the frame, under the QR) ──
      const meas = document.createElement('canvas').getContext('2d');
      const NAME_FONT = '700 18px Arial, Helvetica, sans-serif';
      const META_FONT = '400 14px Arial, Helvetica, sans-serif';
      const wrapName = (text, maxW) => {
        meas.font = NAME_FONT;
        const words = String(text || '').trim().split(' ').filter(Boolean);
        const lines = []; let cur = '';
        for (const w of words) {
          const tline = cur ? cur + ' ' + w : w;
          if (meas.measureText(tline).width <= maxW || !cur) cur = tline;
          else { lines.push(cur); cur = w; }
        }
        if (cur) lines.push(cur);
        return lines.slice(0, 2);
      };
      const nameLines = wrapName(ev.name, QR);
      const dateStr  = (ev.startDate && ev.endDate) ? `${ev.startDate} – ${ev.endDate}`
                     : (ev.startDate || ev.endDate || '');
      const counsStr = ev.dedicatedCounsellor
                     ? `${language === 'vi' ? 'Tư vấn viên' : 'Counsellor'}: ${ev.dedicatedCounsellor}` : '';
      const NAME_LH = 23, META_LH = 19, TEXT_GAP = 16;
      let textH = (nameLines.length ? TEXT_GAP + nameLines.length * NAME_LH : 0);
      if (dateStr)  textH += META_LH;
      if (counsStr) textH += META_LH;

      const H = innerTop + QR + textH + PAD * 2 + BORDER * 2;

      const canvas = document.createElement('canvas');
      canvas.width = W * S; canvas.height = H * S;
      const ctx = canvas.getContext('2d');
      ctx.scale(S, S);

      // frame: white fill + thick red rounded border
      const fx = BORDER / 2, fy = innerTop + BORDER / 2, fw = W - BORDER, fh = H - innerTop - BORDER;
      ctx.fillStyle = '#ffffff'; roundRectPath(ctx, fx, fy, fw, fh, RADIUS); ctx.fill();
      ctx.lineWidth = BORDER; ctx.strokeStyle = ACCENT; roundRectPath(ctx, fx, fy, fw, fh, RADIUS); ctx.stroke();

      // QR near the top of the frame; caption below it
      const qx = (W - QR) / 2, qy = fy + PAD;
      ctx.drawImage(qrImg, qx, qy, QR, QR);

      // caption: event name (bold), dates, counsellor
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let ty = qy + QR + TEXT_GAP;
      ctx.fillStyle = '#1a1a1a'; ctx.font = NAME_FONT;
      for (const ln of nameLines) { ctx.fillText(ln, W / 2, ty); ty += NAME_LH; }
      ctx.fillStyle = '#555555'; ctx.font = META_FONT;
      if (dateStr)  { ctx.fillText(dateStr,  W / 2, ty); ty += META_LH; }
      if (counsStr) { ctx.fillText(counsStr, W / 2, ty); ty += META_LH; }

      // banner pill + tail, centred at top
      const bx = (W - BANNER_W) / 2;
      ctx.fillStyle = ACCENT; roundRectPath(ctx, bx, 0, BANNER_W, BANNER_H, 14); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W / 2 - 12, BANNER_H - 2); ctx.lineTo(W / 2 + 12, BANNER_H - 2); ctx.lineTo(W / 2, BANNER_H + TAIL);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = '700 22px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(BANNER_TEXT, W / 2, BANNER_H / 2 + 1);

      setFramedUrl(canvas.toDataURL('image/png'));
    } catch (err) {
      setError(err.message || 'Failed to build QR');
    }
  }
  useEffect(() => { if (qrEvent) renderFramed(qrEvent); /* eslint-disable-next-line */ }, [qrEvent]);

  function openQr(ev) { setQrEvent(ev); }
  function downloadQr(ev) {
    if (!framedUrl) return;
    const safe = (ev.name || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const a = document.createElement('a');
    a.href = framedUrl; a.download = `event-qr-${safe}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/marketing-events', { credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Load failed');
      setEvents(j.data || []); setError('');
    } catch (e) {
      setError(e.message || 'Failed to load events');
    } finally { setLoading(false); }
  }
  async function loadTypes() {
    try {
      const r = await fetch('/api/marketing-events/event-types', { credentials: 'include' });
      const j = await r.json();
      if (j.success && Array.isArray(j.data)) {
        setEventTypes(j.data);
        setType(prev => prev || (j.data[0]?.code || ''));
      }
    } catch { /* types optional — select renders empty until seeded */ }
  }
  useEffect(() => { load(); loadTypes(); }, []);

  async function handleAddType() {
    const code = newType.trim();
    if (!code) return;
    try {
      const r = await fetch('/api/marketing-events/event-types', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add type failed');
      await loadTypes();
      setType(code); setNewType(''); setAddingType(false); setError('');
    } catch (err) {
      setError(err.message || 'Failed to add type');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!type || !name.trim()) return;
    setAdding(true);
    try {
      const r = await fetch('/api/marketing-events', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: type, name: name.trim(),
          labelEn: labelEn.trim(), labelVi: labelVi.trim(),
          dedicatedCounsellor: counsellor.trim(), startDate, endDate,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Add failed');
      setName(''); setLabelEn(''); setLabelVi(''); setCounsellor(''); setStartDate(''); setEndDate('');
      setError(''); await load();
    } catch (err) {
      setError(err.message || 'Failed to add event');
    } finally { setAdding(false); }
  }

  async function handleDelete(id, label) {
    if (!window.confirm(`Delete "${label}"? Leads already linked to this event keep their link.`)) return;
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
    if (!ev.name || !ev.name.trim()) { setError('Event name cannot be empty'); return; }
    try {
      const r = await fetch(`/api/marketing-events/${ev.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: ev.eventType || '', name: ev.name.trim(),
          labelEn: ev.labelEn || '', labelVi: ev.labelVi || '',
          dedicatedCounsellor: ev.dedicatedCounsellor || '',
          startDate: ev.startDate || '', endDate: ev.endDate || '',
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Update failed');
      setEditing(null); await load();
    } catch (err) {
      setError(err.message || 'Failed to update event');
    }
  }

  // Toggle the single-day visibility override.
  async function handleToggleHidden(ev) {
    const today = todayISO();
    let payload;
    if (ev.hidden) {
      payload = (ev.manualHideDate === today)
        ? { manualHideDate: '', manualShowDate: '' }
        : { manualShowDate: today, manualHideDate: '' };
    } else {
      payload = (ev.manualShowDate === today)
        ? { manualShowDate: '', manualHideDate: '' }
        : { manualHideDate: today, manualShowDate: '' };
    }
    setTogglingId(ev.id);
    try {
      const r = await fetch(`/api/marketing-events/${ev.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Toggle failed');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to toggle visibility');
    } finally { setTogglingId(null); }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' };
  const lbl        = { display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 };
  const today = todayISO();

  // shared Event Type picker (select + inline add)
  const typePicker = (value, onPick, allowAdd) => (
    addingType && allowAdd ? (
      <div style={{ display: 'flex', gap: 6 }}>
        <input autoFocus value={newType} onChange={e => setNewType(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddType(); } }}
               placeholder={language === 'vi' ? 'Loại mới' : 'New type'} style={inputStyle} />
        <button type="button" onClick={handleAddType} title={language === 'vi' ? 'Lưu' : 'Save'}
                style={{ padding: '0 10px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer' }}>
          <FiCheck size={14} />
        </button>
        <button type="button" onClick={() => { setAddingType(false); setNewType(''); }} title={language === 'vi' ? 'Hủy' : 'Cancel'}
                style={{ padding: '0 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>
          <FiX size={14} />
        </button>
      </div>
    ) : (
      <select value={value} onChange={e => {
                if (e.target.value === ADD_SENTINEL) { setAddingType(true); setNewType(''); }
                else onPick(e.target.value);
              }} style={inputStyle}>
        {!value && <option value="">—</option>}
        {typeCodes.map(t => <option key={t} value={t}>{t}</option>)}
        {allowAdd && <option value={ADD_SENTINEL}>➕ {language === 'vi' ? 'Thêm loại mới…' : 'Add new type…'}</option>}
      </select>
    )
  );

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ marginBottom: 8 }}>{language === 'vi' ? 'Sự kiện' : 'Events'}</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        {language === 'vi'
          ? 'Sự kiện theo Loại sự kiện. Sự kiện đang hiển thị sẽ xuất hiện trong dropdown trên trang đăng ký của học sinh.'
          : 'Events grouped by Event Type. Visible events appear in the event dropdown on the student intake form.'}
      </p>

      {error && (
        <div style={{ padding: 10, marginBottom: 16, borderRadius: 6, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>{error}</div>
      )}

      {/* ── Add form ────────────────────────────────────────── */}
      <form onSubmit={handleAdd} style={{ background: 'var(--bg-secondary)', padding: 16, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Loại sự kiện' : 'Event Type'}</label>
            {typePicker(type, setType, true)}
          </div>
          <div style={{ gridColumn: 'span 2', minWidth: 220 }}>
            <label style={lbl}>{language === 'vi' ? 'Tên sự kiện (bắt buộc)' : 'Event name (required)'}</label>
            <input value={name} onChange={e => setName(e.target.value)}
                   placeholder={language === 'vi' ? 'VD: Le Quy Don - Họp phụ huynh' : 'e.g. Le Quy Don – Parent Meeting'} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Nhãn tiếng Anh' : 'English label'}</label>
            <input value={labelEn} onChange={e => setLabelEn(e.target.value)} placeholder={language === 'vi' ? 'không bắt buộc' : 'optional'} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Nhãn tiếng Việt' : 'Vietnamese label'}</label>
            <input value={labelVi} onChange={e => setLabelVi(e.target.value)} placeholder={language === 'vi' ? 'không bắt buộc' : 'optional'} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Tư vấn viên phụ trách' : 'Dedicated counsellor'}</label>
            <input value={counsellor} onChange={e => setCounsellor(e.target.value)} placeholder={language === 'vi' ? 'không bắt buộc' : 'optional'} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Bắt đầu' : 'Start date'}</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>{language === 'vi' ? 'Kết thúc' : 'End date'}</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
          <button type="submit" disabled={adding || !type || !name.trim()}
                  style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
                           cursor: (adding || !type || !name.trim()) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FiPlus size={14} /> {language === 'vi' ? 'Thêm' : 'Add'}
          </button>
        </div>
      </form>

      {/* ── List ─────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Đang tải...' : 'Loading...'}</div>
      ) : events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Chưa có sự kiện nào.' : 'No events yet. Add one above.'}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px', width: 40 }}>#</th>
              <th style={{ padding: '8px 4px', width: 160 }}>{language === 'vi' ? 'Loại sự kiện' : 'Event Type'}</th>
              <th style={{ padding: '8px 4px' }}>{language === 'vi' ? 'Sự kiện' : 'Event'}</th>
              <th style={{ padding: '8px 4px', width: 140 }}>{language === 'vi' ? 'Tư vấn viên' : 'Counsellor'}</th>
              <th style={{ padding: '8px 4px', width: 110 }}>{language === 'vi' ? 'Bắt đầu' : 'Start'}</th>
              <th style={{ padding: '8px 4px', width: 110 }}>{language === 'vi' ? 'Kết thúc' : 'End'}</th>
              <th style={{ padding: '8px 4px', width: 110, textAlign: 'center' }}>{language === 'vi' ? 'Ẩn' : 'Hide'}</th>
              <th style={{ padding: '8px 4px', width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, idx) => {
              const showOverrideToday = ev.manualShowDate === today;
              const hideOverrideToday = ev.manualHideDate === today;
              const overridden = showOverrideToday || hideOverrideToday;
              const saving = togglingId === ev.id;
              const subLabel = [ev.labelEn, ev.labelVi].filter(Boolean).join(' · ');
              return (
                <tr key={ev.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                  <td style={{ padding: '10px 4px' }}>
                    <span style={{ fontSize: '0.74rem', padding: '2px 7px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>{ev.eventType}</span>
                  </td>
                  <td style={{ padding: '10px 4px', fontWeight: 500 }}>
                    {ev.name}
                    {subLabel && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{subLabel}</div>}
                  </td>
                  <td style={{ padding: '10px 4px', fontSize: '0.85rem', color: ev.dedicatedCounsellor ? 'inherit' : 'var(--text-secondary)' }}>{ev.dedicatedCounsellor || '—'}</td>
                  <td style={{ padding: '10px 4px', color: ev.startDate ? 'inherit' : 'var(--text-secondary)' }}>{ev.startDate || '—'}</td>
                  <td style={{ padding: '10px 4px', color: ev.endDate ? 'inherit' : 'var(--text-secondary)' }}>{ev.endDate || '—'}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                    <label
                      title={
                        saving ? (language === 'vi' ? 'Đang lưu…' : 'Saving…')
                        : ev.hidden
                          ? (hideOverrideToday ? (language === 'vi' ? 'Đã ẩn hôm nay. Bấm để khôi phục.' : 'Hidden today (override). Click to revert.')
                                               : (language === 'vi' ? 'Tự động ẩn. Bấm để hiển thị hôm nay.' : 'Auto-hidden. Click to show for today.'))
                          : (showOverrideToday ? (language === 'vi' ? 'Hiển thị hôm nay (ghi đè). Bấm để khôi phục.' : 'Showing today (override). Click to revert.')
                                               : (language === 'vi' ? 'Đang hoạt động. Bấm để ẩn hôm nay.' : 'Auto-active. Click to hide for today.'))
                      }
                      style={{ display: 'inline-flex', alignItems: 'center', cursor: saving ? 'wait' : 'pointer' }}>
                      <input type="checkbox" checked={ev.hidden} disabled={saving} onChange={() => handleToggleHidden(ev)}
                             style={{ width: 18, height: 18, cursor: saving ? 'wait' : 'pointer' }} />
                    </label>
                    {overridden && <div style={{ fontSize: '0.7rem', color: '#2563eb', marginTop: 2 }}>{language === 'vi' ? 'hôm nay' : 'today only'}</div>}
                  </td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openQr(ev)} title="QR"
                            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 7px', marginRight: 6, fontSize: '0.72rem', fontWeight: 700 }}>
                      QR
                    </button>
                    <button onClick={() => setEditing({ ...ev })} title={language === 'vi' ? 'Sửa' : 'Edit'}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 4, marginRight: 4 }}>
                      <FiEdit2 size={16} />
                    </button>
                    <button onClick={() => handleDelete(ev.id, ev.name)} title={language === 'vi' ? 'Xóa' : 'Delete'}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                      <FiTrash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ── QR modal ───────────────────────────────────────── */}
      {qrEvent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
             onClick={() => setQrEvent(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', padding: 24, borderRadius: 8, width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{language === 'vi' ? 'Mã QR sự kiện' : 'Event QR'}</h2>
              <button onClick={() => setQrEvent(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><FiX size={20} /></button>
            </div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{qrEvent.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              {qrEvent.eventType}{qrEvent.dedicatedCounsellor ? ` · ${qrEvent.dedicatedCounsellor}` : ''}
            </div>
            {!LQ_BASE && (
              <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', fontSize: '0.82rem' }}>
                {language === 'vi'
                  ? 'Chưa đặt VITE_LQ_BASE_URL — mã QR sẽ dùng đường dẫn tương đối và không quét được. Đặt biến này trong Netlify (LeadManagement) thành URL trang LQ.'
                  : 'VITE_LQ_BASE_URL is not set — the QR uses a relative URL and will not scan. Set it in Netlify (LeadManagement) to your LQ site URL, then redeploy.'}
              </div>
            )}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              {framedUrl
                ? <img src={framedUrl} alt="Event QR" style={{ width: 280, maxWidth: '100%' }} />
                : <div style={{ padding: 40, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Đang tạo…' : 'Generating…'}</div>}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', wordBreak: 'break-all', marginBottom: 12 }}>{buildEventUrl(qrEvent)}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => downloadQr(qrEvent)}
                 style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FiDownload size={14} /> {language === 'vi' ? 'Tải xuống PNG' : 'Download PNG'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal ─────────────────────────────────────── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
             onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', padding: 24, borderRadius: 8, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>{language === 'vi' ? 'Sửa sự kiện' : 'Edit event'}</h2>
              <button onClick={() => setEditing(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><FiX size={20} /></button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{language === 'vi' ? 'Loại sự kiện' : 'Event Type'}</label>
              <select value={editing.eventType || ''} onChange={e => setEditing({ ...editing, eventType: e.target.value })} style={inputStyle}>
                {!editing.eventType && <option value="">—</option>}
                {typeCodes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{language === 'vi' ? 'Tên sự kiện' : 'Event name'}</label>
              <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
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
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{language === 'vi' ? 'Tư vấn viên phụ trách' : 'Dedicated counsellor'}</label>
              <input value={editing.dedicatedCounsellor || ''} onChange={e => setEditing({ ...editing, dedicatedCounsellor: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Bắt đầu' : 'Start date'}</label>
                <input type="date" value={editing.startDate || ''} onChange={e => setEditing({ ...editing, startDate: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>{language === 'vi' ? 'Kết thúc' : 'End date'}</label>
                <input type="date" value={editing.endDate || ''} onChange={e => setEditing({ ...editing, endDate: e.target.value })} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>
                {language === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={() => handleSaveEdit(editing)} style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FiCheck size={14} /> {language === 'vi' ? 'Lưu' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
