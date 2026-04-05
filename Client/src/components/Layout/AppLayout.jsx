import { useAuth } from '../../hooks/useAuth';
import TabBar from './TabBar';

import './AppLayout.css';

export default function AppLayout({ tabs, activeTab, onTabChange, disabledTabs = {}, children }) {
  const { email, uniqueId, logout } = useAuth();

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-title">StudyLink</h1>
          {uniqueId && <span className="app-student-id">ID: {uniqueId}</span>}
        </div>
        <div className="app-header-right">
          <span className="app-user-email">{email}</span>
          <button className="btn btn--ghost btn--sm" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="app-tabs-desktop">
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} disabledTabs={disabledTabs} />
      </div>

      <main className="app-content">
        {children}
      </main>
    </div>
  );
}
