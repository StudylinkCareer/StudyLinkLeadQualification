// permissionService.js
// ---------------------------------------------------------------------------
// PHASE 2a of role-based access control work (Item 2).
//
// Centralized service for reading and applying permission rules from the
// three tables seeded in Phases 1 and 1.5:
//   - role_permissions       (resource-level: view_list/view_detail/edit/delete/assign × scope)
//   - permission_fields      (field catalog with categories)
//   - role_field_permissions (per-role × per-field × list/detail permissions)
//
// This is a PURE ADDITION — nothing else in the codebase imports it yet.
// Phase 2b/2c will wire it into the controllers and routes.
//
// USAGE:
//   const perms = require('./services/permissionService');
//
//   // Resource-level check
//   const scope = await perms.getResourceScope('Counselor', 'leads', 'view_detail');
//   // → 'own'
//
//   // Per-lead access check (combines scope + ownership)
//   const canSee = await perms.canAccessLead(staff, lead, 'view_detail');
//
//   // Apply field-level masking before sending lead in API response
//   const masked = await perms.applyFieldPermissions(staff, lead, 'detail');
//
//   // For a single field
//   const canEdit = await perms.canEditField('Manager', 'leads', 'budget');
//
//   // Bulk permission set for the frontend
//   const allPerms = await perms.getAllPermissions('Director');
//
// HOW TO QUICK-TEST:
//   Run this file directly to see a self-test dump:
//       node permissionService.js
//   It prints the permission summary for each role so you can sanity-check
//   that the seeded data flows through correctly.
// ---------------------------------------------------------------------------

// ─── Load .env regardless of where the script is invoked from ────────────
// When this file is `require()`d by app.js/server.js, dotenv was already
// loaded by the entry point — calling it again is harmless (idempotent;
// won't overwrite already-set vars).
//
// When this file is run DIRECTLY (`node permissionService.js`) for the
// self-test, no other file has loaded .env yet. Without this line, the
// pg pool gets `connectionString: undefined` and you'd see the SASL
// "password must be a string" error.
//
// path.resolve(__dirname, '../../.env') goes from Server/src/services/
// up two levels to Server/, where .env actually lives.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const pool = require('./db');

// ─── In-memory cache ──────────────────────────────────────────────────────
// Permissions change rarely (only via the future admin UI), so we cache the
// full set in memory and refresh every 60s. Avoids hitting the DB on every
// API request.
//
// When admin saves new rules via the Phase 5 settings page, that endpoint
// should call clearCache() to force a reload on the next request.
// ──────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;

const _cache = {
  rolePerms:      null,   // Map<role, Map<resource, Map<operation, scope>>>
  roleFieldPerms: null,   // Map<role, Map<resource, Map<fieldName, {list, detail}>>>
  loadedAt:       0,
};

async function _loadCache() {
  // Load role_permissions
  const rolePermsRes = await pool.query(
    `SELECT role, resource, operation, scope FROM role_permissions`
  );
  const rolePerms = new Map();
  for (const r of rolePermsRes.rows) {
    if (!rolePerms.has(r.role)) rolePerms.set(r.role, new Map());
    const byResource = rolePerms.get(r.role);
    if (!byResource.has(r.resource)) byResource.set(r.resource, new Map());
    byResource.get(r.resource).set(r.operation, r.scope);
  }

  // Load role_field_permissions
  const fieldPermsRes = await pool.query(
    `SELECT role, resource, field_name, list_permission, detail_permission
     FROM role_field_permissions`
  );
  const roleFieldPerms = new Map();
  for (const r of fieldPermsRes.rows) {
    if (!roleFieldPerms.has(r.role)) roleFieldPerms.set(r.role, new Map());
    const byResource = roleFieldPerms.get(r.role);
    if (!byResource.has(r.resource)) byResource.set(r.resource, new Map());
    byResource.get(r.resource).set(r.field_name, {
      list:   r.list_permission,
      detail: r.detail_permission,
    });
  }

  _cache.rolePerms      = rolePerms;
  _cache.roleFieldPerms = roleFieldPerms;
  _cache.loadedAt       = Date.now();
}

