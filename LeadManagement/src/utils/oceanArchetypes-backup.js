// client/src/utils/oceanArchetypes.js
// Also copy to: LeadManagement/src/utils/oceanArchetypes.js
//
// Bilingual (EN/VI) OCEAN archetype engine

const ARCHETYPES = {
  // ── Group 1: Proactive Leaders (High C, High E) ──────────────
  '+_+_+_+_-': {
    en: { name: 'The Benevolent Captain',  group: 'Proactive Leaders',  careers: ['CEO of Social Enterprise', 'Hospital Administrator', 'NGO Director'] },
    vi: { name: 'Thuyền trưởng Nhân từ',   group: 'Những nhà lãnh đạo chủ động', careers: ['CEO doanh nghiệp xã hội', 'Quản lý bệnh viện', 'Giám đốc NGO'] },
  },
  '+_+_+_-_-': {
    en: { name: 'The Strategic Commander', group: 'Proactive Leaders',  careers: ['M&A Lawyer', 'Corporate Strategist', 'Tech Founder'] },
    vi: { name: 'Người chỉ huy Chiến lược', group: 'Những nhà lãnh đạo chủ động', careers: ['Luật sư M&A', 'Chiến lược gia doanh nghiệp', 'Nhà sáng lập công nghệ'] },
  },
  '-_+_+_+_-': {
    en: { name: 'The Operations Anchor',   group: 'Proactive Leaders',  careers: ['Supply Chain Director', 'School Principal', 'Event Producer'] },
    vi: { name: 'Điểm tựa Vận hành',       group: 'Những nhà lãnh đạo chủ động', careers: ['Giám đốc chuỗi cung ứng', 'Hiệu trưởng trường học', 'Nhà sản xuất sự kiện'] },
  },
  '-_+_+_-_-': {
    en: { name: 'The Efficient Driver',    group: 'Proactive Leaders',  careers: ['Logistics Manager', 'Sales Director', 'Real Estate Developer'] },
    vi: { name: 'Người dẫn dắt Hiệu quả', group: 'Những nhà lãnh đạo chủ động', careers: ['Quản lý hậu cần', 'Giám đốc kinh doanh', 'Nhà phát triển bất động sản'] },
  },
  '+_+_+_+_+': {
    en: { name: 'The Passionate Advocate', group: 'Proactive Leaders',  careers: ['Campaign Manager', 'High-Stakes PR', 'Crisis Communications'] },
    vi: { name: 'Người ủng hộ Nhiệt huyết', group: 'Những nhà lãnh đạo chủ động', careers: ['Quản lý chiến dịch', 'Quan hệ công chúng cao cấp', 'Truyền thông khủng hoảng'] },
  },
  '+_+_+_-_+': {
    en: { name: 'The Intense Visionary',   group: 'Proactive Leaders',  careers: ['Startup Pivot Specialist', 'Competitive Athlete Manager', 'Growth Hacker'] },
    vi: { name: 'Người có tầm nhìn Mãnh liệt', group: 'Những nhà lãnh đạo chủ động', careers: ['Chuyên gia định hướng lại startup', 'Quản lý vận động viên thi đấu', 'Chuyên gia tăng trưởng'] },
  },
  '-_+_+_+_+': {
    en: { name: 'The Attentive Mentor',    group: 'Proactive Leaders',  careers: ['Customer Success Lead', 'HR Director', 'Training & Development'] },
    vi: { name: 'Người cố vấn Tận tâm',   group: 'Những nhà lãnh đạo chủ động', careers: ['Trưởng bộ phận thành công khách hàng', 'Giám đốc nhân sự', 'Đào tạo & Phát triển'] },
  },
  '-_+_+_-_+': {
    en: { name: 'The High-Stakes Closer',  group: 'Proactive Leaders',  careers: ['Stock Trader', 'Emergency Room Manager', 'Litigator'] },
    vi: { name: 'Người chốt deal Quyết đoán', group: 'Những nhà lãnh đạo chủ động', careers: ['Nhà giao dịch chứng khoán', 'Quản lý phòng cấp cứu', 'Luật sư tranh tụng'] },
  },

  // ── Group 2: Creative Explorers (High O, Low C) ──────────────
  '+_-_+_+_-': {
    en: { name: 'The Social Inventor',     group: 'Creative Explorers', careers: ['UX Designer', 'Travel Influencer', 'Community Builder'] },
    vi: { name: 'Nhà phát minh Xã hội',   group: 'Những nhà thám hiểm sáng tạo', careers: ['Nhà thiết kế UX', 'Người có sức ảnh hưởng về du lịch', 'Người xây dựng cộng đồng'] },
  },
  '+_-_+_-_-': {
    en: { name: 'The Bold Maverick',       group: 'Creative Explorers', careers: ['Entrepreneur', 'Independent Filmmaker', 'Trend Forecaster'] },
    vi: { name: 'Kẻ độc hành Táo bạo',    group: 'Những nhà thám hiểm sáng tạo', careers: ['Doanh nghiệp tự thân', 'Nhà làm phim độc lập', 'Nhà dự báo xu hướng'] },
  },
  '+_-_-_+_-': {
    en: { name: 'The Artistic Soul',       group: 'Creative Explorers', careers: ['Illustrator', 'Novelist', 'Museum Curator'] },
    vi: { name: 'Tâm hồn Nghệ sĩ',        group: 'Những nhà thám hiểm sáng tạo', careers: ['Họa sĩ minh họa', 'Tiểu thuyết gia', 'Giám tuyển bảo tàng'] },
  },
  '+_-_-_-_-': {
    en: { name: 'The Abstract Analyst',    group: 'Creative Explorers', careers: ['AI Prompt Engineer', 'Theoretical Physicist', 'Philosopher'] },
    vi: { name: 'Nhà phân tích Trừu tượng', group: 'Những nhà thám hiểm sáng tạo', careers: ['Kỹ sư ra lệnh AI', 'Nhà vật lý lý thuyết', 'Triết gia'] },
  },
  '+_-_+_+_+': {
    en: { name: 'The Expressive Empath',   group: 'Creative Explorers', careers: ['Theater Director', 'Art Therapist', 'Media Stylist'] },
    vi: { name: 'Người thấu cảm Biểu đạt', group: 'Những nhà thám hiểm sáng tạo', careers: ['Đạo diễn sân khấu', 'Nhà trị liệu bằng nghệ thuật', 'Nhà tạo mẫu truyền thông'] },
  },
  '+_-_+_-_+': {
    en: { name: 'The Restless Creator',    group: 'Creative Explorers', careers: ['Fashion Designer', 'Investigative Journalist', 'Ad Copywriter'] },
    vi: { name: 'Nhà sáng tạo Không ngừng', group: 'Những nhà thám hiểm sáng tạo', careers: ['Nhà thiết kế thời trang', 'Phóng viên điều tra', 'Người viết lời quảng cáo'] },
  },
  '+_-_-_+_+': {
    en: { name: 'The Sensitive Dreamer',   group: 'Creative Explorers', careers: ['Music Composer', 'Virtual Reality World Builder', 'Poet'] },
    vi: { name: 'Kẻ mộng mơ Nhạy cảm',   group: 'Những nhà thám hiểm sáng tạo', careers: ['Nhà soạn nhạc', 'Nhà xây dựng thế giới thực tế ảo', 'Nhà thơ'] },
  },
  '+_-_-_-_+': {
    en: { name: 'The Complex Thinker',     group: 'Creative Explorers', careers: ['Cybersecurity Red Teamer', 'Strategy Game Designer', 'Cryptographer'] },
    vi: { name: 'Người tư duy Phức hợp',  group: 'Những nhà thám hiểm sáng tạo', careers: ['Chuyên gia phòng thủ an ninh mạng', 'Nhà thiết kế trò chơi chiến thuật', 'Chuyên gia mã hóa'] },
  },

  // ── Group 3: Methodical Experts (High C, Low E) ──────────────
  '+_+_-_+_-': {
    en: { name: 'The Scholarly Specialist', group: 'Methodical Experts', careers: ['University Researcher', 'Sustainable Architect', 'Librarian'] },
    vi: { name: 'Chuyên gia Học thuật',    group: 'Những chuyên gia phương pháp', careers: ['Nhà nghiên cứu đại học', 'Kiến trúc sư bền vững', 'Thủ thư'] },
  },
  '+_+_-_-_-': {
    en: { name: 'The Data Architect',      group: 'Methodical Experts', careers: ['Data Scientist', 'Systems Engineer', 'Patent Attorney'] },
    vi: { name: 'Kiến trúc sư Dữ liệu',   group: 'Những chuyên gia phương pháp', careers: ['Nhà khoa học dữ liệu', 'Kỹ sư hệ thống', 'Luật sư bằng sáng chế'] },
  },
  '-_+_-_+_-': {
    en: { name: 'The Reliable Craftsman',  group: 'Methodical Experts', careers: ['Accountant', 'Civil Engineer', 'Medical Lab Technician'] },
    vi: { name: 'Người thợ thủ công Đáng tin', group: 'Những chuyên gia phương pháp', careers: ['Kế toán', 'Kỹ sư dân dụng', 'Kỹ thuật viên xét nghiệm y khoa'] },
  },
  '-_+_-_-_-': {
    en: { name: 'The Practical Auditor',   group: 'Methodical Experts', careers: ['Compliance Officer', 'Quality Control Manager', 'Database Administrator'] },
    vi: { name: 'Kiểm toán viên Thực tế', group: 'Những chuyên gia phương pháp', careers: ['Chuyên viên tuân thủ', 'Kiểm soát chất lượng', 'Quản trị cơ sở dữ liệu'] },
  },
  '+_+_-_+_+': {
    en: { name: 'The Vigilant Scholar',    group: 'Methodical Experts', careers: ['Historical Archivist', 'Bio-Ethicist', 'Policy Researcher'] },
    vi: { name: 'Học giả Cảnh giác',      group: 'Những chuyên gia phương pháp', careers: ['Người lưu trữ lịch sử', 'Nhà đạo đức sinh học', 'Nhà nghiên cứu chính sách'] },
  },
  '+_+_-_-_+': {
    en: { name: 'The Precise Analyst',     group: 'Methodical Experts', careers: ['Forensic Accountant', 'Risk Modeler', 'Cyber-Auditor'] },
    vi: { name: 'Nhà phân tích Chính xác', group: 'Những chuyên gia phương pháp', careers: ['Kế toán pháp y', 'Người mô hình hóa rủi ro', 'Kiểm toán viên mạng'] },
  },
  '-_+_-_+_+': {
    en: { name: 'The Diligent Helper',     group: 'Methodical Experts', careers: ['Pharmacist', 'Technical Support Lead', 'Safety Inspector'] },
    vi: { name: 'Người trợ giúp Tận tụy', group: 'Những chuyên gia phương pháp', careers: ['Dược sĩ', 'Trưởng nhóm hỗ trợ kỹ thuật', 'Thanh tra an toàn'] },
  },
  '-_+_-_-_+': {
    en: { name: 'The Cautious Protector',  group: 'Methodical Experts', careers: ['Actuary', 'Underwriter', 'Information Security Officer'] },
    vi: { name: 'Người bảo vệ Thận trọng', group: 'Những chuyên gia phương pháp', careers: ['Chuyên viên định phí bảo hiểm', 'Chuyên viên thẩm định rủi ro', 'Chuyên viên bảo mật thông tin'] },
  },

  // ── Group 4: Social Adaptables (Low C, High E) ──────────────
  '-_-_+_+_-': {
    en: { name: 'The Jovial Host',         group: 'Social Adaptables',  careers: ['Tourism Guide', 'Retail Manager', 'Flight Attendant'] },
    vi: { name: 'Chủ nhà Vui vẻ',         group: 'Những người thích nghi xã hội', careers: ['Hướng dẫn viên du lịch', 'Quản lý bán lẻ', 'Tiếp viên hàng không'] },
  },
  '-_-_+_-_-': {
    en: { name: 'The Opportunist',         group: 'Social Adaptables',  careers: ['Promotions Agent', 'Brand Ambassador', 'Talent Scout'] },
    vi: { name: 'Người nắm bắt Cơ hội',   group: 'Những người thích nghi xã hội', careers: ['Đại lý quảng bá', 'Đại sứ thương hiệu', 'Người săn tìm tài năng'] },
  },
  '-_-_-_+_-': {
    en: { name: 'The Quiet Supporter',     group: 'Social Adaptables',  careers: ['Administrative Assistant', 'Customer Service Specialist', 'Clergy'] },
    vi: { name: 'Người hỗ trợ Thầm lặng', group: 'Những người thích nghi xã hội', careers: ['Trợ lý hành chính', 'Chăm sóc khách hàng', 'Giáo sĩ'] },
  },
  '-_-_-_-_-': {
    en: { name: 'The Minimalist',          group: 'Social Adaptables',  careers: ['Quality Assurance Tester', 'Data Entry Specialist', 'Night Auditor'] },
    vi: { name: 'Người tối giản',          group: 'Những người thích nghi xã hội', careers: ['Người kiểm thử chất lượng', 'Nhập liệu', 'Kiểm toán viên ca đêm'] },
  },
  '-_-_+_+_+': {
    en: { name: 'The Emotional Connector', group: 'Social Adaptables',  careers: ['Social Worker', 'Life Coach', 'Youth Counselor'] },
    vi: { name: 'Người kết nối Cảm xúc',  group: 'Những người thích nghi xã hội', careers: ['Nhân viên công tác xã hội', 'Khai vấn cuộc sống', 'Cố vấn thanh niên'] },
  },
  '-_-_+_-_+': {
    en: { name: 'The Dynamic Performer',   group: 'Social Adaptables',  careers: ['Actor', 'Professional Speaker', 'Fitness Instructor'] },
    vi: { name: 'Người biểu diễn Năng động', group: 'Những người thích nghi xã hội', careers: ['Diễn viên', 'Diễn giả chuyên nghiệp', 'Huấn luyện viên thể hình'] },
  },
  '-_-_-_+_+': {
    en: { name: 'The Gentle Observer',     group: 'Social Adaptables',  careers: ['Animal Caretaker', 'Florist', 'Support Group Facilitator'] },
    vi: { name: 'Người quan sát Nhẹ nhàng', group: 'Những người thích nghi xã hội', careers: ['Người chăm sóc động vật', 'Thợ cắm hoa', 'Người điều phối nhóm hỗ trợ'] },
  },
  '-_-_-_-_+': {
    en: { name: 'The Solitary Watchman',   group: 'Social Adaptables',  careers: ['Security Analyst', 'Remote Monitor', 'Independent Researcher'] },
    vi: { name: 'Người canh gác Đơn độc', group: 'Những người thích nghi xã hội', careers: ['Nhân viên bảo vệ', 'Người giám sát từ xa', 'Người canh gác cháy rừng'] },
  },
};

