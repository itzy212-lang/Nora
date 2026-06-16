import { useApp } from '../../state/appStore';
import { useState, useEffect } from 'react';
import { getAutoPlay, setAutoPlayGlobal } from '../../hooks/useSpeech';

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

export default function TopBar({ currentView, onMenuToggle, onNavigate, onOpenNotepad, onOpenQuickRef }) {
  const { state } = useApp();
  const [autoPlay, setAutoPlayLocal] = useState(() => getAutoPlay());

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    setAutoPlayLocal(next);
    setAutoPlayGlobal(next);
  };

  // Sync if changed from another instance
  useEffect(() => {
    setAutoPlayLocal(getAutoPlay());
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="burger" onClick={onMenuToggle}>☰</button>
        <h2>{VIEW_TITLES[currentView] || currentView}</h2>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={toggleAutoPlay}
          title={autoPlay ? 'Auto-read on — tap to turn off' : 'Auto-read off — tap to turn on'}
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: autoPlay ? 'var(--blue-bg)' : 'var(--bg3)',
            border: autoPlay ? '1px solid var(--blue)' : '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, cursor: 'pointer', flexShrink: 0,
            color: autoPlay ? 'var(--blue)' : 'var(--text2)',
          }}
        >
          🔊
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onNavigate('chat')}
          style={{ gap: 5 }}
        >
          ✨ Ask Ely
        </button>
        <button
          onClick={onOpenQuickRef}
          title="Quick reference view"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, cursor: 'pointer', flexShrink: 0,
            color: 'var(--text2)',
          }}
        >
          🔍
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
