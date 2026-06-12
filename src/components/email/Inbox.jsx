import React, { useState, useEffect, useCallback, useRef } from 'react';
import sb from '../../supabaseClient';
import VoiceInput from '../shared/VoiceInput';
import { buildFirmSignatureHTML } from '../../utils/emailSignature';
import { useApp } from '../../state/appStore';

function BookingOverlay({ booking, onConfirm, onClose }) {
  const [form, setForm] = useState({
    title: booking.title || '',
    date: booking.date || '',
    time: booking.time || '',
    task_type: booking.task_type || 'appointment',
    project_id: booking.project_id || '',
    project_address: booking.project_address || '',
    description: booking.description || '',
  });

  const [projects, setProjects] = useState([]);
  useEffect(() => {
    sb.from('projects').select('id,ref,bo_premise_address').order('created_at', { ascending: false })
      .then(({ data }) => setProjects(data || []));
  }, []);

  const inp = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>📅 Add to diary</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>TITLE</div>
            <input style={inp} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>DATE</div>
              <input type="date" style={inp} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>TIME</div>
              <input type="time" style={inp} value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>TYPE</div>
            <select style={inp} value={form.task_type} onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}>
              <option value="appointment">Appointment</option>
              <option value="soc">Schedule of Condition</option>
              <option value="site_visit">Site Visit</option>
              <option value="meeting">Meeting</option>
              <option value="reminder">Reminder</option>
              <option value="deadline">Deadline</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>PROJECT</div>
            <select style={inp} value={form.project_id} onChange={e => {
              const proj = projects.find(p => p.id === e.target.value);
              const addr = proj?.bo_premise_address || '';
              setForm(f => ({ 
                ...f, 
                project_id: e.target.value, 
                project_address: addr,
                title: addr ? 'SOC — ' + addr : f.title
              }));
            }}>
              <option value="">No project linked</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.bo_premise_address || p.ref || p.id}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>NOTES</div>
            <input style={inp} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text3)' }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(form)} disabled={!form.title || !form.date}
            style={{ padding: '8px 20px', background: form.title && form.date ? '#10b981' : 'var(--border)', color: form.title && form.date ? '#fff' : 'var(--text3)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: form.title && form.date ? 'pointer' : 'not-allowed' }}>
            ✅ Book it in
          </button>
        </div>
      </div>
    </div>
  );
}

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return width;
}

const isMobileWidth = (w) => w < 768;

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
  const [resolvedHtml, setResolvedHtml] = React.useState(null);

  React.useEffect(() => {
    if (!body || !isHtmlEmail(body)) { setResolvedHtml(null); return; }

    // Check if body has cid: references
    if (!body.includes('cid:')) { setResolvedHtml(body); return; }

    // Fetch inline attachments and resolve cid: references
    (async () => {
      try {
        const { data: inlineAttachments } = await sb
          .from('email_attachments')
          .select('content_id, provider_download_url, content_type, storage_path')
          .eq('email_id', email.id)
          .eq('is_inline', true);

        if (!inlineAttachments?.length) { setResolvedHtml(body); return; }

        let html = body;
        await Promise.all(inlineAttachments.map(async (att) => {
          if (!att.content_id) return;
          const cid = att.content_id.replace(/[<>]/g, '');
          if (!html.includes(cid)) return;

          try {
            // Try provider_download_url first, then storage
            const url = att.provider_download_url || (att.storage_path
              ? sb.storage.from('email_attachments').getPublicUrl(att.storage_path).data?.publicUrl
              : null);
            if (!url) return;

            const res = await fetch(url);
            if (!res.ok) return;
            const blob = await res.blob();
            const reader = new FileReader();
            const dataUrl = await new Promise(resolve => {
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            html = html.replace(new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), dataUrl);
          } catch { /* skip this image */ }
        }));

        setResolvedHtml(html);
      } catch { setResolvedHtml(body); }
    })();
  }, [email.id, body]);

  if (!body) return <div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.8 }}>{email.body_preview || 'No content.'}</div>;

  const htmlToRender = resolvedHtml !== null ? resolvedHtml : body;

  if (isHtmlEmail(body)) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7;color:#222;margin:16px;padding:0;background:#fff}a{color:#4f7fff}img{max-width:100%;height:auto}*{box-sizing:border-box}</style></head><body>${htmlToRender}</body></html>`;
    return <iframe srcDoc={html} sandbox="allow-same-origin allow-popups" style={{ width: '100%', height: '100%', border: 'none', flex: 1 }} title="email-body" />;
  }
  return <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{body}</div>;
}

// ── Extract draft from Ely response ─────────────────────────────────────────
function extractDraft(text) {
  if (!text) return null;
  // Look for content between --- markers
  const betweenDashes = text.match(/---+\s*\n([\s\S]+?)\n\s*---+/);
  if (betweenDashes) return betweenDashes[1].trim();
  // Look for after "Here's a draft:" or "Suggested draft:" etc
  const afterDraft = text.match(/(?:draft|reply)[:\s]+\n+([\s\S]{30,})/i);
  if (afterDraft) return afterDraft[1].trim();
  // Look for common email greetings
  const greetings = /((?:Dear|Hi|Hello|Good morning|Good afternoon|Thank you for|Further to|Following|I refer|I write|I am writing|With reference|As discussed|As agreed)[\s\S]{30,})/;
  const fromGreeting = text.match(greetings);
  if (fromGreeting) return fromGreeting[1].trim();
  // If text contains a sign-off (Kind regards, Yours, Best) it's likely a draft
  if (/kind regards|yours sincerely|yours faithfully|many thanks|best regards/i.test(text) && text.length > 80) {
    return text.trim();
  }
  return null;
}

// ── Draft with Ely — full screen overlay ─────────────────────────────────────
// Left: original email in full | Right: Ely collaboration with voice

