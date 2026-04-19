// src/utils/oceanNarrative.js
// -----------------------------------------------------------------------------
// Generates a localized OCEAN narrative paragraph from the five trait scores.
// The server's oceanCalculator.js generates an English narrative and stores it
// in the DB, but we ignore that stored value and regenerate on-the-fly here
// so the paragraph always matches the current UI language.
//
// TRANSLATION NOTE:
//   The Vietnamese phrases below are a first pass and should be reviewed by a
//   native Vietnamese speaker. Each phrase is a "predicate" that fits after
//   the subject in the template sentence. If any phrase reads awkwardly, the
//   fix is to adjust only the phrase — the template strings handle the
//   sentence structure.
// -----------------------------------------------------------------------------

// Convert a 3-15 score into 'high' | 'average' | 'low'.
function getLevel(score) {
  if (score >= 12) return 'high';
  if (score >= 7)  return 'average';
  return 'low';
}

// Trait phrases by language × trait × level.
const TRAIT_PHRASES = {
  en: {
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
  },
  vi: {
    extraversion: {
      high:    'rất năng động và hòa đồng, phát triển tốt trong môi trường tập thể và các tương tác xã hội',
      average: 'thoải mái trong cả môi trường xã hội và riêng tư, thích nghi tốt với các hoàn cảnh khác nhau',
      low:     'trầm tĩnh và tự lập, thích những cuộc trò chuyện sâu sắc một-một hơn là các nhóm đông',
    },
    agreeableness: {
      high:    'ấm áp, đồng cảm và hợp tác, tự nhiên xây dựng được các mối quan hệ bền chặt với người khác',
      average: 'cân bằng giữa hợp tác và quyết đoán, làm việc tốt trong nhóm đồng thời vẫn giữ được sự độc lập',
      low:     'thẳng thắn và tập trung vào kết quả, mang đến tính cạnh tranh và tư duy phản biện trước các thách thức',
    },
    conscientiousness: {
      high:    'có tính tổ chức và kỷ luật cao, với khả năng lên kế hoạch và thực hiện cam kết một cách vững vàng',
      average: 'tương đối có tổ chức và đáng tin cậy, cân bằng giữa sự linh hoạt và ý thức trách nhiệm',
      low:     'tự phát và dễ thích nghi, mang đến sự sáng tạo và linh hoạt trong các tình huống mới',
    },
    neuroticism: {
      high:    'nhạy cảm về mặt cảm xúc và nhận thức sâu sắc về thế giới xung quanh, điều này thúc đẩy sự đồng cảm và chú ý đến chi tiết',
      average: 'nhìn chung ổn định về mặt cảm xúc, đôi khi có phản ứng căng thẳng trong các tình huống khó khăn',
      low:     'điềm tĩnh và kiên cường trước áp lực, duy trì sự ổn định cảm xúc ngay cả trong môi trường đòi hỏi cao',
    },
    openness: {
      high:    'giàu trí tưởng tượng và ham học hỏi về mặt trí tuệ, đam mê những ý tưởng mới, các nền văn hóa và tư duy sáng tạo',
      average: 'cởi mở với những trải nghiệm mới, đồng thời cũng trân trọng những cách tiếp cận quen thuộc và thực tế',
      low:     'thực tế và vững vàng, thích những sự thật rõ ràng và các phương pháp đã được kiểm chứng hơn các lý thuyết trừu tượng',
    },
  },
};

// Sentence-structure template by language.
// Placeholders {e}, {a}, {c}, {n}, {o} are replaced with the trait phrases.
const TEMPLATES = {
  en: 'This person is {e}. They are {a}. When it comes to organisation and reliability, they are {c}. Emotionally, they are {n}. In terms of intellectual curiosity, they are {o}.',
  vi: 'Người này {e}. Họ {a}. Khi nói đến tính tổ chức và độ tin cậy, họ {c}. Về mặt cảm xúc, họ {n}. Về sự tò mò trí tuệ, họ {o}.',
};

/**
 * Build a localized narrative paragraph from the scores.
 *
 * @param {object} scores    - { extraversion, agreeableness, conscientiousness, neuroticism, openness }
 * @param {string} language  - 'en' or 'vi'
 * @returns {string} narrative paragraph
 */
export function generateLocalizedNarrative(scores, language = 'en') {
  if (!scores) return '';
  const lang = TRAIT_PHRASES[language] ? language : 'en';
  const phrases = TRAIT_PHRASES[lang];
  const e = phrases.extraversion[getLevel(Number(scores.extraversion)      || 0)];
  const a = phrases.agreeableness[getLevel(Number(scores.agreeableness)    || 0)];
  const c = phrases.conscientiousness[getLevel(Number(scores.conscientiousness) || 0)];
  const n = phrases.neuroticism[getLevel(Number(scores.neuroticism)        || 0)];
  const o = phrases.openness[getLevel(Number(scores.openness)              || 0)];
  return TEMPLATES[lang]
    .replace('{e}', e)
    .replace('{a}', a)
    .replace('{c}', c)
    .replace('{n}', n)
    .replace('{o}', o);
}
