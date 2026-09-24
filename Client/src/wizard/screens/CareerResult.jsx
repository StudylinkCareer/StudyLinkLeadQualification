import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { IconArrowRight } from '../components/Icons';
import { NavButton, PillButton } from '../components/ui';
import { TRAITS, traitPercent } from '../lib/traits';
import { getArchetype } from '../../utils/oceanArchetypes';
import { studentAPI } from '../../services/api';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

function TraitBar({ trait, sum, language, w }) {
  const words = trait[language] || trait.vi;
  const pct = traitPercent(sum);
  const pole = pct >= 50 ? words.right : words.left;
  return (
    <div className="wz-trait" role="img" aria-label={`${words.name}: ${pct}% — ${pole}. ${words.left} ↔ ${words.right}`}>
      <div className="wz-trait-label" aria-hidden="true">{words.name}: <b>{pct}% {pole}</b></div>
      <div className="wz-trait-track" aria-hidden="true"><i style={{ left: `${pct}%` }} /></div>
      <div className="wz-trait-ends" aria-hidden="true"><span>{words.left}</span><span>{words.right}</span></div>
    </div>
  );
}

export default function CareerResult() {
  const navigate = useNavigate();
  const { language, w, student, reload } = useWizard();
  const [narrative, setNarrative] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needStep1, setNeedStep1] = useState(false);

  const scored = student && has(student.oceanExtraversion);

  // The stored narrative is in whichever language it was last calculated in; ask the
  // server (read-only) for the text in the language currently shown.
  useEffect(() => {
    if (!scored) return undefined;
    let alive = true;
    studentAPI.oceanNarrative(student.studentId, language)
      .then((res) => { if (alive) setNarrative((res.data && res.data.narrative) || ''); })
      .catch(() => { if (alive) setNarrative(student.oceanNarrative || ''); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, scored]);

  if (!scored) return <Navigate to="/app/step/3" replace />;

  const scores = {
    extraversion: Number(student.oceanExtraversion), agreeableness: Number(student.oceanAgreeableness),
    conscientiousness: Number(student.oceanConscientiousness), neuroticism: Number(student.oceanNeuroticism),
    openness: Number(student.oceanOpenness),
  };
  const { archetype } = getArchetype(scores, language);
  const initial = ((student.fullName || '').trim().split(/\s+/).pop() || '·')[0].toUpperCase();

  const finish = async () => {
    setBusy(true); setMessage(''); setNeedStep1(false);
    try {
      await studentAPI.completeJourney(student.studentId);
      await reload();
      navigate('/app/done');
    } catch (err) {
      if (err.status === 422) setNeedStep1(true);
      else if (err.status === 503) setMessage(w('serviceUpdating'));
      else setMessage(err.message || w('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PillButton icon={<IconArrowRight style={{ transform: 'scaleX(-1)' }} />} onClick={() => navigate('/app/step/3')}>
        {w('retakeCareer')}
      </PillButton>

      <div className="wz-persona">
        <div className="wz-avatar-lg" aria-hidden="true">
          {student.headshotUrl ? <img src={student.headshotUrl} alt="" /> : initial}
        </div>
        {archetype && (
          <>
            <span className="wz-badge">{archetype.group.toUpperCase()}</span>
            <h1 className="wz-persona-name">{archetype.name.toUpperCase()}</h1>
            <ol className="wz-careers">
              {archetype.careers.map((c, i) => <li key={c}><span aria-hidden="true">{i + 1}</span>{c}</li>)}
            </ol>
          </>
        )}
        {narrative && <p className="wz-narrative">{narrative}</p>}
      </div>

      <div className="wz-traits">
        {TRAITS.map((tr) => (
          <TraitBar key={tr.key} trait={tr} sum={student[tr.field]} language={language} w={w} />
        ))}
      </div>

      {needStep1 && (
        <p className="wz-notice">
          {w('careerNeedsStep1')}
          <button type="button" className="wz-link" style={{ textDecoration: 'underline', fontWeight: 700 }}
            onClick={() => navigate('/app/step/1')}>{w('goStep1')}</button>
        </p>
      )}
      {message && <p className="wz-error" role="alert">{message}</p>}
      <div className="wz-center">
        <NavButton onClick={finish} disabled={busy}>{busy ? w('connecting') : w('finish')}</NavButton>
      </div>
    </Screen>
  );
}
