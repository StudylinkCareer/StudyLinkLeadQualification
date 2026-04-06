// src/pages/Staff.jsx
import { useState, useEffect } from 'react';
import { staffAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { FiPlus, FiEdit2, FiUserX, FiKey, FiX } from 'react-icons/fi';

const POSITIONS = [
  'CEO', 'Tech Support', 'Product Manager', 'Marketing Manager',
  'Sales Manager', 'Quality', 'Senior Counselor', 'Counselor',
  'PreSales', 'Marketing Staff',
];

const ROLES = ['Director', 'Manager', 'Admin', 'Counselor'];

function roleBadge(role) {
  const cls = role?.toLowerCase();
  return <span className={`badge badge--${cls}`}>{role}</span>;
}

function StaffModal({ staff, onClose, onSaved }) {
  const isEdit = !!staff;
  const [form, setForm] = useState({
    fullName: staff?.full_name || '',
    email:    staff?.email     || '',
    position: staff?.position  || '',
    role:     staff?.role      || '',
    password: '',
  });
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    setError('');
    if (!form.fullName || !form.email || !form.position || !form.role) {
      return setError('All fields are required');
    }
    if (!isEdit && !form.password) return setError('Password is required for new staff');
    setSaving(true);
    try {
      if (isEdit) {
        await staffAPI.update(staff.id, {
          fullName: form.fullName, email: form.email,
          position: form.position, role: form.role,
        });
      } else {
        await staffAPI.create(form);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
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
            <input className="form-input" value={form.fullName} onChange={e => set('fullName', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Position</label>
            <select className="form-select" value={form.position} onChange={e => set('position', e.target.value)}>
              <option value="">Select position...</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="">Select role...</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={form.password} onChange={e => set('password', e.target.value)} />
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
    try {
      await staffAPI.resetPassword(staff.id, password);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Reset Password — {staff.full_name}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose}><FiX /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
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

export default function Staff() {
  const [staffList, setStaffList]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editStaff, setEditStaff]   = useState(null);
  const [pwdStaff, setPwdStaff]     = useState(null);
  const { isAdmin }                 = useAuth();

  useEffect(() => { loadStaff(); }, []);

  async function loadStaff() {
    setLoading(true);
    try {
      const data = await staffAPI.list();
      setStaffList(data.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleDeactivate(id, name) {
    if (!confirm(`Deactivate ${name}?`)) return;
    try {
      await staffAPI.deactivate(id);
      await loadStaff();
    } catch (e) { alert(e.message); }
  }

  if (!isAdmin) return (
    <div className="page-body">
      <div className="alert alert--error">Admin access required.</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Staff Management</span>
        <button className="btn btn--primary btn--sm" onClick={() => { setEditStaff(null); setShowModal(true); }}>
          <FiPlus size={14} /> Add Staff
        </button>
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staffList.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.full_name}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{s.email}</td>
                      <td>{s.position}</td>
                      <td>{roleBadge(s.role)}</td>
                      <td>
                        <span className={`badge ${s.is_active ? 'badge--qualified' : 'badge--lost'}`}>
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn--ghost btn--icon" title="Edit"
                            onClick={() => { setEditStaff(s); setShowModal(true); }}>
                            <FiEdit2 size={14} />
                          </button>
                          <button className="btn btn--ghost btn--icon" title="Reset Password"
                            onClick={() => setPwdStaff(s)}>
                            <FiKey size={14} />
                          </button>
                          {s.is_active && (
                            <button className="btn btn--ghost btn--icon" title="Deactivate"
                              onClick={() => handleDeactivate(s.id, s.full_name)}
                              style={{ color: 'var(--danger)' }}>
                              <FiUserX size={14} />
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
    </div>
  );
}
