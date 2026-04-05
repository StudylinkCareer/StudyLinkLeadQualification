// Weighted scoring engine for risk assessment
// 14 scored fields × weights, total max weight = 40, max score = 200

const SCORING_FIELDS = {
  // Student Info fields that contribute to score
  'leadSource':      { weight: 2, field: 'Lead Source' },
  'interaction':     { weight: 1, field: 'Interaction' },
  'destinationCountry': { weight: 2, field: 'Destination Country' },
  'timeline':        { weight: 3, field: 'Timeline' },
  'residency':       { weight: 3, field: 'Residency' },
  // Self Assessment fields
  'budget':          { weight: 4, field: 'Budget' },
  'scholarshipDemand': { weight: 3, field: 'Scholarship Demand' },
  'englishLevel':    { weight: 4, field: 'English Level' },
  'gpa':             { weight: 2, field: 'GPA' },
  'immigrationHistory': { weight: 3, field: 'Immigration History' },
  'sponsorIncome':   { weight: 4, field: 'Sponsor Income' },
  'incomeEvidence':  { weight: 4, field: 'Income Evidence' },
  'studyPlanGap':    { weight: 3, field: 'Study Plan & Gap Years' },
  'ultimateObjective': { weight: 2, field: 'Ultimate Objective' },
};

// Tier options for scored Student Info fields — tier value is 1-5 based on position
const FIELD_TIERS = {
  leadSource: ['Databases', 'FB-Zalo-GG-TikTok ads', 'School outreach', 'Subagent referrals', 'Ex-client'],
  interaction: ['Only left contact', 'Queries', 'Fill lead form partly', 'Fill lead form fully', 'Call in-Walk in'],
  destinationCountry: null, // scored by count: 0=1, 1=2, 2=3, 3=4, 4+=5
  timeline: ['36+ months', '24-36 months', '12-24 months', '6-12 months', 'Next 6 months'],
  residency: null, // major city = higher tier; simplified: scored by region
  budget: ['< 300M VND', '300-500M VND', '500-800M VND', '800M-1B VND', '1-1.5B VND'],
  scholarshipDemand: ['100% scholarship', '60-90% scholarship', '30-50% scholarship', '20-25% scholarship', 'No scholarship needed'],
  englishLevel: ['Beginner', 'IELTS 4-4.5', 'IELTS 5-5.5', 'IELTS 6-6.5', 'IELTS 7+'],
  gpa: ['< 6.5', '6.5-6.9', '7-7.9', '8-8.9', '9+'],
  immigrationHistory: ['Visa rejection (self)', 'Rejection/overstay (family)', 'No travel history', 'Travelled in Asia', 'Travelled to Western countries'],
  sponsorIncome: ['< 300M VND', '300-500M VND', '500-800M VND', '800M-1B VND', '1-1.5B VND'],
  incomeEvidence: ['0% documented', '30-35% documented', '50% documented', '70-75% documented', '100% documented'],
  studyPlanGap: ['Different major, 5+ year gap', 'Different major, 2-5 year gap', 'Same major, 2-5 year gap', 'Same major, < 2 year gap', 'Same major, no gap'],
  ultimateObjective: ['Migration only', 'Work only', 'Study but work more', 'Study for migration pathway', 'Study only'],
};

// Stone tier mapping
const STONE_TIERS = [
  { name: 'Quartz',   min: 40,  max: 75,  package: 'Standard',  color: '#9CA3AF' },
  { name: 'Agate',    min: 76,  max: 105, package: 'Silver/Economy', color: '#78716C' },
  { name: 'Sapphire', min: 106, max: 135, package: 'Gold/Premium', color: '#2563EB' },
  { name: 'Ruby',     min: 136, max: 165, package: 'Platinum/Business', color: '#DC2626' },
  { name: 'Diamond',  min: 166, max: 200, package: 'Diamond/First Class', color: '#8B5CF6' },
];

function getTierScore(fieldKey, value) {
  if (!value) return 0;

  const tiers = FIELD_TIERS[fieldKey];
  if (!tiers) {
    // Special handling for destinationCountry (count-based) and residency
    if (fieldKey === 'destinationCountry') {
      const countries = typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(value) ? value : []);
      const count = countries.length;
      if (count === 0) return 1;
      if (count === 1) return 2;
      if (count === 2) return 3;
      if (count === 3) return 4;
      return 5;
    }
    if (fieldKey === 'residency') {
      // Simplified: return 3 as default middle tier for any province
      return 3;
    }
    return 0;
  }

  const idx = tiers.indexOf(value);
  return idx >= 0 ? idx + 1 : 0;
}

function calculateRiskScore(studentData) {
  const breakdown = [];
  let totalScore = 0;

  for (const [fieldKey, config] of Object.entries(SCORING_FIELDS)) {
    const value = studentData[fieldKey] || '';
    const tierScore = getTierScore(fieldKey, value);
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

  // Determine stone tier
  let stoneTier = STONE_TIERS[0]; // default Quartz
  for (const tier of STONE_TIERS) {
    if (totalScore >= tier.min && totalScore <= tier.max) {
      stoneTier = tier;
      break;
    }
  }
  // If above max, it's Diamond
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

module.exports = {
  calculateRiskScore,
  SCORING_FIELDS,
  FIELD_TIERS,
  STONE_TIERS,
  getTierScore,
};
