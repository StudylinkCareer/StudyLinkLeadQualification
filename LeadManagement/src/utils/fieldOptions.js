// src/utils/fieldOptions.js
// Dropdown option sets for the Lead / Student screens, mirroring the legacy
// LeadDetail constants so the new screens offer the same choices. Keyed by the
// camelCase field name. Staff-assignment fields are populated at runtime from
// the active staff list, and note topics from the `note_topic` lookup.

export const LEAD_STATUSES = [
  'New', 'Not contactable', 'Engaged', 'Vetted', 'Met with customer and family',
  'Proposal', 'Family negotiation/review', 'Contracted', 'Lost', 'Nurturing', 'Archived',
];

export const DEGREE_LEVELS = ['Foundation', 'Diploma', 'Bachelor', 'Masters', 'PhD', 'Other'];

export const FIELD_OPTIONS = {
  leadStatus:         LEAD_STATUSES,
  degreeLevel:        DEGREE_LEVELS,
  confidence:         ['Low (0-30%)', 'Medium (31-60%)', 'High (61-90%)', 'Committed (91-100%)'],
  englishLevel:       ['Beginner', 'IELTS 4-4.5', 'IELTS 5-5.5', 'IELTS 6-6.5', 'IELTS 7+'],
  gpa:                ['< 6.5', '6.5-6.9', '7-7.9', '8-8.9', '9+'],
  budget:             ['< 300M VND', '300-500M VND', '500-800M VND', '800M-1B VND', '1-1.5B VND'],
  scholarshipDemand:  ['100% scholarship', '60-90% scholarship', '30-50% scholarship', '20-25% scholarship', 'No scholarship needed'],
  immigrationHistory: ['Visa rejection (self)', 'Rejection/overstay (family)', 'No travel history', 'Travelled in Asia', 'Travelled to Western countries'],
  sponsorIncome:      ['< 300M VND', '300-500M VND', '500-800M VND', '800M-1B VND', '1-1.5B VND'],
  incomeEvidence:     ['0% documented', '30-35% documented', '50% documented', '70-75% documented', '100% documented'],
  studyPlanGap:       ['Different major, 5+ year gap', 'Different major, 2-5 year gap', 'Same major, 2-5 year gap', 'Same major, < 2 year gap', 'Same major, no gap'],
  ultimateObjective:  ['Migration only', 'Work only', 'Study but work more', 'Study for migration pathway', 'Study only'],
  studyPlans:         ['Study Abroad', 'English Summer Camp', 'Study in Vietnam', 'Do not study'],
  timeline:           ['Next 6 months', '6-12 months', '12-24 months', '24-36 months', '36+ months'],
  leadSource:         ['Databases', 'FB-Zalo-GG-TikTok ads', 'School outreach', 'Subagent referrals', 'Ex-client'],
};

// Fields whose options are the active staff list (resolved at runtime).
export const STAFF_FIELDS = new Set(['counselor', 'seniorCounselor', 'presales', 'marketingStaff']);

// Status → chip colour. Covers both lead statuses and the derived STUDENT statuses
// (New / In progress / Enrolled / Farming / Returning / Transferred); 'New' is shared.
export const STATUS_COLORS = {
  // Lead statuses
  'New': '#3b82f6',
  'Not contactable': '#9ca3af',
  'Engaged': '#06b6d4',
  'Vetted': '#8b5cf6',
  'Met with customer and family': '#0ea5e9',
  'Proposal': '#f59e0b',
  'Family negotiation/review': '#f97316',
  'Contracted': '#16a34a',
  'Lost': '#dc2626',
  'Nurturing': '#14b8a6',
  'Archived': '#6b7280',
  'Existing': '#16a34a',
  // Student statuses
  'In progress': '#0891b2',
  'Enrolled': '#15803d',
  'Farming': '#b45309',
  'Returning': '#7c3aed',
  'Transferred': '#db2777',
};
export function statusColor(s) { return STATUS_COLORS[s] || '#6b7280'; }
