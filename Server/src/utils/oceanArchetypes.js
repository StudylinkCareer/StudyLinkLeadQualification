// Server-side OCEAN persona key + English name, so calculate-ocean can persist
// students.ocean_archetype language-independently (English name, same value the
// LeadManagement console writes). Careers/Vietnamese copy stay client-side.
// Keep the key table in sync with Client/src/utils/oceanArchetypes.js and
// LeadManagement/src/utils/oceanArchetypes.js. Key = O_C_E_A_N, '+' iff score >= 12.

const ARCHETYPE_NAMES_EN = {
  '+_+_+_+_-': 'The Benevolent Captain',
  '+_+_+_-_-': 'The Strategic Commander',
  '-_+_+_+_-': 'The Operations Anchor',
  '-_+_+_-_-': 'The Efficient Driver',
  '+_+_+_+_+': 'The Passionate Advocate',
  '+_+_+_-_+': 'The Intense Visionary',
  '-_+_+_+_+': 'The Attentive Mentor',
  '-_+_+_-_+': 'The High-Stakes Closer',
  '+_-_+_+_-': 'The Social Inventor',
  '+_-_+_-_-': 'The Bold Maverick',
  '+_-_-_+_-': 'The Artistic Soul',
  '+_-_-_-_-': 'The Abstract Analyst',
  '+_-_+_+_+': 'The Expressive Empath',
  '+_-_+_-_+': 'The Restless Creator',
  '+_-_-_+_+': 'The Sensitive Dreamer',
  '+_-_-_-_+': 'The Complex Thinker',
  '+_+_-_+_-': 'The Scholarly Specialist',
  '+_+_-_-_-': 'The Data Architect',
  '-_+_-_+_-': 'The Reliable Craftsman',
  '-_+_-_-_-': 'The Practical Auditor',
  '+_+_-_+_+': 'The Vigilant Scholar',
  '+_+_-_-_+': 'The Precise Analyst',
  '-_+_-_+_+': 'The Diligent Helper',
  '-_+_-_-_+': 'The Cautious Protector',
  '-_-_+_+_-': 'The Jovial Host',
  '-_-_+_-_-': 'The Opportunist',
  '-_-_-_+_-': 'The Quiet Supporter',
  '-_-_-_-_-': 'The Minimalist',
  '-_-_+_+_+': 'The Emotional Connector',
  '-_-_+_-_+': 'The Dynamic Performer',
  '-_-_-_+_+': 'The Gentle Observer',
  '-_-_-_-_+': 'The Solitary Watchman',
};

const hi = (n) => (n >= 12 ? '+' : '-');

function archetypeKey(s) {
  return [s.openness, s.conscientiousness, s.extraversion, s.agreeableness, s.neuroticism].map(hi).join('_');
}

function archetypeNameEn(s) {
  return ARCHETYPE_NAMES_EN[archetypeKey(s)] || null;
}

module.exports = { ARCHETYPE_NAMES_EN, archetypeKey, archetypeNameEn };
