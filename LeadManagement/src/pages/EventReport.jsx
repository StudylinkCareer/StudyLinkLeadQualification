// LeadManagement/src/pages/EventReport.jsx
//
// PURPOSE
//   Event-level analytics dashboard (Report -> Event Report). Modeled on
//   ActivityReport.jsx's pattern: fetch -> client-side aggregation -> click a
//   row to drill into the underlying lead list. Two modes:
//     Single Event  — one event's lead-source breakdown (Đăng ký/Xác nhận/
//                     Tham dự + percentages + CPL), planned vs actual budget,
//                     source/tier contribution pie charts.
//     Compare       — event-level totals side by side across up to 6 events.
//
// WHAT'S NOT SHOWN / CAVEATS
//   - "Khách K" (non-lead guests - club members, performers, etc. who never
//     fill out the LQ form) can't be derived from any existing data, since
//     they never enter the lead pipeline at all. It's a manual field in the
//     Budget section, left blank/unknown until someone enters it.
//   - Per-source spend is a MANUAL field, not auto-mapped from the budget
//     ledger — the ledger is organized by campaign/vendor, lead sources are
//     organized by channel/staff/partner/school; there's no clean join.
//   - "Contracted" is a single combined count (not split into during/after
//     the event), matching how the source Excel reports count it.

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiUpload, FiPlus, FiTrash2, FiEdit2, FiArrowRight, FiRefreshCw, FiChevronDown, FiChevronRight, FiCheckCircle } from 'react-icons/fi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';
import { useNavTrail } from '../contexts/NavTrailContext';
import { eventConsoleAPI } from '../services/api';
import { stoneLabel } from '../utils/stoneLabels';
import { STONE_IMAGES } from '../utils/stones';
import Watermark from '../components/Watermark';

const COLORS = { primary: '#2563EB', good: '#10B981', warn: '#F59E0B', danger: '#DC2626', neutral: '#94A3B8' };
// Matches ActivityReport.jsx's STONE_COLORS exactly, for visual consistency
// with the rest of the app wherever Stone Tier is shown.
const STONE_COLORS = { Diamond: '#8B5CF6', Ruby: '#DC2626', Sapphire: '#2563EB', Agate: '#F59E0B', Quartz: '#94A3B8', Unscored: '#6B7280' };
// dataviz skill's validated default categorical palette (8 slots, light
// mode) — see the skill's references/palette.md. Used for the "by source"
// pies since sources are unbounded/dynamic and there's no existing app-wide
// categorical convention to reuse (unlike Stone Tier, which already has one).
const CATEGORICAL = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#94A3B8';
const PIE_MAX_SLICES = 7; // + 1 folded "Khác/Other" slice, keeps within the validated 8-slot categorical set

const BUDGET_CATEGORIES = ['Quảng cáo', 'Đối tác truyền thông', 'In ấn', 'Vận hành sự kiện', 'Quà tặng'];
const COMPARE_MAX = 6;

function fmtVnd(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('vi-VN') + ' đ';
}
function fmtPct(n) {
  return n == null ? '—' : `${n}%`;
}
function fmtInt(n) {
  return n == null ? '—' : n;
}

