import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../state/appStore';

function uid() { return Math.random().toString(36).slice(2); }

export default function DisputeAgreement({ defaultProjectId, onOpenComposer }) {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState(defaultProjectId ? 'input' : 'setup');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [messages, setMessages] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [structuredData, setStructuredData] = useState(null);
  const [refinementInput, setRefinementInput] = useState('');
  const [refining, setRefining] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const recognitionRef = useRef(null);
  const accumulatedRef = useRef('');
  const committedRef = useRef('');
  const interimRef = useRef('');
  const restartTimerRef = useRef(null);
  const shouldRecordRef = useRef(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const selectedProject = projects.find(p => p.id === projectId);
  const projectAddress = selectedProject?.address || selectedProject?.premise_address || selectedProject?.bo_premise_address || '';

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!defaultProjectId) return;
    setProjectId(defaultProjectId);
    setPhase('input');
    setMessages([]);
    setPreviewHtml('');
    setStructuredData(null);
    setUploadedFiles([]);
  }, [defaultProjectId]);

  function projectOptionLabel(p) {
    return p?.address || p?.premise_address || p?.bo_premise_address || p?.ref || 'Project';
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  const buildRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-GB';
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsRecording(true);

    rec.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const text = (r[0]?.transcript || '').trim();
        if (!text) continue;
        if (r.isFinal) finalText = [finalText, text].filter(Boolean).join(' ');
        else interim = text;
      }
      if (finalText) committedRef.current = finalText;
      interimRef.current = interim;
      const preview = [accumulatedRef.current, committedRef.current, interim].filter(Boolean).join(' ');
      setInterimText(preview);
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[DisputeAgreement] speech error:', e.error);
    };

    rec.onend = () => {
      if (committedRef.current) {
        accumulatedRef.current = [accumulatedRef.current, committedRef.current].filter(Boolean).join(' ');
        committedRef.current = '';
      }
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

  const handleSend = useCallback((overrideText) => {
    const voiceNote = [accumulatedRef.current, committedRef.current, interimRef.current].filter(Boolean).join(' ').trim();
    const note = overrideText || voiceNote || textInput.trim();
    if (!note) return;
    stopRecording();
    setInterimText('');
    setTextInput('');
    committedRef.current = '';
    accumulatedRef.current = '';
    interimRef.current = '';
    setMessages(prev => [
      ...prev,
      { id: uid(), role: 'user', content: note },
      { id: uid(), role: 'ely', content: 'Noted.' },
    ]);
  }, [stopRecording, textInput]);

  const handleMicClick = useCallback(() => {
    if (isRecording) handleSend();
    else startRecording();
  }, [isRecording, handleSend, startRecording]);

  // ── File upload ────────────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result.split(',')[1];
        setUploadedFiles(prev => [...prev, {
          id: uid(),
          name: file.name,
          type: file.type,
          base64,
          size: file.size,
        }]);
        setMessages(prev => [
          ...prev,
          { id: uid(), role: 'user', content: `📎 Uploaded: ${file.name}` },
          { id: uid(), role: 'ely', content: 'Document received — I\'ll use this when generating the agreement.' },
        ]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }, []);

  // ── Generate ───────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    const allNotes = messages
      .filter(m => m.role === 'user' && !m.content.startsWith('📎'))
      .map(m => m.content)
      .join('\n\n');

    const currentNote = [committedRef.current, interimRef.current].filter(Boolean).join(' ').trim();
    const text = [allNotes, currentNote].filter(Boolean).join('\n\n');

    if (!text.trim() && !uploadedFiles.length) {
      alert('Please add some notes or upload a document first.');
      return;
    }
    if (!projectId) { alert('Please select a project first.'); return; }

    stopRecording();
    setProcessing(true);

    try {
      const response = await fetch('/api/generate-dispute-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          project_id: projectId,
          session_id: uid(),
          uploaded_files: uploadedFiles.map(f => ({
            name: f.name,
            type: f.type,
            base64: f.base64,
          })),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not generate agreement.');
      if (!payload.preview_html) throw new Error('No preview returned from server.');

      setPreviewHtml(payload.preview_html);
      setStructuredData(payload.structured_data || null);
      setPhase('review');
    } catch (err) {
      alert('Error generating agreement: ' + (err.message || err));
    } finally {
      setProcessing(false);
    }
  }, [messages, projectId, uploadedFiles, stopRecording]);

  // ── Refine ─────────────────────────────────────────────────────────────────

  const handleRefine = useCallback(async () => {
    const instruction = refinementInput.trim();
    if (!instruction || !structuredData) return;

    setRefining(true);
    setMessages(prev => [...prev, { id: uid(), role: 'user', content: instruction }]);
    setRefinementInput('');

    try {
      const response = await fetch('/api/generate-dispute-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          session_id: uid(),
          refinement_instruction: instruction,
          existing_structured_data: structuredData,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not refine agreement.');
      if (!payload.preview_html) throw new Error('No preview returned.');

      setPreviewHtml(payload.preview_html);
      setStructuredData(payload.structured_data || structuredData);
      setMessages(prev => [...prev, { id: uid(), role: 'ely', content: 'Done — agreement updated. Review the preview above.' }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: uid(), role: 'ely', content: `Could not update: ${err.message}` }]);
    } finally {
      setRefining(false);
    }
  }, [refinementInput, structuredData, projectId]);

  // ── Download PDF ──────────────────────────────────────────────────────────

  const handleDownload = useCallback(async () => {
    if (!previewHtml) return;
    setDownloading(true);
    try {
      const response = await fetch('/api/generate-dispute-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          export_pdf: true,
          preview_html: previewHtml,
          structured_data: structuredData,
        }),
      });

      if (!response.ok) {
        const p = await response.json().catch(() => ({}));
        throw new Error(p.error || 'Could not generate PDF.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `Party Agreement - ${projectAddress || 'Agreement'}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Error downloading agreement: ' + (err.message || err));
    } finally {
      setDownloading(false);
    }
  }, [previewHtml, structuredData, projectId, projectAddress]);

  // ── Setup phase ────────────────────────────────────────────────────────────

  if (phase === 'setup') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>Dispute Agreement</h1>
        </div>
        <div style={s.card}>
          <div style={s.field}>
            <label style={s.label}>Select project</label>
            <select style={s.select} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{projectOptionLabel(p)}</option>)}
            </select>
          </div>
          <button
            style={{ ...s.primaryBtn, opacity: !projectId ? 0.5 : 1 }}
            disabled={!projectId}
            onClick={() => setPhase('input')}
          >
            Continue
          </button>
          <div style={s.hint}>
            Select the project, then dictate the details of the agreement or upload relevant documents. The AI will generate the appropriate Party Agreement.
          </div>
        </div>
      </div>
    );
  }

  // ── Input phase ────────────────────────────────────────────────────────────

  if (phase === 'input') {
    const hasContent = messages.some(m => m.role === 'user') || uploadedFiles.length > 0;

    return (
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Dispute Agreement</h1>
            {projectAddress && (
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{projectAddress}</div>
            )}
          </div>
          <button
            onClick={handleGenerate}
            style={{ ...s.primaryBtn, opacity: (!hasContent || processing) ? 0.5 : 1 }}
            disabled={!hasContent || processing}
          >
            {processing ? 'Generating…' : 'Generate Agreement'}
          </button>
        </div>

        <div style={{ ...s.card, padding: '10px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            Dictate the type of agreement and the relevant facts — e.g. <em>"scaffold access agreement, Building Owner needs to erect scaffold on AO's land at No. 43 for two weeks to complete flank wall, AO has agreed verbally"</em>. Upload documents if relevant.
          </div>
        </div>

        {/* Chat bubbles */}
        <div style={s.chatArea}>
          {messages.length === 0 && (
            <div style={s.emptyHint}>
              Describe what the agreement is for and dictate the key facts. Tap the mic or type below. Upload any relevant documents using the 📎 button.
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
          {processing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', color: 'var(--blue)', fontSize: 13 }}>
              <div style={s.spinner} /> Generating Party Agreement…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div style={{ ...s.inputBar, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            {/* File upload */}
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileChange} />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ ...s.micIdle, fontSize: 16 }}
              title="Upload document"
            >
              📎
            </button>

            {/* Mic */}
            <button onClick={handleMicClick} style={isRecording ? s.micActive : s.micIdle} title={isRecording ? 'Stop recording' : 'Start recording'}>
              {isRecording ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>

            {/* Text input */}
            <textarea
              style={{ ...s.input, flex: 1, minHeight: 38, maxHeight: 120, resize: 'vertical', fontSize: 13, padding: '8px 10px', lineHeight: 1.4 }}
              placeholder={isRecording ? '● Recording… or type/paste here' : 'Describe the agreement — type, paste or tap mic…'}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />

            {/* Send */}
            <button
              onClick={() => handleSend()}
              disabled={!textInput.trim() && !isRecording && !interimText}
              style={{
                ...s.micIdle,
                opacity: (!textInput.trim() && !isRecording && !interimText) ? 0.35 : 1,
                background: 'var(--accent, #6366f1)',
                color: '#fff',
                borderRadius: 8,
                padding: '0 12px',
                height: 38,
                minWidth: 38,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>

          {(isRecording || interimText) && (
            <div style={{ fontSize: 12, color: 'var(--red, #ef4444)', fontStyle: 'italic', paddingLeft: 4 }}>
              {interimText || '● Recording… speak now'}
            </div>
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    );
  }

  // ── Review phase ───────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Party Agreement — Review</h1>
          {projectAddress && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{projectAddress}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setPhase('input')} style={s.secondaryBtn}>← Back</button>
          <button
            onClick={handleDownload}
            style={{ ...s.primaryBtn, opacity: downloading ? 0.65 : 1 }}
            disabled={downloading}
          >
            {downloading ? 'Generating…' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      {/* Preview */}
      <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Preview — read and discuss below to make changes</span>
          {structuredData?.agreement_type && (
            <span style={{ background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
              {structuredData.agreement_type}
            </span>
          )}
        </div>
        <iframe
          title="Party Agreement Preview"
          srcDoc={previewHtml}
          style={{ width: '100%', minHeight: '60vh', border: 'none', background: '#fff' }}
        />
      </div>

      {/* Refinement chat */}
      <div style={s.card}>
        <div style={s.cardTitle}>Discuss & refine</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
          Ask for changes — e.g. "remove the scaffolding clauses", "change the defects period to 2 years", "the AO is a single owner not two".
        </div>

        {/* Refinement messages */}
        {messages.filter(m => m._phase === 'review' || m._review).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {messages.filter(m => m._review).map(msg => (
              <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={msg.role === 'user' ? s.userBubble : s.elyBubble}>{msg.content}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            style={{ ...s.input, flex: 1, minHeight: 38, maxHeight: 100, resize: 'vertical', fontSize: 13, padding: '8px 10px' }}
            placeholder="Type a change or question…"
            value={refinementInput}
            onChange={e => setRefinementInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRefine(); } }}
          />
          <button
            onClick={handleRefine}
            disabled={!refinementInput.trim() || refining}
            style={{ ...s.primaryBtn, opacity: (!refinementInput.trim() || refining) ? 0.5 : 1, alignSelf: 'flex-end' }}
          >
            {refining ? 'Updating…' : 'Update'}
          </button>
        </div>
      </div>

      <div ref={messagesEndRef} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const s = {
  page: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1040, height: '100%', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none' },
  input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box', width: '100%' },
  hint: { fontSize: 12, color: 'var(--text3)', background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.7 },
  chatArea: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', minHeight: 160, maxHeight: 'calc(100vh - 420px)' },
  emptyHint: { fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center', padding: '24px 16px', lineHeight: 1.7 },
  userBubble: { background: 'var(--blue)', color: '#fff', borderRadius: '14px 4px 14px 14px', padding: '9px 13px', fontSize: 13.5, lineHeight: 1.6, maxWidth: '82%', whiteSpace: 'pre-wrap' },
  elyBubble: { background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: '4px 14px 14px 14px', padding: '7px 12px', fontSize: 12.5, fontStyle: 'italic' },
  inputBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12 },
  micIdle: { width: 38, height: 38, borderRadius: '50%', background: 'var(--bg3)', border: '1.5px solid var(--border)', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' },
  micActive: { width: 38, height: 38, borderRadius: '50%', background: 'var(--red)', border: '1.5px solid var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, animation: 'pulse 1.4s infinite' },
  primaryBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer' },
  spinner: { width: 13, height: 13, border: '2px solid var(--blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
};
