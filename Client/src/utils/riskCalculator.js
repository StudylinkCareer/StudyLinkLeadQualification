import { SELF_ASSESSMENT_FIELDS, SCORED_INFO_FIELDS, STONE_TIERS } from './formFields';

// Tier lookup for Student Info scored fields
const INFO_FIELD_TIERS = {
  leadSource: ['Databases', 'FB-Zalo-GG-TikTok ads', 'School outreach', 'Subagent referrals', 'Ex-client'],
  interaction: ['Only left contact', 'Queries', 'Fill lead form partly', 'Fill lead form fully', 'Call in-Walk in'],
  timeline: ['36+ months', '24-36 months', '12-24 months', '6-12 months', 'Next 6 months'],
};

function getInfoFieldScore(fieldKey, value) {
  if (!value) return 0;

  if (fieldKey === 'destinationCountry') {
    const countries = typeof value === 'string'
      ? value.split(',').map(s => s.trim()).filter(Boolean)
      : (Array.isArray(value) ? value : []);
    const count = countries.length;
    if (count === 0) return 1;
    if (count === 1) return 2;
    if (count === 2) return 3;
    if (count === 3) return 4;
    return 5;
  }

  if (fieldKey === 'residency') {
    return value ? 3 : 0; // middle tier for any province
  }

  const tiers = INFO_FIELD_TIERS[fieldKey];
  if (!tiers) return 0;
  const idx = tiers.indexOf(value);
  return idx >= 0 ? idx + 1 : 0;
}

function getAssessmentFieldScore(fieldKey, value) {
  if (!value) return 0;
  const field = SELF_ASSESSMENT_FIELDS.find(f => f.key === fieldKey);
  if (!field) return 0;
  const idx = field.tiers.findIndex(t => t.value === value);
  return idx >= 0 ? idx + 1 : 0;
}

export function calculateRiskScore(studentData) {
  const breakdown = [];
  let totalScore = 0;

  // Score Student Info fields
  for (const [fieldKey, config] of Object.entries(SCORED_INFO_FIELDS)) {
    const value = studentData[fieldKey] || '';
    const tierScore = getInfoFieldScore(fieldKey, value);
    const weightedScore = tierScore * config.weight;
    breakdown.push({
      field: config.field,
      fieldKey,
      value,
      tierScore,
      weight: config.weight,
      weightedScore,
    });
    totalScore += weightedScore;
  }

  // Score Self Assessment fields
  for (const field of SELF_ASSESSMENT_FIELDS) {
    const value = studentData[field.key] || '';
    const tierScore = getAssessmentFieldScore(field.key, value);
    const weightedScore = tierScore * field.weight;
    breakdown.push({
      field: field.label,
      fieldKey: field.key,
      value,
      tierScore,
      weight: field.weight,
      weightedScore,
    });
    totalScore += weightedScore;
  }

  // Determine stone tier
  let stoneTier = STONE_TIERS[0];
  for (const tier of STONE_TIERS) {
    if (totalScore >= tier.min && totalScore <= tier.max) {
      stoneTier = tier;
      break;
    }
  }
  if (totalScore > 200) {
    stoneTier = STONE_TIERS[4];
    totalScore = 200;
  }

  return {
    totalScore,
    maxScore: 200,
    stoneTier: stoneTier.name,
    stonePackage: stoneTier.package,
    stoneColor: stoneTier.color,
    breakdown,
  };
}
