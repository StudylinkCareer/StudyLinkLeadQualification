// server/src/controllers/lookupController.js
//
// Exposes the lookup_values table to the apps. Two halves:
//   - Reads (any authenticated staff) — used by both apps to populate
//     dropdowns, filter options, archetype lookups, etc. Cached in-memory
//     with a 5-minute TTL since lookups rarely change.
//   - Writes (admin only) — add/update/disable/reactivate values. Every
//     write invalidates the cache so the next read reflects changes.
//
// The cache stores the full active set (all categories, all active rows).
// Per-category reads slice from the cache. Admin reads (with inactive rows)
// bypass the cache entirely.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── In-memory cache ──────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;   // 5 min
let CACHE = null;                      // { byCategory: { country: [...], ... } }
let CACHE_TS = 0;

function invalidateCache() {
  CACHE = null;
  CACHE_TS = 0;
}

// Build the camelCase JSON shape consumed by the frontend.
// Strips DB internals (id is included for admin operations but not needed
// by the apps; we keep it small).
function rowToJson(row) {
  return {
    id:          row.id,
    subcategory: row.subcategory,
    code:        row.code,
    labelEn:     row.label_en,
    labelVi:     row.label_vi,
    bodyEn:      row.body_en,
    bodyVi:      row.body_vi,
    sortOrder:   row.sort_order,
    isActive:    row.is_active,
    meta:        row.meta || {},
  };
}

async function loadAllActive() {
  const res = await pool.query(
    `SELECT id, category, subcategory, code, label_en, label_vi,
            body_en, body_vi, sort_order, is_active, meta
       FROM lookup_values
      WHERE is_active = true
      ORDER BY category, COALESCE(subcategory, ''), sort_order, code`
  );
  const byCategory = {};
  for (const row of res.rows) {
    if (!byCategory[row.category]) byCategory[row.category] = [];
    byCategory[row.category].push(rowToJson(row));
  }
  return byCategory;
}

async function getCached() {
  if (CACHE && Date.now() - CACHE_TS < CACHE_TTL_MS) return CACHE;
  CACHE = await loadAllActive();
  CACHE_TS = Date.now();
  return CACHE;
}

// ── Read endpoints (any authenticated staff) ─────────────────────

// GET /api/lookups
// Returns all active lookups grouped by category.
// Frontend pattern: load this once at app start, populate context, use everywhere.
async function listAll(req, res, next) {
  try {
    const byCategory = await getCached();
    res.json({ success: true, data: byCategory });
  } catch (err) { next(err); }
}

// GET /api/lookups/:category
// Returns active values for one category (handy for narrow reads).
async function listOne(req, res, next) {
  try {
    const { category } = req.params;
    const byCategory = await getCached();
    res.json({ success: true, data: byCategory[category] || [] });
  } catch (err) { next(err); }
}

