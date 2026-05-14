// LeadManagement/src/pages/ColumnLayoutSettings.jsx
//
// Per-user layout variant manager.
// Every authenticated user can create, edit, delete and pick a default variant.
// The Leads page applies the default on load and lets the user switch variants
// from a dropdown.
//
// A variant has:
//   - name (unique per user/page)
//   - config: { columns: [{key, visible}] }
//   - is_default (only one default per user per page)

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiPlus, FiTrash2, FiSave, FiStar } from 'react-icons/fi';
import { staffAPI, variantsAPI } from '../services/api';
import { usePermissions } from '../contexts/PermissionsContext';

export default function ColumnLayoutSettings() {
  const nav = useNavigate();
  const { canDoOnField } = usePermissions();

  const [catalog,  setCatalog]  = useState([]);
  const [variants, setVariants] = useState([]);
  const [editingId, setEditingId] = useState(null);   // id of variant being edited, or 'new'
  const [draft,    setDraft]    = useState(null);     // { id, name, columns:[{key,visible}], is_default }
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);

  // Load column catalog + user's variants
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      staffAPI.listColumns(),
      variantsAPI.list('leads'),
    ]).then(([colRes, varRes]) => {
      if (!alive) return;
      const cat = (colRes.data || []).map(c => ({
        key:   c.fieldName,
        label: c.label || c.fieldName,
      }));
      setCatalog(cat);
      setVariants(varRes.data || []);
      setLoading(false);
    }).catch(e => {
      if (!alive) return;
      setError(e.message || 'Failed to load');
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Filter catalog by RBAC — user can only configure columns they're allowed to see
  const allowedCols = catalog.filter(c => {
    const list = canDoOnField ? canDoOnField('leads', c.key, 'list') : 'view';
    return list && list !== 'none';
  });

  function startNew() {
    setEditingId('new');
    setDraft({
      id: null,
      name: '',
      is_default: variants.length === 0,
      columns: allowedCols.map(c => ({ key: c.key, visible: true })),
    });
  }

  function startEdit(v) {
    const ordered = (v.config?.columns || [])
      .filter(c => allowedCols.some(ac => ac.key === c.key))
      .map(c => ({ key: c.key, visible: c.visible !== false }));
    const seen = new Set(ordered.map(c => c.key));
    const rest = allowedCols
      .filter(c => !seen.has(c.key))
      .map(c => ({ key: c.key, visible: true }));

    setEditingId(v.id);
    setDraft({
      id:         v.id,
      name:       v.name,
      is_default: !!v.is_default,
      columns:    [...ordered, ...rest],
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setError('');
  }

  function toggleVisible(key) {
    setDraft(d => ({
      ...d,
      columns: d.columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c),
    }));
  }

  function move(key, dir) {
    setDraft(d => {
      const idx = d.columns.findIndex(c => c.key === key);
      if (idx < 0) return d;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= d.columns.length) return d;
      const next = [...d.columns];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return { ...d, columns: next };
    });
  }

  async function saveDraft() {
    if (!draft.name?.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        page:       'leads',
        name:       draft.name.trim(),
        config:     { columns: draft.columns.map(c => ({ key: c.key, visible: c.visible !== false })) },
        is_default: !!draft.is_default,
      };
      if (draft.id) {
        const r = await variantsAPI.update(draft.id, payload);
        setVariants(vs => vs.map(v =>
          v.id === r.data.id ? r.data
          : (draft.is_default ? { ...v, is_default: false } : v)
        ));
      } else {
        const r = await variantsAPI.create(payload);
        setVariants(vs => {
          const next = draft.is_default
            ? vs.map(v => ({ ...v, is_default: false }))
            : [...vs];
          return [...next, r.data].sort((a, b) => a.name.localeCompare(b.name));
        });
      }
      cancelEdit();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function removeVariant(v) {
    if (!confirm(`Delete variant "${v.name}"?`)) return;
    try {
      await variantsAPI.delete(v.id);
      setVariants(vs => vs.filter(x => x.id !== v.id));
      if (editingId === v.id) cancelEdit();
    } catch (e) {
      setError(e.message || 'Delete failed');
    }
  }

  async function makeDefault(v) {
    try {
      const r = await variantsAPI.update(v.id, { is_default: true });
      setVariants(vs => vs.map(x =>
        x.id === r.data.id ? r.data : { ...x, is_default: false }
      ));
    } catch (e) {
      setError(e.message || 'Failed to set default');
    }
  }

  if (loading) {
    return <div style={{ padding:'2rem' }}>Loading…</div>;
  }

  return (
    <div className="page" style={{ padding:'1.5rem', maxWidth:'1100px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
        <button className="btn btn--ghost btn--sm" onClick={() => nav(-1)} style={{ padding:'0.4rem 0.6rem' }}>
          <FiArrowLeft/>
        </button>
        <h1 style={{ margin:0, fontSize:'1.5rem' }}>My Layout Variants</h1>
      </div>

      <p style={{ color:'var(--text-secondary)', marginBottom:'1.5rem', fontSize:'0.875rem' }}>
        Create named layouts for the Leads page. Choose which columns are visible and in what
        order. Set one as your default — it loads automatically when you open the Leads page.
        You can still switch variants from the dropdown on the Leads page.
      </p>

      {error && (
        <div style={{
          background:'rgba(220, 38, 38, 0.08)', color:'var(--danger, #dc2626)',
          padding:'0.5rem 0.75rem', borderRadius:'6px',
          fontSize:'0.85rem', marginBottom:'1rem',
        }}>
          {error}
        </div>
      )}

      {/* Variant list */}
      <div style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
          <strong style={{ fontSize:'0.95rem' }}>Your variants ({variants.length})</strong>
          {editingId !== 'new' && (
            <button
              className="btn btn--primary btn--sm"
              onClick={startNew}
              style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <FiPlus/> New variant
            </button>
          )}
        </div>

        {variants.length === 0 && editingId !== 'new' && (
          <div style={{
            padding:'1.5rem', textAlign:'center',
            background:'var(--bg-secondary)', borderRadius:'8px',
            color:'var(--text-secondary)', fontSize:'0.875rem',
          }}>
            No variants yet. Click "New variant" to create your first one.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          {variants.map(v => (
            <div key={v.id} style={{
              padding:'0.75rem 1rem',
              background: editingId === v.id ? 'var(--bg-secondary)' : 'var(--bg-primary)',
              border:'1px solid var(--border)',
              borderRadius:'8px',
              display:'flex', alignItems:'center', gap:'0.75rem',
            }}>
              <button
                onClick={() => makeDefault(v)}
                title={v.is_default ? 'This is your default' : 'Set as default'}
                style={{
                  background:'none', border:'none', cursor:'pointer',
                  color: v.is_default ? '#f59e0b' : 'var(--text-secondary)',
                  padding:'0.25rem',
                }}>
                <FiStar fill={v.is_default ? '#f59e0b' : 'none'}/>
              </button>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600 }}>{v.name}</div>
                <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>
                  {(v.config?.columns || []).filter(c => c.visible !== false).length} of {allowedCols.length} columns visible
                  {v.is_default && ' · default'}
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => startEdit(v)}>
                Edit
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => removeVariant(v)}
                style={{ color:'var(--danger)' }}>
                <FiTrash2/>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Inline editor */}
      {draft && (
        <div style={{
          padding:'1.25rem',
          background:'var(--bg-secondary)',
          border:'1px solid var(--border)',
          borderRadius:'10px',
        }}>
          <h3 style={{ marginTop:0 }}>{draft.id ? 'Edit variant' : 'New variant'}</h3>

          <div style={{ marginBottom:'1rem' }}>
            <label style={{ display:'block', fontSize:'0.85rem', marginBottom:'0.3rem' }}>
              Variant name
            </label>
            <input
              type="text"
              autoFocus
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. My Diamond Pipeline"
              style={{
                width:'100%', maxWidth:'400px', padding:'0.5rem',
                border:'1px solid var(--border)', borderRadius:'6px',
                fontSize:'0.875rem',
              }}
            />
          </div>

          <div style={{ marginBottom:'1rem' }}>
            <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.85rem' }}>
              <input
                type="checkbox"
                checked={draft.is_default}
                onChange={e => setDraft(d => ({ ...d, is_default: e.target.checked }))}
              />
              Set as my default variant for the Leads page
            </label>
          </div>

          <div style={{ marginBottom:'1rem' }}>
            <strong style={{ fontSize:'0.85rem' }}>Columns</strong>
            <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.5rem' }}>
              Check to show, uncheck to hide. Use ↑ / ↓ to reorder.
            </div>
            <div style={{
              maxHeight:'400px', overflowY:'auto',
              background:'var(--bg-primary)',
              border:'1px solid var(--border)', borderRadius:'6px',
              padding:'0.5rem',
            }}>
              {draft.columns.map((col, idx) => {
                const meta = catalog.find(c => c.key === col.key);
                return (
                  <div key={col.key} style={{
                    display:'flex', alignItems:'center', gap:'0.5rem',
                    padding:'0.35rem 0.5rem',
                    borderBottom: idx < draft.columns.length - 1 ? '1px solid var(--border)' : 'none',
                    fontSize:'0.85rem',
                  }}>
                    <input
                      type="checkbox"
                      checked={col.visible}
                      onChange={() => toggleVisible(col.key)}
                    />
                    <span style={{ flex:1 }}>{meta?.label || col.key}</span>
                    <button
                      onClick={() => move(col.key, 'up')}
                      disabled={idx === 0}
                      title="Move up"
                      style={{
                        background:'none', border:'1px solid var(--border)',
                        borderRadius:'4px', padding:'2px 6px',
                        cursor: idx === 0 ? 'not-allowed' : 'pointer',
                        opacity: idx === 0 ? 0.4 : 1,
                      }}>
                      ↑
                    </button>
                    <button
                      onClick={() => move(col.key, 'down')}
                      disabled={idx === draft.columns.length - 1}
                      title="Move down"
                      style={{
                        background:'none', border:'1px solid var(--border)',
                        borderRadius:'4px', padding:'2px 6px',
                        cursor: idx === draft.columns.length - 1 ? 'not-allowed' : 'pointer',
                        opacity: idx === draft.columns.length - 1 ? 0.4 : 1,
                      }}>
                      ↓
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end' }}>
            <button className="btn btn--ghost btn--sm" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={saveDraft}
              disabled={saving}
              style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <FiSave/> {saving ? 'Saving…' : 'Save variant'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