async function _ensureCache() {
  if (!_cache.rolePerms || Date.now() - _cache.loadedAt > CACHE_TTL_MS) {
    await _loadCache();
  }
}

function clearCache() {
  _cache.rolePerms      = null;
  _cache.roleFieldPerms = null;
  _cache.loadedAt       = 0;
}

// ─── Resource-level lookups ──────────────────────────────────────────────

/**
 * Get the scope for a (role, resource, operation) rule.
 * Returns 'all' | 'own' | 'none'. Defaults to 'none' for safety if the
 * rule doesn't exist (deny by default).
 */
async function getResourceScope(role, resource, operation) {
  await _ensureCache();
  return _cache.rolePerms?.get(role)?.get(resource)?.get(operation) ?? 'none';
}

// ─── Field-level lookups ─────────────────────────────────────────────────

/**
 * Get the field-level permissions for (role, resource, field).
 * Returns { list, detail } where each is one of:
 *   'edit' | 'view' | 'view_masked' | 'none'.
 *
 * Fallback for fields not in the catalog: { list: 'view', detail: 'edit' }.
 * This matches the 'other' category rule for all roles, which is the most
 * common case and the existing behavior of the system.
 */
async function getFieldPermission(role, resource, fieldName) {
  await _ensureCache();
  const perm = _cache.roleFieldPerms?.get(role)?.get(resource)?.get(fieldName);
  return perm || { list: 'view', detail: 'edit' };
}

/**
 * True if the role can edit the given field on the given resource.
 * Convenience wrapper around getFieldPermission.
 */
async function canEditField(role, resource, fieldName) {
  const perm = await getFieldPermission(role, resource, fieldName);
  return perm.detail === 'edit';
}

// ─── Lead-ownership check ────────────────────────────────────────────────

/**
 * Is this staff member assigned to this lead? Returns true if their fullName
 * appears in any of the four assignment fields. Used to evaluate scope='own'.
 *
 * `staff` should have { fullName, role }. `lead` is the lead record.
 */
function isLeadAssignedTo(staff, lead) {
  if (!staff || !lead) return false;
  const name = staff.fullName;
  if (!name) return false;
  return (
    lead.counselor       === name ||
    lead.seniorCounselor === name ||
    lead.presales        === name ||
    lead.marketingStaff  === name
  );
}

/**
 * Can this staff member perform this operation on this specific lead?
 * Combines the resource-level scope rule with the ownership check.
 *
 *   scope = 'all'  → yes (regardless of ownership)
 *   scope = 'own'  → yes iff isLeadAssignedTo(staff, lead)
 *   scope = 'none' → no
 *
 * Use this in controllers to gate access to detail/edit/delete/assign on
 * a specific lead.
 */
async function canAccessLead(staff, lead, operation) {
  const scope = await getResourceScope(staff.role, 'leads', operation);
  if (scope === 'all')  return true;
  if (scope === 'none') return false;
  if (scope === 'own')  return isLeadAssignedTo(staff, lead);
  return false;
}

// ─── Response masking ────────────────────────────────────────────────────

/**
 * Apply field-level permissions to a lead object before sending it in an
 * API response. Returns a NEW object — does not mutate the input.
 *
 *   context = 'list'   → use each field's list_permission
 *   context = 'detail' → use each field's detail_permission
 *
 * Per-field behavior based on the permission value:
 *   'edit' or 'view'   → field passes through with its real value
 *   'view_masked'      → field value replaced with the literal '[hidden]'
 *   'none'             → field is OMITTED from the output entirely
 *
 * The frontend can rely on absent fields meaning "you don't get to know
 * this exists", and '[hidden]' meaning "this exists but isn't yours to read".
 */
