// src/components/OceanRadarChart.jsx
// Reusable OCEAN radar chart — works in both Lead Qualification and Lead Management apps.
// Uses recharts RadarChart.

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';

const TRAIT_LABELS = {
  extraversion:      'Extraversion',
  agreeableness:     'Agreeableness',
  conscientiousness: 'Conscientiousness',
  neuroticism:       'Neuroticism',
  openness:          'Openness',
};

const LEVEL_COLORS = {
  high:    '#2563EB',
  average: '#F59E0B',
  low:     '#9CA3AF',
};

function getLevel(score) {
  if (score >= 12) return 'high';
  if (score >= 7)  return 'average';
  return 'low';
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { trait, score, level } = payload[0].payload;
  return (
    <div style={{
      background:'var(--bg-primary, #fff)', border:'1px solid var(--border, #e5e7eb)',
      borderRadius:'8px', padding:'0.5rem 0.75rem', fontSize:'0.8125rem',
    }}>
      <div style={{ fontWeight:600, marginBottom:'0.25rem' }}>{TRAIT_LABELS[trait]}</div>
      <div>Score: <strong>{score}/15</strong></div>
      <div style={{ textTransform:'capitalize', color: LEVEL_COLORS[level] }}>{level}</div>
    </div>
  );
}

export default function OceanRadarChart({ scores, size = 300 }) {
  if (!scores) return null;

  const data = Object.entries(scores).map(([trait, score]) => ({
    trait,
    label: TRAIT_LABELS[trait],
    score: score || 0,
    level: getLevel(score || 0),
    fullMark: 15,
  }));

  // Determine dominant colour based on average level
  const avgScore = data.reduce((sum, d) => sum + d.score, 0) / data.length;
  const radarColor = avgScore >= 12 ? '#2563EB' : avgScore >= 7 ? '#F59E0B' : '#9CA3AF';

  return (
    <div style={{ width:'100%', maxWidth: size, margin:'0 auto' }}>
      <ResponsiveContainer width="100%" height={size}>
        <RadarChart data={data} margin={{ top:10, right:30, bottom:10, left:30 }}>
          <PolarGrid gridType="polygon" stroke="var(--border, #e5e7eb)"/>
          <PolarAngleAxis
            dataKey="label"
            tick={{ fontSize:11, fill:'var(--text-secondary, #6b7280)', fontWeight:500 }}
          />
          <PolarRadiusAxis
            angle={90} domain={[0,15]} tickCount={4}
            tick={{ fontSize:9, fill:'var(--text-secondary, #9ca3af)' }}
          />
          <Radar
            name="OCEAN"
            dataKey="score"
            stroke={radarColor}
            fill={radarColor}
            fillOpacity={0.25}
            strokeWidth={2}
          />
          <Tooltip content={<CustomTooltip />}/>
        </RadarChart>
      </ResponsiveContainer>

      {/* Trait score bars below chart */}
      <div style={{ display:'flex', flexDirection:'column', gap:'0.375rem', marginTop:'0.5rem' }}>
        {data.map(({ trait, label, score, level }) => (
          <div key={trait} style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ fontSize:'0.75rem', width:'130px', color:'var(--text-secondary, #6b7280)', flexShrink:0 }}>{label}</span>
            <div style={{ flex:1, height:'6px', borderRadius:'999px', background:'var(--border, #e5e7eb)', overflow:'hidden' }}>
              <div style={{
                height:'100%', borderRadius:'999px',
                width:`${(score/15)*100}%`,
                background: LEVEL_COLORS[level],
                transition:'width 0.5s ease',
              }}/>
            </div>
            <span style={{
              fontSize:'0.7rem', width:'50px', textAlign:'right',
              color: LEVEL_COLORS[level], fontWeight:500, textTransform:'capitalize',
            }}>{level}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
