import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { IconHome } from '../components/Icons';
import { NavButton, PillButton } from '../components/ui';
import QuizCard from '../components/QuizCard';
import { studentAPI } from '../../services/api';
import { t } from '../../i18n';

const QUESTIONS = Array.from({ length: 15 }, (_, i) => i + 1);

// 15 Likert questions, one shared 5-point scale. Answers are stored as 1–5 in
// oceanQ1..oceanQ15 (the server scores them and stores the traits + persona).
export default function Step3Quiz() {
  const navigate = useNavigate();
  const { language, w, student, patch, flush, reload } = useWizard();
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);

  const labels = t('careerFitScaleLabels', language);
  const scale = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: labels[v - 1] }));
  const valueOf = (n) => Number(student[`oceanQ${n}`]) || null;
  const answered = QUESTIONS.filter((n) => valueOf(n)).length;

  const predict = async () => {
    setMessage('');
    const empty = QUESTIONS.filter((n) => !valueOf(n));
    setMissing(empty);
    if (empty.length) {
      setMessage(w('quizIncomplete').replace('{n}', empty.length));
      const el = document.getElementById(`wz-oq-${empty[0]}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      if (!(await flush())) throw new Error(w('saveFailed'));
      await studentAPI.calculateOcean(student.studentId, language);
      await reload();
      navigate('/app/result/career');
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
        <h1 className="wz-pagetitle">{w('s3Title')}</h1>
        <p className="wz-pagesub">{w('s3Sub1')}<b>{w('s3SubB')}</b>{w('s3Sub2')}</p>
      </div>

      <div className="wz-quizlist">
        {QUESTIONS.map((n, i) => (
          <QuizCard key={n} id={`wz-oq-${n}`} name={`wz-oq${n}`} index={i} total={QUESTIONS.length}
            title={t(`ocean_q${n}`, language)} options={scale} value={valueOf(n)}
            missing={missing.includes(n) && !valueOf(n)}
            srLabel={w('questionOf').replace('{n}', n).replace('{total}', QUESTIONS.length)}
            onChange={(v) => { patch({ [`oceanQ${n}`]: v }); setMissing((m) => m.filter((x) => x !== n)); setMessage(''); }} />
        ))}
      </div>

      {message && <p className="wz-error" role="alert">{message}</p>}
      <p className="wz-count" role="status">{answered}/{QUESTIONS.length}</p>
      <div className="wz-center">
        <NavButton onClick={predict} disabled={busy}>{busy ? w('calculating') : w('predict')}</NavButton>
      </div>
    </Screen>
  );
}
