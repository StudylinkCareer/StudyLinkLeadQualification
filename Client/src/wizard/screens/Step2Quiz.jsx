import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { IconHome } from '../components/Icons';
import { NavButton, PillButton } from '../components/ui';
import QuizCard from '../components/QuizCard';
import { getTranslatedAssessmentFields } from '../../utils/formFields';
import { studentAPI } from '../../services/api';

// The 9 index questions. Fields, the 5 ordered tiers and their stored ENGLISH codes
// come straight from SELF_ASSESSMENT_FIELDS (same source the server's scoring and
// LeadManagement use); Vietnamese/English labels come from the existing
// `<field>_tier_<value>` i18n keys. Nothing is retyped here.
export default function Step2Quiz() {
  const navigate = useNavigate();
  const { language, w, student, patch, flush, reload, progress } = useWizard();
  const fields = getTranslatedAssessmentFields(language);
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);

  const answered = fields.filter((f) => student[f.key]).length;

  const calculate = async () => {
    setMessage('');
    const empty = fields.filter((f) => !student[f.key]).map((f) => f.key);
    setMissing(empty);
    if (empty.length) {
      setMessage(w('quizIncomplete').replace('{n}', empty.length));
      const el = document.getElementById(`wz-q-${empty[0]}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      if (!(await flush())) throw new Error(w('saveFailed'));
      // Answers are saved (above); score on the server, then read the result back.
      await studentAPI.calculateRisk(student.studentId);
      await reload();
      navigate('/app/result/gem');
    } catch (err) {
      setMessage(err.message || w('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PillButton icon={<IconHome />} onClick={() => navigate('/app/hub')}>{w('home')}</PillButton>
      <div>
        <h1 className="wz-pagetitle">{w('s2Title')}</h1>
        <p className="wz-pagesub">{w('s2Sub1')}<b>{w('s2SubB')}</b>{w('s2Sub2')}</p>
      </div>

      {!progress.step1 && (
        <p className="wz-notice">
          {w('step1First')}
          <button type="button" className="wz-link" style={{ textDecoration: 'underline', fontWeight: 700 }}
            onClick={() => navigate('/app/step/1')}>{w('goStep1')}</button>
        </p>
      )}

      <div className="wz-quizlist">
        {fields.map((f, i) => (
          <QuizCard key={f.key} id={`wz-q-${f.key}`} name={`wz-${f.key}`} index={i} total={fields.length}
            title={f.label} description={f.description} options={f.tiers}
            value={student[f.key]} missing={missing.includes(f.key) && !student[f.key]}
            srLabel={w('questionOf').replace('{n}', i + 1).replace('{total}', fields.length)}
            onChange={(v) => { patch({ [f.key]: v }); setMissing((m) => m.filter((k) => k !== f.key)); setMessage(''); }} />
        ))}
      </div>

      {message && <p className="wz-error" role="alert">{message}</p>}
      <p className="wz-count" role="status">{answered}/{fields.length}</p>
      <div className="wz-center">
        <NavButton onClick={calculate} disabled={busy}>{busy ? w('calculating') : w('calcIndex')}</NavButton>
      </div>
    </Screen>
  );
}
