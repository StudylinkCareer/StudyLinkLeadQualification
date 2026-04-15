// client/src/components/Tabs/CareerFitTab.jsx
// CHANGES:
//   - Added archetype calculation using oceanArchetypes.js
//   - Shows archetype name, group, and top 3 careers after calculate
//   - Flex trait warnings shown when score is borderline
//   - Archetype saved to DB via studentAPI.update

import { useState } from 'react';
import { studentAPI } from '../../services/api';
import OceanRadarChart from '../OceanRadarChart';
import { getArchetype } from '../../utils/oceanArchetypes';

const QUESTIONS = [
  { id: 1,  text: 'I am the life of the party and enjoy being the center of attention.' },
  { id: 2,  text: "I sympathize with others' feelings and feel for those less fortunate." },
  { id: 3,  text: 'I am always prepared and keep my belongings organized.' },
  { id: 4,  text: 'I have frequent mood swings and get stressed easily.' },
  { id: 5,  text: 'I have a vivid imagination and enjoy thinking about abstract ideas.' },
  { id: 6,  text: "I don't talk a lot and tend to keep to myself." },
  { id: 7,  text: "I am not really interested in others' problems or feelings." },
  { id: 8,  text: 'I often forget to put things back in their proper place.' },
  { id: 9,  text: "I am relaxed most of the time and don't worry much." },
  { id: 10, text: 'I am not interested in theoretical or philosophical discussions.' },
  { id: 11, text: 'I feel comfortable around people and start conversations easily.' },
  { id: 12, text: 'I have a soft heart and try to make people feel at ease.' },
  { id: 13, text: 'I pay attention to details and like to get chores done right away.' },
  { id: 14, text: 'I get upset easily and often feel blue or anxious.' },
  { id: 15, text: 'I enjoy hearing new ideas and looking at art or nature.' },
];

const SCALE_LABELS = [
  { value: 1, label: 'Strongly Disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly Agree' },
];

function LikertScale({ questionId, value, onChange }) {
  return (
    <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginTop:'0.5rem' }}>
      {SCALE_LABELS.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(questionId, v)}
          style={{
            flex:1, minWidth:'80px', padding:'0.5rem 0.25rem',
            border: `2px solid ${value === v ? 'var(--primary, #2563EB)' : 'var(--border, #e5e7eb)'}`,
            borderRadius:'8px', background: value === v ? 'var(--primary, #2563EB)' : 'transparent',
            color: value === v ? '#fff' : 'var(--text-secondary, #6b7280)',
            cursor:'pointer', fontSize:'0.75rem', fontWeight: value === v ? 600 : 400,
            transition:'all 0.15s',
          }}>
          <div style={{ fontWeight:700, fontSize:'1rem', marginBottom:'0.125rem' }}>{v}</div>
          <div style={{ fontSize:'0.65rem', lineHeight:1.2 }}>{label}</div>
        </button>
      ))}
    </div>
  );
}

function ArchetypeCard({ archetype, flexTraits, colors }) {
  if (!archetype) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
      maxWidth: '280px',
    }}>
      <span style={{
        display: 'inline-block', background: colors.badge, color: '#fff',
        fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.5px', padding: '0.2rem 0.6rem',
        borderRadius: '20px', alignSelf: 'flex-start',
      }}>
        {archetype.group}
      </span>

      <div style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {archetype.name}
      </div>

      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Best Career Paths
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {archetype.careers.map((career, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
              <span style={{
                width: '20px', height: '20px', borderRadius: '50%',
                background: colors.badge, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
              }}>{i + 1}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{career}</span>
            </div>
          ))}
        </div>
      </div>

      {flexTraits.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: '8px',
          padding: '0.625rem 0.875rem', fontSize: '0.8rem', color: 'var(--text-secondary)',
        }}>
          <span style={{ fontWeight: 600 }}>💡 Flex potential: </span>
          {flexTraits.map((f, i) => (
            <span key={i}>{f.trait} (score {f.score}){i < flexTraits.length - 1 ? ', ' : ''}</span>
          ))}
          {' '}— with development these traits could unlock additional archetypes.
        </div>
      )}
    </div>
  );
}