// GET /api/lookups/admin/all?includeInactive=true
// Admin endpoint — bypasses cache and optionally includes disabled rows.
async function adminListAll(req, res, next) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const r = await pool.query(
      includeInactive
        ? `SELECT id, category, subcategory, code, label_en, label_vi,
                  body_en, body_vi, sort_order, is_active, meta, created_at, updated_at
             FROM lookup_values
            ORDER BY category, COALESCE(subcategory, ''), sort_order, code`
        : `SELECT id, category, subcategory, code, label_en, label_vi,
                  body_en, body_vi, sort_order, is_active, meta, created_at, updated_at
             FROM lookup_values
            WHERE is_active = true
            ORDER BY category, COALESCE(subcategory, ''), sort_order, code`
    );
    const byCategory = {};
    for (const row of r.rows) {
      if (!byCategory[row.category]) byCategory[row.category] = [];
      byCategory[row.category].push({
        ...rowToJson(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
    res.json({ success: true, data: byCategory });
  } catch (err) { next(err); }
}

// ── Write endpoints (admin only) ─────────────────────────────────

// Validate the request body. Returns null if OK, error string if not.
function validateBody(body, { requireCategory = true } = {}) {
  if (requireCategory) {
    if (!body.category || typeof body.category !== 'string') return 'category is required';
    if (!/^[a-z][a-z0-9_]*$/.test(body.category)) {
      return 'category must be lowercase letters, digits, and underscores only';
    }
  }
  if (!body.code || typeof body.code !== 'string') return 'code is required';
  if (body.subcategory != null && typeof body.subcategory !== 'string') return 'subcategory must be a string';
  for (const f of ['labelEn', 'labelVi', 'bodyEn', 'bodyVi']) {
    if (body[f] != null && typeof body[f] !== 'string') return `${f} must be a string`;
  }
  if (body.sortOrder != null && !Number.isInteger(body.sortOrder)) return 'sortOrder must be an integer';
  if (body.meta != null && typeof body.meta !== 'object') return 'meta must be an object';
  return null;
}

// POST /api/lookups
// Body: { category, code, subcategory?, labelEn?, labelVi?, bodyEn?, bodyVi?, sortOrder?, meta? }
async function create(req, res, next) {
  try {
    const err = validateBody(req.body);
    if (err) return res.status(400).json({ success: false, error: err });

    const {
      category, subcategory = null, code,
      labelEn = null, labelVi = null,
      bodyEn = null, bodyVi = null,
      sortOrder = 0, meta = {},
    } = req.body;

    const r = await pool.query(
      `INSERT INTO lookup_values
         (category, subcategory, code, label_en, label_vi, body_en, body_vi, sort_order, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [category, subcategory, code, labelEn, labelVi, bodyEn, bodyVi, sortOrder, JSON.stringify(meta)]
    );
    invalidateCache();
    res.status(201).json({ success: true, data: rowToJson(r.rows[0]) });
  } catch (err) {
    // 23505 = unique_violation
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A lookup value with the same (category, subcategory, code) already exists.',
      });
    }
    next(err);
  }
}

// PUT /api/lookups/:id
// Partial update — fields not in the body are left untouched.
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const err = validateBody(req.body, { requireCategory: false });
    if (err) return res.status(400).json({ success: false, error: err });

    // Build dynamic SET clause for only the provided fields
    const sets = [];
    const vals = [];
    const map = {
      category:    'category',
      subcategory: 'subcategory',
      code:        'code',
      labelEn:     'label_en',
      labelVi:     'label_vi',
      bodyEn:      'body_en',
      bodyVi:      'body_vi',
      sortOrder:   'sort_order',
      isActive:    'is_active',
    };
    for (const [jsKey, dbCol] of Object.entries(map)) {
      if (req.body[jsKey] !== undefined) {
        vals.push(req.body[jsKey]);
        sets.push(`${dbCol} = $${vals.length}`);
      }
    }
    if (req.body.meta !== undefined) {
      vals.push(JSON.stringify(req.body.meta || {}));
      sets.push(`meta = $${vals.length}::jsonb`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    vals.push(id);
    const r = await pool.query(
      `UPDATE lookup_values SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lookup value not found' });
    }
    invalidateCache();
    res.json({ success: true, data: rowToJson(r.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A lookup value with the same (category, subcategory, code) already exists.',
      });
    }
    next(err);
  }
}

// DELETE /api/lookups/:id
// Soft delete — sets is_active = false. Use POST /api/lookups/:id/reactivate
// to bring it back. We never hard-delete because other rows in the database
// may reference these values (e.g. students.destination_country).
async function softDelete(req, res, next) {
  try {
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE lookup_values SET is_active = false WHERE id = $1 RETURNING *`,
      [id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lookup value not found' });
    }
    invalidateCache();
    res.json({ success: true, data: rowToJson(r.rows[0]) });
  } catch (err) { next(err); }
}

// POST /api/lookups/:id/reactivate
async function reactivate(req, res, next) {
  try {
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE lookup_values SET is_active = true WHERE id = $1 RETURNING *`,
      [id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lookup value not found' });
    }
    invalidateCache();
    res.json({ success: true, data: rowToJson(r.rows[0]) });
  } catch (err) { next(err); }
}

// POST /api/lookups/cache/invalidate
// Manual cache bust — useful for debugging or after a manual SQL update.
async function bustCache(req, res, next) {
  try {
    invalidateCache();
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  listAll,
  listOne,
  adminListAll,
  create,
  update,
  softDelete,
  reactivate,
  bustCache,
  // exported for tests / other modules that might want to flush cache
  invalidateCache,
};