function DraftWithElyOverlay({ email, threadEmails, onSendWithDraft, onClose }) {
  const windowWidth = useWindowWidth();
  const isMobile = isMobileWidth(windowWidth);
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [workingDraft, setWorkingDraft] = useState('');
  const workingDraftRef = useRef(''); // ref always has latest — survives re-renders
  const [loading, setLoading]         = useState(false);
  const [interimText, setInterimText] = useState('');
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [firmSettings, setFirmSettings] = useState(null);
  const voiceBaseRef  = useRef('');
  const endRef        = useRef(null);
  const hasAutoRun    = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  useEffect(() => {
    sb.from('firm_settings').select('surveyor_name,qualifications,firm_name,trading_name,email,tel,address_line1,address_line2,city,postcode,website,signature_b64,logo_base64,accreditation_b64').limit(1)
      .then(({ data }) => { if (data?.[0]) setFirmSettings(data[0]); });
  }, []);

  // Auto-draft on open
  useEffect(() => {
    if (hasAutoRun.current === email?.id || !email) return;
    hasAutoRun.current = email.id;

    const fullThread = threadEmails.length > 1
      ? [...threadEmails]
          .sort((a, b) => new Date(a.received_at) - new Date(b.received_at))
          .map(e => `--- ${fmtDate(e.received_at)} | From: ${e.sender_name || e.sender_email} ---\n${stripHtml(e.body || e.body_preview || '')}`)
          .join('\n\n')
      : stripHtml(email.body || email.body_preview || '');

    const sigNote = firmSettings ? 'Do not add a sign-off, name or signature.' : '';
    const prompt = `Read this ${threadEmails.length > 1 ? `email thread (${threadEmails.length} emails)` : 'email'} and give me a brief plain-text summary:

From: [sender name and firm]

Asking for:
- [what they are specifically requesting]

Context:
- [key background only if relevant to replying]

Suggested reply:
[1-2 sentences on best approach]

No markdown, no asterisks, no bold, no long headings. Be concise. Wait for instructions before drafting. ${sigNote}`;

    callEly(prompt, fullThread, true);
  }, [email, threadEmails, firmSettings]);

  const callEly = async (text, threadTextOverride, isAuto = false) => {
    if (loading) return;
    setLoading(true);

    if (!isAuto) {
      setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    } else {
      setMessages([{ id: 0, role: 'system', content: `✨ Reading ${(threadEmails || []).length > 1 ? `thread (${(threadEmails || []).length} emails)` : 'email'} and drafting…` }]);
    }

    try {
      const fullThread = threadTextOverride || ((threadEmails || []).length > 1
        ? [...(threadEmails || [])]
            .sort((a, b) => new Date(a.received_at) - new Date(b.received_at))
            .map(e => `--- ${fmtDate(e.received_at)} | From: ${e.sender_name || e.sender_email} ---\n${stripHtml(e.body || e.body_preview || '')}`)
            .join('\n\n')
        : stripHtml((email || {}).body || (email || {}).body_preview || ''));
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'ely')
        .map(m => ({
          role: m.role === 'ely' ? 'assistant' : 'user',
          content: m.draft
            ? `${m.explanation || ''}\n\n---\n${m.draft}\n---`
            : (m.content || m.explanation || ''),
        }));

      // If we have a working draft, inject it so Ely holds it
      const promptWithDraft = workingDraft && !isAuto
        ? `Current working draft:\n---\n${workingDraft}\n---\n\nInstruction: ${text}`
        : text;

      const res = await fetch('/api/ely-smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptWithDraft,
          surface: 'inbox_draft',
          chatHistory: isAuto ? [] : history,
          emailContext: {
            from: email.sender_name || email.sender_email,
            subject: email.subject,
            threadText: fullThread,
            body: fullThread,
          },
        }),
      });

      const data = await res.json();
      const reply = data.reply || data.replyText || 'Could not generate a draft.';
      const draft = data.documentText || extractDraft(reply);
      const explanation = draft
        ? (data.replyText && data.replyText !== reply
          ? data.replyText
          : reply
              .replace(/---[\s\S]*?---/, '')
              .replace(/(?:^|\n)\s*(?:DRAFT REPLY|SUGGESTED DRAFT|SUGGESTED REPLY|DRAFT)\s*:?\s*[\s\S]*$/i, '')
              .trim())
        : reply;

      const msgId = Date.now() + 1;
      const newMsg = { id: msgId, role: 'ely', explanation: explanation?.trim(), draft };

      if (isAuto) {
        setMessages([newMsg]);
      } else {
        setMessages(prev => [...prev, newMsg]);
      }

      // Always update working draft with latest draft
      if (draft) {
        setWorkingDraft(draft);
        workingDraftRef.current = draft;
      }
    } catch (err) {
      console.error('[DraftWithEly] callEly error:', err);
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'ely',
        explanation: 'Could not connect to Ely. Please try again.', draft: null,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setInterimText('');
    voiceBaseRef.current = '';
    setVoiceStopSignal(s => s + 1);
    callEly(text);
  };

  // VoiceInput handler — accumulates transcript onto typed base
  const handleVoice = (transcript, meta) => {
    if (meta?.interim) {
      setInterimText(meta.interim);
    } else {
      setInterimText('');
    }
    if (!voiceBaseRef.current) voiceBaseRef.current = input.trim();
    const base = voiceBaseRef.current;
    const next = base ? `${base} ${transcript}` : transcript;
    setInput(next);
  };

  const handleTextChange = (e) => {
    voiceBaseRef.current = '';
    setInput(e.target.value);
  };

  const isHtml = isHtmlEmail(email?.body || '');
  const emailHtml = isHtml ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7;color:#222;margin:16px;padding:0;background:#fff}a{color:#4f7fff}img{max-width:100%}</style></head><body>${email?.body}</body></html>` : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'var(--bg2)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✨</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Draft with Ely</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{email?.subject}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {messages.some(m => m.role === 'ely') && (
            <button
              onClick={() => {
                // Use ref first (most reliable), then state, then latest message draft
                const body = workingDraftRef.current
                  || workingDraft
                  || [...messages].reverse().find(m => m.role === 'ely' && m.draft)?.draft
                  || extractDraft([...messages].reverse().find(m => m.role === 'ely')?.explanation || '')
                  || [...messages].reverse().find(m => m.role === 'ely')?.explanation
                  || '';
                if (!body) { alert('Ask Ely to produce a draft first.'); return; }
                onSendWithDraft({
                  to: email?.sender_email || '',
                  subject: `Re: ${email?.subject || ''}`,
                  body,
                });
              }}
              style={{
                padding: '7px 18px', borderRadius: 99, border: 'none',
                background: 'var(--blue)', color: '#fff', fontSize: 13,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              ↩ Send this email
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* Body — split screen on desktop, full screen chat on mobile */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT — original email — hidden on mobile */}
        <div style={{
          width: isMobile ? '0%' : '50%',
          display: isMobile ? 'none' : 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 18px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg3)', flexShrink: 0,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{email?.subject}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {email?.sender_name || email?.sender_email}
              {email?.received_at && ` · ${fmtDate(email.received_at)}`}
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: isHtml ? '#fff' : 'transparent' }}>
            {isHtml
              ? <iframe srcDoc={emailHtml} sandbox="allow-same-origin allow-popups" style={{ width: '100%', height: '100%', border: 'none' }} title="email-content" />
              : <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontSize: 13.5, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {stripHtml(email?.body || email?.body_preview || '')}
                </div>
            }
          </div>
        </div>

        {/* RIGHT — Ely collaboration — full width on mobile */}
        <div style={{ width: isMobile ? '100%' : '50%', display: 'flex', flexDirection: 'column', background: 'var(--bg3)', overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map(msg => (
              <div key={msg.id}>
                {msg.role === 'user' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ maxWidth: '88%', background: 'var(--blue)', color: '#fff', padding: '9px 13px', borderRadius: '12px 12px 4px 12px', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {msg.content}
                    </div>
                  </div>
                )}
                {msg.role === 'system' && (
                  <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '9px 13px', borderRadius: 10, fontSize: 12, color: 'var(--text3)' }}>
                    {msg.content}
                  </div>
                )}
                {msg.role === 'ely' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {msg.explanation && msg.explanation.length > 5 && (
                      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '10px 13px', borderRadius: 10, fontSize: 13, color: 'var(--text2)', lineHeight: 1.65 }}>
                        {msg.explanation}
                      </div>
                    )}
                    {msg.draft && (
                      <div style={{ background: 'var(--blue-bg)', border: '1px solid var(--blue)', borderRadius: 10, overflow: 'hidden' }}>
                        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--blue)', background: 'rgba(79,127,255,0.1)' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Draft reply</span>
                        </div>
                        <div style={{ padding: '10px 13px', fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{msg.draft}</div>
                        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--blue)', background: 'rgba(79,127,255,0.05)', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => navigator.clipboard.writeText(msg.draft)}
                            style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--blue)', background: 'transparent', color: 'var(--blue)', cursor: 'pointer' }}>
                            Copy
                          </button>
                          <button onClick={() => {
                            workingDraftRef.current = msg.draft;
                            setWorkingDraft(msg.draft);
                            const htmlDraft = msg.draft && !msg.draft.trim().startsWith('<')
                              ? msg.draft.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
                              : msg.draft || '';
                            onSendWithDraft({ to: email?.sender_email || '', subject: `Re: ${email?.subject || ''}`, body: htmlDraft });
                          }}
                            style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, border: 'none', background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                            ↩ Send this
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '10px 13px', borderRadius: 10, fontSize: 13, color: 'var(--text3)' }}>
                ✨ Reading & drafting…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Quick suggestions — only before first exchange */}
          {messages.length <= 1 && !loading && (
            <div style={{ padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--border)' }}>
              {['Make it firmer', 'Make it shorter', 'Add more context', 'Produce a final amendment list', 'Ignore the last point'].map(s => (
                <button key={s} onClick={() => { setInput(s); }}
                  style={{ padding: '4px 11px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)' }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Live interim voice preview */}
          {interimText && (
            <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
              🎤 {interimText}
            </div>
          )}

          {/* Input row */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 7, alignItems: 'flex-end', background: 'var(--bg2)' }}>
            <div className="main-chat-input-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 7, flex: 1 }}>
              <VoiceInput onTranscript={handleVoice} disabled={loading} stopSignal={voiceStopSignal} />
              <textarea
                value={input}
                onChange={handleTextChange}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
                placeholder="Ask Ely to adjust, change tone, add a point…"
                rows={2}
                style={{ flex: 1, padding: '8px 10px', fontSize: 13, resize: 'none', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none' }}
              />
            </div>
            <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm"
              style={{ cursor: 'pointer', borderRadius: 8, fontSize: 12, height: 34, alignSelf: 'flex-end' }}>
              Send
            </button>
          </div>

          {/* CSS for voice button and pulse */}
          <style>{`
            .voice-btn { transition: color 0.15s; }
            .voice-btn.listening, .voice-btn.recording { color: #ef4444 !important; }
            .voice-btn:hover { color: #6b7280 !important; }
            .voice-btn.listening:hover { color: #dc2626 !important; }
          `}</style>
        </div>
      </div>
    </div>
  );
}

// ── Reply Overlay ─────────────────────────────────────────────────────────────
import { toHtml, cleanSignOff } from '../../utils/draftUtils';

function ReplyOverlay({ email, mode, threadEmails, onSend, onClose, prefillBody, prefillTo, prefillSubject }) {
  const [to, setTo]           = useState(prefillTo || email?.sender_email || '');
  const [cc, setCc]           = useState(mode === 'replyAll'
    ? (Array.isArray(email?.to_emails) ? email.to_emails.map(r => r.email || r).filter(e => e !== email?.sender_email).join(', ') : email?.to_email || '')
    : '');
  const [subject, setSubject] = useState(prefillSubject || `Re: ${email?.subject || ''}`);
  const [body, setBody]       = useState(toHtml(prefillBody) || '');
  const [showEly, setShowEly] = useState(false);
  const [sending, setSending] = useState(false);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [createTask, setCreateTask]             = useState(false);
  const [firmSettings, setFirmSettings]         = useState(null);
  const [attachments, setAttachments]           = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    sb.from('firm_settings').select('surveyor_name,qualifications,firm_name,trading_name,email,tel,address_line1,address_line2,city,postcode,website,signature_b64,logo_base64,accreditation_b64').limit(1)
      .then(({ data }) => { if (data?.[0]) setFirmSettings(data[0]); });
  }, []);

  useEffect(() => {
    if (prefillTo) setTo(prefillTo);
    if (prefillSubject) setSubject(prefillSubject);
    if (typeof prefillBody === 'string' && prefillBody.trim()) setBody(toHtml(prefillBody));
  }, [prefillBody, prefillTo, prefillSubject]);

  const signatureHtml = firmSettings ? buildFirmSignatureHTML(firmSettings) : '';

  const handleSend = async () => {
    const htmlBody = bodyEditorRef.current?.innerHTML || body;
    if (!to.trim() || !htmlBody.trim()) return;
    setSending(true);
    try {
      const outgoingBody = includeSignature && signatureHtml
        ? `${htmlBody}<br><br>${signatureHtml}`
        : htmlBody;

      await onSend({ to, cc, subject, body: outgoingBody, replyToId: email?.id, includeSignature, createTask, attachments });
      setSending(false);
      onClose();
    } catch (err) {
      setSending(false);
      alert(err.message || 'Could not send email. Please try again.');
    }
  };

  const handleElyDraft = (draft, close = false) => {
    // Convert plain text line breaks to HTML paragraphs
    const html = draft && !draft.trim().startsWith('<')
      ? draft.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
      : draft || '';
    setBody(html);
    if (bodyEditorRef.current) {
      bodyEditorRef.current.innerHTML = html;
    }
    if (close) setShowEly(false);
  };

  const handleAttachFile = (e) => {
    const files = Array.from(e.target.files || []);
    const readers = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, base64: reader.result.split(',')[1] });
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(fileData => {
      setAttachments(prev => [...prev, ...fileData]);
    });
    e.target.value = ''; // reset so same file can be re-added
  };

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx));

  const [showFormatBar, setShowFormatBar] = useState(false);
  const bodyEditorRef = useRef(null);
  const inp = { width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

  useEffect(() => {
    if (bodyEditorRef.current && prefillBody) {
      const html = toHtml(prefillBody);
      bodyEditorRef.current.innerHTML = html;
      setBody(html);
    }
  }, [prefillBody]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 1300, margin: '10px 16px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, display: 'flex', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{mode === 'replyAll' ? '↩↩ Reply All' : '↩ Reply'}</div>
              {/* Format button */}
              <button
                onClick={() => setShowFormatBar(f => !f)}
                title="Text formatting"
                style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: showFormatBar ? 'var(--blue)' : 'var(--bg3)',
                  color: showFormatBar ? '#fff' : 'var(--text2)',
                  border: '1px solid var(--border)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >A</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!showEly && <button onClick={() => setShowEly(true)} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>✨ Draft with Ely</button>}
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
          </div>

          {/* Formatting toolbar — shown when A is tapped */}
          {showFormatBar && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 16px',
              borderBottom: '1px solid var(--border)', background: 'var(--bg3)',
            }}>
              {[['bold','B','700'],['italic','I','400'],['underline','U','400']].map(([cmd,label,fw]) => (
                <button key={cmd} type="button"
                  onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); bodyEditorRef.current?.focus(); }}
                  style={{ padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', fontWeight: fw, fontStyle: cmd==='italic'?'italic':'normal', textDecoration: cmd==='underline'?'underline':'none', fontSize: 13, minWidth: 28 }}
                >{label}</button>
              ))}
              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>A</span>
                <input type="color" defaultValue="#1d4ed8"
                  onInput={e => { document.execCommand('foreColor', false, e.target.value); bodyEditorRef.current?.focus(); }}
                  style={{ width: 24, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}
                  title="Text colour"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>H</span>
                <input type="color" defaultValue="#fef08a"
                  onInput={e => { document.execCommand('hiliteColor', false, e.target.value); bodyEditorRef.current?.focus(); }}
                  style={{ width: 24, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}
                  title="Highlight"
                />
              </div>
              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
              <select defaultValue="3"
                onChange={e => { document.execCommand('fontSize', false, e.target.value); bodyEditorRef.current?.focus(); }}
                style={{ padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}
              >
                <option value="1">Small</option>
                <option value="3">Normal</option>
                <option value="4">Large</option>
                <option value="5">Larger</option>
              </select>
              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />
              <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat'); bodyEditorRef.current?.focus(); }}
                style={{ padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }}>✕ fmt</button>
            </div>
          )}
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
              <div
                ref={bodyEditorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={e => setBody(e.currentTarget.innerHTML)}
                data-placeholder="Type your reply here, or use ✨ Draft with Ely…"
                style={{
                  flex: 1, minHeight: 320, padding: '8px 12px',
                  fontSize: 13, background: '#fff',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: '#000', outline: 'none',
                  lineHeight: 1.7, overflowY: 'auto',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            {firmSettings && includeSignature && signatureHtml && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 52, flexShrink: 0 }} />
                <div
                  style={{ flex: 1, padding: '10px 14px', background: '#fff', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.8, overflowX: 'auto' }}
                  dangerouslySetInnerHTML={{ __html: signatureHtml }}
                />
              </div>
            )}
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
          {/* Signature + checkboxes + attach */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>

            {/* Checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={includeSignature} onChange={e => setIncludeSignature(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
                Include signature
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={createTask} onChange={e => setCreateTask(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
                Create follow-up task
                <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Default due date: 10 days</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: email?.project_id ? 'var(--blue-bg)' : 'var(--bg3)', color: email?.project_id ? 'var(--blue)' : 'var(--text3)', border: email?.project_id ? 'none' : '1px solid var(--border)' }}>
                  {email?.project_id ? 'Project linked' : 'No project'}
                </span>
              </label>
            </div>

            {/* Attachments list */}
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {attachments.map((att, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
                    <span>📎 {att.name}</span>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>({Math.round(att.size/1024)}kb)</span>
                    <button onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 15, padding: '0 2px', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Footer buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" style={{ display: 'none' }} onChange={handleAttachFile} />
                <button onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 12.5, cursor: 'pointer', color: 'var(--text2)' }}>
                  📎 Attach file
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
                <button onClick={handleSend} disabled={sending || !body.trim() || !to.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>
                  {sending ? 'Sending…' : '↩ Send reply'}
                </button>
              </div>
            </div>
          </div>
        </div>
        {showEly && (
          <DraftWithElyOverlay
            email={email}
            threadEmails={threadEmails}
            onUseDraft={(draft) => handleElyDraft(draft, true)}
            onClose={() => setShowEly(false)}
          />
        )}
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
            {email.project_id && <span title="Linked to project" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 700 }}>Project</span>}
            {catColour && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${catColour}22`, color: catColour, fontWeight: 600 }}>{cat.replace(/_/g,' ')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}



// ── Project communication memory helpers ─────────────────────────────────────
function makeEmailMemoryPayload(email, projectId, source = 'manual_inbox_link') {
  const cleanBody = stripHtml(email?.body || email?.body_preview || '');
  return {
    project_id: projectId,
    source_type: 'email',
    source_id: String(email?.id || ''),
    title: email?.subject || 'Email',
    summary: `${email?.sender_name || email?.sender_email || 'Unknown sender'} — ${email?.subject || 'No subject'}`,
    content: cleanBody.slice(0, 6000),
    metadata: {
      source,
      email_id: email?.id || null,
      thread_id: email?.thread_id || null,
      sender_name: email?.sender_name || null,
      sender_email: email?.sender_email || null,
      received_at: email?.received_at || null,
      folder: email?.folder || null,
      has_attachments: !!email?.has_attachments,
    },
    importance_score: email?.has_attachments ? 0.7 : 0.45,
  };
}

async function insertProjectMemoryForEmail(email, projectId, source = 'manual_inbox_link') {
  if (!sb || !email || !projectId) return;
  try {
    await sb.from('project_memory').insert([makeEmailMemoryPayload(email, projectId, source)]);
  } catch (err) {
    console.warn('project_memory insert warning:', err?.message || err);
  }
}

async function linkEmailToProject(email, projectId, source = 'manual_inbox_link') {
  if (!sb || !email || !projectId) return;

  const updatePayload = {
    project_id: projectId,
    link_status: 'manually_linked',
    manually_linked: true,
    project_match_confidence: 100,
    project_match_source: source,
  };

  await sb.from('emails').update(updatePayload).eq('id', email.id);

  if (email.thread_id) {
    await sb.from('emails').update({
      project_id: projectId,
      link_status: 'auto_linked',
      project_match_confidence: 90,
      project_match_source: 'thread_inherited',
    }).eq('thread_id', email.thread_id).neq('id', email.id);
  }

  await insertProjectMemoryForEmail(email, projectId, source);
}

// ── Project link banner ──────────────────────────────────────────────────────
function ProjectLinkBanner({ email, onLinked }) {
  const [projects, setProjects]   = useState([]);
  const [selected, setSelected]   = useState('');
  const [saving, setSaving]       = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!email || dismissed) return;
    // Only show for unlinked emails
    if (email.link_status === 'auto_linked' || email.link_status === 'manually_linked') return;
    // Load active projects for the dropdown
    sb.from('projects').select('id,ref,bo_premise_address,bo,status')
      .neq('status', 'closed').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setProjects(data || []));
  }, [email, dismissed]);

  if (!email || dismissed) return null;
  if (email.link_status === 'auto_linked' || email.link_status === 'manually_linked') return null;
  if (projects.length === 0) return null;

  const handleLink = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await linkEmailToProject(email, selected, 'manual_preview_banner');
      onLinked?.(selected);
      setDismissed(true);
    } catch (err) {
      console.warn('Project link failed:', err?.message || err);
      alert('Could not link this email to the project. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div style={{
      padding: '8px 14px', background: 'var(--blue-bg)', borderBottom: '1px solid var(--blue)',
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--blue)', flexShrink: 0 }}>
        🔗 Link to project?
      </span>
      <select value={selected} onChange={e => setSelected(e.target.value)}
        style={{ flex: 1, minWidth: 160, padding: '4px 8px', fontSize: 12.5, borderRadius: 8, border: '1px solid var(--blue)', background: '#fff', color: 'var(--text)', cursor: 'pointer' }}>
        <option value="">Select project…</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.ref} — {p.bo_premise_address || p.bo || 'Unknown'}
          </option>
        ))}
      </select>
      <button onClick={handleLink} disabled={!selected || saving}
        style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed', background: 'var(--blue)', color: '#fff', border: 'none', opacity: selected ? 1 : 0.5 }}>
        {saving ? 'Linking…' : 'Link'}
      </button>
      <button onClick={() => setDismissed(true)}
        style={{ padding: '4px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)' }}>
        Skip
      </button>
    </div>
  );
}

// ── Save attachment popup ─────────────────────────────────────────────────────
function SaveAttachmentPopup({ email, onDismiss }) {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState('');
  const [saving, setSaving]     = useState(false);
  const [done, setDone]         = useState(false);

  useEffect(() => {
    sb.from('projects').select('id,ref,bo_premise_address,bo')
      .neq('status', 'closed').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setProjects(data || []));
  }, []);

  if (done) return null;

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await linkEmailToProject(email, selected, 'manual_attachment_popup');
      setDone(true);
      onDismiss?.();
    } catch (err) {
      console.warn('Attachment project link failed:', err?.message || err);
      alert('Could not link this email to the project. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div style={{
      position: 'absolute', right: 16, top: 60, zIndex: 200,
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px', width: 300,
      boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>📎</span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Save attachment?</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.6 }}>
        This email has attachments. Link it to a project to keep them organised.
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text3)', marginBottom: 6 }}>Save to project:</div>
      <select value={selected} onChange={e => setSelected(e.target.value)}
        style={{ width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', marginBottom: 12, cursor: 'pointer' }}>
        <option value="">— Select project —</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.bo_premise_address || p.address || p.bo || 'Unknown'}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSave} disabled={!selected || saving}
          style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed', opacity: selected ? 1 : 0.5 }}>
          {saving ? 'Saving…' : 'Link to project'}
        </button>
        <button onClick={() => { setDone(true); onDismiss?.(); }}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 13, cursor: 'pointer', color: 'var(--text2)' }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Email preview panel ───────────────────────────────────────────────────────
function AttachmentChip({ att }) {
  const ext = (att.filename || '').split('.').pop().toLowerCase();
  const icon = ['pdf'].includes(ext) ? '📄' : ['doc','docx'].includes(ext) ? '📝' : ['jpg','jpeg','png','gif','webp'].includes(ext) ? '🖼️' : ['xls','xlsx'].includes(ext) ? '📊' : '📎';
  const sizeLabel = att.size_bytes ? (att.size_bytes > 1048576 ? `${(att.size_bytes/1048576).toFixed(1)}MB` : `${Math.round(att.size_bytes/1024)}KB`) : '';
  const shortName = (att.filename || 'File').length > 20 ? (att.filename || 'File').slice(0, 20) + '…' : (att.filename || 'File');
  const canOpen = !!(att.email_external_id && att.attachment_external_id);

  const handleOpen = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canOpen) return;
    const params = new URLSearchParams({
      email_id: att.email_external_id,
      att_id: att.attachment_external_id,
      filename: att.filename || 'attachment',
      content_type: att.content_type || '',
    });
    window.open(`/api/attachment-url?${params}`, '_blank');
  };

  return (
    <div
      onClick={handleOpen}
      title={att.filename}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 6,
        border: '1px solid var(--border)', background: 'var(--bg)',
        fontSize: 11.5, color: canOpen ? 'var(--text)' : 'var(--text3)',
        cursor: canOpen ? 'pointer' : 'default',
        whiteSpace: 'nowrap', flexShrink: 0, userSelect: 'none',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontWeight: 500 }}>{shortName}</span>
      {sizeLabel && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{sizeLabel}</span>}
    </div>
  );
}

function EmailPreview({ email, onOpenReply, onDraftWithEly, onEmailLinked }) {
  const [attachments, setAttachments] = useState([]);

  useEffect(() => {
    if (!email?.id || !sb) { setAttachments([]); return; }
    sb.from('email_attachments')
      .select('id, email_id, email_external_id, attachment_external_id, filename, content_type, size_bytes, is_inline')
      .eq('email_id', email.id)
      .or('is_inline.is.null,is_inline.eq.false')
      .not('attachment_external_id', 'is', null)
      .then(({ data }) => setAttachments(data || []))
      .catch(() => setAttachments([]));
  }, [email?.id]);
  const [replyDropOpen, setReplyDropOpen]   = useState(false);
  const [showSavePopup, setShowSavePopup]   = useState(false);
  const dropRef = useRef(null);

  // Show save popup automatically when email has attachments and is unlinked
  useEffect(() => {
    if (email?.has_attachments && email?.link_status === 'unlinked') {
      setShowSavePopup(true);
    } else {
      setShowSavePopup(false);
    }
  }, [email?.id]);

  useEffect(() => {
    const h = e => { if (dropRef.current && !dropRef.current.contains(e.target)) setReplyDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!email) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>Select an email to read</div>;

  const isHtml = isHtmlEmail(email.body || '');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}>
      {showSavePopup && <SaveAttachmentPopup email={email} onDismiss={() => setShowSavePopup(false)} />}
      <ProjectLinkBanner email={email} onLinked={(projectId) => onEmailLinked?.(email, projectId)} />
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
            <button onClick={() => onDraftWithEly()} className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>✨ Draft with Ely</button>
          </div>
        </div>
      </div>
      {attachments.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, padding: '7px 16px',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto', flexShrink: 0,
          background: 'var(--bg2)',
          scrollbarWidth: 'thin',
        }}>
          {attachments.map(att => (
            <AttachmentChip key={att.id} att={att} />
          ))}
        </div>
      )}
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
  const { state, dispatch } = useApp();
  const [loading, setLoading]            = useState(false);
  const [selectedEmail, setSelectedEmail]= useState(null);
  const [threadEmails, setThreadEmails]  = useState([]);
  const [folder, setFolder]              = useState('Inbox');
  const [folderOpen, setFolderOpen]      = useState(false);
  const [search, setSearch]              = useState('');
  const [syncing, setSyncing]            = useState(false);
  const [checkedIds, setCheckedIds]      = useState(new Set());
  const [bulkProjects, setBulkProjects]  = useState([]);
  const [bulkProjectId, setBulkProjectId]= useState('');
  const [bulkLinking, setBulkLinking]    = useState(false);
  const [replyOverlay, setReplyOverlay]  = useState(null);
  const [draftWithEly, setDraftWithEly]  = useState(false);
  const [mobileShowEmail, setMobileShowEmail] = useState(false);
  const windowWidth = useWindowWidth();
  const isMobile = isMobileWidth(windowWidth);
  const folderRef = useRef(null);

  useEffect(() => {
    const h = e => { if (folderRef.current && !folderRef.current.contains(e.target)) setFolderOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!sb) return;
    sb.from('projects').select('id,ref,bo_premise_address,bo,status')
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setBulkProjects(data || []));
  }, []);

  const syncingRef = useRef(false);

  const loadEmails = useCallback(async ({ force = false } = {}) => {
    if (!sb) return;
    // Skip reload if already have emails in global state and not forced
    if (!force && state.emails && state.emails.length > 0) return;
    setLoading(true);
    try {
      let q = sb.from('emails').select('*').order('received_at', { ascending: false, nullsFirst: false }).limit(500);
      if (folder === 'Unread')  q = q.eq('is_read', false);
      if (folder === 'Flagged') q = q.eq('flagged', true);
      if (folder === 'Drafts')  q = q.eq('is_draft', true);
      if (folder === 'Sent')    q = q.eq('is_sent', true);
      if (folder === 'Inbox')   q = q.or('folder.eq.inbox,folder.is.null').or('is_draft.is.null,is_draft.eq.false').or('is_sent.is.null,is_sent.eq.false').or('sender_email.is.null,sender_email.neq.help@sq1consulting.co.uk');
      const { data, error } = await q;
      if (error) throw error;

      let emails = data || [];

      // Lightweight: mark which emails have attachments (for paperclip indicator)
      if (emails.length > 0) {
        try {
          const emailIds = emails.map(e => e.id).filter(Boolean);
          const { data: hasAttach } = await sb
            .from('email_attachments')
            .select('email_id')
            .in('email_id', emailIds);
          if (hasAttach?.length) {
            const attachedSet = new Set(hasAttach.map(a => a.email_id));
            emails = emails.map(e => ({ ...e, has_attachments: attachedSet.has(e.id) }));
          }
        } catch {}
      }

      dispatch({ type: 'SET_EMAILS', payload: emails });
    } catch (err) { console.error('loadEmails:', err); }
    setLoading(false);
  }, [folder]);

  // Initial load only
  useEffect(() => { loadEmails({ force: true }); }, [folder]);

  // Auto-sync every 3 minutes — only if not already syncing
  useEffect(() => {
    const interval = setInterval(async () => {
      if (syncingRef.current) return; // prevent overlap
      syncingRef.current = true;
      try {
        const { data, error } = await sb.functions.invoke('sync_outlook', { body: {} });
        if (!error && data?.newEmails > 0) {
          await loadEmails();
        }
      } catch (err) {
        console.warn('[auto-sync] error:', err);
      } finally {
        syncingRef.current = false;
      }
    }, 3 * 60 * 1000); // 3 minutes

    return () => clearInterval(interval);
  }, [loadEmails]);

  const loadThread = useCallback(async (email) => {
    if (!sb || !email.thread_id) { setThreadEmails([email]); return; }
    try {
      const { data } = await sb.from('emails').select('*').eq('thread_id', email.thread_id).order('received_at', { ascending: true });
      setThreadEmails(data && data.length > 0 ? data : [email]);
    } catch { setThreadEmails([email]); }
  }, []);

  const [appointmentPrompt, setAppointmentPrompt] = useState(null);
  const [bookingOverlay, setBookingOverlay] = useState(null); // pre-filled booking form

  const handleSelect = async (email) => {
    setSelectedEmail(email);
    setAppointmentPrompt(null); // clear any previous prompt
    loadThread(email);
    if (isMobile) setMobileShowEmail(true);
    if (!email.is_read && sb) {
      await sb.from('emails').update({ is_read: true }).eq('id', email.id);
      dispatch({ type: 'UPDATE_EMAIL', payload: { id: email.id, is_read: true } });
    }

    // ── Silent appointment detection ──────────────────────────────────────
    // Run in background — check if email contains a proposed date/time
    setTimeout(async () => {
      try {
        const res = await fetch('/api/detect-appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email_id: email.id,
            subject: email.subject || '',
            body: stripHtml(email.body || email.body_text || '').slice(0, 3000),
            from: email.from || email.sender_name || email.from_email || '',
            thread_id: email.thread_id || null,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.appointment_detected) {
          setAppointmentPrompt(data);
        }
      } catch { /* silent — never interrupt the user */ }
    }, 800); // slight delay so email renders first
  };

  // Fix 2: Refresh calls Supabase sync_outlook edge function, not /api/sync-emails
  const handleSync = async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const { data: result, error: syncErr } = await sb.functions.invoke('sync_outlook', { body: {} });
if (syncErr) throw syncErr;
      await new Promise(r => setTimeout(r, 1000));
      try { await sb.rpc('match_emails_to_projects') } catch(_) {}
      // Only reload if new emails came in
      if (!result?.data || result?.data?.newEmails > 0) {
        await loadEmails();
      }
    } catch (err) {
      console.warn('Sync error:', err);
      await loadEmails();
    } finally {
      setSyncing(false);
      syncingRef.current = false;
    }
  };

  const handleSendReply = async ({ to, cc, subject, body: emailBody, replyToId, attachments = [] }) => {
    if (!sb) return;

    const funcPayload = {
      to_email: to,
      cc_email: cc || null,
      subject: subject,
      body: emailBody,
      reply_to_message_id: replyToId || null,
      attachments,
    };

    const { data, error } = await sb.functions.invoke('send_email_via_microsoft', {
      body: funcPayload,
    });

    if (error || data?.error) {
      const msg = error?.message || data?.error || 'Unknown error';
      if (msg.includes('401') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('expired')) {
        throw new Error('Your Microsoft account connection has expired. Go to Settings → Email → Reconnect, then try again.');
      }
      throw new Error('Could not send email: ' + msg);
    }

    // Save as sent in DB without using .catch() on the Supabase query builder
    try {
      const { error: insertError } = await sb.from('emails').insert([{
        subject,
        body: emailBody,
        is_sent: true,
        is_read: true,
        sender_email: 'help@sq1consulting.co.uk',
        to_email: to,
        thread_id: replyToId || null,
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }]);
      if (insertError) console.warn('Sent email DB insert warning:', insertError.message);
    } catch (insertErr) {
      console.warn('Sent email DB insert warning:', insertErr?.message || insertErr);
    }

    if (replyToId) {
      await sb.from('emails').update({ is_replied: true }).eq('id', replyToId);
      dispatch({ type: 'UPDATE_EMAIL', payload: { id: replyToId, is_replied: true } });
    }
  };


  const handleEmailLinked = (email, projectId) => {
    dispatch({ type: 'SET_EMAILS', payload: state.emails.map(e => {
      const sameEmail = e.id === email.id;
      const sameThread = email.thread_id && e.thread_id === email.thread_id;
      if (!sameEmail && !sameThread) return e;
      return {
        ...e,
        project_id: projectId,
        link_status: sameEmail ? 'manually_linked' : 'auto_linked',
        manually_linked: sameEmail ? true : e.manually_linked,
        project_match_confidence: sameEmail ? 100 : 90,
        project_match_source: sameEmail ? 'manual_preview_banner' : 'thread_inherited',
      };
    })});

    setSelectedEmail(prev => prev && (prev.id === email.id || (email.thread_id && prev.thread_id === email.thread_id))
      ? {
          ...prev,
          project_id: projectId,
          link_status: prev.id === email.id ? 'manually_linked' : 'auto_linked',
          manually_linked: prev.id === email.id ? true : prev.manually_linked,
          project_match_confidence: prev.id === email.id ? 100 : 90,
          project_match_source: prev.id === email.id ? 'manual_preview_banner' : 'thread_inherited',
        }
      : prev);
  };

  const handleBulkLinkToProject = async () => {
    if (!sb || checkedIds.size === 0 || !bulkProjectId) return;
    setBulkLinking(true);
    const ids = [...checkedIds];
    const selectedEmails = state.emails.filter(e => checkedIds.has(e.id));

    try {
      await sb.from('emails').update({
        project_id: bulkProjectId,
        link_status: 'manually_linked',
        manually_linked: true,
        project_match_confidence: 100,
        project_match_source: 'manual_bulk_inbox',
      }).in('id', ids);

      await Promise.all(selectedEmails.map(email => insertProjectMemoryForEmail(email, bulkProjectId, 'manual_bulk_inbox')));

      dispatch({ type: 'SET_EMAILS', payload: state.emails.map(e => checkedIds.has(e.id)
        ? {
            ...e,
            project_id: bulkProjectId,
            link_status: 'manually_linked',
            manually_linked: true,
            project_match_confidence: 100,
            project_match_source: 'manual_bulk_inbox',
          }
        : e) });

      setSelectedEmail(prev => prev && checkedIds.has(prev.id)
        ? {
            ...prev,
            project_id: bulkProjectId,
            link_status: 'manually_linked',
            manually_linked: true,
            project_match_confidence: 100,
            project_match_source: 'manual_bulk_inbox',
          }
        : prev);

      setCheckedIds(new Set());
      setBulkProjectId('');
    } catch (err) {
      console.warn('Bulk project link failed:', err?.message || err);
      alert('Could not link the selected emails. Please try again.');
    }

    setBulkLinking(false);
  };

  const handleDelete = async (id) => {
    if (!sb || !window.confirm('Delete this email?')) return;
    await sb.from('emails').delete().eq('id', id);
    dispatch({ type: 'SET_EMAILS', payload: state.emails.filter(e => e.id !== id) });
    if (selectedEmail?.id === id) setSelectedEmail(null);
    setCheckedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleMassDelete = async () => {
    if (!sb || checkedIds.size === 0 || !window.confirm(`Delete ${checkedIds.size} emails?`)) return;
    await sb.from('emails').delete().in('id', [...checkedIds]);
    dispatch({ type: 'SET_EMAILS', payload: state.emails.filter(e => !checkedIds.has(e.id)) });
    if (checkedIds.has(selectedEmail?.id)) setSelectedEmail(null);
    setCheckedIds(new Set());
  };

  const toggleCheck = (id) => setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const filtered = (state.emails || []).filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (e.sender_name || '').toLowerCase().includes(q) || (e.sender_email || '').toLowerCase().includes(q) || (e.subject || '').toLowerCase().includes(q);
  });

  const unreadCount = (state.emails || []).filter(e => !e.is_read).length;
  const allChecked  = filtered.length > 0 && checkedIds.size === filtered.length;

  return (
    <>
    <div style={{ display: 'flex', height: 'calc(100vh - 57px)', overflow: 'hidden', background: 'var(--bg)' }}>
      {replyOverlay && selectedEmail && (
        <ReplyOverlay
          email={selectedEmail}
          mode={replyOverlay.mode}
          threadEmails={threadEmails}
          prefillBody={replyOverlay.prefillBody}
          prefillTo={replyOverlay.prefillTo}
          prefillSubject={replyOverlay.prefillSubject}
          initialOpenEly={replyOverlay.openEly}
          onSend={handleSendReply}
          onClose={() => setReplyOverlay(null)}
        />
      )}

      {draftWithEly && selectedEmail && (
        <DraftWithElyOverlay
          email={selectedEmail}
          threadEmails={threadEmails}
          onSendWithDraft={({ to, subject, body }) => {
            setDraftWithEly(false);
            const htmlBody = body && !body.trim().startsWith('<')
              ? body.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
              : body || '';
            setReplyOverlay({ mode: 'reply', prefillBody: htmlBody, prefillTo: to, prefillSubject: subject });
          }}
          onClose={() => setDraftWithEly(false)}
        />
      )}

      {/* Left panel — hidden on mobile when email is open */}
      <div style={{
        width: isMobile ? '100%' : 360,
        minWidth: isMobile ? 'unset' : 300,
        display: isMobile && mobileShowEmail ? 'none' : 'flex',
        flexDirection: 'column',
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--bg)',
      }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <select value={bulkProjectId} onChange={e => setBulkProjectId(e.target.value)}
                  style={{ maxWidth: 180, padding: '3px 8px', borderRadius: 99, fontSize: 11.5, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)' }}>
                  <option value="">Link to project…</option>
                  {bulkProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.bo_premise_address || p.address || p.bo || 'Unknown'}</option>
                  ))}
                </select>
                <button onClick={handleBulkLinkToProject} disabled={!bulkProjectId || bulkLinking}
                  style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11.5, cursor: bulkProjectId ? 'pointer' : 'not-allowed', background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', fontWeight: 600, opacity: bulkProjectId ? 1 : 0.5 }}>
                  {bulkLinking ? 'Linking…' : `🔗 Link ${checkedIds.size}`}
                </button>
                <button onClick={handleMassDelete} style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer', background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)', fontWeight: 600 }}>
                  🗑 Delete {checkedIds.size}
                </button>
              </div>
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

      {/* Right panel — full screen on mobile when email selected */}
      {(!isMobile || mobileShowEmail) && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg2)',
          position: isMobile ? 'fixed' : 'relative',
          inset: isMobile ? 0 : 'unset',
          zIndex: isMobile ? 50 : 'unset',
        }}>
          {/* Mobile back button */}
          {isMobile && mobileShowEmail && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg2)', flexShrink: 0,
            }}>
              <button
                onClick={() => { setMobileShowEmail(false); setSelectedEmail(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 13, cursor: 'pointer', color: 'var(--text2)' }}
              >
                ← Back
              </button>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {selectedEmail?.subject}
              </span>
            </div>
          )}
          <EmailPreview email={selectedEmail} onOpenReply={mode => setReplyOverlay({ mode })} onDraftWithEly={() => setDraftWithEly(true)} onEmailLinked={handleEmailLinked} />
          {/* Appointment detection prompt */}
          {appointmentPrompt && (
            <div style={{ position: 'absolute', bottom: 80, left: 16, right: 16, padding: '10px 14px', background: appointmentPrompt.has_clash ? '#fef2f2' : '#eff6ff', border: `1px solid ${appointmentPrompt.has_clash ? '#ef4444' : '#3b82f6'}`, borderRadius: 8, fontSize: 12.5, zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{appointmentPrompt.has_clash ? '⚠️ Appointment detected — possible clash' : '📅 Appointment detected'}</div>
              <div style={{ color: 'var(--text2)', marginBottom: 6 }}>{appointmentPrompt.summary}</div>
              {appointmentPrompt.clash_detail && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 6 }}>{appointmentPrompt.clash_detail}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {!appointmentPrompt.has_clash && (
                  <button onClick={() => { setAppointmentPrompt(null); setReplyOverlay({ mode: 'reply', prefillBody: appointmentPrompt.confirm_reply }); }}
                    style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    ✅ Reply confirming & book in
                  </button>
                )}
                <button onClick={() => {
                  setAppointmentPrompt(null);
                  setBookingOverlay({
                    title: (appointmentPrompt.type === 'soc' ? 'SOC' : appointmentPrompt.title || 'Appointment') + (appointmentPrompt.address ? ' — ' + appointmentPrompt.address : ''),
                    date: appointmentPrompt.iso_date || '',
                    time: appointmentPrompt.time || '',
                    project_id: selectedEmail?.project_id || '',
                    project_address: appointmentPrompt.project_address || '',
                    task_type: 'appointment',
                    description: `From email: ${selectedEmail?.subject || ''}`,
                  });
                }}
                  style={{ padding: '6px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  📅 Add to diary only
                </button>
                <button onClick={() => setAppointmentPrompt(null)}
                  style={{ padding: '6px 12px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>

      {/* ── Booking confirmation overlay ───────────────────────────────── */}
      {bookingOverlay && (
        <BookingOverlay
          booking={bookingOverlay}
          onConfirm={async (confirmed) => {
            try {
              await sb.from('tasks').insert([{
                task_type: confirmed.task_type || 'appointment',
                title: confirmed.title,
                due_date: confirmed.date || null,
                time: confirmed.time || null,
                start_time: confirmed.time || null,
                project_id: confirmed.project_id || null,
                project_address_snapshot: confirmed.project_address || null,
                description: confirmed.description || null,
                status: 'pending',
                created_at: new Date().toISOString(),
              }]);
            } catch (err) {
              console.error('[booking] failed:', err.message);
            }
            setBookingOverlay(null);
            window.dispatchEvent(new Event('nora:task-added'));
            alert('✅ Added to diary — check your calendar.');
          }}
          onClose={() => setBookingOverlay(null)}
        />
      )}
    </>
  );
}















