import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage from './ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import { uid } from '../../utils/formatters';

export default function MainChat({ onOpenComposer }) {
  const { state } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatList, setChatList] = useState([]); // [{id, name, messages, sessionId}]
  const [activeChatId, setActiveChatId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const { send, loading, sessionId, resetSession } = useEly({ surface: 'main_chat' });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startNewChat = useCallback(() => {
    if (messages.length > 0) {
      // Save current chat to list
      const id = uid();
      const firstMsg = messages[0];
      setChatList(prev => [{
        id,
        name: firstMsg?.content?.slice(0, 40) || 'Chat',
        messages,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      }, ...prev]);
    }
    setMessages([]);
    resetSession();
    setActiveChatId(null);
  }, [messages, resetSession]);

  const loadChat = useCallback((chat) => {
    setMessages(chat.messages);
    setActiveChatId(chat.id);
    setSidebarOpen(false);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
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
      };
      setMessages(prev => [...prev, elyMsg]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(), role: 'ely',
        content: `Sorry, I couldn't process that. ${err.message}`,
      }]);
    }
  }, [input, loading, send]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoice = (transcript) => {
    setInput(prev => prev ? prev + ' ' + transcript : transcript);
    textareaRef.current?.focus();
  };

  const handleOpenInComposer = (draft) => {
    onOpenComposer?.({ mode: 'compose', body: draft });
  };

  return (
    <div className="ai-full-screen">
      {/* Top bar */}
      <div className="ai-full-top">
        <button
          className="btn btn-ghost btn-sm"
          style={{ display: 'none' }}
          id="ai-full-mob-btn"
          onClick={() => setSidebarOpen(v => !v)}
        >
          ☰
        </button>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>✨</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Ely</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>Practice Assistant</div>
        </div>
        <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={startNewChat}>
          + New chat
        </button>
      </div>

      <div className="ai-full-body">
        {/* Chat history sidebar */}
        <div className={`ai-full-sidebar${sidebarOpen ? ' mob-open' : ''}`}>
          <div className="ai-full-sidebar-hdr">
            <span>History</span>
            <button className="btn btn-xs btn-ghost" onClick={startNewChat}>+ New</button>
          </div>
          {chatList.length === 0 ? (
            <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
              No previous chats
            </div>
          ) : (
            chatList.map(chat => (
              <div
                key={chat.id}
                className={`ai-sess-item${activeChatId === chat.id ? ' active' : ''}`}
                onClick={() => loadChat(chat)}
              >
                <div className="ai-sess-name">{chat.name}</div>
                <div className="ai-sess-date">{chat.date}</div>
              </div>
            ))
          )}
        </div>

        {/* Main chat area */}
        <div className="ai-full-main">
          <div className="ai-full-msgs">
            {messages.length === 0 ? (
              <WelcomeScreen onSend={(text) => { setInput(text); }} userName={state.currentUser?.email?.split('@')[0] || state.settings.name} />
            ) : (
              messages.map(msg => (
                <ChatMessage
                  key={msg.id}
                  msg={msg}
                  onUseDraft={(draft) => { setInput(draft); }}
                  onOpenInComposer={handleOpenInComposer}
                />
              ))
            )}
            {loading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="ai-full-input">
            <div className="ai-input-row">
              <VoiceInput onTranscript={handleVoice} disabled={loading} />
              <textarea
                ref={textareaRef}
                className="ai-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Ely anything about party wall, your projects, or drafting..."
                rows={1}
                style={{ minHeight: 28 }}
                onInput={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
                }}
              />
              <button
                className="ai-send-btn"
                onClick={handleSend}
                disabled={loading || !input.trim()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>
              AI can make mistakes. Always verify professional advice.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>✨</div>
      <div style={{ display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 16, borderBottomLeftRadius: 4 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)',
            animation: 'blink 1.2s infinite',
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </div>
      <style>{`@keyframes blink { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }`}</style>
    </div>
  );
}

function WelcomeScreen({ onSend, userName }) {
  const SUGGESTIONS = [
    'What are my active party wall cases?',
    'Draft a section 10 consent letter',
    'What are the current statutory timescales?',
    'Help me draft an award',
    'Find the latest email from my client',
    'What is the Party Wall Act 1996?',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 16 }}>✨</div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Hello{userName ? `, ${userName}` : ''}!</h2>
      <p style={{ color: 'var(--text2)', fontSize: 13.5, marginBottom: 28, maxWidth: 400, lineHeight: 1.6 }}>
        I'm Ely, your party wall practice assistant. I can help with legal questions, drafting documents, searching your emails, and managing your cases.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 540 }}>
        {SUGGESTIONS.map((s, i) => (
          <button key={i} className="btn btn-sm" onClick={() => onSend(s)} style={{ borderRadius: 99 }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
