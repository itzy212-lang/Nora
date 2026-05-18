import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import { useEmails } from '../../hooks/useEmails';
import DraftWithEly from './DraftWithEly';
import { uid, escapeHtml } from '../../utils/formatters';
import sb from '../../supabaseClient';

function buildSignatureHTML(settings) {
  const name = settings.sigName || settings.name || '';
  const quals = settings.sigQuals || settings.title || '';
  const phone = settings.sigPhone || settings.phone || settings.mobile || '';
  const email = settings.sigEmail || settings.email || '';
  const address = settings.sigAddress || settings.address || '';
  const logo = settings.sigFirmLogoData || settings.logoData || '';
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e7eb;margin-top:24px;padding-top:14px">';
  if (name) html += `<div style="font-weight:700;font-size:14px;margin-bottom:2px">${escapeHtml(name)}</div>`;
  if (quals) html += `<div style="font-size:12px;color:#555;margin-bottom:10px">${escapeHtml(quals)}</div>`;
  if (logo) html += `<div style="margin-bottom:10px"><img src="${logo}" style="max-height:50px;max-width:180px;object-fit:contain"></div>`;
  const lines = [phone && `Tel | ${escapeHtml(phone)}`, email && `Email | ${escapeHtml(email)}`, address && escapeHtml(address)].filter(Boolean);
  if (lines.length) html += `<div style="font-size:12.5px;color:#333;line-height:1.9">${lines.map(l => `<div>${l}</div>`).join('')}</div>`;
  html += '</div>';
  return html;
}

