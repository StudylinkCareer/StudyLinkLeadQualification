// Server/src/utils/stoneContent.js
// ---------------------------------------------------------------------------
// Customer-facing stone-tier content for the event evaluation messages
// (badge e-mail section, questionnaire-result e-mail/Zalo, thank-you page).
//
// Tier names are the canonical English DB values ('Quartz'..'Diamond') written
// by utils/riskCalculator. Labels/messages mirror the canonical translations in
// the LQ client i18n (client/src/i18n/{en,vi}.js, stoneSubtitle_* keys) and
// LeadManagement/src/utils/{stoneLabels,stoneMessages}.js — if those change,
// update this file to match.
// ---------------------------------------------------------------------------

const STONE_TIERS = ['Quartz', 'Agate', 'Sapphire', 'Ruby', 'Diamond'];

const STONE_LABELS = {
  en: { Quartz: 'Quartz', Agate: 'Agate', Sapphire: 'Sapphire', Ruby: 'Ruby', Diamond: 'Diamond' },
  vi: { Quartz: 'Thạch Anh', Agate: 'Mã Não', Sapphire: 'Ngọc Bích', Ruby: 'Hồng Ngọc', Diamond: 'Kim Cương' },
};

const STONE_MESSAGES = {
  en: {
    Quartz:   'Quartz represents a high index of pure energy and balance. StudyLink will support you with International Programs locally with Scholarships—a smart decision to enjoy a world-class education while staying close to your family. Contact StudyLink NOW!',
    Agate:    'Agate brings protection and enduring stability. A journey to Asian and European cultures will help you broaden your mindset and develop excellent adaptability. StudyLink will be your Companion on this abroad journey, contact us RIGHT NOW!',
    Sapphire: 'The blue hue of Sapphire is a symbol of virtue and wisdom. You possess a practical vision, and Europe or Australasia is the perfect environment for you to maximize your potential. StudyLink will be your Companion on this abroad journey, contact us NOW!',
    Ruby:     'Ruby represents power and confidence, forecasting a brilliant journey at leading educational powerhouses across 5 continents. You are ready to conquer great and beautiful challenges. StudyLink will be your Companion on this study abroad journey, contact us NOW!',
    Diamond:  'Diamond is the apex of perseverance and brilliance. You can aim at the global top institutions, places reserved for the most excellent individuals. StudyLink will be your Companion on this study abroad journey, contact us NOW!',
  },
  vi: {
    Quartz:   'Viên Thạch Anh đại diện cho chỉ số năng lượng thanh khiết và sự cân bằng. StudyLink sẽ hỗ trợ bạn Du Học Tại Chỗ và Học Bổng, quyết định thông minh để tận hưởng giáo dục chuẩn quốc tế mà vẫn được gần gũi gia đình. Hãy liên hệ StudyLink NGAY!',
    Agate:    'Viên Mã Não mang lại sự bảo hộ và ổn định bền vững. Hành trình đến với các nền văn hóa Á - Âu sẽ giúp bạn mở rộng tư duy và khả năng thích nghi tuyệt vời. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY với chúng tôi!',
    Sapphire: 'Sắc xanh của viên Ngọc Bích là biểu tượng của tâm lành và trí tuệ. Bạn có tầm nhìn thực tế, Châu Âu hoặc Châu Úc là môi trường phù hợp để bạn phát huy tối đa năng lực bản thân. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY!',
    Ruby:     'Viên Hồng Ngọc đại diện cho quyền lực và sự tự tin, dự báo một hành trình rực rỡ tại các cường quốc giáo dục khắp 5 Châu. Bạn đã sẵn sàng để chinh phục những thử thách lớn lao và đẹp đẽ. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY!',
    Diamond:  'Viên Kim Cương là đỉnh cao của sự kiên định và rực rỡ. Đừng ngần ngại chinh phục những ngôi trường Top toàn cầu, nơi dành cho những người xuất sắc nhất. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY!',
  },
};

function isStoneTier(tier) {
  return STONE_TIERS.includes(String(tier || ''));
}

// Public URL where an e-mail client (or Zalo) can fetch the stone PNG.
// Served by eventConsole's GET /stone-image/:tier.
function stoneImageUrl(tier, publicBase) {
  if (!isStoneTier(tier)) return '';
  const base = String(publicBase || '').replace(/\/+$/, '');
  return `${base}/api/event-console/stone-image/${encodeURIComponent(tier)}`;
}

// Everything a message template needs for one tier. lang: 'vi' | 'en'.
function stoneContent(tier, lang = 'vi', publicBase = '') {
  if (!isStoneTier(tier)) return null;
  const L = STONE_LABELS[lang] || STONE_LABELS.en;
  const M = STONE_MESSAGES[lang] || STONE_MESSAGES.en;
  return {
    tier,
    label: L[tier] || tier,
    message: M[tier] || STONE_MESSAGES.en[tier] || '',
    imageUrl: publicBase ? stoneImageUrl(tier, publicBase) : '',
  };
}

module.exports = { STONE_TIERS, STONE_LABELS, STONE_MESSAGES, isStoneTier, stoneImageUrl, stoneContent };
