// client/src/utils/oceanArchetypes.js
// Also copy to: server/src/utils/oceanArchetypes.js
//
// Determines the OCEAN archetype from trait scores.
// Each trait score is 3–15.
// High = 12+, Average = 7–11, Low = 6 and below
// Flex up: Low 4-5 or Average 9-11 → flagged as potential for next level

// ── 32 archetypes ────────────────────────────────────────────
// Key: 'O_C_E_A_N' where each is '+' (high) or '-' (low/avg)
const ARCHETYPES = {
  // Group 1: Proactive Leaders (High C, High E)
  '+_+_+_+_-': { name: 'The Benevolent Captain',   group: 'Proactive Leaders',     careers: ['CEO of Social Enterprise', 'Hospital Administrator', 'NGO Director'] },
  '+_+_+_-_-': { name: 'The Strategic Commander',  group: 'Proactive Leaders',     careers: ['M&A Lawyer', 'Corporate Strategist', 'Tech Founder'] },
  '-_+_+_+_-': { name: 'The Operations Anchor',    group: 'Proactive Leaders',     careers: ['Supply Chain Director', 'School Principal', 'Event Producer'] },
  '-_+_+_-_-': { name: 'The Efficient Driver',     group: 'Proactive Leaders',     careers: ['Logistics Manager', 'Sales Director', 'Real Estate Developer'] },
  '+_+_+_+_+': { name: 'The Passionate Advocate',  group: 'Proactive Leaders',     careers: ['Campaign Manager', 'High-Stakes PR', 'Crisis Communications'] },
  '+_+_+_-_+': { name: 'The Intense Visionary',    group: 'Proactive Leaders',     careers: ['Startup Pivot Specialist', 'Competitive Athlete Manager', 'Growth Hacker'] },
  '-_+_+_+_+': { name: 'The Attentive Mentor',     group: 'Proactive Leaders',     careers: ['Customer Success Lead', 'HR Director', 'Training & Development'] },
  '-_+_+_-_+': { name: 'The High-Stakes Closer',   group: 'Proactive Leaders',     careers: ['Stock Trader', 'Emergency Room Manager', 'Litigator'] },

  // Group 2: Creative Explorers (High O, Low C)
  '+_-_+_+_-': { name: 'The Social Inventor',      group: 'Creative Explorers',    careers: ['UX Designer', 'Travel Influencer', 'Community Builder'] },
  '+_-_+_-_-': { name: 'The Bold Maverick',        group: 'Creative Explorers',    careers: ['Entrepreneur', 'Independent Filmmaker', 'Trend Forecaster'] },
  '+_-_-_+_-': { name: 'The Artistic Soul',        group: 'Creative Explorers',    careers: ['Illustrator', 'Novelist', 'Museum Curator'] },
  '+_-_-_-_-': { name: 'The Abstract Analyst',     group: 'Creative Explorers',    careers: ['AI Prompt Engineer', 'Theoretical Physicist', 'Philosopher'] },
  '+_-_+_+_+': { name: 'The Expressive Empath',    group: 'Creative Explorers',    careers: ['Theater Director', 'Art Therapist', 'Media Stylist'] },
  '+_-_+_-_+': { name: 'The Restless Creator',     group: 'Creative Explorers',    careers: ['Fashion Designer', 'Investigative Journalist', 'Ad Copywriter'] },
  '+_-_-_+_+': { name: 'The Sensitive Dreamer',    group: 'Creative Explorers',    careers: ['Music Composer', 'Virtual Reality World Builder', 'Poet'] },
  '+_-_-_-_+': { name: 'The Complex Thinker',      group: 'Creative Explorers',    careers: ['Cybersecurity Red Teamer', 'Strategy Game Designer', 'Cryptographer'] },

  // Group 3: Methodical Experts (High C, Low E)
  '+_+_-_+_-': { name: 'The Scholarly Specialist', group: 'Methodical Experts',    careers: ['University Researcher', 'Sustainable Architect', 'Librarian'] },
  '+_+_-_-_-': { name: 'The Data Architect',       group: 'Methodical Experts',    careers: ['Data Scientist', 'Systems Engineer', 'Patent Attorney'] },
  '-_+_-_+_-': { name: 'The Reliable Craftsman',   group: 'Methodical Experts',    careers: ['Accountant', 'Civil Engineer', 'Medical Lab Technician'] },
  '-_+_-_-_-': { name: 'The Practical Auditor',    group: 'Methodical Experts',    careers: ['Compliance Officer', 'Quality Control Manager', 'Database Administrator'] },
  '+_+_-_+_+': { name: 'The Vigilant Scholar',     group: 'Methodical Experts',    careers: ['Historical Archivist', 'Bio-Ethicist', 'Policy Researcher'] },
  '+_+_-_-_+': { name: 'The Precise Analyst',      group: 'Methodical Experts',    careers: ['Forensic Accountant', 'Risk Modeler', 'Cyber-Auditor'] },
  '-_+_-_+_+': { name: 'The Diligent Helper',      group: 'Methodical Experts',    careers: ['Pharmacist', 'Technical Support Lead', 'Safety Inspector'] },
  '-_+_-_-_+': { name: 'The Cautious Protector',   group: 'Methodical Experts',    careers: ['Actuary', 'Underwriter', 'Information Security Officer'] },

  // Group 4: Social Adaptables (Low C, High E)
  '-_-_+_+_-': { name: 'The Jovial Host',          group: 'Social Adaptables',     careers: ['Tourism Guide', 'Retail Manager', 'Flight Attendant'] },
  '-_-_+_-_-': { name: 'The Opportunist',          group: 'Social Adaptables',     careers: ['Promotions Agent', 'Brand Ambassador', 'Talent Scout'] },
  '-_-_-_+_-': { name: 'The Quiet Supporter',      group: 'Social Adaptables',     careers: ['Administrative Assistant', 'Customer Service Specialist', 'Clergy'] },
  '-_-_-_-_-': { name: 'The Minimalist',           group: 'Social Adaptables',     careers: ['Quality Assurance Tester', 'Data Entry Specialist', 'Night Auditor'] },
  '-_-_+_+_+': { name: 'The Emotional Connector',  group: 'Social Adaptables',     careers: ['Social Worker', 'Life Coach', 'Youth Counselor'] },
  '-_-_+_-_+': { name: 'The Dynamic Performer',    group: 'Social Adaptables',     careers: ['Actor', 'Professional Speaker', 'Fitness Instructor'] },
  '-_-_-_+_+': { name: 'The Gentle Observer',      group: 'Social Adaptables',     careers: ['Animal Caretaker', 'Florist', 'Support Group Facilitator'] },
  '-_-_-_-_+': { name: 'The Solitary Watchman',    group: 'Social Adaptables',     careers: ['Security Analyst', 'Remote Monitor', 'Independent Researcher'] },
};