export default function EmailComposer({ opts = {}, onClose, onSent }) {
  const { state } = useApp();
  const { sendEmail, markReplied } = useEmails();
  const { settings, currentUser, projects, emails } = state;

  // opts: { mode, to, subject, body, projectId, replyToEmailId, threadId, originalEmail, followUp }
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [includeSig, setIncludeSig] = useState(true);
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const [draftNote, setDraftNote] = useState('Draft not saved');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [showDraftWithEly, setShowDraftWithEly] = useState(false);
  const [toSuggestions, setToSuggestions] = useState([]);
  const [dirty, setDirty] = useState(false);
  const replyInfoRef = useRef({});
  const fileInputRef = useRef(null);

  // On opts change, populate fields
  useEffect(() => {
    if (!opts) return;
    setTo(opts.to || (opts.originalEmail ? (opts.originalEmail.from_email || opts.originalEmail.from || '') : ''));
    setSubject(opts.subject || (opts.originalEmail ? `RE: ${opts.originalEmail.subject || ''}` : ''));
    setBody(opts.body || (opts.originalEmail && opts.prefillGreeting !== false ? `Hi ${opts.originalEmail.from || ''},\n\n` : ''));
    setProjectId(opts.projectId || '');
    setCreateFollowUp(!!opts.followUp);
    setDirty(false);
    setDraftNote('Draft not saved');
    setAttachments([]);
    replyInfoRef.current = {
      replyToEmailId: opts.replyToEmailId || '',
      threadId: opts.threadId || uid(),
      original: opts.originalEmail || null,
      mode: opts.mode || 'compose',
    };
  }, [opts]);

  const handleToInput = (val) => {
    setTo(val);
    setDirty(true);
    if (val.length < 2) { setToSuggestions([]); return; }
    const q = val.toLowerCase();
    const seen = {};
    const candidates = [];
    // Search contacts + email senders
    emails.slice(0, 200).forEach(e => {
      const addr = e.from_email || '';
      const name = e.from || '';
      if (!addr || seen[addr]) return;
      if (name.toLowerCase().includes(q) || addr.toLowerCase().includes(q)) {
        seen[addr] = true;
        candidates.push({ name, email: addr });
      }
    });
    setToSuggestions(candidates.slice(0, 6));
  };

  const handleFileAttach = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments(prev => [...prev, {
          name: file.name, type: file.type, size: file.size,
          data: ev.target.result,
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleSend = useCallback(async () => {
    if (!to.trim()) { alert('Add a recipient first.'); return; }
    if (!body.trim()) { alert('Write a message first.'); return; }
    const userEmail = currentUser?.email || '';
    if (!userEmail) { alert('No logged-in user found. Please log in first.'); return; }

    setSending(true);
    setStatus('Sending via Outlook…');
    try {
      const sigHtml = includeSig ? buildSignatureHTML(settings) : '';
      const htmlBody = escapeHtml(body).replace(/\n/g, '<br>') + sigHtml;
      await sendEmail({
        to: to.trim(),
        subject: subject.trim() || '(No subject)',
        body: htmlBody,
        userId: userEmail,
        attachments: attachments.map(a => ({ name: a.name, type: a.type, data: a.data })),
      });
      // Mark original as replied
      const { replyToEmailId } = replyInfoRef.current;
      if (replyToEmailId) markReplied(replyToEmailId);
      setStatus('Sent ✓');
      setDirty(false);
      setTimeout(() => { onSent?.(); onClose?.(); }, 500);
    } catch (err) {
      setStatus('Send failed');
      alert(err.message || 'Email send failed.');
    } finally {
      setSending(false);
    }
  }, [to, subject, body, includeSig, settings, sendEmail, attachments, currentUser, markReplied, onSent, onClose]);

  const handleClose = () => {
    if (dirty) {
      const action = window.prompt('Type DISCARD to discard, or CANCEL to keep editing.', 'CANCEL');
      if (!action || !/^discard$/i.test(action)) return;
    }
    onClose?.();
  };

  const project = projects.find(p => p.id === projectId);

  return (
    <div className="email-composer-overlay open">
      <div className="email-composer-header">
        <button className="btn btn-sm btn-ghost" onClick={handleClose}>← Back</button>
        <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
          {replyInfoRef.current.mode === 'reply' ? 'Reply email' : 'Compose email'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{status}</div>
      </div>

      <div className="email-composer-body">
        <div className="email-composer-fields">
          <div className="two-col">
            {/* To field */}
            <div className="form-row" style={{ position: 'relative' }}>
              <label className="form-label">To</label>
              <input
                value={to}
                onChange={e => handleToInput(e.target.value)}
                placeholder="Name or email address"
                autoComplete="off"
              />
              {toSuggestions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--r)', maxHeight: 180, overflowY: 'auto', boxShadow: 'var(--shadow)' }}>
                  {toSuggestions.map((c, i) => (
                    <div
                      key={i}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12.5, borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.target.style.background = 'var(--bg4)'}
                      onMouseLeave={e => e.target.style.background = ''}
                      onMouseDown={(e) => { e.preventDefault(); setTo(c.email); setToSuggestions([]); }}
                    >
                      <strong>{c.name || c.email}</strong>
                      {c.name && <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{c.email}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-row">
              <label className="form-label">Subject</label>
              <input value={subject} onChange={e => { setSubject(e.target.value); setDirty(true); }} />
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">Draft</label>
            <textarea
              value={body}
              onChange={e => { setBody(e.target.value); setDirty(true); }}
              style={{ maxHeight: 'none', minHeight: 300, resize: 'vertical' }}
              placeholder="Write your email..."
              spellCheck
            />
          </div>

          {includeSig && (
            <div style={{ margin: '0 0 8px 0', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg4)', fontSize: 12 }}
              dangerouslySetInnerHTML={{ __html: buildSignatureHTML(settings) }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeSig} onChange={e => setIncludeSig(e.target.checked)} />
              Include signature
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
              <input type="checkbox" checked={createFollowUp} onChange={e => setCreateFollowUp(e.target.checked)} />
              Create follow-up task
            </label>
            {project && (
              <span className="ch-badge" style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}>
                {project.ref} · {(project.address || '').slice(0, 20)}
              </span>
            )}
          </div>
        </div>

        {/* Original email preview */}
        {replyInfoRef.current.original && (
          <>
            <hr className="email-composer-divider" />
            <div className="email-composer-original-label">Original email</div>
            <div className="email-composer-preview"
              dangerouslySetInnerHTML={{ __html: replyInfoRef.current.original.body || replyInfoRef.current.original.preview || '' }}
            />
          </>
        )}

        {/* Attachments */}
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {attachments.map((att, i) => (
              <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11.5, color: 'var(--text2)' }}>
                📎 {att.name} <span style={{ color: 'var(--text3)' }}>{Math.round(att.size / 1024)}kb</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '0 0 0 4px', fontSize: 13 }}>×</button>
              </div>
            ))}
          </div>
          <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileAttach} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>📎 External file</button>
          </div>
        </div>

        {/* Actions */}
        <div className="email-composer-actions">
          <div className="email-composer-meta">
            <span className="email-composer-dot" />
            <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{draftNote}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setShowDraftWithEly(true)}>✨ Draft with Ely</button>
            <button className="btn btn-amber" onClick={() => setDraftNote('Draft saved')}>Save draft</button>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Draft with Ely panel */}
      {showDraftWithEly && (
        <DraftWithEly
          email={replyInfoRef.current.original}
          threadId={replyInfoRef.current.threadId}
          projectId={projectId}
          onUseDraft={(draft) => {
            setBody(draft);
            setDirty(true);
            setShowDraftWithEly(false);
          }}
          onClose={() => setShowDraftWithEly(false)}
        />
      )}
    </div>
  );
}

// CSS for the overlay
const style = document.createElement('style');
style.textContent = `
.email-composer-overlay { position: fixed; inset: 0; z-index: 300; background: var(--bg); display: none; flex-direction: column; }
.email-composer-overlay.open { display: flex; }
`;
if (!document.getElementById('email-composer-style')) {
  style.id = 'email-composer-style';
  document.head.appendChild(style);
}
