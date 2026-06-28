// server/src/controllers/leadController.js
//
// Engagement (lead) endpoints, built on models/Lead.js. Auth is gated by
// requireStaffAuth at the route layer (see routes/leads.js).
//
// FOLLOW-UP (parity with the students screen): per-lead access control
// (permissionService.canAccessLead) and field-level masking are not yet applied
// here — for now any authenticated staff member can read/write any lead. Wire
// these in before this replaces the live screen.

const Lead = require('../models/Lead');
const { logChanges } = require('./auditController');

// Terminal statuses: a lead in any of these is locked (display-only). Only an
// Admin/Director may edit it ("open it for belated changes"). Used by update().
const TERMINAL_STATUSES = new Set(['Lost', 'Archived', 'Contracted']);
const ADMIN_ROLES        = new Set(['Admin', 'Director']);
function canEditClosedLeads(role) { return ADMIN_ROLES.has(role); }

// GET /api/leads — every lead (with student name) for the lead-level list.
async function listAll(req, res, next) {
  try {
    const leads = await Lead.listAll();
    res.json({ success: true, data: leads });
  } catch (err) { next(err); }
}

// GET /api/leads/student/:studentId — all leads for one student (newest first).
async function listForStudent(req, res, next) {
  try {
    const leads = await Lead.findByStudent(req.params.studentId);
    res.json({ success: true, data: leads });
  } catch (err) { next(err); }
}

// GET /api/leads/:leadId — one lead.
async function getOne(req, res, next) {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
}

// POST /api/leads/student/:studentId — create a new lead for a student.
async function create(req, res, next) {
  try {
    const { studentId } = req.params;
    if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' });
    const lead = await Lead.create(studentId, req.body || {});
    res.status(201).json({ success: true, data: lead });
  } catch (err) { next(err); }
}

// PUT /api/leads/:leadId — update a lead's engagement fields (audited).
async function update(req, res, next) {
  try {
    const { leadId } = req.params;
    const before = await Lead.findById(leadId);
    if (!before) return res.status(404).json({ success: false, error: 'Lead not found' });

    // Lockdown: a closed/terminal lead is display-only except for Admin/Director.
    if (TERMINAL_STATUSES.has(before.leadStatus) && !canEditClosedLeads(req.session.staffRole)) {
      return res.status(403).json({
        success: false,
        error: `This lead is "${before.leadStatus}" and locked for editing. Ask an Admin to re-open it for changes.`,
      });
    }

    const lead = await Lead.update(leadId, req.body || {});
    if (before) {
      await logChanges({
        studentId: lead.studentId,
        leadId: Number(leadId),
        changedBy: req.session.staffName || req.session.staffEmail || 'unknown',
        oldData: before,
        newData: req.body || {},
        source: 'staff_app',
      });
    }
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
}

module.exports = { listAll, listForStudent, getOne, create, update };
