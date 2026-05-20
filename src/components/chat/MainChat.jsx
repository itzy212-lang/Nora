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

  const { send, loading, resetSession } = useEly({
    surface: 'main_chat',
  });

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

  const handleClose = () => {
    stopVoice();

    if (onClose) {
      onClose();
      return;
    }

    const overlay = document.getElementById('main-chat-overlay');

    if (overlay) {
      overlay.style.display = 'none';
    }

    window.history.back();
  };

  const startNewChat = useCallback(() => {
    stopVoice();

    if (messages.length > 0) {
      const id = uid();

      setChatList(prev => [
        {
          id,
          name: messages[0]?.content?.slice(0, 40) || 'Chat',
          messages,
          date: new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          }),
        },
        ...prev,
      ]);
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

  const handleSend = useCallback(async () => {
    const text = input.trim();

    if (!text || loading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg = {
      id: uid(),
      role: 'user',
      content: text,
    };

    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await send(text);

      const elyMsg = {
        id: uid(),
        role: 'ely',
        content: result.reply,
      };

      setMessages(prev => [...prev, elyMsg]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'ely',
          content: `Sorry, I couldn't process that. ${err.message}`,
        },
      ]);
    }
  }, [input, loading, send, stopVoice]);

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

  return (
    <div id="main-chat-overlay" className="ai-full-screen">
      <div className="ai-full-top">
        <button
          className="btn btn-ghost btn-sm"
          style={{ display: 'none' }}
          id="ai-full-mob-btn"
          onClick={() => setSidebarOpen(v => !v)}
        >
          ☰
        </button>

        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          ✨
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Ely</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            Practice Assistant
          </div>
        </div>

        <button
          className="btn btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={startNewChat}
        >
          + New chat
        </button>

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
            marginLeft: 6,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      <div className="ai-full-body">
        <div className={`ai-full-sidebar${sidebarOpen ? ' mob-open' : ''}`}>
          <div className="ai-full-sidebar-hdr">
            <span>History</span>

            <button
              className="btn btn-xs btn-ghost"
              onClick={startNewChat}
            >
              + New
            </button>
          </div>

          {chatList.length === 0 ? (
            <div
              style={{
                padding: '20px 14px',
                fontSize: 12,
                color: 'var(--text3)',
                textAlign: 'center',
              }}
            >
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

        <div className="ai-full-main">
          <div className="ai-full-msgs">
            {messages.map(msg => (
              <ChatMessage key={msg.id} msg={msg} />
            ))}

            <div ref={messagesEndRef} />
          </div>

          <div className="ai-full-input">
            <div
              className="ai-input-row"
              style={{ alignItems: 'flex-end' }}
            >
              <VoiceInput
                onTranscript={handleVoice}
                disabled={loading}
                stopSignal={voiceStopSignal}
              />

              <textarea
                ref={textareaRef}
                className="ai-textarea"
                value={input}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask Ely anything..."
                rows={1}
                style={{
                  minHeight: 38,
                  maxHeight: 140,
                  overflowY: 'hidden',
                  resize: 'none',
                  lineHeight: 1.5,
                }}
              />

              <button
                className="ai-send-btn"
                onClick={handleSend}
                disabled={loading || !input.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
