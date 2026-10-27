// POSM QR items (umbrella, fan, helmet...) — Marketing only, same gate as
// Marketing Events. Each item gets a permanent short link (<customer site>/q/<code>)
// printed in its QR; opening it counts a scan and opens the sign-up form, which
// tags the sign-up with the item. The code can't be edited after creation
// because it is printed on physical items. Not an event (owner, 2026-10).
import { useEffect, useState } from 'react';
import { FiPlus, FiDownload, FiX, FiEdit2, FiCheck } from 'react-icons/fi';
import QRCodeStyling from 'qr-code-styling';
import { useLanguage } from '../contexts/LanguageContext';
import { posmAPI } from '../services/api';

const LOGO_URL  = '/studylinklogo.png';
const DOT_COLOR = '#1a1a1a';
const ACCENT    = '#c8102e';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const th = { textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary,#6b7280)', padding: '0.5rem 0.6rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td = { padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)', verticalAlign: 'middle' };
const input = { padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border,#d1d5db)', fontSize: '0.85rem' };
const btn = (primary) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.8rem', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border,#d1d5db)', background: primary ? 'var(--primary,#2563eb)' : 'transparent',
  color: primary ? '#fff' : 'var(--text-primary,#111)',
});

export default function Posm() {
  const { language } = useLanguage();
  const L = (en, vi) => (language === 'vi' ? vi : en);
  const LQ_BASE = ((import.meta.env && import.meta.env.VITE_LQ_BASE_URL) || '').replace(/\/+$/, '');
  const linkFor = (item) => `${LQ_BASE}/q/${item.code}`;

  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [name, setName]     = useState('');
  const [code, setCode]     = useState('');
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [qrItem, setQrItem] = useState(null);
  const [qrPng, setQrPng]   = useState('');

  async function load() {
    setLoading(true);
    try { setItems((await posmAPI.list()).data || []); setError(''); }
    catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await posmAPI.create({ name: name.trim(), code: code.trim() || undefined, notes: notes.trim() || undefined });
      setName(''); setCode(''); setNotes('');
      await load();
    } catch (err) { setError(err.message || 'Failed to create'); }
    finally { setSaving(false); }
  }
  async function saveName(item) {
    if (!editName.trim()) return;
    try { await posmAPI.update(item.id, { name: editName.trim() }); setEditId(null); await load(); }
    catch (err) { setError(err.message || 'Failed to save'); }
  }
  async function toggle(item) {
    try { await posmAPI.update(item.id, { isActive: !item.isActive }); await load(); }
    catch (err) { setError(err.message || 'Failed to save'); }
  }

  // QR: high error correction so the centre logo doesn't break scanning.
  const qrOptions = (item, size, type, withImage) => ({
    width: size, height: size, type, margin: Math.round(size / 25), data: linkFor(item),
    qrOptions: { errorCorrectionLevel: 'H' },
    dotsOptions: { color: DOT_COLOR, type: 'rounded' },
    cornersSquareOptions: { color: ACCENT, type: 'extra-rounded' },
    cornersDotOptions: { color: ACCENT },
    backgroundOptions: { color: '#ffffff' },
    ...(withImage ? { image: LOGO_URL, imageOptions: { crossOrigin: 'anonymous', margin: 8, imageSize: 0.25, hideBackgroundDots: true } } : {}),
  });
  const logoOk = () => new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = LOGO_URL; });
  useEffect(() => {
    if (!qrItem) return;
    let alive = true;
    setQrPng('');
    (async () => {
      const blob = await new QRCodeStyling(qrOptions(qrItem, 600, 'canvas', await logoOk())).getRawData('png');
      if (alive && blob) setQrPng(URL.createObjectURL(blob));
    })().catch((e) => setError(e.message || 'QR failed'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrItem]);
  async function download(item, ext) {
    const qr = new QRCodeStyling(qrOptions(item, 2000, ext === 'svg' ? 'svg' : 'canvas', await logoOk()));
    const blob = await qr.getRawData(ext);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `posm-qr-${item.code}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  const rate = (i) => (i.scans ? `${Math.round((i.signups / i.scans) * 100)}%` : '—');

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: 4 }}>{L('POSM QR codes', 'QR ấn phẩm POSM')}</h1>
      <p style={{ color: 'var(--text-secondary,#6b7280)', marginTop: 0 }}>
        {L('One QR per printed item (umbrella, fan, helmet...). Scanning opens the sign-up form; the sign-up is tagged with the item, and the guest still answers how they heard about StudyLink. The link inside the QR never changes, so printed items keep working.',
           'Mỗi ấn phẩm (dù, quạt, nón bảo hiểm...) một mã QR. Khách quét sẽ vào trang đăng ký; hệ thống ghi nhận khách đến từ ấn phẩm nào, khách vẫn tự chọn biết đến StudyLink qua đâu. Link trong QR không bao giờ đổi, nên ấn phẩm đã in luôn dùng được.')}
      </p>
      {!LQ_BASE && (
        <div style={{ ...card, borderColor: '#fcd34d', background: '#fffbeb', fontSize: '0.85rem' }}>
          {L('VITE_LQ_BASE_URL is not set — QR codes would not scan. Set it in Netlify (LeadManagement).',
             'Chưa đặt VITE_LQ_BASE_URL — mã QR sẽ không quét được. Đặt biến này trong Netlify (LeadManagement).')}
        </div>
      )}
      {error && <div style={{ ...card, borderColor: '#fca5a5', background: '#fef2f2', color: '#b91c1c' }}>{error}</div>}

      <form onSubmit={create} style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', gap: 4, flex: '1 1 220px' }}>
          {L('Item name', 'Tên ấn phẩm')}
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={L('e.g. Umbrella 2026', 'VD: Dù 2026')} aria-label="POSM name" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', gap: 4, flex: '0 1 160px' }}>
          {L('Short code (optional)', 'Mã ngắn (không bắt buộc)')}
          <input style={input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DU26" maxLength={20} aria-label="POSM code" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', gap: 4, flex: '1 1 220px' }}>
          {L('Notes', 'Ghi chú')}
          <input style={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L('Quantity, where handed out...', 'Số lượng, phát ở đâu...')} />
        </label>
        <button type="submit" style={btn(true)} disabled={saving || !name.trim()}><FiPlus /> {L('Add item', 'Thêm ấn phẩm')}</button>
      </form>

      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>
              <th style={th}>{L('Item', 'Ấn phẩm')}</th>
              <th style={th}>{L('Link in QR', 'Link trong QR')}</th>
              <th style={{ ...th, textAlign: 'right' }}>{L('Scans', 'Lượt quét')}</th>
              <th style={{ ...th, textAlign: 'right' }}>{L('Sign-ups', 'Đăng ký')}</th>
              <th style={{ ...th, textAlign: 'right' }}>{L('Sign-ups / scan', 'Tỉ lệ')}</th>
              <th style={th}>{L('Status', 'Trạng thái')}</th>
              <th style={th} />
            </tr></thead>
            <tbody>
              {loading && <tr><td style={td} colSpan={7}>{L('Loading…', 'Đang tải…')}</td></tr>}
              {!loading && items.length === 0 && <tr><td style={{ ...td, color: 'var(--text-secondary,#9ca3af)' }} colSpan={7}>{L('No POSM items yet.', 'Chưa có ấn phẩm nào.')}</td></tr>}
              {items.map((i) => (
                <tr key={i.id} style={{ opacity: i.isActive ? 1 : 0.55 }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {editId === i.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input style={input} value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Edit name" />
                        <button type="button" style={btn(false)} onClick={() => saveName(i)} title={L('Save', 'Lưu')}><FiCheck /></button>
                        <button type="button" style={btn(false)} onClick={() => setEditId(null)} title={L('Cancel', 'Huỷ')}><FiX /></button>
                      </span>
                    ) : (
                      <>
                        {i.name}{' '}
                        <button type="button" onClick={() => { setEditId(i.id); setEditName(i.name); }} title={L('Rename', 'Đổi tên')}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary,#6b7280)' }}><FiEdit2 size={12} /></button>
                        {i.notes && <div style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)' }}>{i.notes}</div>}
                      </>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.78rem' }}>{linkFor(i).replace(/^https?:\/\//, '')}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{i.scans}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{i.signups}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{rate(i)}</td>
                  <td style={td}>
                    <button type="button" style={btn(false)} onClick={() => toggle(i)}>
                      {i.isActive ? L('Active', 'Đang dùng') : L('Hidden', 'Đã ẩn')}
                    </button>
                  </td>
                  <td style={td}><button type="button" style={btn(true)} onClick={() => setQrItem(i)} disabled={!LQ_BASE}>QR</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 0 }}>
          {L('Hiding an item stops tagging new sign-ups (the QR still opens the sign-up form). Totals here are all-time; the Company Report shows them per period.',
             'Ẩn ấn phẩm thì đăng ký mới không còn được gắn với ấn phẩm đó (QR vẫn mở trang đăng ký). Số liệu ở đây là tổng từ trước tới nay; Báo cáo toàn công ty hiện theo từng kỳ.')}
        </p>
      </div>

      {qrItem && (
        <div role="dialog" aria-label="POSM QR" onClick={() => setQrItem(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 380, maxWidth: '92vw', marginBottom: 0, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>{qrItem.name}</strong>
              <button type="button" onClick={() => setQrItem(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }} aria-label="Close"><FiX /></button>
            </div>
            {qrPng ? <img src={qrPng} alt={`QR ${qrItem.name}`} style={{ width: 280, height: 280 }} /> : <div style={{ height: 280 }}>…</div>}
            <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', margin: '6px 0 12px', wordBreak: 'break-all' }}>{linkFor(qrItem)}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" style={btn(true)} onClick={() => download(qrItem, 'png')}><FiDownload /> PNG</button>
              <button type="button" style={btn(false)} onClick={() => download(qrItem, 'svg')}><FiDownload /> {L('SVG (for print)', 'SVG (để in)')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
