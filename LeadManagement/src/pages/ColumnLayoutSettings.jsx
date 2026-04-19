// src/pages/ColumnLayoutSettings.jsx
// -----------------------------------------------------------------------------
// CHANGES (i18n Phase 2b):
//   - All UI chrome (headers, buttons, confirms, notes) uses t().
//   - Role tab labels use t('columns.role.*').
//   - Column labels in the editor and preview look up a t() key
//     'leads.col.<key>' — matching the Leads page column translations.
//     Any column without a matching translation key falls back to the
//     MASTER_COLUMNS label (English).
//   - Drag/drop behaviour and save logic unchanged.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { columnConfigAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { t, en as enStrings } from '../i18n';
import { FiArrowLeft, FiEye, FiEyeOff, FiSave, FiCheck } from 'react-icons/fi';

// ── Must stay in sync with MASTER_COLUMNS in Leads.jsx ────────
const MASTER_COLUMNS = [
  // ── Personal Details ──
  { key:'fullName',               label:'Name',                   visible:true,  width:160 },
  { key:'email',                  label:'Email',                  visible:false, width:190 },
  { key:'phone',                  label:'Phone',                  visible:false, width:130 },
  { key:'yearOfBirth',            label:'Year of Birth',          visible:false, width:110 },
  { key:'residency',              label:'Residency',              visible:false, width:140 },
  { key:'schoolEvent',            label:'School / Event',         visible:false, width:150 },
  { key:'preferredSocial',        label:'Social Platform',        visible:false, width:130 },
  { key:'socialConsent',          label:'Connect With Us',        visible:false, width:120 },
  // ── Lead Management ──
  { key:'leadStatus',             label:'Status',                 visible:true,  width:110 },
  { key:'createdAt',              label:'Created',                visible:true,  width:100 },
  { key:'age',                    label:'Age',                    visible:true,  width:55  },
  { key:'leadSource',             label:'Lead Source',            visible:true,  width:120 },
  { key:'interaction',            label:'Interaction',            visible:true,  width:110 },
  { key:'studyPlans',             label:'Study Plans',            visible:true,  width:120 },
  { key:'destinationCountry',     label:'Destination',            visible:true,  width:130 },
  { key:'timeline',               label:'Timeline',               visible:true,  width:110 },
  { key:'stoneTier',              label:'Stone',                  visible:true,  width:90  },
  { key:'riskScore',              label:'Score',                  visible:true,  width:70  },
  { key:'counselor',              label:'Counselor',              visible:true,  width:130 },
  { key:'seniorCounselor',        label:'Sr. Counselor',          visible:false, width:130 },
  { key:'presales',               label:'Pre-Sales',              visible:false, width:120 },
  { key:'marketingStaff',         label:'Marketing',              visible:false, width:120 },
  { key:'closeDate',              label:'Close Date',             visible:true,  width:100 },
  { key:'confidence',             label:'Confidence',             visible:false, width:130 },
  // ── Self Assessment ──
  { key:'budget',                 label:'Budget',                 visible:true,  width:130 },
  { key:'scholarshipDemand',      label:'Scholarship',            visible:false, width:130 },
  { key:'englishLevel',           label:'English',                visible:true,  width:100 },
  { key:'gpa',                    label:'GPA',                    visible:true,  width:70  },
  { key:'immigrationHistory',     label:'Immigration',            visible:false, width:160 },
  { key:'sponsorIncome',          label:'Sponsor Income',         visible:false, width:130 },
  { key:'incomeEvidence',         label:'Income Evidence',        visible:false, width:130 },
  { key:'studyPlanGap',           label:'Study Plan Gap',         visible:false, width:150 },
  { key:'ultimateObjective',      label:'Objective',              visible:false, width:150 },
  // ── Family Contacts ──
  { key:'motherFullName',         label:'Mother Name',            visible:false, width:140 },
  { key:'motherEmail',            label:'Mother Email',           visible:false, width:180 },
  { key:'motherPhone',            label:'Mother Phone',           visible:false, width:130 },
  { key:'motherContactMedium',    label:'Mother Medium',          visible:false, width:130 },
  { key:'fatherFullName',         label:'Father Name',            visible:false, width:140 },
  { key:'fatherEmail',            label:'Father Email',           visible:false, width:180 },
  { key:'fatherPhone',            label:'Father Phone',           visible:false, width:130 },
  { key:'fatherContactMedium',    label:'Father Medium',          visible:false, width:130 },
  // ── OCEAN Profile ──
  { key:'oceanExtraversion',      label:'OCEAN: Extraversion',    visible:false, width:150 },
  { key:'oceanAgreeableness',     label:'OCEAN: Agreeableness',   visible:false, width:155 },
  { key:'oceanConscientiousness', label:'OCEAN: Conscientious.',  visible:false, width:165 },
  { key:'oceanNeuroticism',       label:'OCEAN: Neuroticism',     visible:false, width:150 },
  { key:'oceanOpenness',          label:'OCEAN: Openness',        visible:false, width:140 },
  // ── Campaign / Event ──
  { key:'campaignType',           label:'Campaign Type',          visible:false, width:140 },
  { key:'campaignName',           label:'Campaign Name',          visible:false, width:160 },
  { key:'campaignStart',          label:'Camp. Start',            visible:false, width:120 },
  { key:'campaignEnd',            label:'Camp. End',              visible:false, width:120 },
];

