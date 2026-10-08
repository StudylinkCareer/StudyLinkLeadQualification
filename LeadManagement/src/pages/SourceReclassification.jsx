// LeadManagement/src/pages/SourceReclassification.jsx
// ─────────────────────────────────────────────────────────────────────
// Manual reclassification tool for the Source of Lead restructure: every
// distinct legacy value still sitting in students.source_detail /
// students.referral_source, with a lead count and samples, and a one-click
// bulk-reassign into one of the 5 fixed Source-of-Lead buckets. Manager/
// Admin/Director only (same gate as Reference Data), same fetch-with-
// credentials style as ReferenceData.jsx.
// ─────────────────────────────────────────────────────────────────────

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' };
const lbl        = { display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 };

const COLUMN_LABEL = { source_detail: 'Source detail', referral_source: 'Campaign/Event' };

export default function SourceReclassification() {
  const { language } = useLanguage();
  const [values, setValues] = useState([]);
  const [reclassifiedCount, setReclassifiedCount] = useState(0);
  const [solOptions, setSolOptions] = useState([]);   // [{code, labelEn, labelVi}]
  const [sourceBySol, setSourceBySol] = useState({});  // { [solCode]: [{code, labelEn, labelVi}] }
  const [b2bTypes, setB2bTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [picks, setPicks] = useState({}); // key -> { targetLeadSource, targetSource, targetSourceDetail }
  const [expanded, setExpanded] = useState({}); // value key -> students[] | 'loading'

  const keyOf = (v) => `${v.column}::${v.value}`;

  async function loadStudents(v) {
    const key = keyOf(v);
    setExpanded((e) => ({ ...e, [key]: 'loading' }));
    try {
      const qs = new URLSearchParams({ column: v.column, value: v.value });
      const j = await fetch(`/api/source-reclassification/legacy-values/students?${qs}`, { credentials: 'include' }).then((r) => r.json());
      if (!j.success) throw new Error(j.error || 'Failed to load students');
      setExpanded((e) => ({ ...e, [key]: j.data || [] }));
    } catch (e) {
      setError(e.message || 'Failed to load students');
      setExpanded((e2) => { const n = { ...e2 }; delete n[key]; return n; });
    }
  }
  function toggleStudents(v) {
    const key = keyOf(v);
    if (expanded[key]) setExpanded((e) => { const n = { ...e }; delete n[key]; return n; });
    else loadStudents(v);
  }

  async function loadAll(silent) {
    if (!silent) setLoading(true);
    try {
      const [legacy, sol, source, b2b] = await Promise.all([
        fetch('/api/source-reclassification/legacy-values', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/reference-data?category=source_of_lead', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/reference-data?category=source', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/reference-data?category=b2b_type', { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (!legacy.success) throw new Error(legacy.error || 'Failed to load legacy values');
      setValues(legacy.data.values || []);
      setReclassifiedCount(legacy.data.reclassifiedCount || 0);
      setSolOptions((sol.data || []).filter((o) => o.code !== 'Event/Campaign'));
      const bySol = {};
      for (const row of source.data || []) (bySol[row.subcategory] = bySol[row.subcategory] || []).push(row);
      setSourceBySol(bySol);
      setB2bTypes(b2b.data || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);

  const setPick = (key, patch) => setPicks((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const subOptionsFor = (sol) => (sol === 'B2B referrals' ? b2bTypes : (sourceBySol[sol] || []));
  const needsDetailFor = (sol) => sol === 'B2B referrals' || sol === 'Personal referrals';
  const detailLabel = (sol) => (sol === 'B2B referrals'
    ? (language === 'vi' ? 'Tên đối tác' : 'Partner name')
    : (language === 'vi' ? 'Tên người giới thiệu' : 'Referrer name'));

  // studentId set = this one student only (row stays open, list refreshes quietly).
  async function apply(v, studentId) {
    const key = studentId ? `${keyOf(v)}::${studentId}` : keyOf(v);
    const pick = picks[key] || {};
    if (!pick.targetLeadSource) { setError('Choose a Source of Lead first.'); return; }
    setBusyKey(key);
    setError('');
    try {
      const r = await fetch('/api/source-reclassification/assign', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          column: v.column, value: v.value,
          targetLeadSource: pick.targetLeadSource,
          targetSource: pick.targetSource || '',
          targetSourceDetail: pick.targetSourceDetail || '',
          ...(studentId ? { studentId } : {}),
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to reassign');
      if (studentId) {
        setExpanded((e) => ({ ...e, [keyOf(v)]: (Array.isArray(e[keyOf(v)]) ? e[keyOf(v)] : []).filter((s) => s.studentId !== studentId) }));
        await loadAll(true);
      } else {
        setExpanded((e) => { const n = { ...e }; delete n[keyOf(v)]; return n; });
        await loadAll();
      }
    } catch (e) {
      setError(e.message || 'Failed to reassign');
    } finally {
      setBusyKey(null);
    }
  }

  // Plain render helper (not a component) so inputs keep focus while typing.
  function targetCells(pickKey, onApply) {
    const pick = picks[pickKey] || {};
    const subOpts = subOptionsFor(pick.targetLeadSource);
    const busy = busyKey === pickKey;
    return (
      <>
        <td style={{ padding: '10px 4px' }}>
          <select style={inputStyle} value={pick.targetLeadSource || ''}
            onChange={(e) => setPick(pickKey, { targetLeadSource: e.target.value, targetSource: '', targetSourceDetail: '' })}>
            <option value="">{language === 'vi' ? 'Chọn...' : 'Choose...'}</option>
            {solOptions.map((o) => <option key={o.code} value={o.code}>{label(o)}</option>)}
          </select>
        </td>
        <td style={{ padding: '10px 4px' }}>
          {subOpts.length > 0 && (
            <select style={inputStyle} value={pick.targetSource || ''}
              onChange={(e) => setPick(pickKey, { targetSource: e.target.value })}>
              <option value="">{language === 'vi' ? 'Không' : 'None'}</option>
              {subOpts.map((o) => <option key={o.code} value={o.code}>{label(o)}</option>)}
            </select>
          )}
        </td>
        <td style={{ padding: '10px 4px' }}>
          {needsDetailFor(pick.targetLeadSource) && (
            <input style={inputStyle} placeholder={detailLabel(pick.targetLeadSource)}
              value={pick.targetSourceDetail || ''}
              onChange={(e) => setPick(pickKey, { targetSourceDetail: e.target.value })} />
          )}
        </td>
        <td style={{ padding: '10px 4px' }}>
          <button onClick={onApply} disabled={busy || !pick.targetLeadSource}
            style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: 'var(--primary)', color: 'white',
                     fontWeight: 600, cursor: (busy || !pick.targetLeadSource) ? 'not-allowed' : 'pointer' }}>
            {busy ? (language === 'vi' ? 'Đang lưu...' : 'Applying...') : (language === 'vi' ? 'Áp dụng' : 'Apply')}
          </button>
        </td>
      </>
    );
  }

  const total = values.length;
  const progressText = language === 'vi'
    ? `${reclassifiedCount} giá trị đã phân loại lại · ${total} còn lại`
    : `${reclassifiedCount} legacy value(s) reclassified so far · ${total} remaining`;

  const label = (o) => (o ? (language === 'vi' ? (o.labelVi || o.code) : (o.labelEn || o.code)) : '');

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', marginBottom: 4 }}>
        {language === 'vi' ? 'Phân loại lại Nguồn khách hàng' : 'Source of Lead reclassification'}
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
        {language === 'vi'
          ? 'Các giá trị cũ trong "Source detail" và "Campaign/Event" cần được gán thủ công vào 1 trong 5 Nguồn khách hàng cố định.'
          : 'Legacy values in "Source detail" and "Campaign/Event" need to be manually assigned to one of the 5 fixed Source of Lead buckets.'}
      </p>
      <p style={{ fontWeight: 600, marginBottom: 16 }}>{progressText}</p>

      {error && (
        <div style={{ padding: 10, marginBottom: 16, borderRadius: 6, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Đang tải...' : 'Loading...'}</div>
      ) : values.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          {language === 'vi' ? 'Không còn giá trị nào cần phân loại lại. 🎉' : 'Nothing left to reclassify. 🎉'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>{language === 'vi' ? 'Giá trị cũ' : 'Legacy value'}</th>
              <th style={{ padding: '8px 4px', width: 110 }}>{language === 'vi' ? 'Trường' : 'Field'}</th>
              <th style={{ padding: '8px 4px', width: 70 }}>{language === 'vi' ? 'Số lead' : 'Count'}</th>
              <th style={{ padding: '8px 4px', width: 220 }}>{language === 'vi' ? 'Ví dụ' : 'Samples'}</th>
              <th style={{ padding: '8px 4px', width: 170 }}>{language === 'vi' ? 'Nguồn khách hàng mới' : 'New Source of Lead'}</th>
              <th style={{ padding: '8px 4px', width: 160 }}>{language === 'vi' ? 'Nguồn con' : 'Sub-value'}</th>
              <th style={{ padding: '8px 4px', width: 170 }}></th>
              <th style={{ padding: '8px 4px', width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {values.map((v) => {
              const key = keyOf(v);
              const students = expanded[key];
              return (
                <Fragment key={key}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 4px', maxWidth: 220, overflowWrap: 'anywhere' }}>
                    {v.value}
                    {v.sourceBreakdown && (
                      <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {(language === 'vi' ? 'cũng có "source": ' : 'also has "source": ')}
                        {v.sourceBreakdown.map((sb, i) => (
                          <span key={sb.source || '(none)'}>
                            {i > 0 && ', '}
                            {sb.source ? (
                              <button type="button" onClick={() => setPick(key, { targetSourceDetail: sb.source })}
                                title={language === 'vi' ? 'Dùng làm "Nguồn con" mới' : 'Use as the new detail text'}
                                style={{ border: 'none', background: 'none', padding: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
                                {sb.source} ({sb.count})
                              </button>
                            ) : (
                              <span>{language === 'vi' ? '(trống)' : '(empty)'} ({sb.count})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{COLUMN_LABEL[v.column]}</td>
                  <td style={{ padding: '10px 4px' }}>{v.count}</td>
                  <td style={{ padding: '10px 4px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                    {v.samples.map((s) => s.fullName || s.studentId).join(', ')}
                    <div>
                      <button type="button" onClick={() => toggleStudents(v)}
                        style={{ marginTop: 4, border: 'none', background: 'none', padding: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
                        {students
                          ? (language === 'vi' ? 'Ẩn danh sách' : 'Hide students')
                          : (language === 'vi' ? `Xem từng khách (${v.count})` : `Review each student (${v.count})`)}
                      </button>
                    </div>
                  </td>
                  {targetCells(key, () => apply(v))}
                </tr>
                {students && (
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <td colSpan={8} style={{ padding: '4px 0 12px 24px', background: 'var(--bg-secondary)' }}>
                      {students === 'loading' ? (
                        <div style={{ padding: 12, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Đang tải...' : 'Loading...'}</div>
                      ) : students.length === 0 ? (
                        <div style={{ padding: 12, color: 'var(--text-secondary)' }}>{language === 'vi' ? 'Đã xử lý hết.' : 'All students handled.'}</div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                              <th style={{ padding: '6px 4px' }}>{language === 'vi' ? 'Khách' : 'Student'}</th>
                              <th style={{ padding: '6px 4px' }}>{language === 'vi' ? 'Sự kiện' : 'Events'}</th>
                              <th style={{ padding: '6px 4px' }}>{language === 'vi' ? 'Thông tin khác' : 'Other info'}</th>
                              <th style={{ padding: '6px 4px', width: 170 }}>{language === 'vi' ? 'Nguồn khách hàng mới' : 'New Source of Lead'}</th>
                              <th style={{ padding: '6px 4px', width: 160 }}>{language === 'vi' ? 'Nguồn con' : 'Sub-value'}</th>
                              <th style={{ padding: '6px 4px', width: 170 }}></th>
                              <th style={{ padding: '6px 4px', width: 90 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {students.map((s) => {
                              const other = [s.source, v.column === 'source_detail' ? s.referralSource : s.sourceDetail]
                                .map((x) => (x || '').trim()).filter((x) => x && x !== v.value);
                              return (
                                <tr key={s.studentId} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={{ padding: '8px 4px' }}>
                                    <a href={`/students/${s.studentId}`} target="_blank" rel="noreferrer">{s.fullName || s.studentId}</a>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.studentId}</div>
                                  </td>
                                  <td style={{ padding: '8px 4px', color: 'var(--text-secondary)' }}>{s.events || '—'}</td>
                                  <td style={{ padding: '8px 4px', color: 'var(--text-secondary)' }}>{[...new Set(other)].join(' · ') || '—'}</td>
                                  {targetCells(`${key}::${s.studentId}`, () => apply(v, s.studentId))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
