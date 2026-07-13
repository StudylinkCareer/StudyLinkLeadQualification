// src/utils/roleProfiles.js
// Client mirror of Server/src/utils/authProfiles.js — classify a PROFILE into
// admin / manager tiers for the few UI gates that can't be expressed as a plain
// resource permission (maintenance, Deep Cleanse, closed-lead reversal, admin
// pipeline card, report export).
//
// IMPORTANT: gate on `staff.position`, NOT `staff.role`. After the auth-profile
// migration `staff.position` reliably holds the PROFILE name in every session
// response (login + checkSession), whereas `staff.role` is the coarse tier on
// login but the profile on session re-check — inconsistent and unsafe to gate on.
// Legacy roles/positions are included so gates keep working before/during the
// migration and after a rollback. Keep in sync with authProfiles.js.

export const ADMIN_PROFILES = new Set([
  // new authorisation profiles (full oversight / superuser)
  'CEO', 'COO', 'Administrator, Office', 'Manager, Technical Support',
  'Staff, Data Quality', 'Staff, Technical Support',
  // legacy roles + positions (transition + rollback safety)
  'Admin', 'Director', 'Quality', 'Tech Support',
]);

export const MANAGER_PROFILES = new Set([
  'Manager, Marketing', 'Manager, Products', 'Manager, Business Development',
  'Manager, HR', 'Manager, Finance',
  'Lead, Counsellor', 'Lead, Case Officer', 'Lead, Pre-sales',
  // legacy
  'Manager', 'Senior Counselor',
]);

// Who may open the "Staff Targets" admin page: Executive (CEO/COO), Quality
// (Data Quality) and Tech Support. Mirror of authProfiles.canManageTargets.
export const TARGETS_PROFILES = new Set([
  'CEO', 'COO',                                              // Executive
  'Staff, Data Quality',                                     // Quality
  'Staff, Technical Support', 'Manager, Technical Support',  // Tech Support
  // legacy
  'Quality', 'Tech Support',
]);

export const isAdminProfile   = (x) => ADMIN_PROFILES.has(x);
export const isManagerOrAdmin = (x) => ADMIN_PROFILES.has(x) || MANAGER_PROFILES.has(x);
export const canManageTargets = (x) => TARGETS_PROFILES.has(x);

// A counsellor is identified by their position/profile containing "counsel"
// ('Counselor' legacy, 'Staff, Counsellor' / 'Lead, Counsellor' new).
export const isCounsellorProfile = (x) => /counsel/i.test(x || '');
