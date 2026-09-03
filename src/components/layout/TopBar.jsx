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
  chat: 'Ask Nora',
  soc: 'SOC Dictation',
  notices: 'Notices',
  awards: 'Awards',
  invoices: 'Invoices',
  settings: 'Settings',
};

export default function TopBar({ currentView, onMenuToggle, onNavigate, onOpenNotepad, onOpenQuickRef, isOverlayOpen, onCloseOverlay, hideAskNora }) {
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

        {/* Added 2026-08-28, on request: a guaranteed, always-working
            way to close whatever's currently open, reported as
            genuinely stuck with no way out but a page refresh — the
            composer/sidebar's own z-index stacking couldn't be fully
            trusted, so this lives in the one place already proven
            reliable at the highest z-index in the app. Only shown
            when something is actually open, via isOverlayOpen. */}
        {isOverlayOpen && (
          <button
            onClick={onCloseOverlay}
            title="Close and return"
            style={{
              padding: '7px 14px', borderRadius: 8, background: '#dc2626', color: '#fff',
              border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            ✕ Close
          </button>
        )}
        <button
          onClick={() => onNavigate('chat')}
          // Added 2026-09-03, on request: hidden whenever the user is
          // already inside a Nora chat surface — a composer/reply is
          // open (Draft with Nora is right there at the bottom), or
          // Project Chat's own tab is active — reported as redundant
          // clutter squashing the top bar, since a second way into
          // the same kind of chat is already visible.
          style={{ gap: 5, padding: '7px 14px', borderRadius: 8, background: '#0a0a0a', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: (isOverlayOpen || hideAskNora) ? 'none' : 'flex', alignItems: 'center' }}
        >
          ✨ Ask Nora
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
