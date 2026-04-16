// client/src/components/Tabs/CareerFitTab.jsx
// CHANGES:
//   - Radar chart labels now bilingual via language prop
//   - calculateOcean API call now passes language for bilingual narrative
//   - Responsive result layout: 2 columns on desktop, 1 column on mobile

import { useState } from 'react';
import { studentAPI } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';
import { t } from '../../i18n';
import { getArchetype } from '../../utils/oceanArchetypes';

const QUESTION_KEYS = [
  'ocean_q1',  'ocean_q2',  'ocean_q3',  'ocean_q4',  'ocean_q5',
  'ocean_q6',  'ocean_q7',  'ocean_q8',  'ocean_q9',  'ocean_q10',
  'ocean_q11', 'ocean_q12', 'ocean_q13', 'ocean_q14', 'ocean_q15',
];

// Trait labels per language — order matches radar angles
const TRAIT_LABELS = {
  en: ['Extraversion', 'Agreeableness', 'Conscientiousness', 'Neuroticism', 'Openness'],
  vi: ['Hướng ngoại',  'Dễ chịu',       'Tận tâm',           'Nhạy cảm',   'Cởi mở'],
};

// Trait keys matching the same order
const TRAIT_KEYS = ['extraversion', 'agreeableness', 'conscientiousness', 'neuroticism', 'openness'];

function LikertScale({ questionId, value, onChange, labels }) {
  return (
    <div style={{ display:'flex', gap:'0.35rem', flexWrap:'wrap', marginTop:'0.5rem' }}>
      {labels.map((label, idx) => {
        const v = idx + 1;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(questionId, v)}
            style={{
              flex:1, minWidth:'55px', padding:'0.5rem 0.25rem',
              border: `2px solid ${value === v ? 'var(--primary, #2563EB)' : 'var(--border, #e5e7eb)'}`,
              borderRadius:'8px', background: value === v ? 'var(--primary, #2563EB)' : 'transparent',
              color: value === v ? '#fff' : 'var(--text-secondary, #6b7280)',
              cursor:'pointer', fontSize:'0.75rem', fontWeight: value === v ? 600 : 400,
              transition:'all 0.15s',
            }}>
            <div style={{ fontWeight:700, fontSize:'1rem', marginBottom:'0.125rem' }}>{v}</div>
            <div style={{ fontSize:'0.65rem', lineHeight:1.2 }}>{label}</div>
          </button>
        );
      })}
    </div>
  );
}

function RadarChart({ scores, language }) {
  const cx = 105, cy = 100, r = 75;
  const labels = TRAIT_LABELS[language] || TRAIT_LABELS.en;

  const traits = TRAIT_KEYS.map((key, i) => ({ key, label: labels[i] }));
  const angles = traits.map((_, i) => (Math.PI * 2 * i) / 5 - Math.PI / 2);

  function pt(angle, radius) {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  }

  const gridRings = [0.33, 0.67, 1.0];
  const scorePoints = traits.map((tr, i) => {
    const val = Math.max(0, Math.min(15, Number(scores[tr.key]) || 0));
    return pt(angles[i], (val / 15) * r);
  });

  const labelOffsets = [
    { dx: 0,    dy: -14 },
    { dx: 14,   dy: 0   },
    { dx: 10,   dy: 14  },
    { dx: -10,  dy: 14  },
    { dx: -18,  dy: 0   },
  ];

  const anchors = ['middle', 'start', 'middle', 'middle', 'end'];

  return (
    <svg width="220" height="215" viewBox="0 0 210 210" style={{ overflow:'visible' }}>
      {gridRings.map((ratio, ri) => (
        <polygon key={ri}
          points={angles.map(a => pt(a, r * ratio).join(',')).join(' ')}
          fill="none" stroke="var(--border, #e5e7eb)" strokeWidth={ri === 2 ? 1 : 0.5}/>
      ))}
      {angles.map((a, i) => {
        const [x, y] = pt(a, r);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border, #e5e7eb)" strokeWidth="0.5"/>;
      })}
      <polygon
        points={scorePoints.map(p => p.join(',')).join(' ')}
        fill="rgba(234,170,60,0.2)" stroke="#EAA83C" strokeWidth="1.5"/>
      {scorePoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#EAA83C"/>
      ))}
      {traits.map((tr, i) => {
        const [bx, by] = pt(angles[i], r + 14);
        const { dx, dy } = labelOffsets[i];
        return (
          <text key={i} x={bx + dx} y={by + dy}
            textAnchor={anchors[i]} fontSize="10.5"
            fill="var(--text-secondary, #6b7280)">
            {tr.label}
          </text>
        );
      })}
    </svg>
  );
}

