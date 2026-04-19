// src/pages/Staff.jsx
//
// CHANGES (Counselor aggregate safeguards):
//   - Admin is asked to confirm when changing someone's role TO 'Counselor'
//     (they'll start contributing to the Manager dashboard aggregate target).
//   - Admin is asked to confirm when changing someone's role AWAY from
//     'Counselor' (they'll be removed from the aggregate).
//   - Admin is asked to confirm when deactivating an active Counselor
//     (same aggregate impact).
//   - Creating a new staff member with role = Counselor also prompts.
//
// These are native browser confirm() dialogs to match the existing
// deactivation pattern.
import { useState, useEffect } from 'react';
import { staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiPlus, FiEdit2, FiUserX, FiKey, FiX, FiTarget } from 'react-icons/fi';

const POSITIONS = [
  'CEO', 'Tech Support', 'Product Manager', 'Marketing Manager',
  'Sales Manager', 'Quality', 'Senior Counselor', 'Counselor',
  'PreSales', 'Marketing Staff',
];
const ROLES = ['Director', 'Manager', 'Admin', 'Counselor'];

function roleBadge(role) {
  return <span className={`badge badge--${role?.toLowerCase()}`}>{role}</span>;
}

function StaffModal({ staff, onClose, onSaved }) {
  const isEdit = !!staff;
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

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    setError('');
    if (!form.fullName || !form.email || !form.position || !form.role)
      return setError('All fields are required');
    if (!isEdit && !form.password) return setError('Password is required for new staff');
    if (isNaN(form.viewThreshold) || form.viewThreshold < 1)
      return setError('View threshold must be a positive number');

    // ── Counselor role guard ────────────────────────────────────
    // Confirm before adding/removing someone to/from the aggregate.
    const prevRole = staff?.role || '';
    const nextRole = form.role;
    const toCounselor   = nextRole === 'Counselor' && prevRole !== 'Counselor';
    const fromCounselor = prevRole === 'Counselor' && nextRole !== 'Counselor';
    if (toCounselor) {
      const ok = window.confirm(
        `Setting ${form.fullName || 'this person'}'s role to 'Counselor' will include them in the Manager dashboard aggregate target. Continue?`
      );
      if (!ok) return;
    } else if (fromCounselor) {
      const ok = window.confirm(
        `Removing the 'Counselor' role from ${form.fullName || 'this person'} will exclude them from the Manager dashboard aggregate target. Continue?`
      );
      if (!ok) return;
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
          <h2 className="modal-title">{isEdit ? 'Edit Staff Member' : 'Add Staff Member'}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input className="form-input" value={form.fullName} onChange={e=>set('fullName',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Position</label>
            <select className="form-select" value={form.position} onChange={e=>set('position',e.target.value)}>
              <option value="">Select position...</option>
              {POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={form.role} onChange={e=>set('role',e.target.value)}>
              <option value="">Select role...</option>
              {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">View Threshold (records per session before alert)</label>
            <input className="form-input" type="number" min="1" max="500"
              value={form.viewThreshold} onChange={e=>set('viewThreshold',e.target.value)}/>
          </div>
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={form.password} onChange={e=>set('password',e.target.value)}/>
            </div>
          )}
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordModal({ staff, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  async function handleSave() {
    if (!password || password.length < 6) return setError('Password must be at least 6 characters');
    setSaving(true);
    try { await staffAPI.resetPassword(staff.id, password); onSaved(); }
    catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Reset Password — {staff.fullName}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input className="form-input" type="password" value={password}
              onChange={e=>setPassword(e.target.value)} autoFocus/>
          </div>
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TargetModal({ member, onClose, onSaved, setterName }) {
  const [target, setTarget] = useState(member?.target ?? 0);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (isNaN(target) || target < 0) return setError('Target must be a positive number');
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
          <h2 className="modal-title">Set Target — {member.fullName}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Monthly Won Contracts Target</label>
            <input className="form-input" type="number" min="0" value={target}
              onChange={e=>setTarget(e.target.value)} autoFocus/>
          </div>
          {member.targetSetBy && (
            <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)', marginTop:'0.5rem' }}>
              Last set by {member.targetSetBy} on {member.targetSetAt ? new Date(member.targetSetAt).toLocaleDateString() : '—'}
            </div>
          )}
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Set Target'}
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
  const { isAdmin, isManager, staff }   = useAuth();

  useEffect(() => { loadStaff(); }, []);

  async function loadStaff() {
    setLoading(true);
    try { const data = await staffAPI.list(); setStaffList(data.data || []); }
    catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleDeactivate(id, name, role) {
    // Counselors contribute to the Manager dashboard aggregate. Warn
    // explicitly so Admins don't silently alter the aggregate.
    const prompt = role === 'Counselor'
      ? `Deactivate ${name}? They'll be excluded from the Manager dashboard aggregate target.`
      : `Deactivate ${name}?`;
    if (!confirm(prompt)) return;
    try { await staffAPI.deactivate(id); await loadStaff(); }
    catch(e) { alert(e.message); }
  }

  if (!isAdmin && !isManager) return (
    <div className="page-body">
      <div className="alert alert--error">Manager or Admin access required.</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Staff Management</span>
        {isAdmin && (
          <button className="btn btn--primary btn--sm"
            onClick={() => { setEditStaff(null); setShowModal(true); }}>
            <FiPlus size={14}/> Add Staff
          </button>
        )}
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-center">Loading staff...</div>
        ) : (
          <div className="table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Position</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>View Threshold</th>
                    <th>Target</th>
                    <th>Target Set</th>
                    <th>Actions</th>
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
                          {s.isActive ? 'Active' : 'Inactive'}
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
                          {isAdmin && (
                            <button className="btn btn--ghost btn--icon" title="Edit"
                              onClick={() => { setEditStaff(s); setShowModal(true); }}>
                              <FiEdit2 size={14}/>
                            </button>
                          )}
                          {isAdmin && (
                            <button className="btn btn--ghost btn--icon" title="Reset Password"
                              onClick={() => setPwdStaff(s)}>
                              <FiKey size={14}/>
                            </button>
                          )}
                          {(isManager || isAdmin) && (
                            <button className="btn btn--ghost btn--icon" title="Set Target"
                              onClick={() => setTargetMember(s)}
                              style={{ color:'var(--primary)' }}>
                              <FiTarget size={14}/>
                            </button>
                          )}
                          {isAdmin && s.isActive && (
                            <button className="btn btn--ghost btn--icon" title="Deactivate"
                              onClick={() => handleDeactivate(s.id, s.fullName, s.role)}
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
          onSaved={() => { setPwdStaff(null); alert('Password updated successfully'); }}
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
