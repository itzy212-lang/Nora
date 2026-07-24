import { useApp } from '../../state/appStore';

// Load saved theme on startup
const savedTheme = localStorage.getItem('ely-theme') || 'light';
if (savedTheme === 'light') {
  document.body.classList.add('light');
} else {
  document.body.classList.remove('light');
}

const NAV = [
  {
    section: 'MAIN',
    items: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'leads',     icon: '🎯', label: 'Leads',    badge: 'leads' },
      { id: 'projects',  icon: '📁', label: 'Projects' },
      { id: 'contacts',  icon: '👥', label: 'Contacts' },
      { id: 'calendar',  icon: '📅', label: 'Calendar' },
      { id: 'inbox',     icon: '📨', label: 'Inbox',    badge: 'emails' },
    ],
  },
  {
    section: 'PARTY WALL',
    items: [
      { id: 'notices', icon: '📋', label: 'Notices' },
      { id: 'awards',  icon: '🏆', label: 'Awards' },
    ],
  },
  {
    section: 'FINANCE',
    items: [
      { id: 'accounting', icon: '💰', label: 'Accounting' },
    ],
  },
  {
    section: 'ACCOUNT',
    items: [
      { id: 'settings', icon: '⚙️', label: 'Settings' },
    ],
  },
];

export default function Sidebar({ currentView, onNavigate, onRaiseInvoice, onClose }) {
  const { state } = useApp();
  const { settings, leads = [], emails = [] } = state;

  const firmName = settings?.firmName || 'Ely';
  const firmInitial = firmName[0]?.toUpperCase() || 'E';
  const role = settings?.role || 'Practice Assistant';

  const badges = {
    leads: leads.filter(l => l.status === 'new').length,
    emails: emails.filter(e => !e.read).length,
  };

  const isLight = document.body.classList.contains('light');

  return (
    <aside style={{
      width: '100%', height: '100%', background: 'var(--bg2)',
      borderRight: '1px solid var(--border)', display: 'flex',
      flexDirection: 'column', overflowY: 'auto',
    }}>

      {/* Nora logo header */}
      <div style={{
        padding: '16px 16px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      }}>
        <style>{`
          @keyframes noraSidebarPulse {
            0%, 55%, 100% { opacity: 0.15; transform: translateY(0px); }
            28% { opacity: 1; transform: translateY(-3px); }
          }
          .nora-sb-dot { animation: noraSidebarPulse 1.4s ease-in-out infinite; border-radius: 50%; background: var(--text); display: inline-block; }
          .nora-sb-dot-1 { animation-delay: 0s; }
          .nora-sb-dot-2 { animation-delay: 0.22s; }
          .nora-sb-dot-3 { animation-delay: 0.44s; }
        `}</style>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontFamily: "'Bahnschrift Light', 'DIN Alternate', sans-serif", fontSize: 28, fontWeight: 300, letterSpacing: '-0.5px', lineHeight: 1, color: 'var(--text)' }}>nora</span>
          <span style={{ display: 'flex', alignItems: 'flex-end', gap: 4, paddingLeft: 4, paddingBottom: 5 }}>
            <span className="nora-sb-dot nora-sb-dot-1" style={{ width: 4, height: 4 }}/>
            <span className="nora-sb-dot nora-sb-dot-2" style={{ width: 4, height: 4 }}/>
            <span className="nora-sb-dot nora-sb-dot-3" style={{ width: 4, height: 4 }}/>
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '1.5px', marginTop: 2 }}>virtual assistant</div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 0' }}>
        {NAV.map(({ section, items }) => (
          <div key={section}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text3)',
              padding: '14px 16px 5px', textTransform: 'uppercase', letterSpacing: '0.7px',
            }}>
              {section}
            </div>

            {items.map(({ id, icon, label, badge }) => {
              const count = badge ? badges[badge] : 0;
              // accounting nav item should be active for both 'accounting' and 'invoices'
              const active = currentView === id || (id === 'accounting' && currentView === 'invoices');

              return (
                <div key={id}
                  onClick={() => { onNavigate(id); onClose?.(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 16px', fontSize: 13.5,
                    fontWeight: active ? 500 : 400,
                    color: active ? 'var(--blue)' : 'var(--text2)',
                    background: active ? 'var(--blue-bg)' : 'transparent',
                    cursor: 'pointer', transition: 'background 0.12s, color 0.12s', userSelect: 'none',
                  }}
                  onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--text)'; } }}
                  onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)'; } }}
                >
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {count > 0 && (
                    <span style={{ background: 'var(--red)', color: '#fff', fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 99, minWidth: 18, textAlign: 'center' }}>
                      {count}
                    </span>
                  )}
                </div>
              );
            })}


          </div>
        ))}
      </nav>

      {/* Theme toggle */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}
          onClick={() => {
            const currentlyLight = document.body.classList.contains('light');
            const newTheme = currentlyLight ? 'dark' : 'light';
            document.body.classList.toggle('light', newTheme === 'light');
            localStorage.setItem('ely-theme', newTheme);
          }}
        >
          {isLight ? '🌙 Dark mode' : '☀️ Light mode'}
        </button>
      </div>
    </aside>
  );
}
