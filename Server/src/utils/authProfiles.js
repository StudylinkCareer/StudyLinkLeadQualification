// utils/authProfiles.js
// Classify a PROFILE (the value now held in staff.position / session.staffRole)
// into admin / manager tiers, for the few hard-coded feature gates that can't be
// expressed purely as a resource permission (maintenance, closed-lead reversal,
// event desk, cleanup). Legacy roles/positions are included so every gate keeps
// working BEFORE the profile migration, DURING it, and after a rollback.
// See migrations/authProfiles_up.js + applyStaffProfiles.js.

const ADMIN_PROFILES = new Set([
  // new authorisation profiles (full oversight / superuser)
  'CEO', 'COO', 'Administrator, Office', 'Manager, Technical Support',
  'Staff, Data Quality', 'Staff, Technical Support',
  // legacy roles + positions (transition + rollback safety)
  'Admin', 'Director', 'Quality', 'Tech Support',
]);

const MANAGER_PROFILES = new Set([
  'Manager, Marketing', 'Manager, Products', 'Manager, Business Development',
  'Manager, HR', 'Manager, Finance',
  'Lead, Counsellor', 'Lead, Case Officer', 'Lead, Pre-sales',
  // legacy
  'Manager', 'Senior Counselor',
]);

// Who may manage staff targets (the "Staff Targets" admin page): Executive
// level (CEO/COO), Quality (Data Quality) and Tech Support. Kept separate from
// the admin/manager tiers because it's a deliberately narrow, business-defined
// access list. Mirror in LeadManagement/src/utils/roleProfiles.js.
const TARGETS_PROFILES = new Set([
  'CEO', 'COO',                                              // Executive
  'Staff, Data Quality',                                     // Quality
  'Staff, Technical Support', 'Manager, Technical Support',  // Tech Support
  // legacy
  'Quality', 'Tech Support',
]);

// Who may see/manage Event reports (Event Check-in → Reports tab): Executives
// (CEO/COO), all Managers + Leads, and Data Quality. Deliberately EXCLUDES
// Administrator, Office and Technical Support staff. Mirror in roleProfiles.js.
const EVENT_REPORT_PROFILES = new Set([
  'CEO', 'COO',                                              // Executives
  'Manager, Marketing', 'Manager, Products', 'Manager, Business Development',
  'Manager, HR', 'Manager, Finance', 'Manager, Technical Support',
  'Lead, Counsellor', 'Lead, Case Officer', 'Lead, Pre-sales',   // Managers / team leads
  'Staff, Data Quality',                                     // Data Quality
  // legacy
  'Manager', 'Director', 'Quality',
]);

function isAdminProfile(x)     { return ADMIN_PROFILES.has(x); }
function isManagerOrAdmin(x)   { return ADMIN_PROFILES.has(x) || MANAGER_PROFILES.has(x); }
function canManageTargets(x)   { return TARGETS_PROFILES.has(x); }
function canViewEventReports(x){ return EVENT_REPORT_PROFILES.has(x); }

module.exports = { ADMIN_PROFILES, MANAGER_PROFILES, TARGETS_PROFILES, EVENT_REPORT_PROFILES, isAdminProfile, isManagerOrAdmin, canManageTargets, canViewEventReports };
