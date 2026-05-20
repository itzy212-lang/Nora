import { useState, useEffect, useCallback, useRef } from 'react';
import sb from '../../supabaseClient';

const FOLDERS = ['Inbox', 'Unread', 'Flagged', 'Drafts', 'Sent'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function isHtmlEmail(body) {
  return body && (body.trim().startsWith('<') || body.includes('<html') || body.includes('<div') || body.includes('<p>'));
}

// Fix 1: Smart date — shows time if today, date+time if older
function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isToday) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (isThisYear) {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Short date for email row card (just date or time)
function fmtShort(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isToday) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Email body renderer ───────────────────────────────────────────────────────
function EmailBody({ email }) {
  const body = email.body || '';
  if (!body) return <div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.8 }}>{email.body_preview || 'No content.'}</div>;
  if (isHtmlEmail(body)) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7;color:#222;margin:16px;padding:0;background:#fff}a{color:#4f7fff}img{max-width:100%;height:auto}*{box-sizing:border-box}</style></head><body>${body}</body></html>`;
    return <iframe srcDoc={html} sandbox="allow-same-origin allow-popups" style={{ width: '100%', height: '100%', border: 'none', flex: 1 }} title="email-body" />;
  }
  return <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{body}</div>;
}

// ── Ely draft panel ───────────────────────────────────────────────────────────
function ElyDraftPanel({ email, threadEmails, onUseDraft, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const endRef = useRef(null);
  const hasAutoRun = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (hasAutoRun.current || !email) return;
    hasAutoRun.current = true;
    const threadSummary = threadEmails.length > 1
      ? threadEmails
          .sort((a, b) => new Date(a.received_at) - new Date(b.received_at))
          .map(e => `--- ${fmtDate(e.received_at)} | From: ${e.sender_name || e.sender_email} ---\n${stripHtml(e.body || e.body_preview || '').slice(0, 600)}`)
          .join('\n\n')
      : stripHtml(email.body || email.body_preview || '').slice(0, 1200);

    const prompt = threadEmails.length > 1
      ? `I need to reply to this email thread (${threadEmails.length} emails). Please read the full thread and draft a professional reply to the most recent message.\n\nFULL THREAD:\n${threadSummary}`
      : `Please read this email and draft a professional reply.\n\nFrom: ${email.sender_name || email.sender_email}\nSubject: ${email.subject}\nDate: ${fmtDate(email.received_at)}\n\n${threadSummary}`;

    callEly(prompt, true);
  }, [email, threadEmails]); // eslint-disable-line

  // Fix 3: Use /api/ely-smart instead of /api/ely-ai
  const callEly = async (text, isAuto = false) => {
    if (loading) return;
    setLoading(true);
    if (!isAuto) setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    else setMessages([{ id: 0, role: 'system', content: `📧 Reading ${threadEmails.length > 1 ? `thread (${threadEmails.length} emails)` : 'email'}…` }]);

    try {
      const res = await fetch('/api/ely-smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          surface: 'email_composer',
          emailContext: {
            from: email.sender_name || email.sender_email,
            subject: email.subject,
            body: stripHtml(email.body || email.body_preview || '').slice(0, 1500),
          },
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.replyText || 'Could not generate a draft.';

      if (isAuto) {
        setMessages([{ id: 1, role: 'ely', content: reply }]);
      } else {
        setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: reply }]);
      }

      const draftMatch = reply.match(/Subject:[\s\S]{5,}/) ||
                         reply.match(/Dear[\s\S]{20,}/) ||
                         reply.match(/Hi[\s\S]{20,}/);
      if (draftMatch) onUseDraft(draftMatch[0], false);
    } catch {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: 'Could not connect to Ely. Please try again.' }]);
    }
    setLoading(false);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    callEly(text);
  };

  return (
    <div style={{ width: '42%', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', background: 'var(--bg3)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>✨ Draft with Ely</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
            {threadEmails.length > 1 ? `Reading thread (${threadEmails.length} emails)` : 'Reading email'}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 16, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%',
            background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg2)',
            color: msg.role === 'user' ? '#fff' : 'var(--text)',
            border: msg.role === 'system' ? '1px solid var(--border)' : 'none',
            padding: '10px 13px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-wrap',
          }}>{msg.content}</div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start', background: 'var(--bg2)', border: '1px solid var(--border)', padding: '10px 13px', borderRadius: 10, fontSize: 12.5, color: 'var(--text3)' }}>✨ Reading & drafting…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); }}}
          placeholder="Adjust tone, add something…"
          style={{ flex: 1, padding: '8px 10px', fontSize: 12.5, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none' }} />
        <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 8, fontSize: 12 }}>Send</button>
      </div>
    </div>
  );
}

