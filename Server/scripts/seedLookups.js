// ─────────────────────────────────────────────────────────────────────
// seedLookups.js  (FINAL — i18n consolidated into lookup_values)
//
// Changes from previous version:
//   - process_application: VN labels now filled in (they existed in vi.js
//                          all along, the previous TODO was a miss).
//   - ocean_scale:         NEW category — 5 Likert labels (1..5).
//   - stone_tier.meta:     packageVi added alongside package.
//   - ui_string:           NEW category — every UI chrome string from
//                          client/src/i18n/en.js and vi.js, grouped by
//                          subcategory. Once the apps are rewired (Step 4),
//                          these replace en.js / vi.js as the source of truth.
//   - Bug fixes applied to seeded data:
//       * appSubtitle:     'aboard' → 'abroad'
//       * preferredSocialPlacholder → preferredSocialPlaceholder (key
//         rename; component lookup will need updating in Step 4)
//       * takePhoto VI:    'Tự sướng' → 'Chụp ảnh selfie' (neutral term)
//
// Idempotent. Re-running is safe.
//
// Usage:
//   cd Server
//   node scripts/seedLookups.js
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');

// ── Cleanup: codes that should no longer exist in the table ─────────
const OBSOLETE_CODES = {
  lead_status: ['Contacted', 'Qualified', 'Negotiation', 'Won', 'On Hold'],
};

// Categories where we wipe ALL rows before re-inserting.
const FULL_RESET_CATEGORIES = ['vietnam_province'];

