// server/src/routes/referralSources.js
// ─────────────────────────────────────────────────────────────────────
// CRUD for the two referral lists used in lead attribution:
//   /api/referral-sources/subagents
//   /api/referral-sources/partners
// Both tables share the same shape (name, type, phone, email, notes,
// is_active). Admin / Manager / Director only. Soft delete.
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const { isManagerOrAdmin } = require('../utils/authProfiles');
function requireRole(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  // staffRole holds the auth PROFILE post-migration (Manager/Lead/CEO/COO/Admin profiles).
  if (!isManagerOrAdmin(req.session.staffRole)) return res.status(403).json({ success: false, error: 'Insufficient role' });
  next();
}

const norm  = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };
const shape = (r) => ({
  id: r.id, name: r.name, type: r.type || null,
  phone: r.phone || null, email: r.email || null, notes: r.notes || null,
  isActive: r.is_active,
});

// table names are literals from the route definitions below — never user input.
function listHandler(table) {
  return async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, name, type, phone, email, notes, is_active
           FROM ${table} WHERE is_active = true ORDER BY name ASC`
      );
      res.json({ success: true, data: r.rows.map(shape) });
    } catch (err) {
      console.error(`[referralSources] ${table} list failed:`, err);
      res.status(500).json({ success: false, error: 'Failed to load list' });
    }
  };
}

function createHandler(table) {
  return async (req, res) => {
    const name  = norm(req.body.name);
    const type  = norm(req.body.type);
    const phone = norm(req.body.phone);
    const email = norm(req.body.email);
    const notes = norm(req.body.notes);
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });

    try {
      const ins = await pool.query(
        `INSERT INTO ${table} (name, type, phone, email, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, name, type, phone, email, notes, is_active`,
        [name, type, phone, email, notes]
      );
      res.json({ success: true, data: shape(ins.rows[0]) });
    } catch (err) {
      if (err.code === '23505') {
        try {
          const re = await pool.query(
            `UPDATE ${table}
                SET type = $2, phone = $3, email = $4, notes = $5, is_active = true
              WHERE name = $1
              RETURNING id, name, type, phone, email, notes, is_active`,
            [name, type, phone, email, notes]
          );
          if (re.rowCount > 0) return res.json({ success: true, data: shape(re.rows[0]), reactivated: true });
        } catch (e2) { console.error(`[referralSources] ${table} reactivate failed:`, e2); }
        return res.status(409).json({ success: false, error: 'That name already exists' });
      }
      console.error(`[referralSources] ${table} create failed:`, err);
      res.status(500).json({ success: false, error: 'Failed to create' });
    }
  };
}

function updateHandler(table) {
  return async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

    const fields = ['name', 'type', 'phone', 'email', 'notes'];
    const sets = [], vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { vals.push(norm(req.body[f])); sets.push(`${f} = $${vals.length}`); }
    }
    if (sets.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
    if (req.body.name !== undefined && !norm(req.body.name)) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' });
    }
    vals.push(id);

    try {
      const upd = await pool.query(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${vals.length}
         RETURNING id, name, type, phone, email, notes, is_active`,
        vals
      );
      if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: shape(upd.rows[0]) });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, error: 'That name already exists' });
      console.error(`[referralSources] ${table} update failed:`, err);
      res.status(500).json({ success: false, error: 'Failed to update' });
    }
  };
}

function deleteHandler(table) {
  return async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
    try {
      const upd = await pool.query(`UPDATE ${table} SET is_active = false WHERE id = $1 RETURNING id`, [id]);
      if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true });
    } catch (err) {
      console.error(`[referralSources] ${table} delete failed:`, err);
      res.status(500).json({ success: false, error: 'Failed to delete' });
    }
  };
}

for (const table of ['subagents', 'partners']) {
  router.get(`/${table}`,        requireRole, listHandler(table));
  router.post(`/${table}`,       requireRole, createHandler(table));
  router.put(`/${table}/:id`,    requireRole, updateHandler(table));
  router.delete(`/${table}/:id`, requireRole, deleteHandler(table));
}

module.exports = router;
