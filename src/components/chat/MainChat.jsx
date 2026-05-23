import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage, { normaliseDraftText } from './ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import { uid } from '../../utils/formatters';

const ACTIVE_SESSION_KEY = 'ely_main_chat_active_session_id';
const ACTIVE_PROJECT_KEY = 'ely_main_chat_selected_project_id';

function isDraftRequest(text = '', hasPreviousDraft = false) {
  const s = text.toLowerCase();

  const draftWords = ['draft', 'write', 'email', 'letter', 'compose', 'covering', 'respond', 'reply', 'wording', 'whatsapp', 'text message'];
  const editWords = ['change', 'amend', 'revise', 'rewrite', 'update', 'make it', 'add', 'remove', 'replace', 'shorter', 'firmer', 'softer', 'more formal', 'less formal'];

  if (draftWords.some(word => s.includes(word))) return true;
  if (hasPreviousDraft && editWords.some(word => s.includes(word))) return true;

  return false;
}

function findDraftStart(text = '') {
  const markers = [/\bSubject\s*:/i, /\bDear\s+[A-Z0-9]/i, /\bHi\s+[A-Z0-9]/i, /\bHello\s+[A-Z0-9]/i];

  const positions = markers
    .map(rx => {
      const match = text.match(rx);
      return match ? match.index : -1;
    })
    .filter(index => index >= 0);

  if (!positions.length) return -1;
  return Math.min(...positions);
}

