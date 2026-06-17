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
import { useNavTrail } from '../contexts/NavTrailContext';
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

// ── QR Code upload/preview helper ────────────────────────────────────────────
// Accepts a base64 data URI or empty string. Shows a preview and a file picker.
function QrUpload({ value, onChange, platform }) {
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      alert('QR image must be under 200KB. Please screenshot just the QR code and try again.');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => onChange(ev.target.result);
    reader.readAsDataURL(file);
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginTop:'0.25rem' }}>
      {value ? (
        <div style={{ position:'relative' }}>
          <img src={value} alt={platform + ' QR'} style={{ width:'80px', height:'80px', borderRadius:'6px', border:'1px solid var(--border)', objectFit:'contain', background:'#fff' }}/>
          <button type="button" onClick={() => onChange('')}
            style={{ position:'absolute', top:'-6px', right:'-6px', width:'18px', height:'18px', borderRadius:'50%', background:'var(--danger)', color:'#fff', border:'none', cursor:'pointer', fontSize:'10px', lineHeight:'18px', textAlign:'center' }}>
            ×
          </button>
        </div>
      ) : (
        <div style={{ width:'80px', height:'80px', borderRadius:'6px', border:'2px dashed var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.65rem', color:'var(--text-secondary)', textAlign:'center', lineHeight:1.3 }}>
          No QR uploaded
        </div>
      )}
      <div>
        <label style={{ display:'inline-block', padding:'0.375rem 0.75rem', borderRadius:'6px', border:'1px solid var(--border)', cursor:'pointer', fontSize:'0.8125rem', color:'var(--text-secondary)' }}>
          {value ? 'Replace' : 'Upload'} QR
          <input type="file" accept="image/*" style={{ display:'none' }} onChange={handleFile}/>
        </label>
        <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', marginTop:'0.25rem' }}>
          Screenshot your {platform} QR<br/>from the app (max 200KB)
        </div>
      </div>
    </div>
  );
}

