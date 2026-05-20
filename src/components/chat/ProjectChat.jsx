import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage from './ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import { uid } from '../../utils/formatters';

export default function ProjectChat({ project, onOpenComposer, onClose }) {
  const { state } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');

  const { send, loading, resetSession } = useEly({
    surface: 'project_chat',
    projectId: project?.id,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const QUICK_TAGS = [
    'Summarise this case',
    'Draft a response letter',
    'What are the next steps?',
    'Check statutory deadlines',
    'Review surveyor details',
  ];

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

  const startNew = useCallback(() => {
    stopVoice();

    if (messages.length > 0) {
      const id = uid();

      setSessions(prev => [{
        id,
        name: messages[0]?.content?.slice(0, 40) || 'Session',
        messages,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      }, ...prev]);
    }

    setMessages([]);
    setInput('');
    resetSession();
  }, [messages, resetSession, stopVoice]);

  const handleSend = useCallback(async (text) => {
    const msg = (text || input).trim();

    if (!msg || loading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg = { id: uid(), role: 'user', content: msg };

    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await send(msg, { projectId: project?.id });

      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: result.reply,
        draft: result.draft,
        draftType: result.draftType,
        suggestedActions: result.suggestedActions,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `Error: ${err.message}`,
      }]);
    }
  }, [input, loading, send, project, stopVoice]);

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
    <div id="proj-chat-full" style={{
      display: 'flex', position: 'fixed', inset: 0, zIndex: 260,
      background: 'var(--bg)', flexDirection: 'column',
    }}>
      <div className="pch-topbar" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg2)', flexShrink: 0 }}>
        <button
          style={{ display: 'none' }}
          id="pch-sessions-btn"
          className="btn btn-ghost btn-sm"
          onClick={() => setSidebarOpen(v => !v)}
        >
          ☰
        </button>

        <button className="btn btn-ghost btn-sm" onClick={handleClose}>← Back</button>

        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Chat — {project?.ref || 'Project'}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{project?.address || project?.bo_premise_address || ''}</div>
        </div>

        <button className="btn btn-xs" onClick={startNew}>+ New</button>

        <button
          className="btn btn-ghost btn-sm"
          onClick={handleClose}
          title="Close chat"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            padding: 0,
            fontSize: 18,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div className={`pch-sidebar${sidebarOpen ? ' mob-open' : ''}`} style={{
          width: 240, minWidth: 240, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', background: 'var(--bg2)', overflowY: 'auto',
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 11.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span>Sessions</span>
            <button className="btn btn-xs btn-ghost" onClick={startNew}>+ New</button>
          </div>

          {sessions.length === 0 ? (
            <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text3)' }}>No saved sessions yet</div>
          ) : sessions.map(s => (
            <div key={s.id} className="pch-session-item" onClick={() => { stopVoice(); setMessages(s.messages); setSidebarOpen(false); }}>
              <div className="pch-session-name">{s.name}</div>
              <div className="pch-session-date">{s.date}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text3)' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
                <div style={{ fontSize: 13 }}>Ask Ely about this project</div>
                <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text3)' }}>
                  Ely has full context on {project?.ref} — AOs, notices, correspondence, timeline.
                </div>
              </div>
            )}

            {messages.map(msg => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                onUseDraft={(draft) => {
                  setInput(draft);
                  requestAnimationFrame(resizeTextarea);
                }}
                onOpenInComposer={(draft) => onOpenComposer?.({ mode: 'compose', body: draft, projectId: project?.id })}
              />
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 16, borderBottomLeftRadius: 4, alignSelf: 'flex-start' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'blink 1.2s infinite', animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div style={{ padding: '8px 16px', display: 'flex', gap: 5, flexWrap: 'wrap', borderTop: '1px solid var(--border)' }}>
            {QUICK_TAGS.map((tag, i) => (
              <button key={i} className="btn btn-xs" style={{ borderRadius: 99 }} onClick={() => handleSend(tag)}>
                {tag}
              </button>
            ))}
          </div>

          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
            <div className="pch-input-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 14, padding: '8px 10px' }}>
              <VoiceInput onTranscript={handleVoice} disabled={loading} stopSignal={voiceStopSignal} />

              <textarea
                ref={textareaRef}
                className="pch-textarea"
                value={input}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask about this project..."
                rows={1}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  fontSize: 13.5,
                  color: 'var(--text)',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                  resize: 'none',
                  maxHeight: 140,
                  minHeight: 38,
                  overflowY: 'hidden',
                  lineHeight: 1.55,
                  padding: '7px 6px',
                }}
              />

              <button className="ai-send-btn" onClick={() => handleSend()} disabled={loading || !input.trim()}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
