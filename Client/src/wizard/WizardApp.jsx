import { Navigate, Route, Routes } from 'react-router-dom';
import { WizardProvider, useWizard } from './context/WizardContext';
import Splash from './screens/Splash';
import Register from './screens/Register';
import Hub from './screens/Hub';
import Step1 from './screens/Step1';
import Step2Quiz from './screens/Step2Quiz';
import Step3Quiz from './screens/Step3Quiz';
import GemResult from './screens/GemResult';
import CareerResult from './screens/CareerResult';
import Congrats from './screens/Congrats';
import './wizard.css';

// Everything behind the hub needs a student in this session; otherwise → registration.
function RequireStudent({ children }) {
  const { status, w } = useWizard();
  if (status === 'loading') return <div className="wz-frame"><p className="wz-loading">{w('loading')}</p></div>;
  if (status === 'none') return <Navigate to="/app/reg" replace />;
  return children;
}

export default function WizardApp() {
  return (
    <div className="wz">
      <WizardProvider>
        <Routes>
          <Route index element={<Splash />} />
          <Route path="reg" element={<Register />} />
          <Route path="hub" element={<RequireStudent><Hub /></RequireStudent>} />
          <Route path="step/1" element={<RequireStudent><Step1 /></RequireStudent>} />
          <Route path="step/2" element={<RequireStudent><Step2Quiz /></RequireStudent>} />
          <Route path="step/3" element={<RequireStudent><Step3Quiz /></RequireStudent>} />
          <Route path="result/gem" element={<RequireStudent><GemResult /></RequireStudent>} />
          <Route path="result/career" element={<RequireStudent><CareerResult /></RequireStudent>} />
          <Route path="done" element={<RequireStudent><Congrats /></RequireStudent>} />
          <Route path="step/:n" element={<Navigate to="/app/hub" replace />} />
          <Route path="result/:kind" element={<Navigate to="/app/hub" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </WizardProvider>
    </div>
  );
}
