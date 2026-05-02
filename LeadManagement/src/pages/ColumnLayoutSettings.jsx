// src/pages/ColumnLayoutSettings.jsx
// -----------------------------------------------------------------------------
// CHANGES (Phase 2c — dual-page field configuration):
//   - Side-by-side editor: Leads list columns (left) + Lead Detail fields (right).
//   - New MASTER_DETAIL_FIELDS array describing fields shown on Lead Detail.
//   - Each role has TWO saved configs:
//       leads_<role>        — column visibility/order for the Leads table
//       lead_detail_<role>  — field visibility for the Lead Detail page
//   - Save / Save All / Reset operate on BOTH panels for the active role.
//   - Drag-and-drop reorder is kept for Leads columns only (table column
//     order matters). Lead Detail fields are show/hide only because their
//     section order is fixed in LeadDetail.jsx.
//
// IMPORTANT — for the Lead Detail visibility flags to actually take effect,
// LeadDetail.jsx needs corresponding `if (visible)` guards around each field.
// That work is intentionally separate (it touches a large file) — until then,
// LeadDetail will continue showing all fields regardless of what's saved here,
// but the configs ARE persisted, so once the LeadDetail wiring is in place
// the saved settings activate immediately.
//
// CHANGES (i18n Phase 2b — preserved):
//   - All UI chrome (headers, buttons, confirms, notes) uses t().
//   - Role tab labels use t('columns.role.*').
//   - Column labels in the editor look up t('leads.col.<key>') with
//     MASTER_COLUMNS / MASTER_DETAIL_FIELDS labels as English fallback.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { columnConfigAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { t, en as enStrings } from '../i18n';
import { FiArrowLeft, FiEye, FiEyeOff, FiSave, FiCheck } from 'react-icons/fi';

// =============================================================================
// MASTER LISTS
// =============================================================================

// ── Leads list columns ─────────────────────────────────────────
// Must stay in sync with MASTER_COLUMNS in Leads.jsx.
const MASTER_COLUMNS = [
  // ── Personal Details ──
  { key:'fullName',               label:'Name',                   visible:true,  width:160 },
  { key:'email',                  label:'Email',                  visible:false, width:190 },
  { key:'phone',                  label:'Phone',                  visible:false, width:130 },
  { key:'yearOfBirth',            label:'Year of Birth',          visible:false, width:110 },
  { key:'residency',              label:'Residency',              visible:false, width:140 },
  { key:'schoolEvent',            label:'School / Event',         visible:false, width:150 },
  { key:'referralSource',         label:'Referral Source',        visible:false, width:140 },
  { key:'facebookProfile',        label:'Facebook Profile',       visible:false, width:160 },
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
  { key:'campaignName',           label:'Event Name',             visible:false, width:160 },
  { key:'campaignStart',          label:'Event Start',            visible:false, width:120 },
  { key:'campaignEnd',            label:'Event End',              visible:false, width:120 },
];