// Loose match key for pairing a Planned item with its Actual counterpart in
// the side-by-side budget view. Different CSV uploads (or a manual edit)
// often phrase the same conceptual line item with a different dash
// character as the label/content separator (" - " vs " — " vs " – ") or
// slightly different spacing/case — an exact-string match on lineItem was
// splitting genuinely-matching rows into two separate lines. Strip all
// dash variants and collapse whitespace/case before comparing.
function normalizeMatchKey(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Transposes a bySource/byTier rollup (one row per category, one field per
// funnel stage) into horizontal-stacked-bar-ready shape: one row per stage,
// one stacked segment per category. Sorted by total desc, folded to a max
// segment count (+ one "Other" segment) so the chart never exceeds the
// validated categorical palette size — same cap rule as the old pie version.
function toStackedShareData(rows, stages, nameFn, keyFn, otherLabel) {
  const withTotal = (rows || [])
    .map((r) => ({
      name: nameFn(r), key: keyFn(r),
      values: Object.fromEntries(stages.map((s) => [s.key, r[s.key] || 0])),
      total: stages.reduce((sum, s) => sum + (r[s.key] || 0), 0),
    }))
    .filter((r) => r.total > 0);
  withTotal.sort((a, b) => b.total - a.total);
  const top = withTotal.slice(0, PIE_MAX_SLICES);
  const rest = withTotal.slice(PIE_MAX_SLICES);
  const folded = rest.length > 0;
  const categories = top.map((t) => ({ name: t.name, key: t.key }));
  if (folded) categories.push({ name: otherLabel, key: '__other__' });

  const chartRows = stages.map((s) => {
    const row = {};
    let total = 0;
    top.forEach((t) => { row[t.key] = t.values[s.key]; total += t.values[s.key]; });
    if (folded) {
      const otherVal = rest.reduce((sum, r) => sum + r.values[s.key], 0);
      row.__other__ = otherVal; total += otherVal;
    }
    row.stage = `${s.label} (${total})`;
    return row;
  });
  return { categories, chartRows };
}

// ── Stat card (matches ActivityReport.jsx / Dashboard.jsx) ─────
function StatCard({ label, value, sub, color, title, onClick, active }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        background: active ? 'var(--primary-light)' : 'var(--bg-primary)',
        border: `1px solid ${active ? (color || 'var(--primary, #2563EB)') : 'var(--border)'}`,
        borderRadius: '10px', padding: '1rem 1.25rem',
        borderLeft: `4px solid ${color || 'var(--border)'}`,
        cursor: clickable ? 'pointer' : 'default',
      }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

// Inline drill-down panel shown under the KPI strip when a tile is toggled
// open — a plain list of leads (or schools) rather than another table, kept
// deliberately simple since it's a quick "who's behind this number" check.
function KpiDrilldownPanel({ kpi, leads, schools, navigate, L }) {
  if (kpi === 'schools') {
    return (
      <div className="section-card" style={{ padding: '0.75rem 1rem' }}>
        {schools.length ? (
          <ul style={{ margin: 0, paddingLeft: '1.2rem', columns: 2, columnGap: '2rem' }}>
            {schools.map((s) => <li key={s.id} style={{ fontSize: '0.85rem', padding: '0.15rem 0' }}>{s.name}</li>)}
          </ul>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{L('No schools recorded', 'Chưa có trường nào')}</div>
        )}
      </div>
    );
  }
  return (
    <div className="section-card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="leads-data-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{L('Name', 'Tên')}</th>
            <th style={{ textAlign: 'left' }}>{L('Source', 'Nguồn')}</th>
            <th style={{ textAlign: 'left' }}>{L('Counselor', 'Tư vấn viên')}</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.studentId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.studentId}`)}>
              <td style={{ fontWeight: 500 }}>{l.fullName || '—'}</td>
              <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.sourceLabel}</td>
              <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.counselor || ''}</td>
              <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
            </tr>
          ))}
          {!leads.length && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
              {L('Nothing here', 'Không có dữ liệu')}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MiniBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: '4px', background: 'var(--bg-secondary)', borderRadius: '2px', marginTop: '3px', width: '100%', minWidth: '60px' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: COLORS.primary, borderRadius: '2px', transition: 'width 0.3s' }} />
    </div>
  );
}

// ── Editable inline field (click to edit, Enter/blur to save) ──
function EditableNumber({ value, onSave, placeholder, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to edit"
        style={{ cursor: 'pointer', borderBottom: '1px dashed var(--border)', ...style }}>
        {value == null ? (placeholder || '— (click to enter)') : fmtVnd(value)}
      </span>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      className="form-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft === '' ? null : Number(draft)); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); onSave(draft === '' ? null : Number(draft)); }
        if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); }
      }}
      style={{ width: '140px', ...style }}
    />
  );
}

// ── Budget approval ("Duyệt") — status + button for one budget_type. The
// button only renders when canApprove is true (server-computed from the
// session — this file never sees mom's actual email), but the approved
// status is always visible to everyone with page access.
function ApprovalControl({ label, approval, canApprove, busy, onApprove, L, language }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}:</span>
      {approval ? (
        <span style={{ fontSize: '0.7rem', color: COLORS.good, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <FiCheckCircle size={12} />
          {L('Approved by', 'Duyệt bởi')} {approval.approvedBy} · {new Date(approval.approvedAt).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-GB')}
        </span>
      ) : (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{L('Not approved yet', 'Chưa duyệt')}</span>
      )}
      {canApprove && (
        <button className="btn btn--secondary btn--sm" disabled={busy} onClick={onApprove}>
          {busy ? L('Approving…', 'Đang duyệt…') : (approval ? L('Re-approve', 'Duyệt lại') : L('Duyệt', 'Duyệt'))}
        </button>
      )}
    </div>
  );
}

// A merged budget row backs up to 2 underlying items (planned + actual) —
// the approval note is written to both on save (handleSaveApprovalNote), so
// reads prefer the actual item's note once both sides exist (same
// display-precedence rule sideBySideRows already uses for category/lineItem).
function ApprovalNoteCell({ row, canApprove, onSave, L }) {
  const existing = row.actual?.approvalNote ?? row.planned?.approvalNote ?? '';
  const existingBy = row.actual?.approvalNoteBy ?? row.planned?.approvalNoteBy ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(existing);

  if (!canApprove) {
    return existing ? (
      <div style={{ fontSize: '0.72rem', color: COLORS.warn, minWidth: '120px' }}>
        {existing}
        {existingBy && <div style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', marginTop: '2px' }}>— {existingBy}</div>}
      </div>
    ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>;
  }

  if (!editing) {
    return (
      <div
        onClick={() => { setDraft(existing); setEditing(true); }}
        title={L('Click to comment', 'Bấm để ghi chú')}
        style={{ cursor: 'pointer', fontSize: '0.72rem', minWidth: '120px', minHeight: '1.2em', color: existing ? COLORS.warn : 'var(--text-secondary)', borderBottom: '1px dashed var(--border)' }}>
        {existing || L('— (click to comment)', '— (bấm để ghi chú)')}
      </div>
    );
  }
  return (
    <div style={{ minWidth: '140px' }}>
      <textarea
        autoFocus rows={2} className="form-input" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ fontSize: '0.72rem', width: '100%' }}
      />
      <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
        <button className="btn btn--primary btn--sm" onClick={() => { onSave(draft); setEditing(false); }}>{L('Save', 'Lưu')}</button>
        <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>{L('Cancel', 'Hủy')}</button>
      </div>
    </div>
  );
}

// ── Share-of-whole card — horizontal stacked bar, replacing the old pie.
// Mom flagged the pie as unreadable on mobile: squeezed into a 3-column grid,
// its wedges got too thin for the leader-line labels to fit without
// overlapping. Per the dataviz skill's form table ("Part-to-whole → stacked
// bar, go horizontal for many/long-named categories"), a horizontal bar was
// already the *default* form for this job, not just a mobile workaround —
// its geometry degrades gracefully (bars get shorter, never illegibly thin)
// where a circle's wedges degrade badly (angles collapse toward zero).
// No in-segment labels (the "number on every point" anti-pattern) — the
// legend carries identity, the tooltip carries exact values on hover, and
// each row's total is baked into its own axis label (the one number worth
// reading at a glance, per "direct-label the endpoint, not every point").
function ShareBarCard({ title, categories, chartRows, colorFor }) {
  return (
    <div className="section-card" style={{ padding: '0.75rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', textAlign: 'center', color: 'var(--text-primary)' }}>{title}</div>
      {!categories.length ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '2rem 0' }}>—</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
            <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} width={125} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '0.68rem' }} />
            {categories.map((c, i) => (
              <Bar key={c.key} dataKey={c.key} name={c.name} stackId="share" fill={colorFor(c, i)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── CSV budget import — reads the team's real spreadsheet export (raw text,
// no server upload endpoint needed since it's just JSON body text) and
// replaces line items for whichever budget type(s) the file contains. ──
function CsvImportButton({ eventId, inputId, buttonLabel, confirmMessage, importFn, summarize, importing, setImporting, message, setMessage, onImported, L }) {
  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !eventId) return;
    if (!window.confirm(confirmMessage)) return;

    setImporting(true);
    setMessage('');
    try {
      const text = await file.text();
      const res = await importFn(eventId, text);
      onImported(res);
      setMessage(L('Imported: ', 'Đã nhập: ') + summarize(res));
    } catch (err) {
      setMessage(L('Import failed: ', 'Nhập thất bại: ') + (err.message || ''));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
      <label htmlFor={inputId} className="btn btn--secondary btn--sm" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }}>
        <FiUpload size={13} /> {importing ? L('Importing…', 'Đang nhập…') : buttonLabel}
      </label>
      <input id={inputId} type="file" accept=".csv,text/csv" onChange={handleFile} disabled={importing} style={{ display: 'none' }} />
      {message && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: '320px', textAlign: 'right' }}>{message}</span>}
    </div>
  );
}

// ── Merged budget line-item row form — Planned and Actual as columns on the
// SAME row (mom found switching between two tabs too annoying to compare).
// Saving can create/update/delete up to two underlying event_budget_items
// rows (one per budget_type) depending on which side(s) have a value.
function MergedBudgetItemForm({ initial, onSave, onCancel, L }) {
  const [category, setCategory] = useState(initial?.category || BUDGET_CATEGORIES[0]);
  const [lineItem, setLineItem] = useState(initial?.lineItem || '');
  const [unit, setUnit] = useState(initial?.unit || '');
  const [note, setNote] = useState(initial?.planned?.note || initial?.actual?.note || '');

  const [pUnitPrice, setPUnitPrice] = useState(initial?.planned?.unitPrice ?? '');
  const [pQuantity, setPQuantity] = useState(initial?.planned?.quantity ?? '');
  const [pAmount, setPAmount] = useState(initial?.planned?.amount ?? '');
  const [pTouched, setPTouched] = useState(false);

  const [aUnitPrice, setAUnitPrice] = useState(initial?.actual?.unitPrice ?? '');
  const [aQuantity, setAQuantity] = useState(initial?.actual?.quantity ?? '');
  const [aAmount, setAAmount] = useState(initial?.actual?.amount ?? '');
  const [aTouched, setATouched] = useState(false);

  function recomputeP(nextUp, nextQty) {
    if (pTouched) return;
    const up = nextUp === '' ? null : Number(nextUp), qty = nextQty === '' ? null : Number(nextQty);
    if (up != null && qty != null && !isNaN(up) && !isNaN(qty)) setPAmount(String(up * qty));
  }
  function recomputeA(nextUp, nextQty) {
    if (aTouched) return;
    const up = nextUp === '' ? null : Number(nextUp), qty = nextQty === '' ? null : Number(nextQty);
    if (up != null && qty != null && !isNaN(up) && !isNaN(qty)) setAAmount(String(up * qty));
  }

  const canSave = lineItem.trim() && (pAmount !== '' || aAmount !== '');

  return (
    <tr style={{ background: 'var(--bg-secondary)' }}>
      <td style={{ padding: '4px' }}>
        <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={lineItem} onChange={(e) => setLineItem(e.target.value)} style={{ width: '130px' }} placeholder="Line item" />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: '60px' }} placeholder="Cái" />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={pUnitPrice}
          onChange={(e) => { setPUnitPrice(e.target.value); recomputeP(e.target.value, pQuantity); }} style={{ width: '90px' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={pQuantity}
          onChange={(e) => { setPQuantity(e.target.value); recomputeP(pUnitPrice, e.target.value); }} style={{ width: '55px' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={pAmount}
          onChange={(e) => { setPAmount(e.target.value); setPTouched(true); }}
          style={{ width: '100px', fontStyle: pTouched ? 'normal' : 'italic' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={aUnitPrice}
          onChange={(e) => { setAUnitPrice(e.target.value); recomputeA(e.target.value, aQuantity); }} style={{ width: '90px' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={aQuantity}
          onChange={(e) => { setAQuantity(e.target.value); recomputeA(aUnitPrice, e.target.value); }} style={{ width: '55px' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" type="number" value={aAmount}
          onChange={(e) => { setAAmount(e.target.value); setATouched(true); }}
          style={{ width: '100px', fontStyle: aTouched ? 'normal' : 'italic' }} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '90px' }} placeholder="Note" />
      </td>
      {/* Approval note isn't editable from this form — only via ApprovalNoteCell
          on the read-only row, and only for the approver — kept as a plain
          placeholder cell here just to preserve column alignment. */}
      <td></td>
      <td style={{ padding: '4px', whiteSpace: 'nowrap' }}>
        <button
          className="btn btn--primary btn--sm"
          disabled={!canSave}
          onClick={() => onSave({
            category, lineItem: lineItem.trim(), unit: unit || null, note: note || null,
            planned: pAmount !== '' ? { unitPrice: pUnitPrice === '' ? null : Number(pUnitPrice), quantity: pQuantity === '' ? null : Number(pQuantity), amount: Number(pAmount) } : null,
            actual: aAmount !== '' ? { unitPrice: aUnitPrice === '' ? null : Number(aUnitPrice), quantity: aQuantity === '' ? null : Number(aQuantity), amount: Number(aAmount) } : null,
          })}>
          Save
        </button>{' '}
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

// ── School sponsor row form (add-new and edit-in-place) ──
function SponsorItemForm({ initial, onSave, onCancel, L }) {
  const [institutionName, setInstitutionName] = useState(initial?.institutionName || '');
  const [country, setCountry] = useState(initial?.country || '');
  const [isFree, setIsFree] = useState(initial?.isFree || false);
  const [amountOriginal, setAmountOriginal] = useState(initial?.amountOriginal ?? '');
  const [currency, setCurrency] = useState(initial?.currency || '');
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? '');
  const [amountVnd, setAmountVnd] = useState(initial?.amountVnd ?? '');
  const [standeeProvided, setStandeeProvided] = useState(initial?.standeeProvided || false);
  const [note, setNote] = useState(initial?.note || '');
  // Same auto-fill-until-touched pattern as MergedBudgetItemForm's Amount fields.
  const [vndTouched, setVndTouched] = useState(false);

  function recomputeVnd(nextAmount, nextRate) {
    if (vndTouched) return;
    const amt = nextAmount === '' ? null : Number(nextAmount);
    const rate = nextRate === '' ? null : Number(nextRate);
    if (amt != null && rate != null && !isNaN(amt) && !isNaN(rate)) setAmountVnd(String(Math.round(amt * rate)));
  }

  const canSave = institutionName.trim() && (isFree || (amountVnd !== '' && !isNaN(Number(amountVnd))));

  return (
    <tr style={{ background: 'var(--bg-secondary)' }}>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={country} onChange={(e) => setCountry(e.target.value)} style={{ width: '70px' }} placeholder={L('Country', 'Quốc gia')} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} placeholder={L('Institution name', 'Tên trường')} />
      </td>
      <td style={{ padding: '4px', textAlign: 'center' }}>
        <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} title={L('Free (no contribution)', 'Miễn phí')} />
      </td>
      <td style={{ padding: '4px' }}>
        {!isFree && (
          <input className="form-input" type="number" value={amountOriginal}
            onChange={(e) => { setAmountOriginal(e.target.value); recomputeVnd(e.target.value, exchangeRate); }}
            style={{ width: '80px' }} placeholder="1350" />
        )}
      </td>
      <td style={{ padding: '4px' }}>
        {!isFree && <input className="form-input" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: '60px' }} placeholder="AUD" />}
      </td>
      <td style={{ padding: '4px' }}>
        {!isFree && (
          <input className="form-input" type="number" value={exchangeRate}
            onChange={(e) => { setExchangeRate(e.target.value); recomputeVnd(amountOriginal, e.target.value); }}
            style={{ width: '80px' }} placeholder="18701" />
        )}
      </td>
      <td style={{ padding: '4px' }}>
        {!isFree && (
          <input className="form-input" type="number" value={amountVnd}
            onChange={(e) => { setAmountVnd(e.target.value); setVndTouched(true); }}
            title={vndTouched ? L('Manually set', 'Đã nhập thủ công') : L('Auto-filled from amount × rate', 'Tự tính từ số tiền × tỷ giá')}
            style={{ width: '110px', fontStyle: vndTouched ? 'normal' : 'italic' }} />
        )}
      </td>
      <td style={{ padding: '4px', textAlign: 'center' }}>
        <input type="checkbox" checked={standeeProvided} onChange={(e) => setStandeeProvided(e.target.checked)} title={L('Standee provided', 'Có standee')} />
      </td>
      <td style={{ padding: '4px' }}>
        <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('Note', 'Ghi chú')} />
      </td>
      <td style={{ padding: '4px', whiteSpace: 'nowrap' }}>
        <button
          className="btn btn--primary btn--sm"
          disabled={!canSave}
          onClick={() => onSave({
            institutionName: institutionName.trim(),
            country: country.trim() || null,
            isFree,
            amountOriginal: isFree || amountOriginal === '' ? null : Number(amountOriginal),
            currency: isFree ? null : (currency.trim() || null),
            exchangeRate: isFree || exchangeRate === '' ? null : Number(exchangeRate),
            amountVnd: isFree ? 0 : Number(amountVnd),
            standeeProvided,
            note: note || null,
          })}>
          Save
        </button>{' '}
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

export default function EventReport() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { push: pushTrail } = useNavTrail();
  const L = (en, vi) => (language === 'vi' ? vi : en);

  const [mode, setMode] = useState('single'); // 'single' | 'compare'

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');

  const [selectedEventId, setSelectedEventId] = useState(null);
  const [report, setReport] = useState(null);
  const [budget, setBudget] = useState(null);
  const [approvingType, setApprovingType] = useState(null);
  const [approveMsg, setApproveMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [compareIds, setCompareIds] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [compareBudgets, setCompareBudgets] = useState({});
  const [compareLoading, setCompareLoading] = useState(false);

  const [expandedSources, setExpandedSources] = useState(new Set());
  const [sortKey, setSortKey] = useState('registered');
  const [sortDir, setSortDir] = useState('desc');
  const [addingItem, setAddingItem] = useState(false);
  const [editingRowKey, setEditingRowKey] = useState(null); // merged sideBySideRows key, not a DB id
  const [expandedKpi, setExpandedKpi] = useState(null); // 'registered'|'confirmed'|'attended'|'schools'|'contracted'|null
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportMsg, setCsvImportMsg] = useState('');
  const [sponsors, setSponsors] = useState(null);
  const [sponsorsCsvImporting, setSponsorsCsvImporting] = useState(false);
  const [sponsorsCsvMsg, setSponsorsCsvMsg] = useState('');
  const [addingSponsor, setAddingSponsor] = useState(false);
  const [editingSponsorId, setEditingSponsorId] = useState(null);
  const [sponsorsExpanded, setSponsorsExpanded] = useState(false); // collapsed by default — 24+ rows is a lot

  // ── Load the Exhibition/Fair event list once ──
  useEffect(() => {
    (async () => {
      setEventsLoading(true);
      try {
        const res = await eventConsoleAPI.listEvents();
        const list = res.data || [];
        setEvents(list);
        if (list.length) setSelectedEventId(list[0].id);
      } catch (e) {
        setEventsError(e.message || 'Failed to load events');
      } finally {
        setEventsLoading(false);
      }
    })();
  }, []);

  // ── Nav trail ──
  useEffect(() => {
    pushTrail({ label: L('Event Report', 'Báo cáo sự kiện'), path: '/reports/event' });
  }, [pushTrail, language]);

  const loadSingle = useCallback(async (eventId) => {
    if (!eventId) return;
    setLoading(true); setError(''); setExpandedSources(new Set()); setExpandedKpi(null);
    try {
      const [reportRes, budgetRes, sponsorsRes] = await Promise.all([
        eventConsoleAPI.sourceReport(eventId),
        eventConsoleAPI.getBudget(eventId),
        eventConsoleAPI.getSponsors(eventId),
      ]);
      setReport(reportRes.data || null);
      setBudget(budgetRes.data || null);
      setSponsors(sponsorsRes.data || null);
    } catch (e) {
      setError(e.message || 'Failed to load event report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'single' && selectedEventId) loadSingle(selectedEventId);
  }, [mode, selectedEventId, loadSingle]);

  useEffect(() => {
    if (mode !== 'compare' || compareIds.length < 2) { setCompareData(null); setCompareBudgets({}); return; }
    (async () => {
      setCompareLoading(true);
      try {
        const [cmpRes, budgetResults] = await Promise.all([
          eventConsoleAPI.eventsCompare(compareIds),
          Promise.all(compareIds.map((id) => eventConsoleAPI.getBudget(id).catch(() => ({ data: null })))),
        ]);
        setCompareData(cmpRes.data || null);
        const budgetMap = {};
        compareIds.forEach((id, i) => { budgetMap[id] = budgetResults[i]?.data || null; });
        setCompareBudgets(budgetMap);
      } catch (e) {
        setError(e.message || 'Failed to load comparison');
      } finally {
        setCompareLoading(false);
      }
    })();
  }, [mode, compareIds]);

  // ── Sorted source breakdown ──
  const sortedSources = useMemo(() => {
    if (!report?.bySource) return [];
    const rows = [...report.bySource];
    rows.sort((a, b) => {
      const av = a[sortKey] ?? -1, bv = b[sortKey] ?? -1;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [report, sortKey, sortDir]);

  const kpiDrilldownLeads = useMemo(() => {
    if (!expandedKpi || expandedKpi === 'schools' || !report?.byLead) return [];
    if (expandedKpi === 'registered') return report.byLead;
    if (expandedKpi === 'confirmed') return report.byLead.filter((l) => l.confirmed);
    if (expandedKpi === 'attended') return report.byLead.filter((l) => l.attended);
    if (expandedKpi === 'contracted') return report.byLead.filter((l) => l.isContracted);
    return [];
  }, [expandedKpi, report]);

  // Pairs planned+actual items sharing the same (category, lineItem) for the
  // side-by-side comparison view — read-only (editing still happens per-tab,
  // where a single item id/budgetType is unambiguous).
  const sideBySideRows = useMemo(() => {
    const items = budget?.items || [];
    const map = new Map();
    for (const item of items) {
      const key = `${normalizeMatchKey(item.category)}::${normalizeMatchKey(item.lineItem)}`;
      if (!map.has(key)) map.set(key, { key, category: item.category, lineItem: item.lineItem, unit: item.unit, planned: null, actual: null });
      const row = map.get(key);
      row[item.budgetType] = item;
      // Prefer the Actual item's original wording for display once both
      // sides are present (the reconciliation doc's phrasing tends to be
      // the more "final" one), but don't overwrite once already set.
      if (item.budgetType === 'actual') { row.category = item.category; row.lineItem = item.lineItem; }
      if (!row.unit && item.unit) row.unit = item.unit;
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.category || '').localeCompare(b.category) || a.lineItem.localeCompare(b.lineItem));
  }, [budget]);

  const maxRegistered = useMemo(
    () => Math.max(1, ...(report?.bySource || []).map((s) => s.registered)),
    [report]
  );

  const shareData = useMemo(() => {
    if (!report) return null;
    const otherLabel = L('Other', 'Khác');
    const stages = [
      { key: 'registered', label: L('Registered', 'Đăng ký') },
      { key: 'confirmed', label: L('Confirmed', 'Xác nhận') },
      { key: 'attended', label: L('Attended', 'Tham dự') },
    ];
    return {
      bySource: toStackedShareData(report.bySource, stages, (s) => s.sourceLabel, (s) => s.sourceLabel, otherLabel),
      byTier: toStackedShareData(report.byTier, stages, (t) => stoneLabel(t.stoneTier, language), (t) => t.stoneTier, otherLabel),
    };
  }, [report, language]);

  function sourceColor(entry, i) {
    return entry.key === '__other__' ? OTHER_COLOR : CATEGORICAL[i % CATEGORICAL.length];
  }
  function tierColor(entry) {
    return STONE_COLORS[entry.key] || OTHER_COLOR;
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function toggleExpand(sourceLabel) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceLabel)) next.delete(sourceLabel); else next.add(sourceLabel);
      return next;
    });
  }

  function toggleCompareEvent(id) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPARE_MAX) return prev;
      return [...prev, id];
    });
  }

  // ── Budget CRUD ──
  async function handleSaveSponsorship(v) {
    const res = await eventConsoleAPI.setBudgetTotals(selectedEventId, { totalSponsorship: v, khachKCount: budget?.khachKCount });
    setBudget(res.data);
  }
  async function handleSaveKhachK(v) {
    const res = await eventConsoleAPI.setBudgetTotals(selectedEventId, { totalSponsorship: budget?.totalSponsorship, khachKCount: v });
    setBudget(res.data);
  }
  // A "row" in the merged Planned+Actual table can back up to two underlying
  // event_budget_items rows. Saving reconciles each side independently:
  // present in the form + no existing id -> create; present + existing id ->
  // update; absent + existing id -> delete (the user cleared that side).
  async function handleSaveMergedItem(row, data) {
    const common = { category: data.category, lineItem: data.lineItem, unit: data.unit, note: data.note };
    const calls = [];
    if (data.planned) {
      calls.push(row?.planned?.id
        ? eventConsoleAPI.updateBudgetItem(selectedEventId, row.planned.id, { ...common, ...data.planned, budgetType: 'planned' })
        : eventConsoleAPI.addBudgetItem(selectedEventId, { ...common, ...data.planned, budgetType: 'planned' }));
    } else if (row?.planned?.id) {
      calls.push(eventConsoleAPI.deleteBudgetItem(selectedEventId, row.planned.id));
    }
    if (data.actual) {
      calls.push(row?.actual?.id
        ? eventConsoleAPI.updateBudgetItem(selectedEventId, row.actual.id, { ...common, ...data.actual, budgetType: 'actual' })
        : eventConsoleAPI.addBudgetItem(selectedEventId, { ...common, ...data.actual, budgetType: 'actual' }));
    } else if (row?.actual?.id) {
      calls.push(eventConsoleAPI.deleteBudgetItem(selectedEventId, row.actual.id));
    }
    await Promise.all(calls);
    setAddingItem(false);
    setEditingRowKey(null);
    const res = await eventConsoleAPI.getBudget(selectedEventId);
    setBudget(res.data);
  }
  async function handleDeleteMergedRow(row) {
    if (!window.confirm(L('Delete this line item (both Planned and Actual)?', 'Xóa dòng này (cả Kế hoạch và Thực tế)?'))) return;
    const calls = [];
    if (row.planned?.id) calls.push(eventConsoleAPI.deleteBudgetItem(selectedEventId, row.planned.id));
    if (row.actual?.id) calls.push(eventConsoleAPI.deleteBudgetItem(selectedEventId, row.actual.id));
    await Promise.all(calls);
    const res = await eventConsoleAPI.getBudget(selectedEventId);
    setBudget(res.data);
  }
  // Approval note applies to whichever underlying item(s) a merged row has
  // (up to 2: planned + actual) — same reconciliation shape as
  // handleSaveMergedItem, just for the note field only.
  async function handleSaveApprovalNote(row, note) {
    const itemIds = [row.planned?.id, row.actual?.id].filter(Boolean);
    if (!itemIds.length) return;
    await eventConsoleAPI.saveBudgetApprovalNote(selectedEventId, itemIds, note);
    const res = await eventConsoleAPI.getBudget(selectedEventId);
    setBudget(res.data);
  }
  async function handleApproveBudget(budgetType) {
    setApprovingType(budgetType);
    setApproveMsg('');
    try {
      const res = await eventConsoleAPI.approveBudget(selectedEventId, budgetType);
      setBudget(res.data);
      setApproveMsg(res.emailResult?.sent
        ? L('Approved — email sent.', 'Đã duyệt — đã gửi email.')
        : L(`Approved, but the email didn't send (${res.emailResult?.reason || 'unknown'}).`, `Đã duyệt, nhưng email chưa gửi được (${res.emailResult?.reason || 'không rõ'}).`));
    } catch (err) {
      setApproveMsg(err.message || L('Failed to approve budget', 'Duyệt ngân sách thất bại'));
    } finally {
      setApprovingType(null);
      setTimeout(() => setApproveMsg(''), 6000);
    }
  }
  async function handleSaveSpend(sourceLabel, amount) {
    await eventConsoleAPI.setSourceSpend(selectedEventId, sourceLabel, amount);
    const res = await eventConsoleAPI.sourceReport(selectedEventId);
    setReport(res.data);
  }

  // ── School sponsors CRUD — also refresh Budget, since Total Sponsorship
  // may switch from manual to computed the moment the first row is added. ──
  async function refreshSponsorsAndBudget() {
    const [sRes, bRes] = await Promise.all([
      eventConsoleAPI.getSponsors(selectedEventId),
      eventConsoleAPI.getBudget(selectedEventId),
    ]);
    setSponsors(sRes.data);
    setBudget(bRes.data);
  }
  async function handleAddSponsor(item) {
    await eventConsoleAPI.addSponsor(selectedEventId, item);
    setAddingSponsor(false);
    await refreshSponsorsAndBudget();
  }
  async function handleUpdateSponsor(itemId, item) {
    await eventConsoleAPI.updateSponsor(selectedEventId, itemId, item);
    setEditingSponsorId(null);
    await refreshSponsorsAndBudget();
  }
  async function handleDeleteSponsor(itemId) {
    if (!window.confirm(L('Delete this sponsor row?', 'Xóa dòng nhà tài trợ này?'))) return;
    await eventConsoleAPI.deleteSponsor(selectedEventId, itemId);
    await refreshSponsorsAndBudget();
  }

  function exportToCsv() {
    if (!sortedSources.length) { alert('Nothing to export'); return; }
    const header = ['Source', 'Đăng ký', 'Xác nhận', 'Tham dự', 'Xác nhận/Đăng ký', 'Tham dự/Xác nhận', 'Tham dự/Đăng ký', 'Spend', 'CPL'];
    const rows = sortedSources.map((s) => [
      s.sourceLabel, s.registered, s.confirmed, s.attended,
      s.confirmedOverRegistered ?? '', s.attendedOverConfirmed ?? '', s.attendedOverRegistered ?? '',
      s.spendAmount ?? '', s.cpl ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-report-${selectedEventId}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (eventsLoading) return <div className="loading-center">{L('Loading...', 'Đang tải...')}</div>;
  if (eventsError) return <div className="page-body"><div className="alert alert--error">{eventsError}</div></div>;

  const ev = report?.event;

  return (
    <div>
      <Watermark />

      <div className="page-header">
        <span className="page-title">{L('Event Report', 'Báo cáo sự kiện')}</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            <button
              className="btn btn--sm"
              onClick={() => setMode('single')}
              style={{ borderRadius: 0, background: mode === 'single' ? 'var(--primary-light)' : 'transparent' }}>
              {L('Single Event', 'Một sự kiện')}
            </button>
            <button
              className="btn btn--sm"
              onClick={() => setMode('compare')}
              style={{ borderRadius: 0, background: mode === 'compare' ? 'var(--primary-light)' : 'transparent' }}>
              {L('Compare Events', 'So sánh sự kiện')}
            </button>
          </div>
          {mode === 'single' && (
            <button className="btn btn--secondary btn--sm" onClick={exportToCsv} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <FiDownload size={13} /> {L('Export', 'Xuất')}
            </button>
          )}
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {mode === 'single' ? (
          <>
            {/* ── Event picker ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{L('Event', 'Sự kiện')}:</span>
              <select
                className="form-input"
                value={selectedEventId || ''}
                onChange={(e) => setSelectedEventId(Number(e.target.value))}
                style={{ maxWidth: '360px' }}>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.registeredCount ?? 0} {L('registered', 'đăng ký')})
                  </option>
                ))}
              </select>
              {loading && <FiRefreshCw size={14} className="spin" />}
            </div>

            {error && <div className="alert alert--error">{error}</div>}

            {ev && (
              <>
                {/* ── KPI strip — click a tile to toggle the list behind its number ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                  <StatCard label={L('Registered', 'Đăng ký')} value={fmtInt(ev.registered)} color={COLORS.primary}
                    active={expandedKpi === 'registered'} onClick={() => setExpandedKpi((k) => k === 'registered' ? null : 'registered')} />
                  <StatCard label={L('Confirmed', 'Xác nhận')} value={fmtInt(ev.confirmed)} sub={fmtPct(ev.confirmedOverRegistered)} color={COLORS.warn}
                    active={expandedKpi === 'confirmed'} onClick={() => setExpandedKpi((k) => k === 'confirmed' ? null : 'confirmed')} />
                  <StatCard label={L('Attended', 'Tham dự')} value={fmtInt(ev.attended)} sub={fmtPct(ev.attendedOverRegistered)} color={COLORS.good}
                    active={expandedKpi === 'attended'} onClick={() => setExpandedKpi((k) => k === 'attended' ? null : 'attended')} />
                  <StatCard label={L('Schools present', 'Số trường')} value={fmtInt(ev.schoolsCount)} color={COLORS.neutral}
                    active={expandedKpi === 'schools'} onClick={() => setExpandedKpi((k) => k === 'schools' ? null : 'schools')} />
                </div>
                {expandedKpi && expandedKpi !== 'contracted' && (
                  <KpiDrilldownPanel kpi={expandedKpi} leads={kpiDrilldownLeads} schools={ev.schoolsList || []} navigate={navigate} L={L} />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <StatCard
                    label={L('Contracted', 'Ký hợp đồng')}
                    value={fmtInt(ev.contractedCount)}
                    color={COLORS.primary}
                    active={expandedKpi === 'contracted'}
                    onClick={() => setExpandedKpi((k) => k === 'contracted' ? null : 'contracted')}
                  />
                  <StatCard
                    label={L('CPL (registered)', 'CPL (đăng ký)')}
                    value={budget?.totalCostActual != null && ev.registered ? fmtVnd(Math.round(budget.totalCostActual / ev.registered)) : '—'}
                    sub={L('Actual cost ÷ registered', 'Chi phí thực tế ÷ đăng ký')}
                    color={COLORS.warn}
                  />
                  <StatCard
                    label={L('CPL (attended)', 'CPL (tham dự)')}
                    value={budget?.totalCostActual != null && ev.attended ? fmtVnd(Math.round(budget.totalCostActual / ev.attended)) : '—'}
                    sub={L('Actual cost ÷ attended', 'Chi phí thực tế ÷ tham dự')}
                    color={COLORS.good}
                  />
                </div>
                {expandedKpi === 'contracted' && (
                  <KpiDrilldownPanel kpi={expandedKpi} leads={kpiDrilldownLeads} schools={[]} navigate={navigate} L={L} />
                )}

                {/* ── Budget summary + ledger ── */}
                <div className="section-card">
                  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="section-title">{L('Budget', 'Ngân sách')}</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <CsvImportButton
                        eventId={selectedEventId}
                        inputId="budget-csv-input"
                        buttonLabel={L('Upload budget CSV', 'Tải lên file CSV ngân sách')}
                        confirmMessage={L(
                          'This replaces the existing Planned line items (and Actual too, if the file has Actual columns). Continue?',
                          'Thao tác này sẽ thay thế các dòng Kế hoạch hiện có (và cả Thực tế nếu file có cột Thực tế). Tiếp tục?'
                        )}
                        importFn={eventConsoleAPI.importBudgetCsv}
                        summarize={(res) => {
                          const s = res.summary || {};
                          return [
                            L(`${s.plannedCount ?? 0} planned item(s)`, `${s.plannedCount ?? 0} dòng Kế hoạch`),
                            s.actualCount != null ? L(`${s.actualCount} actual item(s)`, `${s.actualCount} dòng Thực tế`) : null,
                            s.sponsorshipImported ? L('sponsorship updated', 'đã cập nhật tài trợ') : null,
                          ].filter(Boolean).join(', ');
                        }}
                        importing={csvImporting}
                        setImporting={setCsvImporting}
                        message={csvImportMsg}
                        setMessage={setCsvImportMsg}
                        onImported={(res) => setBudget(res.data)}
                        L={L}
                      />
                    </div>
                  </div>

                  {budget && (
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.5rem 0 0' }}>
                      <ApprovalControl
                        label={L('Planned budget', 'Ngân sách Kế hoạch')}
                        approval={budget.plannedApproval}
                        canApprove={budget.canApprove}
                        busy={approvingType === 'planned'}
                        onApprove={() => handleApproveBudget('planned')}
                        L={L} language={language}
                      />
                      <ApprovalControl
                        label={L('Actual budget', 'Ngân sách Thực tế')}
                        approval={budget.actualApproval}
                        canApprove={budget.canApprove}
                        busy={approvingType === 'actual'}
                        onApprove={() => handleApproveBudget('actual')}
                        L={L} language={language}
                      />
                      {approveMsg && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{approveMsg}</span>}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', padding: '0.5rem 0 1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Total cost (planned)', 'Tổng chi phí (Kế hoạch)')}</div>
                      <div>{fmtVnd(budget?.totalCostPlanned)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Total cost (actual)', 'Tổng chi phí (Thực tế)')}</div>
                      <div style={{ fontWeight: 600 }}>{fmtVnd(budget?.totalCostActual)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Total sponsorship', 'Tổng tiền tài trợ')}</div>
                      {budget?.sponsorshipSource === 'computed' ? (
                        <div style={{ fontWeight: 600 }} title={L('Computed from the School Sponsors breakdown below', 'Tính từ danh sách nhà tài trợ bên dưới')}>
                          {fmtVnd(budget?.totalSponsorship)}
                        </div>
                      ) : (
                        <EditableNumber
                          value={budget?.totalSponsorship}
                          onSave={handleSaveSponsorship}
                          placeholder={L('No breakdown yet — click to enter, or fill in School Sponsors below', 'Chưa có danh sách — bấm để nhập, hoặc điền ở mục Nhà tài trợ bên dưới')}
                        />
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Khách K (manual, non-lead guests)', 'Khách K (thủ công)')}</div>
                      <EditableNumber
                        value={budget?.khachKCount}
                        onSave={handleSaveKhachK}
                        placeholder={L('Unknown (click to enter)', 'Chưa xác định (bấm để nhập)')}
                        style={{}}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Budget (85%)', 'Ngân sách sự kiện 85%')}</div>
                      <div>{fmtVnd(budget?.budget85)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{L('Remaining (vs actual)', 'Tiền còn lại (so với thực tế)')}</div>
                      <div style={{ color: budget?.remaining < 0 ? COLORS.danger : 'var(--text-primary)' }}>{fmtVnd(budget?.remaining)}</div>
                    </div>
                  </div>

                  {/* ── One merged table — Planned and Actual as columns on the same
                      row, per mom's request (switching tabs to compare was too
                      annoying). Line Item column is kept narrow; rows may wrap. ── */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leads-data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>{L('Category', 'Hạng mục')}</th>
                          <th style={{ textAlign: 'left', maxWidth: '140px' }}>{L('Line item', 'Nội dung')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Unit', 'Đơn vị')}</th>
                          <th style={{ textAlign: 'right' }} colSpan={3}>{L('Planned', 'Kế hoạch')}</th>
                          <th style={{ textAlign: 'right' }} colSpan={3}>{L('Actual', 'Thực tế')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Note', 'Ghi chú')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Approval', 'Phê duyệt')}</th>
                          <th style={{ width: '90px' }}></th>
                        </tr>
                        <tr>
                          <th colSpan={3}></th>
                          <th style={{ textAlign: 'right', fontWeight: 400 }}>{L('Unit price', 'Đơn giá')}</th>
                          <th style={{ textAlign: 'right', fontWeight: 400 }}>{L('Qty', 'SL')}</th>
                          <th style={{ textAlign: 'right', fontWeight: 400 }}>{L('Amount', 'Thành tiền')}</th>
                          <th style={{ textAlign: 'right', fontWeight: 400 }}>{L('Unit price', 'Đơn giá')}</th>
                          <th style={{ textAlign: 'right', fontWeight: 400 }}>{L('Qty', 'SL')}</th>
                          <th style={{ textAlign: 'right', fontWeight: 400 }}>{L('Amount', 'Thành tiền')}</th>
                          <th colSpan={3}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sideBySideRows.map((row) => (
                          editingRowKey === row.key ? (
                            <MergedBudgetItemForm
                              key={row.key}
                              initial={row}
                              onSave={(data) => handleSaveMergedItem(row, data)}
                              onCancel={() => setEditingRowKey(null)}
                              L={L}
                            />
                          ) : (
                            <tr key={row.key}>
                              <td>{row.category}</td>
                              <td style={{ maxWidth: '140px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.lineItem}</td>
                              <td>{row.unit || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{row.planned?.unitPrice != null ? fmtVnd(row.planned.unitPrice) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{row.planned?.quantity ?? '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.planned ? fmtVnd(row.planned.amount) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{row.actual?.unitPrice != null ? fmtVnd(row.actual.unitPrice) : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{row.actual?.quantity ?? '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.actual ? fmtVnd(row.actual.amount) : '—'}</td>
                              <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.planned?.note || row.actual?.note || ''}</td>
                              <td>
                                <ApprovalNoteCell row={row} canApprove={budget?.canApprove} onSave={(note) => handleSaveApprovalNote(row, note)} L={L} />
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="btn btn--ghost btn--sm" title="Edit" onClick={() => setEditingRowKey(row.key)}>
                                  <FiEdit2 size={13} />
                                </button>
                                <button className="btn btn--ghost btn--sm" title="Delete" onClick={() => handleDeleteMergedRow(row)}>
                                  <FiTrash2 size={13} color={COLORS.danger} />
                                </button>
                              </td>
                            </tr>
                          )
                        ))}
                        {addingItem && (
                          <MergedBudgetItemForm onSave={(data) => handleSaveMergedItem(null, data)} onCancel={() => setAddingItem(false)} L={L} />
                        )}
                        {!sideBySideRows.length && !addingItem && (
                          <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                            {L('No line items yet', 'Chưa có dòng ngân sách nào')}
                          </td></tr>
                        )}
                      </tbody>
                      {sideBySideRows.length > 0 && (
                        <tfoot>
                          <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                            <td colSpan={5}>{L('Total', 'Tổng cộng')}</td>
                            <td style={{ textAlign: 'right' }}>{fmtVnd(budget?.totalCostPlanned)}</td>
                            <td colSpan={2}></td>
                            <td style={{ textAlign: 'right' }}>{fmtVnd(budget?.totalCostActual)}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  {!addingItem && (
                    <button className="btn btn--secondary btn--sm" onClick={() => setAddingItem(true)} style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <FiPlus size={13} /> {L('Add line item', 'Thêm dòng')}
                    </button>
                  )}
                </div>

                {/* ── School Sponsors — per-institution breakdown behind Total Sponsorship ── */}
                <div className="section-card">
                  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      onClick={() => setSponsorsExpanded((v) => !v)}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {sponsorsExpanded ? <FiChevronDown size={15} /> : <FiChevronRight size={15} />}
                      <span className="section-title">{L('School Sponsors', 'Nhà tài trợ')}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                        ({(sponsors?.items || []).length} · {fmtVnd(sponsors?.totalVnd)})
                      </span>
                    </button>
                    <CsvImportButton
                      eventId={selectedEventId}
                      inputId="sponsors-csv-input"
                      buttonLabel={L('Upload sponsor list CSV', 'Tải lên file CSV nhà tài trợ')}
                      confirmMessage={L(
                        'This replaces the entire sponsor list for this event. Continue?',
                        'Thao tác này sẽ thay thế toàn bộ danh sách nhà tài trợ của sự kiện này. Tiếp tục?'
                      )}
                      importFn={eventConsoleAPI.importSponsorsCsv}
                      summarize={(res) => L(`${res.count} institution(s) imported`, `đã nhập ${res.count} trường`)}
                      importing={sponsorsCsvImporting}
                      setImporting={setSponsorsCsvImporting}
                      message={sponsorsCsvMsg}
                      setMessage={setSponsorsCsvMsg}
                      onImported={async (res) => {
                        setSponsors(res.data);
                        const b = await eventConsoleAPI.getBudget(selectedEventId);
                        setBudget(b.data);
                      }}
                      L={L}
                    />
                  </div>
                  {sponsorsExpanded && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leads-data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>{L('Country', 'Quốc gia')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Institution', 'Trường')}</th>
                          <th style={{ textAlign: 'center' }}>{L('Free', 'Miễn phí')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Amount', 'Số tiền')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Currency', 'Đơn vị')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Rate', 'Tỷ giá')}</th>
                          <th style={{ textAlign: 'right' }}>{L('VND', 'Thành VND')}</th>
                          <th style={{ textAlign: 'center' }}>{L('Standee', 'Standee')}</th>
                          <th style={{ textAlign: 'left' }}>{L('Note', 'Ghi chú')}</th>
                          <th style={{ width: '90px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sponsors?.items || []).map((item) => (
                          editingSponsorId === item.id ? (
                            <SponsorItemForm
                              key={item.id}
                              initial={item}
                              onSave={(data) => handleUpdateSponsor(item.id, data)}
                              onCancel={() => setEditingSponsorId(null)}
                              L={L}
                            />
                          ) : (
                            <tr key={item.id}>
                              <td>{item.country || '—'}</td>
                              <td>{item.institutionName}</td>
                              <td style={{ textAlign: 'center' }}>{item.isFree ? '✓' : ''}</td>
                              <td style={{ textAlign: 'right' }}>{item.amountOriginal != null ? item.amountOriginal.toLocaleString('vi-VN') : '—'}</td>
                              <td>{item.currency || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{item.exchangeRate != null ? item.exchangeRate.toLocaleString('vi-VN') : '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtVnd(item.amountVnd)}</td>
                              <td style={{ textAlign: 'center' }}>{item.standeeProvided ? '✓' : ''}</td>
                              <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.note || ''}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="btn btn--ghost btn--sm" title="Edit" onClick={() => setEditingSponsorId(item.id)}>
                                  <FiEdit2 size={13} />
                                </button>
                                <button className="btn btn--ghost btn--sm" title="Delete" onClick={() => handleDeleteSponsor(item.id)}>
                                  <FiTrash2 size={13} color={COLORS.danger} />
                                </button>
                              </td>
                            </tr>
                          )
                        ))}
                        {addingSponsor && (
                          <SponsorItemForm onSave={handleAddSponsor} onCancel={() => setAddingSponsor(false)} L={L} />
                        )}
                        {!(sponsors?.items || []).length && !addingSponsor && (
                          <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                            {L('No sponsors entered yet', 'Chưa có nhà tài trợ nào')}
                          </td></tr>
                        )}
                      </tbody>
                      {(sponsors?.items || []).length > 0 && (
                        <tfoot>
                          <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                            <td colSpan={6}>{L('Total', 'Tổng cộng')}</td>
                            <td style={{ textAlign: 'right' }}>{fmtVnd(sponsors?.totalVnd)}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  )}
                  {sponsorsExpanded && !addingSponsor && (
                    <button className="btn btn--secondary btn--sm" onClick={() => setAddingSponsor(true)} style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <FiPlus size={13} /> {L('Add sponsor', 'Thêm nhà tài trợ')}
                    </button>
                  )}
                </div>

                {/* ── Source breakdown (Total row + collapsible per-source leads) ── */}
                <div className="section-card">
                  <div className="section-header">
                    <span className="section-title">{L('Breakdown by source', 'Thống kê theo nguồn')}</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="leads-data-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>{L('Source', 'Nguồn')}</th>
                          <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('registered')}>{L('Registered', 'Đăng ký')}</th>
                          <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('confirmed')}>{L('Confirmed', 'Xác nhận')}</th>
                          <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('attended')}>{L('Attended', 'Tham dự')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Confirm/Reg', 'Xác nhận/Đăng ký')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Attend/Confirm', 'Tham dự/Xác nhận')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Attend/Reg', 'Tham dự/Đăng ký')}</th>
                          <th style={{ textAlign: 'right' }}>{L('Spend', 'Chi phí')}</th>
                          <th style={{ textAlign: 'right' }}>CPL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Total row — pinned, not clickable/expandable */}
                        <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                          <td>{L('Total', 'Tổng cộng')}</td>
                          <td style={{ textAlign: 'right' }}>{ev.registered}</td>
                          <td style={{ textAlign: 'right' }}>{ev.confirmed}</td>
                          <td style={{ textAlign: 'right' }}>{ev.attended}</td>
                          <td style={{ textAlign: 'right' }}>{fmtPct(ev.confirmedOverRegistered)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtPct(ev.attendedOverConfirmed)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtPct(ev.attendedOverRegistered)}</td>
                          <td style={{ textAlign: 'right' }}>—</td>
                          <td style={{ textAlign: 'right' }}>—</td>
                        </tr>

                        {sortedSources.map((s) => {
                          const expanded = expandedSources.has(s.sourceLabel);
                          const leadsForSource = report.byLead.filter((l) => l.sourceLabel === s.sourceLabel);
                          return (
                            <Fragment key={s.sourceLabel}>
                              <tr
                                onClick={() => toggleExpand(s.sourceLabel)}
                                style={{ cursor: 'pointer', background: expanded ? 'var(--primary-light)' : 'transparent' }}>
                                <td>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    {expanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
                                    {s.sourceLabel}
                                  </span>
                                  <MiniBar value={s.registered} max={maxRegistered} />
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.registered}</td>
                                <td style={{ textAlign: 'right' }}>{s.confirmed}</td>
                                <td style={{ textAlign: 'right' }}>{s.attended}</td>
                                <td style={{ textAlign: 'right' }}>{fmtPct(s.confirmedOverRegistered)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtPct(s.attendedOverConfirmed)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtPct(s.attendedOverRegistered)}</td>
                                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                  <EditableNumber
                                    value={s.spendAmount}
                                    onSave={(v) => handleSaveSpend(s.sourceLabel, v)}
                                    placeholder="—"
                                    style={{ fontSize: '0.8rem' }}
                                  />
                                </td>
                                <td style={{ textAlign: 'right' }}>{s.cpl != null ? fmtVnd(s.cpl) : '—'}</td>
                              </tr>
                              {expanded && (
                                <tr key={`${s.sourceLabel}-detail`}>
                                  <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                                    <table className="leads-data-table" style={{ width: '100%' }}>
                                      <thead>
                                        <tr>
                                          <th style={{ textAlign: 'left' }}>{L('Name', 'Tên')}</th>
                                          <th style={{ textAlign: 'left' }}>{L('Status', 'Trạng thái')}</th>
                                          <th style={{ textAlign: 'center' }}>{L('Confirmed', 'Xác nhận')}</th>
                                          <th style={{ textAlign: 'center' }}>{L('Attended', 'Tham dự')}</th>
                                          <th style={{ textAlign: 'center' }}>{L('Contracted', 'Ký HĐ')}</th>
                                          <th style={{ textAlign: 'left' }}>{L('Stone', 'Đá')}</th>
                                          <th style={{ textAlign: 'left' }}>{L('Counselor', 'Tư vấn viên')}</th>
                                          <th style={{ width: '40px' }}></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {leadsForSource.map((l) => (
                                          <tr key={l.studentId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.studentId}`)}>
                                            <td style={{ fontWeight: 500 }}>{l.fullName || '—'}</td>
                                            <td>{l.status || '—'}</td>
                                            <td style={{ textAlign: 'center', color: l.confirmed ? COLORS.good : 'var(--text-secondary)' }}>{l.confirmed ? '✓' : '—'}</td>
                                            <td style={{ textAlign: 'center', color: l.attended ? COLORS.good : 'var(--text-secondary)' }}>{l.attended ? '✓' : '—'}</td>
                                            <td style={{ textAlign: 'center', color: l.isContracted ? COLORS.good : 'var(--text-secondary)' }} title={l.leadStatus || ''}>{l.isContracted ? '✓' : '—'}</td>
                                            <td>
                                              {STONE_IMAGES[l.stoneTier] ? (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                  <img src={STONE_IMAGES[l.stoneTier]} alt={l.stoneTier} title={stoneLabel(l.stoneTier, language)}
                                                    style={{ width: '20px', height: '20px', objectFit: 'contain', flexShrink: 0 }} />
                                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{stoneLabel(l.stoneTier, language)}</span>
                                                </span>
                                              ) : (
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{stoneLabel(l.stoneTier, language)}</span>
                                              )}
                                            </td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.counselor}</td>
                                            <td style={{ textAlign: 'center' }}><FiArrowRight size={13} style={{ color: 'var(--text-secondary)' }} /></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {!sortedSources.length && (
                          <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
                            {L('No registrations for this event', 'Chưa có đăng ký nào cho sự kiện này')}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Contribution — by source, then by Stone Tier (horizontal stacked-share bars, see ShareBarCard) ── */}
                {shareData && (
                  <>
                    <div className="section-header"><span className="section-title">{L('Contribution by source', 'Tỉ trọng theo nguồn')}</span></div>
                    <ShareBarCard
                      title={L('Registered / Confirmed / Attended', 'Đăng ký / Xác nhận / Tham dự')}
                      categories={shareData.bySource.categories} chartRows={shareData.bySource.chartRows} colorFor={sourceColor}
                    />

                    <div className="section-header"><span className="section-title">{L('Contribution by Stone Tier', 'Tỉ trọng theo hạng đá')}</span></div>
                    <ShareBarCard
                      title={L('Registered / Confirmed / Attended', 'Đăng ký / Xác nhận / Tham dự')}
                      categories={shareData.byTier.categories} chartRows={shareData.byTier.chartRows} colorFor={tierColor}
                    />
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {/* ── Compare mode ── */}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {L(`Select up to ${COMPARE_MAX} events to compare:`, `Chọn tối đa ${COMPARE_MAX} sự kiện để so sánh:`)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {events.map((e) => (
                <label key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 10px', borderRadius: '14px', fontSize: '0.75rem',
                  border: '1px solid var(--border)',
                  background: compareIds.includes(e.id) ? 'var(--primary-light)' : 'var(--bg-primary)',
                  cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={compareIds.includes(e.id)} onChange={() => toggleCompareEvent(e.id)} />
                  {e.name}
                </label>
              ))}
            </div>

            {compareLoading && <div className="loading-center">{L('Loading...', 'Đang tải...')}</div>}

            {compareData?.events?.length > 0 && (
              <div className="section-card">
                <div style={{ overflowX: 'auto' }}>
                  <table className="leads-data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>{L('Metric', 'Chỉ số')}</th>
                        {compareData.events.map((e) => (
                          <th key={e.eventId} style={{ textAlign: 'right' }}>
                            {events.find((ev2) => ev2.id === e.eventId)?.name || e.eventId}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>{L('Registered', 'Đăng ký')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.registered}</td>)}</tr>
                      <tr><td>{L('Confirmed', 'Xác nhận')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.confirmed}</td>)}</tr>
                      <tr><td>{L('Attended', 'Tham dự')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.attended}</td>)}</tr>
                      <tr><td>{L('Schools present', 'Số trường')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.schoolsCount}</td>)}</tr>
                      <tr><td>{L('Confirm/Reg', 'Xác nhận/Đăng ký')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtPct(e.confirmedOverRegistered)}</td>)}</tr>
                      <tr><td>{L('Attend/Confirm', 'Tham dự/Xác nhận')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtPct(e.attendedOverConfirmed)}</td>)}</tr>
                      <tr><td>{L('Attend/Reg', 'Tham dự/Đăng ký')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtPct(e.attendedOverRegistered)}</td>)}</tr>
                      <tr><td>{L('Total Cost (Planned)', 'Tổng chi phí (Kế hoạch)')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtVnd(compareBudgets[e.eventId]?.totalCostPlanned)}</td>)}</tr>
                      <tr><td>{L('Total Cost (Actual)', 'Tổng chi phí (Thực tế)')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtVnd(compareBudgets[e.eventId]?.totalCostActual)}</td>)}</tr>
                      <tr><td>{L('Sponsorship', 'Tiền tài trợ')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{fmtVnd(compareBudgets[e.eventId]?.totalSponsorship)}</td>)}</tr>
                      <tr><td>{L('Khách K', 'Khách K')}</td>{compareData.events.map((e) => {
                        const kk = compareBudgets[e.eventId]?.khachKCount;
                        return <td key={e.eventId} style={{ textAlign: 'right' }}>{kk == null ? L('Unknown', 'Chưa xác định') : kk}</td>;
                      })}</tr>
                      <tr><td>{`CPL (${L('registered', 'đăng ký')})`}</td>{compareData.events.map((e) => {
                        const cost = compareBudgets[e.eventId]?.totalCostActual;
                        const cpl = cost != null && e.registered ? Math.round(cost / e.registered) : null;
                        return <td key={e.eventId} style={{ textAlign: 'right' }}>{cpl != null ? fmtVnd(cpl) : '—'}</td>;
                      })}</tr>
                      <tr><td>{L('Contracted', 'Ký hợp đồng')}</td>{compareData.events.map((e) => <td key={e.eventId} style={{ textAlign: 'right' }}>{e.contractedCount}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {mode === 'compare' && compareIds.length < 2 && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '1rem', textAlign: 'center' }}>
                {L('Select at least 2 events to see a comparison.', 'Chọn ít nhất 2 sự kiện để so sánh.')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
