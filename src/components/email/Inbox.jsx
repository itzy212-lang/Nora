import { useState, useEffect, useCallback, useRef } from 'react';
import sb from '../../supabaseClient';

const FOLDERS = ['Inbox', 'Unread', 'Flagged', 'Drafts', 'Sent'];

// ── Draft with Ely overlay ────────────────────────────────────────────────────
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'email_reply', message: text }),
      });
      const data = await res.json();
      const reply = data.reply || data.text || 'Could not generate a draft.';
      setMessages(prev => [...prev, { id: Date.now(), role: 'ely', content: reply }]);
      const m = reply.match(/Dear[\s\S]{30,}/);
      if (m && !draft) setDraft(m[0]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now(), role: 'ely', content: 'Could not connect to Ely.' }]);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    const text = input.trim(); if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    await callEly(text);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '90vw', maxWidth: 920, height: '86vh', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>✨ Draft with Ely</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>Re: {email?.subject}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => {
              const prompt = `Draft a professional reply.\nFrom: ${email?.sender_name || email?.sender_email}\nSubject: ${email?.subject}\n\n${stripHtml(email?.body || email?.body_preview || '').slice(0, 800)}`;
              setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: 'Please draft a reply.' }]);
              callEly(prompt);
            }} disabled={loading} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>✨ Auto-draft</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Chat with Ely</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 13 }}>Click "Auto-draft" or type a request below.</div>}
              {messages.map(msg => (
                <div key={msg.id} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)', color: msg.role === 'user' ? '#fff' : 'var(--text)', padding: '9px 13px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              ))}
              {loading && <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '9px 13px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>✨ Drafting…</div>}
              <div ref={endRef} />
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); }}} placeholder="Adjust tone, add context…" style={{ flex: 1, padding: '8px 10px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none' }} />
              <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>Send</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Draft — edit before sending</div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Your draft appears here. Edit freely before sending." style={{ flex: 1, padding: '14px 16px', fontSize: 13, background: 'var(--bg2)', border: 'none', color: 'var(--text)', outline: 'none', resize: 'none', lineHeight: 1.75 }} />
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function isHtmlEmail(body) {
  return body && (body.trim().startsWith('<') || body.includes('<html') || body.includes('<div') || body.includes('<p>'));
}

// ── Email body renderer ───────────────────────────────────────────────────────
function EmailBody({ email }) {
  const body = email.body || '';
  if (!body) return <div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.8 }}>{email.body_preview || 'No content.'}</div>;
  if (isHtmlEmail(body)) {
    const styledHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7;color:#222;margin:16px;padding:0;background:#fff}a{color:#4f7fff}img{max-width:100%;height:auto}*{box-sizing:border-box}</style></head><body>${body}</body></html>`;
    return <iframe srcDoc={styledHtml} sandbox="allow-same-origin allow-popups" style={{ width: '100%', height: '100%', border: 'none', flex: 1 }} title="email-body" />;
  }
  return <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{body}</div>;
}

