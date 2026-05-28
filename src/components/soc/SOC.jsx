import { useState, useRef, useCallback } from 'react';
import { useApp } from '../../state/appStore';

function uid() { return Math.random().toString(36).slice(2); }

export default function SOC({ onOpenComposer, defaultProjectId }) {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState(defaultProjectId ? 'recording' : 'setup');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [transcript, setTranscript] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedAOIndex, setSelectedAOIndex] = useState('0');
  const [previewHtml, setPreviewHtml] = useState('');
  const [structuredData, setStructuredData] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [partyDrafts, setPartyDrafts] = useState([]);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const committedSpeechRef = useRef('');
  const lastDisplaySpeechRef = useRef('');
  const transcriptBoxRef = useRef(null);

  const selectedProject = projects.find(p => p.id === projectId);

  const projectAddress =
    selectedProject?.address ||
    selectedProject?.premise_address ||
    selectedProject?.bo_premise_address ||
    '';

  const aoOptions = Array.isArray(selectedProject?.aos) ? selectedProject.aos : [];
  const selectedAO = aoOptions[Number(selectedAOIndex)] || aoOptions[0] || null;

  const selectedAOAddress =
    selectedAO?.premise ||
    selectedAO?.reg_addr ||
    selectedAO?.address ||
    selectedAO?.ao_premise_address ||
    '';

  function projectOptionLabel(project) {
    return project?.address || project?.premise_address || project?.bo_premise_address || project?.ref || 'Project';
  }

  function aoOptionLabel(ao, index) {
    const address = ao?.premise || ao?.reg_addr || ao?.address || ao?.ao_premise_address || '';
    return address || `AO${index + 1}`;
  }

  function aoName(ao) {
    return [ao?.name || ao?.ao_name_1, ao?.name2 || ao?.ao_name_2].filter(Boolean).join(' & ');
  }

  function aoIdValue(ao, index) {
    return String(ao?.id || ao?.num || index || '0');
  }

  const getProjectContacts = useCallback(() => {
    if (!selectedProject) return [];
    const contacts = [];

    if (selectedProject.bo_email) {
      contacts.push({ label: `Building Owner - ${selectedProject.bo_name || selectedProject.bo_1_name || ''}`, email: selectedProject.bo_email });
    }

    if (selectedProject.architect_email) {
      contacts.push({ label: `Architect - ${selectedProject.architect_name || ''}`, email: selectedProject.architect_email });
    }

    if (selectedProject.se_email) {
      contacts.push({ label: `Structural Engineer - ${selectedProject.se_name || ''}`, email: selectedProject.se_email });
    }

    (selectedProject.aos || []).forEach((ao, i) => {
      if (ao.surveyor_email || ao.surv_email) {
        contacts.push({ label: `AO Surveyor AO${i + 1} - ${ao.surveyor_name || ao.surv_name || ''}`, email: ao.surveyor_email || ao.surv_email });
      }
      if (ao.email) {
        contacts.push({ label: `Adjoining Owner AO${i + 1} - ${ao.name || ''}`, email: ao.email });
      }
    });

    return contacts;
  }, [selectedProject]);

  const normaliseSpeechText = useCallback((value = '') => {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .trim();
  }, []);

  const removeImmediateDuplication = useCallback((value = '') => {
    let words = normaliseSpeechText(value).split(' ').filter(Boolean);

    words = words.filter((word, index) => {
      if (index === 0) return true;
      return word.toLowerCase() !== words[index - 1].toLowerCase();
    });

    let changed = true;

    while (changed) {
      changed = false;

      for (let size = 12; size >= 2; size -= 1) {
        const output = [];

        for (let i = 0; i < words.length; i += 1) {
          const previous = output.slice(-size).join(' ').toLowerCase();
          const current = words.slice(i, i + size).join(' ').toLowerCase();

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
  }, [normaliseSpeechText]);

  const getNewSpeechOnly = useCallback((previous = '', next = '') => {
    const prev = normaliseSpeechText(previous);
    const curr = normaliseSpeechText(next);

    if (!curr) return '';
    if (!prev) return curr;

    const prevLower = prev.toLowerCase();
    const currLower = curr.toLowerCase();

    if (currLower.startsWith(prevLower)) {
      return normaliseSpeechText(curr.slice(prev.length));
    }

    if (prevLower.includes(currLower)) return '';

    const prevWords = prev.split(' ').filter(Boolean);
    const currWords = curr.split(' ').filter(Boolean);

    let overlap = 0;
    const max = Math.min(prevWords.length, currWords.length);

    for (let size = max; size >= 1; size -= 1) {
      const prevTail = prevWords.slice(-size).join(' ').toLowerCase();
      const currHead = currWords.slice(0, size).join(' ').toLowerCase();
      if (prevTail === currHead) {
        overlap = size;
        break;
      }
    }

    return normaliseSpeechText(currWords.slice(overlap).join(' '));
  }, [normaliseSpeechText]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice recording requires Chrome or Edge. You can type or paste your notes below.');
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();

    committedSpeechRef.current = '';
    lastDisplaySpeechRef.current = '';
    transcriptRef.current = '';
    setTranscript('');

    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-GB';

    rec.onstart = () => setIsRecording(true);

    rec.onresult = (event) => {
      let latestInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const spoken = normaliseSpeechText(result?.[0]?.transcript || '');

        if (!spoken) continue;

        if (result.isFinal) {
          const addition = getNewSpeechOnly(committedSpeechRef.current, spoken);
          if (addition) {
            committedSpeechRef.current = removeImmediateDuplication(
              [committedSpeechRef.current, addition].filter(Boolean).join(' ')
            );
          }
        } else {
          latestInterim = spoken;
        }
      }

      const interimAddition = getNewSpeechOnly(committedSpeechRef.current, latestInterim);
      const displayText = removeImmediateDuplication(
        [committedSpeechRef.current, interimAddition].filter(Boolean).join(' ')
      );

      if (displayText !== lastDisplaySpeechRef.current) {
        lastDisplaySpeechRef.current = displayText;
        transcriptRef.current = displayText;
        setTranscript(displayText);
      }

      if (transcriptBoxRef.current) {
        transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
      }
    };

    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);

    recognitionRef.current = rec;
    rec.start();
  }, [getNewSpeechOnly, normaliseSpeechText, removeImmediateDuplication]);

  const sendCurrentNote = useCallback(() => {
    const note = removeImmediateDuplication(transcript || transcriptRef.current || committedSpeechRef.current);

    stopRecording();

    if (!note) return;

    setFullTranscript(prev => [prev, note].filter(Boolean).join('\n\n'));
    setTranscript('');
    transcriptRef.current = '';
    committedSpeechRef.current = '';
    lastDisplaySpeechRef.current = '';
  }, [removeImmediateDuplication, stopRecording, transcript]);

  const handleRecordSend = useCallback(() => {
    const hasCurrentNote = !!removeImmediateDuplication(transcript || transcriptRef.current || committedSpeechRef.current);

    if (isRecording || hasCurrentNote) {
      sendCurrentNote();
      return;
    }

    startRecording();
  }, [isRecording, removeImmediateDuplication, sendCurrentNote, startRecording, transcript]);

  const handleGenerate = useCallback(async (notes) => {
    const currentNote = removeImmediateDuplication(transcript || transcriptRef.current || committedSpeechRef.current);
    const text = notes || [fullTranscript, currentNote].filter(Boolean).join('\n\n');

    if (!text.trim()) {
      alert('No notes to process.');
      return;
    }

    if (!projectId) {
      alert('Please select a project first.');
      return;
    }

    stopRecording();
    setProcessing(true);

    try {
      const response = await fetch('/api/generate-soc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          project_id: projectId,
          session_id: uid(),
          ao_id: aoIdValue(selectedAO, Number(selectedAOIndex)),
          ao_name: aoName(selectedAO),
          ao_names: aoName(selectedAO),
          ao_address: selectedAOAddress,
          ao_premise_address: selectedAOAddress,
          ao_service_address: selectedAO?.service_address || selectedAO?.serviceAddress || selectedAO?.reg_addr || selectedAOAddress || '',
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || payload.details || 'Could not generate Schedule of Condition.');
      }

      if (!payload.preview_html) {
        throw new Error('The SOC API did not return preview_html.');
      }

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
  }, [fullTranscript, projectId, removeImmediateDuplication, selectedAO, selectedAOAddress, selectedAOIndex, stopRecording, transcript]);

  const printPreview = useCallback(() => {
    if (!previewHtml) return;

    const printCss = `
      <style>
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }

          html,
          body {
            width: 210mm !important;
            min-height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
          }

          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .soc-document {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            background: #ffffff !important;
          }

          table {
            page-break-inside: auto;
          }

          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }

          thead {
            display: table-header-group;
          }
        }

        @media screen {
          html,
          body {
            width: 210mm !important;
            min-height: 297mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
          }

          .soc-document {
            width: 100% !important;
            max-width: none !important;
            margin: 0 auto !important;
            box-shadow: none !important;
          }
        }
      </style>
    `;

    const html = previewHtml.includes('</head>')
      ? previewHtml.replace('</head>', `${printCss}</head>`)
      : `<!DOCTYPE html><html><head>${printCss}</head><body>${previewHtml}</body></html>`;

    const win = window.open('', '_blank', 'width=1200,height=900');

    if (!win) {
      alert('Please allow pop-ups to download the SOC PDF.');
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();

    setTimeout(() => {
      win.focus();
      win.print();
    }, 800);
  }, [previewHtml]);

  const sendSOCByEmail = useCallback(() => {
    onOpenComposer?.({
      mode: 'compose',
      to: '',
      subject: `Schedule of Condition - ${selectedAOAddress || projectAddress || ''}`,
      body: `Dear [Recipient]\n\nPlease find attached the Schedule of Condition prepared in connection with the proposed works at ${projectAddress || '[Building Owner property]'}.\n\nThis schedule records the existing condition of the adjoining property at ${selectedAOAddress || '[Adjoining Owner property]'} prior to commencement of the notified works.\n\nPlease do not hesitate to contact me should you require any further information.\n\nYours sincerely\nItzik`,
      projectId,
    });
  }, [onOpenComposer, projectAddress, projectId, selectedAOAddress]);

  const contacts = getProjectContacts();

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

          <button style={{ ...s.recordBtn, opacity: !projectId ? 0.5 : 1 }} disabled={!projectId} onClick={() => setPhase('recording')}>
            Continue
          </button>

          <div style={s.hint}>
            Select the project, then choose the relevant Adjoining Owner property before recording or pasting notes.
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'recording') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>SOC Dictation</h1>
          <button onClick={() => handleGenerate()} style={s.doneBtn} disabled={processing}>
            {processing ? 'Generating...' : 'SOC Complete'}
          </button>
        </div>

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
                  {aoOptions.map((ao, idx) => (
                    <option key={ao.id || ao.num || idx} value={idx}>{aoOptionLabel(ao, idx)}</option>
                  ))}
                </select>
              ) : (
                <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text2)' }} value={selectedAOAddress} disabled placeholder="No adjoining owner address recorded" />
              )}
            </div>
          </div>

          <div style={s.statusBar}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isRecording
                ? <><div style={s.recDot} /><span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 13 }}>Recording...</span></>
                : <span style={{ color: 'var(--text3)', fontSize: 13 }}>Ready</span>}
            </div>

            <button onClick={handleRecordSend} style={isRecording || transcript ? s.sendBtn : s.recordBtn}>
              {isRecording || transcript ? 'Send' : 'Record'}
            </button>
          </div>

          <div ref={transcriptBoxRef} style={s.transcript}>
            {transcript || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>Tap Record, dictate one observation, then tap Send.</span>}
          </div>

          <div>
            <label style={{ ...s.label, display: 'block', marginBottom: 5 }}>Stored SOC notes / paste notes</label>
            <textarea
              style={{ ...s.input, width: '100%', minHeight: 130, resize: 'vertical', fontSize: 12.5 }}
              placeholder="Each sent note appears here. You can also paste a full SOC transcript here."
              value={fullTranscript}
              onChange={e => setFullTranscript(e.target.value)}
            />
          </div>

          {processing && (
            <div style={s.processingBar}>
              <div style={s.spinner} /> Ely is generating your Schedule of Condition...
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Schedule of Condition - Review</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setPhase('recording')} style={s.secondaryBtn}>Back</button>
          <button onClick={sendSOCByEmail} style={s.secondaryBtn}>Send SOC by Email</button>
          <button onClick={printPreview} style={s.primaryBtn}>Download PDF</button>
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
        <iframe
          title="Schedule of Condition Preview"
          srcDoc={previewHtml}
          style={{ width: '100%', minHeight: '75vh', border: 'none', background: '#fff' }}
        />
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
  );
}

const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1040 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle: { fontSize: 13.5, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 8 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  socSelectors: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none' },
  input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box' },
  hint: { fontSize: 12, color: 'var(--text3)', background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.7 },
  recordBtn: { background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 99, padding: '10px 24px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  sendBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 99, padding: '10px 24px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  doneBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 99, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  statusBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 },
  recDot: { width: 9, height: 9, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 },
  transcript: { minHeight: 120, maxHeight: 220, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)', padding: '4px 0' },
  processingBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--blue-bg)', color: 'var(--blue)', fontSize: 13, borderRadius: 8 },
  spinner: { width: 13, height: 13, border: '2px solid var(--blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
  draftCard: { border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  draftHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg3)' },
  draftParty: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  draftBody: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
  primaryBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer' },
};