// Role meta — labels + notes come from translations by key.
const ROLES = [
  { key:'admin',     labelKey:'columns.role.admin',     noteKey:'columns.role.admin.note' },
  { key:'manager',   labelKey:'columns.role.manager',   noteKey:'columns.role.manager.note' },
  { key:'director',  labelKey:'columns.role.director',  noteKey:'columns.role.director.note' },
  { key:'counselor', labelKey:'columns.role.counselor', noteKey:'columns.role.counselor.note' },
];

// Return the translated label for a column key, or the master fallback.
function colLabel(col, language) {
  const key = `leads.col.${col.key}`;
  // If the translation file has a key for this column, use it.
  if (enStrings[key] !== undefined) return t(key, language);
  return col.label;
}

// Simple {placeholder} templating.
function fmt(str, params) {
  if (!params) return str;
  return Object.keys(params).reduce(
    (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]),
    str
  );
}

function buildDefault(roleKey) {
  return MASTER_COLUMNS.map(c => ({
    ...c,
    visible: roleKey === 'admin' ? true : c.visible,
  }));
}

function mergeWithMaster(saved, roleKey) {
  const savedKeys = new Set(saved.map(c => c.key));
  const merged = [
    ...saved.map(c => ({
      ...c,
      visible: roleKey === 'admin' ? true : c.visible,
    })),
    ...MASTER_COLUMNS
      .filter(c => !savedKeys.has(c.key))
      .map(c => ({ ...c, visible: roleKey === 'admin' })),
  ];
  return merged;
}

