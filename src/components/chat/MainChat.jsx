import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage from './ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import { uid } from '../../utils/formatters';

export default function MainChat({ onOpenComposer, onClose }) {
  const { state } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatList, setChatList] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');

  const { send, loading, resetSession } = useEly({ surface: 'main_chat' });

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

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const stopVoice = useCallback(() => {
    setVoiceStopSignal(v => v + 1);
    voiceBaseRef.current = '';
  }, []);

  const closeToDashboard = useCallback(() => {
    stopVoice();
    if (typeof onClose === 'function') {
      onClose();
      return;
    }
    window.location.assign('/');
  }, [onClose, stopVoice]);

  const startNewChat = useCallback(() => {
    stopVoice();
    if (messages.length > 0) {
      const id = uid();
      setChatList(prev => [{
        id,
        name: messages[0]?.content?.slice(0, 40) || 'Chat',
        messages,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      }, ...prev]);
    }
    setMessages([]);
    setInput('');
    resetSession();
    setActiveChatId(null);
  }, [messages, resetSession, stopVoice]);

  const loadChat = useCallback((chat) => {
    stopVoice();
    setMessages(chat.messages);
    setActiveChatId(chat.id);
    setSidebarOpen(false);
  }, [stopVoice]);

  const handleOpenInComposer = useCallback((draftOrOptions) => {
    if (typeof draftOrOptions === 'string') {
      onOpenComposer?.({ mode: 'compose', body: draftOrOptions });
      return;
    }
    onOpenComposer?.({ mode: 'compose', ...(draftOrOptions || {}) });
  }, [onOpenComposer]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    stopVoice();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg = { id: uid(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await send(text);
      const elyMsg = {
        id: uid(),
        role: 'ely',
        content: result.reply,
        draft: result.draft,
        draftType: result.draftType,
        suggestedActions: result.suggestedActions,
        recipient: result.recipient,
        selectedAO: result.selectedAO,
        projectId: result.projectId || result.project_id || result.currentProject?.id || state.currentProject?.id || '',
      };
      setMessages(prev => [...prev, elyMsg]);
    } catch (err) {
      setMessages(prev => [...prev, { id: uid(), role: 'ely', content: `Sorry, I couldn't process that. ${err.message}` }]);
    }
  }, [input, loading, send, stopVoice, state.currentProject]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoice = (transcript) => {
    if (!voiceBaseRef.current) voiceBaseRef.current = input.trim();
    const base = voiceBaseRef.current;
    setInput(base ? `${base} ${transcript}` : transcript);
    requestAnimationFrame(resizeTextarea);
    textareaRef.current?.focus();
  };

  const handleTextChange = (e) => {
    voiceBaseRef.current = '';
    setInput(e.target.value);
  };

  return (
    <div id="main-chat-overlay" className="ai-full-screen">
      <div className="ai-full-top">
        <button className="btn btn-ghost btn-sm" style={{ display: 'none' }} id="ai-full-mob-btn" onClick={() => setSidebarOpen(v => !v)}>☰</button>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>✨</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Ely</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>Practice Assistant</div>
        </div>
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={startNewChat}>+ New chat</button>
        <button className="main-chat-close-btn" onClick={closeToDashboard} title="Close chat" aria-label="Close chat" type="button">×</button>
      </div>

      <div className="ai-full-body">
        <div className={`ai-full-sidebar${sidebarOpen ? ' mob-open' : ''}`}>
          <div className="ai-full-sidebar-hdr"><span>History</span><button className="btn btn-xs btn-ghost" onClick={startNewChat}>+ New</button></div>
          {chatList.length === 0 ? (
            <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>No previous chats</div>
          ) : chatList.map(chat => (
            <div key={chat.id} className={`ai-sess-item${activeChatId === chat.id ? ' active' : ''}`} onClick={() => loadChat(chat)}>
              <div className="ai-sess-name">{chat.name}</div>
              <div className="ai-sess-date">{chat.date}</div>
            </div>
          ))}
        </div>

        <div className="ai-full-main">
          <div className="ai-full-msgs">
            {messages.length === 0 ? (
              <WelcomeScreen onSend={(text) => { setInput(text); requestAnimationFrame(resizeTextarea); }} userName={state.currentUser?.email?.split('@')[0] || state.settings.name} />
            ) : messages.map(msg => (
              <ChatMessage key={msg.id} msg={msg} onUseDraft={(draft) => { setInput(draft); requestAnimationFrame(resizeTextarea); }} onOpenInComposer={handleOpenInComposer} />
            ))}
            {loading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-full-input">
            <div className="ai-input-row main-chat-input-row" style={{ alignItems: 'flex-end' }}>
              <VoiceInput onTranscript={handleVoice} disabled={loading} stopSignal={voiceStopSignal} />
              <textarea ref={textareaRef} className="ai-textarea" value={input} onChange={handleTextChange} onKeyDown={handleKeyDown} placeholder="Ask Ely anything about party wall, your projects, or drafting..." rows={1} style={{ minHeight: 38, maxHeight: 140, overflowY: 'hidden', resize: 'none', lineHeight: 1.5 }} />
              <button className="main-chat-send-btn" onClick={handleSend} disabled={loading || !input.trim()} type="button" aria-label="Send message" title="Send">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>AI can make mistakes. Always verify professional advice.</div>
          </div>
        </div>
      </div>

      <style>{`
        .main-chat-close-btn { width: 32px; height: 32px; border-radius: 50%; border: 0; background: transparent; color: var(--text3); display: flex; align-items: center; justify-content: center; font-size: 22px; line-height: 1; cursor: pointer; margin-left: 6px; padding: 0; }
        .main-chat-close-btn:hover { background: var(--bg3); color: var(--text); }
        .main-chat-send-btn { width: 42px; height: 42px; border-radius: 50%; border: 0; background: var(--blue); color: #ffffff; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; padding: 0; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.24); }
        .main-chat-send-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
        .main-chat-input-row .voice-btn { width: 38px !important; height: 38px !important; background: transparent !important; border: 0 !important; box-shadow: none !important; color: #9ca3af !important; }
        .main-chat-input-row .voice-btn.listening { color: #ef4444 !important; }
        .main-chat-input-row .voice-btn svg, .main-chat-input-row .voice-btn svg * { stroke-width: 1.65 !important; }
        .main-chat-input-row .voice-btn:hover { color: #6b7280 !important; }
        .main-chat-input-row .voice-btn.listening:hover { color: #dc2626 !important; }
      `}</style>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>✨</div>
      <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 16, borderBottomLeftRadius: 4 }}>
        {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'blink 1.2s infinite', animationDelay: `${i * 0.2}s` }} />)}
      </div>
      <style>{`@keyframes blink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }`}</style>
    </div>
  );
}

function WelcomeScreen({ onSend, userName }) {
  const SUGGESTIONS = ['What are my active party wall cases?', 'Draft a section 10 consent letter', 'What are the current statutory timescales?', 'Help me draft an award', 'Find the latest email from my client', 'What is the Party Wall Act 1996?'];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 16 }}>✨</div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Hello{userName ? `, ${userName}` : ''}!</h2>
      <p style={{ color: 'var(--text2)', fontSize: 13.5, marginBottom: 28, maxWidth: 400, lineHeight: 1.6 }}>I'm Ely, your party wall practice assistant. I can help with legal questions, drafting documents, searching your emails, and managing your cases.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 540 }}>
        {SUGGESTIONS.map((s, i) => <button key={i} className="btn btn-sm" onClick={() => onSend(s)} style={{ borderRadius: 99 }}>{s}</button>)}
      </div>
    </div>
  );
}
