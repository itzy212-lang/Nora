import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import ChatInputBar from '../shared/ChatInputBar';
import SaveToOneDriveOverlay from '../shared/SaveToOneDriveOverlay';
import { supabase } from '../../supabaseClient';

function uid() { return Math.random().toString(36).slice(2); }

export default function SOC({ onOpenComposer, defaultProjectId, defaultAOIndex }) {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState(defaultProjectId ? 'recording' : 'setup');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [messages, setMessages] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const [oneDriveOverlay, setOneDriveOverlay] = useState(null);
  const [selectedAOIndex, setSelectedAOIndex] = useState(defaultAOIndex != null ? String(defaultAOIndex) : '0');
  const [previewHtml, setPreviewHtml] = useState('');
  const [structuredData, setStructuredData] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [partyDrafts, setPartyDrafts] = useState([]);
  const [unresolvedNotes, setUnresolvedNotes] = useState([]);
  const [auditIssues, setAuditIssues] = useState([]);
  const [auditWarnings, setAuditWarnings] = useState([]);
  const [unresolvedOverridden, setUnresolvedOverridden] = useState(false);

  // ── Sidebar state ────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState([]); // [{sessionId, aoAddress, aoId, noteCount, lastUpdated}]
  const [loadingSessions, setLoadingSessions] = useState(false);

  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const selectedProject = projects.find(p => p.id === projectId) || projects[0] || null;
  const projectAddress = selectedProject?.bo_address || selectedProject?.address || '';
  const aos = selectedProject?.aos || [];
  const selectedAO = aos[Number(selectedAOIndex)] || null;
  const selectedAOAddress = selectedAO?.address || selectedAO?.ao_address || selectedAO?.reg_addr || '';

  function aoName(ao) { return [ao?.name || ao?.ao_name_1, ao?.name2 || ao?.ao_name_2].filter(Boolean).join(' & '); }
  function aoIdValue(ao, index) { return String(ao?.id || ao?.num || index || '0'); }
  function projectOptionLabel(p) { return p.bo_address || p.address || p.id; }
  function isQuestion(text) {
    const t = text.toLowerCase().trim();
    return t.endsWith('?') || /^(have i|did i|what|which|how many|is there|are there|do i)/i.test(t);
  }

  // ── SOC session — one ai_session per project+AO, stored in Supabase ────────
  const [socSessionId, setSocSessionId] = useState(null); // ai_sessions.id (UUID)

  // ── Find or create SOC session in ai_sessions, then load notes ─────────────
  useEffect(() => {
    if (!projectId) return;
    const aoId = aoIdValue(selectedAO, Number(selectedAOIndex));

    async function initSession() {
      // Look for existing SOC session for this project+AO
      const { data: existing } = await supabase
        .from('ai_sessions')
        .select('id')
        .eq('project_id', projectId)
        .eq('session_type', 'soc')
        .eq('ao_id', aoId)
        .order('created_at', { ascending: false })
        .limit(1);

      let sid = existing?.[0]?.id || null;

      if (!sid) {
        // Create a new SOC session for this project+AO
        const aoAddr = selectedAOAddress || aoName(selectedAO) || 'Adjoining Owner';
        const { data: created } = await supabase
          .from('ai_sessions')
          .insert({
            user_id: 'itzy212@gmail.com',
            project_id: projectId,
            ao_id: aoId,
            session_type: 'soc',
            surface: 'soc',
            title: aoAddr,
            auto_title: aoAddr,
          })
          .select('id')
          .single();
        sid = created?.id || null;
      }

      if (!sid) return;
      setSocSessionId(sid);

      // Load existing notes for this session
      const { data: msgs } = await supabase
        .from('ai_messages')
        .select('id, role, content, created_at')
        .eq('session_id', sid)
        .order('created_at', { ascending: true });

      if (msgs?.length) {
        setMessages(msgs.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })));
        if (phase === 'setup') setPhase('recording');
      }
    }

    initSession().catch(console.error);
  }, [projectId, selectedAOIndex]);

  // ── Load session history for sidebar ────────────────────────────────────
  const loadSessionHistory = useCallback(async () => {
    if (!projectId) return;
    setLoadingSessions(true);
    try {
      // Read SOC sessions directly from ai_sessions
      const { data: sessions } = await supabase
        .from('ai_sessions')
        .select('id, title, auto_title, ao_id, created_at, last_message_at')
        .eq('project_id', projectId)
        .eq('session_type', 'soc')
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (sessions) {
        // Get note counts from ai_messages
        const enriched = await Promise.all(sessions.map(async s => {
          const { count } = await supabase
            .from('ai_messages')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', s.id)
            .eq('role', 'user');
          return {
            sessionId: s.id,
            aoId: s.ao_id,
            aoAddress: s.title || s.auto_title || 'Adjoining Owner',
            noteCount: count || 0,
            lastUpdated: s.last_message_at || s.created_at,
          };
        }));
        setSessionHistory(enriched);
      }
    } catch (e) { console.error(e); }
    setLoadingSessions(false);
  }, [projectId]);

  useEffect(() => {
    if (sidebarOpen) loadSessionHistory();
  }, [sidebarOpen, loadSessionHistory]);

  // Open a historical session from the sidebar
  const openSession = useCallback(async (session) => {
    setSocSessionId(session.sessionId);
    setMessages([]);
    setPreviewHtml('');
    setStructuredData(null);
    setSidebarOpen(false);

    // Load notes for this session
    const { data: msgs } = await supabase
      .from('ai_messages')
      .select('id, role, content, created_at')
      .eq('session_id', session.sessionId)
      .order('created_at', { ascending: true });

    if (msgs?.length) {
      setMessages(msgs.map(m => ({ id: m.id, role: m.role, content: m.content })));
    }
    setPhase('recording');
  }, []);

  // Start a new session for a different AO
  const startNewSession = useCallback(() => {
    setSidebarOpen(false);
    setPhase('setup');
    setMessages([]);
    setPreviewHtml('');
    setStructuredData(null);
  }, []);

  // ── Scroll chat to bottom ────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Recording ────────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition not available on this browser.'); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-GB';
    let finalised = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalised += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      setInterimText(interim);
      if (finalised) setTextInput(finalised.trim());
    };
    rec.onend = () => { setIsRecording(false); setInterimText(''); };
    rec.onerror = () => { setIsRecording(false); setInterimText(''); };
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    setInterimText('');
  }, []);

  // ── Submit a note — saves directly to ai_messages ───────────────────────
  const handleSend = useCallback(async (overrideText) => {
    const userContent = (overrideText ?? textInput).trim();
    if (!userContent) return;
    if (!socSessionId) { alert('Session not ready — please wait a moment and try again.'); return; }

    const msgId = uid();
    setMessages(prev => [...prev, { id: msgId, role: 'user', content: userContent }]);
    setTextInput('');

    // Save directly to ai_messages — same table that already works
    const { error } = await supabase.from('ai_messages').insert({
      id: msgId,
      session_id: socSessionId,
      role: 'user',
      content: userContent,
      project_id: projectId || null,
      surface: 'soc',
    });

    if (error) {
      console.error('[SOC] save failed:', error.message);
      setMessages(prev => [...prev, { id: msgId + '-err', role: 'ely', content: 'Note could not be saved. Please check your connection.' }]);
    } else {
      // Show a simple acknowledgement — no API call needed
      setMessages(prev => [...prev, { id: msgId + '-ack', role: 'ely', content: 'Noted.' }]);
    }
  }, [textInput, socSessionId, projectId, selectedAO, selectedAOIndex]);

  const handleMicToggle = useCallback(() => {
    if (isRecording) {
      stopRecording();
      if (textInput.trim()) handleSend();
    } else {
      startRecording();
    }
  }, [isRecording, handleSend, startRecording, stopRecording, textInput]);

  // ── Generate SOC ─────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    const allNotes = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
    const text = [allNotes, textInput.trim()].filter(Boolean).join('\n\n');
    if (!text) return;

    stopRecording();
    setProcessing(true);

    try {
      const response = await fetch('/api/generate-soc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          project_id: projectId,
          session_id: socSessionId,
          ao_id: aoIdValue(selectedAO, Number(selectedAOIndex)),
          ao_name: aoName(selectedAO),
          ao_names: aoName(selectedAO),
          ao_address: selectedAOAddress,
          ao_premise_address: selectedAOAddress,
          ao_service_address: selectedAO?.service_address || selectedAO?.serviceAddress || selectedAO?.reg_addr || selectedAOAddress || '',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.details || 'Could not generate Schedule of Condition.');
      if (!payload.preview_html) throw new Error('The SOC API did not return preview_html.');

      setPreviewHtml(payload.preview_html);
      setStructuredData(payload.structured_data || null);
      setUnresolvedNotes(payload.structured_data?.unresolved_notes || []);
      setAuditIssues(payload.structured_data?.audit_issues || []);
      setAuditWarnings(payload.structured_data?.audit_warnings || []);
      setReportId(payload.report_id || null);
      setPartyDrafts(payload.partyDrafts || []);
      setUnresolvedOverridden(false);
      setPhase('review');
    } catch (err) {
      alert('Error generating SOC: ' + (err.message || err));
    } finally {
      setProcessing(false);
    }
  }, [messages, projectId, selectedAO, selectedAOAddress, selectedAOIndex, socSessionId, stopRecording, textInput]);

  // ── Print / PDF ──────────────────────────────────────────────────────────
  const printPreview = useCallback(async () => {
    if (!previewHtml) return;
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      const res = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: previewHtml, filename: safeFilename }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const { base64, filename } = await res.json();
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${base64}`;
      link.download = filename || `${safeFilename}.pdf`;
      link.click();
    } catch (err) {
      alert('PDF error: ' + err.message);
    } finally {
      setPdfProcessing(false);
    }
  }, [previewHtml, projectAddress, selectedAOAddress]);

  const handleSaveAndEmail = useCallback(async () => {
    if (!previewHtml) return;
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      const res = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: previewHtml, filename: safeFilename }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const { base64, filename: fn } = await res.json();
      setOneDriveOverlay({ base64, filename: fn || `${safeFilename}.pdf`, projectId, previewHtml });
    } catch (err) {
      alert('Save error: ' + err.message);
    } finally {
      setPdfProcessing(false);
    }
  }, [onOpenComposer, previewHtml, projectAddress, projectId, selectedAO, selectedAOAddress]);

  // ── Styles ───────────────────────────────────────────────────────────────
  const s = {
    page: { display: 'flex', height: '100%', position: 'relative', overflow: 'hidden' },
    // Sidebar
    sidebarOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100 },
    sidebar: { position: 'fixed', left: 0, top: 0, bottom: 0, width: 280, background: 'var(--bg)', borderRight: '1px solid var(--border)', zIndex: 101, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 20px rgba(0,0,0,0.15)' },
    sidebarHeader: { padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    sidebarTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
    sidebarList: { flex: 1, overflowY: 'auto', padding: '8px 0' },
    sidebarItem: { padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.15s' },
    sidebarItemActive: { background: 'var(--blue-bg)', borderLeft: '3px solid var(--blue)' },
    sidebarItemAddr: { fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 },
    sidebarItemMeta: { fontSize: 11, color: 'var(--text3)' },
    sidebarNewBtn: { margin: '12px', padding: '10px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--blue)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center' },
    // Main content
    main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 8 },
    headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
    hamburger: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text)', fontSize: 20, lineHeight: 1 },
    titleBlock: { display: 'flex', flexDirection: 'column' },
    titleMain: { fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 },
    titleSub: { fontSize: 11, color: 'var(--text3)' },
    generateBtn: { padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--blue)', color: '#fff', whiteSpace: 'nowrap' },
    // Chat area
    chatArea: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2 },
    userBubble: { background: 'var(--blue)', color: '#fff', borderRadius: '18px 18px 4px 18px', padding: '8px 13px', fontSize: 13.5, maxWidth: '85%', lineHeight: 1.5, wordBreak: 'break-word' },
    elyBubble: { background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: '18px 18px 18px 4px', padding: '8px 13px', fontSize: 13, maxWidth: '80%', lineHeight: 1.5, fontStyle: 'italic' },
    emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: '0 32px' },
    emptyIcon: { fontSize: 36, marginBottom: 4 },
    // Input
    inputArea: { flexShrink: 0, borderTop: '1px solid var(--border)' },
    // AO bar
    aoBar: { padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 },
    aoLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' },
    aoSelect: { flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none' },
    // Review page
    reviewPage: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    reviewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 8, flexWrap: 'wrap' },
    reviewContent: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
    primaryBtn: { padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'var(--blue)', color: '#fff' },
    secondaryBtn: { padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text)' },
    card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
    row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
    field: { display: 'flex', flexDirection: 'column', gap: 4 },
    label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
    input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box' },
  };

  // ── Setup phase ──────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div style={{ ...s.page, flexDirection: 'column', padding: '20px 16px', gap: 16 }}>
        <div style={s.header}>
          <div style={s.titleMain}>SOC Dictation</div>
        </div>
        <div style={s.card}>
          <div style={s.field}>
            <label style={s.label}>Select project</label>
            <select style={s.aoSelect} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{projectOptionLabel(p)}</option>)}
            </select>
          </div>
          {projectId && (
            <div style={s.field}>
              <label style={s.label}>Adjoining Owner</label>
              <select style={s.aoSelect} value={selectedAOIndex} onChange={e => setSelectedAOIndex(e.target.value)}>
                {aos.map((ao, i) => (
                  <option key={i} value={String(i)}>{ao.address || ao.ao_address || `AO ${i + 1}`}</option>
                ))}
              </select>
            </div>
          )}
          <button
            disabled={!projectId}
            onClick={() => setPhase('recording')}
            style={{ ...s.generateBtn, opacity: !projectId ? 0.5 : 1, alignSelf: 'flex-start' }}
          >
            Start SOC
          </button>
        </div>
      </div>
    );
  }

  // ── Review phase ─────────────────────────────────────────────────────────
  if (phase === 'review') {
    return (
      <div style={s.reviewPage}>
        {/* Header */}
        <div style={s.reviewHeader}>
          <button onClick={() => setPhase('recording')} style={s.secondaryBtn}>← Back to notes</button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                if (unresolvedNotes.length > 0 && !unresolvedOverridden) {
                  if (!window.confirm(`${unresolvedNotes.length} note(s) unresolved. Download PDF anyway?`)) return;
                }
                printPreview();
              }}
              disabled={pdfProcessing}
              style={{ ...s.primaryBtn, background: unresolvedNotes.length > 0 && !unresolvedOverridden ? '#f59e0b' : 'var(--blue)', opacity: pdfProcessing ? 0.65 : 1 }}
            >
              {pdfProcessing ? 'Generating…' : unresolvedNotes.length > 0 && !unresolvedOverridden ? `⚠ Download PDF (${unresolvedNotes.length} unresolved)` : 'Download PDF'}
            </button>
            <button onClick={handleSaveAndEmail} disabled={pdfProcessing} style={{ ...s.primaryBtn, background: '#10b981', opacity: pdfProcessing ? 0.65 : 1 }}>
              {pdfProcessing ? 'Saving…' : '💾 Save & Email'}
            </button>
          </div>
        </div>

        <div style={s.reviewContent}>
          {/* Metadata */}
          <div style={s.card}>
            <div style={s.row2}>
              <div style={s.field}>
                <label style={s.label}>Adjoining Owner Property</label>
                <input style={s.input} value={selectedAOAddress} readOnly />
              </div>
              <div style={s.field}>
                <label style={s.label}>Report ID</label>
                <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text3)' }} value={reportId || 'Not saved yet'} readOnly />
              </div>
            </div>
          </div>

          {/* Audit / unresolved panel */}
          {((unresolvedNotes || []).length > 0 || (auditIssues || []).length > 0) && (
            <div style={{ padding: '12px 14px', background: '#fffbe6', border: '1px solid #f59e0b', borderRadius: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                {unresolvedOverridden ? '⚠ Draft generated with unresolved items' : '⚠ Review before finalising'}
              </div>
              {(auditIssues || []).map((issue, i) => (
                <div key={i} style={{ marginBottom: 6, fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '4px 8px' }}>{issue}</div>
              ))}
              {(unresolvedNotes || []).map((item, i) => (
                <div key={i} style={{ marginBottom: 10, padding: '8px 10px', background: '#fff', borderRadius: 8, border: '1px solid #fcd34d' }}>
                  <div style={{ fontStyle: 'italic', fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>"{item.note_text}"</div>
                  {item.suggested_section && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Suggested: {item.suggested_section}{item.reason ? ` — ${item.reason}` : ''}</div>}
                  {!unresolvedOverridden && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {item.suggested_section && (
                        <button disabled={item.resolving} onClick={async () => {
                          setUnresolvedNotes(prev => prev.map((n, idx) => idx === i ? { ...n, resolving: true } : n));
                          try {
                            const res = await fetch('/api/process-soc-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: item.note_text, session_id: socSessionId, project_id: projectId || null, resolution: 'allocated', force_section: item.suggested_section, source_note_index: item.note_index }) });
                            if (res.ok) setUnresolvedNotes(prev => prev.filter((_, idx) => idx !== i));
                            else setUnresolvedNotes(prev => prev.map((n, idx) => idx === i ? { ...n, resolving: false } : n));
                          } catch { setUnresolvedNotes(prev => prev.map((n, idx) => idx === i ? { ...n, resolving: false } : n)); }
                        }} style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                          {item.resolving ? 'Processing…' : `Add to ${item.suggested_section}`}
                        </button>
                      )}
                      {['Contextual', 'Site note', 'Exclude'].map(label => (
                        <button key={label} disabled={item.resolving} onClick={async () => {
                          setUnresolvedNotes(prev => prev.map((n, idx) => idx === i ? { ...n, resolving: true } : n));
                          try {
                            await fetch('/api/process-soc-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: item.note_text, session_id: socSessionId, project_id: projectId || null, resolution: label.toLowerCase().replace(' ', '_'), source_note_index: item.note_index }) });
                            setUnresolvedNotes(prev => prev.filter((_, idx) => idx !== i));
                          } catch { setUnresolvedNotes(prev => prev.map((n, idx) => idx === i ? { ...n, resolving: false } : n)); }
                        }} style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, background: label === 'Exclude' ? '#fee2e2' : 'var(--bg3)', color: label === 'Exclude' ? '#991b1b' : 'var(--text2)', border: label === 'Exclude' ? 'none' : '1px solid var(--border)', cursor: 'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!unresolvedOverridden && unresolvedNotes.length > 0 && (
                <button onClick={() => setUnresolvedOverridden(true)} style={{ marginTop: 8, padding: '6px 14px', borderRadius: 99, fontSize: 12, background: 'transparent', border: '1px solid #f59e0b', color: '#b45309', cursor: 'pointer' }}>
                  Generate draft with unresolved items
                </button>
              )}
            </div>
          )}

          {/* Preview iframe */}
          <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text3)' }}>
              Rendered from the server SOC template
            </div>
            <iframe title="Schedule of Condition Preview" srcDoc={previewHtml} style={{ width: '100%', minHeight: '75vh', border: 'none', background: '#fff' }} />
          </div>

          {structuredData && (
            <details style={s.card}>
              <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', cursor: 'pointer' }}>Structured data (JSON)</summary>
              <pre style={{ fontSize: 11, marginTop: 8, overflow: 'auto', maxHeight: 300, color: 'var(--text3)' }}>{JSON.stringify(structuredData, null, 2)}</pre>
            </details>
          )}
        </div>

        {oneDriveOverlay && (
          <SaveToOneDriveOverlay {...oneDriveOverlay} onClose={() => setOneDriveOverlay(null)} onOpenComposer={onOpenComposer} />
        )}
      </div>
    );
  }

  // ── Recording phase ───────────────────────────────────────────────────────
  const hasContent = messages.some(m => m.role === 'user');

  return (
    <div style={s.page}>
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <>
          <div style={s.sidebarOverlay} onClick={() => setSidebarOpen(false)} />
          <div style={s.sidebar}>
            <div style={s.sidebarHeader}>
              <span style={s.sidebarTitle}>SOC History</span>
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text2)' }}>✕</button>
            </div>
            <div style={s.sidebarList}>
              {loadingSessions ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
              ) : sessionHistory.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No saved sessions yet</div>
              ) : sessionHistory.map((s2, i) => {
                const isActive = s2.sessionId === socSessionId;
                return (
                  <div key={i} onClick={() => openSession(s2)}
                    style={{ ...s.sidebarItem, ...(isActive ? s.sidebarItemActive : {}), background: isActive ? 'var(--blue-bg)' : 'transparent' }}>
                    <div style={s.sidebarItemAddr}>{s2.aoAddress || `AO ${i + 1}`}</div>
                    <div style={s.sidebarItemMeta}>{s2.noteCount} note{s2.noteCount !== 1 ? 's' : ''} · {s2.lastUpdated ? new Date(s2.lastUpdated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</div>
                  </div>
                );
              })}
            </div>
            <button onClick={startNewSession} style={s.sidebarNewBtn}>+ New SOC session</button>
          </div>
        </>
      )}

      {/* Main content */}
      <div style={s.main}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <button style={s.hamburger} onClick={() => setSidebarOpen(true)}>☰</button>
            <div style={s.titleBlock}>
              <span style={s.titleMain}>SOC Dictation</span>
              {selectedAOAddress && <span style={s.titleSub}>{selectedAOAddress}</span>}
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!hasContent || processing}
            style={{ ...s.generateBtn, opacity: (!hasContent || processing) ? 0.5 : 1 }}
          >
            {processing ? 'Generating…' : 'Generate SOC'}
          </button>
        </div>

        {/* AO selector bar */}
        {aos.length > 1 && (
          <div style={s.aoBar}>
            <span style={s.aoLabel}>AO</span>
            <select style={s.aoSelect} value={selectedAOIndex} onChange={e => setSelectedAOIndex(e.target.value)}>
              {aos.map((ao, i) => (
                <option key={i} value={String(i)}>{ao.address || ao.ao_address || `AO ${i + 1}`}</option>
              ))}
            </select>
          </div>
        )}

        {/* Chat area */}
        <div style={s.chatArea}>
          {!hasContent && !isRecording && (
            <div style={s.emptyState}>
              <div style={s.emptyIcon}>🎙</div>
              <div>Tap the mic and start dictating your inspection notes.</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Each observation is saved as you go.</div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
              <div style={msg.role === 'user' ? s.userBubble : s.elyBubble}>
                {msg.content}
              </div>
            </div>
          ))}

          {interimText && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <div style={{ ...s.userBubble, opacity: 0.55, fontStyle: 'italic' }}>{interimText}</div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={s.inputArea}>
          <ChatInputBar
            value={textInput}
            onChange={setTextInput}
            onSend={() => handleSend()}
            onMicToggle={handleMicToggle}
            isRecording={isRecording}
            disabled={processing}
            placeholder="Dictate or type an observation…"
            inputRef={inputRef}
          />
        </div>
      </div>

      {oneDriveOverlay && (
        <SaveToOneDriveOverlay {...oneDriveOverlay} onClose={() => setOneDriveOverlay(null)} onOpenComposer={onOpenComposer} />
      )}
    </div>
  );
}
