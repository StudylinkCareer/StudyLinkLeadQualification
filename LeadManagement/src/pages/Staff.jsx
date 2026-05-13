// src/pages/Staff.jsx
//
// CHANGES (table-driven RBAC migration — final pass):
//   - Removed the hardcoded ROLES array. Valid role values are now fetched
//     from GET /api/staff/roles which queries DISTINCT role from the
//     role_permissions table. Single source of truth.
//   - Removed the toCounselor/fromCounselor role-transition confirmations
//     and the deactivateCounselor message variant. Role-change and
//     deactivation now use a single generic confirmation. If you want
//     transition-specific warnings back, add them as a config row, not as
//     hardcoded role-name comparisons.
//   - Page access + action gating unchanged: driven by canDo('staff','manage')
//     and canDo('staff','set_target') from PermissionsContext.
// -----------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../i18n';
import { FiPlus, FiEdit2, FiUserX, FiKey, FiX, FiTarget } from 'react-icons/fi';

const POSITIONS = [
  'CEO', 'Tech Support', 'Product Manager', 'Marketing Manager',
  'Sales Manager', 'Quality', 'Senior Counselor', 'Counselor',
  'PreSales', 'Marketing Staff',
];
// ROLES list removed — now fetched from GET /api/staff/roles which reads
// DISTINCT role from the role_permissions table. See StaffModal below.

// Simple {placeholder} templating.
function fmt(str, params) {
  if (!params) return str;
  return Object.keys(params).reduce(
    (acc, k) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]),
    str
  );
}

function roleBadge(role) {
  return <span className={`badge badge--${role?.toLowerCase()}`}>{role}</span>;
}

function StaffModal({ staff, onClose, onSaved }) {
  const isEdit = !!staff;
  const { language } = useLanguage();
  const [form, setForm] = useState({
    fullName:      staff?.fullName      || '',
    email:         staff?.email         || '',
    position:      staff?.position      || '',
    role:          staff?.role          || '',
    password:      '',
    viewThreshold: staff?.viewThreshold ?? 20,
  });
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);
  const [roles, setRoles]   = useState([]);

  // Fetch valid roles from the RBAC table (DISTINCT role FROM role_permissions).
  // Replaces the previous hardcoded ROLES = [...] array.
  useEffect(() => {
    staffAPI.listRoles()
      .then(d => setRoles(d.data || []))
      .catch(() => setRoles([]));
  }, []);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    setError('');
    if (!form.fullName || !form.email || !form.position || !form.role)
      return setError(t('staff.error.allRequired', language));
    if (!isEdit && !form.password) return setError(t('staff.error.passwordRequired', language));
    if (isNaN(form.viewThreshold) || form.viewThreshold < 1)
      return setError(t('staff.error.thresholdInvalid', language));

    // Role-change confirmation: a single generic message regardless of which
    // role is changing to which. Previous behavior was role-name-specific
    // (special prompts for to/from 'Counselor') and has been removed.
    if (isEdit && form.role !== (staff?.role || '')) {
      const displayName = form.fullName || 'this person';
      const msg = `Change ${displayName}'s role from "${staff?.role || '(none)'}" to "${form.role}"?\n\nThis may affect dashboards, aggregates, and permissions immediately.`;
      if (!window.confirm(msg)) return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await staffAPI.update(staff.id, {
          fullName: form.fullName, email: form.email,
          position: form.position, role: form.role,
          viewThreshold: Number(form.viewThreshold),
        });
      } else {
        await staffAPI.create(form);
      }
      onSaved();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? t('staff.modal.editTitle', language) : t('staff.modal.addTitle', language)}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t('staff.form.fullName', language)}</label>
            <input className="form-input" value={form.fullName} onChange={e=>set('fullName',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">{t('staff.form.email', language)}</label>
            <input className="form-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">{t('staff.form.position', language)}</label>
            <select className="form-select" value={form.position} onChange={e=>set('position',e.target.value)}>
              <option value="">{t('staff.form.positionPlaceholder', language)}</option>
              {POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('staff.form.role', language)}</label>
            <select className="form-select" value={form.role} onChange={e=>set('role',e.target.value)}>
              <option value="">{t('staff.form.rolePlaceholder', language)}</option>
              {roles.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('staff.form.viewThreshold', language)}</label>
            <input className="form-input" type="number" min="1" max="500"
              value={form.viewThreshold} onChange={e=>set('viewThreshold',e.target.value)}/>
          </div>
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">{t('staff.form.password', language)}</label>
              <input className="form-input" type="password" value={form.password} onChange={e=>set('password',e.target.value)}/>
            </div>
          )}
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>{t('common.cancel', language)}</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving', language) : t('common.save', language)}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordModal({ staff, onClose, onSaved }) {
  const { language } = useLanguage();
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  async function handleSave() {
    if (!password || password.length < 6) return setError(t('staff.passwordModal.error', language));
    setSaving(true);
    try { await staffAPI.resetPassword(staff.id, password); onSaved(); }
    catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{fmt(t('staff.passwordModal.title', language), { name: staff.fullName })}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t('staff.passwordModal.newPassword', language)}</label>
            <input className="form-input" type="password" value={password}
              onChange={e=>setPassword(e.target.value)} autoFocus/>
          </div>
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>{t('common.cancel', language)}</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving', language) : t('staff.passwordModal.submit', language)}
          </button>
        </div>
      </div>
    </div>
  );
}

