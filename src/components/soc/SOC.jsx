import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import ChatInputBar from '../shared/ChatInputBar';
import SaveToOneDriveOverlay from '../shared/SaveToOneDriveOverlay';

function uid() { return Math.random().toString(36).slice(2); }

export default function SOC({ onOpenComposer, defaultProjectId, defaultAOIndex, onBack }) {
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
  const [socType, setSocType] = useState('general');
  const [previewHtml, setPreviewHtml] = useState('');
  const [structuredData, setStructuredData] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [partyDrafts, setPartyDrafts] = useState([]);
  const [unresolvedNotes, setUnresolvedNotes] = useState([]);
  const [auditIssues, setAuditIssues] = useState([]);
  const [auditWarnings, setAuditWarnings] = useState([]);
  const [unresolvedOverridden, setUnresolvedOverridden] = useState(false);
  const [editableSections, setEditableSections] = useState([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [editPersistPending, setEditPersistPending] = useState(false);
  const [generationIncomplete, setGenerationIncomplete] = useState(false);
  const [generationWarning, setGenerationWarning] = useState(null);

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

  // Tracks whether the session-related background fetches failed, so the UI
  // can surface a real error instead of letting socSessionId silently stay null.
  const [sessionLoadError, setSessionLoadError] = useState(null);

  // ── Auto-load existing session on mount if one exists for this project ───────
  // SOC opens blank — no auto-loading of previous sessions.
  // Previous sessions are accessed via the history sidebar only.
  // When AO changes, reset to blank state ready for new dictation.
  useEffect(() => {
    if (!projectId) return;
    // Reset to blank state when AO selection changes
    setMessages([]);
    setSocSessionId(null);
    setPhase('recording');
    setPreviewHtml('');
    setEditableSections([]);
    setStructuredData(null);
    setReportId(null);
    setSessionLoadError(null);

    async function autoLoadSession() {
      setSessionLoadError(null);
      try {
        const res = await fetch(`/api/soc-save?project_id=${projectId}`);
        if (!res.ok) throw new Error(`Failed to load SOC sessions (status ${res.status})`);
        const data = await res.json();
        if (!data.sessions?.length) {
          // No previous sessions — blank state is correct, nothing to do
          return;
        }
        // Do NOT auto-load any session — user must choose from sidebar
        // Just pre-fetch session list for sidebar
        return;
        // Find session matching current AO if possible, otherwise take most recent
        const aoId = aoIdValue(selectedAO, Number(selectedAOIndex));
        const match = data.sessions.find(s => s.aoId === String(aoId)) || data.sessions[0];
        if (!match) return;
        setSocSessionId(match.sessionId);
        // Load notes
        const notesRes = await fetch(`/api/soc-save?session_id=${match.sessionId}`);
        if (!notesRes.ok) throw new Error(`Failed to load SOC notes (status ${notesRes.status})`);
        const notesData = await notesRes.json();
        if (notesData.notes?.length) {
          setMessages(notesData.notes.map(m => ({ id: m.id, role: m.role, content: m.content })));
          if (phase === 'setup') setPhase('recording');
        }
        // Load existing report if one exists
        const reportRes = await fetch(`/api/soc-save?action=load_report&session_id=${match.sessionId}`);
        if (reportRes.ok) {
          const reportData = await reportRes.json();
          if (reportData.preview_html && reportData.structured_data) {
            setPreviewHtml(reportData.preview_html);
            setStructuredData(reportData.structured_data);
            setReportId(reportData.report_id || null);
            setEditableSections(JSON.parse(JSON.stringify(
              reportData.structured_data.edit_state?.sections || reportData.structured_data.sections || []
            )));
            setPhase('preview');
          }
        }
      } catch (err) {
        console.error('[SOC] autoLoadSession failed:', err);
        setSessionLoadError(err.message || 'Could not load this SOC session — check your connection and try again.');
      }
    }
    autoLoadSession();
  }, [projectId, selectedAOIndex]);

  const initSession = useCallback(async (aoId, aoAddr) => {
    // Find or create SOC session via API (service-role key)
    const initRes = await fetch('/api/soc-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'init_session', project_id: projectId, ao_id: aoId, ao_address: aoAddr }),
    });
    if (!initRes.ok) {
      console.error('[SOC] init_session HTTP error:', initRes.status);
      throw new Error(`Could not start the SOC session (server returned ${initRes.status}). Please try again.`);
    }
    const initData = await initRes.json();
    if (!initData.session_id) {
      console.error('[SOC] init_session failed:', initData);
      throw new Error(initData.error || 'Could not start the SOC session — please try again.');
    }
    // The session itself now exists and is usable — set this immediately so a
    // failure in the secondary fetches below (notes history, existing report)
    // can never leave the session "not ready" from the user's perspective.
    setSocSessionId(initData.session_id);

    // Load existing notes for this session — best-effort, non-fatal.
    try {
      const notesRes = await fetch(`/api/soc-save?session_id=${initData.session_id}`);
      if (notesRes.ok) {
        const notesData = await notesRes.json();
        if (notesData.notes?.length) {
          setMessages(notesData.notes.map(m => ({ id: m.id, role: m.role, content: m.content })));
        }
      } else {
        console.warn('[SOC] notes fetch returned', notesRes.status, '— continuing without history.');
      }
    } catch (err) {
      console.warn('[SOC] notes fetch failed — continuing without history:', err);
    }

    // Load existing SOC report for this session if one exists — best-effort, non-fatal.
    try {
      const reportRes = await fetch(`/api/soc-save?action=load_report&session_id=${initData.session_id}`);
      if (reportRes.ok) {
        const reportData = await reportRes.json();
        if (reportData.preview_html && reportData.structured_data) {
          setPreviewHtml(reportData.preview_html);
          setStructuredData(reportData.structured_data);
          setReportId(reportData.report_id || null);
          setEditableSections(JSON.parse(JSON.stringify(
            reportData.structured_data.edit_state?.sections || reportData.structured_data.sections || []
          )));
          setPhase('preview');
          return initData.session_id;
        }
      }
    } catch (err) {
      console.warn('[SOC] report fetch failed — continuing to recording phase:', err);
    }

    return initData.session_id;
  }, [projectId]);

  // ── Load session history for sidebar ────────────────────────────────────
  const loadSessionHistory = useCallback(async () => {
    if (!projectId) return;
    setLoadingSessions(true);
    try {
      const res = await fetch(`/api/soc-save?project_id=${projectId}`);
      const data = await res.json();
      if (data.sessions) setSessionHistory(data.sessions);
    } catch (e) { console.error(e); }
    setLoadingSessions(false);
  }, [projectId]);

  useEffect(() => {
    if (sidebarOpen) loadSessionHistory();
  }, [sidebarOpen, loadSessionHistory]);

  // ── Sync editable sections when structured data arrives ──────────────────
  useEffect(() => {
    if (structuredData?.sections) {
      // If there's an edit_state (saved manual edits), prefer that over AI draft
      const sectionsToUse = structuredData.edit_state?.sections || structuredData.sections;
      setEditableSections(JSON.parse(JSON.stringify(sectionsToUse)));
    }
    // Track report_id for save persistence
    if (structuredData?.report_id) setReportId(structuredData.report_id);
    // Handle incomplete/emergency generation states
    if (structuredData?.generation_status === 'incomplete') {
      setGenerationIncomplete(true);
      setGenerationWarning(structuredData.warning || 'Generation incomplete — please retry.');
    } else if (structuredData?._emergency_draft) {
      setGenerationIncomplete(true);
      setGenerationWarning(structuredData._generation_note || 'Emergency draft — claim extraction failed. Retry for complete SOC.');
    } else {
      setGenerationIncomplete(false);
      setGenerationWarning(null);
    }
  }, [structuredData]);

  // Open a historical session from the sidebar
  const openSession = useCallback(async (session) => {
    setSocSessionId(session.sessionId);
    setMessages([]);
    setPreviewHtml('');
    setStructuredData(null);
    setSidebarOpen(false);

    const res = await fetch(`/api/soc-save?session_id=${session.sessionId}`);
    const data = await res.json();
    if (data.notes?.length) {
      setMessages(data.notes.map(m => ({ id: m.id, role: m.role, content: m.content })));
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
    if (!socSessionId) {
      const reason = sessionLoadError
        ? `SOC session could not be loaded: ${sessionLoadError}`
        : 'SOC session is not ready yet. This can happen if "Start SOC" was not completed, or the connection dropped.';
      alert(`${reason}\n\nTry going back to the project and starting the SOC again.`);
      return;
    }

    const msgId = uid();
    setMessages(prev => [...prev, { id: msgId, role: 'user', content: userContent }]);
    setTextInput('');

    // Save via API route (service-role key required)
    const saveRes = await fetch('/api/soc-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_note', session_id: socSessionId, content: userContent, project_id: projectId || null }),
    });
    if (saveRes.ok) {
      setMessages(prev => [...prev, { id: msgId + '-ack', role: 'ely', content: 'Noted.' }]);
    } else {
      const err = await saveRes.json().catch(() => ({}));
      console.error('[SOC] save_note failed:', err);
      setMessages(prev => [...prev, { id: msgId + '-err', role: 'ely', content: '⚠ Note could not be saved. Check your connection.' }]);
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
          soc_type: socType,
          ao_id: aoIdValue(selectedAO, Number(selectedAOIndex)),
          ao_name: aoName(selectedAO),
          ao_names: aoName(selectedAO),
          ao_address: selectedAOAddress,
          ao_premise_address: selectedAOAddress,
          ao_service_address: selectedAO?.service_address || selectedAO?.serviceAddress || selectedAO?.reg_addr || selectedAOAddress || '',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.details || payload.message || `Could not generate Schedule of Condition. (${response.status})`);
      
      // GENERATION_INCOMPLETE — show warning and allow retry rather than hard error
      if (!payload.preview_html && payload.generation_status === 'incomplete') {
        setGenerationWarning(payload.warning || 'Generation incomplete — please retry.');
        setGenerationIncomplete(true);
        return;
      }
      
      if (!payload.preview_html) {
        const reason = payload.warning || payload.error || payload.details || 'The SOC API did not return preview_html.';
        throw new Error(reason);
      }

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

  // ── Get re-rendered HTML from current edited sections ───────────────────
  const getRenderedHtml = useCallback(async () => {
    // Always use the current edited sections — these are the authoritative state
    const editedData = {
      ...(structuredData || {}),
      sections: editableSections,
      report_id: reportId,
    };
    const res = await fetch('/api/generate-soc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        final_soc_data: editedData,
        project_id: projectId,
        ao_id: aoIdValue(selectedAO, Number(selectedAOIndex)),
        ao_name: aoName(selectedAO),
        ao_address: selectedAOAddress,
        ao_premise_address: selectedAOAddress,
      }),
    });
    if (!res.ok) throw new Error('Could not re-render SOC');
    const data = await res.json();
    if (data.preview_html) setPreviewHtml(data.preview_html);
    return data.preview_html;
  }, [structuredData, editableSections, reportId, projectId, selectedAO, selectedAOIndex, selectedAOAddress]);

  // ── Save draft ────────────────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    setSavingDraft(true);
    try {
      await getRenderedHtml();
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSavingDraft(false);
    }
  }, [getRenderedHtml]);

  // ── Print / PDF ──────────────────────────────────────────────────────────
  const printPreview = useCallback(async () => {
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      const htmlToExport = editableSections.length > 0 ? await getRenderedHtml() : previewHtml;
      if (!htmlToExport) { setPdfProcessing(false); return; }
      const res = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlToExport, filename: safeFilename }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFilename}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      alert('PDF error: ' + err.message);
    } finally {
      setPdfProcessing(false);
    }
  }, [previewHtml, projectAddress, selectedAOAddress]);

  const handleSaveAndEmail = useCallback(async () => {
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      const htmlToExport = editableSections.length > 0 ? await getRenderedHtml() : previewHtml;
      if (!htmlToExport) { setPdfProcessing(false); return; }
      const res = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlToExport, filename: safeFilename }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      setOneDriveOverlay({ base64, filename: `${safeFilename}.pdf`, projectId, previewHtml: htmlToExport });
    } catch (err) {
      alert('Save error: ' + err.message);
    } finally {
      setPdfProcessing(false);
    }
  }, [onOpenComposer, previewHtml, projectAddress, projectId, selectedAO, selectedAOAddress]);

  // ── Section list + review-phase helpers ─────────────────────────────────
  const STANDARD_SECTIONS = [
    'Ground Floor Front Elevation Room','Ground Floor Rear Elevation Room',
    'Ground Floor Rear Extension','Ground Floor Rear Outrigger','Ground Floor Rear Outrigger Kitchen',
    'First Floor Rear Bedroom','First Floor Front Elevation Room',
    'External Areas','Site Notes',
    'Front Elevation','Rear Elevation','Side Flank Wall','Entrance Hall','Lounge',
    'Dining Room','Kitchen','Utility Room','Ground Floor WC','Landing and Stairs',
    'Front Bedroom','Rear Bedroom','Bathroom','Loft Space','Rear Garden',
    'Garage','Shared Driveway','Outbuilding',
  ];

  const flaggedNoteIds = new Set((unresolvedNotes || []).map(n => n.note_index));
  const flaggedSectionTitles = new Set(
    (auditIssues || [])
      .filter(i => /^Section "/.test(i))
      .map(i => { const m = i.match(/^Section "([^"]+)"/); return m ? m[1] : null; })
      .filter(Boolean)
  );

  function isRowFlagged(row) {
    // Only flag rows whose source notes were genuinely unresolved/unallocated
    return (row.source_note_ids || []).some(id => flaggedNoteIds.has(id));
  }

  function moveRow(fromSectionIdx, rowIdx, toSectionTitle) {
    setEditableSections(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const [row] = next[fromSectionIdx].rows.splice(rowIdx, 1);
      const toIdx = next.findIndex(s => s.title === toSectionTitle);
      if (toIdx >= 0) next[toIdx].rows.push(row);
      const filtered = next.filter(s => s.rows.length > 0);
      schedulePersistEdits(filtered);
      return filtered;
    });
  }

  function deleteRow(sectionIdx, rowIdx) {
    setEditableSections(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const [removed] = next[sectionIdx].rows.splice(rowIdx, 1);
      // Mark source claims as excluded in DB (non-blocking)
      if (removed?.source_claim_ids?.length && reportId) {
        fetch('/api/soc-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mark_claims_excluded',
            report_id: reportId,
            session_id: socSessionId,
            claim_ids: removed.source_claim_ids,
            row_ref: removed.ref,
          }),
        }).catch(e => console.warn('[SOC] claim exclusion update failed:', e.message));
      }
      const filtered = next.filter(s => s.rows.length > 0);
      schedulePersistEdits(filtered);
      return filtered;
    });
  }

  function updateRowField(sectionIdx, rowIdx, field, value) {
    setEditableSections(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next[sectionIdx].rows[rowIdx][field] = value;
      schedulePersistEdits(next);
      return next;
    });
  }

  // ── Auto-persist manual edits to Supabase ───────────────────────────────
  const persistEditsRef = useRef(null);
  function schedulePersistEdits(newSections) {
    if (!reportId) return;
    if (persistEditsRef.current) clearTimeout(persistEditsRef.current);
    persistEditsRef.current = setTimeout(async () => {
      setEditPersistPending(true);
      try {
        await fetch('/api/soc-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_edited_preview',
            report_id: reportId,
            edited_sections: newSections,
            session_id: socSessionId,
          }),
        });
      } catch (e) {
        console.warn('[SOC] auto-save failed:', e.message);
      } finally {
        setEditPersistPending(false);
      }
    }, 1500); // debounce 1.5s
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const s = {
    page: { display: 'flex', height: '100%', position: 'relative', overflow: 'hidden' },
    // Sidebar
    sidebarOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 550 },
    sidebar: { position: 'fixed', left: 0, top: 0, bottom: 0, width: 280, background: 'var(--bg)', borderRight: '1px solid var(--border)', zIndex: 551, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 20px rgba(0,0,0,0.15)' },
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
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 8, position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)' },
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
    aoBar: { padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 57, zIndex: 9, background: 'var(--bg)' },
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
          <div style={s.headerLeft}>
            {onBack && <button onClick={onBack} style={s.secondaryBtn}>← Back to Project</button>}
            <div style={s.titleMain}>SOC Dictation</div>
          </div>
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
          <div style={s.field}>
            <label style={s.label}>Schedule Type</label>
            <select style={s.aoSelect} value={socType} onChange={e => setSocType(e.target.value)}>
              <option value="general">General SOC</option>
              <option value="dispute">Dispute SOC</option>
            </select>
          </div>
          <button
            disabled={!projectId}
            onClick={async () => {
              const aoId = aoIdValue(selectedAO, Number(selectedAOIndex));
              const aoAddr = selectedAOAddress || aoName(selectedAO) || 'Adjoining Owner';
              try {
                await initSession(aoId, aoAddr);
                setPhase('recording');
              } catch (err) {
                console.error('[SOC] Start SOC failed:', err);
                alert(err.message || 'Could not start the SOC session — please check your connection and try again.');
              }
            }}
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
    const allSectionTitles = [
      ...new Set([...editableSections.map(s => s.title), ...STANDARD_SECTIONS]),
    ];
    const flaggedCount = editableSections.reduce(
      (n, sec) => n + sec.rows.filter(r => isRowFlagged(r)).length, 0
    );

    return (
      <div style={s.reviewPage}>
        {/* Header */}
        <div style={s.reviewHeader}>
          <button onClick={() => setPhase('recording')} style={s.secondaryBtn}>← Back</button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleSaveDraft}
              disabled={savingDraft}
              style={{ ...s.secondaryBtn, ...(draftSaved ? { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' } : {}) }}
            >
              {savingDraft ? 'Saving…' : draftSaved ? '✓ Saved' : '💾 Save draft'}
            </button>
            <button onClick={handleSaveAndEmail} disabled={pdfProcessing} style={{ ...s.primaryBtn, background: '#10b981', opacity: pdfProcessing ? 0.65 : 1 }}>
              {pdfProcessing ? '…' : '📧 Email'}
            </button>
            <button onClick={printPreview} disabled={pdfProcessing} style={{ ...s.primaryBtn, opacity: pdfProcessing ? 0.65 : 1 }}>
              {pdfProcessing ? '…' : '⬇ Download'}
            </button>
          </div>
        </div>

        <div style={s.reviewContent}>
          {/* Generation incomplete warning */}
          {generationIncomplete && (
            <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, fontSize: 13, color: '#991b1b', marginBottom: 8 }}>
              ⚠ <strong>Generation incomplete</strong> — {generationWarning || 'Some stages failed. This draft may be missing content.'} This is not a complete Schedule of Conditions.
              <button onClick={() => setPhase('recording')} style={{ marginLeft: 12, fontSize: 12, color: '#991b1b', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>
                ← Retry generation
              </button>
            </div>
          )}

          {/* Edit persist indicator */}
          {editPersistPending && (
            <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right', marginBottom: 4 }}>Saving edits…</div>
          )}

          {/* Flagged summary */}
          {flaggedCount > 0 && (
            <div style={{ padding: '10px 14px', background: '#fffbe6', border: '1px solid #f59e0b', borderRadius: 10, fontSize: 13, color: '#92400e' }}>
              ⚠ {flaggedCount} item{flaggedCount !== 1 ? 's' : ''} highlighted for review — will remain in the report unless edited, reassigned or removed
            </div>
          )}

          {/* Editable sections */}
          {editableSections.map((section, sIdx) => (
            <div key={sIdx} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', padding: '10px 2px 6px', borderBottom: '2px solid var(--border)', marginBottom: 6 }}>
                <input
                  value={section.title}
                  onChange={e => {
                    const next = JSON.parse(JSON.stringify(editableSections));
                    next[sIdx].title = e.target.value;
                    setEditableSections(next);
                  }}
                  style={{ border: 'none', background: 'transparent', fontWeight: 700, fontSize: 'inherit', color: 'inherit', width: '100%', outline: 'none', cursor: 'text' }}
                  title="Click to rename section"
                />
                {flaggedSectionTitles.has(section.title) && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#b45309', background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 7px', marginLeft: 10 }}>
                    ⚠ check no-defects wording
                  </span>
                )}
              </div>
              {(section.rows || []).map((row, rIdx) => {
                const flagged = isRowFlagged(row);
                return (
                  <div key={rIdx} style={{
                    background: flagged ? '#fffbeb' : 'var(--bg2)',
                    border: `1px solid ${flagged ? '#fcd34d' : 'var(--border)'}`,
                    borderRadius: 8,
                    padding: '10px 12px',
                    marginBottom: 6,
                  }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <input
                        value={row.ref || ''}
                        onChange={e => updateRowField(sIdx, rIdx, 'ref', e.target.value)}
                        style={{ ...s.input, width: 64, fontWeight: 700, fontSize: 12, padding: '4px 6px', textAlign: 'center' }}
                      />
                      <select
                        value={section.title}
                        onChange={e => { if (e.target.value !== section.title) moveRow(sIdx, rIdx, e.target.value); }}
                        style={{ ...s.aoSelect, flex: 1, fontSize: 12, padding: '4px 8px' }}
                      >
                        {allSectionTitles.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <textarea
                      value={row.observation || ''}
                      onChange={e => updateRowField(sIdx, rIdx, 'observation', e.target.value)}
                      rows={3}
                      style={{ ...s.input, width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.5, boxSizing: 'border-box', display: 'block' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{row.action || 'Record only'}</div>
                        {flagged && row.flag_reason && (
                          <div style={{ fontSize: 11, color: '#b45309', fontStyle: 'italic' }}>{row.flag_reason}</div>
                        )}
                      </div>
                      <button
                        onClick={() => { if (window.confirm('Remove this row? Source claims will be marked excluded.')) deleteRow(sIdx, rIdx); }}
                        style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                        title="Remove row and mark source claims as excluded"
                      >✕ Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Editable site notes */}
          {(() => {
            const siteNotes = structuredData?.site_notes || structuredData?.award_notes || [];
            if (!siteNotes.length) return (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', padding: '10px 2px 6px', borderBottom: '2px solid var(--border)', marginBottom: 6 }}>
                  Site Notes
                </div>
                <button
                  onClick={() => setStructuredData(prev => ({ ...prev, site_notes: [{ description: '' }] }))}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}
                >+ Add site note</button>
              </div>
            );
            return (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', padding: '10px 2px 6px', borderBottom: '2px solid var(--border)', marginBottom: 6 }}>
                  Site Notes
                </div>
                {siteNotes.map((note, nIdx) => {
                  const text = typeof note === 'string' ? note : (note.description || note.topic || '');
                  return (
                    <div key={nIdx} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 6, display: 'flex', gap: 8 }}>
                      <textarea
                        defaultValue={text}
                        rows={2}
                        style={{ ...s.input, flex: 1, resize: 'vertical', fontSize: 13, lineHeight: 1.5, boxSizing: 'border-box', display: 'block' }}
                        onChange={e => {
                          const updated = [...siteNotes];
                          updated[nIdx] = { description: e.target.value };
                          setStructuredData(prev => ({ ...prev, site_notes: updated }));
                        }}
                      />
                      <button
                        onClick={() => {
                          const updated = siteNotes.filter((_, i) => i !== nIdx);
                          setStructuredData(prev => ({ ...prev, site_notes: updated }));
                        }}
                        style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'flex-start', padding: '4px' }}
                      >✕</button>
                    </div>
                  );
                })}
                <button
                  onClick={() => {
                    const updated = [...siteNotes, { description: '' }];
                    setStructuredData(prev => ({ ...prev, site_notes: updated }));
                  }}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', marginTop: 4 }}
                >+ Add site note</button>
              </div>
            );
          })()}
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
            {onBack && <button onClick={onBack} style={s.secondaryBtn}>← Project</button>}
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
