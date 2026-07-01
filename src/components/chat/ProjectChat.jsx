import { useState, useRef, useEffect, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import { useApp } from '../../state/appStore';
import ChatMessage, { parseAoSubjectRef } from './ChatMessage';
import UnifiedVoice from '../shared/UnifiedVoice';
import VoiceInput from '../shared/VoiceInput';
import DictationOverlay from '../shared/DictationOverlay';
import { uid } from '../../utils/formatters';
import { supabase } from '../../supabaseClient';

// ── Project brain helpers ─────────────────────────────────────────────────

async function saveToBrain(projectId, sessionId, role, content, contentType = 'message', fileName = null) {
  if (!projectId || !content) return;
  try {
    await supabase.from('project_brain').insert({
      project_id: projectId,
      session_id: sessionId,
      role,
      content: String(content).slice(0, 6000),
      content_type: contentType,
      file_name: fileName || null,
    });

    // Trigger summarisation in background when threshold reached
    maybeSummarise(projectId);
  } catch {
    // brain save failures must never break chat
  }
}

async function maybeSummarise(projectId) {
  if (!projectId) return;
  try {
    const { count } = await supabase
      .from('project_brain')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('is_summary', false);

    if ((count || 0) > 40) {
      // Fire and forget — don't await, don't block chat
      fetch('/api/summarise-project-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      }).catch(() => {});
    }
  } catch {
    // never block chat
  }
}

async function loadBrainContext(projectId, limit = 20) {
  if (!projectId) return [];
  try {
    // Always get the summary first if it exists
    const { data: summary } = await supabase
      .from('project_brain')
      .select('role, content, content_type, file_name, created_at, is_summary')
      .eq('project_id', projectId)
      .eq('is_summary', true)
      .limit(1);

    // Then get most recent non-summary entries
    const { data: recent } = await supabase
      .from('project_brain')
      .select('role, content, content_type, file_name, created_at, is_summary')
      .eq('project_id', projectId)
      .eq('is_summary', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    const summaryEntry = summary?.[0] ? [summary[0]] : [];
    const recentEntries = (recent || []).reverse();

    return [...summaryEntry, ...recentEntries];
  } catch {
    return [];
  }
}

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


function isDraftRequest(text = '', hasPreviousDraft = false) {
  const s = String(text || '').toLowerCase();

  const draftWords = [
    'draft',
    'write',
    'email',
    'letter',
    'compose',
    'covering',
    'respond',
    'reply',
    'wording',
    'whatsapp',
    'text message',
    'inline',
    'point by point',
    'line by line',
    'paste.*points',
    'respond.*each',
  ];

  const editWords = [
    'change',
    'amend',
    'revise',
    'rewrite',
    'update',
    'make it',
    'add',
    'remove',
    'replace',
    'shorter',
    'firmer',
    'softer',
    'more formal',
    'less formal',
  ];

  if (draftWords.some(word => s.includes(word))) return true;
  if (hasPreviousDraft && editWords.some(word => s.includes(word))) return true;

  return false;
}

function findDraftStart(text = '') {
  const markers = [
    /\bSubject\s*:/i,
    /\bDear\s+[A-Z0-9]/i,
    /\bDear\s+(Sir|Madam|Sirs)/i,
    /\bHi\s+[A-Z0-9]/i,
    /\bHi\s*,/i,
    /\bHello\s+[A-Z0-9]/i,
    /\bHello\s*,/i,
    /\bGood\s+(morning|afternoon|evening)\s*,?\s*[A-Z]?/i,
    /\bTo\s+whom\s+it\s+may\s+concern/i,
  ];

  const positions = markers
    .map(rx => {
      const match = String(text || '').match(rx);
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

  return text;
}

function normaliseProjectDraftText(raw = '') {
  let text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!text) return '';

  text = text
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^Draft\s*:\s*/i, '')
    .replace(/^Here(?:'s| is)\s+.*?(?=\bSubject\s*:|\bDear\s+|\bHi\s+|\bHello\s+)/is, '')
    .replace(/^Sure,?\s+.*?(?=\bSubject\s*:|\bDear\s+|\bHi\s+|\bHello\s+)/is, '')
    .trim();

  [
    /\n-{3,}\s*\n\s*I included[\s\S]*$/i,
    /\n-{3,}\s*\n\s*I've included[\s\S]*$/i,
    /\n-{3,}\s*\n\s*This draft[\s\S]*$/i,
    /\n-{3,}\s*\n\s*Let me know[\s\S]*$/i,
    /\n\s*I included the[\s\S]*$/i,
    /\n\s*I've included the[\s\S]*$/i,
    /\n\s*Let me know if this tone[\s\S]*$/i,
    /\n\s*Let me know if this suits[\s\S]*$/i,
  ].forEach(rx => {
    text = text.replace(rx, '').trim();
  });

  return text
    .replace(/\n\s*-{3,}\s*$/g, '')
    .replace(/^\s*-{3,}\s*\n/g, '')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Dear\s+)/i, '$1\n\n')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Hi\s+)/i, '$1\n\n')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Hello\s+)/i, '$1\n\n')
    .replace(/\s*(Kind regards,|Best regards,|Regards,)\s*/i, '\n\n$1\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
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
    /\n\s*(Let me know if (you'd like|you would like|this works|there's anything)[\s\S]*)$/i,
    /\n\s*(Please let me know if (you'd like|you would like|there are any|any)[\s\S]*)$/i,
    /\n\s*(Happy to (amend|adjust|revise|tweak|change)[\s\S]*)$/i,
    /\n\s*(I can (amend|adjust|revise|tweak|change|also)[\s\S]*)$/i,
    /\n\s*(Feel free to (adjust|amend|change|let me know)[\s\S]*)$/i,
    /\n\s*(This (keeps|version|draft|should|aims)[\s\S]*)$/i,
    /\n\s*(That should[\s\S]*)$/i,
    /\n\s*(If you (want|need|would like|prefer)[\s\S]*)$/i,
    /\n\s*(Shall I[\s\S]*)$/i,
    /\n\s*(Would you like[\s\S]*)$/i,
    /\n\s*(Do you want[\s\S]*)$/i,
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
    draft: normaliseProjectDraftText(draftAndAfter),
    after,
  };
}

function extractSubjectFromDraft(draftText = '') {
  // If draft starts with Subject: line, pull it out
  const match = draftText.match(/^Subject:\s*(.+)\n+/i);
  if (match) {
    return {
      subject: match[1].trim(),
      draft: draftText.replace(/^Subject:\s*.+\n+/i, '').trim(),
    };
  }
  return { subject: '', draft: draftText };
}

// ── Invoice Preview Card ──────────────────────────────────────────────────
function InvoicePreviewCard({ msg, projectId, boEmail, onSent }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(msg.invoiceSent || false);
  const inv = msg.invoiceData;
  if (!inv) return null;

  const handleDownload = () => {
    if (!msg.invoicePdfBase64) return;
    const a = document.createElement('a');
    a.href = msg.invoicePdfBase64;
    a.download = msg.invoiceFileName || `Invoice-${inv.invoice_number}.pdf`;
    a.click();
  };

  const handleSendToBO = async () => {
    if (sending || sent) return;
    setSending(true);
    try {
      const toEmail = boEmail || inv.bill_to_email || '';
      if (!toEmail) { alert('No Building Owner email found for this project.'); setSending(false); return; }
      if (!msg.invoicePdfBase64) { alert('PDF not available.'); setSending(false); return; }

      // Convert base64 data URI to raw base64
      const base64Data = msg.invoicePdfBase64.replace(/^data:application\/pdf;base64,/, '');

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject: `Invoice ${inv.invoice_number} — ${inv.property_address || ''}`,
          body: `Hi ${inv.bill_to_name?.split(' ')[0] || ''},\n\nPlease find attached invoice ${inv.invoice_number} for the works at ${inv.property_address || 'the above property'}.\n\nKind regards,`,
          attachments: [{
            name: msg.invoiceFileName || `Invoice-${inv.invoice_number}.pdf`,
            contentType: 'application/pdf',
            contentBytes: base64Data,
          }],
        }),
      });

      if (res.ok) {
        setSent(true);
        onSent?.();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to send email. Please send manually from the invoice screen.');
      }
    } catch (e) {
      alert('Error sending: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  const total = inv.total || inv.subtotal || inv.items?.reduce((s, i) => s + parseFloat(i.total || i.amount || 0), 0) || 0;

  return (
    <div style={{ margin: '8px 0', borderRadius: 12, border: '1px solid var(--blue)', overflow: 'hidden', background: 'var(--blue-bg)' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', background: 'rgba(79,127,255,0.12)', borderBottom: '1px solid var(--blue)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invoice {inv.invoice_number}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>£{parseFloat(total).toFixed(2)}</span>
      </div>

      {/* Line items */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{inv.bill_to_name} · {inv.property_address}</div>
        {(inv.items || []).map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text)', marginBottom: 4, lineHeight: 1.4 }}>
            <span style={{ flex: 1, paddingRight: 8 }}>{item.description}</span>
            <span style={{ fontWeight: 600, flexShrink: 0 }}>£{parseFloat(item.total || item.amount || 0).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--blue)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button
          onClick={handleDownload}
          style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}
        >
          ⬇️ Download PDF
        </button>
        {sent ? (
          <span style={{ padding: '5px 12px', fontSize: 12, color: 'var(--green, #22c55e)', fontWeight: 600 }}>✅ Sent to Building Owner</span>
        ) : (
          <button
            onClick={handleSendToBO}
            disabled={sending}
            style={{ padding: '5px 14px', borderRadius: 99, fontSize: 12, border: 'none', background: 'var(--blue)', color: '#fff', cursor: sending ? 'default' : 'pointer', fontWeight: 600, opacity: sending ? 0.7 : 1 }}
          >
            {sending ? 'Sending…' : '↩ Send to Building Owner'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProjectChat({ project, onOpenComposer, onClose }) {
  const { state } = useApp();

  const projectId = project?.id || '';
  const projectLabel = project?.ref || project?.name || project?.bo_premise_address || 'Project';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() => uid());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [voicePhase, setVoicePhase] = useState('idle');
  const [liveTop, setLiveTop] = useState('');
  const [liveBottom, setLiveBottom] = useState('');
  const [lastDraft, setLastDraft] = useState('');
  const [caseReviewPending, setCaseReviewPending] = useState(false);
  const [caseReviewTopic, setCaseReviewTopic] = useState('');
  const [pendingInvoice, setPendingInvoice] = useState(null);
  const [pendingInvoiceConfirm, setPendingInvoiceConfirm] = useState(false);
  const [invoiceGenerating, setInvoiceGenerating] = useState(false);
  const textareaRef = useRef(null);
  const voiceBaseRef = useRef('');
  const voiceTriggerRef = useRef(null);
  const prevPhraseRef = useRef('');
  const latestTranscriptRef = useRef('');
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    el.style.overflowY = el.scrollHeight > 240 ? 'auto' : 'hidden';
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
    setLastDraft('');
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
    setLastDraft('');
    resetSession();
  }, [resetSession, stopVoice]);

  const deleteSession = useCallback((sessionId, e) => {
    e?.stopPropagation?.();
    setSessions(prev => (prev || []).filter(s => s.id !== sessionId));
    // Also remove from project brain in Supabase
    supabase.from('project_brain')
      .delete()
      .eq('project_id', projectId)
      .eq('session_id', sessionId)
      .then(() => {})
      .catch(() => {});
  }, [projectId]);

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
      extracted_text: '',
      created_at: new Date().toISOString(),
    }));

    setAttachments(prev => [...prev, ...pending]);

    const completed = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const pendingRecord = pending[i];

      let finalRecord = {
        ...pendingRecord,
      };

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('project_id', projectId || '');
        formData.append('session_id', activeSessionId || '');
        formData.append('user_id', getUserId(state));
        formData.append('project_ref', project?.ref || '');
        formData.append('project_name', project?.name || '');

        const response = await fetch('/api/project-chat-upload', {
          method: 'POST',
          body: formData,
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || `Upload failed with status ${response.status}`);
        }

        finalRecord = {
          ...finalRecord,
          upload_id: payload.upload_id,
          storage_path: payload.storage_path || '',
          upload_status: payload.upload_status || 'uploaded',
          extracted_text: payload.extracted_text || '',
          extraction_status: payload.extraction_status || '',
          extraction_note: payload.extraction_note || '',
        };

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
  }, [activeSessionId, project, projectId, state, uploading]);

  const removeAttachment = useCallback((attachmentId) => {
    setAttachments(prev => prev.filter(item => item.id !== attachmentId));
  }, []);

  const appendAssistantMessagesFromResult = useCallback((result, wantsDraft) => {
    // Skip appending if this is an invoice_generated result — handled separately
    if (result.invoice_generated) return;
    // Strip <invoice_data> JSON blocks from display text
    const cleanReply = (s) => String(s || '').replace(/<invoice_data>[\s\S]*?<\/invoice_data>/g, '').trim();

    if (!wantsDraft) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: cleanReply(result.reply || 'Done.'),
        suggestedActions: result.suggestedActions,
        createdAt: new Date().toISOString(),
      }]);
      return;
    }

    const raw = result.draft || result.documentText || result.reply || result.replyText || '';
    const { brief, draft: rawDraft, after } = splitAssistantResponse(raw);
    const { subject, draft } = extractSubjectFromDraft(rawDraft);
    const newMessages = [];

    if (brief) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: brief,
        messageType: 'brief',
        suggestedActions: [],
        projectId,
        createdAt: new Date().toISOString(),
      });
    }

    if (subject) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: `Subject: ${subject}`,
        messageType: 'subject',
        suggestedActions: [],
        projectId,
        createdAt: new Date().toISOString(),
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
        projectId,
        createdAt: new Date().toISOString(),
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
        projectId,
        createdAt: new Date().toISOString(),
      });
    }

    if (!newMessages.length) {
      newMessages.push({
        id: uid(),
        role: 'ely',
        content: result.reply || 'Done.',
        suggestedActions: result.suggestedActions,
        createdAt: new Date().toISOString(),
      });
    }

    setMessages(prev => [...prev, ...newMessages]);
  }, [projectId]);

  const handleSend = useCallback(async (text) => {
    const msg = (text || input).trim();
    const readyAttachments = attachments.filter(a => a.upload_status === 'uploaded');

    if ((!msg && !readyAttachments.length) || loading || uploading) return;

    stopVoice();
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const messageText = msg || '';
    const isUploadOnly = !messageText && readyAttachments.length > 0;

    const userMsg = {
      id: uid(),
      role: 'user',
      content: messageText || `📎 ${readyAttachments.map(a => a.file_name).join(', ')}`,
      createdAt: new Date().toISOString(),
      attachments: readyAttachments,
    };

    setMessages(prev => [...prev, userMsg]);

    // Save to brain
    saveToBrain(projectId, activeSessionId, 'user', messageText || userMsg.content,
      readyAttachments.length ? 'upload' : 'message',
      readyAttachments[0]?.file_name || null
    );

    // If upload only with no message — acknowledge and wait. Don't call Ely.
    if (isUploadOnly) {
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `Got ${readyAttachments.length === 1 ? 'it' : `them (${readyAttachments.length} files)`}. What would you like me to do with ${readyAttachments.length === 1 ? 'this' : 'these'}?`,
        createdAt: new Date().toISOString(),
      }]);
      setAttachments(prev => prev.filter(a => a.upload_status !== 'uploaded'));
      return;
    }

    // No message, no attachments — nothing to do
    if (!messageText) return;

    try {
      const wantsDraft = isDraftRequest(messageText, !!lastDraft);

      // Load brain context to pass to Ely
      const brainContext = await loadBrainContext(projectId, 40);

      // Load previously uploaded documents from project_memory
      let projectMemoryUploads = [];
      try {
        const { data: memUploads } = await supabase
          .from('project_memory')
          .select('title, content, metadata')
          .eq('project_id', String(projectId))
          .eq('source_type', 'chat_upload')
          .not('content', 'is', null)
          .order('created_at', { ascending: false })
          .limit(5);
        projectMemoryUploads = (memUploads || []).filter(m => m.content && m.content.length > 20);
      } catch (e) {
        console.warn('[ProjectChat] could not load memory uploads:', e.message);
      }

      // If we're awaiting case review confirmation and user says yes / full / confirms
      const confirmWords = ['yes', 'full', 'full case review', 'case review', 'confirm', 'go ahead', 'proceed', 'do it', 'all of it', 'everything'];
      const isConfirmingCaseReview = caseReviewPending && confirmWords.some(w => messageText.toLowerCase().includes(w));

      const result = await send(messageText, {
        projectId,
        project,
        attachments: readyAttachments,
        uploadContext: readyAttachments,
        projectContext: project,
        projectChatWorkflow: wantsDraft ? 'draft_clean_bubble_only' : 'general',
        brainContext,
        // Pass case review flags if confirming
        ...(isConfirmingCaseReview ? {
          case_review_confirmed: true,
          case_review_topic: caseReviewTopic || messageText,
        } : {}),
        // Pass invoice state if active
        ...(pendingInvoice ? { pending_invoice: pendingInvoice } : {}),
        ...(pendingInvoiceConfirm ? { pending_invoice_confirm: true } : {}),
        context: {
          previousDraft: lastDraft || null,
          uploadedFiles: readyAttachments,
          uploadedExtractedText: readyAttachments
            .filter(file => file.extracted_text)
            .map(file => ({
              file_name: file.file_name,
              mime_type: file.mime_type,
              extracted_text: file.extracted_text,
            })),
          projectMemoryUploads,
          projectChatInstruction: wantsDraft
            ? 'Return any discussion separately from the draft. The draft itself must be clean final text only with no commentary inside or after it.'
            : null,
        },
      });

      appendAssistantMessagesFromResult(result, wantsDraft);

      // Handle case review flow
      if (result.case_review_prompt) {
        setCaseReviewPending(true);
        setCaseReviewTopic(messageText);
      } else if (result.case_review) {
        setCaseReviewPending(false);
        setCaseReviewTopic('');
      }

      // Handle invoice flow — parse <invoice_data> from Ely's reply if present
      const replyTextForInvoice = result.reply || '';
      const invoiceDataMatch = replyTextForInvoice.match(/<invoice_data>([\s\S]*?)<\/invoice_data>/);
      if (invoiceDataMatch && !result.invoice_generated) {
        try {
          const parsed = JSON.parse(invoiceDataMatch[1].trim());
          // Merge with project BO data if missing
          const boName = parsed.bill_to_name || project?.bo_name || '';
          const boAddress = parsed.bill_to_address || project?.bo_address || '';
          const boEmail = parsed.bo_email || project?.aos?.[0]?.email || project?.bo_email || '';
          const propertyAddress = parsed.property_address || project?.bo_premise_address || '';
          const mergedInvoice = { ...parsed, bill_to_name: boName, bill_to_address: boAddress, bo_email: boEmail, property_address: propertyAddress };
          setPendingInvoice(mergedInvoice);
          if (result.pending_invoice_confirm) setPendingInvoiceConfirm(true);
        } catch {}
      }

      if (result.invoice_generated && result.invoice) {
        // Invoice PDF generated — show preview with Send/Edit buttons
        setInvoiceGenerating(false);
        setPendingInvoice(null);
        setPendingInvoiceConfirm(false);
        setMessages(prev => [...prev, {
          id: uid(),
          role: 'ely',
          messageType: 'invoice_preview',
          invoiceData: result.invoice,
          invoicePdfBase64: result.invoice_pdf_base64,
          invoiceFileName: result.invoice_file_name,
          content: result.reply || `Invoice ${result.invoice.invoice_number} ready.`,
          createdAt: new Date().toISOString(),
        }]);
      } else if (result.pending_invoice) {
        // Parse invoice_data JSON block from Ely's reply if present
        const replyText = result.reply || '';
        const invoiceDataMatch = replyText.match(/<invoice_data>([\s\S]*?)<\/invoice_data>/);
        let parsedInvoice = result.pending_invoice;
        if (invoiceDataMatch) {
          try { parsedInvoice = { ...parsedInvoice, ...JSON.parse(invoiceDataMatch[1].trim()) }; } catch {}
        }
        setPendingInvoice(parsedInvoice);
        setPendingInvoiceConfirm(result.pending_invoice_confirm || false);
      }

      // Save Ely's reply to project brain
      const replyText = result.reply || result.draft || result.documentText || result.replyText || '';
      if (replyText) saveToBrain(projectId, activeSessionId, 'ely', replyText);

      setAttachments(prev => prev.filter(a => a.upload_status !== 'uploaded'));
    } catch (err) {
      setInvoiceGenerating(false);
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'ely',
        content: `Error: ${err.message}`,
        createdAt: new Date().toISOString(),
      }]);
    }
  }, [
    appendAssistantMessagesFromResult,
    attachments,
    input,
    lastDraft,
    loading,
    project,
    projectId,
    send,
    stopVoice,
    uploading,
  ]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Never send on Enter while voice is recording
      if (voicePhase === 'recording') return;
      handleSend();
    }
  };

  const handleVoice = (transcript, meta) => {
    // Ignore restart gaps — Web Speech API briefly stops between sessions
    if (meta?.restarting) {
      if (transcript) latestTranscriptRef.current = transcript;
      return;
    }
    if (!meta?.recording && transcript) {
      latestTranscriptRef.current = transcript;
      setInput(transcript);
      setVoicePhase('preview');
      return;
    }
    if (transcript) latestTranscriptRef.current = transcript;
  };

  const handleVoicePreview = (phrase, meta) => {
    // Ignore restart gaps — Web Speech API briefly stops between sessions on desktop
    if (meta?.restarting) return;

    if (meta?.recording === false) {
      if (latestTranscriptRef.current) {
        setInput(latestTranscriptRef.current);
      }
      setVoicePhase('idle');
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
            {sessions.length > 0 && (
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm('Clear all chat history for this project? This also removes saved brain entries.')) return;
                    setSessions([]);
                    supabase.from('project_brain')
                      .delete()
                      .eq('project_id', projectId)
                      .then(() => {})
                      .catch(() => {});
                    try { localStorage.removeItem(sessionStorageKey(projectId)); } catch {}
                  }}
                  style={{
                    width: '100%', padding: '7px 0', fontSize: 11.5,
                    color: 'var(--red, #ef4444)', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  Clear all history
                </button>
              </div>
            )}
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
                {msg.messageType === 'invoice_preview' ? (
                  <InvoicePreviewCard
                    msg={msg}
                    projectId={projectId}
                    boEmail={project?.aos?.[0]?.email || project?.bo_email || ''}
                    onSent={() => {
                      setMessages(prev => prev.map(m =>
                        m.id === msg.id ? { ...m, invoiceSent: true } : m
                      ));
                    }}
                  />
                ) : (
                <ChatMessage
                  msg={msg}
                  onUseDraft={(draft) => {
                    setInput(draft);
                    requestAnimationFrame(resizeTextarea);
                  }}
                  onOpenInComposer={(draft) => {
                    // Strip Subject line and clean sign-off before opening composer
                    let raw = typeof draft === 'string' ? draft : draft?.body || '';
                    const aoAddresses = parseAoSubjectRef(raw);
                    raw = raw.replace(/^Subject\s*:[^\n]+\n*/im, '').trim();
                    raw = raw.replace(/\nAO_SUBJECT_REF:[^\n]*/i, '').trim();
                    raw = raw.replace(/(Kind regards,?\s*)\n[\s\S]{0,50}$/i, 'Kind regards,');
                    raw = raw.replace(/\n(Best regards|Best|Regards|Cheers|Warm regards),?[\s\S]{0,80}$/i, '\n\nKind regards,');
                    const isHtml = raw.trim().startsWith('<');
                    const htmlBody = isHtml ? raw : raw.split(/\n\n+/).map((p, i, arr) =>
                      `<p style="margin:${i===arr.length-1?'0':'0 0 10px 0'}">${p.replace(/\n/g, '<br>')}</p>`
                    ).join('');
                    onOpenComposer?.({ mode: 'compose', body: htmlBody, bodyIsHtml: true, projectId, aoAddresses });
                  }}
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

          {/* ── Pending Invoice Confirmation Card ─────────────────────── */}
          {pendingInvoice && (
            <div style={{
              margin: '0 16px 8px',
              borderRadius: 12,
              border: '1px solid var(--blue)',
              overflow: 'hidden',
              background: 'var(--blue-bg)',
            }}>
              <div style={{
                padding: '8px 12px',
                background: 'rgba(79,127,255,0.12)',
                borderBottom: '1px solid var(--blue)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Invoice draft
                </span>
                <button
                  onClick={() => { setPendingInvoice(null); setPendingInvoiceConfirm(false); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                >×</button>
              </div>
              <div style={{ padding: '10px 12px' }}>
                {/* Line items */}
                {(pendingInvoice.items || []).map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: 'var(--text)' }}>
                    <span style={{ flex: 1, paddingRight: 8 }}>{item.description}</span>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>£{parseFloat(item.total || item.unitPrice || 0).toFixed(2)}</span>
                  </div>
                ))}
                {/* Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: 'var(--blue)', borderTop: '1px solid var(--blue)', paddingTop: 6, marginTop: 6 }}>
                  <span>Total</span>
                  <span>£{parseFloat(pendingInvoice.total || pendingInvoice.subtotal || 0).toFixed(2)}</span>
                </div>
                {/* Recipient */}
                {(pendingInvoice.bill_to_name || pendingInvoice.bo_email) && (
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6 }}>
                    To: {pendingInvoice.bill_to_name}{pendingInvoice.bo_email ? ` — ${pendingInvoice.bo_email}` : ''}
                  </div>
                )}
              </div>
              {/* Actions */}
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--blue)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setPendingInvoice(null); setPendingInvoiceConfirm(false); }}
                  style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  disabled={invoiceGenerating}
                  onClick={() => {
                    setInvoiceGenerating(true);
                    setPendingInvoiceConfirm(true);
                    handleSend('generate it');
                  }}
                  style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, border: 'none', background: 'var(--blue)', color: '#fff', fontWeight: 600, cursor: invoiceGenerating ? 'not-allowed' : 'pointer', opacity: invoiceGenerating ? 0.7 : 1 }}
                >
                  {invoiceGenerating ? 'Generating…' : 'Generate & Preview PDF'}
                </button>
              </div>
            </div>
          )}

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
                    {file.extraction_status === 'extracted' && <span>text extracted</span>}
                    {file.extraction_status === 'unsupported' && <span>stored only</span>}
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


            <div style={{ padding: '8px 12px 10px' }}>
              {/* Waveform + live preview — shown when recording */}
              {voicePhase === 'recording' && (
                <div style={{ marginBottom: 8, padding: '8px 4px 4px' }}>
                  {/* Animated bars */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 20, marginBottom: 6 }}>
                    {[0.5,0.9,0.6,1,0.7,0.8,0.5,1,0.6,0.9,0.7,0.8,0.5,0.9,0.6,1,0.7,0.8].map((h,i) => (
                      <div key={i} style={{ width: 3, borderRadius: 2, background: 'var(--blue,#3b82f6)', height: `${4+h*16}px`, animation: `waveBar 0.7s ease-in-out ${i*0.05}s infinite alternate` }} />
                    ))}
                    <style>{`@keyframes waveBar{from{transform:scaleY(0.25)}to{transform:scaleY(1)}}`}</style>
                  </div>
                  {/* Live preview lines */}
                  {(() => {
                    const text = liveBottom || input || '';
                    if (!text) return <div style={{ fontSize: 13.5, color: 'var(--text3)' }}>Listening...</div>;
                    const words = text.split(' ');
                    const lines = [];
                    let cur = '';
                    for (const w of words) {
                      if ((cur+' '+w).trim().length > 38) { if(cur) lines.push(cur.trim()); cur=w; }
                      else cur = cur ? cur+' '+w : w;
                    }
                    if (cur) lines.push(cur.trim());
                    return lines.slice(-3).map((line, i, arr) => {
                      const age = arr.length-1-i;
                      return <div key={i} style={{ fontSize: 13.5, lineHeight: 1.45, color: age===0?'var(--text)':`rgba(100,100,100,${age===1?0.5:0.25})`, fontWeight: age===0?500:400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</div>;
                    });
                  })()}
                </div>
              )}

              {voicePhase === 'transcribing' && (
                <div style={{ marginBottom: 8, padding: '6px 4px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text3)', fontSize: 13.5 }}>
                  <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                  Transcribing...
                  <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}

              {/* Input row */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <input ref={fileInputRef} type="file" multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.heic,.webp,image/*,application/pdf"
                  onChange={handleFilesSelected} style={{ display: 'none' }} />

                {/* + file */}
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  disabled={loading || uploading}
                  style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text3)', fontSize: 18, flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}
                >+</button>

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  className="pch-textarea"
                  value={input}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  placeholder={loading ? 'Ely is thinking...' : `Ask about ${projectRef || 'this project'}...`}
                  rows={1}
                  style={{
                    flex: 1, background: 'var(--bg3)', border: '1.5px solid var(--border)',
                    borderRadius: 12, fontSize: 13.5, color: 'var(--text)',
                    fontFamily: 'var(--font)', outline: 'none', resize: 'none',
                    maxHeight: 160, minHeight: 42, overflowY: 'auto',
                    lineHeight: 1.55, padding: '10px 12px',
                    transition: 'border-color 0.2s',
                  }}
                />

                {/* VoiceInput mic button — styled large */}
                <div style={{ flexShrink: 0, marginBottom: 3 }}>
                  <VoiceInput
                    onTranscript={handleVoice}
                    onPreview={handleVoicePreview}
                    disabled={loading || uploading}
                    stopSignal={voiceStopSignal}
                  />
                </div>

                {/* Send button — only shows when there's text */}
                {(input.trim() || voicePhase === 'recording') && (
                  <button
                    onClick={() => voicePhase === 'recording' ? stopVoice() : handleSend()}
                    disabled={loading || uploading}
                    style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'var(--blue,#3b82f6)', color: '#fff', flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}









