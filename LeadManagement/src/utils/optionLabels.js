// src/utils/optionLabels.js
// -----------------------------------------------------------------------------
// Translation maps for DROPDOWN OPTION VALUES (not UI chrome).
//
// Key design principle:
//   - The English string is the CANONICAL value stored in the database.
//   - This file maps that canonical value to a translated DISPLAY label.
//   - Filters, sorting, and comparisons always use the canonical English value.
//   - Users see the display label (bilingual, with English in parens).
//
// How to use:
//   import { optLabel, optLabelBilingual } from '../utils/optionLabels';
//   optLabel('Study Abroad', 'studyPlans', 'vi')       → 'Du học'
//   optLabelBilingual('Study Abroad', 'studyPlans', 'vi') → 'Du học (Study Abroad)'
//
// NATIVE SPEAKER REVIEW: Flag any awkward phrasing to Rhod. Many terms were
// picked for clarity over perfect register — please review before field use.
// -----------------------------------------------------------------------------

// Each group maps: English canonical value → Vietnamese display label.
// English-to-English is implicit (we just return the key for 'en').
export const OPTION_LABELS_VI = {

  // ── Confidence (Lead Status section) ────────────────────────
  confidence: {
    'Low (0-30%)':            'Thấp (0-30%)',
    'Medium (31-60%)':        'Trung bình (31-60%)',
    'High (61-90%)':          'Cao (61-90%)',
    'Committed (91-100%)':    'Cam kết (91-100%)',
  },

  // ── English Levels ──────────────────────────────────────────
  // IELTS is a brand; we translate "Beginner" but leave IELTS as-is.
  englishLevel: {
    'Beginner':               'Mới bắt đầu',
    'IELTS 4-4.5':            'IELTS 4-4.5',
    'IELTS 5-5.5':            'IELTS 5-5.5',
    'IELTS 6-6.5':            'IELTS 6-6.5',
    'IELTS 7+':               'IELTS 7+',
  },

  // ── GPA — numeric, stays the same ───────────────────────────
  gpa: {
    '< 6.5':                  '< 6.5',
    '6.5-6.9':                '6.5-6.9',
    '7-7.9':                  '7-7.9',
    '8-8.9':                  '8-8.9',
    '9+':                     '9+',
  },

  // ── Budget (VND amounts) ────────────────────────────────────
  budget: {
    '< 300M VND':             'Dưới 300 triệu VND',
    '300-500M VND':           '300-500 triệu VND',
    '500-800M VND':           '500-800 triệu VND',
    '800M-1B VND':            '800 triệu - 1 tỷ VND',
    '1-1.5B VND':             '1 - 1.5 tỷ VND',
  },

  // ── Scholarship Demand ──────────────────────────────────────
  scholarshipDemand: {
    '100% scholarship':       'Học bổng 100%',
    '60-90% scholarship':     'Học bổng 60-90%',
    '30-50% scholarship':     'Học bổng 30-50%',
    '20-25% scholarship':     'Học bổng 20-25%',
    'No scholarship needed':  'Không cần học bổng',
  },

  // ── Immigration History ─────────────────────────────────────
  immigrationHistory: {
    'Visa rejection (self)':                  'Từng bị từ chối visa (bản thân)',
    'Rejection/overstay (family)':            'Từ chối/quá hạn (gia đình)',
    'No travel history':                      'Chưa từng đi nước ngoài',
    'Travelled in Asia':                      'Đã đi các nước châu Á',
    'Travelled to Western countries':         'Đã đi các nước phương Tây',
  },

  // ── Sponsor Income (same format as budget) ──────────────────
  sponsorIncome: {
    '< 300M VND':             'Dưới 300 triệu VND',
    '300-500M VND':           '300-500 triệu VND',
    '500-800M VND':           '500-800 triệu VND',
    '800M-1B VND':            '800 triệu - 1 tỷ VND',
    '1-1.5B VND':             '1 - 1.5 tỷ VND',
  },

  // ── Income Evidence ─────────────────────────────────────────
  incomeEvidence: {
    '0% documented':          'Không có chứng từ',
    '30-35% documented':      '30-35% có chứng từ',
    '50% documented':         '50% có chứng từ',
    '70-75% documented':      '70-75% có chứng từ',
    '100% documented':        '100% có chứng từ',
  },

  // ── Study Plan Gap ──────────────────────────────────────────
  studyPlanGap: {
    'Different major, 5+ year gap':   'Khác ngành, nghỉ hơn 5 năm',
    'Different major, 2-5 year gap':  'Khác ngành, nghỉ 2-5 năm',
    'Same major, 2-5 year gap':       'Cùng ngành, nghỉ 2-5 năm',
    'Same major, < 2 year gap':       'Cùng ngành, nghỉ dưới 2 năm',
    'Same major, no gap':             'Cùng ngành, không gián đoạn',
  },

  // ── Ultimate Objective ──────────────────────────────────────
  ultimateObjective: {
    'Migration only':                 'Chỉ di cư',
    'Work only':                      'Chỉ làm việc',
    'Study but work more':            'Học nhưng làm việc nhiều hơn',
    'Study for migration pathway':    'Học để đi định cư',
    'Study only':                     'Chỉ học',
  },

  // ── Study Plans ─────────────────────────────────────────────
  studyPlans: {
    'Study Abroad':                   'Du học',
    'English Summer Camp':            'Trại hè tiếng Anh',
    'Study in Vietnam':               'Học trong nước',
    'Do not study':                   'Không học',
  },

  // ── Timeline ────────────────────────────────────────────────
  timeline: {
    'Next 6 months':                  '6 tháng tới',
    '6-12 months':                    '6-12 tháng',
    '12-24 months':                   '12-24 tháng',
    '24-36 months':                   '24-36 tháng',
    '36+ months':                     'Trên 36 tháng',
  },

  // ── Interaction ─────────────────────────────────────────────
  interaction: {
    'Only left contact':              'Chỉ để lại liên hệ',
    'Queries':                        'Có câu hỏi',
    'Fill lead form partly':          'Điền một phần biểu mẫu',
    'Fill lead form fully':           'Điền đầy đủ biểu mẫu',
    'Call in-Walk in':                'Gọi điện - Đến trực tiếp',
  },

  // ── Lead Source ─────────────────────────────────────────────
  // Brand/platform names stay English. Descriptive terms translated.
  leadSource: {
    'Databases':                      'Cơ sở dữ liệu',
    'FB-Zalo-GG-TikTok ads':          'Quảng cáo FB-Zalo-GG-TikTok',
    'School outreach':                'Tiếp cận trường học',
    'Subagent referrals':             'Giới thiệu từ đại lý phụ',
    'Ex-client':                      'Khách hàng cũ',
  },
};

