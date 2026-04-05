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
  }
  if (!formData.studyPlans) {
    missing.push('Study Plans');
    errorFields.studyPlans = 'Required';
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
      // Case 1 — nothing entered for either parent
      missing.push('Required fields missing for either Mother or Father: Full Name, Phone and Email');
    } else if (motherStarted && !motherComplete && !fatherComplete && !fatherStarted) {
      // Case 2 — only mother partially entered
      if (!motherFields.name) { missing.push('Mother Full Name'); errorFields.motherFullName = 'Required'; }
      if (!motherFields.phone) { missing.push('Mother Phone'); errorFields.motherPhone = 'Required'; }
      if (!motherFields.email) { missing.push('Mother Email'); errorFields.motherEmail = 'Required'; }
    } else if (fatherStarted && !fatherComplete && !motherComplete && !motherStarted) {
      // Case 2 — only father partially entered
      if (!fatherFields.name) { missing.push('Father Full Name'); errorFields.fatherFullName = 'Required'; }
      if (!fatherFields.phone) { missing.push('Father Phone'); errorFields.fatherPhone = 'Required'; }
      if (!fatherFields.email) { missing.push('Father Email'); errorFields.fatherEmail = 'Required'; }
    } else {
      // Both partially entered — show both
      if (!motherFields.name) { missing.push('Mother Full Name'); errorFields.motherFullName = 'Required'; }
      if (!motherFields.phone) { missing.push('Mother Phone'); errorFields.motherPhone = 'Required'; }
      if (!motherFields.email) { missing.push('Mother Email'); errorFields.motherEmail = 'Required'; }
      if (!fatherFields.name) { missing.push('Father Full Name'); errorFields.fatherFullName = 'Required'; }
      if (!fatherFields.phone) { missing.push('Father Phone'); errorFields.fatherPhone = 'Required'; }
      if (!fatherFields.email) { missing.push('Father Email'); errorFields.fatherEmail = 'Required'; }
    }
  }

  return { complete, missing, errorFields };
}

export function checkSelfAssessmentPrereqs(formData) {
  return { unlocked: true, missing: [] };
}