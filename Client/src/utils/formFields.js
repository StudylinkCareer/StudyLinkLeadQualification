// Field definitions for Student Information and Self Assessment forms
// Original exports remain unchanged for backward compatibility.
// Use getTranslatedAssessmentFields(language) etc. for translated UI labels.

import { t } from '../i18n';

export const CONTACT_MEDIUMS = ['Phone', 'Zalo', 'Facebook', 'Messenger', 'WhatsApp', 'Email', 'Instagram', 'Threads', 'TikTok', 'Line', 'Telegram', 'Viber', 'YouTube', 'Skype'];
export const PHONE_MEDIUMS = ['Phone', 'WhatsApp', 'Zalo', 'Viber', 'Telegram', 'Line'];
export const EMAIL_MEDIUMS = ['Email', 'Facebook', 'Instagram', 'Threads', 'TikTok', 'YouTube', 'Skype'];
export const DUAL_MEDIUMS = ['Facebook', 'Instagram', 'Threads'];

export const COUNTRY_CODES = [
  { code: '+84', country: 'Vietnam' },
  { code: '+61', country: 'Australia' },
  { code: '+1', country: 'Canada' },
  { code: '+86', country: 'China' },
  { code: '+420', country: 'Czech Republic' },
  { code: '+45', country: 'Denmark' },
  { code: '+358', country: 'Finland' },
  { code: '+33', country: 'France' },
  { code: '+49', country: 'Germany' },
  { code: '+36', country: 'Hungary' },
  { code: '+353', country: 'Ireland' },
  { code: '+81', country: 'Japan' },
  { code: '+82', country: 'South Korea' },
  { code: '+60', country: 'Malaysia' },
  { code: '+31', country: 'Netherlands' },
  { code: '+64', country: 'New Zealand' },
  { code: '+47', country: 'Norway' },
  { code: '+63', country: 'Philippines' },
  { code: '+65', country: 'Singapore' },
  { code: '+46', country: 'Sweden' },
  { code: '+41', country: 'Switzerland' },
  { code: '+886', country: 'Taiwan' },
  { code: '+66', country: 'Thailand' },
  { code: '+44', country: 'UK' },
  { code: '+1', country: 'USA' },
];

export const STUDY_PLANS = ['Do not study', 'Study in Vietnam', 'Study Abroad', 'English Summer School'];

export const LEAD_SOURCES = [
  'Databases',
  'FB-Zalo-GG-TikTok ads',
  'School outreach',
  'Subagent referrals',
  'Ex-client',
];

export const INTERACTIONS = [
  'Only left contact',
  'Queries',
  'Fill lead form partly',
  'Fill lead form fully',
  'Call in-Walk in',
];

export const DESTINATION_COUNTRIES = [
  'Australia', 'Canada', 'Germany', 'Japan', 'South Korea',
  'New Zealand', 'Singapore', 'United Kingdom', 'United States',
  'France', 'Netherlands', 'Ireland', 'Switzerland', 'Finland',
  'Denmark', 'Sweden', 'Norway', 'Czech Republic', 'Hungary',
  'Malaysia', 'Thailand', 'Philippines', 'China', 'Taiwan',
];

// Grouped and sorted for the destination country selector (max 3 selections)
export const DESTINATION_COUNTRIES_GROUPED = [
  {
    region: 'Australasia',
    countries: ['Australia', 'New Zealand'].sort(),
  },
  {
    region: 'Europe',
    countries: [
      'Czech Republic', 'Denmark', 'Finland', 'France', 'Germany',
      'Hungary', 'Ireland', 'Netherlands', 'Norway', 'Sweden',
      'Switzerland', 'United Kingdom',
    ].sort(),
  },
  {
    region: 'North America',
    countries: ['Canada', 'United States'].sort(),
  },
  {
    region: 'Asia',
    countries: [
      'China', 'Japan', 'Malaysia', 'Philippines',
      'Singapore', 'South Korea', 'Taiwan', 'Thailand',
    ].sort(),
  },
];

export const TIMELINES = [
  'Next 6 months',
  '6-12 months',
  '12-24 months',
  '24-36 months',
  '36+ months',
];

export const PROCESS_APPLICATION = [
  "I'll do it myself",
  'I have an agent',
  'Talking to agents',
  'Relatives in Vietnam will help',
  'Relatives overseas will help',
];

