// src/pages/ColumnLayoutSettings.jsx
// -----------------------------------------------------------------------------
// CHANGES (table-driven RBAC — final pass):
//   - MASTER_COLUMNS array DELETED. The column catalog is now fetched from
//     GET /api/staff/columns (backed by permission_fields). Single source of
//     truth for what columns exist and their default order/width/visibility.
//   - ROLES list DELETED. Role keys are now fetched from GET /api/staff/roles
//     (DISTINCT role from role_permissions). Translation keys are derived
//     from the role name: columns.role.<lowercaseRole>.
//   - buildDefault() and mergeWithMaster() now take the catalog as a
//     parameter rather than referencing a module-level const.
//   - Add a new column to permission_fields and it shows up here AND in
//     the Leads list with NO frontend code changes.
// -----------------------------------------------------------------------------

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { columnConfigAPI, staffAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { t, en as enStrings } from '../i18n';
import { FiArrowLeft, FiEye, FiEyeOff, FiSave, FiCheck } from 'react-icons/fi';

// Return the translated label for a column key, or the catalog fallback.
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

// Build a default column layout for a role from the API catalog.
// Admin sees everything visible by default; other roles use the catalog's
// default visibility (column.visible from permission_fields).
function buildDefault(roleKey, catalog) {
  return catalog.map(c => ({
    ...c,
    visible: roleKey === 'admin' ? true : c.visible,
  }));
}

// Merge a saved per-role config with the master catalog so that newly
// added columns automatically show up (hidden by default, except for admin).
function mergeWithMaster(saved, roleKey, catalog) {
  const savedKeys = new Set(saved.map(c => c.key));
  const merged = [
    ...saved.map(c => ({
      ...c,
      visible: roleKey === 'admin' ? true : c.visible,
    })),
    ...catalog
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

  // Catalog + roles come from the backend (permission_fields + role_permissions).
  // Until they load, the editor shows a loading state instead of stale defaults.
  const [catalog, setCatalog] = useState([]);   // [{key, label, width, visible, ...}]
  const [roles,   setRoles]   = useState([]);   // [{key: 'admin', labelKey, noteKey}]
  const [configs, setConfigs] = useState({});   // { admin: [...], counselor: [...], ... }
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    // Step 1: fetch the column catalog AND the role list in parallel.
    Promise.all([
      staffAPI.listColumns(),
      staffAPI.listRoles(),
    ])
      .then(([colsResp, rolesResp]) => {
        const cat = (colsResp?.data || []).map(c => ({
          key:     c.fieldName,
          label:   c.label,
          width:   c.width || 120,
          visible: c.visible !== undefined ? c.visible : true,
        }));
        const roleObjs = (rolesResp?.data || []).map(r => {
          const k = r.toLowerCase();
          return {
            key:      k,
            labelKey: `columns.role.${k}`,
            noteKey:  `columns.role.${k}.note`,
          };
        });
        setCatalog(cat);
        setRoles(roleObjs);

        // Default active role: first one returned (alphabetical), or 'admin' if present.
        if (roleObjs.length && !roleObjs.find(r => r.key === activeRole)) {
          setActiveRole(roleObjs[0].key);
        }

        // Step 2: now fetch each role's saved column_config and merge.
        return Promise.all(
          roleObjs.map(r =>
            columnConfigAPI.get(`leads_${r.key}`)
              .then(d => ({ key: r.key, data: d?.data || null }))
              .catch(() => ({ key: r.key, data: null }))
          )
        ).then(results => {
          const next = {};
          results.forEach(({ key, data }) => {
            if (data && data.length > 0) {
              next[key] = mergeWithMaster(data, key, cat);
            } else {
              next[key] = buildDefault(key, cat);
            }
          });
          setConfigs(next);
          setBootstrapped(true);
        });
      })
      .catch(() => setLoadError(t('columns.loadFailed', language)));
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
        roles.map(r => columnConfigAPI.save(`leads_${r.key}`, configs[r.key]))
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
    setConfigs(cfg => ({ ...cfg, [role]: buildDefault(role, catalog) }));
  }

  const currentCols    = configs[activeRole] || [];
  const visibleCount   = currentCols.filter(c => c.visible).length;
  const activeRoleInfo = roles.find(r => r.key === activeRole);
  const activeRoleLbl  = activeRoleInfo ? t(activeRoleInfo.labelKey, language) : '';
  const activeRoleNote = activeRoleInfo ? t(activeRoleInfo.noteKey,  language) : '';

  const hiddenCount = currentCols.filter(c => !c.visible).length;
  const hiddenPlural = language === 'vi' ? '' : (hiddenCount !== 1 ? 's' : '');

  // Wait for the catalog + roles fetch before rendering the editor.
  // (Avoids briefly showing an empty role tab list and a 0-column editor.)
  if (!bootstrapped && !loadError) {
    return (
      <div className="page-body">
        <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-secondary)' }}>
          {t('common.loading', language)}…
        </div>
      </div>
    );
  }

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
          {roles.map(r => (
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
