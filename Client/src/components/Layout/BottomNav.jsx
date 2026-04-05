import './AppLayout.css';

export default function BottomNav({ tabs, activeTab, onTabChange, disabledTabs = {} }) {
  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const isDisabled = !!disabledTabs[tab.key];
        return (
          <button
            key={tab.key}
            className={`bottom-nav-item ${activeTab === tab.key ? 'bottom-nav-item--active' : ''} ${isDisabled ? 'bottom-nav-item--disabled' : ''}`}
            onClick={() => !isDisabled && onTabChange(tab.key)}
            disabled={isDisabled}
            title={isDisabled ? disabledTabs[tab.key] : undefined}
          >
            <span className="bottom-nav-icon">{tab.icon}</span>
            <span className="bottom-nav-label">{tab.shortLabel || tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
