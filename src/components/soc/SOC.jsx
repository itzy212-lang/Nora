import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import ChatInputBar from '../shared/ChatInputBar';
import SaveToOneDriveOverlay from '../shared/SaveToOneDriveOverlay';

function uid() { return Math.random().toString(36).slice(2); }

export default function SOC({ onOpenComposer, defaultProjectId, defaultAOIndex }) {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState(defaultProjectId ? 'recording' : 'setup');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [messages, setMessages] = useState([]); // chat bubbles
  const [interimText, setInterimText] = useState(''); // live preview line
  const [isRecording, setIsRecording] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const [oneDriveOverlay, setOneDriveOverlay] = useState(null); // { fileBase64, fileName, mimeType }
  const [selectedAOIndex, setSelectedAOIndex] = useState('0');
  const [previewHtml, setPreviewHtml] = useState('');
  const [structuredData, setStructuredData] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [partyDrafts, setPartyDrafts] = useState([]);
  const [sessionId] = useState(() => uid()); // stable for the lifetime of this inspection

  const recognitionRef = useRef(null);
  const accumulatedRef = useRef(''); // all finalised speech across restarts since last Send
  const committedRef = useRef('');   // finalised speech in THIS recognition session only
  const interimRef = useRef('');     // current interim
  const restartTimerRef = useRef(null);
  const shouldRecordRef = useRef(false); // continuous recording intent
  const messagesEndRef = useRef(null);

  const selectedProject = projects.find(p => p.id === projectId);
  const projectAddress = selectedProject?.address || selectedProject?.premise_address || selectedProject?.bo_premise_address || '';
  const aoOptions = Array.isArray(selectedProject?.aos) ? selectedProject.aos : [];
  const selectedAO = aoOptions[Number(selectedAOIndex)] || aoOptions[0] || null;
  const selectedAOAddress = selectedAO?.premise || selectedAO?.reg_addr || selectedAO?.address || selectedAO?.ao_premise_address || '';

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!defaultProjectId) return;
    setProjectId(defaultProjectId);
    setSelectedAOIndex(defaultAOIndex != null ? String(defaultAOIndex) : '0');
    setPreviewHtml(''); setStructuredData(null); setReportId(null); setPartyDrafts([]);
    setPhase('recording');
  }, [defaultProjectId, defaultAOIndex]);

  useEffect(() => {
    setSelectedAOIndex('0');
    setPreviewHtml(''); setStructuredData(null); setReportId(null); setPartyDrafts([]);
  }, [projectId]);

  useEffect(() => {
    setPreviewHtml(''); setStructuredData(null); setReportId(null); setPartyDrafts([]);
  }, [selectedAOIndex]);

  // ── Guard against accidental navigation when SOC is generated ─────────────
  useEffect(() => {
    if (phase !== 'review' || !previewHtml) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const handlePopState = () => {
      const confirmed = window.confirm("You have a generated Schedule of Condition that hasn't been downloaded yet. Are you sure you want to leave? Your SOC will be lost.");
      if (!confirmed) {
        window.history.pushState(null, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [phase, previewHtml]);

  function projectOptionLabel(p) { return p?.address || p?.premise_address || p?.bo_premise_address || p?.ref || 'Project'; }
  function aoOptionLabel(ao, index) { return ao?.premise || ao?.reg_addr || ao?.address || ao?.ao_premise_address || `AO${index + 1}`; }
  function aoName(ao) { return [ao?.name || ao?.ao_name_1, ao?.name2 || ao?.ao_name_2].filter(Boolean).join(' & '); }
  function aoIdValue(ao, index) { return String(ao?.id || ao?.num || index || '0'); }

  const getProjectContacts = useCallback(() => {
    if (!selectedProject) return [];
    const contacts = [];
    if (selectedProject.bo_email) contacts.push({ label: `Building Owner - ${selectedProject.bo_name || selectedProject.bo_1_name || ''}`, email: selectedProject.bo_email });
    if (selectedProject.architect_email) contacts.push({ label: `Architect - ${selectedProject.architect_name || ''}`, email: selectedProject.architect_email });
    if (selectedProject.se_email) contacts.push({ label: `Structural Engineer - ${selectedProject.se_name || ''}`, email: selectedProject.se_email });
    (selectedProject.aos || []).forEach((ao, i) => {
      if (ao.surveyor_email || ao.surv_email) contacts.push({ label: `AO Surveyor AO${i + 1} - ${ao.surveyor_name || ao.surv_name || ''}`, email: ao.surveyor_email || ao.surv_email });
      if (ao.email) contacts.push({ label: `Adjoining Owner AO${i + 1} - ${ao.name || ''}`, email: ao.email });
    });
    return contacts;
  }, [selectedProject]);

  // ── Recording logic ────────────────────────────────────────────────────────

  const buildRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const rec = new SR();
    rec.continuous = false;      // false = cleaner results on mobile Chrome
    rec.interimResults = true;
    rec.lang = 'en-GB';
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setIsRecording(true);
    };

    rec.onresult = (event) => {
      let finalText = '';
      let interim = '';
      // Rebuild from scratch each event to avoid duplication
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const text = (r[0]?.transcript || '').trim();
        if (!text) continue;
        if (r.isFinal) {
          finalText = [finalText, text].filter(Boolean).join(' ');
        } else {
          interim = text;
        }
      }
      // Store finals for this session (overwrite, don't append — rebuilt above)
      if (finalText) committedRef.current = finalText;
      interimRef.current = interim;
      // Preview = everything accumulated + this session finals + current interim
      const preview = [accumulatedRef.current, committedRef.current, interim].filter(Boolean).join(' ');
      setInterimText(preview);
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[SOC] speech error:', e.error);
    };

    rec.onend = () => {
      // Move this session's finals into accumulator
      if (committedRef.current) {
        accumulatedRef.current = [accumulatedRef.current, committedRef.current].filter(Boolean).join(' ');
        committedRef.current = '';
      }
      // Auto-restart if still meant to be recording
      if (shouldRecordRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (!shouldRecordRef.current) return;
          const newRec = buildRecognition();
          if (!newRec) return;
          recognitionRef.current = newRec;
          try { newRec.start(); } catch {}
        }, 150);
      } else {
        setIsRecording(false);
      }
    };

    return rec;
  }, []);

  const startRecording = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice recording requires Chrome or Edge.');
      return;
    }
    committedRef.current = '';
    accumulatedRef.current = '';
    interimRef.current = '';
    setInterimText('');
    shouldRecordRef.current = true;

    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, [buildRecognition]);

  const stopRecording = useCallback(() => {
    shouldRecordRef.current = false;
    clearTimeout(restartTimerRef.current);
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
    setIsRecording(false);
  }, []);

  const [socPhoto, setSocPhoto] = useState(null); // { base64, mimeType, name }
  const photoInputRef = useRef(null);

  // Detect if message is a question or help request — needs a real response
  const isQuestion = useCallback((text = '') => {
    const lower = text.toLowerCase().trim();
    return lower.endsWith('?') ||
      /^(what|how|why|when|where|who|is|are|can|could|should|would|does|do|help|describe|explain|tell me|not sure|i don't know|i'm not sure|unclear|confused|struggling|what do you think|what would you|how would you|can you|could you)/i.test(lower) ||
      lower.includes('help') || lower.includes('describe') || lower.includes('not sure') ||
      lower.includes('struggling') || lower.includes('unclear') || lower.includes('how do i');
  }, []);

  // Call Ely for a real response (questions, photo descriptions)
  const askEly = useCallback(async (note, photoData = null) => {
    try {
      if (photoData) {
        // Vision call via secure server endpoint
        const res = await fetch('/api/soc-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: photoData.base64,
            mime_type: photoData.mimeType,
            note: note || '',
            context: selectedAOAddress ? `Inspection at ${selectedAOAddress}` : '',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Vision call failed');
        return data.description || 'Could not describe the photo.';
      } else {
        // Text question — call ely-smart
        const res = await fetch('/api/ely-smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `You are assisting a party wall surveyor during a Schedule of Condition inspection. Answer this question concisely and practically in one or two sentences:\n\n${note}`,
            surface: 'soc_chat',
            projectId: projectId || undefined,
          }),
        });
        const data = await res.json();
        return data.reply || 'Sorry, I couldn\'t process that.';
      }
    } catch (err) {
      console.warn('[SOC] askEly error:', err.message);
      return 'Sorry, something went wrong. Please try again.';
    }
  }, [selectedAOAddress, projectId]);

  // Handle photo selection
  const handlePhotoChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(',')[1];
      setSocPhoto({ base64, mimeType: file.type, name: file.name });
      setMessages(prev => [...prev, {
        id: uid(), role: 'user',
        content: `📷 Photo attached: ${file.name}`,
        isPhoto: true,
      }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  // Send current note as a chat bubble
  const handleSend = useCallback(async (overrideText) => {
    const voiceNote = [accumulatedRef.current, committedRef.current, interimRef.current].filter(Boolean).join(' ').trim();
    const note = overrideText || voiceNote || textInput.trim();
    if (!note && !socPhoto) return;

    stopRecording();
    setInterimText('');
    setTextInput('');
    committedRef.current = '';
    accumulatedRef.current = '';
    interimRef.current = '';

    const photo = socPhoto;
    setSocPhoto(null);

    const userContent = note || (photo ? `Describe this photo` : '');

    setMessages(prev => [
      ...prev,
      { id: uid(), role: 'user', content: userContent },
      { id: uid(), role: 'ely', content: '…', pending: true },
    ]);

    // Decide response type
    const needsEly = photo || isQuestion(userContent);

    if (needsEly) {
      const reply = await askEly(note, photo || null);
      setMessages(prev => prev.map(m => m.pending ? { ...m, content: reply, pending: false } : m));
    } else {
      // Send to per-note SOC processor
      try {
        const res = await fetch('/api/process-soc-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: userContent,
            session_id: sessionId,
            project_id: projectId || null,
            ao_id: aoIdValue(selectedAO, Number(selectedAOIndex)),
          }),
        });
        if (!res.ok) console.error('[SOC] process-soc-note HTTP error:', res.status, await res.text().catch(() => ''));
        const data = await res.json().catch(() => ({}));
        const reply = data.response || 'Noted.';
        setMessages(prev => prev.map(m => m.pending ? { ...m, content: reply, pending: false } : m));
      } catch (err) {
        console.error('[SOC] process-soc-note failed:', err);
        setMessages(prev => prev.map(m => m.pending ? { ...m, content: 'Noted.', pending: false } : m));
      }
    }
  }, [stopRecording, textInput, socPhoto, isQuestion, askEly]);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      handleSend();
    } else {
      startRecording();
    }
  }, [isRecording, handleSend, startRecording]);

  const handleGenerate = useCallback(async () => {
    // Collect all user messages as the full transcript
    const allNotes = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n\n');

    // Also grab anything currently in the mic (including accumulated finalised speech not yet sent)
    const currentNote = [accumulatedRef.current, committedRef.current, interimRef.current].filter(Boolean).join(' ').trim();
    const text = [allNotes, currentNote].filter(Boolean).join('\n\n');

    if (!text.trim()) { alert('No notes to process.'); return; }
    if (!projectId) { alert('Please select a project first.'); return; }

    stopRecording();
    setProcessing(true);

    try {
      const response = await fetch('/api/generate-soc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          project_id: projectId,
          session_id: sessionId,
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
      setReportId(payload.report_id || null);
      setPartyDrafts(payload.partyDrafts || []);
      setPhase('review');
    } catch (err) {
      alert('Error generating SOC: ' + (err.message || err));
    } finally {
      setProcessing(false);
    }
  }, [messages, projectId, selectedAO, selectedAOAddress, selectedAOIndex, stopRecording]);

  const printPreview = useCallback(async () => {
    if (!previewHtml) return;
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      const response = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          html: previewHtml, 
          filename: `${safeFilename}.pdf`, 
          ao_address: selectedAOAddress,
          project_id: projectId || null,
          ao_id: selectedAO?.id || selectedAO?.num || null,
          user_id: 'help@sq1consulting.co.uk',
        }),
      });
      if (!response.ok) { const p = await response.json().catch(() => ({})); throw new Error(p.error || 'Could not generate PDF.'); }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${safeFilename}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { alert('Error downloading SOC PDF: ' + (err.message || err)); }
    finally { setPdfProcessing(false); }
  }, [previewHtml, projectAddress, selectedAOAddress]);

  const sendSOCByEmail = useCallback(async () => {
    if (!previewHtml) return;
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

      const response = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: previewHtml,
          filename: `${safeFilename}.pdf`,
          ao_address: selectedAOAddress,
          project_id: projectId || null,
          ao_id: selectedAO?.id || selectedAO?.num || null,
          user_id: 'help@sq1consulting.co.uk',
        }),
      });

      if (!response.ok) {
        const p = await response.json().catch(() => ({}));
        throw new Error(p.error || 'Could not generate PDF.');
      }

      const blob = await response.blob();
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      onOpenComposer?.({
        mode: 'compose',
        to: '',
        subject: `Schedule of Condition - ${selectedAOAddress || projectAddress || ''}`,
        body: `Dear [Recipient]\n\nPlease find attached the Schedule of Condition prepared in connection with the proposed works at ${projectAddress || '[Building Owner property]'}.\n\nThis schedule records the existing condition of the adjoining property at ${selectedAOAddress || '[Adjoining Owner property]'} prior to commencement of the notified works.\n\nPlease do not hesitate to contact me should you require any further information.\n\nYours sincerely\nItzik`,
        projectId,
        attachments: [{ name: `${safeFilename}.pdf`, type: 'application/pdf', data: base64 }],
      });
    } catch (err) {
      alert('Error preparing SOC email: ' + (err.message || err));
    } finally {
      setPdfProcessing(false);
    }
  }, [onOpenComposer, previewHtml, projectAddress, projectId, selectedAO, selectedAOAddress]);

  const handleSaveAndEmail = useCallback(async () => {
    if (!previewHtml) return;
    setPdfProcessing(true);
    try {
      const filenameBase = selectedAOAddress || projectAddress || 'Schedule of Condition';
      const safeFilename = `Schedule of Condition - ${filenameBase}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

      const response = await fetch('/api/export-soc-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: previewHtml,
          filename: `${safeFilename}.pdf`,
          ao_address: selectedAOAddress,
          project_id: projectId || null,
          ao_id: selectedAO?.id || selectedAO?.num || null,
          user_id: 'help@sq1consulting.co.uk',
        }),
      });

      if (!response.ok) throw new Error('Could not generate PDF.');

      const blob = await response.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Open OneDrive folder selector overlay
      setOneDriveOverlay({
        fileName: `${safeFilename}.pdf`,
        fileBase64: base64,
        mimeType: 'application/pdf',
        safeFilename,
        base64ForEmail: base64,
      });
    } catch (err) {
      alert('Error preparing PDF: ' + (err.message || err));
    } finally {
      setPdfProcessing(false);
    }
  }, [previewHtml, projectAddress, projectId, selectedAO, selectedAOAddress]);

  const contacts = getProjectContacts();

  // ── Setup phase ────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>SOC Dictation</h1>
        </div>
        <div style={s.card}>
          <div style={s.field}>
            <label style={s.label}>Select project</label>
            <select style={s.select} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{projectOptionLabel(p)}</option>)}
            </select>
          </div>
          <button style={{ ...s.primaryBtn, opacity: !projectId ? 0.5 : 1 }} disabled={!projectId} onClick={() => setPhase('recording')}>
            Continue
          </button>
          <div style={s.hint}>Select the project, then choose the relevant Adjoining Owner property before recording.</div>
        </div>
      </div>
    );
  }

  // ── Recording phase ────────────────────────────────────────────────────────
  if (phase === 'recording') {
    const hasContent = messages.some(m => m.role === 'user');

    return (
      <div style={s.page}>
        {/* Header */}
        <div style={s.header}>
          <h1 style={s.title}>SOC Dictation</h1>
          <button onClick={handleGenerate} style={{ ...s.primaryBtn, opacity: (!hasContent || processing) ? 0.5 : 1 }} disabled={!hasContent || processing}>
            {processing ? 'Generating…' : 'Generate SOC'}
          </button>
        </div>

        {/* AO selectors */}
        <div style={s.card}>
          <div style={s.socSelectors}>
            <div style={s.field}>
              <label style={s.label}>Building Owner property</label>
              <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text2)' }} value={projectAddress} disabled />
            </div>
            <div style={s.field}>
              <label style={s.label}>Adjoining Owner property</label>
              {aoOptions.length > 1 ? (
                <select style={s.select} value={selectedAOIndex} onChange={e => setSelectedAOIndex(e.target.value)}>
                  {aoOptions.map((ao, idx) => <option key={ao.id || ao.num || idx} value={idx}>{aoOptionLabel(ao, idx)}</option>)}
                </select>
              ) : (
                <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text2)' }} value={selectedAOAddress} disabled placeholder="No adjoining owner address recorded" />
              )}
            </div>
          </div>
        </div>

        {/* Chat messages */}
        <div style={s.chatArea}>
          {messages.length === 0 && (
            <div style={s.emptyHint}>
              Tap the mic to start recording. Dictate an observation, then tap Send. Each note appears as a bubble.
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
              <div style={msg.role === 'user' ? s.userBubble : s.elyBubble}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Live interim preview */}
          {interimText && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <div style={{ ...s.userBubble, opacity: 0.55, fontStyle: 'italic' }}>
                {interimText}
              </div>
            </div>
          )}

          {processing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', color: 'var(--blue)', fontSize: 13 }}>
              <div style={s.spinner} /> Generating Schedule of Condition…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div style={{ ...s.inputBar, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          {/* Hidden photo input */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />
          <ChatInputBar
            value={interimText || textInput}
            onChange={(v) => { setInterimText(''); setTextInput(v); }}
            onSend={() => handleSend()}
            onTranscript={(transcript, meta) => {
              if (!meta?.recording) { setInterimText(''); setTextInput(transcript); }
            }}
            onPreview={(preview) => { if (preview) setInterimText(preview); }}
            placeholder="Type, paste or tap mic to dictate…"
            showAttach={true}
            onAttach={() => photoInputRef.current?.click()}
            disabled={false}
            loading={false}
          />
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    );
  }

  // ── Review phase ───────────────────────────────────────────────────────────
  return (
    <>
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Schedule of Condition - Review</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => {
            if (!window.confirm("Are you sure you want to go back? Your generated SOC will be lost.")) return;
            setPhase('recording');
          }} style={s.secondaryBtn}>Back</button>
          <button onClick={sendSOCByEmail} disabled={pdfProcessing} style={{ ...s.secondaryBtn, opacity: pdfProcessing ? 0.65 : 1 }}>{pdfProcessing ? 'Preparing…' : 'Send SOC by Email'}</button>
          <button onClick={handleSaveAndEmail} disabled={pdfProcessing} style={{ ...s.secondaryBtn, opacity: pdfProcessing ? 0.65 : 1, background: '#10b981', color: '#fff', border: 'none' }}>
            {pdfProcessing ? 'Preparing…' : '💾 Save & Email'}
          </button>
          <button onClick={printPreview} style={{ ...s.primaryBtn, opacity: pdfProcessing ? 0.65 : 1 }} disabled={pdfProcessing}>
            {pdfProcessing ? 'Generating PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Adjoining Owner property</label>
            <input style={s.input} value={selectedAOAddress} disabled />
          </div>
          <div style={s.field}>
            <label style={s.label}>Report ID</label>
            <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text3)' }} value={reportId || 'Not saved yet'} disabled />
          </div>
        </div>
      </div>

      <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text3)' }}>
          Rendered from the server SOC template
        </div>
        <iframe title="Schedule of Condition Preview" srcDoc={previewHtml} style={{ width: '100%', minHeight: '75vh', border: 'none', background: '#fff' }} />
      </div>

      {structuredData && (
        <details style={s.card}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Structured SOC data</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 }}>{JSON.stringify(structuredData, null, 2)}</pre>
        </details>
      )}

      {partyDrafts.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>Draft Emails</div>
          {partyDrafts.map(draft => (
            <div key={draft.id || draft.party || uid()} style={s.draftCard}>
              <div style={s.draftHeader}>
                <span style={s.draftParty}>{draft.party}</span>
              </div>
              <div style={s.draftBody}>
                <div style={s.field}>
                  <label style={s.label}>To</label>
                  <select style={s.select} value={draft.selectedEmail || ''} onChange={() => {}}>
                    <option value="">Select recipient</option>
                    {contacts.map((c, i) => <option key={i} value={c.email}>{c.label} ({c.email})</option>)}
                  </select>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Subject</label>
                  <input style={s.input} value={draft.subject || ''} readOnly />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Message</label>
                  <textarea style={{ ...s.input, minHeight: 160 }} value={draft.body || ''} readOnly />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

      {oneDriveOverlay && (
        <SaveToOneDriveOverlay
          projectId={projectId}
          aoIndex={selectedAOIndex}
          fileName={oneDriveOverlay.fileName}
          fileBase64={oneDriveOverlay.fileBase64}
          mimeType={oneDriveOverlay.mimeType}
          onSaved={({ web_url }) => {
            setOneDriveOverlay(null);
            // After saving, open email composer with the PDF attached
            onOpenComposer?.({
              mode: 'compose',
              to: '',
              subject: `Schedule of Condition - ${selectedAOAddress || projectAddress || ''}`,
              body: `Dear [Recipient]\n\nPlease find attached the Schedule of Condition prepared in connection with the proposed works at ${projectAddress || '[Building Owner property]'}.\n\nThis schedule records the existing condition of the adjoining property at ${selectedAOAddress || '[Adjoining Owner property]'} prior to commencement of the notified works.\n\nKind Regards,`,
              projectId,
              attachments: [{ name: oneDriveOverlay.fileName, type: 'application/pdf', data: oneDriveOverlay.base64ForEmail }],
            });
          }}
          onClose={() => setOneDriveOverlay(null)}
        />
      )}
    </>
  );
}

const s = {
  page: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1040, height: '100%', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 8 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  socSelectors: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none' },
  input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box' },
  hint: { fontSize: 12, color: 'var(--text3)', background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.7 },
  // Chat area
  chatArea: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', minHeight: 200, maxHeight: 'calc(100vh - 360px)' },
  emptyHint: { fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: '24px 16px', lineHeight: 1.7 },
  userBubble: { background: 'var(--blue)', color: '#fff', borderRadius: '14px 4px 14px 14px', padding: '9px 13px', fontSize: 13.5, lineHeight: 1.6, maxWidth: '82%', whiteSpace: 'pre-wrap' },
  elyBubble: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '4px 14px 14px 14px', padding: '7px 12px', fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' },
  // Input bar
  inputBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12 },
  micIdle: { width: 38, height: 38, borderRadius: '50%', background: 'var(--bg3)', border: '1.5px solid var(--border)', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' },
  micActive: { width: 38, height: 38, borderRadius: '50%', background: 'var(--red)', border: '1.5px solid var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, animation: 'pulse 1.4s infinite' },
  recDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', flexShrink: 0, animation: 'pulse 1.2s infinite' },
  // Buttons
  primaryBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer' },
  spinner: { width: 13, height: 13, border: '2px solid var(--blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
  // Review
  draftCard: { border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  draftHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg3)' },
  draftParty: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  draftBody: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
};







