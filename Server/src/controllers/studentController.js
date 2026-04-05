// server/src/controllers/studentController.js
// CHANGES: Added deactivateRecords() endpoint.

const Student = require('../models/Student');
const { calculateRiskScore } = require('../utils/riskCalculator');

async function register(req, res, next) {
  try {
    const { email, phone, fullName, contactMediums, studyPlans, leadSource,
            yearOfBirth, residency, schoolEvent, socialConsent,
            preferredSocial, phoneCountryCode, contactMedium1 } = req.body;

    // Check for duplicates (skip when both are empty — QR-only login)
    if (email || phone) {
      const dupes = await Student.checkDuplicates(email, phone);
      // Only block if there's an ACTIVE duplicate
      const activeDupes = dupes.filter((d) => (d.status || 'Active') === 'Active');
      if (activeDupes.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'A record with this email or phone already exists',
          existing: activeDupes[0],
        });
      }
    }

    const student = await Student.create({
      email,
      phone,
      fullName:         fullName         || '',
      phoneCountryCode: phoneCountryCode || '',
      yearOfBirth:      yearOfBirth      || '',
      residency:        residency        || '',
      schoolEvent:      schoolEvent      || '',
      socialConsent:    socialConsent    || '',
      preferredSocial:  preferredSocial  || '',
      contactMedium1:   contactMedium1   || '',
      contactMediums:   contactMediums   || [],
      contactDetails:   req.body.contactDetails || {},
      studyPlans:       studyPlans       || '',
      leadSource:       leadSource       || '',
    });

    // Store uniqueId in session
    req.session.uniqueId = student.uniqueId;

    res.status(201).json({ success: true, data: student });
  } catch (err) {
    next(err);
  }
}

async function getStudent(req, res, next) {
  try {
    const { id } = req.params;
    const result = id.includes('@')
      ? await Student.findByEmail(id)
      : await Student.findById(id);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    res.json({ success: true, data: result.data });
  } catch (err) {
    next(err);
  }
}

async function getByEmail(req, res, next) {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email query parameter required' });
    }

    const result = await Student.findByEmail(email);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    req.session.uniqueId = result.data.uniqueId;

    res.json({ success: true, data: result.data });
  } catch (err) {
    next(err);
  }
}

async function updateStudent(req, res, next) {
  try {
    const { id } = req.params;
    console.log(`[UPDATE] Student ${id} — fields:`, Object.keys(req.body).join(', '));
    console.log(`[UPDATE] Values:`, JSON.stringify(req.body));
    const updated = await Student.update(id, req.body);
    console.log(`[UPDATE] Saved OK — updatedAt: ${updated.updatedAt}`);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(`[UPDATE] FAILED for ${req.params.id}:`, err.message);
    if (err.message === 'Student not found') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
}

async function checkDuplicate(req, res, next) {
  try {
    const { email, phone } = req.query;
    const dupes = await Student.checkDuplicates(email, phone);
    res.json({ success: true, exists: dupes.length > 0, matches: dupes });
  } catch (err) {
    next(err);
  }
}

// ─── NEW: deactivateRecords — counselor or system can deactivate records ───
async function deactivateRecords(req, res, next) {
  try {
    const { uniqueIds } = req.body;
    if (!uniqueIds || !Array.isArray(uniqueIds) || uniqueIds.length === 0) {
      return res.status(400).json({ success: false, error: 'uniqueIds array is required' });
    }

    const result = await Student.deactivateRecords(uniqueIds);
    console.log(`[DEACTIVATE] Records deactivated:`, result.deactivated);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function calculateRisk(req, res, next) {
  try {
    const { id } = req.params;
    const result = await Student.findById(id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const riskResult = calculateRiskScore(result.data);

    await Student.update(id, {
      riskScore: String(riskResult.totalScore),
      stoneTier: riskResult.stoneTier,
    });

    res.json({ success: true, data: riskResult });
  } catch (err) {
    next(err);
  }
}

const MAX_IMAGE_BASE64_LENGTH = 2.7 * 1024 * 1024;

function validateBase64Image(data, label) {
  if (!data || typeof data !== 'string') return null;
  if (data.length > MAX_IMAGE_BASE64_LENGTH) {
    return `${label} exceeds 2 MB size limit`;
  }
  if (!data.startsWith('data:image/')) {
    return `${label} is not a valid image data URL`;
  }
  return null;
}

async function uploadPhotos(req, res, next) {
  try {
    const { id } = req.params;
    const { headshot, qrCodeImage, additionalQrImages } = req.body;

    const errors = [
      headshot && validateBase64Image(headshot, 'Headshot'),
      qrCodeImage && validateBase64Image(qrCodeImage, 'QR code image'),
      ...(Array.isArray(additionalQrImages) ? additionalQrImages.map((img, i) => validateBase64Image(img, `Additional QR image ${i + 1}`)) : []),
    ].filter(Boolean);

    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: errors[0] });
    }

    const result = await Student.uploadPhotos(id, { headshot, qrCodeImage, additionalQrImages });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Student not found') {
      return res.status(404).json({ success: false, error: err.message });
    }
    next(err);
  }
}

async function searchStudents(req, res, next) {
  try {
    const { q } = req.query;
    const sheets = require('../services/dataService');
    const results = await sheets.searchStudents(q || '');
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  getStudent,
  getByEmail,
  updateStudent,
  checkDuplicate,
  deactivateRecords,  // ← NEW
  calculateRisk,
  uploadPhotos,
  searchStudents,
};
