// server/src/controllers/studentController.js

const Student = require('../models/Student');
const Lead    = require('../models/Lead');
const OrderAssignment = require('../models/OrderAssignment');
const { issueAdvanceTokens } = require('../services/eventQualification');
const { calculateRiskScore } = require('../utils/riskCalculator');
const ExcelJS = require('exceljs');                                 // ← NEW
const { Pool } = require('pg');                                     // ← NEW

// ── Direct DB pool for the Excel export query ─────────────────  // ← NEW
const pool = new Pool({                                             // ← NEW
  connectionString: process.env.DATABASE_URL,                       // ← NEW
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // ← NEW
});                                                                 // ← NEW

// ── Registration helper ───────────────────────────────────────────────────────
// Appends one lead_events registration row, then populates the lead-level
// Source-of-Lead / Source / Source detail fields *only if empty* and
// auto-assigns the counsellor if the lead currently has none.
async function appendRegistration(studentId, f = {}, db = pool) {
  const sourceOfLead = (f.sourceOfLead || '').trim();
  const source       = (f.source       || '').trim();
  const sourceDetail = (f.sourceDetail || '').trim();
  const counsellor   = (f.counsellor   || '').trim();
  const eventId      = f.eventId || null;
  const unverified   = !!f.sourceUnverified;

  // lead_events has UNIQUE(student_id, event_id). A returning student re-registering
  // via the SAME event (event_id not null) would otherwise violate it, so upsert:
  // refresh the source fields on the existing row. event_id = NULL rows are NULLS
  // DISTINCT (Postgres default), so non-event re-registrations still insert a new row.
  await db.query(
    `INSERT INTO lead_events
       (student_id, event_id, source_of_lead, source, source_detail, source_unverified, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, now(), now())
     ON CONFLICT (student_id, event_id) DO UPDATE SET
       source_of_lead    = EXCLUDED.source_of_lead,
       source            = EXCLUDED.source,
       source_detail     = EXCLUDED.source_detail,
       source_unverified = EXCLUDED.source_unverified,
       updated_at        = now()`,
    [studentId, eventId, sourceOfLead || null, source || null, sourceDetail || null, unverified]
  );

  // lead_source / source / source_detail are STUDENT-level (Source & Marketing) and
  // stay on students. The counsellor auto-assign is engagement and now lives on the
  // lead (set at Lead.create in register()), so it is no longer written here.
  await db.query(
    `UPDATE students SET
        lead_source   = CASE WHEN COALESCE(NULLIF(btrim(lead_source),''),'')   = '' THEN $2 ELSE lead_source   END,
        source        = CASE WHEN COALESCE(NULLIF(btrim(source),''),'')        = '' THEN $3 ELSE source        END,
        source_detail = CASE WHEN COALESCE(NULLIF(btrim(source_detail),''),'') = '' THEN $4 ELSE source_detail END,
        updated_at    = now()
      WHERE student_id = $1`,
    [studentId, sourceOfLead, source, sourceDetail]
  );

  // Advance event QR: if this lead now qualifies, mint tokens for any future
  // exhibitions they're registered for that don't have one yet (no-op otherwise).
  await issueAdvanceTokens(db, studentId);
}