function getLevel(score) {
  if (score >= 12) return { label: 'High',    color: 'var(--primary, #2563EB)' };
  if (score >= 7)  return { label: 'Average', color: '#EAA83C' };
  return               { label: 'Low',     color: 'var(--text-secondary, #6b7280)' };
}

export default function CareerFitTab({ formData, updateField, saveAll, onStudentUpdated }) {
  const { language } = useLanguage();
  const scaleLabels = t('careerFitScaleLabels', language);

  const [responses, setResponses] = useState(() => {
    const r = {};
    for (let i = 1; i <= 15; i++) {
      r[i] = formData[`oceanQ${i}`] ? Number(formData[`oceanQ${i}`]) : null;
    }
    return r;
  });

  const [result, setResult] = useState(() => {
    if (formData.oceanExtraversion) {
      return {
        scores: {
          extraversion:      Number(formData.oceanExtraversion),
          agreeableness:     Number(formData.oceanAgreeableness),
          conscientiousness: Number(formData.oceanConscientiousness),
          neuroticism:       Number(formData.oceanNeuroticism),
          openness:          Number(formData.oceanOpenness),
        },
        narrative: formData.oceanNarrative || '',
      };
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
    if (!allAnswered) { setError(t('careerFitComplete', language)); return; }
    setError('');
    setCalculating(true);
    try {
      const questionData = {};
      for (let i = 1; i <= 15; i++) {
        questionData[`oceanQ${i}`] = responses[i] || null;
      }
      await studentAPI.update(formData.uniqueId, questionData);

      // Pass language so server generates narrative in the right language
      const res = await studentAPI.calculateOcean(formData.uniqueId, language);
      const scores    = res.data.scores;
      const narrative = res.data.narrative || '';

      const archetypeData = getArchetype(scores, language);

      setResult({ scores, narrative });

      updateField('oceanExtraversion',      scores.extraversion);
      updateField('oceanAgreeableness',     scores.agreeableness);
      updateField('oceanConscientiousness', scores.conscientiousness);
      updateField('oceanNeuroticism',       scores.neuroticism);
      updateField('oceanOpenness',          scores.openness);
      updateField('oceanNarrative',         narrative);
      updateField('oceanArchetype',         archetypeData.archetype?.name || '');

      setTimeout(() => {
        document.querySelector('.ocean-result-banner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      setError(err.message || 'Calculation failed. Please try again.');
    } finally {
      setCalculating(false);
    }
  }

  const fallbackColors = { bg:'#F0F4FF', border:'#C7D2FE', badge:'#4F46E5', text:'#3730A3' };
  const traitLabels = TRAIT_LABELS[language] || TRAIT_LABELS.en;

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('careerFitTitle', language)}</h2>
        <p style={{ color:'var(--text-secondary)', fontSize:'0.875rem', marginTop:'0.25rem' }}>
          {t('careerFitSubtitle', language)}
        </p>
      </div>

      {result ? (
        <div className="ocean-result-banner" style={{
          background:'var(--bg-secondary)', borderRadius:'12px',
          padding:'1.5rem', marginBottom:'1.5rem', border:'1px solid var(--border)',
        }}>
          {(() => {
            const archetypeData = getArchetype(result.scores, language);
            const arch   = archetypeData.archetype;
            const colors = archetypeData.colors || fallbackColors;
            const flex   = archetypeData.flexTraits || [];
            return (
              <>
                <div style={{
                  display:'grid',
                  gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))',
                  gap:'1.5rem',
                  alignItems:'start',
                }}>
                  {/* LEFT: radar + trait bars */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'12px' }}>
                    <RadarChart scores={result.scores} language={language}/>
                    <div style={{ width:'100%' }}>
                      {TRAIT_KEYS.map((k, i) => {
                        const score = Number(result.scores[k]) || 0;
                        const lv    = getLevel(score);
                        const pct   = Math.round((score / 15) * 100);
                        return (
                          <div key={k} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'3px 0', borderBottom:'1px solid var(--border, #e5e7eb)', fontSize:'12px' }}>
                            <span style={{ width:'120px', color:'var(--text-secondary)', flexShrink:0 }}>{traitLabels[i]}</span>
                            <div style={{ flex:1, height:'6px', background:'var(--border, #e5e7eb)', borderRadius:'3px', overflow:'hidden' }}>
                              <div style={{ width:`${pct}%`, height:'100%', background:lv.color, borderRadius:'3px' }}/>
                            </div>
                            <span style={{ width:'56px', textAlign:'right', fontWeight:600, color:lv.color, flexShrink:0 }}>{lv.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* RIGHT: archetype */}
                  {arch && (
                    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                      <span style={{ display:'inline-block', background:colors.badge, color:'#fff', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', padding:'3px 10px', borderRadius:'20px', alignSelf:'flex-start' }}>
                        {arch.group}
                      </span>
                      <div style={{ fontSize:'18px', fontWeight:600, color:'var(--text-primary)', lineHeight:1.2 }}>
                        {arch.name}
                      </div>
                      <div>
                        <div style={{ fontSize:'11px', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' }}>
                          {t('careerFitBestCareers', language)}
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
                          {arch.careers.map((c, i) => (
                            <div key={i} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'13px' }}>
                              <span style={{ width:'18px', height:'18px', borderRadius:'50%', background:colors.badge, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:600, flexShrink:0 }}>{i+1}</span>
                              <span style={{ color:'var(--text-primary)' }}>{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {flex.length > 0 && (
                        <div>
                          <div style={{ fontSize:'11px', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' }}>
                            {t('careerFitFlexPotential', language)}
                          </div>
                          <div style={{ fontSize:'13px', color:'var(--text-secondary)', lineHeight:1.5, marginBottom:'8px' }}>
                            {t('careerFitFlexDesc', language)}
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                            {flex.map((f, i) => (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', color:'var(--text-secondary)' }}>
                                <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#EAA83C', flexShrink:0 }}/>
                                {f.trait} ({f.score})
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Narrative — full width below */}
                {result.narrative && (
                  <p style={{ marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid var(--border)', fontSize:'0.9rem', lineHeight:1.6, color:'var(--text-secondary)' }}>
                    {result.narrative}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <div style={{
          background:'var(--bg-secondary)', borderRadius:'12px',
          padding:'1.25rem', marginBottom:'1.5rem',
          border:'1px solid var(--border)', textAlign:'center',
          color:'var(--text-secondary)', fontSize:'0.875rem',
        }}>
          {t('careerFitComplete', language)}
          <div style={{ marginTop:'0.5rem', fontSize:'0.8125rem' }}>
            {answeredCount}{t('careerFitAnsweredOf', language)}
          </div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
        {QUESTION_KEYS.map((key, idx) => {
          const id = idx + 1;
          return (
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
                <p style={{ margin:0, fontSize:'0.9375rem', lineHeight:1.5 }}>{t(key, language)}</p>
              </div>
              <LikertScale questionId={id} value={responses[id]} onChange={handleResponse} labels={scaleLabels}/>
            </div>
          );
        })}
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
          {calculating
            ? t('careerFitCalculating', language)
            : `${t('careerFitCalculate', language)}${!allAnswered ? ` (${answeredCount}/15)` : ''}`
          }
        </button>
      </div>
    </div>
  );
}