function StaffModal({ staff, onClose, onSaved }) {
  const isEdit = !!staff;
  const { language } = useLanguage();
  const [form, setForm] = useState({
    fullName:           staff?.fullName           || '',
    email:              staff?.email              || '',
    position:           staff?.position           || '',
    role:               staff?.role               || '',
    password:           '',
    viewThreshold:      staff?.viewThreshold      ?? 20,
    lqSelectable:       staff?.lqSelectable       ?? false,
    // ── Communication fields ──
    emailClient:        staff?.emailClient        || 'outlook',
    contactMobile:      staff?.contactMobile      || '',
    platformSms:        staff?.platformSms        ?? false,
    platformZalo:       staff?.platformZalo       ?? false,
    platformWhatsapp:   staff?.platformWhatsapp   ?? false,
    platformMessenger:  staff?.platformMessenger  ?? false,
    zaloNumber:         staff?.zaloNumber         || '',
    zaloQrCode:         staff?.zaloQrCode         || '',
    whatsappQrCode:     staff?.whatsappQrCode      || '',
    messengerUsername:  staff?.messengerUsername  || '',
    messengerQrCode:    staff?.messengerQrCode    || '',
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
      const commsPayload = {
        emailClient:       form.emailClient,
        contactMobile:     form.contactMobile     || null,
        platformSms:       form.platformSms,
        platformZalo:      form.platformZalo,
        platformWhatsapp:  form.platformWhatsapp,
        platformMessenger: form.platformMessenger,
        zaloNumber:        form.zaloNumber         || null,
        zaloQrCode:        form.zaloQrCode         || null,
        whatsappQrCode:    form.whatsappQrCode     || null,
        messengerUsername: form.messengerUsername  || null,
        messengerQrCode:   form.messengerQrCode    || null,
      };
      if (isEdit) {
        await staffAPI.update(staff.id, {
          fullName: form.fullName, email: form.email,
          position: form.position, role: form.role,
          viewThreshold: Number(form.viewThreshold),
          lqSelectable: form.lqSelectable,
          ...commsPayload,
        });
      } else {
        await staffAPI.create({ ...form, ...commsPayload });
      }
      onSaved();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ display:'flex', flexDirection:'column', maxHeight:'90vh', width:'min(560px, calc(100vw - 32px))' }}>
        <div className="modal-header" style={{ flexShrink:0 }}>
          <h2 className="modal-title">{isEdit ? t('staff.modal.editTitle', language) : t('staff.modal.addTitle', language)}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body" style={{ overflowY:'auto', flex:1, minHeight:0 }}>
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
          <div className="form-group">
            <label className="form-label" style={{ display:'flex', alignItems:'center', gap:'0.5rem', cursor:'pointer' }}>
              <input type="checkbox" checked={!!form.lqSelectable} onChange={e=>set('lqSelectable', e.target.checked)}/>
              {language === 'vi' ? 'Hi\u1ec3n th\u1ecb tr\u00ean form LQ (danh s\u00e1ch t\u01b0 v\u1ea5n vi\u00ean)' : 'Show on LQ form (counsellor pick list)'}
            </label>
          </div>
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">{t('staff.form.password', language)}</label>
              <input className="form-input" type="password" value={form.password} onChange={e=>set('password',e.target.value)}/>
            </div>
          )}
          {/* ── Communication section (Admin/Manager only) ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:'1rem', marginTop:'0.5rem' }}>
            <div style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.875rem' }}>
              Communication Settings
            </div>

            {/* Email client preference */}
            <div className="form-group">
              <label className="form-label">Email Client</label>
              <div style={{ display:'flex', gap:'1rem', marginTop:'0.25rem' }}>
                {['outlook','gmail'].map(client => (
                  <label key={client} style={{ display:'flex', alignItems:'center', gap:'0.5rem', cursor:'pointer', fontSize:'0.875rem' }}>
                    <input type="checkbox"
                      checked={form.emailClient.includes(client)}
                      onChange={e => {
                        const clients = form.emailClient.split(',').filter(Boolean);
                        if (e.target.checked) set('emailClient', [...new Set([...clients, client])].join(','));
                        else set('emailClient', clients.filter(c => c !== client).join(',') || 'outlook');
                      }}
                    />
                    {client === 'outlook' ? 'Outlook' : 'Gmail'}
                  </label>
                ))}
              </div>
            </div>

            {/* Contact mobile */}
            <div className="form-group">
              <label className="form-label">Contact Mobile Number</label>
              <input className="form-input" value={form.contactMobile}
                onChange={e => set('contactMobile', e.target.value)}
                placeholder="e.g. 0901234567"/>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginTop:'0.25rem' }}>
                Used for calls, SMS, Zalo, and WhatsApp
              </div>
            </div>

            {/* Platform flags */}
            <div className="form-group">
              <label className="form-label">Active Platforms (on contact mobile)</label>
              <div style={{ display:'flex', gap:'1.25rem', marginTop:'0.25rem' }}>
                {[
                  { key:'platformSms',       label:'SMS',       color:'#2563eb' },
                  { key:'platformZalo',      label:'Zalo',      color:'#0068ff' },
                  { key:'platformWhatsapp',  label:'WhatsApp',  color:'#25d366' },
                  { key:'platformMessenger', label:'Messenger', color:'#0084ff' },
                ].map(({ key, label, color }) => (
                  <label key={key} style={{ display:'flex', alignItems:'center', gap:'0.5rem', cursor:'pointer', fontSize:'0.875rem' }}>
                    <input type="checkbox" checked={!!form[key]} onChange={e => set(key, e.target.checked)}/>
                    <span style={{ color }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Zalo — separate number + QR */}
            <div className="form-group">
              <label className="form-label">Zalo Number <span style={{ fontWeight:400, color:'var(--text-secondary)' }}>(if different from contact mobile)</span></label>
              <input className="form-input" value={form.zaloNumber}
                onChange={e => set('zaloNumber', e.target.value)}
                placeholder="Leave blank to use contact mobile"/>
            </div>
            <div className="form-group">
              <label className="form-label">Zalo QR Code</label>
              <QrUpload value={form.zaloQrCode} onChange={v => set('zaloQrCode', v)} platform="Zalo"/>
            </div>

            {/* WhatsApp QR */}
            <div className="form-group">
              <label className="form-label">WhatsApp QR Code</label>
              <QrUpload value={form.whatsappQrCode} onChange={v => set('whatsappQrCode', v)} platform="WhatsApp"/>
            </div>

            {/* Messenger */}
            <div className="form-group">
              <label className="form-label">Messenger Username or Profile URL</label>
              <input className="form-input" value={form.messengerUsername}
                onChange={e => set('messengerUsername', e.target.value)}
                placeholder="e.g. john.smith or https://facebook.com/john.smith"/>
            </div>
            <div className="form-group">
              <label className="form-label">Messenger QR Code</label>
              <QrUpload value={form.messengerQrCode} onChange={v => set('messengerQrCode', v)} platform="Messenger"/>
            </div>
          </div>

          {error && <div className="alert alert--error" style={{ marginTop:'0.5rem' }}>{error}</div>}
        </div>
        <div className="modal-footer" style={{ flexShrink:0, borderTop:'1px solid var(--border)' }}>
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
  const { push: pushTrail }             = useNavTrail();

  const canManage   = canDo('staff', 'manage');
  const canSetTgt   = canDo('staff', 'set_target');
  const canViewPage = canManage || canSetTgt;

  useEffect(() => { loadStaff(); }, []);

  // Push a Staff page entry to the nav trail. Same path each visit
  // means push() updates the existing entry rather than stacking.
  useEffect(() => {
    pushTrail({ label: 'Staff', path: '/staff' });
  }, [pushTrail]);

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
