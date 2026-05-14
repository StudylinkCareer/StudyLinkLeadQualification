// client/src/utils/validation.js
//
// CHANGES:
//   - Added EMAIL_RE format check on every email field (student + family)
//   - Added yearOfBirth range check (1980-2018, integer only)

// Reasonable RFC-friendly email regex — catches obvious garbage without
// rejecting valid edge cases. Anchored both ends.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Year of birth permitted range — anyone born outside this window is either
// a typo or doesn't fit the LQ business profile (students aged ~7 to 45).
export const YOB_MIN = 1980;
export const YOB_MAX = 2018;

export function isValidEmail(email) {
  if (!email) return false;
  return EMAIL_RE.test(email.trim());
}

export function isValidYearOfBirth(yob) {
  if (!yob) return false;
  const n = parseInt(String(yob).trim(), 10);
  if (isNaN(n) || !/^\d+$/.test(String(yob).trim())) return false;
  return n >= YOB_MIN && n <= YOB_MAX;
}

export function checkMandatoryFields(formData) {
  const missing = [];
  const errorFields = {};

  if (!formData.fullName?.trim()) {
    missing.push('Full Name');
    errorFields.fullName = 'Required';
  }
  if (!formData.phone?.trim()) {
    missing.push('Phone Number');
    errorFields.phone = 'Required';
  }
  if (!formData.email?.trim()) {
    missing.push('Email Address');
    errorFields.email = 'Required';
  } else if (!isValidEmail(formData.email)) {
    missing.push('Email Address (invalid format)');
    errorFields.email = 'Invalid email format';
  }
  if (!formData.studyPlans) {
    missing.push('Study Plans');
    errorFields.studyPlans = 'Required';
  }

  // Year of birth — if it's set, validate format + range.
  // (Mandatory enforcement of presence is handled on the Home page;
  // here we only catch out-of-range values that snuck in via QR / import.)
  if (formData.yearOfBirth && !isValidYearOfBirth(formData.yearOfBirth)) {
    missing.push(`Year of Birth must be a year between ${YOB_MIN} and ${YOB_MAX}`);
    errorFields.yearOfBirth = `Must be ${YOB_MIN}-${YOB_MAX}`;
  }

  // Referral Source is mandatory only when campaign data exists
  // (matches the conditional rendering of the Event/Campaign block in PersonalDetailsTab).
  const campaignVisible =
    formData.campaignType || formData.campaignName || formData.campaignStart;
  if (campaignVisible && !formData.referralSource?.trim()) {
    missing.push('Referral Source');
    errorFields.referralSource = 'Required';
  }

  return { complete: missing.length === 0, missing, errorFields };
}

export function checkFamilyMandatoryFields(formData) {
  const errorFields = {};

  const motherFields = {
    name: formData.motherFullName?.trim(),
    phone: formData.motherPhone?.trim(),
    email: formData.motherEmail?.trim(),
  };

  const fatherFields = {
    name: formData.fatherFullName?.trim(),
    phone: formData.fatherPhone?.trim(),
    email: formData.fatherEmail?.trim(),
  };

  const motherComplete = !!(motherFields.name && motherFields.phone && motherFields.email);
  const fatherComplete = !!(fatherFields.name && fatherFields.phone && fatherFields.email);
  const complete = motherComplete || fatherComplete;

  const missing = [];

  if (!complete) {
    const motherStarted = !!(motherFields.name || motherFields.phone || motherFields.email);
    const fatherStarted = !!(fatherFields.name || fatherFields.phone || fatherFields.email);

    if (!motherStarted && !fatherStarted) {
      missing.push('Required fields missing for either Mother or Father: Full Name, Phone and Email');
    } else if (motherStarted && !motherComplete && !fatherComplete && !fatherStarted) {
      if (!motherFields.name)  { missing.push('Mother Full Name'); errorFields.motherFullName = 'Required'; }
      if (!motherFields.phone) { missing.push('Mother Phone');     errorFields.motherPhone    = 'Required'; }
      if (!motherFields.email) { missing.push('Mother Email');     errorFields.motherEmail    = 'Required'; }
    } else if (fatherStarted && !fatherComplete && !motherComplete && !motherStarted) {
      if (!fatherFields.name)  { missing.push('Father Full Name'); errorFields.fatherFullName = 'Required'; }
      if (!fatherFields.phone) { missing.push('Father Phone');     errorFields.fatherPhone    = 'Required'; }
      if (!fatherFields.email) { missing.push('Father Email');     errorFields.fatherEmail    = 'Required'; }
    } else {
      if (!motherFields.name)  { missing.push('Mother Full Name'); errorFields.motherFullName = 'Required'; }
      if (!motherFields.phone) { missing.push('Mother Phone');     errorFields.motherPhone    = 'Required'; }
      if (!motherFields.email) { missing.push('Mother Email');     errorFields.motherEmail    = 'Required'; }
      if (!fatherFields.name)  { missing.push('Father Full Name'); errorFields.fatherFullName = 'Required'; }
      if (!fatherFields.phone) { missing.push('Father Phone');     errorFields.fatherPhone    = 'Required'; }
      if (!fatherFields.email) { missing.push('Father Email');     errorFields.fatherEmail    = 'Required'; }
    }
  }

  // Also validate email FORMAT for any parent email that's been entered.
  // (Even if the section is "complete" by presence, a bad address should be flagged.)
  if (motherFields.email && !isValidEmail(motherFields.email)) {
    missing.push('Mother Email (invalid format)');
    errorFields.motherEmail = 'Invalid email format';
  }
  if (fatherFields.email && !isValidEmail(fatherFields.email)) {
    missing.push('Father Email (invalid format)');
    errorFields.fatherEmail = 'Invalid email format';
  }

  return { complete: complete && missing.length === 0, missing, errorFields };
}

export function checkSelfAssessmentPrereqs(formData) {
  return { unlocked: true, missing: [] };
}