function TargetModal({ member, onClose, onSaved }) {
  const { language } = useLanguage();
  const [target, setTarget] = useState(member?.target ?? 0);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (isNaN(target) || target < 0) return setError(t('staff.targetModal.error', language));
    setSaving(true);
    try {
      await staffAPI.setTarget(member.id, Number(target));
      onSaved();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{fmt(t('staff.targetModal.title', language), { name: member.fullName })}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t('staff.targetModal.monthlyLabel', language)}</label>
            <input className="form-input" type="number" min="0" value={target}
              onChange={e=>setTarget(e.target.value)} autoFocus/>
          </div>
          {member.targetSetBy && (
            <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', marginTop:'0.5rem' }}>
              {fmt(t('staff.targetModal.lastSet', language), {
                name: member.targetSetBy,
                date: member.targetSetAt ? new Date(member.targetSetAt).toLocaleDateString() : '—',
              })}
            </div>
          )}
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>{t('common.cancel', language)}</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving', language) : t('staff.targetModal.submit', language)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Staff() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editStaff, setEditStaff] = useState(null);
  const [pwdStaff, setPwdStaff]   = useState(null);
  const [targetMember, setTargetMember] = useState(null);
  const { staff }                       = useAuth();
  const { canDo }                       = usePermissions();
  const { language }                    = useLanguage();

  const canManage   = canDo('staff', 'manage');
  const canSetTgt   = canDo('staff', 'set_target');
  const canViewPage = canManage || canSetTgt;

  useEffect(() => { loadStaff(); }, []);

  async function loadStaff() {
    setLoading(true);
    try { const data = await staffAPI.list(); setStaffList(data.data || []); }
    catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleDeactivate(id, name /* role param removed */) {
    const msg = fmt(t('staff.confirm.deactivate', language), { name });
    if (!confirm(msg)) return;
    try { await staffAPI.deactivate(id); await loadStaff(); }
    catch(e) { alert(e.message); }
  }

  if (!canViewPage) return (
    <div className="page-body">
      <div className="alert alert--error">{t('staff.needsAccess', language)}</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <span className="page-title">{t('staff.title', language)}</span>
        {canManage && (
          <button className="btn btn--primary btn--sm"
            onClick={() => { setEditStaff(null); setShowModal(true); }}>
            <FiPlus size={14}/> {t('staff.addBtn', language)}
          </button>
        )}
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-center">{t('staff.loading', language)}</div>
        ) : (
          <div className="table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('staff.col.name', language)}</th>
                    <th>{t('staff.col.email', language)}</th>
                    <th>{t('staff.col.position', language)}</th>
                    <th>{t('staff.col.role', language)}</th>
                    <th>{t('staff.col.status', language)}</th>
                    <th>{t('staff.col.viewThreshold', language)}</th>
                    <th>{t('staff.col.target', language)}</th>
                    <th>{t('staff.col.targetSet', language)}</th>
                    <th>{t('staff.col.actions', language)}</th>
                  </tr>
                </thead>
                <tbody>
                  {staffList.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight:500 }}>{s.fullName}</td>
                      <td style={{ color:'var(--text-secondary)' }}>{s.email}</td>
                      <td>{s.position}</td>
                      <td>{roleBadge(s.role)}</td>
                      <td>
                        <span className={`badge ${s.isActive ? 'badge--qualified' : 'badge--lost'}`}>
                          {s.isActive ? t('common.active', language) : t('common.inactive', language)}
                        </span>
                      </td>
                      <td style={{ fontFamily:'DM Mono', fontSize:'0.875rem' }}>{s.viewThreshold ?? 20}</td>
                      <td style={{ fontFamily:'DM Mono', fontSize:'0.875rem', fontWeight:600, color:'var(--primary)' }}>
                        {s.target ?? '—'}
                      </td>
                      <td style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                        {s.targetSetBy ? (
                          <>
                            <div>{s.targetSetBy}</div>
                            <div>{s.targetSetAt ? new Date(s.targetSetAt).toLocaleDateString() : ''}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:'0.5rem' }}>
                          {canManage && (
                            <button className="btn btn--ghost btn--icon" title={t('staff.action.edit', language)}
                              onClick={() => { setEditStaff(s); setShowModal(true); }}>
                              <FiEdit2 size={14}/>
                            </button>
                          )}
                          {canManage && (
                            <button className="btn btn--ghost btn--icon" title={t('staff.action.resetPassword', language)}
                              onClick={() => setPwdStaff(s)}>
                              <FiKey size={14}/>
                            </button>
                          )}
                          {canSetTgt && (
                            <button className="btn btn--ghost btn--icon" title={t('staff.action.setTarget', language)}
                              onClick={() => setTargetMember(s)}
                              style={{ color:'var(--primary)' }}>
                              <FiTarget size={14}/>
                            </button>
                          )}
                          {canManage && s.isActive && (
                            <button className="btn btn--ghost btn--icon" title={t('staff.action.deactivate', language)}
                              onClick={() => handleDeactivate(s.id, s.fullName)}
                              style={{ color:'var(--danger)' }}>
                              <FiUserX size={14}/>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <StaffModal
          staff={editStaff}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadStaff(); }}
        />
      )}
      {pwdStaff && (
        <PasswordModal
          staff={pwdStaff}
          onClose={() => setPwdStaff(null)}
          onSaved={() => { setPwdStaff(null); alert(t('staff.passwordModal.saved', language)); }}
        />
      )}
      {targetMember && (
        <TargetModal
          member={targetMember}
          setterName={staff?.fullName}
          onClose={() => setTargetMember(null)}
          onSaved={() => { setTargetMember(null); loadStaff(); }}
        />
      )}
    </div>
  );
}
