// server/src/utils/caseConvert.js

// camelCase  → snake_case  (e.g. seniorCounselor → senior_counselor)
function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// snake_case → camelCase  (e.g. senior_counselor → seniorCounselor)
function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Convert all keys of an object from snake_case to camelCase
function objectToCamelCase(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toCamelCase(k), v])
  );
}

// Convert all keys of an object from camelCase to snake_case
function objectToSnakeCase(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toSnakeCase(k), v])
  );
}

module.exports = { toSnakeCase, toCamelCase, objectToCamelCase, objectToSnakeCase };