import { Navigate, useNavigate } from 'react-router-dom';
import { useWizard } from '../context/WizardContext';
import { Screen } from '../layout/Shell';
import { IconArrowRight } from '../components/Icons';
import { NavButton, PillButton } from '../components/ui';
import { STONE_TIERS } from '../../utils/formFields';
import { t } from '../../i18n';
import agate from '../../Assets/Stones/agate.png';
import diamond from '../../Assets/Stones/diamond.png';
import quartz from '../../Assets/Stones/quartz.png';
import ruby from '../../Assets/Stones/ruby.png';
import sapphire from '../../Assets/Stones/sapphire.png';

// Interim art: the 256px stone PNGs already in the repo (Hoàng's hi-res set replaces them).
const GEM_IMG = { Quartz: quartz, Agate: agate, Sapphire: sapphire, Ruby: ruby, Diamond: diamond };

// The stored copy opens with "Chúc mừng Bạn!" — the design starts at the description.
const stripCongrats = (s) => String(s || '').replace(/^\s*(Chúc mừng Bạn!|Congratulations!?)\s*/i, '');

// Highlight the closing call to action ("hãy liên hệ NGAY!" / "contact us NOW!").
function withCta(text) {
  const m = text.match(/(hãy liên hệ[^!]*!|contact[^!]*NOW!)\s*$/i);
  if (!m) return text;
  return <>{text.slice(0, m.index)}<b className="wz-hl">{m[1]}</b></>;
}

export default function GemResult() {
  const navigate = useNavigate();
  const { language, w, student } = useWizard();
  const tier = student && student.stoneTier;
  if (!tier || !GEM_IMG[tier]) return <Navigate to="/app/step/2" replace />;

  const color = (STONE_TIERS.find((s) => s.name === tier) || {}).color || '#141414';
  return (
    <Screen>
      <PillButton icon={<IconArrowRight style={{ transform: 'scaleX(-1)' }} />} onClick={() => navigate('/app/step/2')}>
        {w('retakeGem')}
      </PillButton>
      <h1 className="wz-pagetitle">{w('gemTitle')}</h1>
      <div className="wz-gem">
        <img src={GEM_IMG[tier]} alt="" />
        <div>
          <p className="wz-gem-name" style={{ color }}>{t(`stone_${tier}`, language).toUpperCase()}</p>
          <p className="wz-gem-desc">{withCta(stripCongrats(t(`stoneSubtitle_${tier}`, language)))}</p>
        </div>
      </div>
      <div className="wz-center">
        <NavButton onClick={() => navigate('/app/step/3')}>{w('next')}</NavButton>
      </div>
    </Screen>
  );
}
