// Who a signed contract counts for in reports (2026-11, owner). Normally the
// lead's counselor/presales. leads.contract_credit_to overrides them when a
// signed student moves to someone else for after-sales care, so the person
// who closed it keeps the contract and the new owner doesn't gain it.

// SQL boolean: the contract counts for someone in `names` (a text[] expression).
function creditedToAny(alias, names) {
  return `(CASE WHEN NULLIF(${alias}.contract_credit_to, '') IS NOT NULL
                THEN ${alias}.contract_credit_to = ANY(${names})
                ELSE (${alias}.counselor = ANY(${names}) OR ${alias}.presales = ANY(${names})) END)`;
}

// Counsellor-only reports, on an unaliased leads table.
const CREDITED_COUNSELOR_SQL = `COALESCE(NULLIF(contract_credit_to, ''), counselor)`;

module.exports = { creditedToAny, CREDITED_COUNSELOR_SQL };