async function register(req, res, next) {
  try {
    const { email, phone, fullName, contactMediums, studyPlans, leadSource,
            yearOfBirth, residency, schoolEvent, socialConsent,
            preferredSocial, phoneCountryCode, contactMedium1,
            campaignType, campaignName, campaignStart, campaignEnd,
            referralSource,
            sourceOfLead, source, sourceDetail, sourceUnverified,
            counsellor, eventId, existingStudentId } = req.body;

    // ── Guards / resolution (reads on committed data — run before the tx) ──
    // Returning-student flow: if the LQ app resolved an existing Sales doc that has
    // NO active lead (case 2), attach a new lead to it — skip the duplicate guard and
    // Student.create. Otherwise it's a brand-new student (case 3).
    let existingStudent = null;
    if (existingStudentId) {
      // findById returns { data: <record> }; Student.create returns the record
      // directly. Unwrap so student.studentId is populated for Lead.create below.
      const found = await Student.findById(existingStudentId);
      if (!found || !found.data) return res.status(404).json({ success: false, error: 'Student not found' });
      existingStudent = found.data;
    } else if (email || phone) {
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

    // ── Atomic write: student(create) + initial lead + ownership + registration ──
    // A single transaction so a failure at ANY step (e.g. the lead_events insert)
    // rolls the whole thing back — no orphan leads / half-registered records.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const student = existingStudent
        ? existingStudent
        : await Student.create({
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
            leadSource:       sourceOfLead     || leadSource || '',
            campaignType:     campaignType     || '',
            campaignName:     campaignName     || '',
            campaignStart:    campaignStart    || null,
            campaignEnd:      campaignEnd      || null,
            referralSource:   referralSource   || '',
            source:           source           || '',
            sourceDetail:     sourceDetail     || '',
          }, client);

      // Create the initial engagement (lead). Academic/target fields are filled in
      // later by staff; at intake we set status = New, carry the study plans, and
      // auto-assign the counsellor if one was provided.
      await Lead.create(student.studentId, {
        leadStatus: 'New',
        studyPlans: studyPlans || '',
        counselor:  (counsellor || '').trim() || null,
      }, client);

      // Ownership rule (connected-unit model, 2026-07): a named counsellor puts the
      // record in the Counselling phase owned by them; with no counsellor it defaults
      // to Pool, owned by Quality (Mạch Nguyễn Phi Vân). Applies to console-launched
      // and customer-facing self-registration alike.
      const coun = (counsellor || '').trim();
      if (coun) {
        await client.query(`UPDATE students SET counselor=$2, order_phase='Counselling', updated_at=now() WHERE student_id=$1`, [student.studentId, coun]);
        await OrderAssignment.setForOrder(client, student.studentId, 'Counselor', coun);
      } else {
        await client.query(`UPDATE students SET order_phase='Pool', updated_at=now() WHERE student_id=$1`, [student.studentId]);
        await OrderAssignment.setForOrder(client, student.studentId, 'Quality', 'Mạch Nguyễn Phi Vân');
      }

      // Append the registration event row + populate student-level Source if empty.
      await appendRegistration(student.studentId, {
        sourceOfLead, source, sourceDetail, sourceUnverified, counsellor, eventId,
      }, client);

      await client.query('COMMIT');
      req.session.studentId = student.studentId;
      return res.status(201).json({ success: true, data: student });
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection already broken */ }
      throw txErr;
    } finally {
      client.release();
    }
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
    // Phase-driven assignment context: every position's owner, plus what the
    // current phase allows (editable positions + legal next phases).
    const sid = result.data.studentId || result.data.student_id || id;
    const phase = result.data.orderPhase || null;
    const [assignments, editablePositions, nextPhases] = await Promise.all([
      OrderAssignment.getForOrder(sid),
      OrderAssignment.activePositions(phase),
      OrderAssignment.allowedTransitions(phase),
    ]);
    res.json({ success: true, data: { ...result.data, assignments, editablePositions, nextPhases } });
  } catch (err) { next(err); }
}

async function getByEmail(req, res, next) {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'Email query parameter required' });
    const result = await Student.findByEmail(email);
    if (!result) return res.status(404).json({ success: false, error: 'Student not found' });
    req.session.studentId = result.data.studentId;
    res.json({ success: true, data: result.data });
  } catch (err) { next(err); }
}

async function updateStudent(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await Student.update(id, req.body);
    await issueAdvanceTokens(pool, id);
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
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0)
      return res.status(400).json({ success: false, error: 'studentIds array is required' });
    const result = await Student.deactivateRecords(studentIds);
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


// ═════════════════════════════════════════════════════════════════
// Excel export                                                  ← NEW
// ═════════════════════════════════════════════════════════════════

