// server/src/controllers/noteDraftController.js
// Cross-device note drafts — see models/NoteDraft.js for the full rationale.

const NoteDraft = require('../models/NoteDraft');
const permissionService = require('../services/permissionService');

// Admin dashboard (confirmed 2026-08): CEO + Manager, Technical Support
// only (Huy Anh, for testing/build — same position already used for the
// Maintenance/Stale Reminders gate) — deliberately narrower than the
// general admin tier, since per-staff completion/discard stats are a bit
// HR-adjacent. Table-driven (resource 'note_drafts_dashboard') rather than
// a hardcoded role list, so it can be widened later without a code change.
async function requireDraftsAdmin(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const scope = await permissionService.getResourceScope(req.session.staffRole, 'note_drafts_dashboard', 'view');
  if (!scope || scope === 'none') return res.status(403).json({ success: false, error: 'Not authorised' });
  next();
}

const ALLOWED_NOTE_TYPES = ['counselor', 'presales', 'management'];
const ALLOWED_METHODS = ['call', 'sms', 'zalo', 'whatsapp', 'messenger', 'email'];

async function createDraft(req, res, next) {
  try {
    const { studentId, leadId, method, noteType, contactName, contactPhone, contactEmail } = req.body || {};
    if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' });
    if (!ALLOWED_METHODS.includes(method)) return res.status(400).json({ success: false, error: 'Invalid method' });
    if (!ALLOWED_NOTE_TYPES.includes(noteType)) return res.status(400).json({ success: false, error: 'Invalid noteType' });

    const draft = await NoteDraft.create({
      staffId: req.session.staffId,
      staffName: req.session.staffName,
      studentId,
      leadId: leadId ? Number(leadId) : null,
      method, noteType, contactName, contactPhone, contactEmail,
    });
    res.status(201).json({ success: true, data: draft });
  } catch (err) { next(err); }
}

async function listPendingDrafts(req, res, next) {
  try {
    const drafts = await NoteDraft.listPending(req.session.staffId);
    res.json({ success: true, data: drafts });
  } catch (err) { next(err); }
}

async function getDraft(req, res, next) {
  try {
    const draft = await NoteDraft.getById(req.params.id, req.session.staffId);
    if (!draft) return res.status(404).json({ success: false, error: 'Draft not found' });
    res.json({ success: true, data: draft });
  } catch (err) { next(err); }
}

async function discardDraft(req, res, next) {
  try {
    const result = await NoteDraft.discard(req.params.id, req.session.staffId);
    if (!result) return res.status(404).json({ success: false, error: 'Draft not found, not yours, or already resolved' });
    res.json({ success: true, data: { id: Number(req.params.id), discarded: true } });
  } catch (err) { next(err); }
}

async function listAllDraftsForAdmin(req, res, next) {
  try {
    const drafts = await NoteDraft.listAllForAdmin();
    res.json({ success: true, data: drafts });
  } catch (err) { next(err); }
}

async function getDraftStatsForAdmin(req, res, next) {
  try {
    const stats = await NoteDraft.getAdminStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
}

module.exports = {
  createDraft, listPendingDrafts, getDraft, discardDraft,
  requireDraftsAdmin, listAllDraftsForAdmin, getDraftStatsForAdmin,
};
