import { useApp } from '../../state/appStore';

const NAV_ITEMS = [
  { group: 'Main' },
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'leads', icon: '🎯', label: 'Leads', badge: 'leads' },
  { id: 'projects', icon: '📁', label: 'Projects' },
  { id: 'contacts', icon: '👥', label: 'Contacts' },
  { id: 'calendar', icon: '📅', label: 'Calendar' },
  { id: 'inbox', icon: '📨', label: 'Inbox', badge: 'inbox' },
  { id: 'chat', icon: '✨', label: 'Ask Ely' },
  { group: 'Party Wall', pwOnly: true },
  { id: 'soc', icon: '🎙', label: 'SOC Dictation', pwOnly: true },
  { id: 'notices', icon: '📋', label: 'Notices', pwOnly: true },
  { id: 'awards', icon: '🏆', label: 'Awards', pwOnly: true },
  { group: 'Finance' },
  { id: 'invoices', icon: '💰', label: 'Invoices' },
  { group: 'Account' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

export default function Sidebar({ currentView, onNavigate, onClose }) {
  const { state } = useApp();
  const { settings, emails, theme } = state;
  const isPartywall = settings.role === 'partywall';

  const unreadCount = emails.filter(e => !e.read).length;

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark" style={{ background: settings.brandColour || 'var(--blue)', overflow: 'hidden' }}>
          {settings.logoData
            ? <img src={settings.logoData} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : 'E'}
        </div>
        <div>
          <div className="logo-name">{settings.firm || 'Ely'}</div>
          <div className="logo-role" style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>Practice Assistant</div>
        </div>
      </div>

      {NAV_ITEMS.map((item, idx) => {
        if (item.group) {
          if (item.pwOnly && !isPartywall) return null;
          return (
            <div key={idx} className="nav-group" style={{ fontSize: 9, color: 'var(--text3)', padding: '10px 16px 3px', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: 600 }}>
              {item.group}
            </div>
          );
        }
        if (item.pwOnly && !isPartywall) return null;
        const isActive = currentView === item.id;
        const badge = item.badge === 'inbox' ? unreadCount : 0;
        return (
          <div
            key={item.id}
            className={`nav-item${isActive ? ' active' : ''}`}
            onClick={() => { onNavigate(item.id); onClose?.(); }}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {badge > 0 && <span className="nav-badge">{badge}</span>}
          </div>
        );
      })}

      {/* Theme toggle at bottom */}
      <div style={{ marginTop: 'auto', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => {
            const newTheme = theme === 'dark' ? 'light' : 'dark';
            document.body.classList.toggle('light', newTheme === 'light');
          }}
        >
          {theme === 'light' ? '🌙 Dark mode' : '☀️ Light mode'}
        </button>
      </div>
    </aside>
  );
}
