import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage from './ChatMessage';
import VoiceInput from '../shared/VoiceInput';
import { uid } from '../../utils/formatters';
import sb from '../../supabaseClient';

function safeProjectKey(projectId) {
  return String(projectId || 'no-project').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sessionStorageKey(projectId) {
  return `ely_project_chat_sessions_${safeProjectKey(projectId)}`;
}

function activeStorageKey(projectId) {
  return `ely_project_chat_active_${safeProjectKey(projectId)}`;
}

function makeSessionTitle(messages = [], fallback = 'Project chat') {
  const firstUser = messages.find(m => m.role === 'user' && String(m.content || '').trim());
  const raw = firstUser?.content || fallback;
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, 52) || fallback;
}

function formatSessionDate(value) {
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

function sortNewestFirst(items = []) {
  return [...items].sort((a, b) => {
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bt - at;
  });
}

function fileSizeLabel(bytes = 0) {
  const n = Number(bytes || 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 1024 / 102.4) / 10} MB`;
}

function safeFileName(name = 'file') {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 160);
}

function getUserId(state = {}) {
  return (
    state.user?.id ||
    state.user?.email ||
    state.currentUser?.id ||
    state.currentUser?.email ||
    'itzy212@gmail.com'
  );
}

export default function ProjectChat({ project, onOpenComposer, onClose }) {
  const { state } = useApp();

  const projectId = project?.id || '';
  const projectLabel = project?.ref || project?.name || project?.bo_premise_address || 'Project';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() => uid());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');
  const fileInputRef = useRef(null);

  const { send, loading, resetSession } = useEly({
    surface: 'project_chat',
    projectId,
  });

  const QUICK_TAGS = [
    'Summarise this case',
    'Draft a response letter',
    'What are the next steps?',
    'Check statutory deadlines',
    'Review surveyor details',
  ];

  useEffect(() => {
    if (!projectId) return;

    try {
      const savedSessions = JSON.parse(localStorage.getItem(sessionStorageKey(projectId)) || '[]');
      const savedActive = JSON.parse(localStorage.getItem(activeStorageKey(projectId)) || 'null');

      setSessions(sortNewestFirst(Array.isArray(savedSessions) ? savedSessions : []));

      if (savedActive?.messages?.length) {
        setActiveSessionId(savedActive.id || uid());
        setMessages(savedActive.messages || []);
      } else {
        setActiveSessionId(uid());
        setMessages([]);
      }
    } catch {
      setSessions([]);
      setMessages([]);
      setActiveSessionId(uid());
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    try {
      const payload = {
        id: activeSessionId,
        projectId,
        title: makeSessionTitle(messages, projectLabel),
        messages,
        createdAt: messages[0]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      localStorage.setItem(activeStorageKey(projectId), JSON.stringify(payload));
    } catch {
      // localStorage failures should never break chat
    }
  }, [messages, activeSessionId, projectId, projectLabel]);

  useEffect(() => {
    if (!projectId) return;

    try {
      localStorage.setItem(sessionStorageKey(projectId), JSON.stringify(sortNewestFirst(sessions).slice(0, 30)));
    } catch {
      // localStorage failures should never break chat
    }
  }, [sessions, projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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

  const persistCurrentSessionToHistory = useCallback(() => {
    if (!messages.length) return;

    const now = new Date().toISOString();

    const session = {
      id: activeSessionId || uid(),
      projectId,
      name: makeSessionTitle(messages, projectLabel),
      title: makeSessionTitle(messages, projectLabel),
      messages,
      date: formatSessionDate(now),
      createdAt: messages[0]?.createdAt || now,
      updatedAt: now,
    };

    setSessions(prev => {
      const withoutCurrent = (prev || []).filter(s => s.id !== session.id);
      return sortNewestFirst([session, ...withoutCurrent]).slice(0, 30);
    });
  }, [messages, activeSessionId, projectId, projectLabel]);

  const startNew = useCallback(() => {
    stopVoice();
    persistCurrentSessionToHistory();

    const nextId = uid();
    setActiveSessionId(nextId);
    setMessages([]);
    setInput('');
    setAttachments([]);
    setUploadError('');
    resetSession();

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      localStorage.removeItem(activeStorageKey(projectId));
    } catch {
      // ignore
    }
  }, [persistCurrentSessionToHistory, projectId, resetSession, stopVoice]);

  const loadSession = useCallback((session) => {
    if (!session) return;

    stopVoice();
    setActiveSessionId(session.id || uid());
    setMessages(Array.isArray(session.messages) ? session.messages : []);
    setSidebarOpen(false);
    setInput('');
    setAttachments([]);
    setUploadError('');
    resetSession();
  }, [resetSession, stopVoice]);

  const deleteSession = useCallback((sessionId, e) => {
    e?.stopPropagation?.();

    setSessions(prev => (prev || []).filter(s => s.id !== sessionId));
  }, []);

  const createProjectMemoryForUpload = useCallback(async (fileRecord) => {
    if (!projectId || !fileRecord) return;

    try {
      await sb.from('project_memory').insert({
        project_id: String(projectId),
        source_type: 'chat_upload',
        source_id: fileRecord.upload_id || fileRecord.storage_path || fileRecord.id || fileRecord.file_name,
        title: fileRecord.file_name,
        summary: `File uploaded to project chat: ${fileRecord.file_name}${fileRecord.mime_type ? ` (${fileRecord.mime_type})` : ''}.`,
        content: fileRecord.extracted_text || '',
        entities: [],
        metadata: {
          project_id: projectId,
          session_id: activeSessionId,
          file_name: fileRecord.file_name,
          mime_type: fileRecord.mime_type,
          file_size: fileRecord.file_size,
          storage_path: fileRecord.storage_path,
          upload_status: fileRecord.upload_status,
        },
        unresolved_items: [],
        importance_score: 40,
      });
    } catch (err) {
      console.warn('[ProjectChat] project_memory upload insert failed:', err?.message || err);
    }
  }, [activeSessionId, projectId]);

  const handleFilesSelected = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!files.length || uploading) return;

    setUploading(true);
    setUploadError('');

    const pending = files.map(file => ({
      id: uid(),
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      upload_status: 'uploading',
      storage_path: '',
      created_at: new Date().toISOString(),
    }));

    setAttachments(prev => [...prev, ...pending]);

    const completed = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const pendingRecord = pending[i];

      const storagePath = [
        'project-chat',
        safeProjectKey(projectId),
        activeSessionId || 'session',
        `${Date.now()}_${safeFileName(file.name)}`,
      ].join('/');

      let finalRecord = {
        ...pendingRecord,
        storage_path: storagePath,
      };

      try {
        const { error: storageError } = await sb.storage
          .from('chat-uploads')
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'application/octet-stream',
          });

        if (storageError) {
          throw storageError;
        }

        const { data: uploadRow, error: rowError } = await sb
          .from('chat_uploads')
          .insert({
            user_id: getUserId(state),
            project_id: projectId || null,
            session_id: activeSessionId,
            chat_type: 'project_chat',
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size || 0,
            storage_path: storagePath,
            upload_status: 'uploaded',
            is_temporary: false,
            permanent_context: true,
            document_kind: 'project_chat_upload',
            metadata: {
              source: 'ProjectChat',
              project_id: projectId,
              project_ref: project?.ref || null,
            },
          })
          .select('id,storage_path,file_name,mime_type,file_size,upload_status')
          .single();

        if (rowError) {
          throw rowError;
        }

        finalRecord = {
          ...finalRecord,
          upload_id: uploadRow?.id,
          storage_path: uploadRow?.storage_path || storagePath,
          upload_status: 'uploaded',
        };

        await createProjectMemoryForUpload(finalRecord);

        completed.push(finalRecord);
      } catch (err) {
        finalRecord = {
          ...finalRecord,
          upload_status: 'failed',
          error: err?.message || 'Upload failed',
        };

        setUploadError(err?.message || 'Upload failed');
        completed.push(finalRecord);
      }

      setAttachments(prev => prev.map(item => (
        item.id === pendingRecord.id ? finalRecord : item
      )));
    }

    const uploadedNames = completed
      .filter(item => item.upload_status === 'uploaded')
      .map(item => item.file_name);

    if (uploadedNames.length) {
      const note = `Uploaded file${uploadedNames.length > 1 ? 's' : ''}: ${uploadedNames.join(', ')}`;
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'user',
        content: note,
        createdAt: new Date().toISOString(),
        attachments: completed.filter(item => item.upload_status === 'uploaded'),
      }]);
    }

    setUploading(false);
  }, [activeSessionId, createProjectMemoryForUpload, project, projectId, state, uploading]);

  const removeAttachment = useCallback((attachmentId) => {
    setAttachments(prev => prev.filter(item => item.id !== attachmentId));
  }, []);

  const handleSend = useCallback(async (text) => {
    const msg = (text || input).trim();
    const readyAttachments = attachments.filter(a => a.upload_status === 'uploaded');

    if ((!msg && !readyAttachments.length) || loading || uploading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const messageText = msg || 'Please review the uploaded file(s).';

    const userMsg = {
      id: uid(),
      role: 'user',
      content: messageText,
      createdAt: new Date().toISOString(),
      attachments: readyAttachments,
    };

    setMessages(prev => [...prev, userMsg]);

    try {
      const result = await send(messageText, {
        projectId,
        project,
        attachments: readyAttachments,
        uploadContext: readyAttachments,
        projectContext: project,
      });

      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: result.reply,
        draft: result.draft,
        draftType: result.draftType,
        suggestedActions: result.suggestedActions,
        createdAt: new Date().toISOString(),
      }]);

      setAttachments(prev => prev.filter(a => a.upload_status !== 'uploaded'));
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `Error: ${err.message}`,
        createdAt: new Date().toISOString(),
      }]);
    }
  }, [attachments, input, loading, project, projectId, send, stopVoice, uploading]);

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
    persistCurrentSessionToHistory();
    onClose?.();
  };

  return (
    <div id="proj-chat-full" style={{
      display: 'flex',
      position: 'fixed',
      inset: 0,
      zIndex: 260,
      background: 'var(--bg)',
      flexDirection: 'column',
    }}>
      <div className="pch-topbar" style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg2)',
        flexShrink: 0,
      }}>
        <button
          id="pch-sessions-btn"
          className="btn btn-ghost btn-sm"
          onClick={() => setSidebarOpen(v => !v)}
          title="Chat history"
        >
          ☰
        </button>

        <button className="btn btn-ghost btn-sm" onClick={handleClose}>← Back</button>

        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Chat - {projectLabel}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {project?.address || project?.bo_premise_address || project?.ao_premise_address || ''}
          </div>
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
        {sidebarOpen && (
          <div className="pch-sidebar mob-open" style={{
            width: 260,
            minWidth: 260,
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg2)',
            overflowY: 'auto',
          }}>
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span>Project chat history</span>
              <button className="btn btn-xs btn-ghost" onClick={startNew}>+ New</button>
            </div>

            {sessions.length === 0 ? (
              <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text3)' }}>
                No saved sessions yet
              </div>
            ) : sessions.map(s => (
              <button
                key={s.id}
                type="button"
                className="pch-session-item"
                onClick={() => loadSession(s)}
                style={{
                  textAlign: 'left',
                  border: 0,
                  borderBottom: '1px solid var(--border)',
                  background: s.id === activeSessionId ? 'var(--bg3)' : 'transparent',
                  color: 'var(--text)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div className="pch-session-name" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                  {s.name || s.title || 'Session'}
                </div>
                <div className="pch-session-date" style={{ fontSize: 10.5, color: 'var(--text3)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{formatSessionDate(s.updatedAt || s.createdAt) || s.date}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => deleteSession(s.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') deleteSession(s.id, e);
                    }}
                    style={{ color: 'var(--text3)' }}
                  >
                    ×
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text3)' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
                <div style={{ fontSize: 13 }}>Ask Ely about this project</div>
                <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text3)' }}>
                  Ely can use linked emails, project memory, uploaded files and this chat history for {projectLabel}.
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id}>
                <ChatMessage
                  msg={msg}
                  onUseDraft={(draft) => {
                    setInput(draft);
                    requestAnimationFrame(resizeTextarea);
                  }}
                  onOpenInComposer={(draft) => onOpenComposer?.({
                    mode: 'compose',
                    body: draft,
                    projectId,
                  })}
                />

                {msg.attachments?.length > 0 && (
                  <div style={{ marginLeft: msg.role === 'user' ? 'auto' : 0, maxWidth: 620, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {msg.attachments.map(file => (
                      <span
                        key={file.id || file.upload_id || file.storage_path}
                        style={{
                          fontSize: 11,
                          border: '1px solid var(--border)',
                          background: 'var(--bg3)',
                          borderRadius: 999,
                          padding: '4px 8px',
                          color: 'var(--text3)',
                        }}
                      >
                        📎 {file.file_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{
                display: 'flex',
                gap: 4,
                padding: '10px 14px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                borderBottomLeftRadius: 4,
                alignSelf: 'flex-start',
              }}>
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--blue)',
                      animation: 'blink 1.2s infinite',
                      animationDelay: `${i * 0.2}s`,
                    }}
                  />
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
            {(attachments.length > 0 || uploadError) && (
              <div style={{
                marginBottom: 8,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
              }}>
                {attachments.map(file => (
                  <span
                    key={file.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11.5,
                      border: '1px solid var(--border)',
                      background: file.upload_status === 'failed' ? 'rgba(255,0,0,0.08)' : 'var(--bg3)',
                      borderRadius: 999,
                      padding: '5px 8px',
                      color: 'var(--text3)',
                    }}
                  >
                    <span>📎 {file.file_name}</span>
                    <span>{file.upload_status === 'uploading' ? 'uploading...' : fileSizeLabel(file.file_size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(file.id)}
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: 'var(--text3)',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}

                {uploadError && (
                  <span style={{ color: '#b42318', fontSize: 11.5 }}>
                    Upload issue: {uploadError}
                  </span>
                )}
              </div>
            )}

            <div className="pch-input-row" style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '8px 10px',
            }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.heic,.webp,image/*,application/pdf"
                onChange={handleFilesSelected}
                style={{ display: 'none' }}
              />

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploading}
                title="Upload file to this project chat"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  padding: 0,
                  fontSize: 20,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                +
              </button>

              <VoiceInput onTranscript={handleVoice} disabled={loading || uploading} stopSignal={voiceStopSignal} />

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

              <button
                className="ai-send-btn"
                onClick={() => handleSend()}
                disabled={loading || uploading || (!input.trim() && !attachments.some(a => a.upload_status === 'uploaded'))}
              >
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