/**
 * Return a translated label for an option value.
 * @param {string} value    - canonical English value (e.g. 'Study Abroad')
 * @param {string} group    - group key from OPTION_LABELS_VI (e.g. 'studyPlans')
 * @param {string} language - 'en' or 'vi'
 * @returns {string} translated label, or the input value if no translation found
 */
export function optLabel(value, group, language = 'vi') {
  if (!value) return value;
  if (language === 'en') return value;
  const map = OPTION_LABELS_VI[group];
  if (!map) return value;
  return map[value] !== undefined ? map[value] : value;
}

/**
 * Return a bilingual label: "Translation (English)".
 * Handy for dropdowns and badges where data integrity matters.
 * When language is 'en', just returns the English value (no duplication).
 *
 * @param {string} value    - canonical English value
 * @param {string} group    - group key
 * @param {string} language - 'en' or 'vi'
 * @returns {string} "Translation (English)" or just English
 */
export function optLabelBilingual(value, group, language = 'vi') {
  if (!value) return value;
  if (language === 'en') return value;
  const translated = optLabel(value, group, language);
  // If no translation exists (translated === value), don't duplicate it.
  if (translated === value) return value;
  return `${translated} (${value})`;
}

/**
 * Helper to build a dropdown's <option> element value/label pair.
 * Usage:
 *   {STUDY_PLAN_OPTS.map(v => (
 *     <option key={v} value={v}>{optLabelBilingual(v, 'studyPlans', lang)}</option>
 *   ))}
 *
 * The `value` attribute always stays English (canonical), so form submissions
 * and filters work regardless of the current language.
 */
