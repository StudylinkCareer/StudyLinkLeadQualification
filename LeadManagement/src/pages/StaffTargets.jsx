// src/pages/StaffTargets.jsx
// -----------------------------------------------------------------------------
// Staff Targets — a dedicated admin page for every assignable quota/target,
// grouped into three sections (2026-08 rename+categorization pass — this used
// to be four flat, similarly-named grids with no grouping, which made it hard
// to tell "Call Targets" the monthly-volume grid apart from the per-day quota
// that used to be hardcoded in reportController.js with no UI at all):
//
//   SALES TARGETS
//     Monthly Contract Targets — contracts signed per person per month
//     (monthly_targets / staff.target). Surfaced inside the Weekly Report too.
//
//   CALL TARGETS (reshaped 2026-08, planned with Hong Ha — "Phase 0" of the
//   Weekly/Monthly Report merge)
//     Monthly Call Volume Targets RETIRED — superseded by the two grids
//     below giving day-of-week + per-individual granularity instead of one
//     flat monthly number. call_targets/staff.call_target are left in the
//     DB, unmaintained, only because old Monthly Report still reads them.
//     Daily Call Quotas (Counsellors) — per-weekday New/Ongoing targets,
//     ROLE-WIDE (all counsellors share the same hours), now also per-MONTH
//     via the dropdown above the table. Drives Weekly Report's "Calls by
//     day" table for Counsellors.
//     Pre-sales Working Hours — per-STAFF-MEMBER, per-weekday HOURS (not a
//     call count). A Pre-Sales person's daily call target = their hours
//     that day x 8, combined New+Ongoing (no separate New/Ongoing split —
//     per Hong Ha, doesn't matter for Pre-Sales the way it does for
//     Counsellors). This is now the only place Pre-Sales targets live.
//
//   PRE-SALES ROUND-ROBIN
//     Uncontactable → Pre-sales Roster — unchanged. Pre-sales Working Hours
//     moved up into CALL TARGETS above (it now drives two things: the
//     round-robin's fairness weighting AND Pre-Sales' own KPI target, so it
//     lives with the other call-quota grid rather than only here).
//
// Access: Executive (CEO/COO), Quality and Tech Support — gated client-side on
// the auth profile (roleProfiles.canManageTargets) AND server-side on every
// /api/reports/*-targets + /tracked-staff + /call-target-staff + /call-day-
// targets endpoint (reportController canAccessTargets /
// canAccessStaffTargetsPageOnly). Managers still reach the Monthly Contract
// Targets grid via the Weekly Report.
//
// The two monthly grids: months down the rows, tracked staff across the
// columns, plus a rightmost TOTAL column aggregating target across all
// tracked staff per month (and a YTD total in the corner). Click a target
// cell to edit it inline. Target-only — actual counts are shown in Weekly
// Report / Monthly Report instead, not here. Counsellor call targets are an
// hourly rate instead — see CounsellorRateEditor below.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { reportsAPI, staffAPI } from '../services/api';
import { canManageTargets } from '../utils/roleProfiles';
import YearMonthPicker from '../components/reports/YearMonthPicker';