function cleanBrief(raw = '') {
  let text = String(raw || '').trim();

  text = text
    .replace(/^Thanks for the direction\.?\s*/i, '')
    .replace(/^Sure,?\s*/i, '')
    .replace(/Here(?:'s| is)\s+the\s+draft(?:\s+for\s+.+?)?:?\s*$/i, '')
    .replace(/Here(?:'s| is)\s+my\s+draft(?:\s+for\s+.+?)?:?\s*$/i, '')
    .replace(/^\s*-{3,}\s*/g, '')
    .replace(/\s*-{3,}\s*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/^(thanks|thank you)$/i.test(text)) return '';
  if (/^thanks for the direction/i.test(text)) return '';
  if (/^here(?:'s| is) the draft/i.test(text)) return '';

  return text
    .replace(/FACTUAL POSITION\s*:/gi, '\n• Factual position: ')
    .replace(/LEGAL POSITION\s*:/gi, '\n• Legal position: ')
    .replace(/STRATEGIC OBJECTIVE\s*:/gi, '\n• Strategic objective: ')
    .replace(/UNDERSTANDING\s*:/gi, '\n• Understanding: ')
    .replace(/NEXT STEP\s*:/gi, '\n• Next step: ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitAssistantResponse(raw = '') {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!text) return { brief: '', draft: '', after: '' };

  const draftStart = findDraftStart(text);

  if (draftStart === -1) {
    return { brief: cleanBrief(text), draft: '', after: '' };
  }

  const before = text.slice(0, draftStart).trim();
  let draftAndAfter = text.slice(draftStart).trim();
  let after = '';

  const afterPatterns = [
    /\n-{3,}\s*\n\s*(I included[\s\S]*)$/i,
    /\n-{3,}\s*\n\s*(I've included[\s\S]*)$/i,
    /\n-{3,}\s*\n\s*(This draft[\s\S]*)$/i,
    /\n-{3,}\s*\n\s*(Let me know[\s\S]*)$/i,
    /\n\s*(I included the[\s\S]*)$/i,
    /\n\s*(I've included the[\s\S]*)$/i,
    /\n\s*(Let me know if this tone[\s\S]*)$/i,
    /\n\s*(Let me know if this suits[\s\S]*)$/i,
  ];

  for (const rx of afterPatterns) {
    const match = draftAndAfter.match(rx);
    if (match?.[1]) {
      after = cleanBrief(match[1]);
      draftAndAfter = draftAndAfter.replace(rx, '').trim();
      break;
    }
  }

  return {
    brief: cleanBrief(before),
    draft: normaliseDraftText(draftAndAfter),
    after,
  };
}

function sessionTitle(session = {}) {
  return session.title || session.auto_title || session.summary || 'Untitled chat';
}

function sessionDate(session = {}) {
  const value = session.last_message_at || session.updated_at || session.created_at;
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function sessionTimeValue(session = {}) {
  const value = session.last_message_at || session.updated_at || session.created_at;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortSessionsNewestFirst(sessions = []) {
  return [...(sessions || [])].sort((a, b) => sessionTimeValue(b) - sessionTimeValue(a));
}

export default function MainChat({ onOpenComposer, onClose }) {
  const { state } = useApp();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [activeChatId, setActiveChatId] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_PROJECT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [lastDraft, setLastDraft] = useState('');
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [linkingProject, setLinkingProject] = useState(false);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');

  const {
    send,
    loading,
    sessionsLoading,
    sessionId,
    resetSession,
    startNewSession,
    loadSession,
    linkSessionToProject,
    refreshProjectSessions,
    refreshGlobalSessions,
    projectSessions,
    globalSessions,
  } = useEly({
    surface: 'main_chat',
    projectId: selectedProjectId || null,
  });

  const sortedSessions = useMemo(() => {
    const source = selectedProjectId ? projectSessions : globalSessions;
    return sortSessionsNewestFirst(source);
  }, [selectedProjectId, projectSessions, globalSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try {
      if (selectedProjectId) {
        localStorage.setItem(ACTIVE_PROJECT_KEY, selectedProjectId);
      } else {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
    } catch {}
  }, [selectedProjectId]);

  useEffect(() => {
    try {
      if (sessionId) {
        localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
        setActiveChatId(sessionId);
      }
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    if (selectedProjectId) {
      refreshProjectSessions(selectedProjectId);
    } else {
      refreshGlobalSessions();
    }
  }, [selectedProjectId, refreshProjectSessions, refreshGlobalSessions]);

  useEffect(() => {
    if (restoreAttempted || sessionsLoading || !sortedSessions.length) return;

    let savedSessionId = '';
    try {
      savedSessionId = localStorage.getItem(ACTIVE_SESSION_KEY) || '';
    } catch {}

    const targetSession =
      sortedSessions.find(s => String(s.id) === String(savedSessionId)) ||
      sortedSessions[0];

    if (!targetSession?.id) {
      setRestoreAttempted(true);
      return;
    }

    setRestoreAttempted(true);

    loadSession(targetSession.id)
      .then(bundle => {
        if (bundle?.messages) {
          setMessages(bundle.messages);
          setActiveChatId(targetSession.id);
        }
      })
      .catch(err => {
        console.warn('[MainChat] Failed to restore session:', err.message);
      });
  }, [restoreAttempted, sessionsLoading, sortedSessions, loadSession]);

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
    setMessages([]);
    setInput('');
    setLastDraft('');
    setActiveChatId(null);
    resetSession();
    startNewSession?.();

    try {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {}
  }, [resetSession, startNewSession, stopVoice]);

  const loadChat = useCallback(async (chat) => {
    if (!chat?.id) return;

    stopVoice();

    try {
      const bundle = await loadSession(chat.id);
      setMessages(bundle?.messages || []);
      setActiveChatId(chat.id);
      setLastDraft('');
      setSidebarOpen(false);

      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, chat.id);
      } catch {}
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `Sorry, I couldn't load that chat. ${err.message}`,
      }]);
    }
  }, [loadSession, stopVoice]);

  const handleProjectChange = useCallback(async (event) => {
    const nextProjectId = event.target.value || '';

    setSelectedProjectId(nextProjectId);
    setRestoreAttempted(false);

    if (!nextProjectId) {
      await refreshGlobalSessions();
      return;
    }

    await refreshProjectSessions(nextProjectId);

    if (!sessionId || !messages.length) return;

    setLinkingProject(true);

    try {
      const currentProject = (state.projects || []).find(p => String(p.id) === String(nextProjectId));
      await linkSessionToProject({
        targetSessionId: sessionId,
        targetProjectId: nextProjectId,
        title: currentProject?.ref
          ? `${currentProject.ref} - ${messages[0]?.content?.slice(0, 42) || 'Project chat'}`
          : null,
      });

      await refreshProjectSessions(nextProjectId);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `I could not link this chat to the selected project. ${err.message}`,
      }]);
    } finally {
      setLinkingProject(false);
    }
  }, [
    sessionId,
    messages,
    state.projects,
    linkSessionToProject,
    refreshProjectSessions,
    refreshGlobalSessions,
  ]);

  const handleOpenInComposer = useCallback((draftOrOptions) => {
    if (typeof draftOrOptions === 'string') {
      onOpenComposer?.({ mode: 'compose', body: draftOrOptions });
      return;
    }

    onOpenComposer?.({ mode: 'compose', ...(draftOrOptions || {}) });
  }, [onOpenComposer]);

  const appendAssistantMessagesFromResult = useCallback((result, wantsDraft) => {
    if (!wantsDraft) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: result.reply || 'Done.',
        suggestedActions: result.suggestedActions,
      }]);
      return;
    }

    const raw = result.draft || result.documentText || result.reply || result.replyText || '';
    const { brief, draft, after } = splitAssistantResponse(raw);
    const newMessages = [];

    if (brief) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: brief,
        messageType: 'brief',
        suggestedActions: [],
        recipient: result.recipient,
        selectedAO: result.selectedAO,
        projectId: result.projectId || result.project_id || result.currentProject?.id || state.currentProject?.id || '',
      });
    }

    if (draft) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: draft,
        draft,
        draftType: result.draftType || 'email',
        messageType: 'draft',
        suggestedActions: [],
        recipient: result.recipient,
        selectedAO: result.selectedAO,
        projectId: result.projectId || result.project_id || result.currentProject?.id || state.currentProject?.id || '',
      });
      setLastDraft(draft);
    }

    if (after) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: after,
        messageType: 'brief',
        suggestedActions: [],
      });
    }

    if (!newMessages.length) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: result.reply || 'Done.',
        suggestedActions: result.suggestedActions,
      });
    }

    setMessages(prev => [...prev, ...newMessages]);
  }, [state.currentProject?.id]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg = { id: uid(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    try {
      const wantsDraft = isDraftRequest(text, !!lastDraft);

      const result = await send(text, {
        projectId: selectedProjectId || null,
        mainChatWorkflow: wantsDraft ? 'draft_clean_bubble_only' : 'general',
        context: {
          previousDraft: lastDraft || null,
          mainChatInstruction: wantsDraft
            ? 'Return the draft as clean final text only. Do not add commentary inside or after the draft. If you include an explanation, it must be separate from the draft.'
            : null,
        },
      });

      if (result.sessionId) {
        setActiveChatId(result.sessionId);
        try {
          localStorage.setItem(ACTIVE_SESSION_KEY, result.sessionId);
        } catch {}
      }

      appendAssistantMessagesFromResult(result, wantsDraft);

      if (selectedProjectId) {
        refreshProjectSessions(selectedProjectId);
      } else {
        refreshGlobalSessions();
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `Sorry, I couldn't process that. ${err.message}`,
      }]);
    }
  }, [
    input,
    loading,
    send,
    stopVoice,
    lastDraft,
    selectedProjectId,
    appendAssistantMessagesFromResult,
    refreshProjectSessions,
    refreshGlobalSessions,
  ]);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleVoice = (transcript) => {
    if (!voiceBaseRef.current) voiceBaseRef.current = input.trim();
    const base = voiceBaseRef.current;
    const next = base ? `${base} ${transcript}` : transcript;
    setInput(next);
    requestAnimationFrame(resizeTextarea);
    textareaRef.current?.focus();
  };

  const handleTextChange = (event) => {
    voiceBaseRef.current = '';
    setInput(event.target.value);
  };

  return (
    <div id="main-chat-overlay" className="ai-full-screen">
      <div className="ai-full-top">
        <button className="btn btn-ghost btn-sm" style={{ display: 'none' }} id="ai-full-mob-btn" onClick={() => setSidebarOpen(v => !v)}>
          ☰
        </button>

        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0,
        }}>
          ✨
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Ely</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            Practice Assistant {linkingProject ? ' - linking project...' : ''}
          </div>
        </div>

        <select
          value={selectedProjectId}
          onChange={handleProjectChange}
          disabled={loading || linkingProject}
          title="Link this chat to a project"
          style={{
            marginLeft: 'auto',
            minWidth: 220,
            maxWidth: 340,
            height: 32,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg2)',
            color: 'var(--text)',
            fontSize: 12,
            padding: '0 10px',
          }}
        >
          <option value="">Main chat - no project linked</option>
          {(state.projects || []).map(project => {
            const label = [
              project.ref || project.reference || project.project_ref,
              project.address || project.bo_premise_address || project.premise,
            ].filter(Boolean).join(' | ');

            return (
              <option key={project.id} value={project.id}>
                {label || project.id}
              </option>
            );
          })}
        </select>

        <button className="btn btn-sm" onClick={startNewChat}>
          + New chat
        </button>

        <button className="main-chat-close-btn" onClick={closeToDashboard} title="Close chat" aria-label="Close chat" type="button">
          ×
        </button>
      </div>

      <div className="ai-full-body">
        <div className={`ai-full-sidebar${sidebarOpen ? ' mob-open' : ''}`}>
          <div className="ai-full-sidebar-hdr">
            <span>{selectedProjectId ? 'Project chats' : 'History'}</span>
            <button className="btn btn-xs btn-ghost" onClick={startNewChat}>+ New</button>
          </div>

          {sessionsLoading ? (
            <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
              Loading chats...
            </div>
          ) : sortedSessions.length === 0 ? (
            <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
              No previous chats
            </div>
          ) : (
            sortedSessions.map(chat => (
              <div
                key={chat.id}
                className={`ai-sess-item${activeChatId === chat.id || sessionId === chat.id ? ' active' : ''}`}
                onClick={() => loadChat(chat)}
              >
                <div className="ai-sess-name">{sessionTitle(chat)}</div>
                <div className="ai-sess-date">{sessionDate(chat)}</div>
              </div>
            ))
          )}
        </div>

        <div className="ai-full-main">
          <div className="ai-full-msgs">
            {messages.length === 0 ? (
              <WelcomeScreen
                onSend={(text) => {
                  setInput(text);
                  requestAnimationFrame(resizeTextarea);
                }}
                userName={state.currentUser?.email?.split('@')[0] || state.settings.name}
              />
            ) : (
              messages.map(msg => (
                <ChatMessage
                  key={msg.id}
                  msg={msg}
                  onUseDraft={(draft) => {
                    setInput(draft);
                    requestAnimationFrame(resizeTextarea);
                  }}
                  onOpenInComposer={handleOpenInComposer}
                />
              ))
            )}

            {loading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-full-input">
            <div className="ai-input-row main-chat-input-row" style={{ alignItems: 'flex-end' }}>
              <VoiceInput onTranscript={handleVoice} disabled={loading} stopSignal={voiceStopSignal} />

              <textarea
                ref={textareaRef}
                className="ai-textarea"
                value={input}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder={selectedProjectId ? 'Ask Ely about this linked project...' : 'Ask Ely anything about party wall, your projects, or drafting...'}
                rows={1}
                style={{ minHeight: 38, maxHeight: 140, overflowY: 'hidden', resize: 'none', lineHeight: 1.5 }}
              />

              <button className="main-chat-send-btn" onClick={handleSend} disabled={loading || !input.trim()} type="button" aria-label="Send message" title="Send">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </div>

            <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>
              {selectedProjectId ? 'This chat is linked to the selected project.' : 'AI can make mistakes. Always verify professional advice.'}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .main-chat-close-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 0;
          background: transparent;
          color: var(--text3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          margin-left: 6px;
          padding: 0;
        }

        .main-chat-close-btn:hover {
          background: var(--bg3);
          color: var(--text);
        }

        .main-chat-send-btn {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 0;
          background: var(--blue);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          padding: 0;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.24);
        }

        .main-chat-send-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
        }

        .main-chat-input-row .voice-btn {
          width: 38px !important;
          height: 38px !important;
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
          color: #9ca3af !important;
        }

        .main-chat-input-row .voice-btn.listening,
        .main-chat-input-row .voice-btn.recording {
          color: #ef4444 !important;
        }

        .main-chat-input-row .voice-btn svg,
        .main-chat-input-row .voice-btn svg * {
          stroke-width: 1.65 !important;
        }

        .main-chat-input-row .voice-btn:hover {
          color: #6b7280 !important;
        }

        .main-chat-input-row .voice-btn.listening:hover,
        .main-chat-input-row .voice-btn.recording:hover {
          color: #dc2626 !important;
        }

        .chat-msg.ely.draft-only {
          background: #ffffff;
          border: 1px solid var(--border);
        }

        .ely-md ul {
          margin: 8px 0 8px 18px;
        }

        .ely-md li {
          margin: 4px 0;
        }

        @media (max-width: 820px) {
          .ai-full-top select {
            min-width: 120px !important;
            max-width: 160px !important;
          }
        }
      `}</style>
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
  const suggestions = [
    'What are my active party wall cases?',
    'Draft a section 10 consent letter',
    'What are the current statutory timescales?',
    'Help me draft an award',
    'Find the latest email from my client',
    'What is the Act?',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 16 }}>✨</div>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
        Hello{userName ? `, ${userName}` : ''}!
      </h2>

      <p style={{ color: 'var(--text2)', fontSize: 13.5, marginBottom: 28, maxWidth: 400, lineHeight: 1.6 }}>
        I'm Ely, your party wall practice assistant. I can help with legal questions, drafting documents, searching your emails, and managing your cases.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 540 }}>
        {suggestions.map((suggestion, i) => (
          <button key={i} className="btn btn-sm" onClick={() => onSend(suggestion)} style={{ borderRadius: 99 }}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