// Pretty header labels for the .xlsx output. Keys must be DB snake_case.
const FIELD_LABELS = {
  student_id:                'Unique ID',
  full_name:                'Name',
  email:                    'Email',
  phone:                    'Phone',
  year_of_birth:            'Year of Birth',
  residency:                'Residency',
  school_event:             'School / Event',
  preferred_social:         'Social Platform',
  social_consent:           'Connect With Us',
  lead_status:              'Status',
  created_at:               'Created',
  updated_at:               'Updated',
  lead_source:              'Lead Source',
  interaction:              'Interaction',
  study_plans:              'Study Plans',
  destination_country:      'Destination',
  timeline:                 'Timeline',
  stone_tier:               'Stone',
  risk_score:               'Score',
  counselor:                'Counselor',
  senior_counselor:         'Sr. Counselor',
  presales:                 'Pre-Sales',
  marketing_staff:          'Marketing',
  close_date:               'Close Date',
  confidence:               'Confidence',
  budget:                   'Budget',
  scholarship_demand:       'Scholarship',
  english_level:            'English',
  gpa:                      'GPA',
  immigration_history:      'Immigration',
  sponsor_income:           'Sponsor Income',
  income_evidence:          'Income Evidence',
  study_plan_gap:           'Study Plan Gap',
  ultimate_objective:       'Objective',
  mother_full_name:         'Mother Name',
  mother_email:             'Mother Email',
  mother_phone:             'Mother Phone',
  mother_contact_medium:    'Mother Medium',
  father_full_name:         'Father Name',
  father_email:             'Father Email',
  father_phone:             'Father Phone',
  father_contact_medium:    'Father Medium',
  ocean_extraversion:       'OCEAN: Extraversion',
  ocean_agreeableness:      'OCEAN: Agreeableness',
  ocean_conscientiousness:  'OCEAN: Conscientiousness',
  ocean_neuroticism:        'OCEAN: Neuroticism',
  ocean_openness:           'OCEAN: Openness',
  campaign_type:            'Campaign Type',
  campaign_name:            'Campaign Name',
  campaign_start:           'Campaign Start',
  campaign_end:             'Campaign End',
  referral_source:          'Referral Source',
  status:                   'Active/Inactive',
};

const ALLOWED_DATE_FIELDS = new Set([
  'created_at', 'updated_at', 'close_date', 'campaign_start', 'campaign_end',
]);

const ALLOWED_FIELDS = new Set(Object.keys(FIELD_LABELS));

// camelCase (frontend) → snake_case (DB column)
const JS_TO_DB = {
  studentId:               'student_id',
  fullName:               'full_name',
  email:                  'email',
  phone:                  'phone',
  yearOfBirth:            'year_of_birth',
  residency:              'residency',
  schoolEvent:            'school_event',
  preferredSocial:        'preferred_social',
  socialConsent:          'social_consent',
  leadStatus:             'lead_status',
  createdAt:              'created_at',
  updatedAt:              'updated_at',
  leadSource:             'lead_source',
  interaction:            'interaction',
  studyPlans:             'study_plans',
  destinationCountry:     'destination_country',
  timeline:               'timeline',
  stoneTier:              'stone_tier',
  riskScore:              'risk_score',
  counselor:              'counselor',
  seniorCounselor:        'senior_counselor',
  presales:               'presales',
  marketingStaff:         'marketing_staff',
  closeDate:              'close_date',
  confidence:             'confidence',
  budget:                 'budget',
  scholarshipDemand:      'scholarship_demand',
  englishLevel:           'english_level',
  gpa:                    'gpa',
  immigrationHistory:     'immigration_history',
  sponsorIncome:          'sponsor_income',
  incomeEvidence:         'income_evidence',
  studyPlanGap:           'study_plan_gap',
  ultimateObjective:      'ultimate_objective',
  motherFullName:         'mother_full_name',
  motherEmail:            'mother_email',
  motherPhone:            'mother_phone',
  motherContactMedium:    'mother_contact_medium',
  fatherFullName:         'father_full_name',
  fatherEmail:            'father_email',
  fatherPhone:            'father_phone',
  fatherContactMedium:    'father_contact_medium',
  oceanExtraversion:      'ocean_extraversion',
  oceanAgreeableness:     'ocean_agreeableness',
  oceanConscientiousness: 'ocean_conscientiousness',
  oceanNeuroticism:       'ocean_neuroticism',
  oceanOpenness:          'ocean_openness',
  campaignType:           'campaign_type',
  campaignName:           'campaign_name',
  campaignStart:          'campaign_start',
  campaignEnd:            'campaign_end',
  referralSource:         'referral_source',
  status:                 'status',
};

