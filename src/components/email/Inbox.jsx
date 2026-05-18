import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../state/appStore';
import { useEly } from '../../hooks/useEly';
import sb from '../../supabaseClient';

// ── Draft with Ely overlay ─────────────────────────────────────────────────────
function DraftWithElyOverlay({ email, onUseDraft, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [draft, setDraft]       = useState('');
  const endRef = useRef(null);
  const { send, loading } = useEly({ surface: 'email_reply' });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-summarise on open
  useEffect(() => {
    if (!email) return;
    const summary = `I need help drafting a reply to this email.\n\nFrom: ${email.sender_name || email.sender_email}\nSubject: ${email.subject}\n\n${email.body?.slice(0, 800) || email.body_preview || ''}`;
    setMessages([{ id: 0, role: 'user', content: summary }]);
    const go = async () => {
      try {
        const result = await send(summary);
        const reply = result.reply || '';
        setMessages(prev => [...prev, { id: 1, role: 'ely', content: reply }]);
        // Extract draft block if present
        const draftMatch = reply.match(/```[\s\S]*?```/) || reply.match(/Dear[\s\S]{20,}/);
        if (draftMatch) setDraft(draftMatch[0].replace(/```/g, '').trim());
      } catch {}
    };
    go();
  }, []); // eslint-disable-line

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    try {
      const result = await send(text);
      const reply = result.reply || '';
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: reply }]);
      const draftMatch = reply.match(/Dear[\s\S]{20,}/);
      if (draftMatch) setDraft(draftMatch[0]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: `Error: ${err.message}` }]);
    }
  }, [input, loading, send]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '90vw', maxWidth: 900, height: '88vh',
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 18,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>✨ Draft with Ely</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Re: {email?.subject}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>
          {/* Left: Chat */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
              Chat with Ely
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.map(msg => (
                <div key={msg.id} style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%',
                  background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text)',
                  padding: '9px 13px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}>{msg.content}</div>
              ))}
              {loading && <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '9px 13px', borderRadius: 10, fontSize: 13, color: 'var(--text3)' }}>✨ Drafting…</div>}
              <div ref={endRef} />
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); }}}
                placeholder="Ask Ely to adjust the draft…"
                style={{ flex: 1, padding: '8px 10px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none' }} />
              <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Send</button>
            </div>
          </div>

          {/* Right: Editable draft */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
              Draft (edit before sending)
            </div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Ely will generate a draft here. You can edit it before sending."
              style={{ flex: 1, padding: '14px 16px', fontSize: 13, background: 'var(--bg2)', border: 'none', color: 'var(--text)', outline: 'none', resize: 'none', lineHeight: 1.7 }}
            />
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Cancel</button>
              <button onClick={() => onUseDraft(draft)} disabled={!draft.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>
                Use this draft →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Folder / tab options ───────────────────────────────────────────────────────
const FOLDERS = ['Inbox', 'Unread', 'Flagged', 'Drafts', 'Sent', 'Spam'];

// ── Email row ─────────────────────────────────────────────────────────────────
function EmailRow({ email, selected, onClick }) {
  const isUnread = !email.is_read;
  const hasAttachment = (email.raw_recipients || email.body || '').includes('attachment') || false;
  const isReplied  = email.is_replied;
  const isFlagged  = email.flagged;
  const category   = email.ai_category;

  const catColour = {
    'damage_claim': '#ef4444', 'urgent': '#ef4444', 'consent': '#22c55e',
    'dissent': '#ef4444', 'legal': '#f59e0b',
  }[category?.toLowerCase()] || null;

  return (
    <div onClick={onClick} style={{
      padding: '10px 14px', borderBottom: '1px solid var(--border)',
      background: selected ? 'var(--blue-bg)' : isUnread ? 'var(--bg3)' : 'transparent',
      cursor: 'pointer', transition: 'background 0.1s',
      borderLeft: selected ? '3px solid var(--blue)' : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
        <span style={{ fontSize: 13, fontWeight: isUnread ? 700 : 500, color: 'var(--text)', flex: 1, marginRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email.sender_name || email.sender_email}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>
          {email.received_at ? new Date(email.received_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: isUnread ? 'var(--text)' : 'var(--text2)', marginBottom: 3, fontWeight: isUnread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {email.subject}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11.5, color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email.body_preview}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
          {hasAttachment && <span title="Has attachment" style={{ fontSize: 11, color: 'var(--text3)' }}>📎</span>}
          {isReplied     && <span title="Replied"         style={{ fontSize: 11, color: 'var(--green)' }}>↩</span>}
          {isFlagged     && <span title="Flagged"         style={{ fontSize: 11, color: 'var(--red)' }}>🚩</span>}
          {catColour && category && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${catColour}22`, color: catColour, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {category.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Email preview panel ────────────────────────────────────────────────────────
function EmailPreview({ email, replyText, setReplyText, onReply, onDraftWithEly }) {
  if (!email) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
      Select an email to read
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Compact header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, lineHeight: 1.3 }}>{email.subject}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
            <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{email.sender_name || email.sender_email}</span>
            {email.sender_email && email.sender_name && <span> &lt;{email.sender_email}&gt;</span>}
            {email.received_at && (
              <span style={{ marginLeft: 8 }}>
                {new Date(email.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 8 }} onClick={() => setReplyText('')}>
              ↩ Reply
            </button>
            <button onClick={onDraftWithEly} className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 8, gap: 5 }}>
              ✨ Draft with Ely
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.75, whiteSpace: 'pre-wrap', maxWidth: 680 }}>
          {email.body || email.body_preview || 'No content'}
        </div>
      </div>

      {/* Reply area */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', flexShrink: 0, background: 'var(--bg3)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Reply</div>
        <textarea
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          placeholder="Type your reply…"
          rows={3}
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onDraftWithEly} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 8 }}>✨ Draft with Ely</button>
          <button onClick={onReply} disabled={!replyText.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Open composer →</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Inbox ─────────────────────────────────────────────────────────────────
export default function Inbox({ onOpenComposer }) {
  const { state } = useApp();
  const [emails, setEmails]         = useState([]);
  const [loading, setLoading]       = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [folder, setFolder]         = useState('Inbox');
  const [folderOpen, setFolderOpen] = useState(false);
  const [search, setSearch]         = useState('');
  const [replyText, setReplyText]   = useState('');
  const [showDraftEly, setShowDraftEly] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const folderRef = useRef(null);

  // Close folder dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (folderRef.current && !folderRef.current.contains(e.target)) setFolderOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadEmails = useCallback(async () => {
    if (!sb) return;
    setLoading(true);
    try {
      let query = sb.from('emails').select('*').order('received_at', { ascending: false }).limit(100);
      if (folder === 'Unread')  query = query.eq('is_read', false);
      if (folder === 'Flagged') query = query.eq('flagged', true);
      if (folder === 'Drafts')  query = query.eq('is_draft', true);
      if (folder === 'Sent')    query = query.eq('is_sent', true);
      if (folder === 'Spam')    query = query.eq('folder', 'spam');
      if (folder === 'Inbox')   query = query.eq('is_draft', false).eq('is_sent', false);
      const { data } = await query;
      setEmails(data || []);
    } catch (err) { console.error('loadEmails:', err); }
    setLoading(false);
  }, [folder]);

  useEffect(() => { loadEmails(); }, [loadEmails]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync-emails', { method: 'POST' });
      await loadEmails();
    } catch {}
    setSyncing(false);
  };

  const filteredEmails = emails.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.sender_name || '').toLowerCase().includes(q)
      || (e.sender_email || '').toLowerCase().includes(q)
      || (e.subject || '').toLowerCase().includes(q)
      || (e.body_preview || '').toLowerCase().includes(q);
  });

  const unreadCount = emails.filter(e => !e.is_read).length;

  const handleSelectEmail = async (email) => {
    setSelectedEmail(email);
    setReplyText('');
    // Mark as read
    if (!email.is_read && sb) {
      await sb.from('emails').update({ is_read: true }).eq('id', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, is_read: true } : e));
    }
  };

  const handleOpenComposer = () => {
    onOpenComposer?.({
      mode: 'reply',
      to: selectedEmail?.sender_email,
      toName: selectedEmail?.sender_name,
      subject: `Re: ${selectedEmail?.subject || ''}`,
      body: replyText,
      replyToId: selectedEmail?.id,
    });
  };

  const handleUseDraft = (draft) => {
    setReplyText(draft);
    setShowDraftEly(false);
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {showDraftEly && selectedEmail && (
        <DraftWithElyOverlay
          email={selectedEmail}
          onUseDraft={handleUseDraft}
          onClose={() => setShowDraftEly(false)}
        />
      )}

      {/* ── Left panel: email list ── */}
      <div style={{ width: 360, minWidth: 320, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', flexShrink: 0 }}>

        {/* Toolbar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => onOpenComposer?.({ mode: 'compose' })} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8, gap: 5, display: 'flex', alignItems: 'center' }}>
            ✎ Compose
          </button>

          {/* Folder dropdown (hamburger style) */}
          <div style={{ position: 'relative' }} ref={folderRef}>
            <button
              onClick={() => setFolderOpen(v => !v)}
              style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              ☰ {folder} {unreadCount > 0 && folder === 'Inbox' && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>}
              <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {folderOpen && (
              <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', zIndex: 50, minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                {FOLDERS.map(f => (
                  <div key={f} onClick={() => { setFolder(f); setFolderOpen(false); }}
                    style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', background: folder === f ? 'var(--blue-bg)' : 'transparent', color: folder === f ? 'var(--blue)' : 'var(--text)', fontWeight: folder === f ? 600 : 400 }}>
                    {f}
                    {f === 'Inbox' && unreadCount > 0 && <span style={{ marginLeft: 6, background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSync} disabled={syncing} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'none', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>
            {syncing ? '…' : '↻'}
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text3)' }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search mail…"
              style={{ width: '100%', padding: '7px 10px 7px 28px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, paddingLeft: 2 }}>
            {emails.filter(e => !e.is_read).length} unread · {filteredEmails.length} shown
          </div>
        </div>

        {/* Email list — SCROLLABLE */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading
            ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            : filteredEmails.length === 0
            ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No emails</div>
            : filteredEmails.map(email => (
              <EmailRow
                key={email.id}
                email={email}
                selected={selectedEmail?.id === email.id}
                onClick={() => handleSelectEmail(email)}
              />
            ))
          }
        </div>
      </div>

      {/* ── Right panel: preview ── */}
      <EmailPreview
        email={selectedEmail}
        replyText={replyText}
        setReplyText={setReplyText}
        onReply={handleOpenComposer}
        onDraftWithEly={() => setShowDraftEly(true)}
      />
    </div>
  );
}