const card = { background: 'var(--bg-primary,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem' };
const sub  = { fontSize: '0.8rem', color: 'var(--text-secondary,#6b7280)' };
const th   = { textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary,#6b7280)', padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--border,#e5e7eb)' };
const td   = { padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border,#f1f5f9)' };
// Table-level heading (subordinate to the page h1 and section headers below).
const h2   = { fontSize: '1.1rem', fontWeight: 700, margin: 0 };
// Category divider between groups of related tables (Sales / Calls / Pre-sales
// round-robin) — the "more categorized" grouping on top of the per-table rename.
const sectionHeader = { fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary,#6b7280)', borderBottom: '2px solid var(--border,#e5e7eb)', paddingBottom: '0.4rem', marginBottom: '1rem' };

function SectionHeader({ children }) {
  return <div style={sectionHeader}>{children}</div>;
}

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
          <h2 style={h2}>{title}</h2>
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

// Uncontactable → Pre-sales auto-transfer roster — a flat list (no monthly
// dimension, unlike the two grids above): whoever's here is in the
// round-robin pool that automatically receives a lead once its counselor
// has logged 3 KBM calls across the 3 khung giờ time-slots. "Received"
// shows how many transfers each person has gotten so far, so it's visible
// the round-robin is actually staying even rather than just trusted blindly.
function UncontactableRosterList({ roster, L }) {
  const [rows, setRows]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addId, setAddId]     = useState('');

  function reload() {
    setLoading(true);
    reportsAPI.uncontactableRoster()
      .then(r => setRows(r?.data || []))
      .catch(() => setRows(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addStaff() {
    if (!addId) return;
    reportsAPI.addUncontactableStaff(Number(addId))
      .then(() => { setAddId(''); setShowAdd(false); reload(); })
      .catch(() => {});
  }
  function removeStaff(staffId) {
    reportsAPI.removeUncontactableStaff(staffId).then(() => reload()).catch(() => {});
  }
  function changeSlotMode(staffId, slotMode) {
    reportsAPI.setUncontactableSlotMode(staffId, slotMode).then(() => reload()).catch(() => {});
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={h2}>{L('Uncontactable → Pre-sales Roster', 'Danh sách Uncontactable → Pre-sales')}</h2>
          <div style={sub}>
            {L(
              'Round-robin pool that automatically receives a lead once its counselor has logged 3 unanswered (KBM) calls covering all 3 time-slots. Status flips to New for them.',
              'Danh sách xoay vòng tự động nhận lead khi tư vấn viên đã gọi 3 cuộc không bắt máy (KBM), mỗi cuộc rơi vào 1 trong 3 khung giờ. Trạng thái tự chuyển thành Mới cho họ.'
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {showAdd ? (
            <>
              <select value={addId} onChange={e => setAddId(e.target.value)} style={{ padding: '0.35rem', fontSize: '0.85rem' }}>
                <option value="">{L('— Select staff —', '— Chọn nhân viên —')}</option>
                {roster
                  .filter(s => !(rows || []).some(r => r.staffId === s.id))
                  .map(s => <option key={s.id} value={s.id}>{s.fullName}{s.position ? ` (${s.position})` : ''}</option>)}
              </select>
              <button className="btn" onClick={addStaff} disabled={!addId}>{L('Add', 'Thêm')}</button>
              <button className="btn" onClick={() => { setShowAdd(false); setAddId(''); }}>{L('Cancel', 'Hủy')}</button>
            </>
          ) : (
            <button className="btn" onClick={() => setShowAdd(true)}>+ {L('Add staff', 'Thêm nhân viên')}</button>
          )}
        </div>
      </div>

      <div style={card}>
        {loading && !rows && <div style={sub}>{L('Loading…', 'Đang tải…')}</div>}
        {rows && rows.length === 0 && (
          <div style={sub}>{L('No one in the pool yet — use Add staff.', 'Chưa có ai trong danh sách — dùng Thêm nhân viên.')}</div>
        )}
        {rows && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>{L('Staff', 'Nhân viên')}</th>
                <th style={th}>{L('Khung giờ rule', 'Quy tắc khung giờ')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{L('Received', 'Đã nhận')}</th>
                <th style={{ ...th, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.staffId}>
                  <td style={td}>{r.fullName}</td>
                  <td style={td}>
                    <select value={r.slotMode || 'standard'} onChange={e => changeSlotMode(r.staffId, e.target.value)}
                      style={{ padding: '0.25rem', fontSize: '0.8rem' }}
                      title={L(
                        'Standard = the fixed AM/PM/outside-hours slots. Evening gap = 3 evening calls, each ≥1h apart.',
                        'Tiêu chuẩn = 3 khung giờ AM/PM/ngoài giờ cố định. Buổi tối = 3 cuộc gọi buổi tối, mỗi cuộc cách nhau ≥1 tiếng.'
                      )}>
                      <option value="standard">{L('Standard (AM/PM/outside hours)', 'Tiêu chuẩn (AM/PM/ngoài giờ)')}</option>
                      <option value="evening_gap">{L('Evening telesales (≥1h apart)', 'Telesales buổi tối (cách ≥1h)')}</option>
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{r.received}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span onClick={() => removeStaff(r.staffId)} title={L('Remove', 'Xóa')}
                      style={{ cursor: 'pointer', color: 'var(--text-secondary,#9ca3af)' }}>×</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Staff Off-Days (2026-10, requested via cô Như / Hồng Hà) — pick an
// employee, then log each date they're off, as a full day or hours off.
// Hours off reduce that day's call target by the share of the workday
// missed (8h Mon-Fri, 4h Sat) — see rangeReport.js workedShareByDay.
// Entries logged as "half day" before hours existed are flagged until
// re-entered with real hours.
const OFF_DAY_REASON_LABELS = {
  leave:    ['Leave / Vacation', 'Nghỉ phép'],
  training: ['Training', 'Đào tạo'],
  meeting:  ['Meeting', 'Họp'],
  other:    ['Other', 'Khác'],
};

function StaffOffDaysSection({ roster, L, language }) {
  const [staffId, setStaffId] = useState('');
  const [rows, setRows]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('leave');
  const [newNote, setNewNote] = useState('');
  const [fullDay, setFullDay] = useState(true);
  const [newHours, setNewHours] = useState('');
  const [saveError, setSaveError] = useState('');
  const [needing, setNeeding] = useState([]);

  function reload(id) {
    reportsAPI.staffOffDaysNeedingHours().then(r => setNeeding(r?.data || [])).catch(() => {});
    if (!id) { setRows(null); return; }
    setLoading(true);
    reportsAPI.staffOffDays(id)
      .then(r => setRows(r?.data || []))
      .catch(() => setRows(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(staffId); }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoursValid = fullDay || (Number(newHours) >= 0.5 && Number(newHours) <= 8);

  function addEntry() {
    if (!staffId || !newDate || !hoursValid) return;
    setSaveError('');
    reportsAPI.addStaffOffDay(Number(staffId), newDate, newReason, newNote.trim() || null, fullDay ? null : Number(newHours))
      .then(() => { setNewDate(''); setNewNote(''); setNewHours(''); setFullDay(true); reload(staffId); })
      .catch(err => setSaveError(err?.message || L('Could not save. Please try again.', 'Không lưu được. Vui lòng thử lại.')));
  }
  // Prefill the form from a flagged entry; saving the same date replaces it.
  function fixEntry(r) {
    setNewDate(r.offDate); setNewReason(r.reasonType); setNewNote(r.note || '');
    setFullDay(false); setNewHours('');
  }
  function removeEntry(id) {
    setSaveError('');
    reportsAPI.removeStaffOffDay(id)
      .then(() => reload(staffId))
      .catch(err => setSaveError(err?.message || L('Could not remove. Please try again.', 'Không xóa được. Vui lòng thử lại.')));
  }

  const reasonLabel = (type) => L(...(OFF_DAY_REASON_LABELS[type] || OFF_DAY_REASON_LABELS.other));
  // offDate is a plain YYYY-MM-DD; format it without a Date round-trip (no timezone shift).
  const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return language === 'vi' ? `${dd}/${m}/${y}` : `${m}/${dd}/${y}`; };
  const hoursLabel = (r) => r.hoursUnknown
    ? null
    : r.hoursOff == null ? L('Full day', 'Cả ngày') : `${r.hoursOff} ${L('h', 'giờ')}`;
  const needingNames = [...new Set(needing.map(n => n.fullName))];

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={h2}>{L('Staff Off-Days', 'Ngày nghỉ / vắng mặt')}</h2>
        <div style={sub}>
          {L(
            'Log time off per person, as a full day or hours. It lowers that day’s call target by the share of the workday missed (8h Mon–Fri, 4h Sat).',
            'Ghi thời gian nghỉ của từng người, theo cả ngày hoặc số giờ. Chỉ tiêu cuộc gọi của ngày đó sẽ giảm theo tỉ lệ thời gian nghỉ trên ngày làm việc (8 giờ T2–T6, 4 giờ T7).'
          )}
        </div>
      </div>

      {needing.length > 0 && (
        <div style={{ ...card, background: '#fffbeb', borderColor: '#fcd34d', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {L(`${needing.length} entries need hours`, `${needing.length} ngày nghỉ cần nhập số giờ`)}
          </div>
          <div style={{ ...sub, color: '#92400e' }}>
            {L(
              'These were logged as "half day" before hours existed, so they don’t reduce any target yet. Open each person and press "Enter hours".',
              'Các ngày này được ghi "half day" khi chưa có số giờ, nên chưa trừ vào chỉ tiêu. Chọn từng người và bấm "Nhập giờ".'
            )}
            {' '}{needingNames.join(', ')}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>{L('Employee', 'Nhân viên')}</label>
          <select value={staffId} onChange={e => setStaffId(e.target.value)} style={{ padding: '0.35rem', fontSize: '0.85rem', minWidth: 220 }}>
            <option value="">{L('— Select staff —', '— Chọn nhân viên —')}</option>
            {roster.map(s => <option key={s.id} value={s.id}>{s.fullName}{s.position ? ` (${s.position})` : ''}</option>)}
          </select>
        </div>

        {!staffId && <div style={sub}>{L('Pick an employee above to see or add their off-days.', 'Chọn một nhân viên ở trên để xem hoặc thêm ngày nghỉ.')}</div>}

        {staffId && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border,#e5e7eb)' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 2 }}>{L('Date', 'Ngày')}</div>
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ padding: '0.35rem', fontSize: '0.85rem' }} />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 2 }}>{L('Reason', 'Lý do')}</div>
                <select value={newReason} onChange={e => setNewReason(e.target.value)} style={{ padding: '0.35rem', fontSize: '0.85rem' }}>
                  {Object.keys(OFF_DAY_REASON_LABELS).map(k => <option key={k} value={k}>{reasonLabel(k)}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 2 }}>{L('Time off', 'Thời gian nghỉ')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={fullDay} onChange={e => setFullDay(e.target.checked)} />
                    {L('Full day', 'Cả ngày')}
                  </label>
                  {!fullDay && (
                    <>
                      <input type="number" min="0.5" max="8" step="0.5" value={newHours} onChange={e => setNewHours(e.target.value)}
                        placeholder="2" aria-label={L('Hours off', 'Số giờ nghỉ')}
                        style={{ width: 56, padding: '0.35rem', fontSize: '0.85rem' }} />
                      <span style={{ fontSize: '0.85rem' }}>{L('hours', 'giờ')}</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 2 }}>{L('Note (optional)', 'Ghi chú (tùy chọn)')}</div>
                <input type="text" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder={L('e.g. public holiday, training name…', 'vd: nghỉ lễ, tên khóa đào tạo…')}
                  style={{ padding: '0.35rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }} />
              </div>
              <button className="btn" onClick={addEntry} disabled={!newDate || !hoursValid}>+ {L('Add', 'Thêm')}</button>
            </div>

            {saveError && <div style={{ ...sub, color: '#b91c1c', marginTop: '-0.5rem', marginBottom: '1rem' }}>{saveError}</div>}

            {loading && !rows && <div style={sub}>{L('Loading…', 'Đang tải…')}</div>}
            {rows && rows.length === 0 && <div style={sub}>{L('No off-days logged for this person yet.', 'Chưa có ngày nghỉ nào được ghi cho người này.')}</div>}
            {rows && rows.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={th}>{L('Date', 'Ngày')}</th>
                    <th style={th}>{L('Time off', 'Thời gian nghỉ')}</th>
                    <th style={th}>{L('Reason', 'Lý do')}</th>
                    <th style={th}>{L('Note', 'Ghi chú')}</th>
                    <th style={th}>{L('Logged by', 'Người thêm')}</th>
                    <th style={{ ...th, width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(r.offDate)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.hoursUnknown ? (
                          <button type="button" onClick={() => fixEntry(r)}
                            title={L('Logged as "half day" — enter the real hours', 'Đã ghi "half day" — nhập số giờ thực tế')}
                            style={{ border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', borderRadius: 4, padding: '2px 8px', fontSize: '0.78rem', cursor: 'pointer' }}>
                            ⚠ {L('Enter hours', 'Nhập giờ')}
                          </button>
                        ) : hoursLabel(r)}
                      </td>
                      <td style={td}>{reasonLabel(r.reasonType)}</td>
                      <td style={{ ...td, color: r.note ? 'inherit' : 'var(--text-secondary,#9ca3af)' }}>{r.note || '—'}</td>
                      <td style={{ ...td, color: 'var(--text-secondary,#6b7280)', fontSize: '0.78rem' }}>{r.createdBy}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span onClick={() => removeEntry(r.id)} title={L('Remove', 'Xóa')}
                          style={{ cursor: 'pointer', color: 'var(--text-secondary,#9ca3af)' }}>×</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Daily Call Quotas — Counsellors only (2026-08 redesign: Pre-Sales moved to
// PresalesHoursGrid below, hours-based instead of a role-wide call count).
// Per-weekday New/Ongoing call targets, one row ("Counsellors"), now also
// per-MONTH via the dropdown — a new/unconfigured month copies forward the
// most recently configured earlier month (server-side "copy forward" —
// this grid just shows whatever the server resolves for the picked month).
// Drives Weekly Report's "Calls by day" table's Counsellor New/Target,
// Ongoing/Target columns. Each cell holds two numbers (New, Ongoing).
const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function currentMonthLabel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Counsellor call rate per worked hour (2026-10, replaces the per-weekday
// grid for Individual/Company Report): target = hours worked x rate, so 8h
// = 10 New / 5 Ongoing and a 4h Saturday = 5 / 2.5 at the default rates.
const fmt1 = (n) => Math.round(Number(n || 0) * 10) / 10;

function CounsellorRateEditor({ L }) {
  const [month, setMonth]   = useState(currentMonthLabel());
  const [data, setData]     = useState(null);
  const [newRate, setNewRate] = useState('');
  const [ongRate, setOngRate] = useState('');
  const [msg, setMsg]       = useState('');

  function reload() {
    reportsAPI.callHourRates(month)
      .then(r => { const d = r?.data; setData(d); setNewRate(String(d?.newPerHour ?? '')); setOngRate(String(d?.ongoingPerHour ?? '')); })
      .catch(() => setData(null));
  }
  useEffect(() => { reload(); setMsg(''); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    setMsg('');
    reportsAPI.saveCallHourRates(month, Number(newRate), Number(ongRate))
      .then(() => { setMsg(L('Saved.', 'Đã lưu.')); reload(); })
      .catch(err => setMsg(err?.message || L('Could not save.', 'Không lưu được.')));
  }

  const n = Number(newRate) || 0, o = Number(ongRate) || 0;
  const inherited = data && data.setInMonth && data.setInMonth !== month;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={h2}>{L('Counsellor Call Rate', 'Định mức cuộc gọi Tư vấn viên')}</h2>
          <div style={sub}>
            {L(
              'Calls per worked hour, the same for every counsellor. Each person’s target is their hours worked (8h Mon–Fri, 4h Sat, minus time off) × these rates. A month with no rate set uses the last one set.',
              'Số cuộc gọi trên mỗi giờ làm việc, áp dụng chung cho mọi tư vấn viên. Chỉ tiêu của từng người = số giờ làm (8 giờ T2–T6, 4 giờ T7, trừ thời gian nghỉ) × định mức này. Tháng chưa đặt sẽ dùng định mức gần nhất.'
            )}
          </div>
        </div>
        <YearMonthPicker value={month} onChange={setMonth} L={L} />
      </div>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 2 }}>{L('New per hour', 'Mới / giờ')}</div>
            <input type="number" min="0" step="0.005" value={newRate} onChange={e => setNewRate(e.target.value)} style={{ width: 90, padding: '0.35rem' }} />
          </label>
          <label style={{ fontSize: '0.85rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary,#6b7280)', marginBottom: 2 }}>{L('Ongoing per hour', 'Đang xử lý / giờ')}</div>
            <input type="number" min="0" step="0.005" value={ongRate} onChange={e => setOngRate(e.target.value)} style={{ width: 90, padding: '0.35rem' }} />
          </label>
          <button className="btn" onClick={save}>{L('Save for this month', 'Lưu cho tháng này')}</button>
          {msg && <span style={sub}>{msg}</span>}
        </div>
        <div style={{ ...sub, marginTop: '0.75rem' }}>
          {L('Full day (8h)', 'Cả ngày (8 giờ)')}: <strong>{fmt1(n * 8)} / {fmt1(o * 8)}</strong>
          {' · '}{L('Saturday (4h)', 'Thứ 7 (4 giờ)')}: <strong>{fmt1(n * 4)} / {fmt1(o * 4)}</strong>
          {' '}({L('New / Ongoing', 'Mới / Đang xử lý')})
          {inherited && <> · {L(`using the rate set in ${data.setInMonth}`, `đang dùng định mức đặt từ ${data.setInMonth}`)}</>}
        </div>
      </div>
    </div>
  );
}

// Pre-sales working hours — reshaped 2026-08 (planned with Hong Ha): per-
// STAFF-MEMBER, per-weekday HOURS (not a flat hours/day x days/month
// average). Drives TWO things now: the weighted Uncontactable round-robin
// above (whoever's furthest behind received ÷ this month's hour-capacity
// gets the next hand-off) AND each Pre-Sales person's own Calls-KPI target
// (hours that day x 8, combined New+Ongoing). Same roster as
// UncontactableRosterList above — add/remove staff there, edit their hours
// here. A month with no values yet copies forward the last configured
// month (server-side; this grid just shows whatever the server resolves).
function PresalesHoursGrid({ L, language }) {
  const [month, setMonth]       = useState(currentMonthLabel());
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [editCell, setEditCell] = useState(null); // { staffId, day }
  const [editHours, setEditHours] = useState('');
  const skipBlurRef = useRef(false);

  function reload() {
    setLoading(true);
    reportsAPI.presalesWorkingHours(month)
      .then(r => setData(r?.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(staffId, day) {
    const h = Number(editHours) || 0;
    reportsAPI.savePresalesWorkingHours(staffId, month, day, h)
      .then(() => { setEditCell(null); reload(); })
      .catch(() => setEditCell(null));
  }

  const rows = data?.rows || [];
  const dayLabels = language === 'vi' ? DAY_LABELS_VI : DAY_LABELS_EN;
  const dailyTarget = (hours) => Math.round((hours || 0) * 8 * 10) / 10; // hours x 8 calls/hr
  const totalHoursForDay = (day) => rows.reduce((s, r) => s + Number((r.cells[day] || { hours: 0 }).hours || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={h2}>{L('Pre-sales Working Hours', 'Giờ làm việc Pre-sales')}</h2>
          <div style={sub}>
            {L(
              'Calling hours per person, per weekday, within their 8h workday (4h Sat) — sets each person’s Calls-KPI target (hours × 8, combined New+Ongoing; time off reduces it proportionally) and feeds the weighted round-robin above. Click a cell to edit.',
              'Số giờ gọi điện của từng người theo mỗi ngày, trong ngày làm việc 8 giờ (T7: 4 giờ) — quyết định chỉ tiêu cuộc gọi (giờ × 8, gộp Mới+Đang xử lý; thời gian nghỉ trừ theo tỉ lệ) và tỉ lệ xoay vòng có trọng số ở trên. Nhấn vào ô để sửa.'
            )}
          </div>
        </div>
        <YearMonthPicker value={month} onChange={setMonth} L={L} />
      </div>

      <div style={card}>
        {loading && !data && <div style={sub}>{L('Loading…', 'Đang tải…')}</div>}
        {data && rows.length === 0 && (
          <div style={sub}>{L('No one on the Uncontactable roster yet — add staff above first.', 'Chưa có ai trong danh sách Uncontactable — thêm nhân viên ở trên trước.')}</div>
        )}
        {data && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>{L('Staff', 'Nhân viên')}</th>
                  {dayLabels.map(d => <th key={d} style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.staffId}>
                    <td style={{ ...td, fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg-primary,#fff)' }}>{r.fullName}</td>
                    {[0, 1, 2, 3, 4, 5, 6].map(day => {
                      const c = r.cells[day] || { hours: 0 };
                      const editing = editCell && editCell.staffId === r.staffId && editCell.day === day;
                      return (
                        <td key={day} style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {editing ? (
                            <input type="number" min="0" step="0.5" value={editHours} autoFocus
                              onChange={e => setEditHours(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  { skipBlurRef.current = true; save(r.staffId, day); }
                                if (e.key === 'Escape') { skipBlurRef.current = true; setEditCell(null); }
                              }}
                              onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } save(r.staffId, day); }}
                              style={{ width: 44, padding: '2px 4px', fontSize: '0.8rem', textAlign: 'right' }} />
                          ) : (
                            <span onClick={() => { setEditCell({ staffId: r.staffId, day }); setEditHours(String(c.hours || 0)); }}
                              title={L(`Click to edit — target is ${dailyTarget(c.hours)} calls (hours × 8)`, `Nhấn để sửa — chỉ tiêu ${dailyTarget(c.hours)} cuộc gọi (giờ × 8)`)}
                              style={{ cursor: 'pointer', fontWeight: 600, fontStyle: c.hours ? 'normal' : 'italic', color: c.hours ? 'inherit' : 'var(--text-secondary,#9ca3af)' }}>
                              {c.hours ? `${c.hours}h` : L('not set', 'chưa đặt')}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg-secondary,#f8fafc)' }}>{L('Total h', 'Tổng giờ')}</td>
                  {[0, 1, 2, 3, 4, 5, 6].map(day => (
                    <td key={day} style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, background: 'var(--bg-secondary,#f8fafc)' }}>
                      {Math.round(totalHoursForDay(day) * 10) / 10}
                    </td>
                  ))}
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
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{L('Staff Targets', 'Chỉ tiêu nhân viên')}</h1>
        <div style={sub}>{L('All assignable quotas and targets in one place, grouped by what they drive.', 'Tất cả chỉ tiêu có thể gán, gom nhóm theo mục đích sử dụng.')}</div>
      </div>

      {/* ── Sales Targets ─────────────────────────────────────────── */}
      <SectionHeader>{L('Sales Targets', 'Chỉ tiêu Kinh doanh')}</SectionHeader>
      <TargetsGrid
        title={L('Monthly Contract Targets', 'Chỉ tiêu Hợp đồng theo tháng')}
        subtitle={L('Contracts signed per person per month — click a value to edit. The Default row sets each person’s base target; a month cell overrides it. Total aggregates all staff.', 'Số hợp đồng ký theo từng người mỗi tháng — nhấn để sửa. Hàng Mặc định đặt chỉ tiêu cơ bản; ô tháng ghi đè. Tổng cộng dồn tất cả.')}
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

      {/* ── Call Targets ──────────────────────────────────────────── */}
      {/* Monthly Call Volume Targets retired 2026-08 — superseded by the two
          grids below (day-of-week + per-individual granularity). */}
      <div style={{ marginTop: '2.5rem' }}>
        <SectionHeader>{L('Call Targets', 'Chỉ tiêu Cuộc gọi')}</SectionHeader>
        <CounsellorRateEditor L={L} />

        <div style={{ marginTop: '1.5rem' }}>
          <PresalesHoursGrid L={L} language={language} />
        </div>
      </div>

      {/* ── Pre-sales Round-Robin ─────────────────────────────────── */}
      <div style={{ marginTop: '2.5rem' }}>
        <SectionHeader>{L('Pre-sales Round-Robin', 'Xoay vòng Pre-sales')}</SectionHeader>
        <UncontactableRosterList roster={roster} L={L} />
      </div>

      {/* ── Attendance ────────────────────────────────────────────── */}
      <div style={{ marginTop: '2.5rem' }}>
        <SectionHeader>{L('Attendance', 'Chấm công')}</SectionHeader>
        <StaffOffDaysSection roster={roster} L={L} language={language} />
      </div>
    </div>
  );
}
