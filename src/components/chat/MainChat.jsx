import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage, { normaliseDraftText } from './ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import DictationOverlay from '../shared/DictationOverlay';
import { uid } from '../../utils/formatters';
import sb from '../../supabaseClient';

const ACTIVE_SESSION_KEY = 'ely_main_chat_active_session_id';
const ACTIVE_PROJECT_KEY = 'ely_main_chat_selected_project_id';
const ACTIVE_EMAIL_KEY = 'ely_main_chat_selected_email_id';

function first(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '') || '';
}

function getEmailId(email = {}) {
  return first(email.id, email.email_id, email.message_id, email.external_id, email.outlook_id, email.internet_message_id);
}

function getThreadId(email = {}) {
  return first(email.thread_id, email.conversation_id, email.conversationId, email.graph_conversation_id, email.internet_thread_id);
}

function getEmailDateValue(email = {}) {
  const value = first(email.received_at, email.sent_at, email.date, email.created_at, email.updated_at);
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function getEmailDateLabel(email = {}) {
  const value = first(email.received_at, email.sent_at, email.date, email.created_at, email.updated_at);
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

function getEmailFromLabel(email = {}) {
  return first(email.from_name, email.sender_name, email.from, email.from_email, email.sender_email, email.email_from);
}

function getEmailSubject(email = {}) {
  return first(email.subject, email.title, '(no subject)');
}

function getEmailPreview(email = {}) {
  return first(email.body_preview, email.preview, email.snippet, email.body_text, email.text_body, email.body);
}

function buildEmailContext(email = null) {
  if (!email) return null;

  return {
    id: getEmailId(email),
    emailId: getEmailId(email),
    threadId: getThreadId(email),
    conversationId: getThreadId(email),
    projectId: first(email.project_id, email.projectId),
    subject: getEmailSubject(email),
    from: first(email.from_email, email.sender_email, email.email_from, email.from),
    fromName: first(email.from_name, email.sender_name, email.from),
    to: email.to || email.to_email || email.recipients || [],
    cc: email.cc || email.cc_email || email.cc_recipients || [],
    date: first(email.received_at, email.sent_at, email.date, email.created_at),
    preview: getEmailPreview(email),
    body: first(email.body_text, email.text_body, email.body, email.html_body, email.body_html, email.content),
    hasAttachment: !!(email.has_attachment || email.hasAttachments || email.attachments?.length),
    attachments: email.attachments || email.email_attachments || [],
    raw: email,
  };
}

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


function isMobileVoiceBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function projectLabel(project = {}) {
  return first(
    project.appointment_address,
    project.address,
    project.bo_premise_address,
    project.premise,
    project.works_address
  ) || project.id || 'Unnamed project';
}

function cleanVoiceWord(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"“”‘’]/g, '')
    .trim();
}

function cleanVoiceTranscript(value = '') {
  let words = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  words = words.filter((word, index) => {
    if (index === 0) return true;
    return cleanVoiceWord(word) !== cleanVoiceWord(words[index - 1]);
  });

  let changed = true;

  while (changed) {
    changed = false;

    for (let size = Math.min(10, Math.floor(words.length / 2)); size >= 2; size -= 1) {
      const output = [];

      for (let i = 0; i < words.length; i += 1) {
        const previous = output.slice(-size).map(cleanVoiceWord).join(' ');
        const current = words.slice(i, i + size).map(cleanVoiceWord).join(' ');

        if (previous && current && previous === current) {
          i += size - 1;
          changed = true;
          continue;
        }

        output.push(words[i]);
      }

      words = output;
    }
  }

  return words.join(' ').trim();
}

function mergeVoiceWithBase(base = '', transcript = '') {
  const cleanBase = cleanVoiceTranscript(base);
  const cleanTranscript = cleanVoiceTranscript(transcript);

  if (!cleanBase) return cleanTranscript;
  if (!cleanTranscript) return cleanBase;

  const baseLower = cleanBase.toLowerCase();
  const transcriptLower = cleanTranscript.toLowerCase();

  if (transcriptLower.startsWith(baseLower)) return cleanTranscript;
  if (baseLower.endsWith(transcriptLower)) return cleanBase;

  return cleanVoiceTranscript(`${cleanBase} ${cleanTranscript}`);
}

function emailLabel(email = {}) {
  const from = getEmailFromLabel(email);
  const subject = getEmailSubject(email);
  const date = getEmailDateLabel(email);

  return [from, subject, date].filter(Boolean).join(' | ');
}

export default function MainChat({ onOpenComposer, onClose }) {
  const { state } = useApp();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [voicePhase, setVoicePhase] = useState('idle');
  const [liveTop, setLiveTop] = useState('');
  const [liveBottom, setLiveBottom] = useState('');
  const [activeChatId, setActiveChatId] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_PROJECT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [selectedEmailId, setSelectedEmailId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_EMAIL_KEY) || '';
    } catch {
      return '';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [lastDraft, setLastDraft] = useState('');
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [linkingProject, setLinkingProject] = useState(false);
  const [localEmails, setLocalEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');
  const prevPhraseRef = useRef('');
  const latestTranscriptRef = useRef('');

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

  const loadMainChatEmails = useCallback(async () => {
    if (!sb) return [];

    setEmailsLoading(true);

    try {
      const { data, error } = await sb
        .from('emails')
        .select('*')
        .or('is_draft.is.null,is_draft.eq.false')
        .order('received_at', { ascending: false, nullsFirst: false })
        .limit(500);

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      setLocalEmails(rows);
      return rows;
    } catch (err) {
      console.warn('[MainChat] loadMainChatEmails failed:', err?.message || err);
      setLocalEmails([]);
      return [];
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMainChatEmails();
  }, [loadMainChatEmails]);

  const allEmails = useMemo(() => {
    const direct = Array.isArray(state.emails) ? state.emails : [];
    const inbox = Array.isArray(state.inboxEmails) ? state.inboxEmails : [];
    const sent = Array.isArray(state.sentEmails) ? state.sentEmails : [];
    const projectEmails = Array.isArray(state.projectEmails) ? state.projectEmails : [];
    const fetched = Array.isArray(localEmails) ? localEmails : [];

    const byId = new Map();

    [...fetched, ...direct, ...inbox, ...sent, ...projectEmails].forEach(email => {
      const id = getEmailId(email);
      if (!id) return;
      byId.set(String(id), email);
    });

    return Array.from(byId.values()).sort((a, b) => getEmailDateValue(b) - getEmailDateValue(a));
  }, [localEmails, state.emails, state.inboxEmails, state.sentEmails, state.projectEmails]);

  const filteredEmails = useMemo(() => {
    if (!selectedProjectId) return allEmails.slice(0, 100);

    const projectMatches = allEmails.filter(email => {
      const emailProjectId = first(email.project_id, email.projectId);
      return String(emailProjectId) === String(selectedProjectId);
    });

    return (projectMatches.length ? projectMatches : allEmails).slice(0, 100);
  }, [allEmails, selectedProjectId]);

  const selectedEmail = useMemo(() => {
    if (!selectedEmailId) return null;
    return allEmails.find(email => String(getEmailId(email)) === String(selectedEmailId)) || null;
  }, [allEmails, selectedEmailId]);

  const selectedEmailContext = useMemo(() => buildEmailContext(selectedEmail), [selectedEmail]);

  const sortedSessions = useMemo(() => {
    const source = selectedProjectId ? projectSessions : globalSessions;
    return sortSessionsNewestFirst(source);
  }, [selectedProjectId, projectSessions, globalSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
      if (selectedEmailId) {
        localStorage.setItem(ACTIVE_EMAIL_KEY, selectedEmailId);
      } else {
        localStorage.removeItem(ACTIVE_EMAIL_KEY);
      }
    } catch {}
  }, [selectedEmailId]);

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
    if (!selectedEmailId) return;
    const stillExists = allEmails.some(email => String(getEmailId(email)) === String(selectedEmailId));
    if (!stillExists) setSelectedEmailId('');
  }, [allEmails, selectedEmailId]);

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
    prevPhraseRef.current = '';
    latestTranscriptRef.current = '';
    setVoicePhase('idle');
    setLiveTop('');
    setLiveBottom('');
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

  const handleEmailChange = useCallback((event) => {
    const nextEmailId = event.target.value || '';
    setSelectedEmailId(nextEmailId);
  }, []);

  const handleOpenInComposer = useCallback((draftOrOptions) => {
    if (typeof draftOrOptions === 'string') {
      onOpenComposer?.({
        mode: selectedEmailContext ? 'reply' : 'compose',
        body: draftOrOptions,
        emailContext: selectedEmailContext,
        emailId: selectedEmailContext?.emailId || null,
        threadId: selectedEmailContext?.threadId || null,
      });
      return;
    }

    onOpenComposer?.({
      mode: selectedEmailContext ? 'reply' : 'compose',
      emailContext: selectedEmailContext,
      emailId: selectedEmailContext?.emailId || null,
      threadId: selectedEmailContext?.threadId || null,
      ...(draftOrOptions || {}),
    });
  }, [onOpenComposer, selectedEmailContext]);

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
        emailContext: selectedEmailContext,
      });
    }

    if (draft) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: draft,
        draft,
        draftType: result.draftType || (selectedEmailContext ? 'reply' : 'email'),
        messageType: 'draft',
        suggestedActions: [],
        recipient: result.recipient,
        selectedAO: result.selectedAO,
        projectId: result.projectId || result.project_id || result.currentProject?.id || state.currentProject?.id || '',
        emailContext: selectedEmailContext,
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
  }, [state.currentProject?.id, selectedEmailContext]);

  const handleSend = useCallback(async (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim();
    if (!text || loading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg = {
      id: uid(),
      role: 'user',
      content: text,
      projectId: selectedProjectId || null,
      emailContext: selectedEmailContext,
    };

    setMessages(prev => [...prev, userMsg]);

    try {
      const wantsDraft = isDraftRequest(text, !!lastDraft);

      const result = await send(text, {
        projectId: selectedProjectId || null,
        emailContext: selectedEmailContext,
        emailId: selectedEmailContext?.emailId || null,
        threadId: selectedEmailContext?.threadId || null,
        mainChatWorkflow: wantsDraft ? 'draft_clean_bubble_only' : 'general',
        context: {
          previousDraft: lastDraft || null,
          selectedEmailContext,
          selectedEmailId: selectedEmailContext?.emailId || null,
          selectedThreadId: selectedEmailContext?.threadId || null,
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
    selectedEmailContext,
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

  const handleVoice = (transcript, meta) => {
    if (!meta?.recording && transcript) {
      // Mobile Whisper final result — put straight into input
      latestTranscriptRef.current = transcript;
      setInput(transcript);
      setVoicePhase('idle');
      return;
    }
    if (transcript) latestTranscriptRef.current = transcript;
  };

  const handleVoicePreview = (phrase, meta) => {
    if (meta?.recording === false) {
      if (latestTranscriptRef.current) {
        // Desktop: populate input with accumulated transcript
        setInput(latestTranscriptRef.current);
        setVoicePhase('idle');
      } else if (voicePhase !== 'idle') {
        // Mobile: recording stopped, Whisper still processing
        setVoicePhase('transcribing');
      }
      setLiveTop('');
      setLiveBottom('');
      prevPhraseRef.current = '';
      return;
    }
    if (meta?.recording === true) {
      setVoicePhase('recording');
      // Only update live display for real speech text, not mobile status messages
      if (phrase && !phrase.includes('Recording')) {
        setLiveTop(prevPhraseRef.current);
        setLiveBottom(phrase);
        prevPhraseRef.current = phrase;
      }
    }
  };

  const handleTextChange = (event) => {
    voiceBaseRef.current = '';
    setInput(event.target.value);
  };

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return (state.projects || []).find(project => String(project.id) === String(selectedProjectId)) || null;
  }, [state.projects, selectedProjectId]);

  return (
    <div id="main-chat-overlay" className="ai-full-screen">
      <div className="ai-full-top">
        {/* Burger — opens chat history sidebar */}
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 8px', fontSize: 18, lineHeight: 1, flexShrink: 0 }}
          onClick={() => setSidebarOpen(v => !v)}
          title="Chat history"
        >
          ☰
        </button>

        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0,
        }}>
          ✨
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Ely</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedProject
              ? projectLabel(selectedProject)
              : linkingProject ? 'Linking project...' : 'Practice Assistant'}
          </div>
        </div>

        <button className="btn btn-sm" onClick={startNewChat} style={{ flexShrink: 0, fontSize: 12, padding: '4px 10px' }}>
          + New
        </button>

        <button className="main-chat-close-btn" onClick={closeToDashboard} title="Close chat" aria-label="Close chat" type="button" style={{ flexShrink: 0 }}>
          ×
        </button>
      </div>

      {/* Context bar — project + email selectors, hidden on mobile unless expanded */}
      <div className="main-chat-context-selectors">
        <select
          value={selectedProjectId}
          onChange={handleProjectChange}
          disabled={loading || linkingProject}
          title="Link this chat to a project"
          className="main-chat-select"
        >
          <option value="">No project linked</option>
          {(state.projects || []).map(project => (
            <option key={project.id} value={project.id}>
              {projectLabel(project)}
            </option>
          ))}
        </select>

        <select
          value={selectedEmailId}
          onChange={handleEmailChange}
          disabled={loading || emailsLoading || !filteredEmails.length}
          title="Attach an email or thread to this chat"
          className="main-chat-select main-chat-email-select"
        >
          <option value="">
            {emailsLoading ? 'Loading emails...' : filteredEmails.length ? 'No email linked' : 'No emails'}
          </option>
          {filteredEmails.map(email => {
            const id = getEmailId(email);
            return (
              <option key={id} value={id}>
                {emailLabel(email)}
              </option>
            );
          })}
        </select>

        <button
          className="main-chat-email-refresh-btn"
          type="button"
          onClick={loadMainChatEmails}
          disabled={emailsLoading || loading}
          title="Refresh email list"
        >
          {emailsLoading ? '…' : '↻'}
        </button>
      </div>

      {(selectedProject || selectedEmailContext) && (
        <div className="main-chat-context-bar">
          {selectedProject && (
            <span>
              Linked: <strong>{projectLabel(selectedProject)}</strong>
            </span>
          )}
          {selectedEmailContext && (
            <span>
              Thread: <strong>{selectedEmailContext.subject}</strong>
              {selectedEmailContext.fromName || selectedEmailContext.from ? ` from ${selectedEmailContext.fromName || selectedEmailContext.from}` : ''}
            </span>
          )}
        </div>
      )}

      <div className="ai-full-body">
        {sidebarOpen && (
          <div className="ai-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
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
                userName={state.currentUser?.email?.split('@')[0] || state.settings?.name}
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
            {((!isMobileVoiceBrowser() && voicePhase === 'recording') || voicePhase === 'transcribing') && (
              <DictationOverlay
                phase={voicePhase}
                topLine={liveTop}
                bottomLine={liveBottom}
              />
            )}
            <div className="ai-input-row main-chat-input-row" style={{ alignItems: 'flex-end' }}>
              <VoiceInput onTranscript={handleVoice} onPreview={handleVoicePreview} disabled={loading} stopSignal={voiceStopSignal} />
              <textarea
                ref={textareaRef}
                className="ai-textarea"
                value={input}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedEmailContext
                    ? 'Ask Ely about the selected email thread, or draft a reply...'
                    : selectedProjectId
                      ? 'Ask Ely about this linked project...'
                      : 'Ask Ely anything about party wall, your projects, or drafting...'
                }
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
              {selectedEmailContext
                ? 'This message will include the selected email thread context.'
                : selectedProjectId
                  ? 'This chat is linked to the selected project.'
                  : 'AI can make mistakes. Always verify professional advice.'}
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

        .main-chat-selectors {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .main-chat-select {
          min-width: 210px;
          max-width: 320px;
          height: 32px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg2);
          color: var(--text);
          font-size: 12px;
          padding: 0 10px;
        }

        .main-chat-email-select {
          min-width: 240px;
          max-width: 380px;
        }

        .main-chat-email-refresh-btn {
          height: 32px;
          width: 34px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg2);
          color: var(--text2);
          font-size: 14px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .main-chat-email-refresh-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .main-chat-upload-placeholder {
          height: 32px;
          border-radius: 10px;
          border: 1px dashed var(--border);
          background: var(--bg2);
          color: var(--text3);
          font-size: 12px;
          padding: 0 10px;
          cursor: not-allowed;
          opacity: 0.65;
        }

        .main-chat-context-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          align-items: center;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--bg2);
          color: var(--text2);
          font-size: 11.5px;
        }

        .main-chat-context-bar span {
          display: inline-flex;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .main-chat-context-bar strong {
          color: var(--text);
          font-weight: 600;
          margin-left: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
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

        @media (max-width: 1100px) {
          .main-chat-selectors {
            flex: 1;
          }

          .main-chat-select {
            min-width: 160px;
            max-width: 240px;
          }

          .main-chat-email-select {
            min-width: 170px;
            max-width: 260px;
          }
        }

        @media (max-width: 820px) {
          .ai-full-top {
            gap: 8px;
          }

          .main-chat-selectors {
            order: 10;
            width: 100%;
            flex-basis: 100%;
            margin-left: 0;
          }

          .main-chat-select {
            min-width: 0 !important;
            max-width: none !important;
            flex: 1;
          }

          .main-chat-email-select {
            min-width: 0 !important;
            max-width: none !important;
          }

          .main-chat-upload-placeholder {
            display: none;
          }

          .main-chat-email-refresh-btn {
            width: 32px;
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


