import './AppLayout.css';

export default function TabBar({ tabs, activeTab, onTabChange, disabledTabs = {} }) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isDisabled = !!disabledTabs[tab.key];
        return (
          <button
            key={tab.key}
            className={`tab-bar-item ${activeTab === tab.key ? 'tab-bar-item--active' : ''} ${isDisabled ? 'tab-bar-item--disabled' : ''}`}
            onClick={() => !isDisabled && onTabChange(tab.key)}
            disabled={isDisabled}
            title={isDisabled ? disabledTabs[tab.key] : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
