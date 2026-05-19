import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import { callEly } from '../../api/elyRouter';

const CONDITIONS = ['Good', 'Fair', 'Poor'];

// ── Utility ────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2); }

// ── Main SOC component ─────────────────────────────────────────────────────
export default function SOC() {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState('setup'); // setup | recording | review
  const [projectId, setProjectId] = useState('');
  const [room, setRoom] = useState('');
  const [transcript, setTranscript] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Review data
  const [socRows, setSocRows] = useState([]);   // [{id, location, description, condition}]
  const [partyDrafts, setPartyDrafts] = useState([]); // [{id, party, subject, body, expanded}]

  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const transcriptBoxRef = useRef(null);

  const selectedProject = projects.find(p => p.id === projectId);

  // ── Recording ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice recording requires Chrome or Edge. You can also type your notes below.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    recognition.onstart = () => setIsRecording(true);

    recognition.onresult = (e) => {
      let interim = '';
      let finalChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalChunk += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      if (finalChunk) {
        transcriptRef.current += finalChunk;
        setFullTranscript(transcriptRef.current);
        // Check for "SOC complete" trigger
        const lower = transcriptRef.current.toLowerCase();
        const lastBit = lower.slice(-60);
        if (lastBit.includes('soc complete') || lastBit.includes('s o c complete') || lastBit.includes('schedule complete')) {
          recognition.stop();
          handleGenerate(transcriptRef.current);
          return;
        }
      }
      setTranscript(transcriptRef.current + interim);
      if (transcriptBoxRef.current) {
        transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.onerror = (e) => {
      console.error('Speech recognition error:', e.error);
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  // ── AI Processing ─────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async (notes) => {
    const text = notes || fullTranscript || transcriptRef.current;
    if (!text.trim()) {
      alert('No dictation notes to process. Please record or type your site notes.');
      return;
    }
    stopRecording();
    setProcessing(true);

    const project = projects.find(p => p.id === projectId);
    const projectContext = project
      ? `Project: ${project.ref} — ${project.address}\nBuilding Owner: ${project.bo_name || ''}\nWorks: ${project.works || ''}`
      : '';

    const prompt = `Process these site dictation notes into a Schedule of Condition and identify any party-specific notes.

${projectContext}
${room ? `Current room/area: ${room}` : ''}

DICTATION NOTES:
${text}

Return a JSON response ONLY (no other text) in this exact format:
{
  "socRows": [
    {"location": "Living Room", "description": "Hairline crack to ceiling, approx 600mm, historic, no active movement", "condition": "Fair"},
    {"location": "Kitchen", "description": "Walls in good decorative order, no defects noted", "condition": "Good"}
  ],
  "partyDrafts": [
    {
      "party": "Architect",
      "subject": "Schedule of Condition — ${project?.address || 'Site Address'} — Notes for Architect",
      "body": "Dear [Architect],\n\nFollowing my inspection at the above address..."
    }
  ]
}

Rules:
- SOC rows: professional surveying language, group by room/location, condition must be Good/Fair/Poor
- Party drafts: only include parties where specific notes were flagged
- Party trigger phrases: "note for architect", "tell the BO", "note for SE", "structural", "flag to the AO surveyor", "note for client"
- Each party draft should be a complete professional letter/email
- Remove any SOC-complete trigger phrase from the notes before processing`;

    try {
      const result = await callEly({
        prompt,
        surface: 'soc',
        projectId,
        projectsContext: project ? [{ ref: project.ref, address: project.address }] : [],
      });

      // Parse JSON from reply
      const reply = result.reply || '';
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI response');

      const parsed = JSON.parse(jsonMatch[0]);

      setSocRows((parsed.socRows || []).map(row => ({
        id: uid(),
        location: row.location || '',
        description: row.description || '',
        condition: row.condition || 'Good',
      })));

      setPartyDrafts((parsed.partyDrafts || []).map(d => ({
        id: uid(),
        party: d.party || '',
        subject: d.subject || '',
        body: d.body || '',
        expanded: true,
      })));

      setPhase('review');
    } catch (err) {
      alert('Error generating SOC: ' + err.message);
    } finally {
      setProcessing(false);
    }
  }, [fullTranscript, projectId, projects, room, stopRecording]);

  // ── SOC row editing ───────────────────────────────────────────────────────
  const updateRow = (id, field, val) =>
    setSocRows(rows => rows.map(r => r.id === id ? { ...r, [field]: val } : r));
  const addRow = () =>
    setSocRows(rows => [...rows, { id: uid(), location: room || '', description: '', condition: 'Good' }]);
  const removeRow = (id) =>
    setSocRows(rows => rows.filter(r => r.id !== id));

  // ── PDF generation ────────────────────────────────────────────────────────
  const generatePDF = useCallback(() => {
    const project = projects.find(p => p.id === projectId);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // Group rows by location
    const grouped = {};
    socRows.forEach(row => {
      if (!grouped[row.location]) grouped[row.location] = [];
      grouped[row.location].push(row);
    });

    const conditionColour = { Good: '#2e8b57', Fair: '#e8a020', Poor: '#cc4444' };

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Schedule of Condition — ${project?.address || ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a2e; padding: 30px 40px; }
    .header { border-bottom: 3px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 18pt; font-weight: 700; margin-bottom: 6px; }
    .header .meta { font-size: 10pt; color: #555; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 10px; }
    .meta-row { display: flex; gap: 8px; }
    .meta-label { font-weight: 600; min-width: 120px; }
    .section-title { font-size: 12pt; font-weight: 700; background: #f0f4ff; padding: 7px 12px; margin: 18px 0 0; border-left: 4px solid #3d5a99; }
    table { width: 100%; border-collapse: collapse; margin-top: 0; }
    th { background: #1a1a2e; color: #fff; padding: 8px 12px; font-size: 10pt; text-align: left; }
    td { padding: 7px 12px; border-bottom: 1px solid #e8e8f0; font-size: 10pt; vertical-align: top; }
    tr:nth-child(even) td { background: #f9f9fc; }
    .cond { font-weight: 700; font-size: 9pt; padding: 2px 8px; border-radius: 99px; display: inline-block; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ccc; font-size: 9pt; color: #888; }
    @media print { body { padding: 15px 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Schedule of Condition</h1>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Property:</span><span>${project?.address || '—'}</span></div>
      <div class="meta-row"><span class="meta-label">Date of Inspection:</span><span>${today}</span></div>
      <div class="meta-row"><span class="meta-label">Prepared by:</span><span>${project?.surveyor_name || 'Party Wall Surveyor'}</span></div>
      <div class="meta-row"><span class="meta-label">Project Reference:</span><span>${project?.ref || '—'}</span></div>
    </div>
  </div>

  ${Object.entries(grouped).map(([location, rows]) => `
    <div class="section-title">${location}</div>
    <table>
      <thead><tr><th style="width:55%">Description</th><th style="width:15%">Condition</th></tr></thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${row.description}</td>
            <td><span class="cond" style="background:${conditionColour[row.condition] || '#888'}22;color:${conditionColour[row.condition] || '#888'}">${row.condition}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `).join('')}

  <div class="footer">
    This Schedule of Condition has been prepared in connection with works notified under the Party Wall etc. Act 1996.
    It records the existing condition of the above property prior to the commencement of the notified works.
  </div>
</body>
</html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }, [socRows, projectId, projects]);

  // ── Copy party draft ──────────────────────────────────────────────────────
  const copyDraft = (body) => {
    navigator.clipboard.writeText(body).catch(() => {});
  };

  // ── Render: Setup phase ───────────────────────────────────────────────────
  if (phase === 'setup' || phase === 'recording') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>🎙️ SOC Dictation</h1>
          {phase === 'recording' && (
            <button onClick={() => handleGenerate()} style={s.doneBtn} disabled={processing}>
              {processing ? 'Generating…' : '✓ SOC Complete'}
            </button>
          )}
        </div>

        {/* Project + room selectors */}
        {phase === 'setup' && (
          <div style={s.setupCard}>
            <div style={s.setupRow}>
              <div style={s.field}>
                <label style={s.label}>Project</label>
                <select style={s.select} value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">— Select project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.ref} — {p.address}</option>
                  ))}
                </select>
              </div>
              <div style={s.field}>
                <label style={s.label}>Starting room / area</label>
                <input style={s.input} value={room} placeholder="e.g. Living Room"
                  onChange={e => setRoom(e.target.value)} />
              </div>
            </div>
            <button
              style={{ ...s.recordBtn, opacity: !projectId ? 0.5 : 1 }}
              disabled={!projectId}
              onClick={() => { setPhase('recording'); startRecording(); }}
            >
              🎙️ Start Recording
            </button>
            <div style={s.hint}>
              Say <strong>"note for architect"</strong>, <strong>"note for BO"</strong>, <strong>"note for SE"</strong> to flag items for separate letters.
              Say <strong>"SOC complete"</strong> to finish and generate.
            </div>
          </div>
        )}

        {/* Recording UI */}
        {phase === 'recording' && (
          <div style={s.recordingCard}>
            {/* Status bar */}
            <div style={s.statusBar}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isRecording ? (
                  <>
                    <div style={s.recDot} />
                    <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 13 }}>Recording…</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text3)', fontSize: 13 }}>Paused</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...s.input, width: 180 }} value={room} placeholder="Current room…"
                  onChange={e => setRoom(e.target.value)} />
                {isRecording ? (
                  <button onClick={stopRecording} style={s.stopBtn}>⏸ Pause</button>
                ) : (
                  <button onClick={startRecording} style={s.recordBtn2}>🎙️ Resume</button>
                )}
              </div>
            </div>

            {/* Transcript */}
            <div ref={transcriptBoxRef} style={s.transcript}>
              {transcript || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>Transcript will appear here as you speak…</span>}
            </div>

            {/* Manual input fallback */}
            <div style={{ padding: '0 16px 12px' }}>
              <textarea
                style={{ ...s.input, width: '100%', minHeight: 80, resize: 'vertical', fontSize: 12.5 }}
                placeholder="Or type / paste your notes here…"
                value={fullTranscript}
                onChange={e => { setFullTranscript(e.target.value); transcriptRef.current = e.target.value; }}
              />
            </div>

            {processing && (
              <div style={s.processingBar}>
                <div style={s.spinner} /> Ely is generating your SOC and party letters…
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render: Review phase ──────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>📋 Schedule of Condition — Review</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setPhase('recording'); setTranscript(fullTranscript); }} style={s.secondaryBtn}>
            ← Back to Dictation
          </button>
          <button onClick={generatePDF} style={s.primaryBtn}>
            ⬇ Download SOC PDF
          </button>
        </div>
      </div>

      {/* SOC Table */}
      <div style={s.reviewCard}>
        <div style={s.reviewTitle}>Schedule of Condition</div>
        {selectedProject && (
          <div style={s.projectMeta}>
            {selectedProject.ref} — {selectedProject.address}
            {selectedProject.bo_name && ` | BO: ${selectedProject.bo_name}`}
          </div>
        )}

        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: '25%' }}>Location</th>
              <th style={{ ...s.th, width: '55%' }}>Description</th>
              <th style={{ ...s.th, width: '12%' }}>Condition</th>
              <th style={{ ...s.th, width: '8%' }}></th>
            </tr>
          </thead>
          <tbody>
            {socRows.map(row => (
              <tr key={row.id}>
                <td style={s.td}>
                  <input style={s.tableInput} value={row.location}
                    onChange={e => updateRow(row.id, 'location', e.target.value)} />
                </td>
                <td style={s.td}>
                  <textarea style={{ ...s.tableInput, resize: 'vertical', minHeight: 40 }}
                    value={row.description}
                    onChange={e => updateRow(row.id, 'description', e.target.value)} />
                </td>
                <td style={s.td}>
                  <select style={s.condSelect} value={row.condition}
                    onChange={e => updateRow(row.id, 'condition', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td style={s.td}>
                  <button onClick={() => removeRow(row.id)} style={s.removeBtn}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addRow} style={s.addRowBtn}>+ Add row</button>
      </div>

      {/* Party drafts */}
      {partyDrafts.length > 0 && (
        <div style={s.reviewCard}>
          <div style={s.reviewTitle}>Party Letters / Emails</div>
          {partyDrafts.map(draft => (
            <div key={draft.id} style={s.draftCard}>
              <div style={s.draftHeader}
                onClick={() => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, expanded: !d.expanded } : d))}>
                <div style={s.draftParty}>{partyIcon(draft.party)} {draft.party}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); copyDraft(draft.body); }}
                    style={s.copyBtn}>📋 Copy</button>
                  <span style={{ color: 'var(--text3)', fontSize: 13 }}>{draft.expanded ? '▲' : '▼'}</span>
                </div>
              </div>
              {draft.expanded && (
                <div style={s.draftBody}>
                  <input style={{ ...s.tableInput, marginBottom: 8, fontWeight: 600 }}
                    value={draft.subject}
                    onChange={e => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, subject: e.target.value } : d))} />
                  <textarea style={{ ...s.tableInput, minHeight: 180, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                    value={draft.body}
                    onChange={e => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, body: e.target.value } : d))} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function partyIcon(party) {
  const icons = { Architect: '📐', 'Building Owner': '🏠', 'Structural Engineer': '🔧', 'AO Surveyor': '👤', SE: '🔧', BO: '🏠' };
  return icons[party] || '✉️';
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = {
  page: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1000 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 },
  setupCard: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
  setupRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none' },
  input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box' },
  hint: { fontSize: 12, color: 'var(--text3)', lineHeight: 1.6, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 8 },
  recordBtn: { background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 99, padding: '11px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  recordBtn2: { background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 99, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  stopBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 99, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  doneBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 99, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  recordingCard: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' },
  statusBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', flexWrap: 'wrap', gap: 8 },
  recDot: { width: 10, height: 10, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.2s infinite' },
  transcript: { padding: '16px', minHeight: 160, maxHeight: 280, overflowY: 'auto', fontSize: 13.5, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' },
  processingBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--blue-bg)', color: 'var(--blue)', fontSize: 13, fontWeight: 500 },
  spinner: { width: 14, height: 14, border: '2px solid var(--blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  reviewCard: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  reviewTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 8 },
  projectMeta: { fontSize: 12, color: 'var(--text3)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', borderBottom: '2px solid var(--border)', textAlign: 'left' },
  td: { padding: '5px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' },
  tableInput: { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  condSelect: { border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: 'var(--text)', background: 'var(--bg)', outline: 'none', width: '100%' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 },
  addRowBtn: { alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--blue)', borderRadius: 8, color: 'var(--blue)', padding: '6px 14px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 },
  draftCard: { border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  draftHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg3)', cursor: 'pointer' },
  draftParty: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  draftBody: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
  copyBtn: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', color: 'var(--text2)' },
  primaryBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' },
};
