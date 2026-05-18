import { useApp } from '../../state/appStore';

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  projects: 'Projects',
  contacts: 'Contacts',
  calendar: 'Calendar',
  inbox: 'Inbox',
  chat: 'Ask Ely',
  soc: 'SOC Dictation',
  notices: 'Notices',
  awards: 'Awards',
  invoices: 'Invoices',
  settings: 'Settings',
};

export default function TopBar({ currentView, onMenuToggle, onNavigate }) {
  const { state } = useApp();
  const { currentUser, settings } = state;

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="burger" onClick={onMenuToggle}>☰</button>
        <h2>{VIEW_TITLES[currentView] || currentView}</h2>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onNavigate('chat')}
          style={{ gap: 5 }}
        >
          ✨ Ask Ely
        </button>
        {currentUser && (
          <div
            style={{
              width: 30, height: 30, borderRadius: '50%', background: 'var(--blue-bg)',
              border: '1px solid var(--border2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--blue)',
              cursor: 'pointer', flexShrink: 0,
            }}
            onClick={() => onNavigate('settings')}
            title={currentUser.email}
          >
            {(currentUser.email || '?')[0].toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}
