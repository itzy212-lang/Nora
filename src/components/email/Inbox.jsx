import { useState, useEffect, useCallback, useRef } from 'react';
import sb from '../../supabaseClient';

const FOLDERS = ['Inbox', 'Unread', 'Flagged', 'Drafts', 'Sent'];

// ── Draft with Ely overlay ─────────────────────────────────────────────────────
// Uses fetch directly — no hook dependency that could crash on mount
function DraftWithElyOverlay({ email, onUseDraft, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [draft, setDraft]       = useState('');
  const [loading, setLoading]   = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const callEly = async (text) => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/ely-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'email_reply', message: text }),
      });
      const data = await res.json();
      const reply = data.reply || data.text || 'Sorry, I could not generate a draft.';
      setMessages(prev => [...prev, { id: Date.now(), role: 'ely', content: reply }]);
      // Try to extract a draft from the reply
      const draftMatch = reply.match(/Subject:[\s\S]{10,}/) || reply.match(/Dear[\s\S]{30,}/);
      if (draftMatch && !draft) setDraft(draftMatch[0]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now(), role: 'ely', content: 'Could not connect to Ely. Please check your connection.' }]);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    await callEly(text);
  };

  const handleSummarise = () => {
    if (!email) return;
    const prompt = `Please draft a professional reply to this email.\n\nFrom: ${email.sender_name || email.sender_email}\nSubject: ${email.subject}\n\n${(email.body || email.body_preview || '').slice(0, 1000)}`;
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: 'Please draft a reply to this email.' }]);
    callEly(prompt);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '90vw', maxWidth: 920, height: '86vh', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>✨ Draft with Ely</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Re: {email?.subject}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSummarise} disabled={loading} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 8 }}>
              ✨ Auto-draft reply
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        {/* Body: chat left, draft right */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>

          {/* Chat */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
              Chat with Ely
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 13 }}>
                  Click "Auto-draft reply" above or type a request below.
                </div>
              )}
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
                placeholder="Adjust tone, add context…"
                style={{ flex: 1, padding: '8px 10px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none' }} />
              <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Send</button>
            </div>
          </div>

          {/* Editable draft */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
              Draft — edit before sending
            </div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="Your draft will appear here. You can edit it before sending."
              style={{ flex: 1, padding: '14px 16px', fontSize: 13, background: 'var(--bg2)', border: 'none', color: 'var(--text)', outline: 'none', resize: 'none', lineHeight: 1.75 }} />
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Cancel</button>
              <button onClick={() => onUseDraft(draft)} disabled={!draft.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Use this draft →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email row ─────────────────────────────────────────────────────────────────
function EmailRow({ email, selected, onClick }) {
  const unread  = !email.is_read;
  const replied = email.is_replied;
  const flagged = email.flagged;
  const hasAtt  = !!(email.has_attachments);
  const cat     = email.ai_category;
  const catColour = { damage_claim: '#ef4444', urgent: '#ef4444', consent: '#22c55e', dissent: '#ef4444', legal: '#f59e0b' }[cat?.toLowerCase()] || null;

  return (
    <div onClick={onClick} style={{
      padding: '10px 14px', borderBottom: '1px solid var(--border)',
      background: selected ? 'var(--blue-bg)' : unread ? 'var(--bg3)' : 'transparent',
      cursor: 'pointer', borderLeft: `3px solid ${selected ? 'var(--blue)' : 'transparent'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 13, fontWeight: unread ? 700 : 500, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
          {email.sender_name || email.sender_email}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>
          {email.received_at ? new Date(email.received_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: unread ? 600 : 400, color: unread ? 'var(--text)' : 'var(--text2)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {email.subject}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11.5, color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email.body_preview}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {hasAtt  && <span title="Attachment" style={{ fontSize: 11 }}>📎</span>}
          {replied && <span title="Replied"    style={{ fontSize: 11, color: 'var(--green)' }}>↩</span>}
          {flagged && <span title="Flagged"    style={{ fontSize: 11, color: 'var(--red)' }}>🚩</span>}
          {catColour && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 99, background: `${catColour}22`, color: catColour, fontWeight: 600 }}>{cat}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Email preview ─────────────────────────────────────────────────────────────
function EmailPreview({ email, replyText, setReplyText, onOpenComposer, onDraftWithEly }) {
  if (!email) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Select an email to read
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      {/* Compact header — aligned with left panel top */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 5, lineHeight: 1.3 }}>{email.subject}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{email.sender_name || email.sender_email}</span>
            {email.sender_email && email.sender_name && <span> &lt;{email.sender_email}&gt;</span>}
            {email.received_at && <span style={{ marginLeft: 8 }}>{new Date(email.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 8, fontSize: 12.5 }}>↩ Reply</button>
            <button onClick={onDraftWithEly} className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 8, fontSize: 12.5 }}>✨ Draft with Ely</button>
          </div>
        </div>
      </div>

      {/* Body — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap', maxWidth: 680 }}>
          {email.body || email.body_preview || 'No content loaded.'}
        </div>
      </div>

      {/* Reply box */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', background: 'var(--bg3)', flexShrink: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Reply</div>
        <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
          placeholder="Type your reply…" rows={3}
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onDraftWithEly} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 8 }}>✨ Draft with Ely</button>
          <button onClick={() => onOpenComposer({
            mode: 'reply', to: email.sender_email, toName: email.sender_name,
            subject: `Re: ${email.subject || ''}`, body: replyText, replyToId: email.id,
          })} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Open composer →</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Inbox ─────────────────────────────────────────────────────────────────
export default function Inbox({ onOpenComposer }) {
  const [emails, setEmails]             = useState([]);
  const [loading, setLoading]           = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [folder, setFolder]             = useState('Inbox');
  const [folderOpen, setFolderOpen]     = useState(false);
  const [search, setSearch]             = useState('');
  const [replyText, setReplyText]       = useState('');
  const [showDraftEly, setShowDraftEly] = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const folderRef = useRef(null);

  useEffect(() => {
    const handler = e => { if (folderRef.current && !folderRef.current.contains(e.target)) setFolderOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadEmails = useCallback(async () => {
    if (!sb) return;
    setLoading(true);
    try {
      let q = sb.from('emails').select('*').order('received_at', { ascending: false }).limit(150);
      if (folder === 'Unread')  q = q.eq('is_read', false);
      if (folder === 'Flagged') q = q.eq('flagged', true);
      if (folder === 'Drafts')  q = q.eq('is_draft', true);
      if (folder === 'Sent')    q = q.eq('is_sent', true);
      if (folder === 'Inbox')   q = q.not('is_draft', 'eq', true).not('is_sent', 'eq', true);
      const { data, error } = await q;
      if (error) throw error;
      setEmails(data || []);
    } catch (err) { console.error('loadEmails:', err); }
    setLoading(false);
  }, [folder]);

  useEffect(() => { loadEmails(); }, [loadEmails]);

  const handleSync = async () => {
    setSyncing(true);
    try { await fetch('/api/sync-emails', { method: 'POST' }); await loadEmails(); } catch {}
    setSyncing(false);
  };

  const handleSelect = async (email) => {
    setSelectedEmail(email);
    setReplyText('');
    if (!email.is_read && sb) {
      await sb.from('emails').update({ is_read: true }).eq('id', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, is_read: true } : e));
    }
  };

  const filtered = emails.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.sender_name || '').toLowerCase().includes(q)
      || (e.sender_email || '').toLowerCase().includes(q)
      || (e.subject || '').toLowerCase().includes(q)
      || (e.body_preview || '').toLowerCase().includes(q);
  });

  const unreadCount = emails.filter(e => !e.is_read).length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 57px)', overflow: 'hidden' }}>
      {showDraftEly && selectedEmail && (
        <DraftWithElyOverlay
          email={selectedEmail}
          onUseDraft={(d) => { setReplyText(d); setShowDraftEly(false); }}
          onClose={() => setShowDraftEly(false)}
        />
      )}

      {/* ── Left panel ── */}
      <div style={{ width: 340, minWidth: 280, maxWidth: 380, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', flexShrink: 0 }}>

        {/* Toolbar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 7, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => onOpenComposer?.({ mode: 'compose' })} className="btn btn-primary btn-sm"
            style={{ cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
            ✎ Compose
          </button>

          {/* Hamburger folder picker */}
          <div style={{ position: 'relative', flex: 1 }} ref={folderRef}>
            <button onClick={() => setFolderOpen(v => !v)} style={{
              width: '100%', padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--bg2)', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
            }}>
              <span>☰ {folder}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {unreadCount > 0 && folder === 'Inbox' && (
                  <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>
                )}
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>▾</span>
              </div>
            </button>
            {folderOpen && (
              <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                {FOLDERS.map(f => (
                  <div key={f} onClick={() => { setFolder(f); setFolderOpen(false); }} style={{
                    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                    background: folder === f ? 'var(--blue-bg)' : 'transparent',
                    color: folder === f ? 'var(--blue)' : 'var(--text)',
                    fontWeight: folder === f ? 600 : 400,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    {f}
                    {f === 'Inbox' && unreadCount > 0 && (
                      <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSync} disabled={syncing} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'none', color: 'var(--text2)', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>
            {syncing ? '…' : '↻'}
          </button>
        </div>

        {/* Search + count */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text3)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mail…"
              style={{ width: '100%', padding: '7px 10px 7px 28px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, paddingLeft: 2 }}>
            {unreadCount} unread · {filtered.length} shown
          </div>
        </div>

        {/* Email list — SCROLLABLE */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            : filtered.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No emails in {folder}</div>
            : filtered.map(email => (
              <EmailRow
                key={email.id} email={email}
                selected={selectedEmail?.id === email.id}
                onClick={() => handleSelect(email)}
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
        onOpenComposer={onOpenComposer}
        onDraftWithEly={() => setShowDraftEly(true)}
      />
    </div>
  );
}