async function applyFieldPermissions(staff, lead, context) {
  if (!lead || typeof lead !== 'object') return lead;
  await _ensureCache();
  const role = staff.role;
  const result = {};

  for (const [fieldName, value] of Object.entries(lead)) {
    const perm = await getFieldPermission(role, 'leads', fieldName);
    const permValue = context === 'list' ? perm.list : perm.detail;

    if (permValue === 'none') {
      // Field omitted entirely — caller sees no evidence it exists.
      continue;
    }
    if (permValue === 'view_masked') {
      result[fieldName] = '[hidden]';
      continue;
    }
    // 'edit' or 'view' → pass through actual value
    result[fieldName] = value;
  }
  return result;
}

/**
 * Apply field-level permissions to an ARRAY of leads (the list endpoint).
 * Convenience wrapper.
 */
async function applyFieldPermissionsToList(staff, leads) {
  if (!Array.isArray(leads)) return leads;
  const out = [];
  for (const lead of leads) {
    out.push(await applyFieldPermissions(staff, lead, 'list'));
  }
  return out;
}

// ─── Bulk permissions for the frontend ───────────────────────────────────

/**
 * Get all permissions for a role as a plain JS object the frontend can
 * iterate. Returned by GET /api/staff/permissions (Phase 2b) so the React
 * app can shape its UI (grey out rows, hide fields, disable edit controls).
 *
 * Shape:
 *   {
 *     resource: {
 *       leads: { view_list:'all', view_detail:'own', edit:'own', delete:'none', assign:'own' }
 *     },
 *     fields: {
 *       leads: {
 *         email:  { list:'view_masked', detail:'edit' },
 *         budget: { list:'view_masked', detail:'edit' },
 *         ...
 *       }
 *     }
 *   }
 */
async function getAllPermissions(role) {
  await _ensureCache();

  const resourceObj = {};
  const rolePerms = _cache.rolePerms?.get(role);
  if (rolePerms) {
    for (const [resource, ops] of rolePerms) {
      resourceObj[resource] = Object.fromEntries(ops);
    }
  }

  const fieldsObj = {};
  const roleFieldPerms = _cache.roleFieldPerms?.get(role);
  if (roleFieldPerms) {
    for (const [resource, fields] of roleFieldPerms) {
      fieldsObj[resource] = Object.fromEntries(fields);
    }
  }

  return { resource: resourceObj, fields: fieldsObj };
}

// ─── Exports ─────────────────────────────────────────────────────────────
module.exports = {
  // Cache management
  clearCache,

  // Resource-level
  getResourceScope,

  // Field-level
  getFieldPermission,
  canEditField,

  // Lead-specific helpers
  isLeadAssignedTo,
  canAccessLead,

  // Response masking
  applyFieldPermissions,
  applyFieldPermissionsToList,

  // Bulk lookup for frontend
  getAllPermissions,
};

// ─── Self-test ───────────────────────────────────────────────────────────
// Runs only when this file is invoked directly: `node permissionService.js`.
// Loads permissions for each role and prints a summary. If something is off
// with the seed data or table shape, you'll see it here before it bites you
// in an API endpoint.
if (require.main === module) {
  (async () => {
    try {
      console.log('Running permission service self-test...\n');

      for (const role of ['Admin', 'Manager', 'Director', 'Counselor']) {
        const all = await getAllPermissions(role);
        console.log(`=== ${role} ===`);
        console.log('Resource-level rules for leads:');
        console.table(all.resource.leads || {});
        console.log('Sample field permissions:');
        const sampleFields = ['email', 'budget', 'stoneTier', 'campaignName', 'studyPlans'];
        const sampleRows = {};
        for (const f of sampleFields) {
          sampleRows[f] = all.fields.leads?.[f] || '(not in catalog)';
        }
        console.table(sampleRows);
        console.log('');
      }

      console.log('✅ Self-test complete — service is reading rules correctly.');
    } catch (err) {
      console.error('❌ Self-test failed:', err);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}
