// src/pages/LeadDetail.jsx
// CHANGES:
//   - Added campaignType, campaignName, campaignStart, campaignEnd to FIELD_LABELS
//   - Added 4 read-only campaign fields to Student Information view section
//   - Right-column Summary panel redesigned:
//       * Replaces staff summary + OCEAN scores list
//       * Now shows Stone image + Risk score, OCEAN archetype (group + name)
//         in a color-coded card, and scrollable Last 5 Notes
//   - Staff Assignment panel: labels and dropdowns now display inline
//     (label left, dropdown right) instead of stacked

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { studentAPI, staffAPI, notesAPI, auditAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Watermark from '../components/Watermark';
import { FiArrowLeft, FiSend, FiTrash2, FiEdit2, FiX, FiSave, FiChevronDown, FiChevronUp, FiRefreshCw, FiUser, FiGrid } from 'react-icons/fi';
import { getArchetype, GROUP_COLORS } from '../utils/oceanArchetypes';

// ── Stone images ──────────────────────────────────────────────────────────────
import quartzImg   from '../Assets/Stones/quartz.png';
import agateImg    from '../Assets/Stones/agate.png';
import sapphireImg from '../Assets/Stones/sapphire.png';
import rubyImg     from '../Assets/Stones/ruby.png';
import diamondImg  from '../Assets/Stones/diamond.png';

const STONE_IMAGES = {
  Quartz:   quartzImg,
  Agate:    agateImg,
  Sapphire: sapphireImg,
  Ruby:     rubyImg,
  Diamond:  diamondImg,
};

const STONE_MESSAGES = {
  Quartz:   'StudyLink will support you with International Programs locally with Scholarships — a smart decision to enjoy world-class education while staying close to your family.',
  Agate:    'A journey to Asian and European cultures will help you broaden your mindset and develop excellent adaptability. StudyLink will be your Companion on this abroad journey, starting RIGHT NOW!',
  Sapphire: 'You possess a practical vision, and Europe or Australasia is the perfect environment for you to maximize your potential. StudyLink will be your Companion on this abroad journey, starting RIGHT NOW!',
  Ruby:     'You are ready to conquer great and beautiful challenges at leading educational powerhouses across 5 continents. StudyLink will be your Companion on this study abroad journey, starting RIGHT NOW!',
  Diamond:  'You can aim at the global "cathedrals" of knowledge, places reserved for the most excellent individuals. StudyLink will be your Companion on this study abroad journey, starting RIGHT NOW!',
};

// ── Permissions config ────────────────────────────────────────────────────────
const PERMS = {
  canEdit:           ['Counselor', 'Manager', 'Admin', 'Director'],
  canEditAssignment: ['Manager', 'Admin'],
  canRecalculate:    ['Manager', 'Admin', 'Counselor'],
  canWriteNote: {
    counselor:  ['Counselor', 'Manager', 'Admin'],
    presales:   ['Counselor', 'Manager', 'Admin'],
    management: ['Director',  'Manager', 'Admin'],
  },
};

const LEAD_STATUSES   = ['New','Contacted','Qualified','Proposal','Negotiation','Won','Lost','On Hold'];
const CONFIDENCE_OPTS = ['Low (0-30%)','Medium (31-60%)','High (61-90%)','Committed (91-100%)'];
const NOTE_TYPES      = { counselor:'Counselor Note', presales:'PreSales Note', management:'Management Note' };
const ENGLISH_LEVELS  = ['Beginner','IELTS 4-4.5','IELTS 5-5.5','IELTS 6-6.5','IELTS 7+'];
const GPA_OPTIONS     = ['< 6.5','6.5-6.9','7-7.9','8-8.9','9+'];
const BUDGET_OPTIONS  = ['< 300M VND','300-500M VND','500-800M VND','800M-1B VND','1-1.5B VND'];
const SCHOLARSHIP_OPTS= ['100% scholarship','60-90% scholarship','30-50% scholarship','20-25% scholarship','No scholarship needed'];
const IMMIGRATION_OPTS= ['Visa rejection (self)','Rejection/overstay (family)','No travel history','Travelled in Asia','Travelled to Western countries'];
const SPONSOR_OPTS    = ['< 300M VND','300-500M VND','500-800M VND','800M-1B VND','1-1.5B VND'];
const INCOME_OPTS     = ['0% documented','30-35% documented','50% documented','70-75% documented','100% documented'];
const STUDY_GAP_OPTS  = ['Different major, 5+ year gap','Different major, 2-5 year gap','Same major, 2-5 year gap','Same major, < 2 year gap','Same major, no gap'];
const OBJECTIVE_OPTS  = ['Migration only','Work only','Study but work more','Study for migration pathway','Study only'];
const STUDY_PLAN_OPTS = ['Study Abroad','English Summer Camp','Study in Vietnam','Do not study'];
const TIMELINE_OPTS   = ['Next 6 months','6-12 months','12-24 months','24-36 months','36+ months'];
const INTERACTION_OPTS= ['Only left contact','Queries','Fill lead form partly','Fill lead form fully','Call in-Walk in'];
const LEAD_SOURCE_OPTS= ['Databases','FB-Zalo-GG-TikTok ads','School outreach','Subagent referrals','Ex-client'];

const LIKERT_LABELS = ['','Strongly Disagree','Disagree','Neutral','Agree','Strongly Agree'];

const OCEAN_QUESTIONS = [
  { id:1,  text:'I am the life of the party and enjoy being the center of attention.' },
  { id:2,  text:"I sympathize with others' feelings and feel for those less fortunate." },
  { id:3,  text:'I am always prepared and keep my belongings organized.' },
  { id:4,  text:'I have frequent mood swings and get stressed easily.' },
  { id:5,  text:'I have a vivid imagination and enjoy thinking about abstract ideas.' },
  { id:6,  text:"I don't talk a lot and tend to keep to myself." },
  { id:7,  text:"I am not really interested in others' problems or feelings." },
  { id:8,  text:'I often forget to put things back in their proper place.' },
  { id:9,  text:"I am relaxed most of the time and don't worry much." },
  { id:10, text:'I am not interested in theoretical or philosophical discussions.' },
  { id:11, text:'I feel comfortable around people and start conversations easily.' },
  { id:12, text:'I have a soft heart and try to make people feel at ease.' },
  { id:13, text:'I pay attention to details and like to get chores done right away.' },
  { id:14, text:'I get upset easily and often feel blue or anxious.' },
  { id:15, text:'I enjoy hearing new ideas and looking at art or nature.' },
];

const FIELD_LABELS = {
  leadStatus:'Status', closeDate:'Close Date', confidence:'Confidence',
  studyPlans:'Study Plans', leadSource:'Lead Source', interaction:'Interaction',
  destinationCountry:'Destination', timeline:'Timeline', schoolEvent:'School/Event',
  budget:'Budget', scholarshipDemand:'Scholarship Demand', englishLevel:'English Level',
  gpa:'GPA', immigrationHistory:'Immigration History', sponsorIncome:'Sponsor Income',
  incomeEvidence:'Income Evidence', studyPlanGap:'Study Plan & Gap',
  ultimateObjective:'Ultimate Objective', counselor:'Counselor',
  seniorCounselor:'Senior Counselor', presales:'Pre-Sales', marketingStaff:'Marketing Staff',
  riskScore:'Risk Score', stoneTier:'Stone Tier',
  // ── Campaign fields ──
  campaignType:'Campaign Type', campaignName:'Campaign Name',
  campaignStart:'Campaign Start', campaignEnd:'Campaign End',
};

function canDo(perm, role) { return Array.isArray(perm) ? perm.includes(role) : false; }

function formatDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function formatShortDate(dt) {
  if (!dt) return null;
  return String(dt).slice(0, 10);
}

function Field({ label, value }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0.125rem' }}>
      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500 }}>{label}</span>
      <span style={{ fontSize:'0.875rem' }}>{value || '—'}</span>
    </div>
  );
}

