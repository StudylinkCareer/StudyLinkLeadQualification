// src/utils/oceanQuestions.js
// -----------------------------------------------------------------------------
// The 15 OCEAN self-assessment questions, translated.
//
// Authoritative source of these translations is the LQ app's i18n files:
//   - client/src/i18n/en.js (keys: ocean_q1 ... ocean_q15)
//   - client/src/i18n/vi.js (same keys)
// These VN translations were prepared by a native Vietnamese speaker.
// If the LQ canonical text ever changes, update this file to match.
// -----------------------------------------------------------------------------

const OCEAN_QUESTIONS = {
  en: {
    1:  'I am the life of the party and enjoy being the center of attention.',
    2:  "I sympathize with others' feelings and feel for those less fortunate.",
    3:  'I am always prepared and keep my belongings organized.',
    4:  'I have frequent mood swings and get stressed easily.',
    5:  'I have a vivid imagination and enjoy thinking about abstract ideas.',
    6:  "I don't talk a lot and tend to keep to myself.",
    7:  "I am not really interested in others' problems or feelings.",
    8:  'I often forget to put things back in their proper place.',
    9:  "I am relaxed most of the time and don't worry much.",
    10: 'I am not interested in theoretical or philosophical discussions.',
    11: 'I feel comfortable around people and start conversations easily.',
    12: 'I have a soft heart and try to make people feel at ease.',
    13: 'I pay attention to details and like to get chores done right away.',
    14: 'I get upset easily and often feel blue or anxious.',
    15: 'I enjoy hearing new ideas and looking at art or nature.',
  },
  vi: {
    1:  'Tôi là người khuấy động bầu không khí trong các bữa tiệc và thích trở thành trung tâm của sự chú ý.',
    2:  'Tôi đồng cảm với cảm xúc của người khác và thương cảm cho những người kém may mắn.',
    3:  'Tôi luôn chuẩn bị sẵn sàng và giữ đồ đạc của mình ngăn nắp.',
    4:  'Tôi thường thay đổi tâm trạng thất thường và dễ bị căng thẳng.',
    5:  'Tôi có trí tưởng tượng phong phú và thích suy nghĩ về những ý tưởng trừu tượng.',
    6:  'Tôi không nói nhiều và thường sống khép kín.',
    7:  'Tôi không thực sự quan tâm đến vấn đề hay cảm xúc của người khác.',
    8:  'Tôi thường quên đặt đồ vật về đúng chỗ.',
    9:  'Phần lớn thời gian tôi khá thoải mái và không lo lắng nhiều.',
    10: 'Tôi không hứng thú với các cuộc thảo luận mang tính lý thuyết hay triết học.',
    11: 'Tôi cảm thấy thoải mái khi ở cạnh mọi người và dễ dàng bắt chuyện.',
    12: 'Tôi có trái tim mềm yếu và cố gắng làm cho mọi người cảm thấy dễ chịu.',
    13: 'Tôi chú ý đến chi tiết và thích hoàn thành công việc ngay lập tức.',
    14: 'Tôi dễ buồn bực và thường cảm thấy u sầu hoặc lo lắng.',
    15: 'Tôi thích nghe những ý tưởng mới và ngắm nhìn nghệ thuật hoặc thiên nhiên.',
  },
};

/**
 * Return a single OCEAN question text by id and language.
 *
 * @param {number} id       - question number 1..15
 * @param {string} language - 'en' or 'vi'
 * @returns {string} question text (falls back to English if language missing)
 */
export function oceanQuestion(id, language = 'en') {
  return OCEAN_QUESTIONS[language]?.[id] || OCEAN_QUESTIONS.en[id] || '';
}

/**
 * Return the full array of questions in the given language, shaped as
 * [{ id, text }, ...] — convenient for rendering in a component.
 */
export function oceanQuestionList(language = 'en') {
  const src = OCEAN_QUESTIONS[language] || OCEAN_QUESTIONS.en;
  return Array.from({ length: 15 }, (_, i) => ({
    id:   i + 1,
    text: src[i + 1],
  }));
}
