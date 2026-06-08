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

export default function TopBar({ currentView, onMenuToggle, onNavigate, onOpenNotepad }) {
  const { state } = useApp();

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="burger" onClick={onMenuToggle}>☰</button>
        <h2>{VIEW_TITLES[currentView] || currentView}</h2>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onNavigate('chat')}
          style={{ gap: 5 }}
        >
          ✨ Ask Ely
        </button>
        <button
          onClick={onOpenNotepad}
          title="Notes"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, cursor: 'pointer', flexShrink: 0,
            color: 'var(--text2)',
          }}
        >
          📝
        </button>
      </div>
    </div>
  );
}
