// LeadManagement/src/pages/ColumnLayoutSettings.jsx
//
// Per-user layout variant manager — rewritten.
//
// CHANGES:
//   1. CONFIG SHAPE — now writes the new TanStack-compatible shape
//      ({ columnOrder, columnVisibility, columnSizing }) instead of the
//      legacy ({ columns: [{key, visible}] }) shape. Reads BOTH shapes
//      so old variants continue to work.
//   2. NO MORE WIPING — combined with the server-side jsonb merge in
//      updateVariant, this page now sends ONLY columnOrder + columnVisibility
//      keys. Filters / sort / column widths saved from the Leads page are
//      preserved across edits here.
//   3. UX UPGRADE — replaced ↑/↓ buttons with @dnd-kit drag-and-drop,
//      added search filter, collapsible category groups, and per-row
//      "Move to top" / "Move to bottom" quick buttons.
//
// REQUIRES: @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiArrowLeft, FiPlus, FiTrash2, FiSave, FiStar,
  FiSearch, FiChevronDown, FiChevronRight, FiArrowUp, FiArrowDown,
} from 'react-icons/fi';
import { staffAPI, variantsAPI } from '../services/api';
import { usePermissions } from '../contexts/PermissionsContext';

import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove,
  verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Static fallback used when permission_fields.category is null. The order
// here is the visual section order in the editor — Personal first, etc.
const CATEGORY_ORDER = [
  'Personal Details', 'Lead Management', 'Self Assessment',
  'Family Contacts', 'OCEAN Profile', 'Campaign / Event', 'Other',
];

