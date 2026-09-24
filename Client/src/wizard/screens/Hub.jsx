import { useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { NavButton } from '../components/ui';
import { IconArrowRight, IconBarChart, IconCertificate, IconUser } from '../components/Icons';

const STEPS = [
  { n: 1, Icon: IconUser, title: 'step1Title', desc: 'step1Desc' },
  { n: 2, Icon: IconBarChart, title: 'step2Title', desc: 'step2Desc' },
  { n: 3, Icon: IconCertificate, title: 'step3Title', desc: 'step3Desc' },
];

// Journey hub: three always-clickable steps. Which mascot/bubble/intro shows follows
// real progress (derived from saved data), not a click counter.
export default function Hub() {
  const navigate = useNavigate();
  const { w, progress } = useWizard();
  const cur = progress.currentStep;
  const done = { 1: progress.step1, 2: progress.step2, 3: progress.step3 };
  // "Bắt đầu thôi": the first step still to do. Everything done but not yet finished →
  // the career result (so they can press "Hoàn thành"); journey complete → final screen.
  const startPath = progress.completed ? '/app/done'
    : !progress.step1 ? '/app/step/1'
    : !progress.step2 ? '/app/step/2'
    : !progress.step3 ? '/app/step/3'
    : '/app/result/career';

  return (
    <Screen>
      <div className="wz-hero">
        <img className="wz-mascot" src={`/wizard/mascot-${cur}.png`} alt="" />
        {cur === 1 ? (
          <>
            <h1 className="wz-hello">{w('hello')}</h1>
            <p className="wz-lead">
              {w('hubLead1')}<span className="wz-hl"><b>{w('hubLeadHl')}</b></span>{w('hubLead2')}
            </p>
          </>
        ) : (
          <p className="wz-thanks"><b>StudyLink</b>{w('thanks1')}</p>
        )}
      </div>

      <p className="wz-bubble">{w(`bubble${cur}`)}</p>

      <ol className="wz-steps">
        {STEPS.map(({ n, Icon, title, desc }) => (
          <li key={n}>
            <button type="button" className="wz-step" onClick={() => navigate(`/app/step/${n}`)}>
              <span className="wz-num" aria-hidden="true">{String(n).padStart(2, '0')}</span>
              <span>
                <span className="wz-step-title">
                  <Icon />{w(title)}
                  {done[n] && <span className="wz-done-tag">✓ {w('stepDone')}</span>}
                </span>
                <span className="wz-step-desc" style={{ display: 'block' }}>{w(desc)}</span>
              </span>
              <span className="wz-go"><IconArrowRight width={14} height={14} /></span>
            </button>
          </li>
        ))}
      </ol>

      <div className="wz-center">
        <NavButton onClick={() => navigate(startPath)}>{w('letsGo')}</NavButton>
      </div>

      <div className="wz-gift">
        <img src="/wizard/gift.png" alt="" />
        <p>{w('gift1')}<b className="wz-hl">{w('giftHl')}</b>{w('gift2')}</p>
      </div>
    </Screen>
  );
}
