import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage, { normaliseDraftText, splitSubjectFromDraft } from '../chat/ChatMessage';

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Split Ely response into brief + draft + after
function splitAssistantResponseLocal(raw = '') {
  const text = String(raw || '').trim();
  const markers = [
    /\bSubject\s*:/i,
    /\bDear\s+[A-Z0-9]/i,
    /\bHi\s+[A-Z0-9]/i,
    /\bHello\s+[A-Z0-9]/i,
    /\bGood morning\b/i,
    /\bGood afternoon\b/i,
    /\bFurther to\b/i,
    /\bFollowing our\b/i,
    /\bI refer to\b/i,
    /\bThank you for\b/i,
    /\bMany thanks for\b/i,
    /\bI hope (this|you)\b/i,
    /\bI am writing\b/i,
    /\bI write\b/i,
  ];
  const positions = markers
    .map(rx => { const m = text.match(rx); return m ? m.index : -1; })
    .filter(i => i >= 0);
  if (!positions.length) return { brief: text, draft: '', after: '' };
  const idx = Math.min(...positions);
  const brief = text.slice(0, idx).trim();
  let draft = text.slice(idx).trim();
  let after = '';
  const afterRx = /\n\s*(Let me know|Please let me know|Happy to|Feel free|Shall I|Would you like|Do you want)[\s\S]*$/i;
  const afterMatch = draft.match(afterRx);
  if (afterMatch) { after = afterMatch[0].trim(); draft = draft.replace(afterRx, '').trim(); }
  return { brief, draft, after };
}
import VoiceInput from '../shared/VoiceInput';
import DictationOverlay from '../shared/DictationOverlay';
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
  const [voicePhase, setVoicePhase] = useState('idle');
  const [liveTop, setLiveTop] = useState('');
  const [liveBottom, setLiveBottom] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');
  const prevPhraseRef = useRef('');
  const latestTranscriptRef = useRef('');
  const { send } = useEly({ surface: 'email_composer' });
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

  const stopVoice = useCallback(() => {
    setVoiceStopSignal(v => v + 1);
    voiceBaseRef.current = '';
    prevPhraseRef.current = '';
    latestTranscriptRef.current = '';
    setVoicePhase('idle');
    setLiveTop('');
    setLiveBottom('');
  }, []);

  const applyDraftToComposer = useCallback((draftInput) => {
    const raw = typeof draftInput === 'string'
      ? draftInput
      : draftInput?.body || draftInput?.draft || draftInput?.documentText || draftInput?.content || '';

    const { body } = splitSubjectFromDraft(raw);
    const cleanBody = normaliseDraftText(body || raw);

    if (!cleanBody) return;

    onUseDraft?.(cleanBody);
    stopVoice();
    onClose?.();
  }, [onUseDraft, onClose, stopVoice]);

  useEffect(() => {
    if (!email || initialized) return;
    setInitialized(true);
    autoSummarise();
  }, [email, initialized]);

  const autoSummarise = useCallback(async () => {
    setSummarising(true);

    try {
      const result = await send('', {
        mode: 'email_thread_summary',
        workflowStage: 'summary',
        emailId: email?.id || email?.external_id,
        threadId: threadId || email?.thread_id,
        projectId,
        emailContext: {
          from: email?.sender_name || email?.from || email?.from_email || '',
          sender_email: email?.sender_email || email?.from_email || '',
          subject: email?.subject || '',
          body: (email?.body_text || '').slice(0, 6000) || stripHtml(email?.body || '').slice(0, 6000) || (email?.preview || '').slice(0, 2000),
          received_at: email?.received_at || '',
        },
      });

      if (result.sessionId) setSessionId(result.sessionId);

      setMessages([{
        id: uid(),
        role: 'ely',
        messageType: 'summary',
        content: result.reply,
      }]);
    } catch (err) {
      setMessages([{
        id: uid(),
        role: 'ely',
        content: `I couldn't load the email context. ${err.message}`,
      }]);
    } finally {
      setSummarising(false);
    }
  }, [email, threadId, projectId, send]);

  const handleSend = useCallback(async (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();

    if (!text || loading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg = { id: uid(), role: 'user', content: text };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const result = await send(text, {
        mode: 'collaborative_reply_assistant',
        workflowStage: 'discussion_or_draft',
        sessionId,
        emailId: email?.id || email?.external_id,
        threadId: threadId || email?.thread_id,
        projectId,
        emailContext: {
          from: email?.sender_name || email?.from || email?.from_email || '',
          sender_email: email?.sender_email || email?.from_email || '',
          subject: email?.subject || '',
          body: (email?.body_text || '').slice(0, 6000) || stripHtml(email?.body || '').slice(0, 6000) || (email?.preview || '').slice(0, 2000),
          received_at: email?.received_at || '',
        },
      });

      if (result.sessionId) setSessionId(result.sessionId);

      const raw = result.reply || result.draft || '';
      const { brief, draft: splitDraft, after } = splitAssistantResponseLocal(raw);

      const newMsgs = [];
      if (brief) newMsgs.push({ id: uid(), role: 'ely', content: brief, messageType: 'brief' });
      if (splitDraft) newMsgs.push({
        id: uid(), role: 'ely',
        content: splitDraft,
        draft: splitDraft,
        draftType: result.draftType || 'email',
        messageType: 'draft',
      });
      if (after) newMsgs.push({ id: uid(), role: 'ely', content: after, messageType: 'brief' });
      if (!newMsgs.length) newMsgs.push({ id: uid(), role: 'ely', content: raw, messageType: 'brief' });

      setMessages(prev => [...prev, ...newMsgs]);
    } catch (err) {
      setMessages(prev => [...prev, { id: uid(), role: 'ely', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, send, sessionId, email, threadId, projectId, stopVoice]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoice = (transcript, meta) => {
    if (!meta?.recording && transcript) {
      latestTranscriptRef.current = transcript;
      setInput(transcript);
      setVoicePhase('preview');
      return;
    }
    if (transcript) latestTranscriptRef.current = transcript;
  };

  const handleVoicePreview = (phrase, meta) => {
    if (meta?.recording === false) {
      if (latestTranscriptRef.current) {
        setInput(latestTranscriptRef.current);
        setVoicePhase('idle');
      } else if (voicePhase !== 'idle') {
        setVoicePhase('transcribing');
      }
      setLiveTop('');
      setLiveBottom('');
      prevPhraseRef.current = '';
      return;
    }
    if (meta?.recording === true) {
      setVoicePhase('recording');
      if (phrase && !phrase.includes('Recording')) {
        setLiveTop(prevPhraseRef.current);
        setLiveBottom(phrase);
        prevPhraseRef.current = phrase;
      }
    }
  };

  const handleTextChange = (e) => {
    voiceBaseRef.current = '';
    setInput(e.target.value);
  };

  const handleClose = () => {
    stopVoice();
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
              <ChatMessage
                key={msg.id}
                msg={msg}
                onUseDraft={applyDraftToComposer}
                onOpenInComposer={applyDraftToComposer}
              />
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
          <div className="draft-ely-input-row" style={{ alignItems: 'flex-end' }}>
            <VoiceInput
              onTranscript={handleVoice}
              onPreview={handleVoicePreview}
              disabled={loading}
              stopSignal={voiceStopSignal}
            />

            <textarea
              ref={textareaRef}
              className="draft-ely-textarea"
              value={input}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="Tell Ely what to say... e.g. 'confirm fee includes VAT, keep it brief'"
              rows={2}
              style={{
                maxHeight: 140,
                minHeight: 44,
                overflowY: 'hidden',
                resize: 'none',
                lineHeight: 1.5,
              }}
            />

            <button className="ai-send-btn" onClick={() => voicePhase === 'recording' ? stopVoice() : handleSend()} disabled={loading || voicePhase === 'transcribing' || (voicePhase !== 'recording' && !input.trim())}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>

          <div style={{ fontSize: 9.5, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>AI can make mistakes.</div>
        </div>
      </div>

      <style>{`@keyframes blink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }`}</style>
    </div>
  );
}




