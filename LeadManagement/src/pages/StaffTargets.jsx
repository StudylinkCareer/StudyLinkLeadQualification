// src/pages/StaffTargets.jsx
// -----------------------------------------------------------------------------
// Staff Targets — a dedicated admin page for maintaining monthly targets for
// tracked staff. Two grids:
//   1. Monthly Targets  — contract targets (monthly_targets / staff.target),
//      surfaced inside the Weekly Report too.
//   2. Call Targets     — call-volume targets (call_targets / staff.call_target),
//      auto-populated with every active counselor + pre-sales staffer (still
//      add/remove-able like grid 1), and the sole driver of Monthly Report's
//      Calls KPI / % Calls KPI columns — no formula fallback.
//
// Access: Executive (CEO/COO), Quality and Tech Support — gated client-side on
// the auth profile (roleProfiles.canManageTargets) AND server-side on every
// /api/reports/*-targets + /tracked-staff + /call-target-staff endpoint
// (reportController canAccessTargets). Managers still reach grid 1 via the
// Weekly Report.
//
// Grid: months down the rows, tracked staff across the columns, plus a rightmost
// TOTAL column aggregating target across all tracked staff per month (and a
// YTD total in the corner). Click a target cell to edit it inline. Target-only
// — actual counts are shown in Weekly Report / Monthly Report instead, not here.
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

// One grid — months down the rows, tracked staff across the columns, a
// "Default" row for the base/fallback target, and a Total column. Reused for
// both Monthly Targets (contracts) and Call Targets (call volume); `api`
// supplies the four calls that differ between the two.
function TargetsGrid({ title, subtitle, defaultLabel, defaultTitle, api, roster, L }) {
  const [targets, setTargets]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [addId, setAddId]       = useState('');
  const [editCell, setEditCell] = useState(null); // { staffId, month }
  const [editVal, setEditVal]   = useState('');
  const [editDefaultId, setEditDefaultId] = useState(null); // base-target row
  const [defaultVal, setDefaultVal]       = useState('');
  const skipBlurRef = useRef(false);

  function reload() {
    setLoading(true);
    api.load()
      .then(r => setTargets(r?.data || null))
      .catch(() => setTargets(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function saveTarget(staffId, month, value) {
    api.saveCell(staffId, month, value)
      .then(() => { setEditCell(null); reload(); })
      .catch(() => setEditCell(null));
  }
  function saveDefault(staffId, value) {
    api.saveDefault(staffId, value)
      .then(() => { setEditDefaultId(null); reload(); })
      .catch(() => setEditDefaultId(null));
  }
  function addTracked() {
    if (!addId) return;
    api.addTracked(Number(addId))
      .then(() => { setAddId(''); setShowAdd(false); reload(); })
      .catch(() => {});
  }
  function removeTracked(staffId) {
    api.removeTracked(staffId).then(() => reload()).catch(() => {});
  }

  function monthTargetTotal(label) {
    return (targets?.rows || []).reduce(
      (sum, r) => sum + Number((r.cells[label] || { target: 0 }).target || 0), 0
    );
  }
  const grandTargetTotal = (targets?.rows || []).reduce(
    (sum, r) => sum + Number(r.ytd?.target || 0), 0
  );

  const colTotalHeadStyle = { ...th, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--primary,#2563eb)' };
  const totalCellStyle    = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, background: 'var(--bg-secondary,#f8fafc)' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{title}</h1>
          <div style={sub}>{subtitle}</div>
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
                    it has a monthly override. */}
                <tr>
                  <td style={{ ...td, fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg-secondary,#f8fafc)' }}>
                    {defaultLabel}
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
                            title={defaultTitle}
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

export default function StaffTargets() {
  const { staff }    = useAuth();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const allowed = canManageTargets(staff?.position);
  const [roster, setRoster] = useState([]);

  useEffect(() => { pushTrail && pushTrail({ label: L('Staff Targets', 'Chỉ tiêu nhân viên') }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!allowed || typeof staffAPI.listActive !== 'function') return;
    staffAPI.listActive().then(r => setRoster(r?.data || [])).catch(() => setRoster([]));
  }, [allowed]);

  if (!allowed) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1rem' }}>
        <div style={card}>{L('You do not have access to Staff Targets.', 'Bạn không có quyền truy cập Chỉ tiêu nhân viên.')}</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '1rem' }}>
      <TargetsGrid
        title={L('Staff Targets', 'Chỉ tiêu nhân viên')}
        subtitle={L('Monthly contract targets — click a value to edit. The Default row sets each person’s base target; a month cell overrides it. Total aggregates all staff.', 'Chỉ tiêu hợp đồng theo tháng — nhấn để sửa. Hàng Mặc định đặt chỉ tiêu cơ bản; ô tháng ghi đè. Tổng cộng dồn tất cả.')}
        defaultLabel={L('Default', 'Mặc định')}
        defaultTitle={L('Base monthly target — inherited by months with no override. Click to edit.', 'Chỉ tiêu mặc định — nhấn để sửa.')}
        api={{
          load:        reportsAPI.monthlyTargets,
          saveCell:    reportsAPI.saveMonthlyTarget,
          saveDefault: staffAPI.setTarget,
          addTracked:  reportsAPI.addTrackedStaff,
          removeTracked: reportsAPI.removeTrackedStaff,
        }}
        roster={roster}
        L={L}
      />

      <div style={{ marginTop: '2rem' }}>
        <TargetsGrid
          title={L('Call Targets', 'Chỉ tiêu cuộc gọi')}
          subtitle={L('Monthly call-volume targets — drives the Calls KPI columns on Monthly Report. Auto-populated with active Sales + Pre-sales staff; still add/remove-able below.', 'Chỉ tiêu số cuộc gọi theo tháng — quyết định cột KPI cuộc gọi trên Báo cáo tháng. Tự động điền nhân viên Sales và Pre-sales đang hoạt động; vẫn có thể thêm/xóa bên dưới.')}
          defaultLabel={L('Default', 'Mặc định')}
          defaultTitle={L('Base monthly call target — inherited by months with no override. Click to edit.', 'Chỉ tiêu cuộc gọi mặc định — nhấn để sửa.')}
          api={{
            load:        reportsAPI.callTargets,
            saveCell:    reportsAPI.saveCallTarget,
            saveDefault: staffAPI.setCallTarget,
            addTracked:  reportsAPI.addCallTargetStaff,
            removeTracked: reportsAPI.removeCallTargetStaff,
          }}
          roster={roster}
          L={L}
        />
      </div>
    </div>
  );
}
