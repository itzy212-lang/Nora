import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage, { normaliseDraftText, splitSubjectFromDraft } from '../chat/ChatMessage';
import { toHtml, cleanSignOff, stripHtml } from '../../utils/draftUtils';

// Split Ely response into brief + draft + after
function isBriefOrSummary(text = '') {
  // Returns true if text is a summary/brief rather than an actual draft email body.
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^From:/im.test(t)) return true;
  if (/^(Latest email is asking for|Asking for|Context from thread|What stands out|Suggested approach|Suggested reply):/im.test(t)) return true;
  const briefPhrases = [
    /Acknowledge the confirmation/i,
    /Ensure all necessary/i,
    /Review for compliance/i,
    /Consider whether/i,
    /Suggested approach/i,
    /It would be helpful to/i,
    /for compliance and safety/i,
    /structural details are documented/i,
  ];
  if (briefPhrases.some(rx => rx.test(t))) return true;
  const hasGreeting = /^(Subject\s*:|Dear\s+\S|Hi\s+\S|Hello\s+\S|Good morning|Good afternoon|Thank you for your email|Further to|Following our|I refer to)/im.test(t);
  const hasSignOff = /Kind regards|Yours sincerely|Yours faithfully|Best regards/i.test(t);
  if (!hasGreeting && !hasSignOff) return true;
  return false;
}

function splitAssistantResponseLocal(raw = '') {
  const text = String(raw || '').trim();

  // Extended greeting markers — include "Thanks" and "Thank you" openers
  const markers = [
    /\bSubject\s*:/i,
    /\bDear\s+[A-Z0-9]/i,
    /\bHi\s+[A-Z0-9]/i,
    /\bHello\s+[A-Z0-9]/i,
    /\bThanks\s+[A-Z0-9]/i,
    /\bThank you\s+[A-Z0-9]/i,
  ];
  const positions = markers
    .map(rx => { const m = text.match(rx); return m ? m.index : -1; })
    .filter(i => i >= 0);

  if (!positions.length) return { brief: text, draft: '', after: '', isBrief: true };

  const idx = Math.min(...positions);
  const brief = text.slice(0, idx).trim();
  let draft = text.slice(idx).trim();
  let after = '';
  const afterRx = /\n\s*(Let me know|Please let me know|Happy to|Feel free|Shall I|Would you like|Do you want)[\s\S]*$/i;
  const afterMatch = draft.match(afterRx);
  if (afterMatch) { after = afterMatch[0].trim(); draft = draft.replace(afterRx, '').trim(); }

  return { brief, draft, after, isBrief: false };
}
import ChatInputBar from '../shared/ChatInputBar';
import { uid } from '../../utils/formatters';

/**
 * Renders the auto-summary card with structured sections.
 * Parses the plain-text response from ely-smart into labelled blocks.
 */
function SummaryCard({ text }) {
  if (!text) return null;

  // Parse sections by known headers
  const sectionHeaders = [
    'From:',
    'Latest email is asking for:',
    'Context from thread:',
    'Suggested approach:',
  ];

  const sections = [];
  let remaining = text.trim();

  sectionHeaders.forEach((header, i) => {
    const idx = remaining.indexOf(header);
    if (idx === -1) return;

    const afterHeader = remaining.slice(idx + header.length);
    const nextHeaderIdx = sectionHeaders
      .slice(i + 1)
      .map(h => afterHeader.indexOf(h))
      .filter(n => n >= 0)
      .reduce((min, n) => Math.min(min, n), Infinity);

    const sectionContent = nextHeaderIdx === Infinity
      ? afterHeader.trim()
      : afterHeader.slice(0, nextHeaderIdx).trim();

    if (sectionContent) {
      sections.push({ header: header.replace(':', ''), content: sectionContent });
    }
  });

  // If parsing failed, just render as plain text
  if (!sections.length) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--text1)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
        {text}
      </div>
    );
  }

  const sectionStyles = {
    'From': { color: 'var(--text2)', fontStyle: 'italic' },
    'Latest email is asking for': { color: 'var(--text1)' },
    'Context from thread': { color: 'var(--text2)' },
    'Suggested approach': { color: 'var(--blue)', fontWeight: 500 },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sections.map(({ header, content }) => (
        <div key={header}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text3)',
            marginBottom: 3,
          }}>
            {header}
          </div>
          <div style={{
            fontSize: 12.5,
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            ...(sectionStyles[header] || {}),
          }}>
            {content}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * DraftWithEly — slide-in panel for drafting emails with Ely.
 * On open: automatically reads the email thread and shows a structured summary.
 * Subsequent turns: collaborative_reply_assistant mode.
 * "Use this draft" button sends clean draft text back to composer.
 */
