// server/src/controllers/noteDraftController.js
// Cross-device note drafts — see models/NoteDraft.js for the full rationale.

const NoteDraft = require('../models/NoteDraft');

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

module.exports = { createDraft, listPendingDrafts, getDraft, discardDraft };