const SEED = {
  // ─── Lead pipeline ──────────────────────────────────────────────
  lead_status: [
    { code: 'New',                          labelVi: 'Mới',                                 meta: { cssClass: 'new',             isActiveStatus: true  } },
    { code: 'Not contactable',              labelVi: 'Không thể liên lạc',                  meta: { cssClass: 'not-contactable', isActiveStatus: true  } },
    { code: 'Engaged',                      labelVi: 'Đang tương tác',                      meta: { cssClass: 'engaged',         isActiveStatus: true  } },
    { code: 'Vetted',                       labelVi: 'Đã kiểm tra',                         meta: { cssClass: 'vetted',          isActiveStatus: true  } },
    { code: 'Met with customer and family', labelVi: 'Đã gặp khách hàng và gia đình',       meta: { cssClass: 'met',             isActiveStatus: true  } },
    { code: 'Proposal',                     labelVi: 'Đề xuất',                             meta: { cssClass: 'proposal',        isActiveStatus: true  } },
    { code: 'Family negotiation/review',    labelVi: 'Thương lượng/xem xét với gia đình',   meta: { cssClass: 'family-review',   isActiveStatus: true  } },
    { code: 'Contracted',                   labelVi: 'Đã ký hợp đồng',                      meta: { cssClass: 'contracted',      isActiveStatus: false } },
    { code: 'Lost',                         labelVi: 'Thất bại',                            meta: { cssClass: 'lost',            isActiveStatus: false } },
    { code: 'Nurturing',                    labelVi: 'Chăm sóc',                            meta: { cssClass: 'nurturing',       isActiveStatus: true  } },
    { code: 'Archived',                     labelVi: 'Lưu trữ',                             meta: { cssClass: 'archived',        isActiveStatus: false } },
  ],

  stone_tier: [
    { code: 'Quartz',   labelVi: 'Thạch Anh',      meta: { scoreMin:  40, scoreMax:  75, package: 'Standard',            packageVi: 'Tiêu chuẩn',              color: '#9CA3AF' } },
    { code: 'Agate',    labelVi: 'Mã Não',         meta: { scoreMin:  76, scoreMax: 105, package: 'Silver/Economy',      packageVi: 'Bạc / Tiết kiệm',         color: '#78716C' } },
    { code: 'Sapphire', labelVi: 'Ngọc Bích',      meta: { scoreMin: 106, scoreMax: 135, package: 'Gold/Premium',        packageVi: 'Vàng / Cao cấp',          color: '#2563EB' } },
    { code: 'Ruby',     labelVi: 'Hồng Ngọc',      meta: { scoreMin: 136, scoreMax: 165, package: 'Platinum/Business',   packageVi: 'Bạch kim / Doanh nhân',   color: '#DC2626' } },
    { code: 'Diamond',  labelVi: 'Kim Cương',      meta: { scoreMin: 166, scoreMax: 200, package: 'Diamond/First Class', packageVi: 'Kim cương / Hạng nhất',   color: '#8B5CF6' } },
    { code: 'Unscored', labelVi: 'Chưa chấm điểm', meta: { scoreMin: null, scoreMax: null, package: null,                packageVi: null,                       color: '#D1D5DB' } },
  ],

  stone_tier_message: [
    { code: 'Quartz',
      bodyEn: 'Quartz represents a high index of pure energy and balance. StudyLink will support you with International Programs locally with Scholarships—a smart decision to enjoy a world-class education while staying close to your family. Contact StudyLink NOW!',
      bodyVi: 'Viên Thạch Anh đại diện cho chỉ số năng lượng thanh khiết và sự cân bằng. StudyLink sẽ hỗ trợ bạn Du Học Tại Chỗ và Học Bổng, quyết định thông minh để tận hưởng giáo dục chuẩn quốc tế mà vẫn được gần gũi gia đình. Hãy liên hệ StudyLink NGAY!' },
    { code: 'Agate',
      bodyEn: 'Agate brings protection and enduring stability. A journey to Asian and European cultures will help you broaden your mindset and develop excellent adaptability. StudyLink will be your Companion on this abroad journey, contact us RIGHT NOW!',
      bodyVi: 'Viên Mã Não mang lại sự bảo hộ và ổn định bền vững. Hành trình đến với các nền văn hóa Á - Âu sẽ giúp bạn mở rộng tư duy và khả năng thích nghi tuyệt vời. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY với chúng tôi!' },
    { code: 'Sapphire',
      bodyEn: 'The blue hue of Sapphire is a symbol of virtue and wisdom. You possess a practical vision, and Europe or Australasia is the perfect environment for you to maximize your potential. StudyLink will be your Companion on this abroad journey, contact us NOW!',
      bodyVi: 'Sắc xanh của viên Ngọc Bích là biểu tượng của tâm lành và trí tuệ. Bạn có tầm nhìn thực tế, Châu Âu hoặc Châu Úc là môi trường phù hợp để bạn phát huy tối đa năng lực bản thân. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY!' },
    { code: 'Ruby',
      bodyEn: 'Ruby represents power and confidence, forecasting a brilliant journey at leading educational powerhouses across 5 continents. You are ready to conquer great and beautiful challenges. StudyLink will be your Companion on this study abroad journey, contact us NOW!',
      bodyVi: 'Viên Hồng Ngọc đại diện cho quyền lực và sự tự tin, dự báo một hành trình rực rỡ tại các cường quốc giáo dục khắp 5 Châu. Bạn đã sẵn sàng để chinh phục những thử thách lớn lao và đẹp đẽ. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY!' },
    { code: 'Diamond',
      bodyEn: 'Diamond is the apex of perseverance and brilliance. You can aim at the global top institutions, places reserved for the most excellent individuals. StudyLink will be your Companion on this study abroad journey, contact us NOW!',
      bodyVi: 'Viên Kim Cương là đỉnh cao của sự kiên định và rực rỡ. Đừng ngần ngại chinh phục những ngôi trường Top toàn cầu, nơi dành cho những người xuất sắc nhất. StudyLink sẽ Đồng Hành cùng bạn trên hành trình xuất ngoại, hãy liên hệ NGAY!' },
  ],

  study_plan: [
    { code: 'Study Abroad',          labelVi: 'Du học' },
    { code: 'English Summer School', labelVi: 'Trại hè tiếng Anh' },
    { code: 'Study in Vietnam',      labelVi: 'Học trong nước' },
    { code: 'Do not study',          labelVi: 'Không học' },
  ],

  lead_source: [
    { code: 'Databases',             labelVi: 'Cơ sở dữ liệu' },
    { code: 'FB-Zalo-GG-TikTok ads', labelVi: 'Quảng cáo FB-Zalo-GG-TikTok' },
    { code: 'School outreach',       labelVi: 'Tiếp cận trường học' },
    { code: 'Subagent referrals',    labelVi: 'Giới thiệu từ đại lý phụ' },
    { code: 'Ex-client',             labelVi: 'Khách hàng cũ' },
  ],

  interaction: [
    { code: 'Only left contact',     labelVi: 'Chỉ để lại liên hệ' },
    { code: 'Queries',               labelVi: 'Có câu hỏi' },
    { code: 'Fill lead form partly', labelVi: 'Điền một phần biểu mẫu' },
    { code: 'Fill lead form fully',  labelVi: 'Điền đầy đủ biểu mẫu' },
    { code: 'Call in-Walk in',       labelVi: 'Gọi điện - Đến trực tiếp' },
  ],

  timeline: [
    { code: 'Next 6 months', labelVi: '6 tháng tới' },
    { code: '6-12 months',   labelVi: '6-12 tháng' },
    { code: '12-24 months',  labelVi: '12-24 tháng' },
    { code: '24-36 months',  labelVi: '24-36 tháng' },
    { code: '36+ months',    labelVi: 'Trên 36 tháng' },
  ],

  // VN labels are from vi.js (processApplicationOptions array).
  process_application: [
    { code: "I'll do it myself",              labelVi: 'Tự làm' },
    { code: 'I have an agent',                labelVi: 'Đã có đại lý' },
    { code: 'Talking to agents',              labelVi: 'Đang tìm đại lý' },
    { code: 'Relatives in Vietnam will help', labelVi: 'Người thân ở VN giúp' },
    { code: 'Relatives overseas will help',   labelVi: 'Người thân ở nước ngoài giúp' },
  ],

  confidence: [
    { code: 'Low (0-30%)',         labelVi: 'Thấp (0-30%)' },
    { code: 'Medium (31-60%)',     labelVi: 'Trung bình (31-60%)' },
    { code: 'High (61-90%)',       labelVi: 'Cao (61-90%)' },
    { code: 'Committed (91-100%)', labelVi: 'Cam kết (91-100%)' },
  ],

  // ─── Geography ──────────────────────────────────────────────────
  country: [
    { code: 'Australia',      labelVi: 'Úc',           meta: { region: 'Australasia',   aliases: ['Aus', 'Aussie', 'AU', 'Australian'] } },
    { code: 'New Zealand',    labelVi: 'New Zealand',  meta: { region: 'Australasia',   aliases: ['NZ', 'Niu Di-lân', 'Kiwi'] } },
    { code: 'Canada',         labelVi: 'Canada',       meta: { region: 'North America', aliases: ['Can', 'CA', 'Canadian'] } },
    { code: 'United States',  labelVi: 'Mỹ',           meta: { region: 'North America', aliases: ['USA', 'US', 'America', 'American', 'Hoa Kỳ', 'United States of America'] } },
    { code: 'United Kingdom', labelVi: 'Anh',          meta: { region: 'Europe',        aliases: ['UK', 'Britain', 'England', 'GB', 'Great Britain', 'Anh Quốc', 'British'] } },
    { code: 'Germany',        labelVi: 'Đức',          meta: { region: 'Europe',        aliases: ['Deutschland', 'DE', 'German'] } },
    { code: 'France',         labelVi: 'Pháp',         meta: { region: 'Europe',        aliases: ['FR', 'French'] } },
    { code: 'Netherlands',    labelVi: 'Hà Lan',       meta: { region: 'Europe',        aliases: ['Holland', 'NL', 'Dutch'] } },
    { code: 'Ireland',        labelVi: 'Ireland',      meta: { region: 'Europe',        aliases: ['Ai-len', 'IE', 'Irish'] } },
    { code: 'Switzerland',    labelVi: 'Thụy Sĩ',      meta: { region: 'Europe',        aliases: ['CH', 'Swiss', 'Thuy Si'] } },
    { code: 'Finland',        labelVi: 'Phần Lan',     meta: { region: 'Europe',        aliases: ['FI', 'Finnish', 'Phan Lan'] } },
    { code: 'Denmark',        labelVi: 'Đan Mạch',     meta: { region: 'Europe',        aliases: ['DK', 'Danish', 'Dan Mach'] } },
    { code: 'Sweden',         labelVi: 'Thụy Điển',    meta: { region: 'Europe',        aliases: ['SE', 'Swedish', 'Thuy Dien'] } },
    { code: 'Norway',         labelVi: 'Na Uy',        meta: { region: 'Europe',        aliases: ['NO', 'Norwegian'] } },
    { code: 'Czech Republic', labelVi: 'Cộng hòa Séc', meta: { region: 'Europe',        aliases: ['Czechia', 'Séc', 'CZ', 'Czech', 'Cong hoa Sec'] } },
    { code: 'Hungary',        labelVi: 'Hungary',      meta: { region: 'Europe',        aliases: ['Hung-ga-ri', 'HU', 'Hungarian'] } },
    { code: 'Singapore',      labelVi: 'Singapore',    meta: { region: 'Asia',          aliases: ['Sing', 'SG'] } },
    { code: 'Japan',          labelVi: 'Nhật Bản',     meta: { region: 'Asia',          aliases: ['Nhật', 'JP', 'Japanese', 'Nhat Ban'] } },
    { code: 'South Korea',    labelVi: 'Hàn Quốc',     meta: { region: 'Asia',          aliases: ['Korea', 'Hàn', 'KR', 'Korean', 'Han Quoc'] } },
    { code: 'China',          labelVi: 'Trung Quốc',   meta: { region: 'Asia',          aliases: ['Trung', 'CN', 'Chinese', 'Trung Quoc', 'PRC'] } },
    { code: 'Taiwan',         labelVi: 'Đài Loan',     meta: { region: 'Asia',          aliases: ['TW', 'Taiwanese', 'Dai Loan', 'ROC'] } },
    { code: 'Malaysia',       labelVi: 'Malaysia',     meta: { region: 'Asia',          aliases: ['Mã Lai', 'MY', 'Malaysian', 'Ma Lai'] } },
    { code: 'Thailand',       labelVi: 'Thái Lan',     meta: { region: 'Asia',          aliases: ['Thái', 'TH', 'Thai', 'Thai Lan'] } },
    { code: 'Philippines',    labelVi: 'Philippines',  meta: { region: 'Asia',          aliases: ['Phi-líp-pin', 'PH', 'Filipino', 'Phi Lip Pin'] } },
  ],

  vietnam_province: [
    { code: 'An Giang',          labelVi: 'An Giang' },
    { code: 'Ba Ria-Vung Tau',   labelVi: 'Bà Rịa-Vũng Tàu' },
    { code: 'Bac Giang',         labelVi: 'Bắc Giang' },
    { code: 'Bac Kan',           labelVi: 'Bắc Kạn' },
    { code: 'Bac Lieu',          labelVi: 'Bạc Liêu' },
    { code: 'Bac Ninh',          labelVi: 'Bắc Ninh' },
    { code: 'Ben Tre',           labelVi: 'Bến Tre' },
    { code: 'Binh Dinh',         labelVi: 'Bình Định' },
    { code: 'Binh Duong',        labelVi: 'Bình Dương' },
    { code: 'Binh Phuoc',        labelVi: 'Bình Phước' },
    { code: 'Binh Thuan',        labelVi: 'Bình Thuận' },
    { code: 'Ca Mau',            labelVi: 'Cà Mau' },
    { code: 'Can Tho',           labelVi: 'Cần Thơ' },
    { code: 'Cao Bang',          labelVi: 'Cao Bằng' },
    { code: 'Da Nang',           labelVi: 'Đà Nẵng' },
    { code: 'Dak Lak',           labelVi: 'Đắk Lắk' },
    { code: 'Dak Nong',          labelVi: 'Đắk Nông' },
    { code: 'Dien Bien',         labelVi: 'Điện Biên' },
    { code: 'Dong Nai',          labelVi: 'Đồng Nai' },
    { code: 'Dong Thap',         labelVi: 'Đồng Tháp' },
    { code: 'Gia Lai',           labelVi: 'Gia Lai' },
    { code: 'Ha Giang',          labelVi: 'Hà Giang' },
    { code: 'Ha Nam',            labelVi: 'Hà Nam' },
    { code: 'Ha Noi',            labelVi: 'Hà Nội' },
    { code: 'Ha Tinh',           labelVi: 'Hà Tĩnh' },
    { code: 'Hai Duong',         labelVi: 'Hải Dương' },
    { code: 'Hai Phong',         labelVi: 'Hải Phòng' },
    { code: 'Hau Giang',         labelVi: 'Hậu Giang' },
    { code: 'Ho Chi Minh City',  labelVi: 'Hồ Chí Minh', meta: { aliases: ['HCMC', 'Saigon', 'Sài Gòn'] } },
    { code: 'Hoa Binh',          labelVi: 'Hòa Bình' },
    { code: 'Hung Yen',          labelVi: 'Hưng Yên' },
    { code: 'Khanh Hoa',         labelVi: 'Khánh Hòa' },
    { code: 'Kien Giang',        labelVi: 'Kiên Giang' },
    { code: 'Kon Tum',           labelVi: 'Kon Tum' },
    { code: 'Lai Chau',          labelVi: 'Lai Châu' },
    { code: 'Lam Dong',          labelVi: 'Lâm Đồng' },
    { code: 'Lang Son',          labelVi: 'Lạng Sơn' },
    { code: 'Lao Cai',           labelVi: 'Lào Cai' },
    { code: 'Long An',           labelVi: 'Long An' },
    { code: 'Nam Dinh',          labelVi: 'Nam Định' },
    { code: 'Nghe An',           labelVi: 'Nghệ An' },
    { code: 'Ninh Binh',         labelVi: 'Ninh Bình' },
    { code: 'Ninh Thuan',        labelVi: 'Ninh Thuận' },
    { code: 'Phu Tho',           labelVi: 'Phú Thọ' },
    { code: 'Phu Yen',           labelVi: 'Phú Yên' },
    { code: 'Quang Binh',        labelVi: 'Quảng Bình' },
    { code: 'Quang Nam',         labelVi: 'Quảng Nam' },
    { code: 'Quang Ngai',        labelVi: 'Quảng Ngãi' },
    { code: 'Quang Ninh',        labelVi: 'Quảng Ninh' },
    { code: 'Quang Tri',         labelVi: 'Quảng Trị' },
    { code: 'Soc Trang',         labelVi: 'Sóc Trăng' },
    { code: 'Son La',            labelVi: 'Sơn La' },
    { code: 'Tay Ninh',          labelVi: 'Tây Ninh' },
    { code: 'Thai Binh',         labelVi: 'Thái Bình' },
    { code: 'Thai Nguyen',       labelVi: 'Thái Nguyên' },
    { code: 'Thanh Hoa',         labelVi: 'Thanh Hóa' },
    { code: 'Thua Thien-Hue',    labelVi: 'Thừa Thiên-Huế' },
    { code: 'Tien Giang',        labelVi: 'Tiền Giang' },
    { code: 'Tra Vinh',          labelVi: 'Trà Vinh' },
    { code: 'Tuyen Quang',       labelVi: 'Tuyên Quang' },
    { code: 'Vinh Long',         labelVi: 'Vĩnh Long' },
    { code: 'Vinh Phuc',         labelVi: 'Vĩnh Phúc' },
    { code: 'Yen Bai',           labelVi: 'Yên Bái' },
  ],

  phone_country_code: [
    { code: '+84',  labelEn: 'Vietnam',        labelVi: 'Việt Nam' },
    { code: '+61',  labelEn: 'Australia',      labelVi: 'Úc' },
    { code: '+1',   labelEn: 'Canada / USA',   labelVi: 'Canada / Mỹ',    meta: { note: 'shared by Canada and USA' } },
    { code: '+86',  labelEn: 'China',          labelVi: 'Trung Quốc' },
    { code: '+420', labelEn: 'Czech Republic', labelVi: 'Cộng hòa Séc' },
    { code: '+45',  labelEn: 'Denmark',        labelVi: 'Đan Mạch' },
    { code: '+358', labelEn: 'Finland',        labelVi: 'Phần Lan' },
    { code: '+33',  labelEn: 'France',         labelVi: 'Pháp' },
    { code: '+49',  labelEn: 'Germany',        labelVi: 'Đức' },
    { code: '+36',  labelEn: 'Hungary',        labelVi: 'Hungary' },
    { code: '+353', labelEn: 'Ireland',        labelVi: 'Ireland' },
    { code: '+81',  labelEn: 'Japan',          labelVi: 'Nhật Bản' },
    { code: '+82',  labelEn: 'South Korea',    labelVi: 'Hàn Quốc' },
    { code: '+60',  labelEn: 'Malaysia',       labelVi: 'Malaysia' },
    { code: '+31',  labelEn: 'Netherlands',    labelVi: 'Hà Lan' },
    { code: '+64',  labelEn: 'New Zealand',    labelVi: 'New Zealand' },
    { code: '+47',  labelEn: 'Norway',         labelVi: 'Na Uy' },
    { code: '+63',  labelEn: 'Philippines',    labelVi: 'Philippines' },
    { code: '+65',  labelEn: 'Singapore',      labelVi: 'Singapore' },
    { code: '+46',  labelEn: 'Sweden',         labelVi: 'Thụy Điển' },
    { code: '+41',  labelEn: 'Switzerland',    labelVi: 'Thụy Sĩ' },
    { code: '+886', labelEn: 'Taiwan',         labelVi: 'Đài Loan' },
    { code: '+66',  labelEn: 'Thailand',       labelVi: 'Thái Lan' },
    { code: '+44',  labelEn: 'United Kingdom', labelVi: 'Anh' },
  ],

  contact_medium: [
    { code: 'Phone',     meta: { idType: 'phone' } },
    { code: 'Zalo',      meta: { idType: 'phone' } },
    { code: 'WhatsApp',  meta: { idType: 'phone' } },
    { code: 'Viber',     meta: { idType: 'phone' } },
    { code: 'Telegram',  meta: { idType: 'phone' } },
    { code: 'Line',      meta: { idType: 'phone' } },
    { code: 'Email',     meta: { idType: 'email' } },
    { code: 'TikTok',    meta: { idType: 'email' } },
    { code: 'YouTube',   meta: { idType: 'email' } },
    { code: 'Skype',     meta: { idType: 'email' } },
    { code: 'Facebook',  meta: { idType: 'dual'  } },
    { code: 'Instagram', meta: { idType: 'dual'  } },
    { code: 'Threads',   meta: { idType: 'dual'  } },
    { code: 'Messenger', meta: { idType: 'other' } },
  ],

  // ─── Self-assessment tiers ────────────────────────────────────────
  budget: [
    { code: '< 300M VND',   labelVi: 'Dưới 300 triệu VND',   meta: { weight: 4, tierRank: 1 } },
    { code: '300-500M VND', labelVi: '300-500 triệu VND',    meta: { weight: 4, tierRank: 2 } },
    { code: '500-800M VND', labelVi: '500-800 triệu VND',    meta: { weight: 4, tierRank: 3 } },
    { code: '800M-1B VND',  labelVi: '800 triệu - 1 tỷ VND', meta: { weight: 4, tierRank: 4 } },
    { code: '1-1.5B VND',   labelVi: '1 - 1.5 tỷ VND',       meta: { weight: 4, tierRank: 5 } },
  ],
  scholarship_demand: [
    { code: '100% scholarship',      labelEn: '100%',        labelVi: 'Học bổng 100%',      meta: { weight: 3, tierRank: 1 } },
    { code: '60-90% scholarship',    labelEn: '60-90%',      labelVi: 'Học bổng 60-90%',    meta: { weight: 3, tierRank: 2 } },
    { code: '30-50% scholarship',    labelEn: '30-50%',      labelVi: 'Học bổng 30-50%',    meta: { weight: 3, tierRank: 3 } },
    { code: '20-25% scholarship',    labelEn: '20-25%',      labelVi: 'Học bổng 20-25%',    meta: { weight: 3, tierRank: 4 } },
    { code: 'No scholarship needed', labelEn: 'None needed', labelVi: 'Không cần học bổng', meta: { weight: 3, tierRank: 5 } },
  ],
  english_level: [
    { code: 'Beginner',    labelVi: 'Mới bắt đầu', meta: { weight: 4, tierRank: 1 } },
    { code: 'IELTS 4-4.5', labelVi: 'IELTS 4-4.5', meta: { weight: 4, tierRank: 2 } },
    { code: 'IELTS 5-5.5', labelVi: 'IELTS 5-5.5', meta: { weight: 4, tierRank: 3 } },
    { code: 'IELTS 6-6.5', labelVi: 'IELTS 6-6.5', meta: { weight: 4, tierRank: 4 } },
    { code: 'IELTS 7+',    labelVi: 'IELTS 7+',    meta: { weight: 4, tierRank: 5 } },
  ],
  gpa: [
    { code: '< 6.5',   labelVi: '< 6.5',   meta: { weight: 2, tierRank: 1 } },
    { code: '6.5-6.9', labelVi: '6.5-6.9', meta: { weight: 2, tierRank: 2 } },
    { code: '7-7.9',   labelVi: '7-7.9',   meta: { weight: 2, tierRank: 3 } },
    { code: '8-8.9',   labelVi: '8-8.9',   meta: { weight: 2, tierRank: 4 } },
    { code: '9+',      labelVi: '9+',      meta: { weight: 2, tierRank: 5 } },
  ],
  immigration_history: [
    { code: 'Visa rejection (self)',          labelVi: 'Từng bị từ chối visa (bản thân)',  meta: { weight: 3, tierRank: 1 } },
    { code: 'Rejection/overstay (family)',    labelVi: 'Từ chối/quá hạn (gia đình)',       meta: { weight: 3, tierRank: 2 } },
    { code: 'No travel history',              labelVi: 'Chưa từng đi nước ngoài',          meta: { weight: 3, tierRank: 3 } },
    { code: 'Travelled in Asia',              labelVi: 'Đã đi các nước châu Á',            meta: { weight: 3, tierRank: 4 } },
    { code: 'Travelled to Western countries', labelEn: 'Travelled West', labelVi: 'Đã đi các nước phương Tây', meta: { weight: 3, tierRank: 5 } },
  ],
  sponsor_income: [
    { code: '< 300M VND',   labelVi: 'Dưới 300 triệu VND',   meta: { weight: 4, tierRank: 1 } },
    { code: '300-500M VND', labelVi: '300-500 triệu VND',    meta: { weight: 4, tierRank: 2 } },
    { code: '500-800M VND', labelVi: '500-800 triệu VND',    meta: { weight: 4, tierRank: 3 } },
    { code: '800M-1B VND',  labelVi: '800 triệu - 1 tỷ VND', meta: { weight: 4, tierRank: 4 } },
    { code: '1-1.5B VND',   labelVi: '1 - 1.5 tỷ VND',       meta: { weight: 4, tierRank: 5 } },
  ],
  income_evidence: [
    { code: '0% documented',     labelEn: '0%',     labelVi: 'Không có chứng từ',   meta: { weight: 4, tierRank: 1 } },
    { code: '30-35% documented', labelEn: '30-35%', labelVi: '30-35% có chứng từ',  meta: { weight: 4, tierRank: 2 } },
    { code: '50% documented',    labelEn: '50%',    labelVi: '50% có chứng từ',     meta: { weight: 4, tierRank: 3 } },
    { code: '70-75% documented', labelEn: '70-75%', labelVi: '70-75% có chứng từ',  meta: { weight: 4, tierRank: 4 } },
    { code: '100% documented',   labelEn: '100%',   labelVi: '100% có chứng từ',    meta: { weight: 4, tierRank: 5 } },
  ],
  study_plan_gap: [
    { code: 'Different major, 5+ year gap',  labelEn: 'Diff major, 5+ yr gap',  labelVi: 'Khác ngành, nghỉ hơn 5 năm',  meta: { weight: 3, tierRank: 1 } },
    { code: 'Different major, 2-5 year gap', labelEn: 'Diff major, 2-5 yr gap', labelVi: 'Khác ngành, nghỉ 2-5 năm',    meta: { weight: 3, tierRank: 2 } },
    { code: 'Same major, 2-5 year gap',      labelEn: 'Same major, 2-5 yr gap', labelVi: 'Cùng ngành, nghỉ 2-5 năm',    meta: { weight: 3, tierRank: 3 } },
    { code: 'Same major, < 2 year gap',      labelEn: 'Same major, < 2 yr gap', labelVi: 'Cùng ngành, nghỉ dưới 2 năm', meta: { weight: 3, tierRank: 4 } },
    { code: 'Same major, no gap',            labelEn: 'Same major, no gap',     labelVi: 'Cùng ngành, không gián đoạn', meta: { weight: 3, tierRank: 5 } },
  ],
  ultimate_objective: [
    { code: 'Migration only',              labelVi: 'Chỉ di cư',                    meta: { weight: 2, tierRank: 1 } },
    { code: 'Work only',                   labelVi: 'Chỉ làm việc',                 meta: { weight: 2, tierRank: 2 } },
    { code: 'Study but work more',         labelVi: 'Học nhưng làm việc nhiều hơn', meta: { weight: 2, tierRank: 3 } },
    { code: 'Study for migration pathway', labelEn: 'Study for migration', labelVi: 'Học để đi định cư', meta: { weight: 2, tierRank: 4 } },
    { code: 'Study only',                  labelVi: 'Chỉ học',                      meta: { weight: 2, tierRank: 5 } },
  ],

  // ─── OCEAN ───────────────────────────────────────────────────────
  ocean_question: [
    { code:  '1', bodyEn: 'I am the life of the party and enjoy being the center of attention.',
                  bodyVi: 'Tôi là người khuấy động bầu không khí trong các bữa tiệc và thích trở thành trung tâm của sự chú ý.',
                  meta: { trait: 'extraversion', polarity:  1 } },
    { code:  '2', bodyEn: "I sympathize with others' feelings and feel for those less fortunate.",
                  bodyVi: 'Tôi đồng cảm với cảm xúc của người khác và thương cảm cho những người kém may mắn.',
                  meta: { trait: 'agreeableness', polarity:  1 } },
    { code:  '3', bodyEn: 'I am always prepared and keep my belongings organized.',
                  bodyVi: 'Tôi luôn chuẩn bị sẵn sàng và giữ đồ đạc của mình ngăn nắp.',
                  meta: { trait: 'conscientiousness', polarity:  1 } },
    { code:  '4', bodyEn: 'I have frequent mood swings and get stressed easily.',
                  bodyVi: 'Tôi thường thay đổi tâm trạng thất thường và dễ bị căng thẳng.',
                  meta: { trait: 'neuroticism', polarity:  1 } },
    { code:  '5', bodyEn: 'I have a vivid imagination and enjoy thinking about abstract ideas.',
                  bodyVi: 'Tôi có trí tưởng tượng phong phú và thích suy nghĩ về những ý tưởng trừu tượng.',
                  meta: { trait: 'openness', polarity:  1 } },
    { code:  '6', bodyEn: "I don't talk a lot and tend to keep to myself.",
                  bodyVi: 'Tôi không nói nhiều và thường sống khép kín.',
                  meta: { trait: 'extraversion', polarity: -1 } },
    { code:  '7', bodyEn: "I am not really interested in others' problems or feelings.",
                  bodyVi: 'Tôi không thực sự quan tâm đến vấn đề hay cảm xúc của người khác.',
                  meta: { trait: 'agreeableness', polarity: -1 } },
    { code:  '8', bodyEn: 'I often forget to put things back in their proper place.',
                  bodyVi: 'Tôi thường quên đặt đồ vật về đúng chỗ.',
                  meta: { trait: 'conscientiousness', polarity: -1 } },
    { code:  '9', bodyEn: "I am relaxed most of the time and don't worry much.",
                  bodyVi: 'Phần lớn thời gian tôi khá thoải mái và không lo lắng nhiều.',
                  meta: { trait: 'neuroticism', polarity: -1 } },
    { code: '10', bodyEn: 'I am not interested in theoretical or philosophical discussions.',
                  bodyVi: 'Tôi không hứng thú với các cuộc thảo luận mang tính lý thuyết hay triết học.',
                  meta: { trait: 'openness', polarity: -1 } },
    { code: '11', bodyEn: 'I feel comfortable around people and start conversations easily.',
                  bodyVi: 'Tôi cảm thấy thoải mái khi ở cạnh mọi người và dễ dàng bắt chuyện.',
                  meta: { trait: 'extraversion', polarity:  1 } },
    { code: '12', bodyEn: 'I have a soft heart and try to make people feel at ease.',
                  bodyVi: 'Tôi có trái tim mềm yếu và cố gắng làm cho mọi người cảm thấy dễ chịu.',
                  meta: { trait: 'agreeableness', polarity:  1 } },
    { code: '13', bodyEn: 'I pay attention to details and like to get chores done right away.',
                  bodyVi: 'Tôi chú ý đến chi tiết và thích hoàn thành công việc ngay lập tức.',
                  meta: { trait: 'conscientiousness', polarity:  1 } },
    { code: '14', bodyEn: 'I get upset easily and often feel blue or anxious.',
                  bodyVi: 'Tôi dễ buồn bực và thường cảm thấy u sầu hoặc lo lắng.',
                  meta: { trait: 'neuroticism', polarity:  1 } },
    { code: '15', bodyEn: 'I enjoy hearing new ideas and looking at art or nature.',
                  bodyVi: 'Tôi thích nghe những ý tưởng mới và ngắm nhìn nghệ thuật hoặc thiên nhiên.',
                  meta: { trait: 'openness', polarity:  1 } },
  ],

  // NEW: Likert scale labels for the OCEAN questionnaire (1..5).
  ocean_scale: [
    { code: '1', labelEn: 'Strongly Disagree', labelVi: 'Hoàn toàn không đồng ý' },
    { code: '2', labelEn: 'Disagree',          labelVi: 'Không đồng ý' },
    { code: '3', labelEn: 'Neutral',           labelVi: 'Trung lập' },
    { code: '4', labelEn: 'Agree',             labelVi: 'Đồng ý' },
    { code: '5', labelEn: 'Strongly Agree',    labelVi: 'Hoàn toàn đồng ý' },
  ],

  ocean_archetype_group: [
    { code: 'Proactive Leaders',  labelVi: 'Những nhà lãnh đạo chủ động',
      meta: { colors: { bg: '#FEF2F2', border: '#FECACA', badge: '#DC2626', text: '#991B1B' } } },
    { code: 'Creative Explorers', labelVi: 'Những nhà thám hiểm sáng tạo',
      meta: { colors: { bg: '#FFF7ED', border: '#FED7AA', badge: '#EA580C', text: '#9A3412' } } },
    { code: 'Methodical Experts', labelVi: 'Những chuyên gia phương pháp',
      meta: { colors: { bg: '#EFF6FF', border: '#BFDBFE', badge: '#2563EB', text: '#1E40AF' } } },
    { code: 'Social Adaptables',  labelVi: 'Những người thích nghi xã hội',
      meta: { colors: { bg: '#F0FDF4', border: '#BBF7D0', badge: '#16A34A', text: '#14532D' } } },
  ],

  ocean_archetype: [
    // Group 1: Proactive Leaders (High C, High E)
    { code: '+_+_+_+_-', labelEn: 'The Benevolent Captain',  labelVi: 'Thuyền trưởng Nhân từ',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['CEO of Social Enterprise', 'Hospital Administrator', 'NGO Director'], careersVi: ['CEO doanh nghiệp xã hội', 'Quản lý bệnh viện', 'Giám đốc NGO'] } },
    { code: '+_+_+_-_-', labelEn: 'The Strategic Commander', labelVi: 'Người chỉ huy Chiến lược',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['M&A Lawyer', 'Corporate Strategist', 'Tech Founder'], careersVi: ['Luật sư M&A', 'Chiến lược gia doanh nghiệp', 'Nhà sáng lập công nghệ'] } },
    { code: '-_+_+_+_-', labelEn: 'The Operations Anchor',   labelVi: 'Điểm tựa Vận hành',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['Supply Chain Director', 'School Principal', 'Event Producer'], careersVi: ['Giám đốc chuỗi cung ứng', 'Hiệu trưởng trường học', 'Nhà sản xuất sự kiện'] } },
    { code: '-_+_+_-_-', labelEn: 'The Efficient Driver',    labelVi: 'Người dẫn dắt Hiệu quả',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['Logistics Manager', 'Sales Director', 'Real Estate Developer'], careersVi: ['Quản lý hậu cần', 'Giám đốc kinh doanh', 'Nhà phát triển bất động sản'] } },
    { code: '+_+_+_+_+', labelEn: 'The Passionate Advocate', labelVi: 'Người ủng hộ Nhiệt huyết',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['Campaign Manager', 'High-Stakes PR', 'Crisis Communications'], careersVi: ['Quản lý chiến dịch', 'Quan hệ công chúng cao cấp', 'Truyền thông khủng hoảng'] } },
    { code: '+_+_+_-_+', labelEn: 'The Intense Visionary',   labelVi: 'Người có tầm nhìn Mãnh liệt',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['Startup Pivot Specialist', 'Competitive Athlete Manager', 'Growth Hacker'], careersVi: ['Chuyên gia định hướng lại startup', 'Quản lý vận động viên thi đấu', 'Chuyên gia tăng trưởng'] } },
    { code: '-_+_+_+_+', labelEn: 'The Attentive Mentor',    labelVi: 'Người cố vấn Tận tâm',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['Customer Success Lead', 'HR Director', 'Training & Development'], careersVi: ['Trưởng bộ phận thành công khách hàng', 'Giám đốc nhân sự', 'Đào tạo & Phát triển'] } },
    { code: '-_+_+_-_+', labelEn: 'The High-Stakes Closer',  labelVi: 'Người chốt deal Quyết đoán',
      meta: { groupCode: 'Proactive Leaders', careersEn: ['Stock Trader', 'Emergency Room Manager', 'Litigator'], careersVi: ['Nhà giao dịch chứng khoán', 'Quản lý phòng cấp cứu', 'Luật sư tranh tụng'] } },
    // Group 2: Creative Explorers (High O, Low C)
    { code: '+_-_+_+_-', labelEn: 'The Social Inventor',     labelVi: 'Nhà phát minh Xã hội',
      meta: { groupCode: 'Creative Explorers', careersEn: ['UX Designer', 'Travel Influencer', 'Community Builder'], careersVi: ['Nhà thiết kế UX', 'Người có sức ảnh hưởng về du lịch', 'Người xây dựng cộng đồng'] } },
    { code: '+_-_+_-_-', labelEn: 'The Bold Maverick',       labelVi: 'Kẻ độc hành Táo bạo',
      meta: { groupCode: 'Creative Explorers', careersEn: ['Entrepreneur', 'Independent Filmmaker', 'Trend Forecaster'], careersVi: ['Doanh nghiệp tự thân', 'Nhà làm phim độc lập', 'Nhà dự báo xu hướng'] } },
    { code: '+_-_-_+_-', labelEn: 'The Artistic Soul',       labelVi: 'Tâm hồn Nghệ sĩ',
      meta: { groupCode: 'Creative Explorers', careersEn: ['Illustrator', 'Novelist', 'Museum Curator'], careersVi: ['Họa sĩ minh họa', 'Tiểu thuyết gia', 'Giám tuyển bảo tàng'] } },
    { code: '+_-_-_-_-', labelEn: 'The Abstract Analyst',    labelVi: 'Nhà phân tích Trừu tượng',
      meta: { groupCode: 'Creative Explorers', careersEn: ['AI Prompt Engineer', 'Theoretical Physicist', 'Philosopher'], careersVi: ['Kỹ sư ra lệnh AI', 'Nhà vật lý lý thuyết', 'Triết gia'] } },
    { code: '+_-_+_+_+', labelEn: 'The Expressive Empath',   labelVi: 'Người thấu cảm Biểu đạt',
      meta: { groupCode: 'Creative Explorers', careersEn: ['Theater Director', 'Art Therapist', 'Media Stylist'], careersVi: ['Đạo diễn sân khấu', 'Nhà trị liệu bằng nghệ thuật', 'Nhà tạo mẫu truyền thông'] } },
    { code: '+_-_+_-_+', labelEn: 'The Restless Creator',    labelVi: 'Nhà sáng tạo Không ngừng',
      meta: { groupCode: 'Creative Explorers', careersEn: ['Fashion Designer', 'Investigative Journalist', 'Ad Copywriter'], careersVi: ['Nhà thiết kế thời trang', 'Phóng viên điều tra', 'Người viết lời quảng cáo'] } },
    { code: '+_-_-_+_+', labelEn: 'The Sensitive Dreamer',   labelVi: 'Kẻ mộng mơ Nhạy cảm',
      meta: { groupCode: 'Creative Explorers', careersEn: ['Music Composer', 'Virtual Reality World Builder', 'Poet'], careersVi: ['Nhà soạn nhạc', 'Nhà xây dựng thế giới thực tế ảo', 'Nhà thơ'] } },
    { code: '+_-_-_-_+', labelEn: 'The Complex Thinker',     labelVi: 'Người tư duy Phức hợp',
      meta: { groupCode: 'Creative Explorers', careersEn: ['Cybersecurity Red Teamer', 'Strategy Game Designer', 'Cryptographer'], careersVi: ['Chuyên gia phòng thủ an ninh mạng', 'Nhà thiết kế trò chơi chiến thuật', 'Chuyên gia mã hóa'] } },
    // Group 3: Methodical Experts (High C, Low E)
    { code: '+_+_-_+_-', labelEn: 'The Scholarly Specialist', labelVi: 'Chuyên gia Học thuật',
      meta: { groupCode: 'Methodical Experts', careersEn: ['University Researcher', 'Sustainable Architect', 'Librarian'], careersVi: ['Nhà nghiên cứu đại học', 'Kiến trúc sư bền vững', 'Thủ thư'] } },
    { code: '+_+_-_-_-', labelEn: 'The Data Architect',      labelVi: 'Kiến trúc sư Dữ liệu',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Data Scientist', 'Systems Engineer', 'Patent Attorney'], careersVi: ['Nhà khoa học dữ liệu', 'Kỹ sư hệ thống', 'Luật sư bằng sáng chế'] } },
    { code: '-_+_-_+_-', labelEn: 'The Reliable Craftsman',  labelVi: 'Người thợ thủ công Đáng tin',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Accountant', 'Civil Engineer', 'Medical Lab Technician'], careersVi: ['Kế toán', 'Kỹ sư dân dụng', 'Kỹ thuật viên xét nghiệm y khoa'] } },
    { code: '-_+_-_-_-', labelEn: 'The Practical Auditor',   labelVi: 'Kiểm toán viên Thực tế',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Compliance Officer', 'Quality Control Manager', 'Database Administrator'], careersVi: ['Chuyên viên tuân thủ', 'Kiểm soát chất lượng', 'Quản trị cơ sở dữ liệu'] } },
    { code: '+_+_-_+_+', labelEn: 'The Vigilant Scholar',    labelVi: 'Học giả Cảnh giác',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Historical Archivist', 'Bio-Ethicist', 'Policy Researcher'], careersVi: ['Người lưu trữ lịch sử', 'Nhà đạo đức sinh học', 'Nhà nghiên cứu chính sách'] } },
    { code: '+_+_-_-_+', labelEn: 'The Precise Analyst',     labelVi: 'Nhà phân tích Chính xác',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Forensic Accountant', 'Risk Modeler', 'Cyber-Auditor'], careersVi: ['Kế toán pháp y', 'Người mô hình hóa rủi ro', 'Kiểm toán viên mạng'] } },
    { code: '-_+_-_+_+', labelEn: 'The Diligent Helper',     labelVi: 'Người trợ giúp Tận tụy',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Pharmacist', 'Technical Support Lead', 'Safety Inspector'], careersVi: ['Dược sĩ', 'Trưởng nhóm hỗ trợ kỹ thuật', 'Thanh tra an toàn'] } },
    { code: '-_+_-_-_+', labelEn: 'The Cautious Protector',  labelVi: 'Người bảo vệ Thận trọng',
      meta: { groupCode: 'Methodical Experts', careersEn: ['Actuary', 'Underwriter', 'Information Security Officer'], careersVi: ['Chuyên viên định phí bảo hiểm', 'Chuyên viên thẩm định rủi ro', 'Chuyên viên bảo mật thông tin'] } },
    // Group 4: Social Adaptables (Low C, High E)
    { code: '-_-_+_+_-', labelEn: 'The Jovial Host',         labelVi: 'Chủ nhà Vui vẻ',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Tourism Guide', 'Retail Manager', 'Flight Attendant'], careersVi: ['Hướng dẫn viên du lịch', 'Quản lý bán lẻ', 'Tiếp viên hàng không'] } },
    { code: '-_-_+_-_-', labelEn: 'The Opportunist',         labelVi: 'Người nắm bắt Cơ hội',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Promotions Agent', 'Brand Ambassador', 'Talent Scout'], careersVi: ['Đại lý quảng bá', 'Đại sứ thương hiệu', 'Người săn tìm tài năng'] } },
    { code: '-_-_-_+_-', labelEn: 'The Quiet Supporter',     labelVi: 'Người hỗ trợ Thầm lặng',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Administrative Assistant', 'Customer Service', 'Clergy'], careersVi: ['Trợ lý hành chính', 'Chăm sóc khách hàng', 'Giáo sĩ'] } },
    { code: '-_-_-_-_-', labelEn: 'The Minimalist',          labelVi: 'Người tối giản',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Quality Assurance', 'Data Entry', 'Auditor'], careersVi: ['Người kiểm tra chất lượng (QA)', 'Nhập liệu', 'Kiểm toán viên'] } },
    { code: '-_-_+_+_+', labelEn: 'The Emotional Connector', labelVi: 'Người kết nối Cảm xúc',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Social Worker', 'Life Coach', 'Youth Counselor'], careersVi: ['Nhân viên công tác xã hội', 'Khai vấn cuộc sống (Life Coach)', 'Cố vấn thanh niên'] } },
    { code: '-_-_+_-_+', labelEn: 'The Dynamic Performer',   labelVi: 'Người biểu diễn Năng động',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Actor', 'Professional Speaker', 'Fitness Instructor'], careersVi: ['Diễn viên', 'Diễn giả chuyên nghiệp', 'Huấn luyện viên thể hình'] } },
    { code: '-_-_-_+_+', labelEn: 'The Gentle Observer',     labelVi: 'Người quan sát Nhẹ nhàng',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Animal Caretaker', 'Florist', 'Support Group Facilitator'], careersVi: ['Người chăm sóc động vật', 'Thợ cắm hoa', 'Người điều phối nhóm hỗ trợ'] } },
    { code: '-_-_-_-_+', labelEn: 'The Solitary Watchman',   labelVi: 'Người canh gác Đơn độc',
      meta: { groupCode: 'Social Adaptables', careersEn: ['Security Guard', 'Remote Monitor', 'Fire Lookout'], careersVi: ['Nhân viên bảo vệ', 'Người giám sát từ xa', 'Người canh gác cháy rừng'] } },
  ],

  ocean_narrative_phrase: [
    { subcategory: 'extraversion',     code: 'high',    bodyEn: 'highly energetic and sociable, thriving in group settings and social interactions',                       bodyVi: 'rất năng động và hòa đồng, phát huy tốt nhất trong môi trường tập thể và giao tiếp xã hội' },
    { subcategory: 'extraversion',     code: 'average', bodyEn: 'comfortable in both social and solitary settings, adapting well to different environments',                bodyVi: 'thoải mái cả khi làm việc nhóm lẫn độc lập, dễ thích nghi với nhiều môi trường khác nhau' },
    { subcategory: 'extraversion',     code: 'low',     bodyEn: 'thoughtful and self-sufficient, preferring deeper one-on-one conversations over large groups',            bodyVi: 'sâu sắc và tự chủ, thích những cuộc trò chuyện có chiều sâu hơn là các nhóm đông người' },
    { subcategory: 'agreeableness',    code: 'high',    bodyEn: 'warm, empathetic and cooperative, naturally building strong relationships with others',                    bodyVi: 'ấm áp, đồng cảm và hợp tác, tự nhiên xây dựng được các mối quan hệ bền chặt với người khác' },
    { subcategory: 'agreeableness',    code: 'average', bodyEn: 'balanced between cooperation and assertiveness, working well in teams while maintaining independence',     bodyVi: 'cân bằng giữa tinh thần hợp tác và tính quyết đoán, làm việc hiệu quả trong nhóm nhưng vẫn duy trì sự độc lập' },
    { subcategory: 'agreeableness',    code: 'low',     bodyEn: 'direct and results-focused, bringing a competitive edge and critical thinking to challenges',              bodyVi: 'thẳng thắn và tập trung vào kết quả, mang lại tư duy cạnh tranh và phản biện trong công việc' },
    { subcategory: 'conscientiousness',code: 'high',    bodyEn: 'highly organised and disciplined, with a strong ability to plan and follow through on commitments',       bodyVi: 'rất có tổ chức và kỷ luật, với khả năng lập kế hoạch và thực hiện cam kết một cách xuất sắc' },
    { subcategory: 'conscientiousness',code: 'average', bodyEn: 'reasonably structured and dependable, balancing flexibility with a sense of responsibility',               bodyVi: 'có cấu trúc và đáng tin cậy ở mức hợp lý, cân bằng giữa sự linh hoạt và tinh thần trách nhiệm' },
    { subcategory: 'conscientiousness',code: 'low',     bodyEn: 'spontaneous and adaptable, bringing creativity and flexibility to new situations',                         bodyVi: 'tự phát và linh hoạt, mang lại sự sáng tạo và khả năng thích ứng trong các tình huống mới' },
    { subcategory: 'neuroticism',      code: 'high',    bodyEn: 'emotionally sensitive and deeply aware of the world around them, which drives empathy and attention to detail', bodyVi: 'nhạy cảm về mặt cảm xúc và ý thức sâu sắc về thế giới xung quanh, giúp phát triển sự đồng cảm và chú ý đến chi tiết' },
    { subcategory: 'neuroticism',      code: 'average', bodyEn: 'generally emotionally stable with occasional stress responses in challenging situations',                  bodyVi: 'nhìn chung ổn định về cảm xúc, với phản ứng căng thẳng nhất định trong những tình huống khó khăn' },
    { subcategory: 'neuroticism',      code: 'low',     bodyEn: 'calm and resilient under pressure, maintaining emotional stability even in demanding environments',        bodyVi: 'bình tĩnh và kiên cường trước áp lực, duy trì sự ổn định cảm xúc ngay cả trong môi trường đòi hỏi cao' },
    { subcategory: 'openness',         code: 'high',    bodyEn: 'imaginative and intellectually curious, with a passion for new ideas, cultures and creative thinking',    bodyVi: 'giàu trí tưởng tượng và ham học hỏi, với niềm đam mê với các ý tưởng mới, văn hóa và tư duy sáng tạo' },
    { subcategory: 'openness',         code: 'average', bodyEn: 'open to new experiences while also appreciating familiar and practical approaches',                        bodyVi: 'cởi mở với những trải nghiệm mới trong khi vẫn trân trọng các phương pháp quen thuộc và thực tế' },
    { subcategory: 'openness',         code: 'low',     bodyEn: 'practical and grounded, preferring clear facts and proven methods over abstract theories',                 bodyVi: 'thực tế và có căn cứ, ưu tiên các sự kiện rõ ràng và phương pháp đã được kiểm chứng hơn là lý thuyết trừu tượng' },
  ],

  ocean_narrative_template: [
    { code: 'default',
      bodyEn: 'This person is {e}. They are {a}. When it comes to organisation and reliability, they are {c}. Emotionally, they are {n}. In terms of intellectual curiosity, they are {o}.',
      bodyVi: 'Người này {e}. Họ {a}. Về mặt tổ chức và độ tin cậy, họ {c}. Về mặt cảm xúc, họ {n}. Về khả năng tư duy và sự tò mò trí tuệ, họ {o}.' },
  ],

  // ─── UI strings (was client/src/i18n/en.js + vi.js) ──────────────
  // The `code` matches the original i18n key 1:1 so Step 4 rewiring
  // is a straight find-replace from t('foo') to useUiString('foo').
  ui_string: [
    // ── common (buttons, generic actions, status words) ──
    { subcategory: 'common', code: 'close',          labelEn: 'Close',                labelVi: 'Đóng' },
    { subcategory: 'common', code: 'back',           labelEn: 'Back',                 labelVi: 'Quay lại' },
    { subcategory: 'common', code: 'cancel',         labelEn: 'Cancel',               labelVi: 'Hủy' },
    { subcategory: 'common', code: 'cancelBtn',      labelEn: 'Cancel',               labelVi: 'Hủy' },
    { subcategory: 'common', code: 'save',           labelEn: 'Save',                 labelVi: 'Lưu' },
    { subcategory: 'common', code: 'savingStatus',   labelEn: 'Saving...',            labelVi: 'Đang lưu...' },
    { subcategory: 'common', code: 'retry',          labelEn: 'Retry',                labelVi: 'Thử lại' },
    { subcategory: 'common', code: 'yes',            labelEn: 'Yes',                  labelVi: 'Có' },
    { subcategory: 'common', code: 'no',             labelEn: 'No',                   labelVi: 'Không' },
    { subcategory: 'common', code: 'loading',        labelEn: 'Loading...',           labelVi: 'Đang tải...' },
    { subcategory: 'common', code: 'skip',           labelEn: 'Skip',                 labelVi: 'Bỏ qua' },
    { subcategory: 'common', code: 'remove',         labelEn: 'Remove',               labelVi: 'Xóa' },
    { subcategory: 'common', code: 'prevBtn',        labelEn: 'Previous',             labelVi: 'Quay lại' },
    { subcategory: 'common', code: 'nextBtn',        labelEn: 'Next',                 labelVi: 'Tiếp tục' },
    { subcategory: 'common', code: 'selectDefault',  labelEn: 'Select...',            labelVi: 'Chọn' },
    { subcategory: 'common', code: 'fillMandatory',  labelEn: 'Fill mandatory fields', labelVi: 'Điền các trường bắt buộc' },
    { subcategory: 'common', code: 'unsavedChanges', labelEn: 'Unsaved changes',      labelVi: 'Chưa lưu thay đổi' },
    { subcategory: 'common', code: 'savedAt',        labelEn: 'Saved',                labelVi: 'Đã lưu' },
    { subcategory: 'common', code: 'loadingStudent', labelEn: 'Loading student data...', labelVi: 'Đang tải dữ liệu học sinh...' },
    { subcategory: 'common', code: 'loadFailed',     labelEn: 'Failed to load student data', labelVi: 'Tải dữ liệu học sinh thất bại' },

    // ── app_meta (app title, language) ──
    { subcategory: 'app_meta', code: 'languageLabel', labelEn: 'Language',                  labelVi: 'Ngôn ngữ' },
    { subcategory: 'app_meta', code: 'appTitle',      labelEn: 'StudyLink',                 labelVi: 'StudyLink' },
    { subcategory: 'app_meta', code: 'appSubtitle',   labelEn: 'Your going abroad index',   labelVi: 'Xem chỉ số xuất ngoại' },

    // ── home (landing page) ──
    { subcategory: 'home', code: 'homePrizeTitle',    labelEn: 'Lucky draw for Vinfast motorbike', labelVi: 'Dự thưởng xe máy điện Vinfast' },
    { subcategory: 'home', code: 'homePrizeSubtitle', labelEn: 'and many other feng shui gifts',   labelVi: 'và các quà tặng phong thủy khác' },
    { subcategory: 'home', code: 'takePhoto',         labelEn: 'Selfie time',                      labelVi: 'Chụp ảnh selfie' },

    // ── auth_login (email/phone login form) ──
    { subcategory: 'auth_login', code: 'emailLabel',       labelEn: 'Email Address',           labelVi: 'Địa chỉ Email' },
    { subcategory: 'auth_login', code: 'emailPlaceholder', labelEn: 'your.email@example.com',  labelVi: 'email.cuaban@example.com' },
    { subcategory: 'auth_login', code: 'phoneLabel',       labelEn: 'Phone Number',            labelVi: 'Số điện thoại' },
    { subcategory: 'auth_login', code: 'phonePlaceholder', labelEn: '+84 xxx xxx xxx',         labelVi: '+84 xxx xxx xxx' },
    { subcategory: 'auth_login', code: 'loginBtn',         labelEn: 'Start your adventure',    labelVi: 'Bắt đầu phiêu lưu' },
    { subcategory: 'auth_login', code: 'sendingOtp',       labelEn: 'Sending OTP...',          labelVi: 'Đang gửi mã OTP...' },
    { subcategory: 'auth_login', code: 'otpReceived',      labelEn: 'OTP received — auto-verifying...',          labelVi: 'Đã nhận mã OTP — đang xác minh tự động...' },
    { subcategory: 'auth_login', code: 'redirecting',      labelEn: 'Verified! Opening your profile...',         labelVi: 'Xác minh thành công! Đang mở hồ sơ của bạn...' },
    { subcategory: 'auth_login', code: 'checking',         labelEn: 'Checking...',             labelVi: 'Đang kiểm tra...' },
    { subcategory: 'auth_login', code: 'connecting',       labelEn: 'Connecting...',           labelVi: 'Đang kết nối...' },
    { subcategory: 'auth_login', code: 'qrScanned',        labelEn: 'QR code scanned. Select the platform:', labelVi: 'Đã quét mã QR. Chọn nền tảng:' },
    { subcategory: 'auth_login', code: 'fbNotice',         labelEn: 'This is a Facebook profile URL — it will be saved to your Facebook Profile field.', labelVi: 'Đây là link trang Facebook — sẽ được lưu vào ô Hồ sơ Facebook.' },

    // ── auth_errors ──
    { subcategory: 'auth_errors', code: 'emailRequired',        labelEn: 'Email is required',                 labelVi: 'Vui lòng nhập email' },
    { subcategory: 'auth_errors', code: 'phoneRequired',        labelEn: 'Phone number is required',          labelVi: 'Vui lòng nhập số điện thoại' },
    { subcategory: 'auth_errors', code: 'invalidEmail',         labelEn: 'Please enter a valid email address', labelVi: 'Vui lòng nhập địa chỉ email hợp lệ' },
    { subcategory: 'auth_errors', code: 'loginFieldsRequired',  labelEn: 'Please fill in all required fields', labelVi: 'Vui lòng điền đầy đủ các trường bắt buộc' },
    { subcategory: 'auth_errors', code: 'qrLoginFailed',        labelEn: 'QR login failed',                   labelVi: 'Đăng nhập QR thất bại' },
    { subcategory: 'auth_errors', code: 'otpFailed',            labelEn: 'Failed to send OTP',                labelVi: 'Gửi mã OTP thất bại' },
    { subcategory: 'auth_errors', code: 'loginCheckFailed',     labelEn: 'Login check failed. Please try again.', labelVi: 'Kiểm tra đăng nhập thất bại. Vui lòng thử lại.' },
    { subcategory: 'auth_errors', code: 'lockedOut',            labelEn: 'Too many failed OTP attempts. Please try again later.', labelVi: 'Quá nhiều lần nhập sai mã OTP. Vui lòng thử lại sau.' },

    // ── auth_otp (OTP verification step) ──
    { subcategory: 'auth_otp', code: 'verifyEmail',          labelEn: 'Verify Email',                     labelVi: 'Xác minh Email' },
    { subcategory: 'auth_otp', code: 'otpPrompt',            labelEn: 'Enter the 6-digit code sent to',   labelVi: 'Nhập mã 6 chữ số đã gửi đến' },
    { subcategory: 'auth_otp', code: 'otpPlaceholder',       labelEn: '000000',                            labelVi: '000000' },
    { subcategory: 'auth_otp', code: 'otpHint',              labelEn: 'Check your email for the 6-digit code, then paste it here', labelVi: 'Kiểm tra email để lấy mã 6 chữ số, sau đó dán vào đây' },
    { subcategory: 'auth_otp', code: 'enterCode',            labelEn: 'Please enter the 6-digit code',     labelVi: 'Vui lòng nhập mã 6 chữ số' },
    { subcategory: 'auth_otp', code: 'verifying',            labelEn: 'Verifying...',                      labelVi: 'Đang xác minh...' },
    { subcategory: 'auth_otp', code: 'verify',               labelEn: 'Verify',                            labelVi: 'Xác minh' },
    { subcategory: 'auth_otp', code: 'resendIn',             labelEn: 'Resend code in',                    labelVi: 'Gửi lại mã sau' },
    { subcategory: 'auth_otp', code: 'resendCode',           labelEn: 'Resend Code',                       labelVi: 'Gửi lại mã' },
    { subcategory: 'auth_otp', code: 'resendFailed',         labelEn: 'Failed to resend OTP',              labelVi: 'Gửi lại mã OTP thất bại' },
    { subcategory: 'auth_otp', code: 'backToLogin',          labelEn: 'Back to Login',                     labelVi: 'Quay lại Đăng nhập' },
    { subcategory: 'auth_otp', code: 'verificationFailed',   labelEn: 'Verification failed',               labelVi: 'Xác minh thất bại' },
    { subcategory: 'auth_otp', code: 'attemptsRemaining',    labelEn: 'attempts remaining',                labelVi: 'lần thử còn lại' },

    // ── account_status (duplicate/inactive record modals) ──
    { subcategory: 'account_status', code: 'statusActive',     labelEn: 'Active',                                              labelVi: 'Hoạt động' },
    { subcategory: 'account_status', code: 'statusInactive',   labelEn: 'Inactive',                                            labelVi: 'Vô hiệu hóa' },
    { subcategory: 'account_status', code: 'inactiveTitle',    labelEn: 'Account Deactivated',                                 labelVi: 'Tài khoản đã vô hiệu hóa' },
    { subcategory: 'account_status', code: 'inactiveMessage',  labelEn: 'Your email or phone matches a deactivated account. Would you like to create a new record instead?', labelVi: 'Email hoặc số điện thoại của bạn khớp với một tài khoản đã bị vô hiệu hóa. Bạn có muốn tạo hồ sơ mới không?' },
    { subcategory: 'account_status', code: 'createNewRecord',  labelEn: 'Create New Record',                                   labelVi: 'Tạo hồ sơ mới' },
    { subcategory: 'account_status', code: 'conflictTitle',    labelEn: 'Multiple Records Found',                              labelVi: 'Tìm thấy nhiều hồ sơ' },
    { subcategory: 'account_status', code: 'conflictMessage',  labelEn: 'Your email and phone match different existing records. Please select which record to keep active:', labelVi: 'Email và số điện thoại của bạn khớp với các hồ sơ khác nhau. Vui lòng chọn hồ sơ muốn giữ:' },
    { subcategory: 'account_status', code: 'conflictHint',     labelEn: 'The other active records will be deactivated. Only staff can reactivate them.', labelVi: 'Các hồ sơ hoạt động khác sẽ bị vô hiệu hóa. Chỉ nhân viên mới có thể kích hoạt lại.' },
    { subcategory: 'account_status', code: 'keepSelected',     labelEn: 'Keep Selected',                                       labelVi: 'Giữ hồ sơ đã chọn' },
    { subcategory: 'account_status', code: 'matchedBy',        labelEn: 'Matched by',                                          labelVi: 'Khớp theo' },
    { subcategory: 'account_status', code: 'noName',           labelEn: '(No name)',                                           labelVi: '(Chưa có tên)' },

    // ── nav_tabs ──
    { subcategory: 'nav_tabs', code: 'tabPersonal',         labelEn: 'Personal Details',  labelVi: 'Thông tin cá nhân' },
    { subcategory: 'nav_tabs', code: 'tabPersonalShort',    labelEn: 'Personal',          labelVi: 'Cá nhân' },
    { subcategory: 'nav_tabs', code: 'tabStudy',            labelEn: 'Study Information', labelVi: 'Thông tin học tập' },
    { subcategory: 'nav_tabs', code: 'tabStudyShort',       labelEn: 'Study',             labelVi: 'Học tập' },
    { subcategory: 'nav_tabs', code: 'tabAssessment',       labelEn: 'Read your index',   labelVi: 'Xem chỉ số' },
    { subcategory: 'nav_tabs', code: 'tabAssessmentShort',  labelEn: 'Index',             labelVi: 'Chỉ số' },
    { subcategory: 'nav_tabs', code: 'tabCareer',           labelEn: 'Personality/Career', labelVi: 'Tính cách/Nghề nghiệp' },
    { subcategory: 'nav_tabs', code: 'tabCareerShort',      labelEn: 'Personality',       labelVi: 'Tính cách' },
    { subcategory: 'nav_tabs', code: 'tabFamily',           labelEn: 'Family Contacts',   labelVi: 'Liên hệ gia đình' },
    { subcategory: 'nav_tabs', code: 'tabFamilyShort',      labelEn: 'Family',            labelVi: 'Gia đình' },
    { subcategory: 'nav_tabs', code: 'tabCounselor',        labelEn: 'Staff Follow-up',   labelVi: 'Nhân viên theo dõi' },
    { subcategory: 'nav_tabs', code: 'tabCounselorShort',   labelEn: 'Staff',             labelVi: 'Nhân viên' },
    { subcategory: 'nav_tabs', code: 'tabDocuments',        labelEn: 'Documents',         labelVi: 'Tài liệu' },
    { subcategory: 'nav_tabs', code: 'tabDocumentsShort',   labelEn: 'Documents',         labelVi: 'Tài liệu' },
    { subcategory: 'nav_tabs', code: 'tabComplete',         labelEn: 'Complete:',         labelVi: 'Hoàn thành:' },

    // ── personal_form ──
    { subcategory: 'personal_form', code: 'personalDetailsTitle',       labelEn: 'Personal Details',      labelVi: 'Thông Tin Cá Nhân' },
    { subcategory: 'personal_form', code: 'fullName',                   labelEn: 'Name',                  labelVi: 'Họ và tên' },
    { subcategory: 'personal_form', code: 'fullNamePlaceholder',        labelEn: 'Enter name',            labelVi: 'Nhập họ và tên' },
    { subcategory: 'personal_form', code: 'yearOfBirth',                labelEn: 'Year of Birth',         labelVi: 'Năm sinh' },
    { subcategory: 'personal_form', code: 'yearOfBirthPlaceholder',     labelEn: 'e.g. 1998',             labelVi: 'VD: 1998' },
    { subcategory: 'personal_form', code: 'yearOfBirthLabel',           labelEn: 'Year of Birth',         labelVi: 'Năm sinh' },
    { subcategory: 'personal_form', code: 'schoolEventLabel',           labelEn: 'Event/School',          labelVi: 'Sự kiện/Trường' },
    { subcategory: 'personal_form', code: 'schoolEventPlaceholder',     labelEn: 'Enter event/school',    labelVi: 'Thông tin sự kiện/trường tham dự' },
    { subcategory: 'personal_form', code: 'placeOfResidence',           labelEn: 'Residence',             labelVi: 'Nơi cư trú' },
    { subcategory: 'personal_form', code: 'placeOfResidencePlaceholder', labelEn: 'Select your province', labelVi: 'Chọn tỉnh/thành phố' },
    { subcategory: 'personal_form', code: 'preferredSocial',            labelEn: 'Social media',          labelVi: 'Mạng xã hội' },
    { subcategory: 'personal_form', code: 'preferredSocialPlaceholder', labelEn: 'Select your preferred platform', labelVi: 'Chọn nền tảng ưa thích' },
    { subcategory: 'personal_form', code: 'connectWithYou',             labelEn: 'Connect with us?',      labelVi: 'Bạn muốn kết nối?' },
    { subcategory: 'personal_form', code: 'studyPlansLabel',            labelEn: 'Dream',                 labelVi: 'Ước mơ' },
    { subcategory: 'personal_form', code: 'referralSource',             labelEn: 'Referral Source',       labelVi: 'Nguồn giới thiệu' },
    { subcategory: 'personal_form', code: 'referralSourcePlaceholder',  labelEn: 'How did you hear about us?', labelVi: 'Bạn biết đến chúng tôi từ đâu?' },

    // ── contact_form (preferred contact + medium selection) ──
    { subcategory: 'contact_form', code: 'contactDetailsLabel',     labelEn: 'Contact Details',                    labelVi: 'Thông tin liên hệ' },
    { subcategory: 'contact_form', code: 'selectMedium',            labelEn: 'Select medium...',                   labelVi: 'Chọn phương thức...' },
    { subcategory: 'contact_form', code: 'enterDetails',            labelEn: 'Scan your QR Code or enter {medium} details', labelVi: 'Nhập thông tin {medium}' },
    { subcategory: 'contact_form', code: 'selectMediumFirst',       labelEn: 'Select a medium first',              labelVi: 'Chọn phương thức trước' },
    { subcategory: 'contact_form', code: 'scanQrToFill',            labelEn: 'Scan QR to fill',                    labelVi: 'Quét QR để điền' },
    { subcategory: 'contact_form', code: 'emailField',              labelEn: 'Email',                              labelVi: 'Email' },
    { subcategory: 'contact_form', code: 'phoneField',              labelEn: 'Phone',                              labelVi: 'Điện thoại' },
    { subcategory: 'contact_form', code: 'facebookProfile',         labelEn: 'Facebook Profile',                   labelVi: 'Trang Facebook' },
    { subcategory: 'contact_form', code: 'facebookProfilePlaceholder', labelEn: 'Facebook profile URL',            labelVi: 'URL hồ sơ Facebook' },
    { subcategory: 'contact_form', code: 'contactDetailRequired',   labelEn: 'Enter contact detail',               labelVi: 'Nhập thông tin liên hệ' },

    // ── campaign_form ──
    { subcategory: 'campaign_form', code: 'campaignSection', labelEn: 'Event Information', labelVi: 'Thông tin sự kiện' },
    { subcategory: 'campaign_form', code: 'campaignType',    labelEn: 'Campaign Type',     labelVi: 'Loại chiến dịch' },
    { subcategory: 'campaign_form', code: 'campaignName',    labelEn: 'Event Name',        labelVi: 'Tên sự kiện' },
    { subcategory: 'campaign_form', code: 'campaignStart',   labelEn: 'Event Start Date',  labelVi: 'Ngày bắt đầu' },
    { subcategory: 'campaign_form', code: 'campaignEnd',     labelEn: 'Event End Date',    labelVi: 'Ngày kết thúc' },

    // ── study_form ──
    { subcategory: 'study_form', code: 'studyInfoTitle',     labelEn: 'Study Information',         labelVi: 'Thông Tin Học Tập' },
    { subcategory: 'study_form', code: 'destinationCountry', labelEn: 'Destination Country',       labelVi: 'Quốc gia yêu thích' },
    { subcategory: 'study_form', code: 'timeline',           labelEn: 'Timeline',                  labelVi: 'Thời gian dự kiến' },
    { subcategory: 'study_form', code: 'processApplication', labelEn: 'Process Application',       labelVi: 'Xử lý hồ sơ' },
    { subcategory: 'study_form', code: 'residencyProvince',  labelEn: 'Residency (Province/City)', labelVi: 'Nơi cư trú (Tỉnh/TP)' },

    // ── assessment_meta (titles, banners, buttons on the assessment page) ──
    { subcategory: 'assessment_meta', code: 'selfAssessmentTitle',     labelEn: 'Read your score',                                       labelVi: 'Xem chỉ số' },
    { subcategory: 'assessment_meta', code: 'liveScorePreview',        labelEn: 'Opportunity Preview:',                                  labelVi: 'Xem trước điểm:' },
    { subcategory: 'assessment_meta', code: 'calculating',             labelEn: 'Calculating...',                                        labelVi: 'Đang tính...' },
    { subcategory: 'assessment_meta', code: 'calculateRiskScore',      labelEn: 'Calculate your score',                                  labelVi: 'Tính chỉ số xuất ngoại' },
    { subcategory: 'assessment_meta', code: 'weightLabel',             labelEn: 'Weight:',                                               labelVi: '(Bỏ trọng số)' },
    { subcategory: 'assessment_meta', code: 'assessmentBannerPrompt',  labelEn: 'Complete the questionnaire for your index calculation', labelVi: 'Hoàn thành bảng câu hỏi để tính chỉ số' },
    { subcategory: 'assessment_meta', code: 'assessmentBannerResult',  labelEn: 'Studying abroad worldwide at top schools',              labelVi: 'Du học tại các trường hàng đầu thế giới' },

    // ── assessment_fields (field NAMES on the assessment page) ──
    { subcategory: 'assessment_fields', code: 'budget',               labelEn: 'Budget',                       labelVi: 'Ngân sách' },
    { subcategory: 'assessment_fields', code: 'scholarshipDemand',    labelEn: 'Scholarship Demand',           labelVi: 'Nhu cầu Học bổng' },
    { subcategory: 'assessment_fields', code: 'englishLevel',         labelEn: 'English Level',                labelVi: 'Trình độ tiếng Anh' },
    { subcategory: 'assessment_fields', code: 'gpa',                  labelEn: 'GPA',                          labelVi: 'Điểm trung bình (GPA)' },
    { subcategory: 'assessment_fields', code: 'immigrationHistory',   labelEn: 'Immigration History',          labelVi: 'Lịch sử di trú' },
    { subcategory: 'assessment_fields', code: 'sponsorIncome',        labelEn: 'Sponsor Income',               labelVi: 'Thu nhập người bảo lãnh' },
    { subcategory: 'assessment_fields', code: 'incomeEvidence',       labelEn: 'Income Evidence',              labelVi: 'Chứng minh thu nhập' },
    { subcategory: 'assessment_fields', code: 'studyPlanGap',         labelEn: 'Study Plan & Gap Years',       labelVi: 'Kế hoạch du học và Khoảng trống' },
    { subcategory: 'assessment_fields', code: 'ultimateObjective',    labelEn: 'Ultimate Objective',           labelVi: 'Mục tiêu cuối' },

    // ── assessment_field_desc (helper text under each field) ──
    { subcategory: 'assessment_field_desc', code: 'budgetDesc',             labelEn: 'Annual available budget for studying abroad', labelVi: 'Ngân sách du học cho mỗi năm' },
    { subcategory: 'assessment_field_desc', code: 'scholarshipDemandDesc',  labelEn: 'Minimum level of scholarship needed',         labelVi: 'Mức học bổng tối thiểu' },
    { subcategory: 'assessment_field_desc', code: 'englishLevelDesc',       labelEn: 'Current English proficiency',                 labelVi: 'Năng lực tiếng Anh hiện tại' },
    { subcategory: 'assessment_field_desc', code: 'gpaDesc',                labelEn: 'Academic performance (GPA on 10-point scale)', labelVi: 'Kết quả học tập (thang điểm 10)' },
    { subcategory: 'assessment_field_desc', code: 'immigrationHistoryDesc', labelEn: 'Visa and travel background',                  labelVi: 'Lịch sử đi nước ngoài và visa' },
    { subcategory: 'assessment_field_desc', code: 'sponsorIncomeDesc',      labelEn: "Sponsor's annual income",                     labelVi: 'Thu nhập hàng năm của người bảo lãnh' },
    { subcategory: 'assessment_field_desc', code: 'incomeEvidenceDesc',     labelEn: 'Percentage of income that can be documented', labelVi: 'Tỉ lệ thu nhập có chứng từ minh bạch' },
    { subcategory: 'assessment_field_desc', code: 'studyPlanGapDesc',       labelEn: 'Relevance of study plan and gap between studies (if still in high school: select 5)', labelVi: 'Du học ngành liên quan và khoảng trống giữa các bậc học (nếu đang học trung học: chọn 5)' },
    { subcategory: 'assessment_field_desc', code: 'ultimateObjectiveDesc',  labelEn: 'Primary goal for studying abroad',            labelVi: 'Mục tiêu chính của việc du học' },

    // ── career_fit (OCEAN questionnaire UI chrome) ──
    { subcategory: 'career_fit', code: 'careerFitTitle',         labelEn: 'Career Fit',                                                             labelVi: 'Phù hợp nghề nghiệp' },
    { subcategory: 'career_fit', code: 'careerFitSubtitle',      labelEn: 'Rate each statement on a scale of 1 (Strongly Disagree) to 5 (Strongly Agree)', labelVi: 'Đánh giá mỗi câu theo thang điểm từ 1 (Hoàn toàn không đồng ý) đến 5 (Hoàn toàn đồng ý)' },
    { subcategory: 'career_fit', code: 'careerFitCalculate',     labelEn: 'Calculate My Profile',                                                   labelVi: 'Tính toán hồ sơ của tôi' },
    { subcategory: 'career_fit', code: 'careerFitCalculating',   labelEn: 'Calculating...',                                                         labelVi: 'Đang tính toán...' },
    { subcategory: 'career_fit', code: 'careerFitComplete',      labelEn: 'Complete all 15 questions and click Calculate to see your personality profile.', labelVi: 'Hoàn thành 15 câu hỏi và nhấn Tính toán để xem hồ sơ tính cách của bạn.' },
    { subcategory: 'career_fit', code: 'careerFitAnsweredOf',    labelEn: '/15 questions answered',                                                 labelVi: '/15 câu đã trả lời' },
    { subcategory: 'career_fit', code: 'careerFitBestCareers',   labelEn: 'Best Career Paths',                                                      labelVi: 'Hướng nghề nghiệp tốt nhất' },
    { subcategory: 'career_fit', code: 'careerFitFlexPotential', labelEn: 'Flex Potential',                                                         labelVi: 'Tiềm năng phát triển' },
    { subcategory: 'career_fit', code: 'careerFitFlexDesc',      labelEn: 'With development these traits could unlock additional archetypes:',     labelVi: 'Khi phát triển, các đặc điểm này có thể mở ra các hình mẫu bổ sung:' },

    // ── family_form ──
    { subcategory: 'family_form', code: 'familyContactSection',  labelEn: 'Family Contact',          labelVi: 'Liên hệ gia đình' },
    { subcategory: 'family_form', code: 'parentType',            labelEn: 'Parent',                  labelVi: 'Phụ huynh' },
    { subcategory: 'family_form', code: 'parentMother',          labelEn: 'Mother',                  labelVi: 'Mẹ' },
    { subcategory: 'family_form', code: 'parentFather',          labelEn: 'Father',                  labelVi: 'Bố' },
    { subcategory: 'family_form', code: 'familyContactsTitle',   labelEn: 'Family Contacts',         labelVi: 'Liên Hệ Gia Đình' },
    { subcategory: 'family_form', code: 'motherDetails',         labelEn: "Mother's details",        labelVi: 'Thông tin của Mẹ' },
    { subcategory: 'family_form', code: 'fatherDetails',         labelEn: "Father's details",        labelVi: 'Thông tin của Bố' },
    { subcategory: 'family_form', code: 'familyEmail',           labelEn: 'Email',                   labelVi: 'Email' },
    { subcategory: 'family_form', code: 'familyFullName',        labelEn: 'Full Name',               labelVi: 'Họ và tên' },
    { subcategory: 'family_form', code: 'familyContactMedium',   labelEn: 'Contact Medium',          labelVi: 'Phương thức liên hệ' },
    { subcategory: 'family_form', code: 'familyContactDetail',   labelEn: 'Contact Detail',          labelVi: 'Chi tiết liên hệ' },
    { subcategory: 'family_form', code: 'contactDetailPlaceholder', labelEn: 'Contact detail',       labelVi: 'Chi tiết liên hệ' },
    { subcategory: 'family_form', code: 'motherEmailPlaceholder', labelEn: 'mother@example.com',     labelVi: 'me@example.com' },
    { subcategory: 'family_form', code: 'motherNamePlaceholder', labelEn: "Mother's full name",      labelVi: 'Họ và tên của Mẹ' },
    { subcategory: 'family_form', code: 'fatherEmailPlaceholder', labelEn: 'father@example.com',     labelVi: 'bo@example.com' },
    { subcategory: 'family_form', code: 'fatherNamePlaceholder', labelEn: "Father's full name",      labelVi: 'Họ và tên của Bố' },

    // ── sweepstake ──
    { subcategory: 'sweepstake', code: 'sweepstakeTitle',  labelEn: 'Sweepstake/Lottery Details', labelVi: 'Chi tiết Xổ số / Rút thăm' },
    { subcategory: 'sweepstake', code: 'entered',          labelEn: '✅ Entered',                 labelVi: '✅ Đã tham gia' },
    { subcategory: 'sweepstake', code: 'withdraw',         labelEn: 'Withdraw',                   labelVi: 'Rút lui' },
    { subcategory: 'sweepstake', code: 'enterNow',         labelEn: 'Enter Now',                  labelVi: 'Tham gia ngay' },

    // ── counselor (Staff Follow-up tab) ──
    { subcategory: 'counselor', code: 'counselorFeedbackTitle', labelEn: 'Staff Follow-up',     labelVi: 'Nhân viên theo dõi' },
    { subcategory: 'counselor', code: 'marketingSection',       labelEn: 'Marketing',           labelVi: 'Marketing' },
    { subcategory: 'counselor', code: 'leadSource',             labelEn: 'Lead Source',         labelVi: 'Nguồn khách hàng' },
    { subcategory: 'counselor', code: 'interaction',            labelEn: 'Interaction',         labelVi: 'Mức độ tương tác' },
    { subcategory: 'counselor', code: 'noNotesYet',             labelEn: 'No notes yet',        labelVi: 'Chưa có ghi chú' },
    { subcategory: 'counselor', code: 'addNotePrefix',          labelEn: 'Add a',               labelVi: 'Thêm ghi chú' },
    { subcategory: 'counselor', code: 'addNoteSuffix',          labelEn: 'note...',             labelVi: '...' },
    { subcategory: 'counselor', code: 'counselingLabel',        labelEn: 'Counseling',          labelVi: 'Tư vấn' },
    { subcategory: 'counselor', code: 'caseOfficerLabel',       labelEn: 'Case Officer',        labelVi: 'Nhân viên xử lý hồ sơ' },
    { subcategory: 'counselor', code: 'managementLabel',        labelEn: 'Marketing',           labelVi: 'Nhân viên Tiếp thị' },

    // ── documents ──
    { subcategory: 'documents', code: 'documentsTitle',       labelEn: 'Documents',                                                                                            labelVi: 'Tài Liệu' },
    { subcategory: 'documents', code: 'documentsDescription', labelEn: 'A list of all existing documents are retrieved and listed. User can click on the Document ID Hyperlink to display it in a separate window.', labelVi: 'Danh sách tất cả tài liệu đã được tải lên. Bấm vào mã tài liệu để xem trong cửa sổ mới.' },
    { subcategory: 'documents', code: 'viewInDrive',          labelEn: 'View all files in Google Drive',                                                                       labelVi: 'Xem tất cả tệp trong Google Drive' },
    { subcategory: 'documents', code: 'loadingDocuments',     labelEn: 'Loading documents...',                                                                                 labelVi: 'Đang tải tài liệu...' },
    { subcategory: 'documents', code: 'noDocumentsYet',       labelEn: 'No documents uploaded yet. Click + to add one.',                                                       labelVi: 'Chưa có tài liệu. Bấm + để thêm.' },
    { subcategory: 'documents', code: 'typeColumn',           labelEn: 'Type',                                                                                                 labelVi: 'Loại' },
    { subcategory: 'documents', code: 'docIdColumn',          labelEn: 'Document ID',                                                                                          labelVi: 'Mã tài liệu' },
    { subcategory: 'documents', code: 'descColumn',           labelEn: 'Document Description',                                                                                 labelVi: 'Mô tả tài liệu' },
    { subcategory: 'documents', code: 'dateColumn',           labelEn: 'Date/Time stamp',                                                                                      labelVi: 'Ngày/Giờ' },
    { subcategory: 'documents', code: 'autoGenerated',        labelEn: 'Auto-generated',                                                                                       labelVi: 'Tự động tạo' },
    { subcategory: 'documents', code: 'onUpload',             labelEn: 'On upload',                                                                                            labelVi: 'Khi tải lên' },
    { subcategory: 'documents', code: 'descPlaceholder',      labelEn: 'e.g. Financial Statements',                                                                            labelVi: 'VD: Báo cáo tài chính' },
    { subcategory: 'documents', code: 'autoType',             labelEn: 'Auto',                                                                                                 labelVi: 'Tự động' },
    { subcategory: 'documents', code: 'dropFileHere',         labelEn: 'Drop a file here',                                                                                     labelVi: 'Kéo thả tệp vào đây' },
    { subcategory: 'documents', code: 'orClickBrowse',        labelEn: 'or click to browse',                                                                                   labelVi: 'hoặc bấm để chọn' },
    { subcategory: 'documents', code: 'supportedFormats',     labelEn: 'Supports: Word, PDF, Excel, PowerPoint, Text (max 10 MB)',                                             labelVi: 'Hỗ trợ: Word, PDF, Excel, PowerPoint, Text (tối đa 10 MB)' },
    { subcategory: 'documents', code: 'uploading',            labelEn: 'Uploading...',                                                                                         labelVi: 'Đang tải lên...' },
    { subcategory: 'documents', code: 'uploadDocument',       labelEn: 'Upload Document',                                                                                      labelVi: 'Tải lên tài liệu' },
    { subcategory: 'documents', code: 'descRequired',         labelEn: 'Description is required',                                                                              labelVi: 'Vui lòng nhập mô tả' },
    { subcategory: 'documents', code: 'fileTooLarge',         labelEn: 'File exceeds 10 MB size limit',                                                                        labelVi: 'Tệp vượt quá 10 MB' },

    // ── score_breakdown (score detail table) ──
    { subcategory: 'score_breakdown', code: 'scoreBreakdown', labelEn: 'Score Breakdown', labelVi: 'Chi tiết điểm số' },
    { subcategory: 'score_breakdown', code: 'colField',       labelEn: 'Field',           labelVi: 'Tiêu chí' },
    { subcategory: 'score_breakdown', code: 'colValue',       labelEn: 'Value',           labelVi: 'Giá trị' },
    { subcategory: 'score_breakdown', code: 'colTier',        labelEn: 'Tier',            labelVi: 'Mức' },
    { subcategory: 'score_breakdown', code: 'colScore',       labelEn: 'Score',           labelVi: 'Điểm' },
    { subcategory: 'score_breakdown', code: 'colTotal',       labelEn: 'Total',           labelVi: 'Tổng' },
  ],
};

// ── Run the seed ─────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  const tableCheck = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'lookup_values'"
  );
  if (tableCheck.rows.length === 0) {
    console.error('ERROR: lookup_values table not found. Run migration_create_lookups.sql first.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cleanup
    let cleanupTotal = 0;
    for (const [category, codes] of Object.entries(OBSOLETE_CODES)) {
      if (codes.length === 0) continue;
      const r = await client.query(
        `DELETE FROM lookup_values WHERE category = $1 AND code = ANY($2::text[]) RETURNING id`,
        [category, codes]
      );
      cleanupTotal += r.rowCount;
      if (r.rowCount > 0) console.log(`  [cleanup] deleted ${r.rowCount} obsolete rows from ${category}`);
    }
    for (const category of FULL_RESET_CATEGORIES) {
      const r = await client.query(`DELETE FROM lookup_values WHERE category = $1 RETURNING id`, [category]);
      cleanupTotal += r.rowCount;
      if (r.rowCount > 0) console.log(`  [cleanup] wiped ${r.rowCount} rows from ${category} for full re-insert`);
    }
    if (cleanupTotal > 0) console.log('');

    let totalInserted = 0, totalUpdated = 0;
    for (const [category, rows] of Object.entries(SEED)) {
      let inserted = 0, updated = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const res = await client.query(
          `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, body_en, body_vi, sort_order, meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (category, COALESCE(subcategory, ''), code) DO UPDATE
             SET label_en   = EXCLUDED.label_en,
                 label_vi   = EXCLUDED.label_vi,
                 body_en    = EXCLUDED.body_en,
                 body_vi    = EXCLUDED.body_vi,
                 sort_order = EXCLUDED.sort_order,
                 meta       = EXCLUDED.meta
           RETURNING (xmax = 0) AS inserted`,
          [category, r.subcategory || null, r.code, r.labelEn || null, r.labelVi || null, r.bodyEn || null, r.bodyVi || null, i, JSON.stringify(r.meta || {})]
        );
        if (res.rows[0].inserted) inserted++; else updated++;
      }
      totalInserted += inserted;
      totalUpdated  += updated;
      console.log(`  ${category.padEnd(26)} ${rows.length.toString().padStart(3)} rows  (+${inserted} new, ~${updated} updated)`);
    }

    await client.query('COMMIT');
    console.log('');
    console.log(`✓ Done. ${totalInserted} inserted, ${totalUpdated} updated across ${Object.keys(SEED).length} categories.`);
    if (cleanupTotal > 0) console.log(`  (${cleanupTotal} obsolete rows removed during cleanup)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