// Engagement columns (snake_case) that now live on the leads table; everything else
// in ALLOWED_FIELDS stays on students. Used to qualify the export SELECT/JOIN.
const EXPORT_ENGAGEMENT = new Set([
  'lead_status', 'study_plans', 'destination_country', 'timeline',
  'counselor', 'senior_counselor', 'presales', 'marketing_staff',
  'close_date', 'confidence',
]);

async function exportExcel(req, res, next) {
  try {
    const {
      startDate,
      endDate,
      dateField    = 'createdAt',
      fields       = [],
      includeNotes = false,                                        // ← NEW
    } = req.body;

    // ── Validate inputs ──
    const dateCol = JS_TO_DB[dateField] || dateField;
    if (!ALLOWED_DATE_FIELDS.has(dateCol)) {
      return res.status(400).json({ success: false, error: `Invalid dateField: ${dateField}` });
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields selected' });
    }

    const dbFields = [...new Set(
      fields.map(f => JS_TO_DB[f] || f).filter(c => ALLOWED_FIELDS.has(c))
    )];
    if (dbFields.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields after filtering' });
    }

    // Always lead with student_id
    const selectCols = ['student_id', ...dbFields.filter(c => c !== 'student_id')];

    // Engagement columns live on leads now; person columns stay on students. Qualify
    // each requested column to the right table and join a representative lead (prefer
    // an open lead, else the most recent) so the export stays one row per student.
    const qual = (c) => EXPORT_ENGAGEMENT.has(c) ? `l.${c}` : `s.${c}`;
    const dateColQual = qual(dateCol);

    // ── Build WHERE clause ──
    const where  = [];
    const params = [];
    if (startDate) {
      params.push(startDate);
      where.push(`${dateColQual} >= $${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      where.push(`${dateColQual} < ($${params.length}::date + INTERVAL '1 day')`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT ${selectCols.map(c => `${qual(c)} AS ${c}`).join(', ')}
      FROM students s
      LEFT JOIN LATERAL (
        SELECT * FROM leads
         WHERE person_id = s.student_id
         ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id DESC
         LIMIT 1
      ) l ON true
      ${whereSql}
      ORDER BY ${dateColQual} DESC NULLS LAST
    `;

    const { rows } = await pool.query(sql, params);

    // ── Fetch notes for these leads (if requested) ──            // ← NEW
    let noteRows = [];                                              // ← NEW
    if (includeNotes && rows.length > 0) {                          // ← NEW
      const studentIds = rows.map(r => r.student_id);                 // ← NEW
      const noteResult = await pool.query(
        `SELECT n.student_id, s.full_name, n.note_type, n.content,
                n.author_name, n.created_at
         FROM student_notes n
         JOIN students s ON s.student_id = n.student_id
         WHERE n.student_id = ANY($1::varchar[])
         ORDER BY s.full_name, n.created_at DESC`,
        [studentIds]
      );
      noteRows = noteResult.rows;                                   // ← NEW
    }                                                               // ← NEW

    // ── Build workbook ──
    const wb = new ExcelJS.Workbook();
    wb.creator = 'StudyLink LM Console';
    wb.created = new Date();
    const ws   = wb.addWorksheet('Leads');

    ws.columns = selectCols.map(col => ({
      header: FIELD_LABELS[col] || col,
      key:    col,
      width:  Math.max((FIELD_LABELS[col] || col).length + 2, 14),
    }));

    const dateColumns = new Set(['created_at', 'updated_at', 'close_date', 'campaign_start', 'campaign_end']);

    for (const row of rows) {
      const formatted = {};
      for (const col of selectCols) {
        let val = row[col];
        if (val instanceof Date) {
          formatted[col] = val;
        } else if (val !== null && val !== undefined && dateColumns.has(col)) {
          const d = new Date(val);
          formatted[col] = isNaN(d) ? val : d;
        } else {
          formatted[col] = val;
        }
      }
      ws.addRow(formatted);
    }

    // Styling
    const headerRow = ws.getRow(1);
    headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4A6B' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height    = 22;

    selectCols.forEach((col, idx) => {
      if (dateColumns.has(col)) {
        ws.getColumn(idx + 1).numFmt = 'yyyy-mm-dd';
      }
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: selectCols.length },
    };

    // ── Build Notes sheet (if requested) ──                       // ← NEW
    if (includeNotes) {                                             // ← NEW
      const notesWs = wb.addWorksheet('Notes');                     // ← NEW
      notesWs.columns = [                                           // ← NEW
        { header: 'Lead ID',    key: 'student_id',  width: 14 },    // ← NEW
        { header: 'Lead Name',  key: 'full_name',   width: 24 },    // ← NEW
        { header: 'Note Type',  key: 'note_type',   width: 12 },    // ← NEW
        { header: 'Author',     key: 'author_name', width: 20 },    // ← NEW
        { header: 'Created',    key: 'created_at',  width: 12 },    // ← NEW
        { header: 'Content',    key: 'content',     width: 80 },    // ← NEW
      ];                                                            // ← NEW
      for (const n of noteRows) {                                   // ← NEW
        notesWs.addRow({                                            // ← NEW
          student_id:  n.student_id,                                // ← NEW
          full_name:   n.full_name,                                 // ← NEW
          note_type:   n.note_type,                                 // ← NEW
          author_name: n.author_name,                               // ← NEW
          created_at:  n.created_at instanceof Date                 // ← NEW
                         ? n.created_at                             // ← NEW
                         : new Date(n.created_at),                  // ← NEW
          content:     n.content,                                   // ← NEW
        });                                                         // ← NEW
      }                                                             // ← NEW
      // Style notes header                                         // ← NEW
      const nHeader = notesWs.getRow(1);                            // ← NEW
      nHeader.font      = { bold: true, color: { argb: 'FFFFFFFF' } }; // ← NEW
      nHeader.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4A6B' } }; // ← NEW
      nHeader.alignment = { vertical: 'middle', horizontal: 'left' };  // ← NEW
      nHeader.height    = 22;                                       // ← NEW
      notesWs.getColumn(5).numFmt = 'yyyy-mm-dd';                   // ← NEW
      // Wrap long content in the Content column                    // ← NEW
      notesWs.getColumn(6).alignment = { wrapText: true, vertical: 'top' }; // ← NEW
      notesWs.views = [{ state: 'frozen', ySplit: 1 }];             // ← NEW
      notesWs.autoFilter = {                                        // ← NEW
        from: { row: 1, column: 1 },                                // ← NEW
        to:   { row: 1, column: 6 },                                // ← NEW
      };                                                            // ← NEW
    }                                                               // ← NEW

    // Send response
    const stamp    = new Date().toISOString().slice(0, 10);
    const filename = `leads-export-${stamp}.xlsx`;

    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Row-Count', rows.length);
    res.setHeader('X-Export-Note-Count', noteRows.length);          // ← NEW

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
}


// ── Add a registration to an existing (returning) lead ────────────────────────
// POST /api/students/:id/add-registration
async function addRegistration(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await Student.findById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Student not found' });
    await appendRegistration(id, req.body);
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = {
  register, addRegistration, getStudent, getByEmail, updateStudent, checkDuplicate,
  deactivateRecords, calculateRisk, calculateOcean, uploadPhotos, searchStudents,
  exportExcel,                                                      // ← NEW
};
