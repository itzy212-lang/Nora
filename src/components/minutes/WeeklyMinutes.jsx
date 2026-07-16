import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import ChatInputBar from '../shared/ChatInputBar';

function uid() { return Math.random().toString(36).slice(2); }

const SEVERITY_COLOURS = {
  none: { bg: '#D1FAE5', text: '#065F46' },
  'follow-up': { bg: '#FEF3C7', text: '#92400E' },
  urgent: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function WeeklyMinutes({ defaultProjectId, onBack, onOpenComposer }) {
  const { state } = useApp();
  const projects = state.projects || [];
  const isMobile = window.innerWidth < 768;

  const [phase, setPhase] = useState('landing'); // landing | recording | preview
  const [mobileView, setMobileView] = useState('tasks'); // tasks | visits (mobile only)
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [sessionId, setSessionId] = useState(null);
  const [weekLabel, setWeekLabel] = useState('Week 1');
  const [attendedBy, setAttendedBy] = useState('');
  const [messages, setMessages] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [openTasks, setOpenTasks] = useState([]);
  const [addTaskModal, setAddTaskModal] = useState(null); // { title, description, severity, room_id, linked_programme_task_id, due_date }
  const [pickerRooms, setPickerRooms] = useState([]);
  const [pickerProgrammeTasks, setPickerProgrammeTasks] = useState([]);
  const [savingTask, setSavingTask] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [draft, setDraft] = useState(null);
  const [missedTasks, setMissedTasks] = useState([]);
  const [emailDrafts, setEmailDrafts] = useState([]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const chatEndRef = useRef(null);

  const selectedProject = projects.find(p => p.id === projectId) || null;
  const projectAddress = selectedProject?.bo_premise_address || selectedProject?.bo_address || selectedProject?.address || '';

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadSessionHistory = async (pid) => {
    if (!pid) return;
    setLoadingSessions(true);
    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_sessions', project_id: pid }),
      });
      const json = await res.json();
      setSessionHistory(json.sessions || []);
      // Suggest next week label
      const nextNum = (json.sessions?.length || 0) + 1;
      setWeekLabel(`Week ${nextNum}`);
    } catch (err) {
      console.error('[WeeklyMinutes] load history failed', err);
    }
    setLoadingSessions(false);
  };

  const loadOpenTasks = async (pid) => {
    if (!pid) return;
    setLoadingTasks(true);
    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_open_tasks', project_id: pid }),
      });
      const json = await res.json();
      setOpenTasks(json.tasks || []);
    } catch (err) {
      console.error('[WeeklyMinutes] load open tasks failed', err);
    }
    setLoadingTasks(false);
  };

  const closeTask = async (taskId, linkedProgrammeTaskId) => {
    setOpenTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close_task', task_id: taskId, closed_by: 'manual', linked_programme_task_id: linkedProgrammeTaskId || null }),
      });
    } catch (err) {
      console.error('[WeeklyMinutes] close task failed', err);
    }
  };

  const openAddTaskModal = async () => {
    setAddTaskModal({ title: '', description: '', severity: 'follow-up', room_id: '', linked_programme_task_id: '', due_date: '' });
    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_pickers', project_id: projectId }),
      });
      const json = await res.json();
      setPickerRooms(json.rooms || []);
      setPickerProgrammeTasks(json.programme_tasks || []);
    } catch (err) {
      console.error('[WeeklyMinutes] load pickers failed', err);
    }
  };

  const saveManualTask = async () => {
    if (!addTaskModal?.title?.trim()) return;
    setSavingTask(true);
    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_task',
          project_id: projectId,
          title: addTaskModal.title,
          description: addTaskModal.description,
          severity: addTaskModal.severity,
          room_id: addTaskModal.room_id || null,
          linked_programme_task_id: addTaskModal.linked_programme_task_id || null,
          due_date: addTaskModal.due_date || null,
        }),
      });
      const json = await res.json();
      if (res.ok && json.task) {
        setOpenTasks(prev => [...prev, json.task]);
        setAddTaskModal(null);
      } else {
        alert(json.error || 'Could not create task.');
      }
    } catch (err) {
      alert('Could not create task.');
    }
    setSavingTask(false);
  };

  useEffect(() => {
    if (projectId) { loadSessionHistory(projectId); loadOpenTasks(projectId); }
  }, [projectId]);

  const startNewSession = async () => {
    setSessionId(null);
    setMessages([]);
    setDraft(null);
    setMissedTasks([]);
    setEmailDrafts([]);
    setPhase('recording');
    setSidebarOpen(false);

    // Pre-visit summary — use already-loaded open tasks so nothing gets forgotten
    if (openTasks.length) {
      const list = openTasks.map(t => {
        const roomName = t.project_rooms?.name;
        return `• ${t.title}${roomName ? ` (${roomName})` : ''}`;
      }).join('\n');
      setMessages([{
        id: uid(),
        role: 'ely',
        content: `Before we start — ${openTasks.length} task${openTasks.length > 1 ? 's' : ''} still open from previous visits:\n\n${list}\n\nMention any that are resolved and I'll close them off. Ready when you are.`,
      }]);
    } else {
      setMessages([{ id: uid(), role: 'ely', content: 'No outstanding tasks from previous visits. Ready when you are.' }]);
    }
  };

  const resumeSession = async (session) => {
    setSessionId(session.id);
    setWeekLabel(session.week_label);
    setAttendedBy(session.attended_by || '');
    setPhase('recording');
    setSidebarOpen(false);

    const res = await fetch('/api/generate-minutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load_session', session_id: session.id }),
    });
    const json = await res.json();
    const msgs = (json.notes || []).map(n => ({ id: uid(), role: 'user', content: n.content }));
    setMessages(msgs);
  };

  const renameSession = async (session) => {
    const newLabel = window.prompt('Rename this session:', session.week_label);
    if (!newLabel || newLabel === session.week_label) return;
    await fetch('/api/generate-minutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename_session', session_id: session.id, week_label: newLabel }),
    });
    if (session.id === sessionId) setWeekLabel(newLabel);
    loadSessionHistory(projectId);
  };

  const handleSend = async ({ text } = {}) => {
    const userContent = (text || textInput).trim();
    if (!userContent || processing) return;
    setProcessing(true);
    setTextInput('');

    const msgId = uid();
    setMessages(prev => [...prev, { id: msgId, role: 'user', content: userContent }]);

    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_note',
          session_id: sessionId,
          project_id: projectId,
          content: userContent,
          week_label: weekLabel,
          visit_date: new Date().toISOString().slice(0, 10),
          attended_by: attendedBy,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        if (!sessionId && json.session_id) setSessionId(json.session_id);
        setMessages(prev => [...prev, { id: msgId + '-ack', role: 'ely', content: json.ack || 'Noted' }]);
      } else {
        setMessages(prev => [...prev, { id: msgId + '-err', role: 'ely', content: '⚠ Note could not be saved.' }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { id: msgId + '-err', role: 'ely', content: '⚠ Note could not be saved.' }]);
    }
    setProcessing(false);
  };

  const handleGenerate = async () => {
    if (!sessionId) { alert('Add at least one note first.'); return; }
    setGenerating(true);
    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', session_id: sessionId, project_id: projectId }),
      });
      const json = await res.json();
      if (res.ok) {
        setDraft(json.draft);
        setMissedTasks(json.missed_tasks || []);
        setEmailDrafts((json.email_drafts || []).map(d => ({ ...d, id: uid(), sent: false })));
        setPhase('preview');
        loadOpenTasks(projectId);
      } else {
        alert(json.error || 'Could not generate minutes.');
      }
    } catch (err) {
      alert('Could not generate minutes.');
    }
    setGenerating(false);
  };

  const askHaveIMissedAnything = () => {
    if (!missedTasks.length) {
      alert('Nothing due this week appears to have been missed — everything on the programme for this period was covered.');
      return;
    }
    const list = missedTasks.map(t => `• ${t.title} (due ${t.end_date})`).join('\n');
    alert(`These programme items are due this week but weren't mentioned in your notes:\n\n${list}`);
  };

  const SEVERITY_HTML_COLOURS = {
    none: { bg: '#D1FAE5', text: '#065F46' },
    'follow-up': { bg: '#FEF3C7', text: '#92400E' },
    urgent: { bg: '#FEE2E2', text: '#991B1B' },
  };

  const buildHtmlForPdf = () => {
    if (!draft) return '';
    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let sectionNum = 1;
    let body = `<div style="font-family:Arial,sans-serif;max-width:100%;">` +
      `<div style="text-align:center;margin-bottom:20px;">` +
      `<div style="font-size:24pt;font-weight:700;color:#1F2937;">WEEKLY SITE MINUTES</div>` +
      `<div style="font-size:13pt;color:#6B7280;margin-top:4px;">Site Inspection Record — ${esc(weekLabel)}</div>` +
      `</div>` +
      `<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">` +
      `<tr><td style="border:1px solid #C8C8C8;padding:8px 12px;background:#F3F4F6;font-weight:700;color:#374151;width:30%;">Project</td><td style="border:1px solid #C8C8C8;padding:8px 12px;">${esc(projectAddress)}</td></tr>` +
      `<tr><td style="border:1px solid #C8C8C8;padding:8px 12px;background:#F3F4F6;font-weight:700;color:#374151;">Date of Visit</td><td style="border:1px solid #C8C8C8;padding:8px 12px;">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</td></tr>` +
      `<tr><td style="border:1px solid #C8C8C8;padding:8px 12px;background:#F3F4F6;font-weight:700;color:#374151;">Visit Number</td><td style="border:1px solid #C8C8C8;padding:8px 12px;">${esc(weekLabel)}</td></tr>` +
      `<tr><td style="border:1px solid #C8C8C8;padding:8px 12px;background:#F3F4F6;font-weight:700;color:#374151;">Attended By</td><td style="border:1px solid #C8C8C8;padding:8px 12px;">${esc(attendedBy)}</td></tr>` +
      `</table>`;

    (draft.rooms || []).filter(r => r.rows?.length).forEach(room => {
      body += `<div style="background:#1F2937;color:#fff;font-weight:700;font-size:12pt;padding:8px 12px;margin:20px 0 8px 0;">${sectionNum}. ${esc(room.room_name)}</div>` +
        `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">` +
        `<tr><th style="background:#F3F4F6;border:1px solid #C8C8C8;padding:6px 10px;text-align:left;font-size:10pt;width:10%;">Ref</th><th style="background:#F3F4F6;border:1px solid #C8C8C8;padding:6px 10px;text-align:left;font-size:10pt;width:55%;">Description</th><th style="background:#F3F4F6;border:1px solid #C8C8C8;padding:6px 10px;text-align:left;font-size:10pt;width:35%;">Action</th></tr>`;
      room.rows.forEach(r => {
        const c = SEVERITY_HTML_COLOURS[r.severity] || SEVERITY_HTML_COLOURS.none;
        body += `<tr><td style="border:1px solid #C8C8C8;padding:7px 10px;font-size:10pt;font-weight:700;">${esc(r.ref)}</td>` +
          `<td style="border:1px solid #C8C8C8;padding:7px 10px;font-size:10pt;">${esc(r.description)}</td>` +
          `<td style="border:1px solid #C8C8C8;padding:7px 10px;font-size:10pt;background:${c.bg};color:${c.text};font-weight:${r.severity !== 'none' ? 700 : 400};">${esc(r.action)}</td></tr>`;
      });
      body += `</table>`;
      sectionNum++;
    });

    if ((draft.general_notes || []).length) {
      body += `<div style="background:#1F2937;color:#fff;font-weight:700;font-size:12pt;padding:8px 12px;margin:20px 0 8px 0;">${sectionNum}. General Notes</div>` +
        `<div style="border:1px solid #C8C8C8;background:#FFFBEB;padding:12px 16px;">` +
        `<ol style="margin:0;padding-left:18px;font-size:10.5pt;">` +
        draft.general_notes.map(n => `<li style="margin-bottom:6px;">${esc(n)}</li>`).join('') +
        `</ol></div>`;
    }

    body += `</div>`;
    return body;
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const html = buildHtmlForPdf();
      const res = await fetch('/api/export-minutes-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, filename: `Weekly Site Minutes - ${weekLabel} - ${projectAddress}.pdf` }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Could not generate PDF.');
        setDownloadingPdf(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Weekly Site Minutes - ${weekLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Could not generate PDF.');
    }
    setDownloadingPdf(false);
  };

  const handleEmailToClient = () => {
    const html = buildHtmlForPdf();
    if (typeof onOpenComposer === 'function') {
      onOpenComposer({
        mode: 'compose',
        projectId,
        subject: `Weekly Site Minutes — ${weekLabel} — ${projectAddress}`,
        body: html,
        prefillGreeting: false,
      });
    } else {
      alert('Email composer is not available here.');
    }
  };

  // ── Setup phase ────────────────────────────────────────────────────────
  if (phase === 'landing') {
    if (!projectId) {
      return (
        <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Site Log</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Select a project to view its site log.</div>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14 }}>
            <option value="">Select project...</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.bo_premise_address || p.bo_address}</option>)}
          </select>
        </div>
      );
    }

    const TasksPanel = () => (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Open Tasks</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>{openTasks.length} open</span>
            <button onClick={openAddTaskModal}
              style={{ padding: '5px 12px', borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              + Add Task
            </button>
          </div>
        </div>
        {loadingTasks ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</div>
        ) : openTasks.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No open tasks. Everything's up to date.</div>
        ) : (
          openTasks.map(t => {
            const c = SEVERITY_COLOURS[t.severity] || SEVERITY_COLOURS['follow-up'];
            const programmeTitle = t.programme_tasks?.title;
            const isPortalConfirmation = t.source === 'portal_completion';
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: isPortalConfirmation ? '1px solid #fbbf24' : '1px solid #e5e7eb', background: isPortalConfirmation ? '#fffbeb' : '#fff', borderRadius: 10, marginBottom: 8 }}>
                <button onClick={() => closeTask(t.id, isPortalConfirmation ? t.linked_programme_task_id : null)}
                  style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid #d1d5db', background: '#fff', cursor: 'pointer', flexShrink: 0, marginTop: 1 }}
                  title={isPortalConfirmation ? 'Confirm complete' : 'Mark complete'} />
                <div style={{ flex: 1 }}>
                  {isPortalConfirmation && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginBottom: 2 }}>Confirm completion</div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{t.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{t.description}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {t.project_rooms?.name && (
                      <span style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 6 }}>{t.project_rooms.name}</span>
                    )}
                    {!isPortalConfirmation && <span style={{ fontSize: 11, fontWeight: 700, color: c.text, background: c.bg, padding: '2px 8px', borderRadius: 6 }}>{t.severity}</span>}
                    {programmeTitle && (
                      <span style={{ fontSize: 11, color: '#2563eb', background: '#eff6ff', padding: '2px 8px', borderRadius: 6 }}>→ {programmeTitle}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    );

    const VisitsPanel = () => (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Visits</div>
          <button onClick={startNewSession}
            style={{ padding: '6px 14px', borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + New visit — {weekLabel}
          </button>
        </div>
        {sessionHistory.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No visits recorded yet.</div>
        ) : (
          sessionHistory.map(s => (
            <div key={s.id} onClick={() => resumeSession(s)}
              style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.week_label}</span>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>{s.note_count} note{s.note_count !== 1 ? 's' : ''} · {s.status}</span>
            </div>
          ))
        )}
      </div>
    );

    const addTaskModalUI = addTaskModal && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Add task</div>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Title</div>
          <input value={addTaskModal.title} onChange={e => setAddTaskModal(prev => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. Order bathroom tiles"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />

          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Details (optional)</div>
          <textarea value={addTaskModal.description} onChange={e => setAddTaskModal(prev => ({ ...prev, description: e.target.value }))}
            rows={2} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12, boxSizing: 'border-box', resize: 'vertical' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Severity</div>
              <select value={addTaskModal.severity} onChange={e => setAddTaskModal(prev => ({ ...prev, severity: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
                <option value="follow-up">Follow-up</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Due date</div>
              <input type="date" value={addTaskModal.due_date} onChange={e => setAddTaskModal(prev => ({ ...prev, due_date: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Room (optional)</div>
          <select value={addTaskModal.room_id} onChange={e => setAddTaskModal(prev => ({ ...prev, room_id: e.target.value, linked_programme_task_id: '' }))}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12 }}>
            <option value="">No specific room</option>
            {pickerRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Link to programme task (optional)</div>
          <select value={addTaskModal.linked_programme_task_id} onChange={e => setAddTaskModal(prev => ({ ...prev, linked_programme_task_id: e.target.value }))}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 20 }}>
            <option value="">Not linked</option>
            {pickerProgrammeTasks
              .filter(pt => !addTaskModal.room_id || pt.room_id === addTaskModal.room_id)
              .map(pt => <option key={pt.id} value={pt.id}>{pt.title}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setAddTaskModal(null)} style={{ padding: '9px 18px', borderRadius: 10, background: '#f3f4f6', color: '#374151', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={saveManualTask} disabled={savingTask || !addTaskModal.title.trim()}
              style={{ padding: '9px 18px', borderRadius: 10, background: '#1F2937', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (savingTask || !addTaskModal.title.trim()) ? 0.5 : 1 }}>
              {savingTask ? 'Adding...' : 'Add task'}
            </button>
          </div>
        </div>
      </div>
    );

    // Desktop — split view, both visible
    if (!isMobile) {
      return (
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, height: '100%', overflowY: 'auto' }}>
          <TasksPanel />
          <div style={{ borderTop: '1px solid #e5e7eb' }} />
          <VisitsPanel />
          {addTaskModalUI}
        </div>
      );
    }

    // Mobile — tasks by default, hamburger toggles to visits
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Site Log</div>
          <button onClick={() => setMobileView(v => v === 'tasks' ? 'visits' : 'tasks')}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 4 }}>
            ☰
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {mobileView === 'tasks' ? <TasksPanel /> : <VisitsPanel />}
        </div>
        {addTaskModalUI}
      </div>
    );
  }

  // ── Preview phase ──────────────────────────────────────────────────────
  if (phase === 'preview' && draft) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <button onClick={() => setPhase('recording')} style={{ marginBottom: 16, background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13 }}>← Back to dictation</button>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>WEEKLY SITE MINUTES</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>{weekLabel} — {projectAddress}</div>

        {missedTasks.length > 0 && (
          <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: 14, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#92400E', marginBottom: 6 }}>⚠ Before you finish — these are due this week and weren't mentioned:</div>
            {missedTasks.map((t, i) => (
              <div key={i} style={{ fontSize: 13, color: '#92400E' }}>• {t.title} (due {t.end_date})</div>
            ))}
          </div>
        )}

        {(draft.rooms || []).filter(r => r.rows?.length).map((room, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <div style={{ background: '#1F2937', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
              {i + 1}. {room.room_name}
            </div>
            {room.rows.map((r, j) => {
              const c = SEVERITY_COLOURS[r.severity] || SEVERITY_COLOURS.none;
              return (
                <div key={j} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, width: 40 }}>{r.ref}</div>
                  <div style={{ flex: 1 }}>{r.description}</div>
                  <div style={{ background: c.bg, color: c.text, fontWeight: r.severity !== 'none' ? 700 : 400, padding: '2px 8px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap', height: 'fit-content' }}>
                    {r.action}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {(draft.general_notes || []).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ background: '#1F2937', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
              General Notes
            </div>
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: 12 }}>
              {draft.general_notes.map((n, i) => (
                <div key={i} style={{ fontSize: 13, marginBottom: 6 }}>{i + 1}. {n}</div>
              ))}
            </div>
          </div>
        )}

        {emailDrafts.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Draft emails for follow-up items</div>
            {emailDrafts.map((d, i) => (
              <div key={d.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 10, background: d.sent ? '#f0fdf4' : '#fff' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>
                  To: {d.recipient_guess || 'Recipient'} {d.sent && <span style={{ color: '#10b981' }}>· Sent</span>}
                </div>
                <input
                  value={d.subject || ''}
                  onChange={e => setEmailDrafts(prev => prev.map(x => x.id === d.id ? { ...x, subject: e.target.value } : x))}
                  style={{ width: '100%', fontWeight: 700, fontSize: 13, border: 'none', outline: 'none', marginBottom: 8, background: 'transparent' }}
                />
                <textarea
                  value={d.body || ''}
                  onChange={e => setEmailDrafts(prev => prev.map(x => x.id === d.id ? { ...x, body: e.target.value } : x))}
                  rows={4}
                  style={{ width: '100%', fontSize: 13, border: '1px solid #f3f4f6', borderRadius: 8, padding: 8, resize: 'vertical', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => setEmailDrafts(prev => prev.map(x => x.id === d.id ? { ...x, sent: true } : x))}
                    disabled={d.sent}
                    style={{ padding: '6px 14px', borderRadius: 8, background: d.sent ? '#d1fae5' : '#1F2937', color: d.sent ? '#065f46' : '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: d.sent ? 'default' : 'pointer' }}>
                    {d.sent ? 'Sent ✓' : 'Send'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={handleDownloadPdf} disabled={downloadingPdf}
            style={{ flex: 1, padding: 12, borderRadius: 10, background: '#1F2937', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: downloadingPdf ? 0.6 : 1 }}>
            {downloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <button onClick={handleEmailToClient}
            style={{ flex: 1, padding: 12, borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Email to client
          </button>
        </div>
      </div>
    );
  }

  // ── Recording phase (dictation chat) ────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <div>
          <button onClick={() => { setPhase('landing'); loadOpenTasks(projectId); loadSessionHistory(projectId); }}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: 0, marginBottom: 2 }}>← Site Log</button>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{weekLabel}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{projectAddress}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSidebarOpen(true)} style={{ padding: '6px 12px', borderRadius: 8, background: '#f3f4f6', border: 'none', fontSize: 12, cursor: 'pointer' }}>History</button>
          <button onClick={askHaveIMissedAnything} style={{ padding: '6px 12px', borderRadius: 8, background: '#f3f4f6', border: 'none', fontSize: 12, cursor: 'pointer' }}>Have I missed anything?</button>
          <button onClick={handleGenerate} disabled={generating || !messages.length}
            style={{ padding: '6px 14px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (generating || !messages.length) ? 0.5 : 1 }}>
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {messages.map(m => (
          <div key={m.id} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '75%', padding: '10px 14px', borderRadius: 14,
              background: m.role === 'user' ? '#1F2937' : '#f3f4f6',
              color: m.role === 'user' ? '#fff' : '#374151', fontSize: 14,
            }}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <ChatInputBar
        value={textInput}
        onChange={setTextInput}
        onSend={handleSend}
        placeholder="Dictate site progress, room by room..."
        disabled={processing}
      />

      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }} onClick={() => setSidebarOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 320, background: '#fff', padding: 16, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Session History</div>
            <button onClick={startNewSession} style={{ width: '100%', padding: 10, borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>
              + New session
            </button>
            {sessionHistory.map(s => (
              <div key={s.id} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span onClick={() => resumeSession(s)} style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{s.week_label}</span>
                  <button onClick={() => renameSession(s)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>Rename</button>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.note_count} notes · {s.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