// ── Email row card — CURVED, with checkbox + delete X ────────────────────────
function EmailRow({ email, selected, checked, onSelect, onCheck, onDelete }) {
  const unread  = !email.is_read;
  const replied = email.is_replied;
  const flagged = email.flagged;
  const hasAtt  = !!email.has_attachments;
  const cat     = email.ai_category;
  const catColour = { damage_claim: '#ef4444', urgent: '#ef4444', consent: '#22c55e', dissent: '#ef4444', legal: '#f59e0b' }[cat?.toLowerCase()] || null;

  return (
    <div style={{ margin: '6px 10px', position: 'relative' }}>
      {/* Curved card */}
      <div
        onClick={() => onSelect(email)}
        style={{
          background: selected ? 'var(--blue-bg)' : unread ? 'var(--bg2)' : 'var(--bg3)',
          border: `1px solid ${selected ? 'var(--blue)' : 'var(--border)'}`,
          borderRadius: 14, padding: '10px 12px 10px 36px',
          cursor: 'pointer', transition: 'border-color 0.12s, background 0.12s',
          boxShadow: unread ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
        }}
        onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--border2)'; }}
        onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        {/* Checkbox — top left inside card */}
        <div
          onClick={e => { e.stopPropagation(); onCheck(email.id); }}
          style={{
            position: 'absolute', left: 10, top: 12,
            width: 16, height: 16, borderRadius: 4, cursor: 'pointer',
            border: `1.5px solid ${checked ? 'var(--blue)' : 'var(--border2)'}`,
            background: checked ? 'var(--blue)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          {checked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>

        {/* Delete X — top right */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(email.id); }}
          style={{
            position: 'absolute', right: 8, top: 8,
            background: 'none', border: 'none', color: 'var(--text3)',
            fontSize: 13, cursor: 'pointer', lineHeight: 1, padding: '2px 4px',
            borderRadius: 4, opacity: 0.5,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--red)'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text3)'; }}
          title="Delete"
        >✕</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, paddingRight: 16 }}>
          <span style={{ fontSize: 13, fontWeight: unread ? 700 : 500, color: unread ? 'var(--text)' : 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
            {email.sender_name || email.sender_email}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>
              {email.received_at ? new Date(email.received_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
            {unread && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />}
          </div>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: unread ? 600 : 400, color: unread ? 'var(--text)' : 'var(--text2)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 16 }}>
          {email.subject}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stripHtml(email.body_preview || '')}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
            {hasAtt  && <span title="Attachment" style={{ fontSize: 11 }}>📎</span>}
            {replied && <span title="Replied" style={{ fontSize: 11, color: 'var(--green)' }}>↩</span>}
            {flagged && <span title="Flagged" style={{ fontSize: 11, color: 'var(--red)' }}>🚩</span>}
            {catColour && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${catColour}22`, color: catColour, fontWeight: 600, whiteSpace: 'nowrap' }}>{cat.replace(/_/g,' ')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email preview panel ───────────────────────────────────────────────────────
function EmailPreview({ email, replyText, setReplyText, replyMode, setReplyMode, onOpenComposer, onDraftWithEly }) {
  if (!email) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
        Select an email to read
      </div>
    );
  }

  // Build reply-all recipients string
  const toEmails = Array.isArray(email.to_emails)
    ? email.to_emails.map(r => r.email || r).filter(Boolean).join(', ')
    : email.to_email || '';
  const replyAllTo = [email.sender_email, toEmails].filter(Boolean).join(', ');
  const isHtml = isHtmlEmail(email.body || '');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      {/* Header — curved card style */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, lineHeight: 1.3 }}>{email.subject}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{email.sender_name || email.sender_email}</span>
            {email.sender_email && email.sender_name && <span> &lt;{email.sender_email}&gt;</span>}
            {email.received_at && <span style={{ marginLeft: 10 }}>{new Date(email.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {/* Reply / Reply All dropdown */}
            <div style={{ position: 'relative', display: 'flex' }}>
              <button
                onClick={() => { setReplyMode('reply'); setReplyText(''); }}
                style={{ padding: '5px 12px', border: '1px solid var(--border)', borderRight: 'none', borderRadius: '8px 0 0 8px', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer', fontWeight: 500 }}>
                ↩ Reply
              </button>
              <button
                onClick={() => { setReplyMode('replyAll'); setReplyText(''); }}
                title="Reply All"
                style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: '0 8px 8px 0', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 11, cursor: 'pointer' }}>
                ↩↩ All
              </button>
            </div>
            <button onClick={onDraftWithEly} className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 8 }}>✨ Draft with Ely</button>
          </div>
        </div>
        {/* To line — show if reply all */}
        {replyMode === 'replyAll' && toEmails && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text3)' }}>
            <span style={{ fontWeight: 600 }}>To: </span>{email.sender_email}
            {toEmails && <span>  <span style={{ fontWeight: 600 }}>CC: </span>{toEmails}</span>}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: isHtml ? '#fff' : 'transparent' }}>
        {isHtml
          ? <EmailBody email={email} />
          : <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}><EmailBody email={email} /></div>
        }
      </div>

      {/* Reply box — curved */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', background: 'var(--bg3)', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
          {replyMode === 'replyAll' ? `Reply All — to ${replyAllTo.slice(0, 60)}${replyAllTo.length > 60 ? '…' : ''}` : 'Reply'}
        </div>
        <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
          placeholder={replyMode === 'replyAll' ? 'Type your reply to all…' : 'Type your reply…'}
          rows={3}
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', outline: 'none', resize: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onDraftWithEly} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 8 }}>✨ Draft with Ely</button>
          <button
            onClick={() => onOpenComposer?.({
              mode: replyMode === 'replyAll' ? 'replyAll' : 'reply',
              to: email.sender_email,
              toName: email.sender_name,
              cc: replyMode === 'replyAll' ? toEmails : '',
              subject: `Re: ${email.subject || ''}`,
              body: replyText,
              replyToId: email.id,
            })}
            className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8 }}>
            Open composer →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Inbox ────────────────────────────────────────────────────────────────
export default function Inbox({ onOpenComposer }) {
  const [emails, setEmails]             = useState([]);
  const [loading, setLoading]           = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [folder, setFolder]             = useState('Inbox');
  const [folderOpen, setFolderOpen]     = useState(false);
  const [search, setSearch]             = useState('');
  const [replyText, setReplyText]       = useState('');
  const [replyMode, setReplyMode]       = useState('reply'); // 'reply' | 'replyAll'
  const [showDraftEly, setShowDraftEly] = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [checkedIds, setCheckedIds]     = useState(new Set());
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
    setReplyMode('reply');
    if (!email.is_read && sb) {
      await sb.from('emails').update({ is_read: true }).eq('id', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, is_read: true } : e));
    }
  };

  const handleDelete = async (id) => {
    if (!sb) return;
    if (!window.confirm('Delete this email?')) return;
    await sb.from('emails').delete().eq('id', id);
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selectedEmail?.id === id) setSelectedEmail(null);
    setCheckedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleMassDelete = async () => {
    if (!sb || checkedIds.size === 0) return;
    if (!window.confirm(`Delete ${checkedIds.size} email${checkedIds.size > 1 ? 's' : ''}?`)) return;
    await sb.from('emails').delete().in('id', [...checkedIds]);
    setEmails(prev => prev.filter(e => !checkedIds.has(e.id)));
    if (checkedIds.has(selectedEmail?.id)) setSelectedEmail(null);
    setCheckedIds(new Set());
  };

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filtered.map(e => e.id)));
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
  const allChecked  = filtered.length > 0 && checkedIds.size === filtered.length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 57px)', overflow: 'hidden', background: 'var(--bg)' }}>
      {showDraftEly && selectedEmail && (
        <DraftWithElyOverlay
          email={selectedEmail}
          onUseDraft={d => { setReplyText(d); setShowDraftEly(false); }}
          onClose={() => setShowDraftEly(false)}
        />
      )}

      {/* ── Left panel ── */}
      <div style={{ width: 360, minWidth: 300, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg)' }}>

        {/* Toolbar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 7, alignItems: 'center', flexShrink: 0, background: 'var(--bg2)' }}>
          <button onClick={() => onOpenComposer?.({ mode: 'compose' })} className="btn btn-primary btn-sm"
            style={{ cursor: 'pointer', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 5 }}>
            ✎ Compose
          </button>
          <div style={{ position: 'relative', flex: 1 }} ref={folderRef}>
            <button onClick={() => setFolderOpen(v => !v)} style={{
              width: '100%', padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 99,
              background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
            }}>
              <span>☰ {folder}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {folder === 'Inbox' && unreadCount > 0 && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>}
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>▾</span>
              </div>
            </button>
            {folderOpen && (
              <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                {FOLDERS.map(f => (
                  <div key={f} onClick={() => { setFolder(f); setFolderOpen(false); }} style={{
                    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                    background: folder === f ? 'var(--blue-bg)' : 'transparent',
                    color: folder === f ? 'var(--blue)' : 'var(--text)', fontWeight: folder === f ? 600 : 400,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    {f}
                    {f === 'Inbox' && unreadCount > 0 && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleSync} disabled={syncing} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 99, background: 'none', color: 'var(--text2)', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>
            {syncing ? '…' : '↻'}
          </button>
        </div>

        {/* Search + bulk action bar */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg2)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text3)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mail…"
              style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Select all checkbox */}
              <div onClick={toggleSelectAll} style={{
                width: 16, height: 16, borderRadius: 4, cursor: 'pointer',
                border: `1.5px solid ${allChecked ? 'var(--blue)' : 'var(--border2)'}`,
                background: allChecked ? 'var(--blue)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {allChecked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{unreadCount} unread · {filtered.length} shown</span>
            </div>
            {checkedIds.size > 0 && (
              <button onClick={handleMassDelete} style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer',
                background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)',
                fontWeight: 600,
              }}>
                🗑 Delete {checkedIds.size}
              </button>
            )}
          </div>
        </div>

        {/* Email list — SCROLLABLE */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 8 }}>
          {loading
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            : filtered.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No emails in {folder}</div>
            : filtered.map(email => (
              <EmailRow
                key={email.id}
                email={email}
                selected={selectedEmail?.id === email.id}
                checked={checkedIds.has(email.id)}
                onSelect={handleSelect}
                onCheck={toggleCheck}
                onDelete={handleDelete}
              />
            ))
          }
        </div>
      </div>

      {/* ── Right panel: preview — curved container ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg2)' }}>
        <EmailPreview
          email={selectedEmail}
          replyText={replyText}
          setReplyText={setReplyText}
          replyMode={replyMode}
          setReplyMode={setReplyMode}
          onOpenComposer={onOpenComposer}
          onDraftWithEly={() => setShowDraftEly(true)}
        />
      </div>
    </div>
  );
}