// Group color coding
const GROUP_COLORS = {
  'Proactive Leaders':   { bg: '#FEF2F2', border: '#FECACA', badge: '#DC2626', text: '#991B1B' },
  'Creative Explorers':  { bg: '#FFF7ED', border: '#FED7AA', badge: '#EA580C', text: '#9A3412' },
  'Methodical Experts':  { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', text: '#1E40AF' },
  'Social Adaptables':   { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', text: '#14532D' },
};

/**
 * Classify a single trait score into '+' or '-' and a flex flag.
 * Returns { level: '+' | '-', flex: boolean, flexDirection: 'up' | null }
 *
 * Rules:
 *   High  (12–15): level='+', no flex
 *   Avg   (7–11):  level='+' if >=9 (flex up), '-' if <9
 *   Low   (3–6):   level='-', flex=true if score is 4 or 5
 */
function classifyTrait(score) {
  if (score >= 12) {
    return { level: '+', flex: false, flexDirection: null };
  }
  if (score >= 9) {
    // Upper average — classified as '-' but flagged as flex to '+'
    return { level: '-', flex: true, flexDirection: 'up' };
  }
  if (score >= 7) {
    // Lower average — classified as '-', no flex
    return { level: '-', flex: false, flexDirection: null };
  }
  if (score >= 4) {
    // Low but borderline — classified as '-', flagged flex up
    return { level: '-', flex: true, flexDirection: 'up' };
  }
  // Score 3 — solidly low
  return { level: '-', flex: false, flexDirection: null };
}

/**
 * Full archetype assessment from trait scores object.
 * Returns { archetype, key, flexTraits, colors }
 */
export function getArchetype(scores) {
  const { openness, conscientiousness, extraversion, agreeableness, neuroticism } = scores;

  const traits = {
    O: classifyTrait(openness),
    C: classifyTrait(conscientiousness),
    E: classifyTrait(extraversion),
    A: classifyTrait(agreeableness),
    N: classifyTrait(neuroticism),
  };

  const key = `${traits.O.level}_${traits.C.level}_${traits.E.level}_${traits.A.level}_${traits.N.level}`;
  const archetype = ARCHETYPES[key] || null;

  // Build flex trait list for display
  const TRAIT_NAMES = {
    O: 'Openness', C: 'Conscientiousness', E: 'Extraversion',
    A: 'Agreeableness', N: 'Neuroticism',
  };

  const flexTraits = Object.entries(traits)
    .filter(([, t]) => t.flex)
    .map(([k, t]) => ({
      trait: TRAIT_NAMES[k],
      score: scores[k.toLowerCase() === 'o' ? 'openness'
        : k.toLowerCase() === 'c' ? 'conscientiousness'
        : k.toLowerCase() === 'e' ? 'extraversion'
        : k.toLowerCase() === 'a' ? 'agreeableness'
        : 'neuroticism'],
      direction: t.flexDirection,
    }));

  const colors = archetype ? (GROUP_COLORS[archetype.group] || GROUP_COLORS['Methodical Experts']) : null;

  return { archetype, key, flexTraits, colors };
}

export { ARCHETYPES, GROUP_COLORS };