export default function ColumnLayoutSettings() {
  const navigate  = useNavigate();
  const { language } = useLanguage();
  const dragIdx   = useRef(null);
  const dragRole  = useRef(null);

  const [activeRole, setActiveRole] = useState('admin');
  const [saving, setSaving]         = useState(null);
  const [savedRole, setSavedRole]   = useState(null);
  const [loadError, setLoadError]   = useState('');

  const [configs, setConfigs] = useState(() => {
    const c = {};
    ROLES.forEach(r => { c[r.key] = buildDefault(r.key); });
    return c;
  });

  useEffect(() => {
    Promise.all(
      ROLES.map(r =>
        columnConfigAPI.get(`leads_${r.key}`)
          .then(d => ({ key: r.key, data: d?.data || null }))
          .catch(() => ({ key: r.key, data: null }))
      )
    ).then(results => {
      setConfigs(prev => {
        const next = { ...prev };
        results.forEach(({ key, data }) => {
          if (data && data.length > 0) {
            next[key] = mergeWithMaster(data, key);
          } else {
            next[key] = buildDefault(key);
          }
        });
        return next;
      });
    }).catch(() => setLoadError(t('columns.loadFailed', language)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleVisible(role, colKey) {
    if (role === 'admin') return;
    setConfigs(cfg => ({
      ...cfg,
      [role]: cfg[role].map(c => c.key === colKey ? { ...c, visible: !c.visible } : c),
    }));
  }

  function onDragStart(e, role, idx) {
    dragIdx.current  = idx;
    dragRole.current = role;
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, role, idx) {
    e.preventDefault();
    if (dragRole.current !== role) return;
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setConfigs(cfg => {
      const cols = [...cfg[role]];
      const [moved] = cols.splice(dragIdx.current, 1);
      cols.splice(idx, 0, moved);
      dragIdx.current = idx;
      return { ...cfg, [role]: cols };
    });
  }

  function onDragEnd() {
    dragIdx.current  = null;
    dragRole.current = null;
  }

  async function saveRole(role) {
    setSaving(role);
    try {
      await columnConfigAPI.save(`leads_${role}`, configs[role]);
      setSavedRole(role);
      setTimeout(() => setSavedRole(r => r === role ? null : r), 2500);
    } catch(e) {
      alert(fmt(t('columns.error.saveRole', language), { role, error: e.message }));
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    setSaving('all');
    try {
      await Promise.all(
        ROLES.map(r => columnConfigAPI.save(`leads_${r.key}`, configs[r.key]))
      );
      setSavedRole('all');
      setTimeout(() => setSavedRole(null), 2500);
    } catch(e) {
      alert(fmt(t('columns.error.saveAll', language), { error: e.message }));
    } finally {
      setSaving(null);
    }
  }

  function resetRole(role) {
    const roleLbl = t(`columns.role.${role}`, language);
    if (!confirm(fmt(t('columns.confirmReset', language), { role: roleLbl }))) return;
    setConfigs(cfg => ({ ...cfg, [role]: buildDefault(role) }));
  }

  const currentCols    = configs[activeRole] || [];
  const visibleCount   = currentCols.filter(c => c.visible).length;
  const activeRoleInfo = ROLES.find(r => r.key === activeRole);
  const activeRoleLbl  = activeRoleInfo ? t(activeRoleInfo.labelKey, language) : '';
  const activeRoleNote = activeRoleInfo ? t(activeRoleInfo.noteKey,  language) : '';

  const hiddenCount = currentCols.filter(c => !c.visible).length;
  const hiddenPlural = language === 'vi' ? '' : (hiddenCount !== 1 ? 's' : '');

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/leads')}>
            <FiArrowLeft size={16}/>
          </button>
          <span className="page-title">{t('columns.title', language)}</span>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {savedRole === 'all' && (
            <span style={{ fontSize:'0.8125rem', color:'#16a34a', display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <FiCheck size={14}/> {t('columns.allSaved', language)}
            </span>
          )}
          <button
            className="btn btn--primary btn--sm"
            onClick={saveAll}
            disabled={!!saving}
            style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <FiSave size={13}/>
            {saving === 'all' ? t('common.saving', language) : t('columns.saveAll', language)}
          </button>
        </div>
      </div>

      <div className="page-body">
        {loadError && (
          <div className="alert alert--warning" style={{ marginBottom:'1rem' }}>{loadError}</div>
        )}

        <p style={{ margin:'0 0 1.25rem', fontSize:'0.875rem', color:'var(--text-secondary)' }}>
          {t('columns.description', language)}
        </p>

        {/* ── Role tabs ────────────────────────────────────── */}
        <div style={{ display:'flex', borderBottom:'2px solid var(--border)', marginBottom:'1.5rem' }}>
          {ROLES.map(r => (
            <button key={r.key} onClick={() => setActiveRole(r.key)} style={{
              padding:'0.625rem 1.5rem',
              border:'none',
              background: activeRole === r.key ? 'var(--bg-primary)' : 'transparent',
              borderBottom: activeRole === r.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom:'-2px',
              color: activeRole === r.key ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: activeRole === r.key ? 600 : 400,
              cursor:'pointer',
              fontSize:'0.9rem',
              transition:'all 0.15s',
            }}>
              {t(r.labelKey, language)}
              {savedRole === r.key && (
                <span style={{ marginLeft:'0.4rem', color:'#16a34a', fontSize:'0.75rem' }}>✓</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Two-column layout: editor left, preview right ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:'1.5rem', alignItems:'start' }}>

          {/* Left: Column editor */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
              <div>
                <span style={{ fontWeight:600, fontSize:'0.9375rem' }}>
                  {fmt(t('columns.roleLayoutTitle', language), { role: activeRoleLbl })}
                </span>
                <span style={{ marginLeft:'0.75rem', fontSize:'0.8rem', color:'var(--text-secondary)' }}>
                  {activeRoleNote}
                </span>
              </div>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => resetRole(activeRole)}
                  disabled={!!saving}>
                  {t('columns.resetDefaults', language)}
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => saveRole(activeRole)}
                  disabled={!!saving}
                  style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  {saving === activeRole
                    ? t('common.saving', language)
                    : savedRole === activeRole
                      ? <><FiCheck size={12}/> {t('columns.saved', language)}</>
                      : <><FiSave size={12}/> {t('columns.saveThisRole', language)}</>}
                </button>
              </div>
            </div>

            {/* Column list */}
            <div style={{ border:'1px solid var(--border)', borderRadius:'10px', overflow:'hidden' }}>
              {/* Header row */}
              <div style={{
                display:'grid', gridTemplateColumns:'28px 1fr 60px',
                padding:'0.5rem 1rem',
                background:'var(--bg-secondary)',
                borderBottom:'1px solid var(--border)',
                fontSize:'0.75rem', fontWeight:600, color:'var(--text-secondary)',
              }}>
                <span></span>
                <span>{t('columns.header.column', language)}</span>
                <span style={{ textAlign:'center' }}>{t('columns.header.visible', language)}</span>
              </div>

              {currentCols.map((col, idx) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={e => onDragStart(e, activeRole, idx)}
                  onDragOver={e => onDragOver(e, activeRole, idx)}
                  onDragEnd={onDragEnd}
                  style={{
                    display:'grid', gridTemplateColumns:'28px 1fr 60px',
                    alignItems:'center',
                    padding:'0.625rem 1rem',
                    borderBottom: idx < currentCols.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor:'grab',
                    background: col.visible ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                    opacity: col.visible ? 1 : 0.55,
                    transition:'opacity 0.15s',
                  }}>
                  <span style={{ color:'var(--text-secondary)', fontSize:'0.875rem', cursor:'grab' }}>⠿</span>
                  <span style={{ fontSize:'0.875rem' }}>{colLabel(col, language)}</span>
                  <div style={{ display:'flex', justifyContent:'center' }}>
                    {activeRole === 'admin' ? (
                      <span style={{ color:'var(--primary)', opacity:0.6 }} title={t('columns.tooltip.alwaysVisible', language)}>
                        <FiEye size={16}/>
                      </span>
                    ) : (
                      <button
                        onClick={() => toggleVisible(activeRole, col.key)}
                        title={col.visible ? t('columns.tooltip.clickHide', language) : t('columns.tooltip.clickShow', language)}
                        style={{
                          background:'none', border:'none', cursor:'pointer', padding:'0.25rem',
                          color: col.visible ? 'var(--primary)' : 'var(--text-secondary)',
                          borderRadius:'4px',
                        }}>
                        {col.visible ? <FiEye size={16}/> : <FiEyeOff size={16}/>}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Preview panel */}
          <div style={{ position:'sticky', top:'72px' }}>
            <div style={{ fontWeight:600, fontSize:'0.875rem', marginBottom:'0.75rem' }}>
              {fmt(t('columns.preview.title', language), { n: visibleCount })}
            </div>
            <div style={{ border:'1px solid var(--border)', borderRadius:'10px', overflow:'hidden' }}>
              <div style={{
                background:'var(--bg-secondary)', padding:'0.5rem 0.875rem',
                fontSize:'0.7rem', fontWeight:600, color:'var(--text-secondary)',
                borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.5px',
              }}>
                {t('columns.preview.visibleCols', language)}
              </div>
              {currentCols.filter(c => c.visible).map((col, idx) => (
                <div key={col.key} style={{
                  display:'flex', alignItems:'center', gap:'0.5rem',
                  padding:'0.4rem 0.875rem',
                  borderBottom:'1px solid var(--border)',
                  fontSize:'0.8125rem',
                }}>
                  <span style={{
                    color:'var(--text-secondary)', fontSize:'0.7rem',
                    fontFamily:'DM Mono', minWidth:'18px',
                  }}>
                    {idx + 1}
                  </span>
                  <span>{colLabel(col, language)}</span>
                </div>
              ))}
              {visibleCount === 0 && (
                <div style={{ padding:'1rem', color:'var(--text-secondary)', fontSize:'0.875rem', textAlign:'center' }}>
                  {t('columns.preview.noneVisible', language)}
                </div>
              )}

              {/* Hidden columns count */}
              {hiddenCount > 0 && (
                <div style={{
                  padding:'0.5rem 0.875rem',
                  background:'var(--bg-secondary)',
                  fontSize:'0.75rem', color:'var(--text-secondary)',
                  borderTop:'1px solid var(--border)',
                }}>
                  {fmt(t('columns.preview.hidden', language), { n: hiddenCount, plural: hiddenPlural })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
