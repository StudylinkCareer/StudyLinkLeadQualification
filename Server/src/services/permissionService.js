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
// Phase 2.1 UPDATE: Replaced literal '[hidden]' masking with partial masking
// (e.g. 't...p@gmail.com', '+84... ...23'). The mask reveals enough for a
// staff member to recognise a record but not enough to read the full value.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const pool = require('./db');

const CACHE_TTL_MS = 60_000;

const _cache = {
  rolePerms:      null,
  roleFieldPerms: null,
  loadedAt:       0,
};

async function _loadCache() {
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

async function getResourceScope(role, resource, operation) {
  await _ensureCache();
  return _cache.rolePerms?.get(role)?.get(resource)?.get(operation) ?? 'none';
}

// ─── Field-level lookups ─────────────────────────────────────────────────

async function getFieldPermission(role, resource, fieldName) {
  await _ensureCache();
  const perm = _cache.roleFieldPerms?.get(role)?.get(resource)?.get(fieldName);
  return perm || { list: 'view', detail: 'edit' };
}

async function canEditField(role, resource, fieldName) {
  const perm = await getFieldPermission(role, resource, fieldName);
  return perm.detail === 'edit';
}

// ─── Lead-ownership check ────────────────────────────────────────────────

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

async function canAccessLead(staff, lead, operation) {
  const scope = await getResourceScope(staff.role, 'leads', operation);
  if (scope === 'all')  return true;
  if (scope === 'none') return false;
  if (scope === 'own')  return isLeadAssignedTo(staff, lead);
  return false;
}

// ─── Masking helpers ─────────────────────────────────────────────────────
//
// These produce partial masks: enough to recognise a record but not enough
// to read its full value. Replaces the old '[hidden]' placeholder.
//
// Examples:
//   maskEmail('trinhhoangdiep@gmail.com')  → 't...p@gmail.com'
//   maskPhone('+84912345623')              → '+84... ...23'
//   maskPhone('0912345623')                → '091... ...23'
//   maskGeneric('Nguyễn Văn A')             → 'N...A'
//
// Field-type detection prefers the field NAME (more reliable) over the
// content. Falls back to content sniffing (presence of '@', digit ratio)
// for fields whose name doesn't disambiguate.

function maskEmail(email) {
  const s = String(email);
  const at = s.indexOf('@');
  if (at < 0) return maskGeneric(s);
  const local  = s.slice(0, at);
  const domain = s.slice(at);   // includes the '@'
  if (local.length <= 1) return `*...${domain}`;
  if (local.length === 2) return `${local[0]}...${domain}`;
  return `${local[0]}...${local[local.length - 1]}${domain}`;
}

function maskPhone(phone) {
  const s = String(phone);
  // Strip everything except digits and '+'
  const cleaned = s.replace(/[^\d+]/g, '');
  if (cleaned.length <= 4) return '...';
  // Keep leading 3 chars (e.g. '+84' or '091') and trailing 2 digits
  const head = cleaned.startsWith('+') ? cleaned.slice(0, 3) : cleaned.slice(0, 3);
  const tail = cleaned.slice(-2);
  return `${head}... ...${tail}`;
}

function maskGeneric(value) {
  const s = String(value);
  if (s.length === 0) return s;
  if (s.length <= 2)  return '...';
  return `${s[0]}...${s[s.length - 1]}`;
}

// Field-name patterns that signal each type. Matched case-insensitively
// against the field name (works on camelCase, snake_case, etc).
const _EMAIL_FIELDS = /email|mail/i;
const _PHONE_FIELDS = /phone|mobile|tel|zalo|whatsapp|viber/i;

function maskValue(fieldName, value) {
  if (value === null || value === undefined || value === '') return value;
  const f = String(fieldName || '');
  const s = String(value);

  // 1. Decide by field name first — most reliable
  if (_EMAIL_FIELDS.test(f)) return maskEmail(s);
  if (_PHONE_FIELDS.test(f)) return maskPhone(s);

  // 2. Fall back to content sniffing for ambiguous field names
  if (s.includes('@')) return maskEmail(s);
  const digitsOnly = s.replace(/\D/g, '');
  if (digitsOnly.length >= 6 && digitsOnly.length / s.length > 0.6) return maskPhone(s);

  // 3. Generic mask for everything else (names, addresses, etc.)
  return maskGeneric(s);
}

// ─── Response masking ────────────────────────────────────────────────────
//
// Applies field-level permissions to a lead object before sending it in an
// API response. Returns a NEW object — does not mutate the input.
//
// Per-field behaviour based on the permission value:
//   'edit' or 'view'   → passes through with its real value
//   'view_masked'      → value replaced with a partial mask (see maskValue)
//   'none'             → field OMITTED from the output entirely

async function applyFieldPermissions(staff, lead, context) {
  if (!lead || typeof lead !== 'object') return lead;
  await _ensureCache();
  const role = staff.role;
  const result = {};

  for (const [fieldName, value] of Object.entries(lead)) {
    const perm = await getFieldPermission(role, 'leads', fieldName);
    const permValue = context === 'list' ? perm.list : perm.detail;

    if (permValue === 'none') continue;
    if (permValue === 'view_masked') {
      result[fieldName] = maskValue(fieldName, value);
      continue;
    }
    result[fieldName] = value;
  }
  return result;
}

async function applyFieldPermissionsToList(staff, leads) {
  if (!Array.isArray(leads)) return leads;
  const out = [];
  for (const lead of leads) {
    out.push(await applyFieldPermissions(staff, lead, 'list'));
  }
  return out;
}

// ─── Bulk permissions for the frontend ───────────────────────────────────

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
  clearCache,
  getResourceScope,
  getFieldPermission,
  canEditField,
  isLeadAssignedTo,
  canAccessLead,
  applyFieldPermissions,
  applyFieldPermissionsToList,
  getAllPermissions,
  // Masking utilities — exported for testing and reuse
  maskValue,
  maskEmail,
  maskPhone,
  maskGeneric,
};

// ─── Self-test ───────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    try {
      console.log('Running permission service self-test...\n');

      // 1. Masking helpers
      console.log('=== Masking helpers ===');
      console.table({
        email:   { in: 'trinhhoangdiep@gmail.com', out: maskEmail('trinhhoangdiep@gmail.com') },
        twoChar: { in: 'ab@gmail.com',             out: maskEmail('ab@gmail.com') },
        phoneVN: { in: '+84912345623',             out: maskPhone('+84912345623') },
        phone0:  { in: '0912345623',               out: maskPhone('0912345623') },
        name:    { in: 'Nguyễn Văn A',             out: maskGeneric('Nguyễn Văn A') },
      });

      // 2. Permissions self-test
      for (const role of ['Admin', 'Manager', 'Director', 'Counselor']) {
        const all = await getAllPermissions(role);
        console.log(`\n=== ${role} ===`);
        console.log('Resource-level rules for leads:');
        console.table(all.resource.leads || {});
        const sampleFields = ['email', 'phone', 'stoneTier', 'budget', 'studyPlans'];
        const sampleRows = {};
        for (const f of sampleFields) {
          sampleRows[f] = all.fields.leads?.[f] || '(not in catalog)';
        }
        console.log('Sample field permissions:');
        console.table(sampleRows);
      }

      console.log('\n✅ Self-test complete.');
    } catch (err) {
      console.error('❌ Self-test failed:', err);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}
