// server/src/controllers/studentController.js

const Student = require('../models/Student');
const { calculateRiskScore } = require('../utils/riskCalculator');

async function register(req, res, next) {
  try {
    const { email, phone, fullName, contactMediums, studyPlans, leadSource,
            yearOfBirth, residency, schoolEvent, socialConsent,
            preferredSocial, phoneCountryCode, contactMedium1,
            campaignType, campaignName, campaignStart, campaignEnd, 
            referralSource } = req.body;

    if (email || phone) {
      const dupes = await Student.checkDuplicates(email, phone);
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
      referralSource:   referralSource   || '',   // ← ADD THIS LINE
    });

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
    if (!result) return res.status(404).json({ success: false, error: 'Student not found' });
    res.json({ success: true, data: result.data });
  } catch (err) { next(err); }
}

async function getByEmail(req, res, next) {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'Email query parameter required' });
    const result = await Student.findByEmail(email);
    if (!result) return res.status(404).json({ success: false, error: 'Student not found' });
    req.session.uniqueId = result.data.uniqueId;
    res.json({ success: true, data: result.data });
  } catch (err) { next(err); }
}

async function updateStudent(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await Student.update(id, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.message === 'Student not found') return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
}

async function checkDuplicate(req, res, next) {
  try {
    const { email, phone } = req.query;
    const dupes = await Student.checkDuplicates(email, phone);
    res.json({ success: true, exists: dupes.length > 0, matches: dupes });
  } catch (err) { next(err); }
}