export default function ColumnLayoutSettings() {
  const nav = useNavigate();
  const { canDoOnField } = usePermissions();

  const [catalog,    setCatalog]    = useState([]);   // [{key, label, category}]
  const [variants,   setVariants]   = useState([]);
  const [editingId,  setEditingId]  = useState(null); // variant id or 'new'
  const [draft,      setDraft]      = useState(null); // {id, name, is_default, columnOrder, columnVisibility, columnSizing, _origConfig}
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);

  // Search + collapse UI state
  const [search,     setSearch]     = useState('');
  const [collapsed,  setCollapsed]  = useState(new Set());  // category names that are collapsed

  // Load column catalog + user variants
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      staffAPI.listColumns(),
      variantsAPI.list('leads'),
    ]).then(([colRes, varRes]) => {
      if (!alive) return;
      const cat = (colRes.data || []).map(c => ({
        key:      c.fieldName,
        label:    c.label || c.fieldName,
        category: c.category || 'Other',
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

  // Filter catalog by RBAC
  const allowedCols = useMemo(() => catalog.filter(c => {
    const list = canDoOnField ? canDoOnField('leads', c.key, 'list') : 'view';
    return list && list !== 'none';
  }), [catalog, canDoOnField]);

  function startNew() {
    setEditingId('new');
    setDraft({
      id: null,
      name: '',
      is_default: variants.length === 0,
      columnOrder:      allowedCols.map(c => c.key),
      columnVisibility: {},   // all visible by default
      columnSizing:     {},
      _origConfig:      {},   // nothing existing to preserve
    });
  }

  // Read variant config — handles BOTH the new TanStack shape AND the legacy
  // { columns: [{key, visible}] } shape from older Column Settings saves.
  function startEdit(v) {
    const cfg = v.config || {};
    let order, visibility, sizing;

    if (Array.isArray(cfg.columnOrder)) {
      // New shape — take it as-is, plus visibility + sizing objects
      order      = cfg.columnOrder.filter(k => allowedCols.some(c => c.key === k));
      visibility = { ...(cfg.columnVisibility || {}) };
      sizing     = { ...(cfg.columnSizing     || {}) };
    } else if (Array.isArray(cfg.columns)) {
      // Legacy shape — derive order + visibility from the columns array
      order = cfg.columns
        .map(c => c.key)
        .filter(k => allowedCols.some(ac => ac.key === k));
      visibility = {};
      sizing     = {};
      cfg.columns.forEach(c => {
        if (c.visible === false) visibility[c.key] = false;
        if (c.width)             sizing[c.key]     = c.width;
      });
    } else {
      // No config — start from master
      order      = allowedCols.map(c => c.key);
      visibility = {};
      sizing     = {};
    }

    // Append any allowed columns not yet in order (e.g. new fields added since)
    const seen = new Set(order);
    allowedCols.forEach(c => { if (!seen.has(c.key)) order.push(c.key); });

    setEditingId(v.id);
    setDraft({
      id:         v.id,
      name:       v.name,
      is_default: !!v.is_default,
      columnOrder:      order,
      columnVisibility: visibility,
      columnSizing:     sizing,
      _origConfig:      cfg,   // remember the full original — preserved on save
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setError('');
    setSearch('');
  }

  function toggleVisible(key) {
    setDraft(d => {
      const v = { ...d.columnVisibility };
      // visibility map convention: missing = visible, false = hidden
      if (v[key] === false) delete v[key]; else v[key] = false;
      return { ...d, columnVisibility: v };
    });
  }

  function moveToTop(key) {
    setDraft(d => {
      const i = d.columnOrder.indexOf(key);
      if (i <= 0) return d;
      const next = [key, ...d.columnOrder.filter(k => k !== key)];
      return { ...d, columnOrder: next };
    });
  }
  function moveToBottom(key) {
    setDraft(d => {
      const i = d.columnOrder.indexOf(key);
      if (i < 0 || i === d.columnOrder.length - 1) return d;
      const next = [...d.columnOrder.filter(k => k !== key), key];
      return { ...d, columnOrder: next };
    });
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft(d => {
      const oldIdx = d.columnOrder.indexOf(active.id);
      const newIdx = d.columnOrder.indexOf(over.id);
      if (oldIdx < 0 || newIdx < 0) return d;
      return { ...d, columnOrder: arrayMove(d.columnOrder, oldIdx, newIdx) };
    });
  }

  async function saveDraft() {
    if (!draft.name?.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      // ── Build the config patch ──
      // Only includes the fields this page is responsible for. Other keys
      // (filters, sorting, pagination) saved from the Leads page survive
      // because the server's updateVariant uses a jsonb merge.
      //
      // For CREATE, no existing config to preserve, but writing in the
      // new shape lets the Leads page apply it correctly.
      const configPatch = {
        columnOrder:      draft.columnOrder,
        columnVisibility: draft.columnVisibility,
        columnSizing:     draft.columnSizing,
      };

      const payload = {
        page:       'leads',
        name:       draft.name.trim(),
        config:     configPatch,
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

  function toggleCategoryCollapse(cat) {
    setCollapsed(s => {
      const next = new Set(s);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  // ── Build the grouped/filtered render model ──
  // We render the columns in their current columnOrder (the source of truth
  // for dragging). For display we visually group consecutive items that share
  // the same category, with a collapsible header before each group.
  const renderRows = useMemo(() => {
    if (!draft) return [];
    const q = search.trim().toLowerCase();
    const labelByKey = Object.fromEntries(catalog.map(c => [c.key, c.label]));
    const catByKey   = Object.fromEntries(catalog.map(c => [c.key, c.category]));
    return draft.columnOrder.map(key => ({
      key,
      label:    labelByKey[key] || key,
      category: catByKey[key]   || 'Other',
      visible:  draft.columnVisibility[key] !== false,
      matches:  !q || (labelByKey[key] || key).toLowerCase().includes(q),
    }));
  }, [draft, catalog, search]);

  // Counts per category for the headers
  const categoryCounts = useMemo(() => {
    const m = {};
    renderRows.forEach(r => {
      if (!m[r.category]) m[r.category] = { total: 0, visible: 0 };
      m[r.category].total += 1;
      if (r.visible) m[r.category].visible += 1;
    });
    return m;
  }, [renderRows]);

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
          {variants.map(v => {
            const cfg = v.config || {};
            const visibleCount = Array.isArray(cfg.columnOrder)
              ? cfg.columnOrder.filter(k => cfg.columnVisibility?.[k] !== false).length
              : (cfg.columns || []).filter(c => c.visible !== false).length;
            return (
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
                    {visibleCount} of {allowedCols.length} columns visible
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
            );
          })}
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

          <div style={{ marginBottom:'0.5rem' }}>
            <strong style={{ fontSize:'0.85rem' }}>Columns</strong>
            <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', marginBottom:'0.5rem' }}>
              Drag rows to reorder. Check to show, uncheck to hide. Click a category header to collapse the group.
            </div>

            {/* Search bar */}
            <div style={{
              position:'relative', marginBottom:'0.5rem',
            }}>
              <FiSearch style={{
                position:'absolute', left:'8px', top:'50%',
                transform:'translateY(-50%)',
                color:'var(--text-secondary)', fontSize:'0.85rem',
              }}/>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search columns…"
                style={{
                  width:'100%', padding:'0.45rem 0.5rem 0.45rem 1.85rem',
                  border:'1px solid var(--border)', borderRadius:'6px',
                  fontSize:'0.85rem', background:'var(--bg-primary)',
                }}
              />
            </div>
          </div>

          <SortableList
            rows={renderRows}
            collapsed={collapsed}
            onToggleCollapse={toggleCategoryCollapse}
            onDragEnd={handleDragEnd}
            onToggleVisible={toggleVisible}
            onMoveToTop={moveToTop}
            onMoveToBottom={moveToBottom}
            categoryCounts={categoryCounts}
          />

          <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end', marginTop:'1rem' }}>
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

// ────────────────────────────────────────────────────────────────────
// Sortable list with collapsible category headers.
// Renders rows in columnOrder; inserts a header whenever the category
// changes. The dnd context spans all rows so items can be dragged
// across categories.
// ────────────────────────────────────────────────────────────────────
function SortableList({
  rows, collapsed, onToggleCollapse, onDragEnd,
  onToggleVisible, onMoveToTop, onMoveToBottom, categoryCounts,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Group consecutive rows by category for visual rendering.
  // Even when collapsed, rows still participate in the SortableContext (they
  // just aren't rendered) so the columnOrder array stays intact.
  const visibleRows = rows.filter(r => r.matches);
  const ids = visibleRows.map(r => r.key);

  // Build a render list: insert a header before each new category.
  const renderItems = [];
  let lastCat = null;
  visibleRows.forEach(r => {
    if (r.category !== lastCat) {
      renderItems.push({ type:'header', category: r.category });
      lastCat = r.category;
    }
    if (!collapsed.has(r.category)) renderItems.push({ type:'row', row: r });
  });

  return (
    <div style={{
      maxHeight:'500px', overflowY:'auto',
      background:'var(--bg-primary)',
      border:'1px solid var(--border)', borderRadius:'6px',
    }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {renderItems.map((item, i) => {
            if (item.type === 'header') {
              const cc = categoryCounts[item.category] || { total: 0, visible: 0 };
              const isCollapsed = collapsed.has(item.category);
              return (
                <div
                  key={`hdr-${item.category}-${i}`}
                  onClick={() => onToggleCollapse(item.category)}
                  style={{
                    padding:'0.5rem 0.75rem',
                    background:'var(--bg-secondary)',
                    borderBottom:'1px solid var(--border)',
                    display:'flex', alignItems:'center', gap:'0.4rem',
                    fontSize:'0.78rem', fontWeight:600,
                    color:'var(--text-secondary)',
                    cursor:'pointer', userSelect:'none',
                    textTransform:'uppercase', letterSpacing:'0.03em',
                  }}>
                  {isCollapsed ? <FiChevronRight size={12}/> : <FiChevronDown size={12}/>}
                  <span>{item.category}</span>
                  <span style={{ marginLeft:'auto', fontWeight:400 }}>
                    {cc.visible} / {cc.total}
                  </span>
                </div>
              );
            }
            return (
              <SortableRow
                key={item.row.key}
                row={item.row}
                onToggleVisible={onToggleVisible}
                onMoveToTop={onMoveToTop}
                onMoveToBottom={onMoveToBottom}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRow({ row, onToggleVisible, onMoveToTop, onMoveToBottom }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.key });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display:'flex', alignItems:'center', gap:'0.5rem',
        padding:'0.45rem 0.6rem',
        borderBottom:'1px solid var(--border)',
        fontSize:'0.85rem',
        background: isDragging ? 'var(--bg-secondary)' : 'transparent',
        opacity: isDragging ? 0.85 : 1,
        cursor: isDragging ? 'grabbing' : 'default',
      }}>
      <span
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        style={{
          cursor:'grab', color:'var(--text-secondary)', fontSize:'1rem',
          padding:'0 0.2rem', userSelect:'none', touchAction:'none',
        }}>
        ⠿
      </span>
      <input
        type="checkbox"
        checked={row.visible}
        onChange={() => onToggleVisible(row.key)}
      />
      <span style={{ flex:1, opacity: row.visible ? 1 : 0.55 }}>
        {row.label}
      </span>
      <button
        onClick={() => onMoveToTop(row.key)}
        title="Move to top"
        style={{
          background:'none', border:'1px solid var(--border)',
          borderRadius:'4px', padding:'2px 5px', cursor:'pointer',
          display:'inline-flex', alignItems:'center',
        }}>
        <FiArrowUp size={12}/>
      </button>
      <button
        onClick={() => onMoveToBottom(row.key)}
        title="Move to bottom"
        style={{
          background:'none', border:'1px solid var(--border)',
          borderRadius:'4px', padding:'2px 5px', cursor:'pointer',
          display:'inline-flex', alignItems:'center',
        }}>
        <FiArrowDown size={12}/>
      </button>
    </div>
  );
}
