import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../../state/appStore';
import { useEmails } from '../../hooks/useEmails';
import DraftWithEly from './DraftWithEly';
import { uid, escapeHtml } from '../../utils/formatters';
import { buildFirmSignatureHTML } from '../../utils/emailSignature';
import sb from '../../supabaseClient';

export default function EmailComposer({ opts = {}, onClose, onSent }) {
  const { state } = useApp();
  const { sendEmail, markReplied } = useEmails();
  const { currentUser, projects, emails } = state;

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [includeSig, setIncludeSig] = useState(true);
  const [firmSettings, setFirmSettings] = useState(null);
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const [draftNote, setDraftNote] = useState('Draft not saved');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [showDraftWithEly, setShowDraftWithEly] = useState(false);
  const [toSuggestions, setToSuggestions] = useState([]);
  const [dirty, setDirty] = useState(false);
  const replyInfoRef = useRef({});
  const fileInputRef = useRef(null);

  useEffect(() => {
    const loadFirmSettings = async () => {
      if (!sb) return;
      try {
        const { data, error } = await sb
          .from('firm_settings')
          .select('*')
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        setFirmSettings(data || null);
      } catch (err) {
        console.error('[EmailComposer] Failed loading firm settings:', err);
        setFirmSettings(null);
      }
    };

    loadFirmSettings();
  }, [currentUser]);

  useEffect(() => {
    if (!opts) return;
    setTo(opts.to || (opts.originalEmail ? (opts.originalEmail.from_email || opts.originalEmail.from || '') : ''));
    setSubject(opts.subject || (opts.originalEmail ? `RE: ${opts.originalEmail.subject || ''}` : ''));
    setBody(opts.body || (opts.originalEmail && opts.prefillGreeting !== false ? `Hi ${opts.originalEmail.from || ''},\n\n` : ''));
    setProjectId(opts.projectId || '');
    setCreateFollowUp(!!opts.followUp);
    setDirty(false);
    setDraftNote('Draft not saved');
    setAttachments(opts.attachments || []);
    replyInfoRef.current = {
      replyToEmailId: opts.replyToEmailId || '',
      threadId: opts.threadId || uid(),
      original: opts.originalEmail || null,
      mode: opts.mode || 'compose',
    };
  }, [opts]);

  const signatureHtml = includeSig && firmSettings ? buildFirmSignatureHTML(firmSettings) : '';

  const handleToInput = (val) => {
    setTo(val);
    setDirty(true);

    // Show project contacts immediately even with no input
    if (val.length < 2) {
      setToSuggestions(projectContacts.slice(0, 6));
      return;
    }

    const q = val.toLowerCase();
    const seen = {};
    const candidates = [];

    // Project contacts first
    projectContacts.forEach(c => {
      if (!c.email || seen[c.email]) return;
      if (c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) {
        seen[c.email] = true;
        candidates.push(c);
      }
    });

    // Then email history
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

  const handleToFocus = () => {
    if (!to && projectContacts.length > 0) {
      setToSuggestions(projectContacts.slice(0, 6));
    }
  };

  const handleFileAttach = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments(prev => [...prev, {
          name: file.name,
          type: file.type,
          size: file.size,
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
    setStatus('Sending via Outlook...');

    try {
      const htmlBody = escapeHtml(body).replace(/\n/g, '<br>') + signatureHtml;
      await sendEmail({
        to: to.trim(),
        subject: subject.trim() || '(No subject)',
        body: htmlBody,
        userId: userEmail,
        attachments: attachments.map(a => ({ name: a.name, type: a.type, data: a.data })),
        projectId: projectId || null,
      });

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
  }, [to, subject, body, signatureHtml, sendEmail, attachments, currentUser, markReplied, onSent, onClose]);

  const handleClose = () => {
    if (dirty) {
      const action = window.prompt('Type DISCARD to discard, or CANCEL to keep editing.', 'CANCEL');
      if (!action || !/^discard$/i.test(action)) return;
    }
    onClose?.();
  };

  const project = projects.find(p => p.id === projectId);

  // Build project contact suggestions from BO, AOs and surveyors
  const projectContacts = useMemo(() => {
    if (!project) return [];
    const contacts = [];
    const seen = new Set();

    const add = (name, email) => {
      if (!email || seen.has(email.toLowerCase())) return;
      seen.add(email.toLowerCase());
      contacts.push({ name: name || email, email });
    };

    // Building owners
    const boName = [project.bo_1_name, project.bo_2_name, project.bo_name, project.bo_company].filter(Boolean).join(' & ');
    add(boName, project.bo_email || project.bo_1_email);
    if (project.bo_2_email) add(project.bo_2_name || boName, project.bo_2_email);

    // Adjoining owners
    const aos = Array.isArray(project.aos) ? project.aos : [];
    aos.forEach(ao => {
      add(ao.name || ao.ao_name_1, ao.email || ao.ao_email);
      if (ao.name2 || ao.ao_name_2) add(ao.name2 || ao.ao_name_2, ao.email2 || ao.ao_email_2);
      // AO's surveyor
      add(ao.surveyor_name || ao.ao_surveyor_name, ao.surveyor_email || ao.ao_surveyor_email);
    });

    // BO surveyor (us — probably not needed but included for completeness)
    add(project.surveyor_name, project.surveyor_email);

    return contacts.filter(c => c.email);
  }, [project]);

  const handleToInput = (val) => {
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
            <div className="form-row" style={{ position: 'relative' }}>
              <label className="form-label">To</label>
              <input
                value={to}
                onChange={e => handleToInput(e.target.value)}
                onFocus={handleToFocus}
                onBlur={() => setTimeout(() => setToSuggestions([]), 200)}
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

          {includeSig && firmSettings && (
            <div style={{ margin: '0 0 8px 0', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 12, overflow: 'auto' }}
              dangerouslySetInnerHTML={{ __html: signatureHtml }}
            />
          )}

          {includeSig && !firmSettings && (
            <div style={{ margin: '0 0 8px 0', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg4)', fontSize: 12, color: 'var(--text3)' }}>
              No saved email signature found. Add one in Settings &gt; Firm.
            </div>
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

        {replyInfoRef.current.original && (
          <>
            <hr className="email-composer-divider" />
            <div className="email-composer-original-label">Original email</div>
            <div className="email-composer-preview"
              dangerouslySetInnerHTML={{ __html: replyInfoRef.current.original.body || replyInfoRef.current.original.preview || '' }}
            />
          </>
        )}

        <div style={{ paddingTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {attachments.map((att, i) => (
              <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11.5, color: 'var(--text2)' }}>
                📎 {att.name} <span style={{ color: 'var(--text3)' }}>{Math.round((att.size || 0) / 1024)}kb</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '0 0 0 4px', fontSize: 13 }}>×</button>
              </div>
            ))}
          </div>
          <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileAttach} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>📎 External file</button>
          </div>
        </div>

        <div className="email-composer-actions">
          <div className="email-composer-meta">
            <span className="email-composer-dot" />
            <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{draftNote}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setShowDraftWithEly(true)}>✨ Draft with Ely</button>
            <button className="btn btn-amber" onClick={() => setDraftNote('Draft saved')}>Save draft</button>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

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

const style = document.createElement('style');
style.textContent = `
.email-composer-overlay { position: fixed; inset: 0; z-index: 300; background: var(--bg); display: none; flex-direction: column; }
.email-composer-overlay.open { display: flex; }
`;
if (!document.getElementById('email-composer-style')) {
  style.id = 'email-composer-style';
  document.head.appendChild(style);
}


