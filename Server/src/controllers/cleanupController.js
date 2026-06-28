// server/src/controllers/cleanupController.js
// ---------------------------------------------------------------------------
// HTTP handlers for the schema-adaptive Deep Cleanse tool. Thin wrappers over
// deepCleanseService — all the schema logic lives there. Routes are Admin-gated
// in routes/cleanup.js. Every destructive call requires an explicit confirm.
// ---------------------------------------------------------------------------

const svc = require('../services/deepCleanseService');

// GET /api/cleanup/schema — what schema are we on + what will be cleansed.
async function getSchema(req, res, next) {
  try {
    const info = await svc.schemaInfo();
    res.json({ success: true, data: {
      schema: info.schema, studentPk: info.studentPk,
      childTables: info.children.map(c => c.table),
      hasLeads: info.hasLeads, hasDuplicateReviews: info.hasDuplicateReviews,
    }});
  } catch (err) { next(err); }
}

// POST /api/cleanup/preview  { ids: [...] }  — dry-run per-table counts.
async function preview(req, res, next) {
  try {
    const result = await svc.previewByIds(req.body.ids || []);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/cleanup/apply  { ids: [...], confirm: true }  — cascade delete.
async function apply(req, res, next) {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({ success: false, error: 'confirm:true is required to delete' });
    }
    const result = await svc.deleteByIds(req.body.ids || [], { apply: true });
    if (!result.applied && result.error) {
      return res.status(500).json({ success: false, error: result.error, data: result });
    }
    res.json({ success: result.applied, data: result });
  } catch (err) { next(err); }
}

// GET /api/cleanup/orphans — count orphaned child rows (student no longer exists).
async function orphans(req, res, next) {
  try {
    const result = await svc.findOrphans();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/cleanup/orphans/purge  { confirm: true }  — delete the orphans.
async function purgeOrphans(req, res, next) {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({ success: false, error: 'confirm:true is required to purge orphans' });
    }
    const result = await svc.purgeOrphans({ apply: true });
    if (!result.applied && result.error) {
      return res.status(500).json({ success: false, error: result.error, data: result });
    }
    res.json({ success: result.applied, data: result });
  } catch (err) { next(err); }
}

// GET /api/cleanup/by-pattern?pattern=TEST-UPLOAD-%  — students matching a LIKE.
async function byPattern(req, res, next) {
  try {
    const result = await svc.findByPattern(req.query.pattern || '');
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/cleanup/duplicates?by=email|phone  — duplicate person groups.
async function duplicates(req, res, next) {
  try {
    const result = await svc.findDuplicates({ by: req.query.by || 'email' });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { getSchema, preview, apply, orphans, purgeOrphans, byPattern, duplicates };
