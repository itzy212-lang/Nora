import { useApp } from '../../state/appStore';
import { useProjects } from '../../hooks/useProjects';
import { getProjColour, fmtShort } from '../../utils/formatters';

export default function Dashboard({ onNavigate, onOpenProject }) {
  const { state } = useApp();
  const { projects, emails } = state;

  const activeProjects = projects.filter(p => p.status !== 'complete');
  const urgentAOs = projects.reduce((sum, p) =>
    sum + (p.aos || []).filter(ao => ['notice_expired', 's10_expired', '104b_triggered'].includes(ao.status)).length, 0);
  const unreadEmails = emails.filter(e => !e.read).length;
  const recentEmails = [...emails].sort((a, b) => b._t - a._t).slice(0, 4);
  const recentProjects = [...projects].sort((a, b) => (b._t || 0) - (a._t || 0)).slice(0, 4);

  return (
    <div>
      {/* Stats */}
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">Active projects</div>
          <div className="stat-val">{activeProjects.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label s-red">Urgent items</div>
          <div className="stat-val s-red">{urgentAOs}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unread emails</div>
          <div className="stat-val">{unreadEmails}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pipeline</div>
          <div className="stat-val">£{projects.reduce((s, p) => s + parseFloat(p.fee || 0), 0).toFixed(0)}</div>
        </div>
      </div>

      {/* Widget grid */}
      <div className="wgrid">
        {/* Quick actions */}
        <div className="widget w4">
          <div className="wtitle">⚡ Quick actions</div>
          <div className="qa" onClick={() => onNavigate('chat')}>
            <span>✨</span>Ask Ely
          </div>
          <div className="qa" onClick={() => onOpenProject('new')}>
            <span>📁</span>New project
          </div>
          <div className="qa" onClick={() => onNavigate('inbox')}>
            <span>📨</span>Inbox {unreadEmails > 0 && <span className="nav-badge">{unreadEmails}</span>}
          </div>
          <div className="qa" onClick={() => onNavigate('awards')}>
            <span>🏆</span>Review award
          </div>
        </div>

        {/* Recent projects */}
        <div className="widget w8">
          <div className="wtitle">
            📁 Recent projects
            <span style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 400 }} onClick={() => onNavigate('projects')}>All →</span>
          </div>
          {recentProjects.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>No projects yet.</div>
          ) : (
            recentProjects.map(p => (
              <div key={p.id} className="proj-card" style={{ marginBottom: 8 }} onClick={() => onOpenProject(p)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.ref}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{(p.address || '').slice(0, 40)}</div>
                  </div>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtShort(p.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Recent emails */}
        <div className="widget w12">
          <div className="wtitle">
            📨 Recent messages
            <span style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 400 }} onClick={() => onNavigate('inbox')}>All →</span>
          </div>
          {recentEmails.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>No messages yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {recentEmails.map(e => (
                <div key={e.id} className="mail-item" onClick={() => onNavigate('inbox')} style={{ marginBottom: 0 }}>
                  <div className="mail-item-top">
                    <div className="mail-item-from">{e.from}</div>
                    <div className="mail-item-time">{e.time}</div>
                  </div>
                  <div className="mail-item-subject">{e.subject}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
