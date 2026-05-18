import { useState, useEffect, useCallback } from 'react';
import { useEmails } from '../../hooks/useEmails';
import { useApp } from '../../state/appStore';
import DraftWithEly from './DraftWithEly';
import { renderMarkdown } from '../../utils/formatters';

export default function Inbox({ onOpenComposer }) {
  const { emails, loadEmails, syncOutlook, markRead } = useEmails();
  const { state } = useApp();
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [showDraftWithEly, setShowDraftWithEly] = useState(false);
  const [mobileView, setMobileView] = useState('list'); // 'list' | 'detail'

  useEffect(() => {
    loadEmails();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try { await syncOutlook(); } catch (e) { console.warn(e); }
    finally { setSyncing(false); }
  };

  const handleSelect = (email) => {
    setSelected(email);
    if (!email.read) markRead(email.external_id || email.id);
    setMobileView('detail');
  };

  const filteredEmails = emails.filter(e => {
    if (filter === 'unread') return !e.read;
    if (filter === 'drafts') return e.is_draft;
    if (filter === 'sent') return e.is_sent;
    if (filter === 'flagged') return e.flagged;
    return !e.is_draft && !e.is_sent;
  });

  return (
    <div style={{ height: 'calc(100vh - 110px)', minHeight: 0 }}>
      <div className="mail-shell">
        {/* List pane */}
        <div className="mail-list-pane" style={{ display: mobileView === 'detail' ? '' : '' }}>
          {/* Toolbar */}
          <div className="mail-list-toolbar">
            <button className="btn btn-sm btn-primary" onClick={() => onOpenComposer({ mode: 'compose' })}>✏ Compose</button>
            <button
              className={`btn btn-sm${syncing ? ' inbox-refresh-spinning' : ''}`}
              onClick={handleSync}
              title="Sync Outlook"
            >
              {syncing ? '⟳' : '⟳'} Sync
            </button>
          </div>

          {/* Folder tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg4)', flexShrink: 0 }}>
            {['all', 'unread', 'flagged', 'drafts', 'sent'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '7px 12px', fontSize: 11.5, background: 'none', border: 'none',
                  borderBottom: filter === f ? '2px solid var(--blue)' : '2px solid transparent',
                  color: filter === f ? 'var(--blue)' : 'var(--text2)', cursor: 'pointer',
                  fontFamily: 'var(--font)', fontWeight: 500, textTransform: 'capitalize',
                }}
              >
                {f === 'all' ? 'Inbox' : f}
                {f === 'unread' && emails.filter(e => !e.read).length > 0 && (
                  <span className="nav-badge" style={{ marginLeft: 5 }}>{emails.filter(e => !e.read).length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Email list */}
          <div className="mail-list-scroll">
            {filteredEmails.length === 0 ? (
              <div className="empty"><div className="empty-icon">📭</div><div>No emails</div></div>
            ) : (
              filteredEmails.map(email => (
                <EmailListItem
                  key={email.external_id || email.id}
                  email={email}
                  isActive={selected?.external_id === email.external_id || selected?.id === email.id}
                  onClick={() => handleSelect(email)}
                />
              ))
            )}
          </div>
        </div>

        {/* Reader pane */}
        <div className="mail-reader-pane">
          {!selected ? (
            <div className="mail-reader-empty">
              <div>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📨</div>
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>Select an email to read</div>
              </div>
            </div>
          ) : (
            <EmailReader
              email={selected}
              onReply={(e) => onOpenComposer({ mode: 'reply', originalEmail: e, threadId: e.thread_id, projectId: e.project_id })}
              onDraftWithEly={() => setShowDraftWithEly(true)}
              onBack={() => { setSelected(null); setMobileView('list'); }}
            />
          )}
        </div>
      </div>

      {/* Draft with Ely panel */}
      {showDraftWithEly && selected && (
        <DraftWithEly
          email={selected}
          threadId={selected.thread_id}
          projectId={selected.project_id}
          onUseDraft={(draft) => {
            setShowDraftWithEly(false);
            onOpenComposer({
              mode: 'reply',
              originalEmail: selected,
              threadId: selected.thread_id,
              projectId: selected.project_id,
              body: draft,
              prefillGreeting: false,
            });
          }}
          onClose={() => setShowDraftWithEly(false)}
        />
      )}
    </div>
  );
}

function EmailListItem({ email, isActive, onClick }) {
  const unreadDot = !email.read;
  return (
    <div
      className={`mail-item${isActive ? ' active' : ''}${email.flagged ? ' flagged' : ''}`}
      onClick={onClick}
    >
      <div className="mail-item-top">
        <div className="mail-item-from" style={{ fontWeight: unreadDot ? 700 : 600 }}>
          {unreadDot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', marginRight: 6, verticalAlign: 'middle', flexShrink: 0 }} />}
          {email.from || email.from_email || 'Unknown'}
          {email.channel === 'wa' && <span className="ch-badge ch-wa">WA</span>}
          {email.channel === 'sms' && <span className="ch-badge ch-sms">SMS</span>}
        </div>
        <div className="mail-item-time">{email.time}</div>
      </div>
      <div className="mail-item-subject">{email.subject}</div>
      <div className="mail-item-preview">{email.preview || email.body_preview || ''}</div>
      {email.flagged && (
        <div style={{ marginTop: 5 }}>
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 500 }}>
            ⚠ Urgent
          </span>
        </div>
      )}
    </div>
  );
}

function EmailReader({ email, onReply, onDraftWithEly, onBack }) {
  const project = useApp().state.projects.find(p => p.id === email.project_id);

  return (
    <>
      <div className="mail-reader-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}>← Back</button>
        <div className="mail-reader-subject">{email.subject}</div>
        <div className="mail-reader-meta">
          <div className="mail-reader-from">
            <div><strong>{email.from || email.from_email}</strong></div>
            <div style={{ color: 'var(--text3)', fontSize: 11 }}>{email.from_email}</div>
            <div style={{ color: 'var(--text3)', fontSize: 11 }}>{email.time}</div>
            {project && (
              <div style={{ marginTop: 4 }}>
                <span className="ch-badge" style={{ background: 'var(--blue-bg)', color: 'var(--blue)', fontSize: 10 }}>
                  {project.ref} — {(project.address || '').slice(0, 30)}
                </span>
              </div>
            )}
          </div>
          <div className="mail-reader-actions">
            <button className="btn btn-sm" onClick={() => onReply(email)}>↩ Reply</button>
            <button className="btn btn-sm btn-primary" onClick={onDraftWithEly}>✨ Draft with Ely</button>
          </div>
        </div>
      </div>
      <div className="mail-reader-body">
        <div className="mail-body-card">
          {email.body
            ? <div dangerouslySetInnerHTML={{ __html: email.body }} />
            : <div>{email.preview || '(No body)'}</div>
          }
        </div>
        {email.attachments?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attachments</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {email.attachments.filter(a => !a.is_inline).map((att, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>
                  📎 {att.filename || att.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
