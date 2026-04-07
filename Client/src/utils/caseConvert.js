// src/utils/caseConvert.js

// camelCase → snake_case (e.g. seniorCounselor → senior_counselor)
export function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// snake_case → camelCase (e.g. senior_counselor → seniorCounselor)
export function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Convert all keys of an object from snake_case to camelCase
export function objectToCamelCase(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toCamelCase(k), v])
  );
}

// Convert all keys of an object from camelCase to snake_case
export function objectToSnakeCase(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toSnakeCase(k), v])
  );
}