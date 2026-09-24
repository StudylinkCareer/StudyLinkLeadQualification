import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { IconShare } from '../components/Icons';
import { NavButton } from '../components/ui';
import ShareDialog from '../components/ShareDialog';
import ContactDialog from '../components/ContactDialog';

// Final "unlocked" screen. Only reachable once the journey is marked complete (the
// server refuses that until Step 1 — a parent and a country — is done).
export default function Congrats() {
  const navigate = useNavigate();
  const { w, student } = useWizard();
  const [dialog, setDialog] = useState(null); // 'share' | 'contact' | null
  if (!student || !student.journeyCompletedAt) return <Navigate to="/app/hub" replace />;

  return (
    <Screen>
      <div className="wz-congrats">
        <p className="wz-cheer" aria-label={`${w('congrats')}!`}>
          🎉 {w('cheer1')}<span className="r">o</span>…<span className="r">o</span> ray…<span className="g">ay</span>…<span className="g">ay</span>… 🎉
        </p>
        <div>
          <p className="wz-who">{w('congrats')}</p>
          <p className="wz-namepill">{student.fullName}</p>
          <p className="wz-who">{w('unlocked')}</p>
        </div>
        <h1 className="wz-unlocked-title">{w('unlockedTitle1')}<br />{w('unlockedTitle2')}</h1>
        <p className="wz-prize">{w('prize1')}<b className="wz-hl">{w('prizeHl')}</b>{w('prize2')}</p>
        <img className="wz-congrats-mascot" src="/wizard/mascot-congrats.png" alt="" />
        <NavButton onClick={() => setDialog('share')}><IconShare width={16} height={16} />{w('shareBtn')}</NavButton>
        <button type="button" className="wz-linkbtn" onClick={() => setDialog('contact')}>{w('roadmap')}</button>
        <button type="button" className="wz-link" style={{ fontSize: 13, textDecoration: 'underline', minHeight: 44 }}
          onClick={() => navigate('/app/hub')}>{w('home')}</button>
      </div>

      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
      {dialog === 'contact' && <ContactDialog onClose={() => setDialog(null)} />}
    </Screen>
  );
}