function EditField({ label, name, value, onChange, type='text', options }) {
  return (
    <div className="form-group" style={{ margin:0 }}>
      <label className="form-label">{label}</label>
      {options ? (
        <select className="form-select" value={value||''} onChange={e=>onChange(name,e.target.value)}>
          <option value="">—</option>
          {options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="form-input" type={type} value={value||''} onChange={e=>onChange(name,e.target.value)}/>
      )}
    </div>
  );
}

// ── Photo placeholder ─────────────────────────────────────────────────────────
function PhotoThumb({ url, label, isRound }) {
  return (
    <div style={{ textAlign:'center' }}>
      {url ? (
        <img src={url} alt={label} style={{
          width:'56px', height:'56px', objectFit:'cover',
          borderRadius: isRound ? '50%' : '6px',
          border:'2px solid var(--border)',
        }}/>
      ) : (
        <div style={{
          width:'56px', height:'56px',
          borderRadius: isRound ? '50%' : '6px',
          background:'var(--bg-secondary)',
          border:'2px dashed var(--border)',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'var(--text-secondary)',
        }}>
          {isRound ? <FiUser size={20}/> : <FiGrid size={20}/>}
        </div>
      )}
      <div style={{ fontSize:'0.65rem', color:'var(--text-secondary)', marginTop:'0.25rem' }}>{label}</div>
    </div>
  );
}

export default function LeadDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { staff } = useAuth();
  const role      = staff?.role || '';

  const [lead, setLead]         = useState(null);
  const [notes, setNotes]       = useState([]);
  const [staffList, setStaff]   = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [showHistory, setShowHistory]               = useState(false);
  const [showOceanQuestions, setShowOceanQuestions] = useState(false);
  const [assign, setAssign]     = useState({});
  const [noteType, setNoteType] = useState('counselor');
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAdding] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcOcean, setRecalcOcean]     = useState(false);
  const [oceanResult, setOceanResult]     = useState(null);

  useEffect(() => {
    Promise.all([
      studentAPI.get(id),
      notesAPI.list(id),
      staffAPI.listActive(),
      auditAPI.getForStudent(id),
    ]).then(([ld, nt, st, al]) => {
      const l = ld.data;
      setLead(l);
      setNotes(nt.data || []);
      setStaff(st.data || []);
      setAuditLog(al.data || []);
      setAssign({
        counselor:       l.counselor      || '',
        seniorCounselor: l.seniorCounselor || '',
        presales:        l.presales        || '',
        marketingStaff:  l.marketingStaff  || '',
      });
      if (l.oceanExtraversion) {
        const scores = {
          extraversion:      l.oceanExtraversion,
          agreeableness:     l.oceanAgreeableness,
          conscientiousness: l.oceanConscientiousness,
          neuroticism:       l.oceanNeuroticism,
          openness:          l.oceanOpenness,
        };
        setOceanResult({
          scores,
          narrative: l.oceanNarrative || '',
          ...getArchetype(scores),
        });
      }
    }).catch(e=>console.error(e))
      .finally(()=>setLoading(false));
  }, [id]);

  function enterEdit() { setEditData({...lead}); setEditMode(true); }
  function cancelEdit() { setEditData({}); setEditMode(false); }
  function updateEdit(name, value) { setEditData(d=>({...d,[name]:value})); }

  async function saveAll() {
    setSaving(true);
    try {
      if (editMode) {
        await studentAPI.update(id, {
          leadStatus:         editData.leadStatus,
          closeDate:          editData.closeDate || null,
          confidence:         editData.confidence,
          studyPlans:         editData.studyPlans,
          destinationCountry: editData.destinationCountry,
          timeline:           editData.timeline,
          schoolEvent:        editData.schoolEvent,
          leadSource:         editData.leadSource,
          interaction:        editData.interaction,
          budget:             editData.budget,
          scholarshipDemand:  editData.scholarshipDemand,
          englishLevel:       editData.englishLevel,
          gpa:                editData.gpa,
          immigrationHistory: editData.immigrationHistory,
          sponsorIncome:      editData.sponsorIncome,
          incomeEvidence:     editData.incomeEvidence,
          studyPlanGap:       editData.studyPlanGap,
          ultimateObjective:  editData.ultimateObjective,
          ...Object.fromEntries(
            Array.from({length:15}, (_,i) => [`oceanQ${i+1}`, editData[`oceanQ${i+1}`] || null])
          ),
        });
        setLead(l=>({...l,...editData}));
        setEditMode(false);
        setEditData({});
      }
      if (canDo(PERMS.canEditAssignment, role)) {
        await staffAPI.assign(id, {
          counselor:       assign.counselor,
          seniorCounselor: assign.seniorCounselor,
          presales:        assign.presales,
          marketingStaff:  assign.marketingStaff,
        });
        setLead(l=>({...l,...assign}));
      }
      const al = await auditAPI.getForStudent(id);
      setAuditLog(al.data || []);
      alert('Saved successfully');
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleRecalculateRisk() {
    setRecalculating(true);
    try {
      const res = await studentAPI.calculateRisk(id);
      setLead(l => ({ ...l, riskScore: String(res.data.totalScore), stoneTier: res.data.stoneTier }));
      alert(`Risk recalculated: ${res.data.stoneTier} (${res.data.totalScore})`);
    } catch(e) { alert(e.message); }
    finally { setRecalculating(false); }
  }

  async function handleRecalculateOcean() {
    setRecalcOcean(true);
    try {
      const res = await studentAPI.calculateOcean(id);
      const scores = res.data.scores;
      const archetypeData = getArchetype(scores);
      setOceanResult({ ...res.data, ...archetypeData });
      setLead(l => ({
        ...l,
        oceanExtraversion:      scores.extraversion,
        oceanAgreeableness:     scores.agreeableness,
        oceanConscientiousness: scores.conscientiousness,
        oceanNeuroticism:       scores.neuroticism,
        oceanOpenness:          scores.openness,
        oceanArchetype:         archetypeData.archetype?.name || '',
      }));
      if (archetypeData.archetype) {
        await studentAPI.update(id, { oceanArchetype: archetypeData.archetype.name });
      }
      alert('Career Fit profile updated successfully');
    } catch(e) { alert(e.message); }
    finally { setRecalcOcean(false); }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setAdding(true);
    try {
      const data = await notesAPI.add(id, noteType, noteText.trim());
      setNotes(n=>[data.data,...n]);
      setNoteText('');
    } catch(e) { alert(e.message); }
    finally { setAdding(false); }
  }

  async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      await notesAPI.delete(noteId);
      setNotes(n=>n.filter(x=>x.id!==noteId));
    } catch(e) { alert(e.message); }
  }

  if (loading) return <div className="loading-center">Loading...</div>;
  if (!lead)   return <div className="page-body"><div className="alert alert--error">Lead not found</div></div>;

  const canEdit   = canDo(PERMS.canEdit, role);
  const canAssign = canDo(PERMS.canEditAssignment, role);
  const canRecalc = canDo(PERMS.canRecalculate, role);
  const d         = editMode ? editData : lead;

  const oceanAnsweredCount = Array.from({length:15}, (_,i) => lead[`oceanQ${i+1}`]).filter(Boolean).length;

  return (
    <div>
      <Watermark />

      {/* Header */}
      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <button className="btn btn--ghost btn--icon" onClick={()=>navigate('/leads')}>
            <FiArrowLeft size={16}/>
          </button>
          <span className="page-title">{lead.fullName || 'Lead Detail'}</span>
          <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono' }}>
            {lead.uniqueId}
          </span>
        </div>
        <div style={{ display:'flex', gap:'0.5rem' }}>
          {canEdit && !editMode && (
            <button className="btn btn--secondary btn--sm" onClick={enterEdit}>
              <FiEdit2 size={13}/> Edit
            </button>
          )}
          {editMode && (
            <button className="btn btn--ghost btn--sm" onClick={cancelEdit}>
              <FiX size={13}/> Cancel
            </button>
          )}
          {(editMode || canAssign) && (
            <button className="btn btn--primary btn--sm" onClick={saveAll} disabled={saving}>
              <FiSave size={13}/> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      <div className="page-body" style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:'1rem', alignItems:'start' }}>

        {/* ── Left column ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

          {/* Lead Status */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Lead Status</span></div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <EditField label="Status"     name="leadStatus" value={d.leadStatus} onChange={updateEdit} options={LEAD_STATUSES}/>
                <EditField label="Close Date" name="closeDate"  value={d.closeDate?d.closeDate.split('T')[0]:''} onChange={updateEdit} type="date"/>
                <EditField label="Confidence" name="confidence" value={d.confidence} onChange={updateEdit} options={CONFIDENCE_OPTS}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <Field label="Status"     value={lead.leadStatus||'New'}/>
                <Field label="Close Date" value={formatShortDate(lead.closeDate)}/>
                <Field label="Confidence" value={lead.confidence}/>
              </div>
            )}
          </div>

          {/* Student Information */}
          <div className="section-card">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1rem', paddingBottom:'0.75rem', borderBottom:'1px solid var(--border)' }}>
              <div>
                <span className="section-title">Student Information</span>
                <div style={{ fontSize:'1.25rem', fontWeight:600, color:'var(--primary)', marginTop:'0.25rem' }}>
                  {lead.fullName || '—'}
                </div>
              </div>
              <div style={{ display:'flex', gap:'0.75rem', flexShrink:0 }}>
                <PhotoThumb url={lead.headshotUrl}    label="Headshot" isRound={true}/>
                <PhotoThumb url={lead.qrCodeImageUrl} label="QR Code"  isRound={false}/>
              </div>
            </div>
            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <EditField label="Study Plans"  name="studyPlans"         value={d.studyPlans}         onChange={updateEdit} options={STUDY_PLAN_OPTS}/>
                <EditField label="Destination"  name="destinationCountry" value={d.destinationCountry} onChange={updateEdit}/>
                <EditField label="Timeline"     name="timeline"           value={d.timeline}           onChange={updateEdit} options={TIMELINE_OPTS}/>
                <EditField label="School/Event" name="schoolEvent"        value={d.schoolEvent}        onChange={updateEdit}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <Field label="Email"         value={lead.email}/>
                <Field label="Phone"         value={lead.phone}/>
                <Field label="Stone Tier"    value={lead.stoneTier}/>
                <Field label="Risk Score"    value={lead.riskScore}/>
                <Field label="Study Plans"   value={lead.studyPlans}/>
                <Field label="Destination"   value={lead.destinationCountry}/>
                <Field label="Timeline"      value={lead.timeline}/>
                <Field label="School/Event"  value={lead.schoolEvent}/>
                <Field label="Year of Birth" value={lead.yearOfBirth}/>
                <Field label="Residency"     value={lead.residency}/>
                <Field label="Created"       value={formatShortDate(lead.createdAt)}/>
                <Field label="Updated"       value={formatShortDate(lead.updatedAt)}/>
                {/* ── Campaign / Event fields (read-only) ── */}
                {(lead.campaignType || lead.campaignName || lead.campaignStart) && (<>
                  <div style={{ gridColumn:'1 / -1', borderTop:'1px solid var(--border)', paddingTop:'0.75rem', marginTop:'0.25rem' }}>
                    <span style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Event / Campaign</span>
                  </div>
                  <Field label="Campaign Type"  value={lead.campaignType}/>
                  <Field label="Campaign Name"  value={lead.campaignName}/>
                  <Field label="Event Start"    value={formatShortDate(lead.campaignStart)}/>
                  <Field label="Event End"      value={formatShortDate(lead.campaignEnd)}/>
                </>)}
              </div>
            )}
          </div>

          {/* Self Assessment */}
          <div className="section-card">
            <div className="section-header" style={{ justifyContent:'space-between' }}>
              <span className="section-title">Self Assessment</span>
              {canRecalc && !editMode && (
                <button className="btn btn--secondary btn--sm" onClick={handleRecalculateRisk} disabled={recalculating}>
                  <FiRefreshCw size={12}/> {recalculating ? 'Recalculating...' : 'Recalculate Risk'}
                </button>
              )}
            </div>

            {lead.stoneTier && STONE_IMAGES[lead.stoneTier] && (
              <div style={{
                display:'flex', alignItems:'center', gap:'1rem',
                background:'var(--bg-secondary)', borderRadius:'10px',
                padding:'1rem', marginBottom:'1rem',
                border:'1px solid var(--border)',
              }}>
                <img src={STONE_IMAGES[lead.stoneTier]} alt={lead.stoneTier}
                  style={{ width:'56px', height:'56px', objectFit:'contain', flexShrink:0 }}/>
                <p style={{ margin:0, fontSize:'0.875rem', lineHeight:1.6, color:'var(--text-primary)' }}>
                  <strong>Congratulations! {lead.stoneTier}</strong> — {STONE_MESSAGES[lead.stoneTier]}
                </p>
              </div>
            )}

            {editMode ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <EditField label="Lead Source"         name="leadSource"        value={d.leadSource}        onChange={updateEdit} options={LEAD_SOURCE_OPTS}/>
                <EditField label="Interaction"         name="interaction"       value={d.interaction}       onChange={updateEdit} options={INTERACTION_OPTS}/>
                <EditField label="Budget"              name="budget"            value={d.budget}            onChange={updateEdit} options={BUDGET_OPTIONS}/>
                <EditField label="Scholarship Demand"  name="scholarshipDemand" value={d.scholarshipDemand} onChange={updateEdit} options={SCHOLARSHIP_OPTS}/>
                <EditField label="English Level"       name="englishLevel"      value={d.englishLevel}      onChange={updateEdit} options={ENGLISH_LEVELS}/>
                <EditField label="GPA"                 name="gpa"               value={d.gpa}               onChange={updateEdit} options={GPA_OPTIONS}/>
                <EditField label="Immigration History" name="immigrationHistory" value={d.immigrationHistory} onChange={updateEdit} options={IMMIGRATION_OPTS}/>
                <EditField label="Sponsor Income"      name="sponsorIncome"     value={d.sponsorIncome}     onChange={updateEdit} options={SPONSOR_OPTS}/>
                <EditField label="Income Evidence"     name="incomeEvidence"    value={d.incomeEvidence}    onChange={updateEdit} options={INCOME_OPTS}/>
                <EditField label="Study Plan & Gap"    name="studyPlanGap"      value={d.studyPlanGap}      onChange={updateEdit} options={STUDY_GAP_OPTS}/>
                <EditField label="Ultimate Objective"  name="ultimateObjective" value={d.ultimateObjective} onChange={updateEdit} options={OBJECTIVE_OPTS}/>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <Field label="Lead Source"         value={lead.leadSource}/>
                <Field label="Interaction"         value={lead.interaction}/>
                <Field label="Budget"              value={lead.budget}/>
                <Field label="Scholarship Demand"  value={lead.scholarshipDemand}/>
                <Field label="English Level"       value={lead.englishLevel}/>
                <Field label="GPA"                 value={lead.gpa}/>
                <Field label="Immigration History" value={lead.immigrationHistory}/>
                <Field label="Sponsor Income"      value={lead.sponsorIncome}/>
                <Field label="Income Evidence"     value={lead.incomeEvidence}/>
                <Field label="Study Plan & Gap"    value={lead.studyPlanGap}/>
                <Field label="Ultimate Objective"  value={lead.ultimateObjective}/>
              </div>
            )}
          </div>

          {/* Career Fit / OCEAN */}
          <div className="section-card">
            <div className="section-header" style={{ justifyContent:'space-between' }}>
              <span className="section-title">Career Fit — OCEAN Profile</span>
              {canRecalc && !editMode && oceanAnsweredCount === 15 && (
                <button className="btn btn--secondary btn--sm" onClick={handleRecalculateOcean} disabled={recalcOcean}>
                  <FiRefreshCw size={12}/> {recalcOcean ? 'Recalculating...' : 'Recalculate'}
                </button>
              )}
            </div>

            {oceanResult ? (
              <div style={{ marginBottom:'1rem' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3rem', alignItems:'start', marginBottom:'1rem' }}>

                  {/* LEFT: radar chart + single bar-style trait table */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'12px' }}>
                    <svg width="200" height="195" viewBox="-15 0 230 195" style={{ overflow:'visible' }}>
                      {(() => {
                        const cx=100, cy=100, r=70;
                        const keys = ['extraversion','agreeableness','conscientiousness','neuroticism','openness'];
                        const angles = keys.map((_,i) => (Math.PI*2*i)/5 - Math.PI/2);
                        const pt = (a, rad) => [cx + rad*Math.cos(a), cy + rad*Math.sin(a)];
                        const rings = [0.33,0.67,1.0];
                        const scorePoints = keys.map((k,i) => {
                          const v = Math.max(0, Math.min(15, Number(oceanResult.scores[k])||0));
                          return pt(angles[i], (v/15)*r);
                        });
                        const labels = ['Extraversion','Agree.','Conscient.','Neurotic.','Open.'];
                        const offsets = [{dx:0,dy:-14},{dx:14,dy:0},{dx:8,dy:14},{dx:-8,dy:14},{dx:-18,dy:0}];
                        const anchors = ['middle','start','middle','middle','end'];
                        return (<>
                          {rings.map((ratio,ri) => (
                            <polygon key={ri} points={angles.map(a=>pt(a,r*ratio).join(',')).join(' ')} fill="none" stroke="#e5e7eb" strokeWidth={ri===2?1:0.5}/>
                          ))}
                          {angles.map((a,i) => { const [x,y]=pt(a,r); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" strokeWidth="0.5"/>; })}
                          <polygon points={scorePoints.map(p=>p.join(',')).join(' ')} fill="rgba(234,170,60,0.2)" stroke="#EAA83C" strokeWidth="1.5"/>
                          {scorePoints.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3" fill="#EAA83C"/>)}
                          {labels.map((label,i) => {
                            const [bx,by]=pt(angles[i],r+14);
                            const {dx,dy}=offsets[i];
                            return <text key={i} x={bx+dx} y={by+dy} textAnchor={anchors[i]} fontSize="11" fill="#6b7280">{label}</text>;
                          })}
                        </>);
                      })()}
                    </svg>
                    <div style={{ width:'90%' }}>
                      {['extraversion','agreeableness','conscientiousness','neuroticism','openness'].map(k => {
                        const score = Number(oceanResult.scores[k]) || 0;
                        const lv = score >= 12 ? { label:'High', color:'var(--primary)' }
                                 : score >= 7  ? { label:'Average', color:'#EAA83C' }
                                 :               { label:'Low', color:'var(--text-secondary)' };
                        const pct = Math.round((score/15)*100);
                        return (
                          <div key={k} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'3px 0', borderBottom:'1px solid var(--border)', fontSize:'12px' }}>
                            <span style={{ width:'120px', color:'var(--text-secondary)', textTransform:'capitalize', flexShrink:0 }}>{k}</span>
                            <div style={{ flex:1, height:'6px', background:'var(--border)', borderRadius:'3px', overflow:'hidden' }}>
                              <div style={{ width:`${pct}%`, height:'100%', background:lv.color, borderRadius:'3px' }}/>
                            </div>
                            <span style={{ width:'56px', textAlign:'right', fontWeight:600, color:lv.color, flexShrink:0 }}>{lv.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* RIGHT: archetype */}
                  {oceanResult.archetype && (() => {
                    const arch   = oceanResult.archetype;
                    const colors = oceanResult.colors || GROUP_COLORS[arch.group] || { badge:'#4F46E5' };
                    return (
                      <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                        <span style={{ display:'inline-block', background:colors.badge, color:'#fff', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', padding:'3px 10px', borderRadius:'20px', alignSelf:'flex-start' }}>
                          {arch.group}
                        </span>
                        <div style={{ fontSize:'1.125rem', fontWeight:600, color:'var(--text-primary)', lineHeight:1.2 }}>
                          {arch.name}
                        </div>
                        <div>
                          <div style={{ fontSize:'11px', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' }}>Best Career Paths</div>
                          <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                            {arch.careers.map((c, i) => (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'0.8125rem' }}>
                                <span style={{ width:'18px', height:'18px', borderRadius:'50%', background:colors.badge, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:600, flexShrink:0 }}>{i+1}</span>
                                <span style={{ color:'var(--text-primary)' }}>{c}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {oceanResult.flexTraits?.length > 0 && (
                          <div>
                            <div style={{ fontSize:'11px', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' }}>Flex Potential</div>
                            <div style={{ fontSize:'13px', color:'var(--text-secondary)', lineHeight:1.5, marginBottom:'8px' }}>
                              With development these traits could unlock additional archetypes:
                            </div>
                            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                              {oceanResult.flexTraits.map((f, i) => (
                                <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', color:'var(--text-secondary)' }}>
                                  <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#EAA83C', flexShrink:0 }}/>
                                  {f.trait} (score {f.score})
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {oceanResult.narrative && (
                  <p style={{ fontSize:'0.875rem', lineHeight:1.6, color:'var(--text-secondary)', borderTop:'1px solid var(--border)', paddingTop:'1rem' }}>
                    {oceanResult.narrative}
                  </p>
                )}
              </div>
            ) : (
              <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem', marginBottom:'1rem', padding:'0.75rem', background:'var(--bg-secondary)', borderRadius:'8px' }}>
                {oceanAnsweredCount === 0
                  ? 'No OCEAN assessment completed yet.'
                  : `${oceanAnsweredCount}/15 questions answered — recalculate to generate profile.`}
              </div>
            )}

            <div>
              <button className="btn btn--ghost btn--sm" onClick={()=>setShowOceanQuestions(o=>!o)}
                style={{ marginBottom:'0.75rem' }}>
                {showOceanQuestions ? <FiChevronUp size={12}/> : <FiChevronDown size={12}/>}
                {showOceanQuestions ? ' Hide' : ' Show'} Question Responses
              </button>

              {showOceanQuestions && (
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  {OCEAN_QUESTIONS.map(({ id: qid, text }) => {
                    const val = editMode ? (editData[`oceanQ${qid}`] || null) : (lead[`oceanQ${qid}`] || null);
                    return (
                      <div key={qid} style={{
                        display:'grid', gridTemplateColumns:'24px 1fr auto',
                        gap:'0.5rem', alignItems:'center',
                        padding:'0.5rem', borderRadius:'6px',
                        background:'var(--bg-secondary)', fontSize:'0.8125rem',
                      }}>
                        <span style={{
                          background: val ? 'var(--primary)' : 'var(--border)',
                          color: val ? '#fff' : 'var(--text-secondary)',
                          borderRadius:'50%', width:'20px', height:'20px',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:'0.7rem', fontWeight:700, flexShrink:0,
                        }}>{qid}</span>
                        <span style={{ color:'var(--text-primary)' }}>{text}</span>
                        {editMode ? (
                          <select className="form-select"
                            style={{ width:'160px', fontSize:'0.75rem', padding:'0.25rem' }}
                            value={val||''}
                            onChange={e=>updateEdit(`oceanQ${qid}`, e.target.value ? Number(e.target.value) : null)}>
                            <option value="">—</option>
                            {[1,2,3,4,5].map(v=>(
                              <option key={v} value={v}>{v} — {LIKERT_LABELS[v]}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{
                            fontWeight:600, color: val ? 'var(--primary)' : 'var(--text-secondary)',
                            fontSize:'0.8125rem', minWidth:'80px', textAlign:'right',
                          }}>
                            {val ? `${val} — ${LIKERT_LABELS[val]}` : '—'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Family Contacts */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Family Contacts</span></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.8125rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Mother</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  <Field label="Name"           value={lead.motherFullName}/>
                  <Field label="Email"          value={lead.motherEmail}/>
                  <Field label="Phone"          value={lead.motherPhone}/>
                  <Field label="Contact Medium" value={lead.motherContactMedium}/>
                  <Field label="Contact Detail" value={lead.motherContactDetail}/>
                </div>
              </div>
              <div>
                <div style={{ fontWeight:600, fontSize:'0.8125rem', marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Father</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                  <Field label="Name"           value={lead.fatherFullName}/>
                  <Field label="Email"          value={lead.fatherEmail}/>
                  <Field label="Phone"          value={lead.fatherPhone}/>
                  <Field label="Contact Medium" value={lead.fatherContactMedium}/>
                  <Field label="Contact Detail" value={lead.fatherContactDetail}/>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Notes</span></div>
            <div style={{ marginBottom:'1.25rem' }}>
              <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.75rem' }}>
                {Object.entries(NOTE_TYPES).map(([type, label]) => (
                  PERMS.canWriteNote[type]?.includes(role) && (
                    <button key={type}
                      className={`btn btn--sm ${noteType===type?'btn--primary':'btn--secondary'}`}
                      onClick={()=>setNoteType(type)}>
                      {label}
                    </button>
                  )
                ))}
              </div>
              {PERMS.canWriteNote[noteType]?.includes(role) && (
                <div style={{ display:'flex', gap:'0.75rem' }}>
                  <textarea className="form-input" rows={3}
                    placeholder={`Add a ${NOTE_TYPES[noteType]}...`}
                    value={noteText} onChange={e=>setNoteText(e.target.value)}
                    style={{ resize:'vertical', flex:1 }}/>
                  <button className="btn btn--primary btn--icon"
                    onClick={addNote} disabled={addingNote||!noteText.trim()}>
                    <FiSend size={15}/>
                  </button>
                </div>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              {notes.length===0 && <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No notes yet</div>}
              {notes.map(note=>(
                <div key={note.id} style={{
                  padding:'0.875rem', borderRadius:'8px',
                  background:'var(--bg-secondary)', border:'1px solid var(--border)',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <span className={`badge badge--${note.noteType==='management'?'director':note.noteType==='presales'?'manager':'counselor'}`}>
                        {NOTE_TYPES[note.noteType]}
                      </span>
                      <span style={{ fontSize:'0.8125rem', fontWeight:500 }}>{note.authorName}</span>
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontFamily:'DM Mono' }}>
                        {formatDate(note.createdAt)}
                      </span>
                      {note.authorId===staff?.id && (
                        <button className="btn btn--ghost btn--icon btn--sm"
                          onClick={()=>deleteNote(note.id)}
                          style={{ color:'var(--danger)' }}>
                          <FiTrash2 size={13}/>
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize:'0.9375rem', whiteSpace:'pre-wrap' }}>{note.content}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Change History */}
          <div className="section-card">
            <div className="section-header" style={{ cursor:'pointer' }}
              onClick={()=>setShowHistory(h=>!h)}>
              <span className="section-title">Change History ({auditLog.length})</span>
              {showHistory ? <FiChevronUp size={15}/> : <FiChevronDown size={15}/>}
            </div>
            {showHistory && (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {auditLog.length===0 && (
                  <div style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>No changes recorded yet</div>
                )}
                {auditLog.map(entry=>(
                  <div key={entry.id} style={{
                    display:'grid', gridTemplateColumns:'140px 1fr',
                    gap:'0.5rem', padding:'0.5rem 0',
                    borderBottom:'1px solid var(--border)', fontSize:'0.8125rem',
                  }}>
                    <div style={{ color:'var(--text-secondary)' }}>
                      <div style={{ fontFamily:'DM Mono', fontSize:'0.75rem' }}>{formatDate(entry.changedAt)}</div>
                      <div style={{ fontWeight:500, marginTop:'0.125rem' }}>{entry.changedBy}</div>
                    </div>
                    <div>
                      <span style={{ fontWeight:500 }}>{FIELD_LABELS[entry.fieldName]||entry.fieldName}</span>
                      <div style={{ marginTop:'0.25rem', display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                        <span style={{ background:'var(--bg-secondary)', padding:'0.125rem 0.5rem', borderRadius:'4px', color:'var(--danger)', fontSize:'0.75rem', textDecoration:'line-through' }}>
                          {entry.oldValue||'—'}
                        </span>
                        <span style={{ color:'var(--text-secondary)', fontSize:'0.75rem' }}>→</span>
                        <span style={{ background:'var(--bg-secondary)', padding:'0.125rem 0.5rem', borderRadius:'4px', color:'#16a34a', fontSize:'0.75rem' }}>
                          {entry.newValue||'—'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem', position:'sticky', top:'72px' }}>

          {/* Top panel: Stone image + Risk score + Last 5 Notes */}
          <div className="section-card">
            <div className="section-header"><span className="section-title">Summary</span></div>

            {/* Stone image + Risk score row */}
            <div style={{
              display:'flex', alignItems:'center', gap:'1rem',
              paddingBottom:'0.875rem',
              borderBottom:'1px solid var(--border)', marginBottom:'0.875rem',
            }}>
              <div style={{ textAlign:'center', flexShrink:0 }}>
                {lead.stoneTier && STONE_IMAGES[lead.stoneTier] ? (
                  <img src={STONE_IMAGES[lead.stoneTier]} alt={lead.stoneTier}
                    style={{ width:'72px', height:'72px', objectFit:'contain' }}/>
                ) : (
                  <div style={{
                    width:'72px', height:'72px', borderRadius:'8px',
                    background:'var(--bg-secondary)', border:'2px dashed var(--border)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:'var(--text-secondary)', fontSize:'0.75rem',
                  }}>—</div>
                )}
                <div style={{ fontSize:'0.7rem', color:'var(--text-secondary)', marginTop:'0.25rem', fontWeight:500 }}>
                  {lead.stoneTier || 'Unscored'}
                </div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500 }}>Risk Score</div>
                <div style={{ fontSize:'1.75rem', fontWeight:600, lineHeight:1.1, marginTop:'0.125rem' }}>
                  {lead.riskScore || '—'}
                </div>
              </div>
            </div>

            {/* OCEAN Archetype summary (only if test has been taken) */}
            {oceanResult?.archetype && (
              <div style={{
                paddingBottom:'0.875rem',
                borderBottom:'1px solid var(--border)', marginBottom:'0.875rem',
              }}>
                <div style={{
                  fontSize:'0.75rem', color:'var(--text-secondary)',
                  fontWeight:500, marginBottom:'0.375rem',
                }}>
                  OCEAN Archetype
                </div>
                <div style={{
                  padding:'0.625rem 0.75rem', borderRadius:'8px',
                  background: oceanResult.colors?.bg       || 'var(--bg-secondary)',
                  border:    `1px solid ${oceanResult.colors?.border || 'var(--border)'}`,
                  color:      oceanResult.colors?.text     || 'var(--text-primary)',
                }}>
                  <div style={{
                    fontSize:'0.7rem', fontWeight:600,
                    textTransform:'uppercase', letterSpacing:'0.03em',
                    color: oceanResult.colors?.badge || 'var(--text-secondary)',
                    marginBottom:'0.125rem',
                  }}>
                    {oceanResult.archetype.group}
                  </div>
                  <div style={{ fontSize:'0.9375rem', fontWeight:600, lineHeight:1.2 }}>
                    {oceanResult.archetype.name}
                  </div>
                </div>
              </div>
            )}

            {/* Last 5 Notes */}
            <div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)', fontWeight:500, marginBottom:'0.5rem' }}>
                Last 5 Notes
              </div>
              <div style={{
                display:'flex', flexDirection:'column', gap:'0.5rem',
                maxHeight:'280px', overflowY:'auto', paddingRight:'0.25rem',
              }}>
                {notes.length === 0 && (
                  <div style={{ fontSize:'0.8125rem', color:'var(--text-secondary)' }}>No notes yet</div>
                )}
                {notes.slice(0, 5).map(note => (
                  <div key={note.id} style={{
                    padding:'0.5rem 0.625rem', borderRadius:'6px',
                    background:'var(--bg-secondary)', border:'1px solid var(--border)',
                    fontSize:'0.8125rem',
                  }}>
                    <div style={{
                      fontSize:'0.7rem', color:'var(--text-secondary)',
                      fontFamily:'DM Mono', marginBottom:'0.25rem',
                    }}>
                      {formatDate(note.createdAt)}
                    </div>
                    <div style={{ whiteSpace:'pre-wrap', lineHeight:1.4 }}>{note.content}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom panel: Staff Assignment with inline labels */}
          {canAssign && (
            <div className="section-card">
              <div className="section-header"><span className="section-title">Staff Assignment</span></div>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.625rem' }}>
                {[
                  { key:'counselor',       label:'Counselor' },
                  { key:'seniorCounselor', label:'Senior Counselor' },
                  { key:'presales',        label:'Pre-Sales' },
                  { key:'marketingStaff',  label:'Marketing Staff' },
                ].map(({ key, label }) => (
                  <div key={key} style={{
                    display:'flex', alignItems:'center', gap:'0.75rem',
                  }}>
                    <label style={{
                      flex:'0 0 115px', fontSize:'0.8125rem',
                      color:'var(--text-secondary)', fontWeight:500,
                    }}>{label}</label>
                    <select className="form-select" style={{ flex:1, minWidth:0 }}
                      value={assign[key]||''}
                      onChange={e=>setAssign(a=>({...a,[key]:e.target.value}))}>
                      <option value="">Unassigned</option>
                      {staffList.map(s=>(
                        <option key={s.id} value={s.fullName}>{s.fullName} ({s.position})</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