export const VIETNAM_PROVINCES = [
  'An Giang', 'Ba Ria-Vung Tau', 'Bac Giang', 'Bac Kan', 'Bac Lieu',
  'Bac Ninh', 'Ben Tre', 'Binh Dinh', 'Binh Duong', 'Binh Phuoc',
  'Binh Thuan', 'Ca Mau', 'Can Tho', 'Cao Bang', 'Da Nang',
  'Dak Lak', 'Dak Nong', 'Dien Bien', 'Dong Nai', 'Dong Thap',
  'Gia Lai', 'Ha Giang', 'Ha Nam', 'Ha Noi', 'Ha Tinh',
  'Hai Duong', 'Hai Phong', 'Hau Giang', 'Ho Chi Minh City', 'Hoa Binh',
  'Hung Yen', 'Khanh Hoa', 'Kien Giang', 'Kon Tum', 'Lai Chau',
  'Lam Dong', 'Lang Son', 'Lao Cai', 'Long An', 'Nam Dinh',
  'Nghe An', 'Ninh Binh', 'Ninh Thuan', 'Phu Tho', 'Phu Yen',
  'Quang Binh', 'Quang Nam', 'Quang Ngai', 'Quang Ninh', 'Quang Tri',
  'Soc Trang', 'Son La', 'Tay Ninh', 'Thai Binh', 'Thai Nguyen',
  'Thanh Hoa', 'Thua Thien-Hue', 'Tien Giang', 'Tra Vinh', 'Tuyen Quang',
  'Vinh Long', 'Vinh Phuc', 'Yen Bai',
];

export const SELF_ASSESSMENT_FIELDS = [
  {
    key: 'budget',
    label: 'Budget',
    description: 'Annual available budget for studying abroad',
    weight: 4,
    tiers: [
      { value: '< 300M VND', label: '< 300M VND' },
      { value: '300-500M VND', label: '300-500M VND' },
      { value: '500-800M VND', label: '500-800M VND' },
      { value: '800M-1B VND', label: '800M-1B VND' },
      { value: '1-1.5B VND', label: '1-1.5B VND' },
    ],
  },
  {
    key: 'scholarshipDemand',
    label: 'Scholarship Demand',
    description: 'Level of scholarship needed',
    weight: 3,
    tiers: [
      { value: '100% scholarship', label: '100%' },
      { value: '60-90% scholarship', label: '60-90%' },
      { value: '30-50% scholarship', label: '30-50%' },
      { value: '20-25% scholarship', label: '20-25%' },
      { value: 'No scholarship needed', label: 'None needed' },
    ],
  },
  {
    key: 'englishLevel',
    label: 'English Level',
    description: 'Current English proficiency',
    weight: 4,
    tiers: [
      { value: 'Beginner', label: 'Beginner' },
      { value: 'IELTS 4-4.5', label: 'IELTS 4-4.5' },
      { value: 'IELTS 5-5.5', label: 'IELTS 5-5.5' },
      { value: 'IELTS 6-6.5', label: 'IELTS 6-6.5' },
      { value: 'IELTS 7+', label: 'IELTS 7+' },
    ],
  },
  {
    key: 'gpa',
    label: 'GPA',
    description: 'Academic performance (GPA on 10-point scale)',
    weight: 2,
    tiers: [
      { value: '< 6.5', label: '< 6.5' },
      { value: '6.5-6.9', label: '6.5-6.9' },
      { value: '7-7.9', label: '7-7.9' },
      { value: '8-8.9', label: '8-8.9' },
      { value: '9+', label: '9+' },
    ],
  },
  {
    key: 'immigrationHistory',
    label: 'Immigration History',
    description: 'Visa and travel background',
    weight: 3,
    tiers: [
      { value: 'Visa rejection (self)', label: 'Visa rejection (self)' },
      { value: 'Rejection/overstay (family)', label: 'Rejection/overstay (family)' },
      { value: 'No travel history', label: 'No travel history' },
      { value: 'Travelled in Asia', label: 'Travelled in Asia' },
      { value: 'Travelled to Western countries', label: 'Travelled West' },
    ],
  },
  {
    key: 'sponsorIncome',
    label: 'Sponsor Income',
    description: "Sponsor's annual income",
    weight: 4,
    tiers: [
      { value: '< 300M VND', label: '< 300M VND' },
      { value: '300-500M VND', label: '300-500M VND' },
      { value: '500-800M VND', label: '500-800M VND' },
      { value: '800M-1B VND', label: '800M-1B VND' },
      { value: '1-1.5B VND', label: '1-1.5B VND' },
    ],
  },
  {
    key: 'incomeEvidence',
    label: 'Income Evidence',
    description: 'Percentage of income that can be documented',
    weight: 4,
    tiers: [
      { value: '0% documented', label: '0%' },
      { value: '30-35% documented', label: '30-35%' },
      { value: '50% documented', label: '50%' },
      { value: '70-75% documented', label: '70-75%' },
      { value: '100% documented', label: '100%' },
    ],
  },
  {
    key: 'studyPlanGap',
    label: 'Study Plan & Gap Years',
    description: 'Relevance of study plan and gap between studies',
    weight: 3,
    tiers: [
      { value: 'Different major, 5+ year gap', label: 'Diff major, 5+ yr gap' },
      { value: 'Different major, 2-5 year gap', label: 'Diff major, 2-5 yr gap' },
      { value: 'Same major, 2-5 year gap', label: 'Same major, 2-5 yr gap' },
      { value: 'Same major, < 2 year gap', label: 'Same major, < 2 yr gap' },
      { value: 'Same major, no gap', label: 'Same major, no gap' },
    ],
  },
  {
    key: 'ultimateObjective',
    label: 'Ultimate Objective',
    description: 'Primary goal for studying abroad',
    weight: 2,
    tiers: [
      { value: 'Migration only', label: 'Migration only' },
      { value: 'Work only', label: 'Work only' },
      { value: 'Study but work more', label: 'Study but work more' },
      { value: 'Study for migration pathway', label: 'Study for migration' },
      { value: 'Study only', label: 'Study only' },
    ],
  },
];