// ── Lead Detail page fields ────────────────────────────────────
// Order is informational only — actual layout in LeadDetail.jsx is fixed.
// `visible: true` means default-shown for non-admin roles. Admin always sees.
// `isSection: true` flags rows that toggle a whole UI section (e.g. all 15
// OCEAN questions, the radar chart, or one of the three Notes panels) rather
// than a single labelled field.
const MASTER_DETAIL_FIELDS = [
  // ── Personal Details ──
  { key:'fullName',         label:'Full Name',          section:'Personal Details', visible:true  },
  { key:'email',            label:'Email',              section:'Personal Details', visible:true  },
  { key:'phone',            label:'Phone',              section:'Personal Details', visible:true  },
  { key:'yearOfBirth',      label:'Year of Birth',      section:'Personal Details', visible:true  },
  { key:'residency',        label:'Residency',          section:'Personal Details', visible:true  },
  { key:'schoolEvent',      label:'School / Event',     section:'Personal Details', visible:true  },
  { key:'referralSource',   label:'Referral Source',    section:'Personal Details', visible:true  },
  { key:'facebookProfile',  label:'Facebook Profile',   section:'Personal Details', visible:true  },
  { key:'headshotUrl',      label:'Lead Photo',         section:'Personal Details', visible:true  },
  { key:'qrCodeImageUrl',   label:'QR Code Image',      section:'Personal Details', visible:true  },
  { key:'uniqueId',         label:'Lead ID',            section:'Personal Details', visible:true  },
  { key:'createdAt',        label:'Created Date',       section:'Personal Details', visible:true  },
  { key:'updatedAt',        label:'Last Updated',       section:'Personal Details', visible:true  },

  // ── Lead Management ──
  { key:'leadStatus',       label:'Status',             section:'Lead Management',  visible:true  },
  { key:'leadSource',       label:'Lead Source',        section:'Lead Management',  visible:true  },
  { key:'interaction',      label:'Interaction',        section:'Lead Management',  visible:true  },
  { key:'studyPlans',       label:'Study Plans',        section:'Lead Management',  visible:true  },
  { key:'destinationCountry',label:'Destination',       section:'Lead Management',  visible:true  },
  { key:'timeline',         label:'Timeline',           section:'Lead Management',  visible:true  },
  { key:'stoneTier',        label:'Stone Tier',         section:'Lead Management',  visible:true  },
  { key:'riskScore',        label:'Risk Score',         section:'Lead Management',  visible:true  },
  { key:'closeDate',        label:'Close Date',         section:'Lead Management',  visible:true  },
  { key:'confidence',       label:'Confidence',         section:'Lead Management',  visible:true  },

  // ── Staff Assignment ──
  { key:'counselor',        label:'Counselor',          section:'Staff Assignment', visible:true  },
  { key:'seniorCounselor',  label:'Senior Counselor',   section:'Staff Assignment', visible:true  },
  { key:'presales',         label:'Pre-Sales',          section:'Staff Assignment', visible:true  },
  { key:'marketingStaff',   label:'Marketing',          section:'Staff Assignment', visible:true  },

  // ── Self Assessment ──
  { key:'budget',           label:'Budget',             section:'Self Assessment',  visible:true  },
  { key:'scholarshipDemand',label:'Scholarship',        section:'Self Assessment',  visible:true  },
  { key:'englishLevel',     label:'English Level',      section:'Self Assessment',  visible:true  },
  { key:'gpa',              label:'GPA',                section:'Self Assessment',  visible:true  },
  { key:'immigrationHistory',label:'Immigration History',section:'Self Assessment', visible:true  },
  { key:'sponsorIncome',    label:'Sponsor Income',     section:'Self Assessment',  visible:false }, // sensitive
  { key:'incomeEvidence',   label:'Income Evidence',    section:'Self Assessment',  visible:false }, // sensitive
  { key:'studyPlanGap',     label:'Study Plan Gap',     section:'Self Assessment',  visible:true  },
  { key:'ultimateObjective',label:'Ultimate Objective', section:'Self Assessment',  visible:true  },

  // ── Family Contacts ──
  { key:'motherFullName',     label:'Mother Name',           section:'Family Contacts', visible:true },
  { key:'motherEmail',        label:'Mother Email',          section:'Family Contacts', visible:true },
  { key:'motherPhone',        label:'Mother Phone',          section:'Family Contacts', visible:true },
  { key:'motherContactMedium',label:'Mother Contact Medium', section:'Family Contacts', visible:true },
  { key:'motherContactDetail',label:'Mother Contact Detail', section:'Family Contacts', visible:true },
  { key:'fatherFullName',     label:'Father Name',           section:'Family Contacts', visible:true },
  { key:'fatherEmail',        label:'Father Email',          section:'Family Contacts', visible:true },
  { key:'fatherPhone',        label:'Father Phone',          section:'Family Contacts', visible:true },
  { key:'fatherContactMedium',label:'Father Contact Medium', section:'Family Contacts', visible:true },
  { key:'fatherContactDetail',label:'Father Contact Detail', section:'Family Contacts', visible:true },

  // ── OCEAN Profile ──
  { key:'oceanExtraversion',     label:'Extraversion (score)',     section:'OCEAN Profile', visible:true },
  { key:'oceanAgreeableness',    label:'Agreeableness (score)',    section:'OCEAN Profile', visible:true },
  { key:'oceanConscientiousness',label:'Conscientiousness (score)',section:'OCEAN Profile', visible:true },
  { key:'oceanNeuroticism',      label:'Neuroticism (score)',      section:'OCEAN Profile', visible:true },
  { key:'oceanOpenness',         label:'Openness (score)',         section:'OCEAN Profile', visible:true },
  { key:'oceanNarrative',        label:'OCEAN Narrative (text summary)', section:'OCEAN Profile', visible:true },
  { key:'oceanQuestionnaire',    label:'15 OCEAN Questions',       section:'OCEAN Profile', visible:true, isSection:true },
  { key:'oceanRadarChart',       label:'OCEAN Radar Chart',        section:'OCEAN Profile', visible:true, isSection:true },

  // ── Campaign / Event ──
  { key:'campaignType',     label:'Campaign Type',     section:'Campaign / Event', visible:true },
  { key:'campaignName',     label:'Event Name',        section:'Campaign / Event', visible:true },
  { key:'campaignStart',    label:'Event Start Date',  section:'Campaign / Event', visible:true },
  { key:'campaignEnd',      label:'Event End Date',    section:'Campaign / Event', visible:true },

  // ── Notes & History (always section toggles) ──
  { key:'notesCounselor',   label:'Counselor Notes section',     section:'Notes & History', visible:true,  isSection:true },
  { key:'notesPresales',    label:'Pre-Sales Notes section',     section:'Notes & History', visible:true,  isSection:true },
  { key:'notesManagement',  label:'Management Notes section',    section:'Notes & History', visible:false, isSection:true }, // Director/Manager/Admin only
  { key:'changeHistory',    label:'Change History / Audit Log',  section:'Notes & History', visible:true,  isSection:true },
];