export default function CareerFitTab({ formData, updateField, saveAll }) {
  const [responses, setResponses] = useState(() => {
    const r = {};
    for (let i = 1; i <= 15; i++) {
      r[i] = formData[`oceanQ${i}`] ? Number(formData[`oceanQ${i}`]) : null;
    }
    return r;
  });

  const [result, setResult] = useState(() => {
    if (formData.oceanExtraversion) {
      const scores = {
        extraversion:      Number(formData.oceanExtraversion),
        agreeableness:     Number(formData.oceanAgreeableness),
        conscientiousness: Number(formData.oceanConscientiousness),
        neuroticism:       Number(formData.oceanNeuroticism),
        openness:          Number(formData.oceanOpenness),
      };
      return { scores, narrative: formData.oceanNarrative || '', ...getArchetype(scores) };
    }
    return null;
  });

  const [calculating, setCalculating] = useState(false);
  const [error, setError]             = useState('');

  function handleResponse(questionId, value) {
    setResponses(r => ({ ...r, [questionId]: value }));
    updateField(`oceanQ${questionId}`, value);
    setResult(null);
  }

  const answeredCount = Object.values(responses).filter(v => v !== null).length;
  const allAnswered   = answeredCount === 15;

  async function handleCalculate() {
    if (!allAnswered) { setError('Please answer all 15 questions before calculating.'); return; }
    setError('');
    setCalculating(true);
    try {
      if (saveAll) await saveAll();
      const res = await studentAPI.calculateOcean(formData.uniqueId);
      const scores = res.data.scores;
      const archetypeData = getArchetype(scores);

      if (archetypeData.archetype) {
        await studentAPI.update(formData.uniqueId, { oceanArchetype: archetypeData.archetype.name });
        updateField('oceanArchetype', archetypeData.archetype.name);
      }

      setResult({ ...res.data, ...archetypeData });
      setTimeout(() => {
        document.querySelector('.ocean-result-banner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      setError(err.message || 'Calculation failed');
    } finally {
      setCalculating(false);
    }
  }

  const fallbackColors = { bg:'#F0F4FF', border:'#C7D2FE', badge:'#4F46E5', text:'#3730A3' };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Career Fit Assessment</h2>
        <p style={{ color:'var(--text-secondary)', fontSize:'0.875rem', marginTop:'0.25rem' }}>
          Rate each statement on a scale of 1 (Strongly Disagree) to 5 (Strongly Agree)
        </p>
      </div>

      {result ? (
        <div className="ocean-result-banner" style={{
          background:'var(--bg-secondary)', borderRadius:'12px',
          padding:'1.5rem', marginBottom:'1.5rem', border:'1px solid var(--border)',
        }}>
          {/* Two-column layout: chart left, archetype right */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.5rem', alignItems:'start' }}>
            {/* Left: chart + trait scores */}
            <div>
              <OceanRadarChart scores={result.scores} size={260}/>
            </div>
            {/* Right: archetype card */}
            <ArchetypeCard
              archetype={result.archetype}
              flexTraits={result.flexTraits || []}
              colors={result.colors || fallbackColors}
            />
          </div>
          {result.narrative && (
            <p style={{ marginTop:'1rem', fontSize:'0.9rem', lineHeight:1.6, color:'var(--text-secondary)', borderTop:'1px solid var(--border)', paddingTop:'1rem' }}>
              {result.narrative}
            </p>
          )}
        </div>
      ) : (
        <div style={{
          background:'var(--bg-secondary)', borderRadius:'12px',
          padding:'1.25rem', marginBottom:'1.5rem',
          border:'1px solid var(--border)', textAlign:'center',
          color:'var(--text-secondary)', fontSize:'0.875rem',
        }}>
          Complete all 15 questions and click Calculate to see your personality profile.
          <div style={{ marginTop:'0.5rem', fontSize:'0.8125rem' }}>{answeredCount}/15 questions answered</div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
        {QUESTIONS.map(({ id, text }) => (
          <div key={id} style={{
            background:'var(--bg-secondary)', borderRadius:'10px',
            padding:'1rem', border:'1px solid var(--border)',
          }}>
            <div style={{ display:'flex', gap:'0.75rem', marginBottom:'0.25rem' }}>
              <span style={{
                background: responses[id] ? 'var(--primary, #2563EB)' : 'var(--border)',
                color: responses[id] ? '#fff' : 'var(--text-secondary)',
                borderRadius:'50%', width:'24px', height:'24px',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.75rem', fontWeight:700, flexShrink:0,
              }}>{id}</span>
              <p style={{ margin:0, fontSize:'0.9375rem', lineHeight:1.5 }}>{text}</p>
            </div>
            <LikertScale questionId={id} value={responses[id]} onChange={handleResponse}/>
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          marginTop:'1rem', padding:'0.75rem 1rem',
          background:'#FEF2F2', border:'1px solid #FECACA',
          borderRadius:'8px', color:'#DC2626', fontSize:'0.875rem',
        }}>
          {error}
        </div>
      )}

      <div style={{ marginTop:'1.5rem', textAlign:'center' }}>
        <button
          className="btn btn--primary btn--lg"
          onClick={handleCalculate}
          disabled={calculating || !allAnswered}>
          {calculating ? 'Calculating...' : `Calculate My Profile${!allAnswered ? ` (${answeredCount}/15)` : ''}`}
        </button>
      </div>
    </div>
  );
}
