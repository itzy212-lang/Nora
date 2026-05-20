import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage from '../chat/ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import { uid } from '../../utils/formatters';

/**
 * DraftWithEly — slide-in panel for drafting emails with Ely.
 * On open: automatically reads the email thread.
 * Subsequent turns: collaborative_reply_assistant mode.
 * "Use this draft" button sends draft text back to composer.
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
  const voiceBaseRef = useRef('');
  const { send } = useEly({ surface: 'email_composer' });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
  }, []);

  useEffect(() => {
    if (!email || initialized) return;
    setInitialized(true);
    autoSummarise();
  }, [email]);

  const autoSummarise = useCallback(async () => {
    setLoading(true);

    try {
      const result = await send('', {
        mode: 'email_thread_summary',
        emailId: email?.id || email?.external_id,
        threadId: threadId || email?.thread_id,
        projectId,
        emailContext: {
          from: email?.from || email?.from_email || '',
          subject: email?.subject || '',
          body: (email?.body || email?.preview || '').slice(0, 3000),
        },
      });

      if (result.sessionId) setSessionId(result.sessionId);

      setMessages([{
        id: uid(),
        role: 'ely',
        content: result.reply,
        draft: result.draft,
        draftType: result.draftType || 'email',
      }]);
    } catch (err) {
      setMessages([{
        id: uid(),
        role: 'ely',
        content: `I couldn't load the email context. ${err.message}`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [email, threadId, projectId, send]);

  const handleSend = useCallback(async () => {
    const text = input.trim();

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
        sessionId,
        emailId: email?.id || email?.external_id,
        threadId: threadId || email?.thread_id,
        projectId,
        emailContext: {
          from: email?.from || email?.from_email || '',
          subject: email?.subject || '',
          body: (email?.body || email?.preview || '').slice(0, 3000),
        },
      });

      if (result.sessionId) setSessionId(result.sessionId);

      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: result.reply,
        draft: result.draft,
        draftType: result.draftType || 'email',
      }]);
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

  const handleVoice = (transcript) => {
    if (!voiceBaseRef.current) {
      voiceBaseRef.current = input.trim();
    }

    const base = voiceBaseRef.current;
    const next = base ? `${base} ${transcript}` : transcript;

    setInput(next);

    requestAnimationFrame(resizeTextarea);
    textareaRef.current?.focus();
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
              <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>Reading email thread…</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', animation: 'blink 1.2s infinite', animationDelay: `${i*0.2}s` }} />
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              onUseDraft={onUseDraft}
              onOpenInComposer={onUseDraft}
            />
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

            <button className="ai-send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
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
