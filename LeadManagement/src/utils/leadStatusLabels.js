// LeadManagement/src/utils/leadStatusLabels.js
// Central source of truth for lead status values and translated labels.
// DB stores the English value; UI shows the language-appropriate label.

export const LEAD_STATUSES = [
  'New',
  'Not contactable',
  'Engaged',
  'Vetted',
  'Met with customer and family',
  'Proposal',
  'Family negotiation/review',
  'Contracted',
  'Lost',
  'Nurturing',
  'Archived',
];

export const LEAD_STATUS_LABELS = {
  en: {
    'New': 'New',
    'Not contactable': 'Not contactable',
    'Engaged': 'Engaged',
    'Vetted': 'Vetted',
    'Met with customer and family': 'Met with customer and family',
    'Proposal': 'Proposal',
    'Family negotiation/review': 'Family negotiation/review',
    'Contracted': 'Contracted',
    'Lost': 'Lost',
    'Nurturing': 'Nurturing',
    'Archived': 'Archived',
  },
  vi: {
    'New': 'Mới',
    'Not contactable': 'Không thể liên lạc',
    'Engaged': 'Đang tương tác',
    'Vetted': 'Đã kiểm tra',
    'Met with customer and family': 'Đã gặp khách hàng và gia đình',
    'Proposal': 'Đề xuất',
    'Family negotiation/review': 'Thương lượng/xem xét với gia đình',
    'Contracted': 'Đã ký hợp đồng',
    'Lost': 'Thất bại',
    'Nurturing': 'Chăm sóc',
    'Archived': 'Lưu trữ',
  },
};

// Which statuses count as "active" (not Contracted/Lost/Archived) for filters & dashboards
export const ACTIVE_LEAD_STATUSES = [
  'New',
  'Not contactable',
  'Engaged',
  'Vetted',
  'Met with customer and family',
  'Proposal',
  'Family negotiation/review',
  'Nurturing',
];

// Short CSS class suffix for each status, for .badge--* styling
export const LEAD_STATUS_CSS_CLASS = {
  'New': 'new',
  'Not contactable': 'not-contactable',
  'Engaged': 'engaged',
  'Vetted': 'vetted',
  'Met with customer and family': 'met',
  'Proposal': 'proposal',
  'Family negotiation/review': 'family-review',
  'Contracted': 'contracted',
  'Lost': 'lost',
  'Nurturing': 'nurturing',
  'Archived': 'archived',
};

// Helper: returns translated label for a status (with fallback)
export function labelFor(status, language = 'en') {
  return LEAD_STATUS_LABELS[language]?.[status] || status || '';
}