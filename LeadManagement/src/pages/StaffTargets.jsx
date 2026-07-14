// src/pages/StaffTargets.jsx
// -----------------------------------------------------------------------------
// Staff Targets — a dedicated admin page for maintaining the monthly contract
// targets of tracked staff (the same monthly_targets tracker surfaced inside the
// Weekly Report, extracted here as a standalone page).
//
// Access: Executive (CEO/COO), Quality and Tech Support — gated client-side on
// the auth profile (roleProfiles.canManageTargets) AND server-side on every
// /api/reports/monthly-targets + /tracked-staff endpoint (reportController
// canAccessTargets). Managers still reach the same grid via the Weekly Report.
//
// Grid: months down the rows, tracked staff across the columns, plus a rightmost
// TOTAL column aggregating actual / target across all tracked staff per month
// (and a YTD total in the corner). Click a target cell to edit it inline.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI, staffAPI } from '../services/api';
import { canManageTargets } from '../utils/roleProfiles';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const sub  = { fontSize: '0.8rem', color: 'var(--text-secondary,#6b7280)' };
const th   = { textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary,#6b7280)', padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td   = { padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };

export default function StaffTargets() {
  const { staff }    = useAuth();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const allowed = canManageTargets(staff?.position);

  const [targets, setTargets]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [roster, setRoster]     = useState([]);
  const [showAdd, setShowAdd]   = useState(false);
  const [addId, setAddId]       = useState('');
  const [editCell, setEditCell] = useState(null); // { staffId, month }
  const [editVal, setEditVal]   = useState('');
  const [editDefaultId, setEditDefaultId] = useState(null); // base-target row
  const [defaultVal, setDefaultVal]       = useState('');
  const skipBlurRef = useRef(false);

  useEffect(() => { pushTrail && pushTrail({ label: L('Staff Targets', 'Chỉ tiêu nhân viên') }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function reloadTargets() {
    if (!allowed || typeof reportsAPI.monthlyTargets !== 'function') { setLoading(false); return; }
    setLoading(true);
    reportsAPI.monthlyTargets()
      .then(r => setTargets(r?.data || null))
      .catch(() => setTargets(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reloadTargets(); }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!allowed || typeof staffAPI.listActive !== 'function') return;
    staffAPI.listActive().then(r => setRoster(r?.data || [])).catch(() => setRoster([]));
  }, [allowed]);

  function saveTarget(staffId, month, value) {
    reportsAPI.saveMonthlyTarget(staffId, month, value)
      .then(() => { setEditCell(null); reloadTargets(); })
      .catch(() => setEditCell(null));
  }
  // Base / default target = staff.target (the fallback every month inherits when
  // it has no monthly override). Set ONLY here now (the Staff-page 🎯 was removed).
  function saveDefault(staffId, value) {
    staffAPI.setTarget(staffId, Number(value) || 0)
      .then(() => { setEditDefaultId(null); reloadTargets(); })
      .catch(() => setEditDefaultId(null));
  }
  function addTracked() {
    if (!addId) return;
    reportsAPI.addTrackedStaff(Number(addId))
      .then(() => { setAddId(''); setShowAdd(false); reloadTargets(); })
      .catch(() => {});
  }
  function removeTracked(staffId) {
    reportsAPI.removeTrackedStaff(staffId).then(() => reloadTargets()).catch(() => {});
  }

  // Targets-only page — aggregate the TARGET across every tracked staff member.
  function monthTargetTotal(label) {
    return (targets?.rows || []).reduce(
      (sum, r) => sum + Number((r.cells[label] || { target: 0 }).target || 0), 0
    );
  }
  const grandTargetTotal = (targets?.rows || []).reduce(
    (sum, r) => sum + Number(r.ytd?.target || 0), 0
  );

  if (!allowed) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1rem' }}>
        <div style={card}>{L('You do not have access to Staff Targets.', 'Bạn không có quyền truy cập Chỉ tiêu nhân viên.')}</div>
      </div>
    );
  }

  const colTotalHeadStyle = { ...th, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--primary,#2563eb)' };
  const totalCellStyle    = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, background: 'var(--bg-secondary,#f8fafc)' };

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{L('Staff Targets', 'Chỉ tiêu nhân viên')}</h1>
          <div style={sub}>{L('Monthly contract targets — click a value to edit. The Default row sets each person’s base target; a month cell overrides it. Total aggregates all staff.', 'Chỉ tiêu hợp đồng theo tháng — nhấn để sửa. Hàng Mặc định đặt chỉ tiêu cơ bản; ô tháng ghi đè. Tổng cộng dồn tất cả.')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {showAdd ? (
            <>
              <select value={addId} onChange={e => setAddId(e.target.value)} style={{ padding: '0.35rem', fontSize: '0.85rem' }}>
                <option value="">{L('— Select staff —', '— Chọn nhân viên —')}</option>
                {roster
                  .filter(s => !(targets?.rows || []).some(r => r.staffId === s.id))
                  .map(s => <option key={s.id} value={s.id}>{s.fullName}{s.position ? ` (${s.position})` : ''}</option>)}
              </select>
              <button className="btn" onClick={addTracked} disabled={!addId}>{L('Add', 'Thêm')}</button>
              <button className="btn" onClick={() => { setShowAdd(false); setAddId(''); }}>{L('Cancel', 'Hủy')}</button>
            </>
          ) : (
            <button className="btn" onClick={() => setShowAdd(true)}>+ {L('Add staff', 'Thêm nhân viên')}</button>
          )}
        </div>
      </div>

      <div style={card}>
        {loading && !targets && <div style={sub}>{L('Loading…', 'Đang tải…')}</div>}
        {targets && targets.rows.length === 0 && (
          <div style={sub}>{L('No staff tracked yet — use Add staff.', 'Chưa có nhân viên nào — dùng Thêm nhân viên.')}</div>
        )}

        {targets && targets.rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>2026</th>
                  {targets.rows.map(r => (
                    <th key={r.staffId} style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.fullName}
                      <span onClick={() => removeTracked(r.staffId)} title={L('Remove', 'Xóa')}
                        style={{ marginLeft: 6, cursor: 'pointer', color: 'var(--text-secondary,#9ca3af)' }}>×</span>
                    </th>
                  ))}
                  <th style={colTotalHeadStyle}>{L('Total', 'Tổng')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Default / base target row — the value each month inherits unless
                    it has a monthly override. This is where staff.target is now set. */}
                <tr>
                  <td style={{ ...td, fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg-secondary,#f8fafc)' }}>
                    {L('Default', 'Mặc định')}
                  </td>
                  {targets.rows.map(r => {
                    const editing = editDefaultId === r.staffId;
                    return (
                      <td key={r.staffId} style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', background: 'var(--bg-secondary,#f8fafc)' }}>
                        {editing ? (
                          <input type="number" min="0" value={defaultVal} autoFocus
                            onChange={e => setDefaultVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  { skipBlurRef.current = true; saveDefault(r.staffId, defaultVal); }
                              if (e.key === 'Escape') { skipBlurRef.current = true; setEditDefaultId(null); }
                            }}
                            onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } saveDefault(r.staffId, defaultVal); }}
                            style={{ width: 48, padding: '2px 4px', fontSize: '0.8rem', textAlign: 'right' }} />
                        ) : (
                          <span onClick={() => { setEditDefaultId(r.staffId); setDefaultVal(String(r.fallbackTarget ?? 0)); }}
                            title={L('Base monthly target — inherited by months with no override. Click to edit.', 'Chỉ tiêu mặc định — nhấn để sửa.')}
                            style={{ cursor: 'pointer', fontWeight: 700 }}>
                            {r.fallbackTarget ?? 0}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td style={totalCellStyle}>{(targets.rows || []).reduce((s, r) => s + Number(r.fallbackTarget || 0), 0)}</td>
                </tr>
                {targets.months.map(mo => (
                  <tr key={mo.label}>
                    <td style={{ ...td, fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>{mo.label}</td>
                    {targets.rows.map(r => {
                      const c = r.cells[mo.label] || { target: 0, isFallback: true };
                      const editing = editCell && editCell.staffId === r.staffId && editCell.month === mo.label;
                      return (
                        <td key={r.staffId} style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {editing ? (
                            <input type="number" min="0" value={editVal} autoFocus
                              onChange={e => setEditVal(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  { skipBlurRef.current = true; saveTarget(r.staffId, mo.label, editVal); }
                                if (e.key === 'Escape') { skipBlurRef.current = true; setEditCell(null); }
                              }}
                              onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } saveTarget(r.staffId, mo.label, editVal); }}
                              style={{ width: 48, padding: '2px 4px', fontSize: '0.8rem', textAlign: 'right' }} />
                          ) : (
                            <span onClick={() => { setEditCell({ staffId: r.staffId, month: mo.label }); setEditVal(String(c.target)); }}
                              title={c.isFallback ? L('Inherited default target — click to set this month', 'Chỉ tiêu mặc định — nhấn để đặt theo tháng') : L('Click to edit', 'Nhấn để sửa')}
                              style={{ cursor: 'pointer', fontWeight: 600, fontStyle: c.isFallback ? 'italic' : 'normal', color: c.isFallback ? 'var(--text-secondary,#9ca3af)' : 'inherit' }}>
                              {c.target}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td style={totalCellStyle}>{monthTargetTotal(mo.label)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>{L('YTD', 'Năm')}</td>
                  {targets.rows.map(r => (
                    <td key={r.staffId} style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {r.ytd.target}
                    </td>
                  ))}
                  <td style={{ ...totalCellStyle, fontSize: '0.9rem' }}>{grandTargetTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