// Group color coding
export const GROUP_COLORS = {
  'Proactive Leaders':               { bg: '#FEF2F2', border: '#FECACA', badge: '#DC2626', text: '#991B1B' },
  'Creative Explorers':              { bg: '#FFF7ED', border: '#FED7AA', badge: '#EA580C', text: '#9A3412' },
  'Methodical Experts':              { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', text: '#1E40AF' },
  'Social Adaptables':               { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', text: '#14532D' },
  // Vietnamese group names map to same colors
  'Những nhà lãnh đạo chủ động':    { bg: '#FEF2F2', border: '#FECACA', badge: '#DC2626', text: '#991B1B' },
  'Những nhà thám hiểm sáng tạo':   { bg: '#FFF7ED', border: '#FED7AA', badge: '#EA580C', text: '#9A3412' },
  'Những chuyên gia phương pháp':   { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', text: '#1E40AF' },
  'Những người thích nghi xã hội':  { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', text: '#14532D' },
};

/**
 * Classify a trait score.
 * High (12+): '+', no flex
 * Upper avg (9-11): '-', flex up
 * Lower avg (7-8): '-', no flex
 * Borderline low (4-5): '-', flex up
 * Solid low (3): '-', no flex
 */
function classifyTrait(score) {
  if (score >= 12) return { level: '+', flex: false };
  if (score >= 9)  return { level: '-', flex: true };
  if (score >= 7)  return { level: '-', flex: false };
  if (score >= 4)  return { level: '-', flex: true };
  return               { level: '-', flex: false };
}

/**
 * Get archetype from scores, with optional language support.
 * @param {object} scores - { extraversion, agreeableness, conscientiousness, neuroticism, openness }
 * @param {string} language - 'en' (default) or 'vi'
 */
export function getArchetype(scores, language = 'en') {
  const { openness, conscientiousness, extraversion, agreeableness, neuroticism } = scores;

  const traits = {
    O: classifyTrait(openness),
    C: classifyTrait(conscientiousness),
    E: classifyTrait(extraversion),
    A: classifyTrait(agreeableness),
    N: classifyTrait(neuroticism),
  };

  const key = `${traits.O.level}_${traits.C.level}_${traits.E.level}_${traits.A.level}_${traits.N.level}`;
  const entry = ARCHETYPES[key] || null;

  const lang = (language === 'vi') ? 'vi' : 'en';
  const archetype = entry ? entry[lang] : null;

  const TRAIT_NAMES = {
    en: { O: 'Openness', C: 'Conscientiousness', E: 'Extraversion', A: 'Agreeableness', N: 'Neuroticism' },
    vi: { O: 'Cởi mở',  C: 'Tận tâm',           E: 'Hướng ngoại', A: 'Dễ chịu',       N: 'Nhạy cảm' },
  };

  const flexTraits = Object.entries(traits)
    .filter(([, t]) => t.flex)
    .map(([k]) => ({
      trait: TRAIT_NAMES[lang][k],
      score: scores[
        k === 'O' ? 'openness' :
        k === 'C' ? 'conscientiousness' :
        k === 'E' ? 'extraversion' :
        k === 'A' ? 'agreeableness' : 'neuroticism'
      ],
    }));

  const colors = archetype ? (GROUP_COLORS[archetype.group] || GROUP_COLORS['Methodical Experts']) : null;

  return { archetype, key, flexTraits, colors };
}

export { ARCHETYPES };
