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
      { id: 'soc',     icon: '🎙️', label: 'SOC Dictation' },
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

      {/* Firm header */}
      <div style={{
        padding: '18px 16px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 11,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: 'var(--blue)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {firmInitial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {firmName}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{role}</div>
        </div>
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
