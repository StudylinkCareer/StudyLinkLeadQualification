// server/src/routes/posm.js
// ─────────────────────────────────────────────────────────────────────
// POSM (printed materials: umbrellas, fans, helmets...) QR tracking.
// Each item has a permanent short code printed in its QR
// (<customer site>/q/<code>). Opening it counts a scan and sends the guest
// to the sign-up form, which tags the sign-up with the item. POSM items are
// NOT events: no event registration, Source of Lead is still the guest's own
// answer (owner, 2026-10).
//   GET  /api/posm/public/:code     (no login) count a scan, item + recent events
//   GET  /api/posm                   Marketing: items with scan/sign-up totals
//   POST /api/posm                   Marketing: create { name, code?, notes? }
//   PUT  /api/posm/:id               Marketing: { name?, notes?, isActive? }
//   GET  /api/posm/student/:id       any staff: this person's POSM sign-ups
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const { isMarketingOrOwner } = require('../utils/authProfiles');
function requireStaff(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  next();
}
function requireMarketing(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (!isMarketingOrOwner(req.session.staffRole, req.session.staffEmail)) {
    return res.status(403).json({ success: false, error: 'Insufficient role' });
  }
  next();
}

const norm = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };
const CODE_RE = /^[A-Z0-9-]{3,20}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I: read aloud or retyped safely
const randomCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

// Events a guest might have received the item at: recent or upcoming, not hidden.
const RECENT_EVENTS = `
  SELECT id, name FROM events
   WHERE is_active = true
     AND COALESCE(end_date, start_date, created_at::date) >= CURRENT_DATE - 365
   ORDER BY COALESCE(start_date, created_at::date) DESC, name
   LIMIT 40`;

router.get('/public/:code', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  try {
    const item = (await pool.query(`SELECT id, code, name FROM posm_items WHERE code = $1 AND is_active = true`, [code])).rows[0];
    if (!item) return res.status(404).json({ success: false, error: 'Not found' });
    await pool.query(`INSERT INTO posm_scans (posm_id) VALUES ($1)`, [item.id]);
    const events = (await pool.query(RECENT_EVENTS)).rows;
    res.json({ success: true, data: { ...item, events } });
  } catch (err) {
    console.error('[posm] public lookup failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load' });
  }
});

router.get('/', requireMarketing, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.code, p.name, p.notes, p.is_active, p.created_by, p.created_at,
             (SELECT count(*)::int FROM posm_scans s WHERE s.posm_id = p.id) AS scans,
             (SELECT count(*)::int FROM posm_signups g WHERE g.posm_id = p.id) AS signups
        FROM posm_items p
       ORDER BY p.is_active DESC, p.created_at DESC`);
    res.json({ success: true, data: rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, notes: r.notes, isActive: r.is_active,
      createdBy: r.created_by, createdAt: r.created_at, scans: r.scans, signups: r.signups,
    })) });
  } catch (err) {
    console.error('[posm] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load POSM items' });
  }
});

router.post('/', requireMarketing, async (req, res) => {
  const name = norm(req.body?.name);
  const custom = norm(req.body?.code);
  if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
  const code = custom ? custom.toUpperCase() : null;
  if (code && !CODE_RE.test(code)) {
    return res.status(400).json({ success: false, error: 'Code: 3-20 letters, numbers or dashes' });
  }
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await pool.query(
          `INSERT INTO posm_items (code, name, notes, created_by) VALUES ($1, $2, $3, $4) RETURNING id, code`,
          [code || randomCode(), name, norm(req.body?.notes), req.session.staffName || req.session.staffEmail || null]);
        return res.json({ success: true, data: r.rows[0] });
      } catch (e) {
        if (e.code !== '23505') throw e;
        if (code) return res.status(409).json({ success: false, error: 'That code is already used' });
      }
    }
    res.status(500).json({ success: false, error: 'Could not generate a unique code' });
  } catch (err) {
    console.error('[posm] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create' });
  }
});

// The code is printed on physical items, so it can never be edited.
router.put('/:id', requireMarketing, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  const sets = [], vals = [];
  if ('name' in (req.body || {})) {
    const n = norm(req.body.name);
    if (!n) return res.status(400).json({ success: false, error: 'Name is required' });
    vals.push(n); sets.push(`name = $${vals.length}`);
  }
  if ('notes' in (req.body || {})) { vals.push(norm(req.body.notes)); sets.push(`notes = $${vals.length}`); }
  if ('isActive' in (req.body || {})) { vals.push(!!req.body.isActive); sets.push(`is_active = $${vals.length}`); }
  if (!sets.length) return res.status(400).json({ success: false, error: 'No fields to update' });
  vals.push(id);
  try {
    const r = await pool.query(`UPDATE posm_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[posm] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update' });
  }
});

router.get('/student/:studentId', requireStaff, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.id, p.name AS posm_name, p.code, e.name AS received_event, g.received_other, g.created_at
        FROM posm_signups g
        JOIN posm_items p ON p.id = g.posm_id
        LEFT JOIN events e ON e.id = g.received_event_id
       WHERE g.student_id = $1
       ORDER BY g.created_at DESC`, [String(req.params.studentId)]);
    res.json({ success: true, data: rows.map((r) => ({
      id: r.id, posmName: r.posm_name, code: r.code, receivedEvent: r.received_event,
      receivedOther: r.received_other, createdAt: r.created_at,
    })) });
  } catch (err) {
    if (err.code === '42P01') return res.json({ success: true, data: [] });   // before the migration
    console.error('[posm] student lookup failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load' });
  }
});

module.exports = router;
