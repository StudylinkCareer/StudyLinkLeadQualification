// src/utils/caseConvert.js

// camelCase → snake_case (e.g. seniorCounselor → senior_counselor)
export function toSnakeCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

// snake_case → camelCase (e.g. senior_counselor → seniorCounselor)
export function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Convert all keys of an object from snake_case to camelCase.
//
// '_raw_<fieldName>' keys (permissionService.js's masked-field search
// companion, e.g. '_raw_phone') are deliberately exempt. The server already
// sends camelCase — this frontend pass is meant to be a no-op belt-and-braces
// safety net for it — but toCamelCase's regex treats ANY underscore+letter as
// a snake_case boundary, so it doesn't know '_raw_' is a sentinel prefix, not
// snake_case: '_raw_phone' silently became 'RawPhone'. Every place that reads
// '_raw_<field>' by that exact literal name (Leads.jsx's per-column search
// filters, LeadDetail.jsx's contact-log modal) got `undefined` back with no
// error — global search still worked by accident (it flattens ALL values
// regardless of key name), which is what made this look like a search-only
// bug rather than the response-shape bug it actually was. Found 2026-08.
export function objectToCamelCase(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.startsWith('_raw_') ? k : toCamelCase(k), v])
  );
}

// Convert all keys of an object from camelCase to snake_case
export function objectToSnakeCase(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toSnakeCase(k), v])
  );
}
