import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import ChatInputBar from '../shared/ChatInputBar';

function uid() { return Math.random().toString(36).slice(2); }

const SEVERITY_COLOURS = {
  none: { bg: '#D1FAE5', text: '#065F46' },
  'follow-up': { bg: '#FEF3C7', text: '#92400E' },
  urgent: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function WeeklyMinutes({ defaultProjectId, onBack }) {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState('setup'); // setup | recording | preview
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

  const [draft, setDraft] = useState(null);
  const [missedTasks, setMissedTasks] = useState([]);

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

  useEffect(() => {
    if (projectId) loadSessionHistory(projectId);
  }, [projectId]);

  const startNewSession = () => {
    setSessionId(null);
    setMessages([]);
    setDraft(null);
    setMissedTasks([]);
    setPhase('recording');
    setSidebarOpen(false);
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
        setPhase('preview');
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

  // ── Setup phase ────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Weekly Site Minutes</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Select a project to begin or resume site visit dictation.</div>
        <select value={projectId} onChange={e => setProjectId(e.target.value)}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, marginBottom: 16 }}>
          <option value="">Select project...</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.bo_premise_address || p.bo_address}</option>)}
        </select>
        {projectId && (
          <button onClick={startNewSession}
            style={{ width: '100%', padding: 12, borderRadius: 10, background: '#1F2937', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Start dictation — {weekLabel}
          </button>
        )}
        {sessionHistory.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>PREVIOUS SESSIONS</div>
            {sessionHistory.map(s => (
              <div key={s.id} onClick={() => resumeSession(s)}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.week_label}</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{s.note_count} note{s.note_count !== 1 ? 's' : ''} · {s.status}</span>
              </div>
            ))}
          </div>
        )}
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

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button style={{ flex: 1, padding: 12, borderRadius: 10, background: '#1F2937', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Download PDF
          </button>
          <button style={{ flex: 1, padding: 12, borderRadius: 10, background: '#10b981', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
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
