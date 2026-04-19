// src/utils/oceanNarrative.js
// -----------------------------------------------------------------------------
// Generates a localized OCEAN narrative paragraph from the five trait scores.
//
// The authoritative source of these translations is the server file
// Server/src/controllers/studentController.js (see NARRATIVE_PHRASES there).
// These VN phrases were prepared by a native Vietnamese speaker.
// If you ever edit the phrases on the server, update this file to match.
// -----------------------------------------------------------------------------

// Convert a 3-15 score into 'high' | 'average' | 'low'.
function getLevel(score) {
  if (score >= 12) return 'high';
  if (score >= 7)  return 'average';
  return 'low';
}

// ── Authoritative narrative phrases — copied verbatim from server ──
const NARRATIVE_PHRASES = {
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
    template: (e, a, c, n, o) =>
      `This person is ${e}. They are ${a}. When it comes to organisation and reliability, they are ${c}. Emotionally, they are ${n}. In terms of intellectual curiosity, they are ${o}.`,
  },
  vi: {
    extraversion: {
      high:    'rất năng động và hòa đồng, phát huy tốt nhất trong môi trường tập thể và giao tiếp xã hội',
      average: 'thoải mái cả khi làm việc nhóm lẫn độc lập, dễ thích nghi với nhiều môi trường khác nhau',
      low:     'sâu sắc và tự chủ, thích những cuộc trò chuyện có chiều sâu hơn là các nhóm đông người',
    },
    agreeableness: {
      high:    'ấm áp, đồng cảm và hợp tác, tự nhiên xây dựng được các mối quan hệ bền chặt với người khác',
      average: 'cân bằng giữa tinh thần hợp tác và tính quyết đoán, làm việc hiệu quả trong nhóm nhưng vẫn duy trì sự độc lập',
      low:     'thẳng thắn và tập trung vào kết quả, mang lại tư duy cạnh tranh và phản biện trong công việc',
    },
    conscientiousness: {
      high:    'rất có tổ chức và kỷ luật, với khả năng lập kế hoạch và thực hiện cam kết một cách xuất sắc',
      average: 'có cấu trúc và đáng tin cậy ở mức hợp lý, cân bằng giữa sự linh hoạt và tinh thần trách nhiệm',
      low:     'tự phát và linh hoạt, mang lại sự sáng tạo và khả năng thích ứng trong các tình huống mới',
    },
    neuroticism: {
      high:    'nhạy cảm về mặt cảm xúc và ý thức sâu sắc về thế giới xung quanh, giúp phát triển sự đồng cảm và chú ý đến chi tiết',
      average: 'nhìn chung ổn định về cảm xúc, với phản ứng căng thẳng nhất định trong những tình huống khó khăn',
      low:     'bình tĩnh và kiên cường trước áp lực, duy trì sự ổn định cảm xúc ngay cả trong môi trường đòi hỏi cao',
    },
    openness: {
      high:    'giàu trí tưởng tượng và ham học hỏi, với niềm đam mê với các ý tưởng mới, văn hóa và tư duy sáng tạo',
      average: 'cởi mở với những trải nghiệm mới trong khi vẫn trân trọng các phương pháp quen thuộc và thực tế',
      low:     'thực tế và có căn cứ, ưu tiên các sự kiện rõ ràng và phương pháp đã được kiểm chứng hơn là lý thuyết trừu tượng',
    },
    template: (e, a, c, n, o) =>
      `Người này ${e}. Họ ${a}. Về mặt tổ chức và độ tin cậy, họ ${c}. Về mặt cảm xúc, họ ${n}. Về khả năng tư duy và sự tò mò trí tuệ, họ ${o}.`,
  },
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
  const lang = NARRATIVE_PHRASES[language] ? language : 'en';
  const p = NARRATIVE_PHRASES[lang];
  const e = p.extraversion     [getLevel(Number(scores.extraversion)      || 0)];
  const a = p.agreeableness    [getLevel(Number(scores.agreeableness)     || 0)];
  const c = p.conscientiousness[getLevel(Number(scores.conscientiousness) || 0)];
  const n = p.neuroticism      [getLevel(Number(scores.neuroticism)       || 0)];
  const o = p.openness         [getLevel(Number(scores.openness)          || 0)];
  return p.template(e, a, c, n, o);
}
