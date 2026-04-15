// server/src/controllers/studentController.js
// CHANGES:
//   - Added deactivateRecords() endpoint
//   - register() now accepts and saves campaignType, campaignName, campaignStart, campaignEnd

const Student = require('../models/Student');
const { calculateRiskScore } = require('../utils/riskCalculator');

async function register(req, res, next) {
  try {
    const { email, phone, fullName, contactMediums, studyPlans, leadSource,
            yearOfBirth, residency, schoolEvent, socialConsent,
            preferredSocial, phoneCountryCode, contactMedium1,
            campaignType, campaignName, campaignStart, campaignEnd } = req.body;

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
      campaignType:     campaignType     || '',
      campaignName:     campaignName     || '',
      campaignStart:    campaignStart    || null,
      campaignEnd:      campaignEnd      || null,
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

const { calculateOceanScores, generateNarrative } = (() => {
  function calculateOceanScores(responses) {
    const q = responses;
    return {
      extraversion:      (q[1]||0) + (6-(q[6]||0))  + (q[11]||0),
      agreeableness:     (q[2]||0) + (6-(q[7]||0))  + (q[12]||0),
      conscientiousness: (q[3]||0) + (6-(q[8]||0))  + (q[13]||0),
      neuroticism:       (q[4]||0) + (6-(q[9]||0))  + (q[14]||0),
      openness:          (q[5]||0) + (6-(q[10]||0)) + (q[15]||0),
    };
  }
  function getLevel(score) {
    if (score >= 12) return 'high';
    if (score >= 7)  return 'average';
    return 'low';
  }
  function generateNarrative(scores) {
    const { extraversion, agreeableness, conscientiousness, neuroticism, openness } = scores;
    const traits = {
      extraversion: {
        high: 'highly energetic and sociable, thriving in group settings',
        average: 'comfortable in both social and solitary settings',
        low: 'thoughtful and self-sufficient, preferring deeper one-on-one conversations',
      },
      agreeableness: {
        high: 'warm, empathetic and cooperative, naturally building strong relationships',
        average: 'balanced between cooperation and assertiveness',
        low: 'direct and results-focused, bringing a competitive edge to challenges',
      },
      conscientiousness: {
        high: 'highly organised and disciplined, with a strong ability to plan and follow through',
        average: 'reasonably structured and dependable, balancing flexibility with responsibility',
        low: 'spontaneous and adaptable, bringing creativity to new situations',
      },
      neuroticism: {
        high: 'emotionally sensitive and deeply aware of the world around them',
        average: 'generally emotionally stable with occasional stress responses',
        low: 'calm and resilient under pressure, maintaining emotional stability',
      },
      openness: {
        high: 'imaginative and intellectually curious, with a passion for new ideas',
        average: 'open to new experiences while also appreciating familiar approaches',
        low: 'practical and grounded, preferring clear facts and proven methods',
      },
    };
    return `This person is ${traits.extraversion[getLevel(extraversion)]}. They are ${traits.agreeableness[getLevel(agreeableness)]}. When it comes to organisation, they are ${traits.conscientiousness[getLevel(conscientiousness)]}. Emotionally, they are ${traits.neuroticism[getLevel(neuroticism)]}. In terms of intellectual curiosity, they are ${traits.openness[getLevel(openness)]}.`;
  }
  return { calculateOceanScores, generateNarrative };
})();

async function calculateOcean(req, res, next) {
  try {
    const { id } = req.params;
    const result = await Student.findById(id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const data = result.data;

    // Build responses object from stored q1-q15
    const responses = {};
    for (let i = 1; i <= 15; i++) {
      responses[i] = data[`oceanQ${i}`] ? Number(data[`oceanQ${i}`]) : 0;
    }

    const scores    = calculateOceanScores(responses);
    const narrative = generateNarrative(scores);

    // Save scores and narrative to DB
    await Student.update(id, {
      oceanExtraversion:      scores.extraversion,
      oceanAgreeableness:     scores.agreeableness,
      oceanConscientiousness: scores.conscientiousness,
      oceanNeuroticism:       scores.neuroticism,
      oceanOpenness:          scores.openness,
      oceanNarrative:         narrative,
    });

    res.json({ success: true, data: { scores, narrative } });
  } catch (err) {
    next(err);
  }
}


async function calculateRisk(req, res, next) {
  try {
    const { id } = req.params;
    const result = await Student.findById(id);

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
    const results = await Student.search(q || '');
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
  deactivateRecords,
  calculateRisk,
  calculateOcean,
  uploadPhotos,
  searchStudents,
};
