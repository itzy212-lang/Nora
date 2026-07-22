import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../../state/appStore';
import { useEmails } from '../../hooks/useEmails';
import DraftWithEly from './DraftWithEly';
import { uid, escapeHtml } from '../../utils/formatters';
import { buildFirmSignatureHTML } from '../../utils/emailSignature';
import sb from '../../supabaseClient';
import { toHtml, cleanSignOff } from '../../utils/draftUtils';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return isMobile;
}

// Build a project subject line, optionally appending a short AO reference
// e.g. "Party Wall etc. Act 1996 — 12 Oak Road" or, when one or more AOs are
// specified and share a street with the BO/each other, a compact form like
// "Party Wall etc. Act 1996 — 12 Oak Road (Adjoining Owner: 8 & 6 Oak Road)".
function buildSubjectWithAoRef(baseAddress, aoList = []) {
  const base = `Party Wall etc. Act 1996 -- ${baseAddress || ''}`.trim();
  if (!aoList.length) return base;

  // Extract "<number(s)> <street name>" from a free-text address.
  // e.g. "8 Park Avenue, London N12 9QL" -> { number: '8', street: 'Park Avenue' }
  const parseAddress = (addr) => {
    const m = String(addr || '').trim().match(/^(\d+[a-zA-Z]?)\s+(.+?)(?:,|$)/);
    if (!m) return null;
    return { number: m[1], street: m[2].trim() };
  };

  const parsed = aoList.map(parseAddress).filter(Boolean);
  if (!parsed.length) {
    // Fall back to full AO addresses if we can't parse a clean number+street
    const names = aoList.filter(Boolean).join(' & ');
    return names ? `${base} (Adjoining Owner: ${names})` : base;
  }

  // Group by street name so "8 Park Avenue" + "6 Park Avenue" become "8 & 6 Park Avenue"
  const byStreet = {};
  parsed.forEach(({ number, street }) => {
    if (!byStreet[street]) byStreet[street] = [];
    byStreet[street].push(number);
  });

  const label = aoList.length > 1 ? 'Adjoining Owners' : 'Adjoining Owner';
  const parts = Object.entries(byStreet).map(([street, numbers]) => `${numbers.join(' & ')} ${street}`);
  return `${base} (${label}: ${parts.join('; ')})`;
}