export const SCORED_INFO_FIELDS = {
  leadSource: { weight: 2, field: 'Lead Source' },
  interaction: { weight: 1, field: 'Interaction' },
  destinationCountry: { weight: 2, field: 'Destination Country' },
  timeline: { weight: 3, field: 'Timeline' },
  residency: { weight: 3, field: 'Residency' },
};

export const STONE_TIERS = [
  { name: 'Quartz', min: 40, max: 75, package: 'Standard', color: '#9CA3AF' },
  { name: 'Agate', min: 76, max: 105, package: 'Silver/Economy', color: '#78716C' },
  { name: 'Sapphire', min: 106, max: 135, package: 'Gold/Premium', color: '#2563EB' },
  { name: 'Ruby', min: 136, max: 165, package: 'Platinum/Business', color: '#DC2626' },
  { name: 'Diamond', min: 166, max: 200, package: 'Diamond/First Class', color: '#8B5CF6' },
];

// ─── Translation helpers ──────────────────────────────────────────
// IMPORTANT: `value` fields are NEVER translated (they're stored in the DB).
// Only `label` and `description` shown in the UI are translated.

/**
 * Returns translated Self Assessment fields for the UI.
 */
export function getTranslatedAssessmentFields(language) {
  return SELF_ASSESSMENT_FIELDS.map((field) => ({
    ...field,
    label: t(field.key, language),
    description: t(`${field.key}Desc`, language),
    tiers: field.tiers.map((tier) => ({
      ...tier,
      label: t(`${field.key}_tier_${tier.value}`, language),
    })),
  }));
}

/**
 * Returns translated dropdown options as { value, label } pairs.
 * The `value` stays in English for DB storage; `label` is translated for display.
 */
export function getTranslatedOptions(fieldKey, language) {
  const mapping = {
    studyPlan: { values: STUDY_PLANS, translationKey: 'studyPlanOptions' },
    leadSource: { values: LEAD_SOURCES, translationKey: 'leadSourceOptions' },
    interaction: { values: INTERACTIONS, translationKey: 'interactionOptions' },
    timeline: { values: TIMELINES, translationKey: 'timelineOptions' },
    processApplication: { values: PROCESS_APPLICATION, translationKey: 'processApplicationOptions' },
  };

  const config = mapping[fieldKey];
  if (!config) return [];

  const translatedLabels = t(config.translationKey, language);

  return config.values.map((value, i) => ({
    value,
    label: Array.isArray(translatedLabels) ? translatedLabels[i] : value,
  }));
}
