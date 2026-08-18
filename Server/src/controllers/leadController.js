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
const uncontactableTransfer = require('../services/uncontactableTransfer');

// Runs both hop-checks unconditionally — each is already a safe no-op
// (checked internally against lead_status/counselor/presales) when it
// doesn't apply, so there's no need to know which one is relevant here.
// Never throws (checkAndTransfer/checkAndTransferPresales already catch
// everything internally and return a result object either way).
async function runTransferCheck(leadId) {
  const sales    = await uncontactableTransfer.checkAndTransfer(leadId);
  const presales = await uncontactableTransfer.checkAndTransferPresales(leadId);
  return sales.transferred ? sales : presales;
}

// Terminal statuses: a lead in any of these is locked (display-only). Only an
// Admin/Director/Manager may edit it ("re-open it for belated changes"). Used by
// update(). NOTE: Contracted is NOT terminal — a contracted lead stays OPEN and
// editable; staff assignment is separately read-only on the lead (Order-driven).
const TERMINAL_STATUSES = new Set(['Lost', 'Archived', 'Cancelled']);
const { isManagerOrAdmin } = require('../utils/authProfiles');
// Closed leads are reversible by Admin/Director/Manager tiers — under the profile
// model that's any admin or manager/lead profile (legacy roles still included).
function canEditClosedLeads(role) { return isManagerOrAdmin(role); }

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
//
// Self-healing fallback for the deferred Uncontactable transfer (confirmed
// 2026-08): the normal trigger is POST /:leadId/check-transfer, fired when
// a counselor/presales staffer leaves the lead page. If that call never
// fires for some reason (closed tab, network blip), a qualifying lead
// would otherwise sit stuck forever — so any fresh GET of the lead also
// opportunistically runs the check first. By the time anyone loads this
// page fresh, a resulting ownership change is expected, not a surprise
// mid-interaction, so there's nothing jarring about it happening here.
async function getOne(req, res, next) {
  try {
    await uncontactableTransfer.checkAndTransfer(req.params.leadId).catch(() => {});
    await uncontactableTransfer.checkAndTransferPresales(req.params.leadId).catch(() => {});
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (err) { next(err); }
}

// POST /api/leads/:leadId/check-transfer — the deferred trigger itself.
// Called by the frontend when a staffer navigates away from a lead page.
// Safe to call unconditionally/repeatedly/by anyone authenticated — both
// underlying checks re-derive everything from the lead's own current
// state and never throw.
async function checkTransfer(req, res, next) {
  try {
    const result = await runTransferCheck(req.params.leadId);
    res.json({ success: true, data: result });
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

module.exports = { listAll, listForStudent, getOne, create, update, checkTransfer };