async function deactivateRecords(req, res, next) {
  try {
    const { uniqueIds } = req.body;
    if (!uniqueIds || !Array.isArray(uniqueIds) || uniqueIds.length === 0)
      return res.status(400).json({ success: false, error: 'uniqueIds array is required' });
    const result = await Student.deactivateRecords(uniqueIds);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── Bilingual OCEAN narrative phrases ──────────────────────────
const NARRATIVE_PHRASES = {
  en: {
    extraversion: {
      high:    'highly energetic and sociable, thriving in group settings and social interactions',
      average: 'comfortable in both social and solitary settings, adapting well to different environments',
      low:     'thoughtful and self-sufficient, preferring deeper one-on-one conversations over large groups',
    },
    agreeableness: {
      high:    'warm, empathetic and cooperative, naturally building strong relationships with others',
      average: 'balanced between cooperation and assertiveness, working well in teams while maintaining independence',
      low:     'direct and results-focused, bringing a competitive edge and critical thinking to challenges',
    },
    conscientiousness: {
      high:    'highly organised and disciplined, with a strong ability to plan and follow through on commitments',
      average: 'reasonably structured and dependable, balancing flexibility with a sense of responsibility',
      low:     'spontaneous and adaptable, bringing creativity and flexibility to new situations',
    },
    neuroticism: {
      high:    'emotionally sensitive and deeply aware of the world around them, which drives empathy and attention to detail',
      average: 'generally emotionally stable with occasional stress responses in challenging situations',
      low:     'calm and resilient under pressure, maintaining emotional stability even in demanding environments',
    },
    openness: {
      high:    'imaginative and intellectually curious, with a passion for new ideas, cultures and creative thinking',
      average: 'open to new experiences while also appreciating familiar and practical approaches',
      low:     'practical and grounded, preferring clear facts and proven methods over abstract theories',
    },
    template: (e, a, c, n, o) =>
      `This person is ${e}. They are ${a}. When it comes to organisation and reliability, they are ${c}. Emotionally, they are ${n}. In terms of intellectual curiosity, they are ${o}.`,
  },
  vi: {
    extraversion: {
      high:    'rất năng động và hòa đồng, phát huy tốt nhất trong môi trường tập thể và giao tiếp xã hội',
      average: 'thoải mái cả khi làm việc nhóm lẫn độc lập, dễ thích nghi với nhiều môi trường khác nhau',
      low:     'sâu sắc và tự chủ, thích những cuộc trò chuyện có chiều sâu hơn là các nhóm đông người',
    },
    agreeableness: {
      high:    'ấm áp, đồng cảm và hợp tác, tự nhiên xây dựng được các mối quan hệ bền chặt với người khác',
      average: 'cân bằng giữa tinh thần hợp tác và tính quyết đoán, làm việc hiệu quả trong nhóm nhưng vẫn duy trì sự độc lập',
      low:     'thẳng thắn và tập trung vào kết quả, mang lại tư duy cạnh tranh và phản biện trong công việc',
    },
    conscientiousness: {
      high:    'rất có tổ chức và kỷ luật, với khả năng lập kế hoạch và thực hiện cam kết một cách xuất sắc',
      average: 'có cấu trúc và đáng tin cậy ở mức hợp lý, cân bằng giữa sự linh hoạt và tinh thần trách nhiệm',
      low:     'tự phát và linh hoạt, mang lại sự sáng tạo và khả năng thích ứng trong các tình huống mới',
    },
    neuroticism: {
      high:    'nhạy cảm về mặt cảm xúc và ý thức sâu sắc về thế giới xung quanh, giúp phát triển sự đồng cảm và chú ý đến chi tiết',
      average: 'nhìn chung ổn định về cảm xúc, với phản ứng căng thẳng nhất định trong những tình huống khó khăn',
      low:     'bình tĩnh và kiên cường trước áp lực, duy trì sự ổn định cảm xúc ngay cả trong môi trường đòi hỏi cao',
    },
    openness: {
      high:    'giàu trí tưởng tượng và ham học hỏi, với niềm đam mê với các ý tưởng mới, văn hóa và tư duy sáng tạo',
      average: 'cởi mở với những trải nghiệm mới trong khi vẫn trân trọng các phương pháp quen thuộc và thực tế',
      low:     'thực tế và có căn cứ, ưu tiên các sự kiện rõ ràng và phương pháp đã được kiểm chứng hơn là lý thuyết trừu tượng',
    },
    template: (e, a, c, n, o) =>
      `Người này ${e}. Họ ${a}. Về mặt tổ chức và độ tin cậy, họ ${c}. Về mặt cảm xúc, họ ${n}. Về khả năng tư duy và sự tò mò trí tuệ, họ ${o}.`,
  },
};

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

function generateNarrative(scores, language = 'en') {
  const lang = language === 'vi' ? 'vi' : 'en';
  const p = NARRATIVE_PHRASES[lang];
  const e = p.extraversion[getLevel(scores.extraversion)];
  const a = p.agreeableness[getLevel(scores.agreeableness)];
  const c = p.conscientiousness[getLevel(scores.conscientiousness)];
  const n = p.neuroticism[getLevel(scores.neuroticism)];
  const o = p.openness[getLevel(scores.openness)];
  return p.template(e, a, c, n, o);
}

async function calculateOcean(req, res, next) {
  try {
    const { id } = req.params;
    const language = req.query.language || req.body.language || 'en';
    console.log(`[OCEAN] Calculating for student: ${id}, language: ${language}`);

    const result = await Student.findById(id);
    if (!result) return res.status(404).json({ success: false, error: 'Student not found' });

    const data = result.data;
    const responses = {};
    for (let i = 1; i <= 15; i++) {
      responses[i] = data[`oceanQ${i}`] ? Number(data[`oceanQ${i}`]) : 0;
    }

    const scores    = calculateOceanScores(responses);
    const narrative = generateNarrative(scores, language);

    await Student.update(id, {
      oceanExtraversion:      Number(scores.extraversion),
      oceanAgreeableness:     Number(scores.agreeableness),
      oceanConscientiousness: Number(scores.conscientiousness),
      oceanNeuroticism:       Number(scores.neuroticism),
      oceanOpenness:          Number(scores.openness),
      oceanNarrative:         narrative,
    });

    res.json({ success: true, data: { scores, narrative } });
  } catch (err) {
    console.error(`[OCEAN] Error:`, err.message);
    next(err);
  }
}

async function calculateRisk(req, res, next) {
  try {
    const { id } = req.params;
    const result = await Student.findById(id);
    if (!result) return res.status(404).json({ success: false, error: 'Student not found' });
    const riskResult = calculateRiskScore(result.data);
    await Student.update(id, { riskScore: String(riskResult.totalScore), stoneTier: riskResult.stoneTier });
    res.json({ success: true, data: riskResult });
  } catch (err) { next(err); }
}

const MAX_IMAGE_BASE64_LENGTH = 2.7 * 1024 * 1024;
function validateBase64Image(data, label) {
  if (!data || typeof data !== 'string') return null;
  if (data.length > MAX_IMAGE_BASE64_LENGTH) return `${label} exceeds 2 MB size limit`;
  if (!data.startsWith('data:image/')) return `${label} is not a valid image data URL`;
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
    if (errors.length > 0) return res.status(400).json({ success: false, error: errors[0] });
    const result = await Student.uploadPhotos(id, { headshot, qrCodeImage, additionalQrImages });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Student not found') return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
}

async function searchStudents(req, res, next) {
  try {
    const { q } = req.query;
    const results = await Student.search(q || '');
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
}

module.exports = {
  register, getStudent, getByEmail, updateStudent, checkDuplicate,
  deactivateRecords, calculateRisk, calculateOcean, uploadPhotos, searchStudents,
};
