// C:/Users/rhod_/Documents/StudyLinkLeadQualification/LeadManagement/src/pages/QualificationPanel.jsx
import { useState, useEffect, useCallback } from 'react';
import { eventConsoleAPI } from '../services/api';

const card  = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 14 };
const row   = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid #f1f5f9', fontSize: 14, cursor: 'pointer' };
const catTitle = { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', fontWeight: 700, marginBottom: 8 };

export default function QualificationPanel() {
  const [fields, setFields]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [toast, setToast]     = useState('');
  const [dirty, setDirty]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await eventConsoleAPI.qualificationFields();
      setFields(res.data || []);
      setDirty(false);
    } catch (e) {
      const msg = (e && e.message) || '';
      setError(/admin/i.test(msg)
        ? "Admin only — you don't have access to edit qualification fields."
        : (msg || 'Failed to load qualification fields'));
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (key) => {
    setFields((fs) => fs.map((f) => (f.fieldKey === key ? { ...f, isRequired: !f.isRequired } : f)));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = fields.map((f) => ({ fieldKey: f.fieldKey, isRequired: f.isRequired }));
      const res = await eventConsoleAPI.saveQualificationFields(payload);
      if (Array.isArray(res.data)) setFields(res.data);
      setDirty(false);
      setToast('Saved'); setTimeout(() => setToast(''), 2000);
    } catch (e) {
      setError((e && e.message) || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const groups = [];
  for (const f of fields) {
    let g = groups.find((x) => x.category === f.category);
    if (!g) { g = { category: f.category, items: [] }; groups.push(g); }
    g.items.push(f);
  }

  const requiredCount = fields.filter((f) => f.isRequired).length;

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 14px' }}>
        Tick the fields a registrant must complete to receive their event QR in advance.
        {!loading && fields.length > 0 && (
          <> <strong>{requiredCount}</strong> of <strong>{fields.length}</strong> required.</>
        )}
      </p>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 14 }}>{error}</div>
      )}
      {toast && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>{toast}</div>
      )}

      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>Loading…</p>
      ) : (
        groups.map((g) => (
          <div key={g.category} style={card}>
            <div style={catTitle}>{g.category}</div>
            {g.items.map((f) => (
              <label key={f.fieldKey} style={row}>
                <input type="checkbox" checked={!!f.isRequired} onChange={() => toggle(f.fieldKey)} style={{ width: 16, height: 16 }} />
                <span style={{ fontWeight: f.isRequired ? 600 : 400, color: f.isRequired ? '#111827' : '#6b7280' }}>{f.label}</span>
                <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 12 }}>{f.fieldKey}</span>
              </label>
            ))}
          </div>
        ))
      )}

      {!loading && fields.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={save}
            disabled={saving || !dirty}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: (saving || !dirty) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Save changes'}</button>
          {dirty && <span style={{ color: '#b45309', fontSize: 13 }}>Unsaved changes</span>}
        </div>
      )}

      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 16 }}>
        Note: "one parent complete", the year-of-birth range, and the Self Assessment are fixed rules in code, not toggles here.
      </p>
    </div>
  );
}