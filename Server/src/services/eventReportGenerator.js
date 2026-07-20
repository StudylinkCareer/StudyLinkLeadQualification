// server/src/services/eventReportGenerator.js
// ---------------------------------------------------------------------------
// Turns the gathered event data into the report NARRATIVE via the Anthropic API.
// Batched by student (all of a student's desks + qualification analysed together)
// with forced structured (tool) output, so results are reliable and each call
// stays within output limits. Returns { deskReasons, contract, advisory } for
// eventReportExcel.buildEventReportWorkbook.
//
// Requires ANTHROPIC_API_KEY. Model via EVENT_REPORT_MODEL (default claude-sonnet-5).
// ---------------------------------------------------------------------------

const Anthropic = require('@anthropic-ai/sdk');

const MODEL      = process.env.EVENT_REPORT_MODEL || 'claude-sonnet-5';
const BATCH_SIZE = Number(process.env.EVENT_REPORT_BATCH || 7);

const OUTPUT_TOOL = {
  name: 'emit_student_analysis',
  description: 'Return the post-event analysis for each student in the batch.',
  input_schema: {
    type: 'object',
    properties: {
      students: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            studentId: { type: 'string' },
            deskReasons: {
              type: 'array',
              description: 'One entry per desk this student visited.',
              items: {
                type: 'object',
                properties: {
                  institutionId: { type: ['integer', 'null'] },
                  institution:   { type: 'string' },
                  reasons: { type: 'array', items: { type: 'string' }, description: 'Exactly 3 short, specific reasons grounded in the rep rating and desk note.' },
                },
                required: ['institution', 'reasons'],
              },
            },
            contract: {
              type: 'object',
              properties: {
                potential: { type: 'integer', description: '1-10 likelihood this becomes a signed contract.' },
                rationale: { type: 'string', description: 'One concise sentence.' },
              },
              required: ['potential', 'rationale'],
            },
            advisory: {
              type: 'object',
              properties: {
                primaryObjective: { type: 'string' },
                interests: { type: 'array', items: { type: 'string' }, description: 'Up to 3 study interests, each with a short acceptance/scholarship read.' },
                countries: { type: 'array', items: { type: 'string' }, description: 'Up to 3 destination countries with a short visa/fit read.' },
                recommendedPath: { type: 'string', description: 'A realistic 1-3 sentence recommendation.' },
              },
              required: ['recommendedPath'],
            },
          },
          required: ['studentId', 'deskReasons', 'contract', 'advisory'],
        },
      },
    },
    required: ['students'],
  },
};

const SYSTEM = [
  'You are a senior StudyLink education counsellor writing the post-event analysis for an exhibition.',
  'Work only from the data given: the rep engagement rating (1-10, or "-" if unrated) and the desk note for each desk the student visited, plus their qualification (stone tier, risk score, budget, GPA, major, English, scholarship demand, objective, destination).',
  'Style: concise, specific, factual, counsellor-to-counsellor. No filler, no hype. Ground every reason in the actual rating or note. Where a desk is unrated, rank it on the note signal and say so.',
  'For contract "potential", weigh finance documentation, academics, English and intent realistically — most students are early-stage, so scores are usually modest.',
  'For the recommended path, be honest about cost vs budget, visa realism and PR odds; name concrete programs/routes only if the data supports it; otherwise advise nurture.',
].join(' ');

function buildBatchPrompt(data, studentIds) {
  const payload = studentIds.map((sid) => {
    const s = data.students[sid] || {};
    const desks = data.deskVisits.filter((v) => v.studentId === sid).map((v) => ({
      institutionId: v.institutionId, institution: v.institutionName,
      engagement: v.repRating == null ? '-' : v.repRating,
      note: v.noteText || '(no note)',
    }));
    return {
      studentId: sid, name: s.fullName || sid,
      qualification: {
        stone: s.stone, riskScore: s.riskScore, budget: s.budget, gpa: s.gpa, major: s.major,
        english: s.english, scholarshipDemand: s.scholarshipDemand,
        objective: s.objective, destination: s.destination,
      },
      desks,
    };
  });
  return 'Analyse these students and return the structured result via the tool.\n\n' + JSON.stringify(payload, null, 1);
}

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// onProgress(done, total) optional.
async function generateNarrative(data, { onProgress } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic();

  // Only students who actually visited a desk need narrative.
  const studentIds = [...new Set(data.deskVisits.map((v) => v.studentId).filter(Boolean))];
  const batches = chunk(studentIds, BATCH_SIZE);

  const deskReasons = {};
  const contractRaw = [];
  const advisory = {};
  let done = 0;

  for (const batch of batches) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [OUTPUT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_student_analysis' },
      messages: [{ role: 'user', content: buildBatchPrompt(data, batch) }],
    });
    const tool = (msg.content || []).find((b) => b.type === 'tool_use');
    const students = tool?.input?.students || [];
    for (const st of students) {
      (st.deskReasons || []).forEach((d) => {
        const key = `${st.studentId}|${d.institutionId ?? matchInstId(data, st.studentId, d.institution)}`;
        deskReasons[key] = (d.reasons || []).slice(0, 3);
      });
      if (st.contract) contractRaw.push({ studentId: st.studentId, potential: st.contract.potential, rationale: st.contract.rationale });
      if (st.advisory) advisory[st.studentId] = st.advisory;
    }
    done += batch.length;
    if (onProgress) onProgress(done, studentIds.length);
  }

  // Contract sheet: rank by potential desc, then stone/risk as tiebreak.
  const contract = contractRaw
    .sort((a, b) => (b.potential || 0) - (a.potential || 0) || (data.students[b.studentId]?.riskScore || 0) - (data.students[a.studentId]?.riskScore || 0))
    .map((c, i) => ({ ...c, callPriority: i + 1 }));

  return { deskReasons, contract, advisory, studentsAnalysed: studentIds.length, batches: batches.length };
}

// Fallback: map a returned institution NAME back to its id (if the model omitted the id).
function matchInstId(data, studentId, instName) {
  const v = data.deskVisits.find((x) => x.studentId === studentId && x.institutionName === instName);
  return v ? v.institutionId : instName;
}

module.exports = { generateNarrative, MODEL };
