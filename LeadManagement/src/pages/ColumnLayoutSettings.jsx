// LeadManagement/src/pages/ColumnLayoutSettings.jsx
// NEW FILE — Admin-only settings page
// Accessible at /settings/columns
// Allows Admin to configure which columns are visible and in what order for each role

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { columnConfigAPI } from '../services/api';
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

const ROLES = [
  { key:'admin',     label:'Admin',    note:'All columns always visible — order only' },
  { key:'manager',   label:'Manager',  note:'Drag to reorder • Toggle to show/hide' },
  { key:'director',  label:'Director', note:'Drag to reorder • Toggle to show/hide' },
  { key:'counselor', label:'Counselor',note:'Drag to reorder • Toggle to show/hide' },
];

// Build default config for a role (admin = all visible, others = MASTER_COLUMNS defaults)
function buildDefault(roleKey) {
  return MASTER_COLUMNS.map(c => ({
    ...c,
    visible: roleKey === 'admin' ? true : c.visible,
  }));
}

// Merge saved config with master — ensures any new columns added to master appear
function mergeWithMaster(saved, roleKey) {
  const savedKeys = new Set(saved.map(c => c.key));
  const merged = [
    ...saved.map(c => ({
      ...c,
      visible: roleKey === 'admin' ? true : c.visible,
    })),
    // New columns not yet in saved config go at end, hidden (except admin)
    ...MASTER_COLUMNS
      .filter(c => !savedKeys.has(c.key))
      .map(c => ({ ...c, visible: roleKey === 'admin' })),
  ];
  return merged;
}

export default function ColumnLayoutSettings() {
  const navigate  = useNavigate();
  const dragIdx   = useRef(null);
  const dragRole  = useRef(null);

  const [activeRole, setActiveRole] = useState('admin');
  const [saving, setSaving]         = useState(null);   // role key or 'all'
  const [savedRole, setSavedRole]   = useState(null);   // for green tick feedback
  const [loadError, setLoadError]   = useState('');

  // configs holds the column array for each role
  const [configs, setConfigs] = useState(() => {
    const c = {};
    ROLES.forEach(r => { c[r.key] = buildDefault(r.key); });
    return c;
  });

  // ── Load all role configs on mount ─────────────────────────
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
    }).catch(() => setLoadError('Failed to load some column configs.'));
  }, []);

  // ── Toggle column visibility ───────────────────────────────
  function toggleVisible(role, colKey) {
    if (role === 'admin') return; // Admin always sees all
    setConfigs(cfg => ({
      ...cfg,
      [role]: cfg[role].map(c => c.key === colKey ? { ...c, visible: !c.visible } : c),
    }));
  }

  // ── Drag to reorder ────────────────────────────────────────
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

  // ── Save a single role ─────────────────────────────────────
  async function saveRole(role) {
    setSaving(role);
    try {
      await columnConfigAPI.save(`leads_${role}`, configs[role]);
      setSavedRole(role);
      setTimeout(() => setSavedRole(r => r === role ? null : r), 2500);
    } catch(e) {
      alert(`Failed to save ${role} layout: ${e.message}`);
    } finally {
      setSaving(null);
    }
  }

  // ── Save all roles at once ─────────────────────────────────
  async function saveAll() {
    setSaving('all');
    try {
      await Promise.all(
        ROLES.map(r => columnConfigAPI.save(`leads_${r.key}`, configs[r.key]))
      );
      setSavedRole('all');
      setTimeout(() => setSavedRole(null), 2500);
    } catch(e) {
      alert(`Failed to save all layouts: ${e.message}`);
    } finally {
      setSaving(null);
    }
  }

  // ── Reset a role to defaults ───────────────────────────────
  function resetRole(role) {
    if (!confirm(`Reset ${role} layout to system defaults? This cannot be undone.`)) return;
    setConfigs(cfg => ({ ...cfg, [role]: buildDefault(role) }));
  }

  const currentCols  = configs[activeRole] || [];
  const visibleCount = currentCols.filter(c => c.visible).length;
  const activeRoleInfo = ROLES.find(r => r.key === activeRole);

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/leads')}>
            <FiArrowLeft size={16}/>
          </button>
          <span className="page-title">Column Layout Settings</span>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {savedRole === 'all' && (
            <span style={{ fontSize:'0.8125rem', color:'#16a34a', display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <FiCheck size={14}/> All saved
            </span>
          )}
          <button
            className="btn btn--primary btn--sm"
            onClick={saveAll}
            disabled={!!saving}
            style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <FiSave size={13}/>
            {saving === 'all' ? 'Saving...' : 'Save All Roles'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {loadError && (
          <div className="alert alert--warning" style={{ marginBottom:'1rem' }}>{loadError}</div>
        )}

        <p style={{ margin:'0 0 1.25rem', fontSize:'0.875rem', color:'var(--text-secondary)' }}>
          Configure which columns are visible in the Leads table for each role.
          Changes take effect immediately when users next load the Leads page.
          Drag rows to reorder. Admin always sees all columns.
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
              {r.label}
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
                  {activeRoleInfo?.label} Layout
                </span>
                <span style={{ marginLeft:'0.75rem', fontSize:'0.8rem', color:'var(--text-secondary)' }}>
                  {activeRoleInfo?.note}
                </span>
              </div>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => resetRole(activeRole)}
                  disabled={!!saving}>
                  Reset defaults
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => saveRole(activeRole)}
                  disabled={!!saving}
                  style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  {saving === activeRole
                    ? 'Saving...'
                    : savedRole === activeRole
                      ? <><FiCheck size={12}/> Saved</>
                      : <><FiSave size={12}/> Save this role</>}
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
                <span>Column</span>
                <span style={{ textAlign:'center' }}>Visible</span>
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
                  <span style={{ fontSize:'0.875rem' }}>{col.label}</span>
                  <div style={{ display:'flex', justifyContent:'center' }}>
                    {activeRole === 'admin' ? (
                      // Admin: always visible, show locked eye
                      <span style={{ color:'var(--primary)', opacity:0.6 }} title="Always visible for Admin">
                        <FiEye size={16}/>
                      </span>
                    ) : (
                      <button
                        onClick={() => toggleVisible(activeRole, col.key)}
                        title={col.visible ? 'Click to hide' : 'Click to show'}
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
              Preview — {visibleCount} visible
            </div>
            <div style={{ border:'1px solid var(--border)', borderRadius:'10px', overflow:'hidden' }}>
              <div style={{
                background:'var(--bg-secondary)', padding:'0.5rem 0.875rem',
                fontSize:'0.7rem', fontWeight:600, color:'var(--text-secondary)',
                borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.5px',
              }}>
                Visible columns
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
                  <span>{col.label}</span>
                </div>
              ))}
              {visibleCount === 0 && (
                <div style={{ padding:'1rem', color:'var(--text-secondary)', fontSize:'0.875rem', textAlign:'center' }}>
                  No columns visible
                </div>
              )}

              {/* Hidden columns count */}
              {currentCols.filter(c => !c.visible).length > 0 && (
                <div style={{
                  padding:'0.5rem 0.875rem',
                  background:'var(--bg-secondary)',
                  fontSize:'0.75rem', color:'var(--text-secondary)',
                  borderTop:'1px solid var(--border)',
                }}>
                  + {currentCols.filter(c => !c.visible).length} hidden column{currentCols.filter(c => !c.visible).length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