export default function EmailComposer({ opts = {}, onClose, onSent }) {
  const isMobile = useIsMobile();
  const { state } = useApp();
  const { sendEmail, markReplied } = useEmails();
  const { currentUser, projects, emails } = state;

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [ccSuggestions, setCcSuggestions] = useState([]);
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
    if (opts.cc) { setCc(opts.cc); setShowCc(true); }
    const proj = (projects || []).find(p => p.id === opts.projectId);
    // opts.aoAddresses lets a caller (e.g. project chat: "relating to the AO at number 6")
    // request the adjoining owner's address be appended to the subject in compact form.
    const defaultSubject = proj
      ? buildSubjectWithAoRef(proj.bo_premise_address || proj.name || '', opts.aoAddresses || [])
      : '';
    setSubject(opts.subject || (opts.originalEmail ? `RE: ${opts.originalEmail.subject || ''}` : defaultSubject));
    setBody(toHtml(opts.body) || (opts.originalEmail && opts.prefillGreeting !== false ? `<p>Hi ${opts.originalEmail.from || ''},</p><p></p>` : ''));
    setProjectId(opts.projectId || '');
    setCreateFollowUp(!!opts.followUp);
    setDirty(false);
    setDraftNote('Draft not saved');
    const baseAttachments = opts.attachments || [];
    if (opts.oneDriveAttachment) {
      baseAttachments.push({ ...opts.oneDriveAttachment, source: 'onedrive' });
    }
    setAttachments(baseAttachments);
    replyInfoRef.current = {
      replyToEmailId: opts.replyToEmailId || '',
      threadId: opts.threadId || null, // null on compose — don't generate fake threadId that triggers email fetch
      original: opts.originalEmail || null,
      mode: opts.mode || 'compose',
    };
  }, [opts]);

  const signatureHtml = includeSig && firmSettings ? buildFirmSignatureHTML(firmSettings) : '';

  const handleToInput = async (val) => {
    setTo(val);
    setDirty(true);
    const q = val.trim();
    if (!q) {
      setToSuggestions(projectContacts.slice(0, 8));
      return;
    }
    if (q.length < 2) { setToSuggestions([]); return; }
    const { data } = await sb.rpc('search_email_contacts', {
      search_query: q,
      p_project_id: projectId || null,
      p_user_id: null,
    });
    setToSuggestions((data || []).slice(0, 8).map(r => ({ name: r.name, email: r.email })));
  };

  const handleToFocus = () => {
    if (projectContacts.length > 0) setToSuggestions(projectContacts.slice(0, 8));
  };

  // Normalise pasted/typed multiple addresses to a consistent "a@x.com, b@y.com"
  // format on blur — handles semicolons, newlines, or missing spacing.
  const normaliseRecipientField = (val) =>
    String(val || '')
      .split(/[;,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');

  const handleToBlur = () => {
    setTimeout(() => setToSuggestions([]), 200);
    setTo((prev) => normaliseRecipientField(prev));
  };

  const handleCcInput = async (val) => {
    setCc(val);
    setDirty(true);
    const q = val.trim();
    if (!q) { setCcSuggestions([]); return; }
    const lastPart = q.split(/[;,]/).pop().trim();
    if (lastPart.length < 2) { setCcSuggestions([]); return; }
    const { data } = await sb.rpc('search_email_contacts', {
      search_query: lastPart,
      p_project_id: projectId || null,
      p_user_id: null,
    });
    setCcSuggestions((data || []).slice(0, 8).map(r => ({ name: r.name, email: r.email })));
  };

  const handleCcFocus = () => {
    if (projectContacts.length > 0) setCcSuggestions(projectContacts.slice(0, 8));
  };

  const handleCcBlur = () => {
    setTimeout(() => setCcSuggestions([]), 200);
    setCc((prev) => normaliseRecipientField(prev));
  };

  const addCcSuggestion = (email) => {
    setCc((prev) => {
      const parts = prev.split(/[;,]/).map(s => s.trim()).filter(Boolean);
      parts[parts.length - 1] = email; // replace the in-progress fragment
      return parts.join(', ');
    });
    setCcSuggestions([]);
  };

  const bodyEditorRef = useRef(null);
  const isUserTypingRef = useRef(false);

  // Sync body content to editor ONLY when set programmatically (e.g. from Draft with Ely)
  // Never interrupts user while typing
  useEffect(() => {
    if (isUserTypingRef.current) return;
    if (bodyEditorRef.current && bodyEditorRef.current.innerHTML !== body) {
      bodyEditorRef.current.innerHTML = body || '';
    }
  }, [body]);

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

    // Get content from the contentEditable editor
    const editorContent = bodyEditorRef.current?.innerHTML || body || '';
    if (!editorContent.trim() || editorContent === '<br>') { alert('Write a message first.'); return; }

    const userEmail = currentUser?.email || '';
    if (!userEmail) { alert('No logged-in user found. Please log in first.'); return; }

    setSending(true);
    setStatus('Sending via Outlook...');

    try {
      // Body is already HTML from contentEditable — just append signature
      const htmlBody = signatureHtml
        ? `${editorContent}<br><br>${signatureHtml}`
        : editorContent;

      await sendEmail({
        to: to.trim(),
        cc: cc.trim() || null,
        subject: subject.trim() || '(No subject)',
        body: htmlBody,
        userId: userEmail,
        // Accept several field-name variants — this exact mismatch (caller sent
        // {contentType, contentBytes}, this only read {type, data}) silently
        // dropped a fee quote attachment with no error: the chip showed in the
        // UI but type/data came through undefined and nothing reached the sent
        // email. useEmails.js's sendEmail is similarly tolerant; matching that
        // here prevents this exact class of bug recurring for any future caller.
        attachments: attachments.map(a => ({
          name: a.name || a.filename || 'attachment',
          type: a.type || a.contentType || a.content_type || a.mime_type || 'application/octet-stream',
          data: a.data || a.contentBytes || a.base64 || a.content || '',
        })),
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
  }, [to, cc, subject, body, bodyEditorRef, signatureHtml, sendEmail, attachments, currentUser, markReplied, onSent, onClose]);

  const handleClose = () => {
    if (dirty) {
      const action = window.prompt('Type DISCARD to discard, or CANCEL to keep editing.', 'CANCEL');
      if (!action || !/^discard$/i.test(action)) return;
    }
    onClose?.();
  };

  const project = projects.find(p => p.id === projectId);

  const [projectContacts, setProjectContacts] = useState([]);
  useEffect(() => {
    if (!projectId) return;
    sb.rpc('get_project_recipients', { p_project_id: projectId })
      .then(({ data }) => {
        if (data) setProjectContacts(data.map(r => ({ name: r.name, email: r.email, role: r.role })));
      });
  }, [projectId]);

  return (
    <div className="email-composer-overlay open">
      <div className="email-composer-header">
        {isMobile ? (
          <button
            onClick={handleClose}
            aria-label="Close"
            title="Close"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: '50%',
              border: '1px solid var(--border)', background: 'var(--bg3)',
              fontSize: 18, lineHeight: 1, cursor: 'pointer', color: 'var(--text2)',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        ) : (
          <button className="btn btn-sm btn-ghost" onClick={handleClose}>← Back</button>
        )}
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
                onBlur={handleToBlur}
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
                      {c.name && <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{c.email}{c.role && c.role !== 'email_history' && c.role !== 'contact' ? ` . ${c.role}` : ''}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!showCc && (
              <div className="form-row">
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 11.5, cursor: 'pointer', padding: '2px 0', textAlign: 'left' }}
                >
                  + Add Cc
                </button>
              </div>
            )}

            {showCc && (
              <div className="form-row" style={{ position: 'relative' }}>
                <label className="form-label">Cc</label>
                <input
                  value={cc}
                  onChange={e => handleCcInput(e.target.value)}
                  onFocus={handleCcFocus}
                  onBlur={handleCcBlur}
                  placeholder="Name or email address — separate multiple with a comma"
                  autoComplete="off"
                />
                {ccSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--r)', maxHeight: 180, overflowY: 'auto', boxShadow: 'var(--shadow)' }}>
                    {ccSuggestions.map((c, i) => (
                      <div
                        key={i}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12.5, borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.target.style.background = 'var(--bg4)'}
                        onMouseLeave={e => e.target.style.background = ''}
                        onMouseDown={(e) => { e.preventDefault(); addCcSuggestion(c.email); }}
                      >
                        <strong>{c.name || c.email}</strong>
                        {c.name && <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{c.email}{c.role && c.role !== 'email_history' && c.role !== 'contact' ? ` . ${c.role}` : ''}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="form-row">
              <label className="form-label">Subject</label>
              <input value={subject} onChange={e => { setSubject(e.target.value); setDirty(true); }} />
            </div>
          </div>

          <div className="form-row">
            <label className="form-label">Draft</label>

            {/* ── Rich text toolbar ───────────────────────────────────── */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px',
              border: '1px solid var(--border)', borderBottom: 'none',
              borderRadius: '8px 8px 0 0', background: 'var(--bg2)',
            }}>
              {/* Bold / Italic / Underline */}
              {[['bold','B','700'],['italic','I','400'],['underline','U','400']].map(([cmd, label, fw]) => (
                <button key={cmd} type="button"
                  onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }}
                  style={{ padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', fontWeight: fw, fontStyle: cmd === 'italic' ? 'italic' : 'normal', textDecoration: cmd === 'underline' ? 'underline' : 'none', fontSize: 13, minWidth: 28 }}
                  title={cmd.charAt(0).toUpperCase() + cmd.slice(1)}
                >{label}</button>
              ))}

              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />

              {/* Text colour */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>A</span>
                <input type="color" defaultValue="#0000ff"
                  onInput={e => { document.execCommand('foreColor', false, e.target.value); }}
                  style={{ width: 24, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', background: 'none' }}
                  title="Text colour"
                />
              </div>

              {/* Highlight colour */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>H</span>
                <input type="color" defaultValue="#ffff00"
                  onInput={e => { document.execCommand('hiliteColor', false, e.target.value); }}
                  style={{ width: 24, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', background: 'none' }}
                  title="Highlight colour"
                />
              </div>

              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />

              {/* Font size */}
              <select defaultValue="3"
                onChange={e => { document.execCommand('fontSize', false, e.target.value); }}
                style={{ padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}
                title="Font size"
              >
                <option value="1">Small</option>
                <option value="3">Normal</option>
                <option value="4">Large</option>
                <option value="5">Larger</option>
              </select>

              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />

              {/* Bullet list / Numbered list */}
              <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList'); }}
                style={{ padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', fontSize: 13 }} title="Bullet list">• ≡</button>
              <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertOrderedList'); }}
                style={{ padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', fontSize: 13 }} title="Numbered list">1≡</button>

              <div style={{ width: 1, background: 'var(--border)', margin: '2px 2px' }} />

              {/* Clear formatting */}
              <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat'); }}
                style={{ padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', fontSize: 11, color: 'var(--text3)' }} title="Clear formatting">✕ fmt</button>
            </div>

            {/* ── Editable body ────────────────────────────────────────── */}
            <div
              className="email-body-editor"
            contentEditable
              suppressContentEditableWarning
              ref={bodyEditorRef}
              onInput={e => { 
                isUserTypingRef.current = true;
                setBody(e.currentTarget.innerHTML); 
                setDirty(true);
                setTimeout(() => { isUserTypingRef.current = false; }, 100);
              }}
              spellCheck
              style={{
                minHeight: 300, padding: '12px 14px',
                border: '1px solid var(--border)', borderTop: 'none',
                borderRadius: '0 0 8px 8px', background: '#fff',
                fontSize: 13.5, lineHeight: 1.7, color: '#000',
                outline: 'none', overflowY: 'auto',
                fontFamily: 'inherit',
              }}
              placeholder="Write your email..."
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
            const html = toHtml(cleanSignOff(draft));
            setBody(html);
            if (bodyEditorRef.current) bodyEditorRef.current.innerHTML = html;
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
.email-composer-overlay { position: fixed; inset: 0; z-index: 600; background: var(--bg); display: none; flex-direction: column; }
.email-composer-overlay.open { display: flex; }
.email-body-editor p { margin: 0 0 10px 0; }
.email-body-editor p:last-child { margin-bottom: 0; }
.email-body-editor br + br { display: block; margin-top: 8px; }
.email-body-editor ul, .email-body-editor ol { margin: 8px 0 10px 20px; padding-left: 4px; }
.email-body-editor ul { list-style-type: disc; }
.email-body-editor ol { list-style-type: decimal; }
.email-body-editor li { margin: 4px 0; padding-left: 4px; line-height: 1.6; }
`;
if (!document.getElementById('email-composer-style')) {
  style.id = 'email-composer-style';
  document.head.appendChild(style);
}






