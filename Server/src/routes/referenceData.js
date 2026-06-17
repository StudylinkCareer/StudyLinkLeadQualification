// server/src/routes/referenceData.js
// ─────────────────────────────────────────────────────────────────────
// Generic editor for the marketing reference lists held in lookup_values.
// Restricted to a whitelist of categories so unrelated lookups can't be
// touched. Admin / Manager / Director only. Soft delete.
//   GET    /api/reference-data?category=X[&subcategory=Y]
//   POST   /api/reference-data            { category, subcategory?, code, labelEn?, labelVi?, mode? }
//   PUT    /api/reference-data/:id        { code?, labelEn?, labelVi?, mode? }
//   DELETE /api/reference-data/:id
// (Event/Campaign Sources are NOT here — they live on the Marketing Events page.)
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const ALLOWED_ROLES = new Set(['Admin', 'Manager', 'Director']);
function requireRole(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (!ALLOWED_ROLES.has(req.session.staffRole)) return res.status(403).json({ success: false, error: 'Insufficient role' });
  next();
}

const EDITABLE = new Set(['source_of_lead', 'source', 'b2b_type', 'b2b_party', 'attendance_status']);
const norm  = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };
const shape = (r) => ({
  id: r.id, code: r.code, labelEn: r.label_en || null, labelVi: r.label_vi || null,
  subcategory: r.subcategory || null, mode: (r.meta && r.meta.mode) || null,
});

// ── PUBLIC: selectable counsellors for the LQ form (no auth) ──────────────────
// GET /api/reference-data/public/counsellors
router.get('/public/counsellors', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT full_name FROM staff
        WHERE lq_selectable = true AND is_active = true
        ORDER BY full_name ASC`
    );
    res.json({ success: true, data: rows.map(r => r.full_name) });
  } catch (err) {
    console.error('[referenceData] counsellors failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load counsellors' });
  }
});

// ── PUBLIC: source-options for the LQ form picker (no auth) ───────────────────
// GET /api/reference-data/public/source-options
// Returns everything the pre-OTP Source-of-Lead -> Source picker needs.
router.get('/public/source-options', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, subcategory, code, label_en, label_vi, meta, sort_order
         FROM lookup_values
        WHERE category IN ('source_of_lead','source','b2b_type','b2b_party')
          AND is_active = true
        ORDER BY category, sort_order ASC, code ASC`
    );
    const out = { sourceOfLead: [], source: {}, b2bType: [], b2bParty: {} };
    for (const r of rows) {
      const item = { code: r.code, labelEn: r.label_en, labelVi: r.label_vi };
      if (r.category === 'source_of_lead') {
        out.sourceOfLead.push({ ...item, mode: (r.meta && r.meta.mode) || 'list' });
      } else if (r.category === 'source') {
        (out.source[r.subcategory] = out.source[r.subcategory] || []).push(item);
      } else if (r.category === 'b2b_type') {
        out.b2bType.push(item);
      } else if (r.category === 'b2b_party') {
        (out.b2bParty[r.subcategory] = out.b2bParty[r.subcategory] || []).push(item);
      }
    }
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('[referenceData] source-options failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load source options' });
  }
});

router.get('/', requireRole, async (req, res) => {
  const category    = norm(req.query.category);
  const subcategory = norm(req.query.subcategory);
  if (!category || !EDITABLE.has(category)) return res.status(400).json({ success: false, error: 'Unknown list' });
  const conds = ['category = $1', 'is_active = true'], params = [category];
  if (subcategory) { params.push(subcategory); conds.push(`COALESCE(subcategory,'') = $${params.length}`); }
  try {
    const r = await pool.query(
      `SELECT id, code, label_en, label_vi, subcategory, meta FROM lookup_values
        WHERE ${conds.join(' AND ')} ORDER BY sort_order ASC, code ASC`, params);
    res.json({ success: true, data: r.rows.map(shape) });
  } catch (err) {
    console.error('[referenceData] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load list' });
  }
});

router.post('/', requireRole, async (req, res) => {
  const category    = norm(req.body.category);
  const subcategory = norm(req.body.subcategory);
  const code        = norm(req.body.code);
  const labelEn     = norm(req.body.labelEn);
  const labelVi     = norm(req.body.labelVi);
  const mode        = norm(req.body.mode);
  if (!category || !EDITABLE.has(category)) return res.status(400).json({ success: false, error: 'Unknown list' });
  if (!code) return res.status(400).json({ success: false, error: 'Name is required' });
  const meta = mode ? { mode } : {};
  try {
    const ns = await pool.query(
      `SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM lookup_values WHERE category=$1 AND COALESCE(subcategory,'')=COALESCE($2,'')`,
      [category, subcategory]);
    const ins = await pool.query(
      `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active, meta)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb)
       RETURNING id, code, label_en, label_vi, subcategory, meta`,
      [category, subcategory, code, labelEn, labelVi, ns.rows[0].n, JSON.stringify(meta)]);
    res.json({ success: true, data: shape(ins.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      try {
        const re = await pool.query(
          `UPDATE lookup_values SET is_active=true, label_en=$4, label_vi=$5, meta=COALESCE(meta,'{}'::jsonb)||$6::jsonb
            WHERE category=$1 AND COALESCE(subcategory,'')=COALESCE($2,'') AND code=$3
            RETURNING id, code, label_en, label_vi, subcategory, meta`,
          [category, subcategory, code, labelEn, labelVi, JSON.stringify(meta)]);
        if (re.rowCount) return res.json({ success: true, data: shape(re.rows[0]), reactivated: true });
      } catch (e2) { console.error('[referenceData] reactivate failed:', e2); }
      return res.status(409).json({ success: false, error: 'That entry already exists' });
    }
    console.error('[referenceData] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create' });
  }
});

router.put('/:id', requireRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const ex = await pool.query(`SELECT category, meta FROM lookup_values WHERE id=$1`, [id]);
    if (ex.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
    if (!EDITABLE.has(ex.rows[0].category)) return res.status(403).json({ success: false, error: 'Not editable' });

    const sets = [], vals = [];
    if (req.body.labelEn !== undefined) { vals.push(norm(req.body.labelEn)); sets.push(`label_en = $${vals.length}`); }
    if (req.body.labelVi !== undefined) { vals.push(norm(req.body.labelVi)); sets.push(`label_vi = $${vals.length}`); }
    if (req.body.code !== undefined) {
      const c = norm(req.body.code);
      if (!c) return res.status(400).json({ success: false, error: 'Name cannot be empty' });
      vals.push(c); sets.push(`code = $${vals.length}`);
    }
    if (req.body.mode !== undefined) {
      const meta = ex.rows[0].meta || {};
      const m = norm(req.body.mode); if (m) meta.mode = m; else delete meta.mode;
      vals.push(JSON.stringify(meta)); sets.push(`meta = $${vals.length}::jsonb`);
    }
    if (sets.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
    vals.push(id);
    const upd = await pool.query(
      `UPDATE lookup_values SET ${sets.join(', ')} WHERE id=$${vals.length}
       RETURNING id, code, label_en, label_vi, subcategory, meta`, vals);
    res.json({ success: true, data: shape(upd.rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'That entry already exists' });
    console.error('[referenceData] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update' });
  }
});

router.delete('/:id', requireRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const ex = await pool.query(`SELECT category FROM lookup_values WHERE id=$1`, [id]);
    if (ex.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
    if (!EDITABLE.has(ex.rows[0].category)) return res.status(403).json({ success: false, error: 'Not editable' });
    await pool.query(`UPDATE lookup_values SET is_active=false WHERE id=$1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[referenceData] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete' });
  }
});

module.exports = router;