// ── Reply Overlay ─────────────────────────────────────────────────────────────
function ReplyOverlay({ email, mode, threadEmails, onSend, onClose }) {
  const [to, setTo]           = useState(email?.sender_email || '');
  const [cc, setCc]           = useState(mode === 'replyAll'
    ? (Array.isArray(email?.to_emails) ? email.to_emails.map(r => r.email || r).filter(e => e !== email?.sender_email).join(', ') : email?.to_email || '')
    : '');
  const [subject, setSubject] = useState(`Re: ${email?.subject || ''}`);
  const [body, setBody]       = useState('');
  const [showEly, setShowEly] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    try { await onSend({ to, cc, subject, body, replyToId: email?.id }); } catch {}
    setSending(false);
    onClose();
  };

  const handleElyDraft = (draft, close = false) => {
    setBody(draft);
    if (close) setShowEly(false);
  };

  const inp = { width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 1300, margin: '10px 16px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, display: 'flex', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{mode === 'replyAll' ? '↩↩ Reply All' : '↩ Reply'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!showEly && <button onClick={() => setShowEly(true)} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>✨ Draft with Ely</button>}
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: '10px 14px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Replying to</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{email?.sender_name || email?.sender_email}</span>
                {' · '}{fmtDate(email?.received_at)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{email?.subject}</div>
            </div>
            {[{ label: 'To', val: to, set: setTo }, { label: 'CC', val: cc, set: setCc }, { label: 'Subject', val: subject, set: setSubject }].map(({ label, val, set }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 52, fontSize: 12, fontWeight: 600, color: 'var(--text3)', flexShrink: 0, textAlign: 'right' }}>{label}</div>
                <input value={val} onChange={e => set(e.target.value)} style={{ ...inp }} />
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
              <div style={{ width: 52, fontSize: 12, fontWeight: 600, color: 'var(--text3)', flexShrink: 0, textAlign: 'right', paddingTop: 8 }}>Body</div>
              <textarea value={body} onChange={e => setBody(e.target.value)}
                placeholder="Type your reply here, or use ✨ Draft with Ely…"
                style={{ ...inp, flex: 1, minHeight: 320, resize: 'vertical', lineHeight: 1.7 }} />
            </div>
            {threadEmails.length > 1 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer', userSelect: 'none' }}>Show thread ({threadEmails.length} emails)</summary>
                <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  {[...threadEmails].sort((a, b) => new Date(b.received_at) - new Date(a.received_at)).map((e, i) => (
                    <div key={e.id} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: i < threadEmails.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 2 }}>{e.sender_name || e.sender_email} · {fmtDate(e.received_at)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>{stripHtml(e.body || e.body_preview || '').slice(0, 200)}…</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
            <button onClick={handleSend} disabled={sending || !body.trim() || !to.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>
              {sending ? 'Sending…' : '↩ Send reply'}
            </button>
          </div>
        </div>
        {showEly && <ElyDraftPanel email={email} threadEmails={threadEmails} onUseDraft={handleElyDraft} onClose={() => setShowEly(false)} />}
      </div>
    </div>
  );
}

// ── Email row card ────────────────────────────────────────────────────────────
function EmailRow({ email, selected, checked, onSelect, onCheck, onDelete }) {
  const unread  = !email.is_read;
  const replied = email.is_replied;
  const flagged = email.flagged;
  const hasAtt  = !!email.has_attachments;
  const cat     = email.ai_category;
  const catColour = { damage_claim: '#ef4444', urgent: '#ef4444', consent: '#22c55e', dissent: '#ef4444', legal: '#f59e0b' }[cat?.toLowerCase()] || null;

  return (
    <div style={{ margin: '5px 10px', position: 'relative' }}>
      <div onClick={() => onSelect(email)} style={{
        background: selected ? 'var(--blue-bg)' : unread ? 'var(--bg2)' : 'var(--bg3)',
        border: `1px solid ${selected ? 'var(--blue)' : 'var(--border)'}`,
        borderRadius: 14, padding: '10px 12px 10px 36px',
        cursor: 'pointer', transition: 'border-color 0.12s',
        boxShadow: unread ? '0 1px 5px rgba(0,0,0,0.07)' : 'none',
      }}
        onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--border2)'; }}
        onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        <div onClick={e => { e.stopPropagation(); onCheck(email.id); }} style={{
          position: 'absolute', left: 10, top: 13, width: 16, height: 16, borderRadius: 4, cursor: 'pointer',
          border: `1.5px solid ${checked ? 'var(--blue)' : 'var(--border2)'}`,
          background: checked ? 'var(--blue)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(email.id); }} style={{
          position: 'absolute', right: 7, top: 8, background: 'none', border: 'none',
          color: 'var(--text3)', fontSize: 13, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, opacity: 0.4,
        }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--red)'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text3)'; }}>✕</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, paddingRight: 16 }}>
          <span style={{ fontSize: 13, fontWeight: unread ? 700 : 500, color: unread ? 'var(--text)' : 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
            {email.sender_name || email.sender_email}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {/* Fix 1: Smart date — time if today, date if older */}
            <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtShort(email.received_at)}</span>
            {unread && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)' }} />}
          </div>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: unread ? 600 : 400, color: unread ? 'var(--text)' : 'var(--text2)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 16 }}>
          {email.subject}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stripHtml(email.body_preview || '')}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {hasAtt  && <span style={{ fontSize: 11 }}>📎</span>}
            {replied && <span style={{ fontSize: 11, color: 'var(--green)' }}>↩</span>}
            {flagged && <span style={{ fontSize: 11, color: 'var(--red)' }}>🚩</span>}
            {catColour && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${catColour}22`, color: catColour, fontWeight: 600 }}>{cat.replace(/_/g,' ')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email preview panel ───────────────────────────────────────────────────────
function EmailPreview({ email, onOpenReply, onDraftWithEly }) {
  const [replyDropOpen, setReplyDropOpen] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    const h = e => { if (dropRef.current && !dropRef.current.contains(e.target)) setReplyDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!email) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>Select an email to read</div>;

  const isHtml = isHtmlEmail(email.body || '');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, lineHeight: 1.3 }}>{email.subject}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{email.sender_name || email.sender_email}</span>
            {email.sender_email && email.sender_name && <span> &lt;{email.sender_email}&gt;</span>}
            {/* Fix 1: Full date in preview header */}
            {email.received_at && <span style={{ marginLeft: 10 }}>{fmtDate(email.received_at)}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            <div style={{ position: 'relative' }} ref={dropRef}>
              <button onClick={() => setReplyDropOpen(v => !v)} style={{ padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                ↩ Reply <span style={{ fontSize: 10, color: 'var(--text3)' }}>▾</span>
              </button>
              {replyDropOpen && (
                <div style={{ position: 'absolute', top: '110%', right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', zIndex: 100, minWidth: 150, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                  {[{ label: '↩ Reply', mode: 'reply' }, { label: '↩↩ Reply All', mode: 'replyAll' }].map(({ label, mode }, i) => (
                    <div key={mode} onClick={() => { setReplyDropOpen(false); onOpenReply(mode); }}
                      style={{ padding: '10px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--text)', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => onDraftWithEly('reply')} className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>✨ Draft with Ely</button>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: isHtml ? '#fff' : 'transparent' }}>
        {isHtml
          ? <EmailBody email={email} />
          : <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}><EmailBody email={email} /></div>
        }
      </div>
    </div>
  );
}

// ── Main Inbox ────────────────────────────────────────────────────────────────
export default function Inbox({ onOpenComposer }) {
  const [emails, setEmails]              = useState([]);
  const [loading, setLoading]            = useState(false);
  const [selectedEmail, setSelectedEmail]= useState(null);
  const [threadEmails, setThreadEmails]  = useState([]);
  const [folder, setFolder]              = useState('Inbox');
  const [folderOpen, setFolderOpen]      = useState(false);
  const [search, setSearch]              = useState('');
  const [syncing, setSyncing]            = useState(false);
  const [checkedIds, setCheckedIds]      = useState(new Set());
  const [replyOverlay, setReplyOverlay]  = useState(null);
  const folderRef = useRef(null);

  useEffect(() => {
    const h = e => { if (folderRef.current && !folderRef.current.contains(e.target)) setFolderOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const loadEmails = useCallback(async () => {
    if (!sb) return;
    setLoading(true);
    try {
      let q = sb.from('emails').select('*').order('received_at', { ascending: false, nullsFirst: false }).limit(200);
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

  const loadThread = useCallback(async (email) => {
    if (!sb || !email.thread_id) { setThreadEmails([email]); return; }
    try {
      const { data } = await sb.from('emails').select('*').eq('thread_id', email.thread_id).order('received_at', { ascending: true });
      setThreadEmails(data && data.length > 0 ? data : [email]);
    } catch { setThreadEmails([email]); }
  }, []);

  const handleSelect = async (email) => {
    setSelectedEmail(email);
    loadThread(email);
    if (!email.is_read && sb) {
      await sb.from('emails').update({ is_read: true }).eq('id', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, is_read: true } : e));
    }
  };

  // Fix 2: Refresh calls Supabase sync_outlook edge function, not /api/sync-emails
  const handleSync = async () => {
    setSyncing(true);
    try {
      await sb.functions.invoke('sync_outlook', { method: 'POST' });
      // Wait briefly then reload
      await new Promise(r => setTimeout(r, 2000));
      await loadEmails();
    } catch (err) {
      console.warn('Sync error:', err);
      await loadEmails(); // reload from DB even if sync failed
    }
    setSyncing(false);
  };

  const handleSendReply = async ({ to, cc, subject, body, replyToId }) => {
    if (!sb) return;
    try {
      await sb.functions.invoke('send_email_via_microsoft', { body: { to_email: to, cc_email: cc || null, subject, body, reply_to_message_id: replyToId || null } }).catch(() => {});
      if (replyToId) await sb.from('emails').update({ is_replied: true }).eq('id', replyToId);
      setEmails(prev => prev.map(e => e.id === replyToId ? { ...e, is_replied: true } : e));
    } catch (err) { console.error('Send reply error:', err); }
  };

  const handleDelete = async (id) => {
    if (!sb || !window.confirm('Delete this email?')) return;
    await sb.from('emails').delete().eq('id', id);
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selectedEmail?.id === id) setSelectedEmail(null);
    setCheckedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleMassDelete = async () => {
    if (!sb || checkedIds.size === 0 || !window.confirm(`Delete ${checkedIds.size} emails?`)) return;
    await sb.from('emails').delete().in('id', [...checkedIds]);
    setEmails(prev => prev.filter(e => !checkedIds.has(e.id)));
    if (checkedIds.has(selectedEmail?.id)) setSelectedEmail(null);
    setCheckedIds(new Set());
  };

  const toggleCheck = (id) => setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const filtered = emails.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.sender_name || '').toLowerCase().includes(q) || (e.sender_email || '').toLowerCase().includes(q) || (e.subject || '').toLowerCase().includes(q);
  });

  const unreadCount = emails.filter(e => !e.is_read).length;
  const allChecked  = filtered.length > 0 && checkedIds.size === filtered.length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 57px)', overflow: 'hidden', background: 'var(--bg)' }}>
      {replyOverlay && selectedEmail && (
        <ReplyOverlay email={selectedEmail} mode={replyOverlay.mode} threadEmails={threadEmails} initialOpenEly={replyOverlay.openEly} onSend={handleSendReply} onClose={() => setReplyOverlay(null)} />
      )}

      {/* Left panel */}
      <div style={{ width: 360, minWidth: 300, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg)' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 7, alignItems: 'center', flexShrink: 0, background: 'var(--bg2)' }}>
          <button onClick={() => onOpenComposer?.({ mode: 'compose' })} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>✎ Compose</button>
          <div style={{ position: 'relative', flex: 1 }} ref={folderRef}>
            <button onClick={() => setFolderOpen(v => !v)} style={{ width: '100%', padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>☰ {folder}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {folder === 'Inbox' && unreadCount > 0 && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>}
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>▾</span>
              </div>
            </button>
            {folderOpen && (
              <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                {FOLDERS.map(f => (
                  <div key={f} onClick={() => { setFolder(f); setFolderOpen(false); }} style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', background: folder === f ? 'var(--blue-bg)' : 'transparent', color: folder === f ? 'var(--blue)' : 'var(--text)', fontWeight: folder === f ? 600 : 400, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {f}
                    {f === 'Inbox' && unreadCount > 0 && <span style={{ background: 'var(--red)', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 5px', fontWeight: 700 }}>{unreadCount}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Fix 2: Refresh now calls sync_outlook edge function */}
          <button onClick={handleSync} disabled={syncing} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 99, background: 'none', color: 'var(--text2)', fontSize: 14, cursor: syncing ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
            {syncing ? '…' : '↻'}
          </button>
        </div>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg2)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text3)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mail…"
              style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div onClick={() => setCheckedIds(allChecked ? new Set() : new Set(filtered.map(e => e.id)))} style={{ width: 16, height: 16, borderRadius: 4, cursor: 'pointer', border: `1.5px solid ${allChecked ? 'var(--blue)' : 'var(--border2)'}`, background: allChecked ? 'var(--blue)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {allChecked && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{unreadCount} unread · {filtered.length} shown</span>
            </div>
            {checkedIds.size > 0 && (
              <button onClick={handleMassDelete} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer', background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)', fontWeight: 600 }}>
                🗑 Delete {checkedIds.size}
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 8 }}>
          {loading
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            : filtered.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No emails in {folder}</div>
            : filtered.map(email => (
              <EmailRow key={email.id} email={email} selected={selectedEmail?.id === email.id} checked={checkedIds.has(email.id)} onSelect={handleSelect} onCheck={toggleCheck} onDelete={handleDelete} />
            ))
          }
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg2)' }}>
        <EmailPreview email={selectedEmail} onOpenReply={mode => setReplyOverlay({ mode })} onDraftWithEly={mode => setReplyOverlay({ mode, openEly: true })} />
      </div>
    </div>
  );
}
