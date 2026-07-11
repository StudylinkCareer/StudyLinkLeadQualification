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

function isAdminProfile(x)   { return ADMIN_PROFILES.has(x); }
function isManagerOrAdmin(x) { return ADMIN_PROFILES.has(x) || MANAGER_PROFILES.has(x); }

module.exports = { ADMIN_PROFILES, MANAGER_PROFILES, isAdminProfile, isManagerOrAdmin };