// ── Roles ──────────────────────────────────────────────────────
const ROLES = [
  { key:'admin',     labelKey:'columns.role.admin',     noteKey:'columns.role.admin.note' },
  { key:'manager',   labelKey:'columns.role.manager',   noteKey:'columns.role.manager.note' },
  { key:'director',  labelKey:'columns.role.director',  noteKey:'columns.role.director.note' },
  { key:'counselor', labelKey:'columns.role.counselor', noteKey:'columns.role.counselor.note' },
];

// =============================================================================
// HELPERS
// =============================================================================

// Translated column label or master fallback.
function colLabel(col, language) {
  const key = `leads.col.${col.key}`;
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

// ── Defaults / merge for Leads list config ─────────────────────
function buildLeadsDefault(roleKey) {
  return MASTER_COLUMNS.map(c => ({
    ...c,
    visible: roleKey === 'admin' ? true : c.visible,
  }));
}

function mergeLeadsWithMaster(saved, roleKey) {
  const savedKeys = new Set(saved.map(c => c.key));
  return [
    ...saved.map(c => ({
      ...c,
      visible: roleKey === 'admin' ? true : c.visible,
    })),
    ...MASTER_COLUMNS
      .filter(c => !savedKeys.has(c.key))
      .map(c => ({ ...c, visible: roleKey === 'admin' })),
  ];
}

// ── Defaults / merge for Lead Detail config ────────────────────
function buildDetailDefault(roleKey) {
  return MASTER_DETAIL_FIELDS.map(f => ({
    ...f,
    visible: roleKey === 'admin' ? true : f.visible,
  }));
}

function mergeDetailWithMaster(saved, roleKey) {
  const savedKeys = new Set(saved.map(f => f.key));
  return [
    // First: keep any master field with its saved visibility, in master order
    ...MASTER_DETAIL_FIELDS.map(master => {
      const found = saved.find(s => s.key === master.key);
      if (!found) {
        return { ...master, visible: roleKey === 'admin' ? true : master.visible };
      }
      return {
        ...master,
        visible: roleKey === 'admin' ? true : !!found.visible,
      };
    }),
    // Anything saved that's not in master (legacy keys) — drop it
  ];
  // (Detail has no reorder, so we always present in master order.)
}

// =============================================================================
// COMPONENT
// =============================================================================
export default function ColumnLayoutSettings() {
  const navigate     = useNavigate();
  const { language } = useLanguage();
  const dragIdx      = useRef(null);
  const dragRole     = useRef(null);

  const [activeRole, setActiveRole] = useState('admin');
  const [saving,     setSaving]     = useState(null);     // null | role key | 'all'
  const [savedRole,  setSavedRole]  = useState(null);     // null | role key | 'all'
  const [loadError,  setLoadError]  = useState('');

  // Two configs per role — leads list and lead detail.
  const [leadsCfg,  setLeadsCfg]  = useState(() => {
    const c = {};
    ROLES.forEach(r => { c[r.key] = buildLeadsDefault(r.key); });
    return c;
  });
  const [detailCfg, setDetailCfg] = useState(() => {
    const c = {};
    ROLES.forEach(r => { c[r.key] = buildDetailDefault(r.key); });
    return c;
  });

  // ── Initial load: fetch both config types for every role ──
  useEffect(() => {
    const leadsLoads = ROLES.map(r =>
      columnConfigAPI.get(`leads_${r.key}`)
        .then(d => ({ key: r.key, data: d?.data || null }))
        .catch(() => ({ key: r.key, data: null }))
    );
    const detailLoads = ROLES.map(r =>
      columnConfigAPI.get(`lead_detail_${r.key}`)
        .then(d => ({ key: r.key, data: d?.data || null }))
        .catch(() => ({ key: r.key, data: null }))
    );

    Promise.all(leadsLoads).then(results => {
      setLeadsCfg(prev => {
        const next = { ...prev };
        results.forEach(({ key, data }) => {
          next[key] = (data && data.length > 0)
            ? mergeLeadsWithMaster(data, key)
            : buildLeadsDefault(key);
        });
        return next;
      });
    });

    Promise.all(detailLoads).then(results => {
      setDetailCfg(prev => {
        const next = { ...prev };
        results.forEach(({ key, data }) => {
          next[key] = (data && data.length > 0)
            ? mergeDetailWithMaster(data, key)
            : buildDetailDefault(key);
        });
        return next;
      });
    }).catch(() => setLoadError(t('columns.loadFailed', language)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle visibility ──
  function toggleLeadsVisible(role, colKey) {
    if (role === 'admin') return;
    setLeadsCfg(cfg => ({
      ...cfg,
      [role]: cfg[role].map(c => c.key === colKey ? { ...c, visible: !c.visible } : c),
    }));
  }

  function toggleDetailVisible(role, fieldKey) {
    if (role === 'admin') return;
    setDetailCfg(cfg => ({
      ...cfg,
      [role]: cfg[role].map(f => f.key === fieldKey ? { ...f, visible: !f.visible } : f),
    }));
  }

  // ── Drag-and-drop reorder (Leads list only) ──
  function onDragStart(e, role, idx) {
    dragIdx.current  = idx;
    dragRole.current = role;
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, role, idx) {
    e.preventDefault();
    if (dragRole.current !== role) return;
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setLeadsCfg(cfg => {
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

  // ── Save / Reset ──
  async function saveRole(role) {
    setSaving(role);
    try {
      await Promise.all([
        columnConfigAPI.save(`leads_${role}`,        leadsCfg[role]),
        columnConfigAPI.save(`lead_detail_${role}`,  detailCfg[role]),
      ]);
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
      const ops = [];
      ROLES.forEach(r => {
        ops.push(columnConfigAPI.save(`leads_${r.key}`,       leadsCfg[r.key]));
        ops.push(columnConfigAPI.save(`lead_detail_${r.key}`, detailCfg[r.key]));
      });
      await Promise.all(ops);
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
    setLeadsCfg(cfg  => ({ ...cfg,  [role]: buildLeadsDefault(role)  }));
    setDetailCfg(cfg => ({ ...cfg,  [role]: buildDetailDefault(role) }));
  }

  // ── Derived for the active role ──
  const currentLeadsCols  = leadsCfg[activeRole]  || [];
  const currentDetailFlds = detailCfg[activeRole] || [];
  const leadsVisibleCount  = currentLeadsCols.filter(c => c.visible).length;
  const detailVisibleCount = currentDetailFlds.filter(f => f.visible).length;
  const detailTotalCount   = currentDetailFlds.length;
  const activeRoleInfo = ROLES.find(r => r.key === activeRole);
  const activeRoleLbl  = activeRoleInfo ? t(activeRoleInfo.labelKey, language) : '';
  const activeRoleNote = activeRoleInfo ? t(activeRoleInfo.noteKey,  language) : '';

  // Group detail fields by section for rendering.
  const detailBySection = currentDetailFlds.reduce((acc, f) => {
    if (!acc[f.section]) acc[f.section] = [];
    acc[f.section].push(f);
    return acc;
  }, {});
  const detailSectionOrder = [...new Set(currentDetailFlds.map(f => f.section))];

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
        <div style={{ display:'flex', borderBottom:'2px solid var(--border)', marginBottom:'1.5rem', flexWrap:'wrap' }}>
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

        {/* ── Active role context strip ─────────────────────── */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem', gap:'0.75rem', flexWrap:'wrap' }}>
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

        {/* ── Side-by-side: Leads list editor (left) | Lead Detail editor (right) ── */}
        <div className="column-settings-grid">

          {/* ── LEFT: Leads list columns editor ──────────── */}
          <div>
            <div className="column-settings-panel-header">
              <span className="column-settings-panel-title">Leads List Page</span>
              <span className="column-settings-panel-count">
                {leadsVisibleCount} / {currentLeadsCols.length} visible
              </span>
            </div>
            <div className="column-settings-panel-hint">
              Drag rows to reorder. Click the eye to show/hide.
            </div>

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

              {currentLeadsCols.map((col, idx) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={e => onDragStart(e, activeRole, idx)}
                  onDragOver={e => onDragOver(e, activeRole, idx)}
                  onDragEnd={onDragEnd}
                  style={{
                    display:'grid', gridTemplateColumns:'28px 1fr 60px',
                    alignItems:'center',
                    padding:'0.5rem 1rem',
                    borderBottom: idx < currentLeadsCols.length - 1 ? '1px solid var(--border)' : 'none',
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
                        onClick={() => toggleLeadsVisible(activeRole, col.key)}
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

          {/* ── RIGHT: Lead Detail fields editor ─────────── */}
          <div>
            <div className="column-settings-panel-header">
              <span className="column-settings-panel-title">Lead Detail Page</span>
              <span className="column-settings-panel-count">
                {detailVisibleCount} / {detailTotalCount} visible
              </span>
            </div>
            <div className="column-settings-panel-hint">
              Click the eye to show/hide on the Lead Detail page.
              Items marked <em>(section)</em> toggle a whole UI section, not just one field.
            </div>

            <div style={{ border:'1px solid var(--border)', borderRadius:'10px', overflow:'hidden' }}>
              {detailSectionOrder.map(section => (
                <div key={section}>
                  {/* Section header row */}
                  <div style={{
                    padding:'0.5rem 1rem',
                    background:'var(--bg-secondary)',
                    borderBottom:'1px solid var(--border)',
                    borderTop: section === detailSectionOrder[0] ? 'none' : '1px solid var(--border)',
                    fontSize:'0.7rem', fontWeight:600, color:'var(--text-secondary)',
                    textTransform:'uppercase', letterSpacing:'0.04em',
                  }}>
                    {section}
                  </div>

                  {detailBySection[section].map((f, idx, arr) => (
                    <div key={f.key}
                      style={{
                        display:'grid', gridTemplateColumns:'1fr 60px',
                        alignItems:'center',
                        padding:'0.5rem 1rem',
                        borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
                        background: f.visible ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                        opacity: f.visible ? 1 : 0.55,
                        transition:'opacity 0.15s',
                      }}>
                      <div style={{ fontSize:'0.875rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                        <span>{f.label}</span>
                        {f.isSection && (
                          <span style={{
                            fontSize:'0.65rem', fontStyle:'italic', color:'var(--text-secondary)',
                            background:'#FEF3C7', padding:'1px 5px', borderRadius:'3px',
                          }}>
                            section
                          </span>
                        )}
                      </div>
                      <div style={{ display:'flex', justifyContent:'center' }}>
                        {activeRole === 'admin' ? (
                          <span style={{ color:'var(--primary)', opacity:0.6 }} title={t('columns.tooltip.alwaysVisible', language)}>
                            <FiEye size={16}/>
                          </span>
                        ) : (
                          <button
                            onClick={() => toggleDetailVisible(activeRole, f.key)}
                            title={f.visible ? t('columns.tooltip.clickHide', language) : t('columns.tooltip.clickShow', language)}
                            style={{
                              background:'none', border:'none', cursor:'pointer', padding:'0.25rem',
                              color: f.visible ? 'var(--primary)' : 'var(--text-secondary)',
                              borderRadius:'4px',
                            }}>
                            {f.visible ? <FiEye size={16}/> : <FiEyeOff size={16}/>}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── Footer note about LeadDetail wiring ─────────── */}
        <p style={{ marginTop:'1.5rem', fontSize:'0.75rem', color:'var(--text-secondary)', fontStyle:'italic' }}>
          Note: Lead Detail field permissions are saved per role, but the Lead Detail page does not yet
          read these settings — every field still shows. The page-level wiring is a follow-up change;
          your settings here will activate once that&apos;s in place.
        </p>
      </div>
    </div>
  );
}