export default function DraftWithEly({ email, threadId, projectId, onUseDraft, onClose }) {
  const { state } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);

  const [initialized, setInitialized] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const { send } = useEly({ surface: 'inbox_draft' });
  const isMobile = /Android|iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    el.style.overflowY = el.scrollHeight > 140 ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);


  const applyDraftToComposer = useCallback((draftInput) => {
    const raw = typeof draftInput === 'string'
      ? draftInput
      : draftInput?.body || draftInput?.draft || draftInput?.documentText || draftInput?.content || '';

    const { body } = splitSubjectFromDraft(raw);
    const cleanBody = normaliseDraftText(body || raw);

    if (!cleanBody) return;

    const htmlBody = cleanBody
      .split(/\n\n+/)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    onUseDraft?.(htmlBody);
    setVoiceStopSignal(v => v + 1);
    onClose?.();
  }, [onUseDraft, onClose]);

  useEffect(() => {
    if (!email || initialized) return;
    setInitialized(true);
    // Auto-summarise disabled — go straight to waiting for input
  }, [email, initialized]);

  // autoSummarise removed — user requests summary manually if needed

  const [pendingCaseReview, setPendingCaseReview] = useState(null); // { project_id }

  const handleSend = useCallback(async (overrideText, attachedFile = null) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();

    if (!text || loading) return;

    setVoiceStopSignal(v => v + 1);
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg = { id: uid(), role: 'user', content: text };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const extraOpts = {
        mode: 'draft',
        workflowStage: 'draft_with_ely',
        sessionId,
        emailId: email?.id || email?.external_id,
        threadId: threadId || email?.thread_id,
        projectId,
        // Only pass emailContext if there is an actual existing email being replied to.
        // On a blank compose, email is null/empty — passing an empty object here
        // causes ely-smart to treat it as a supplied email and fetch all project emails.
        emailContext: (email?.id || email?.body)
          ? {
              from: email?.from || email?.from_email || '',
              subject: email?.subject || '',
              body: (email?.body || email?.preview || '').slice(0, 6000),
            }
          : null,
      };

      // If we're in a pending case review flow, send confirmation
      if (pendingCaseReview) {
        extraOpts.case_review_confirmed = true;
        extraOpts.case_review_topic = text;
        extraOpts.projectId = pendingCaseReview.project_id || projectId;
        setPendingCaseReview(null);
      }

      const promptWithFile = attachedFile?.text
        ? `${text}\n\n[Attached file: ${attachedFile.name}]\n${attachedFile.text}`
        : text;
      const result = await send(promptWithFile, extraOpts);

      if (result.sessionId) setSessionId(result.sessionId);

      // Case review prompt — store pending state, show the question
      if (result.case_review_prompt) {
        setPendingCaseReview({ project_id: result.project_id || projectId });
        setMessages(prev => [...prev, { id: uid(), role: 'ely', content: result.reply || '' }]);
        return;
      }

      const raw = result.reply || result.draft || '';
      const { brief, draft: splitDraft, after } = splitAssistantResponseLocal(raw);

      // Clean sign-off using shared draftUtils
      const cleanDraft = cleanSignOff((splitDraft || raw).trim());

      const newMsgs = [];
      // Extract missing points from structured response
      const draftMissingPoints = Array.isArray(result.missing_points) && result.missing_points.length > 0
        ? result.missing_points
        : null;

      // Only show the draft bubble — no brief commentary before or after
      if (cleanDraft) {
        newMsgs.push({
          id: uid(), role: 'ely',
          content: cleanDraft,
          draft: cleanDraft,
          draftType: result.draftType || 'email',
          messageType: 'draft',
          missingPoints: draftMissingPoints,
        });
      } else {
        // No draft detected — show as plain Ely response (discussion, analysis, question answer etc.)
        newMsgs.push({ id: uid(), role: 'ely', content: raw });
      }

      setMessages(prev => [...prev, ...newMsgs]);
    } catch (err) {
      setMessages(prev => [...prev, { id: uid(), role: 'ely', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, send, sessionId, email, threadId, projectId, pendingCaseReview]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };


  const handleTextChange = (e) => {
    setInput(e.target.value);
  };

  const handleClose = () => {
    setVoiceStopSignal(v => v + 1);
    onClose?.();
  };

  return (
    <div className="draft-ely-panel" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="draft-ely-inner">
        <div className="draft-ely-header">
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>✨</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Draft with Ely</div>
            <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>
              {email?.subject ? `Re: ${email.subject.slice(0, 40)}` : 'New draft'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleClose} style={{ padding: '4px 8px', fontSize: 16 }}>✕</button>
        </div>

        <div className="draft-ely-messages">
          {loading && messages.length === 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 0' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>✨</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>Reading email thread...</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', animation: 'blink 1.2s infinite', animationDelay: `${i*0.2}s` }} />
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            msg.messageType === 'summary' ? (
              <div key={msg.id} style={{
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '12px 14px',
                fontSize: 12.5,
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 12 }}>✨</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Summary</span>
                </div>
                <SummaryCard text={msg.content} />
              </div>
            ) : (
              <div key={msg.id}>
                <ChatMessage
                  msg={msg}
                  onUseDraft={applyDraftToComposer}
                  onOpenInComposer={applyDraftToComposer}
                />
                {msg.missingPoints && msg.missingPoints.length > 0 && (
                  <div style={{ margin: '6px 0 10px 0', padding: '10px 13px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                      Still to address
                    </div>
                    {msg.missingPoints.map((point, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                        <span style={{ flexShrink: 0, color: 'var(--text3)' }}>•</span>
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          ))}

          {loading && messages.length > 0 && (
            <div style={{ display: 'flex', gap: 4, padding: '8px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 14, alignSelf: 'flex-start' }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', animation: 'blink 1.2s infinite', animationDelay: `${i*0.2}s` }} />)}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="draft-ely-input">
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSend={({ text, file }) => handleSend(text, file)}
            placeholder="Dictate your notes… e.g. 'confirm fee includes VAT, keep it brief'"
            disabled={loading}
            loading={loading}
            stopSignal={voiceStopSignal}
          />
          <div style={{ fontSize: 9.5, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>AI can make mistakes.</div>
        </div>
      </div>

      <style>{`@keyframes blink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }`}</style>
    </div>
  );
}








