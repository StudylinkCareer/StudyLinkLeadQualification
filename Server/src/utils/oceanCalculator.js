// server/src/utils/oceanCalculator.js
// Also copy to: client/src/utils/oceanCalculator.js
// (same logic used in both apps)

/**
 * Calculate OCEAN trait scores from 15 question responses.
 * Each response is 1-5. Reverse-scored questions use (6 - response).
 * Each trait score ranges from 3-15.
 */
function calculateOceanScores(responses) {
  const q = responses; // q[1] through q[15]

  const extraversion      = (q[1]||0) + (6-(q[6]||0))  + (q[11]||0);
  const agreeableness     = (q[2]||0) + (6-(q[7]||0))  + (q[12]||0);
  const conscientiousness = (q[3]||0) + (6-(q[8]||0))  + (q[13]||0);
  const neuroticism       = (q[4]||0) + (6-(q[9]||0))  + (q[14]||0);
  const openness          = (q[5]||0) + (6-(q[10]||0)) + (q[15]||0);

  return { extraversion, agreeableness, conscientiousness, neuroticism, openness };
}

/**
 * Get level label for a trait score.
 */
function getLevel(score) {
  if (score >= 12) return 'high';
  if (score >= 7)  return 'average';
  return 'low';
}

/**
 * Generate a dynamic narrative paragraph based on OCEAN scores.
 */
function generateNarrative(scores) {
  const { extraversion, agreeableness, conscientiousness, neuroticism, openness } = scores;

  const traits = {
    extraversion: {
      high:    'highly energetic and sociable, thriving in group settings and social interactions',
      average: 'comfortable in both social and solitary settings, adapting well to different environments',
      low:     'thoughtful and self-sufficient, preferring deeper one-on-one conversations over large groups',
    },
    agreeableness: {
      high:    'warm, empathetic and cooperative, naturally building strong relationships with others',
      average: 'balanced between cooperation and assertiveness, working well in teams while maintaining independence',
      low:     'direct and results-focused, bringing a competitive edge and critical thinking to challenges',
    },
    conscientiousness: {
      high:    'highly organised and disciplined, with a strong ability to plan and follow through on commitments',
      average: 'reasonably structured and dependable, balancing flexibility with a sense of responsibility',
      low:     'spontaneous and adaptable, bringing creativity and flexibility to new situations',
    },
    neuroticism: {
      high:    'emotionally sensitive and deeply aware of the world around them, which drives empathy and attention to detail',
      average: 'generally emotionally stable with occasional stress responses in challenging situations',
      low:     'calm and resilient under pressure, maintaining emotional stability even in demanding environments',
    },
    openness: {
      high:    'imaginative and intellectually curious, with a passion for new ideas, cultures and creative thinking',
      average: 'open to new experiences while also appreciating familiar and practical approaches',
      low:     'practical and grounded, preferring clear facts and proven methods over abstract theories',
    },
  };

  const e = traits.extraversion[getLevel(extraversion)];
  const a = traits.agreeableness[getLevel(agreeableness)];
  const c = traits.conscientiousness[getLevel(conscientiousness)];
  const n = traits.neuroticism[getLevel(neuroticism)];
  const o = traits.openness[getLevel(openness)];

  return `This person is ${e}. They are ${a}. When it comes to organisation and reliability, they are ${c}. Emotionally, they are ${n}. In terms of intellectual curiosity, they are ${o}.`;
}

/**
 * Full OCEAN assessment — scores + narrative.
 */
function assessOcean(responses) {
  const scores = calculateOceanScores(responses);
  const narrative = generateNarrative(scores);
  const levels = {
    extraversion:      getLevel(scores.extraversion),
    agreeableness:     getLevel(scores.agreeableness),
    conscientiousness: getLevel(scores.conscientiousness),
    neuroticism:       getLevel(scores.neuroticism),
    openness:          getLevel(scores.openness),
  };
  return { scores, levels, narrative };
}

module.exports = { calculateOceanScores, generateNarrative, assessOcean, getLevel };
