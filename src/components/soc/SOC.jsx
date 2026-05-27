import { useState, useRef, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import { callEly } from '../../api/elyRouter';

function uid() { return Math.random().toString(36).slice(2); }

const ACTIONS = ['Record only', 'Record pre-existing defect', 'Monitor', 'Further investigation required'];

export default function SOC({ onOpenComposer, defaultProjectId }) {
  const { state } = useApp();
  const projects = state.projects || [];

  const [phase, setPhase] = useState(defaultProjectId ? 'recording' : 'setup');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [transcript, setTranscript] = useState('');
  const [fullTranscript, setFullTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Review data
  const [aoAddress, setAoAddress] = useState('');
  const [selectedAOIndex, setSelectedAOIndex] = useState('0');
  const [socSections, setSocSections] = useState([]);
  const [siteComments, setSiteComments] = useState([]);
  const [partyDrafts, setPartyDrafts] = useState([]);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const transcriptBoxRef = useRef(null);

  const selectedProject = projects.find(p => p.id === projectId);

  const aoOptions = selectedProject?.aos || [];

  const selectedAO =
    aoOptions[Number(selectedAOIndex)] || aoOptions[0] || null;

  const projectDisplayAddress =
    selectedProject?.address ||
    selectedProject?.premise_address ||
    selectedProject?.bo_premise_address ||
    '';

  if (!aoAddress && selectedAO?.address) {
    setTimeout(() => {
      setAoAddress(selectedAO.address);
    }, 0);
  }

  // Build contact list from project data
  const getProjectContacts = useCallback(() => {
    if (!selectedProject) return [];
    const contacts = [];
    if (selectedProject.bo_email) contacts.push({ label: `Building Owner — ${selectedProject.bo_name || ''}`, email: selectedProject.bo_email });
    if (selectedProject.architect_email) contacts.push({ label: `Architect — ${selectedProject.architect_name || ''}`, email: selectedProject.architect_email });
    if (selectedProject.se_email) contacts.push({ label: `Structural Engineer — ${selectedProject.se_name || ''}`, email: selectedProject.se_email });
    (selectedProject.aos || []).forEach((ao, i) => {
      if (ao.surveyor_email) contacts.push({ label: `AO Surveyor (AO${i + 1}) — ${ao.surveyor_name || ''}`, email: ao.surveyor_email });
      if (ao.email) contacts.push({ label: `Adjoining Owner (AO${i + 1}) — ${ao.name || ''}`, email: ao.email });
    });
    return contacts;
  }, [selectedProject]);

  // ── Recording ──────────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice recording requires Chrome or Edge. You can type your notes below.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-GB';
    rec.onstart = () => setIsRecording(true);
    rec.onresult = (e) => {
      let interim = '', finalChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalChunk += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if (finalChunk) {
        transcriptRef.current += finalChunk;
        setFullTranscript(transcriptRef.current);
        const last = transcriptRef.current.toLowerCase().slice(-80);
        if (last.includes('soc complete') || last.includes('schedule complete') || last.includes('s o c complete')) {
          rec.stop();
          handleGenerate(transcriptRef.current);
          return;
        }
      }
      setTranscript(transcriptRef.current + interim);
      if (transcriptBoxRef.current) transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  // ── AI Generation ──────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async (notes) => {
    const text = notes || fullTranscript || transcriptRef.current;
    if (!text.trim()) { alert('No notes to process.'); return; }
    stopRecording();
    setProcessing(true);

    const project = projects.find(p => p.id === projectId);
    const projCtx = project ? [
      `Building Owner's Property: ${project.address}`,
      `Building Owner: ${project.bo_name || ''}`,
      `Proposed Works: ${project.works || ''}`,
      `Project Ref: ${project.ref}`,
      project.aos?.length ? `Adjoining Owners: ${project.aos.map(a => a.name).join(', ')}` : '',
    ].filter(Boolean).join('\n') : '';

    const prompt = `You are an expert party wall surveyor. Process these site dictation notes from a Schedule of Condition inspection.

${projCtx}

DICTATION NOTES:
${text}

Carefully analyse the dictation and separate it into three categories:

1. SOC OBSERVATIONS — factual condition observations of the property (go into the schedule)
2. SITE COMMENTS — items flagged for specific parties (note for BO, note for architect, note for SE, note for AO surveyor) — these go into a site comments section AND generate draft emails
3. FILLER SPEECH — connecting words, false starts, repetition — discard these

Return ONLY a valid JSON object in this exact format:
{
  "aoAddress": "detected adjoining owner address if mentioned, else empty string",
  "sections": [
    {
      "title": "Ground Floor Front Room",
      "roomCode": "GF",
      "rows": [
        {
          "ref": "GF-01",
          "description": "Full professional surveying observation using formal language. Describe location, nature, extent and any measurements.",
          "action": "Record only"
        }
      ]
    }
  ],
  "siteComments": [
    {
      "ref": "SC-01",
      "party": "Architect",
      "description": "Full description of the comment/action required, written as a site note"
    }
  ],
  "partyDrafts": [
    {
      "party": "Architect",
      "subject": "Schedule of Condition — [address] — Site Observations Requiring Attention",
      "body": "Full professional email/letter text. Dear [name],\\n\\nFollowing my inspection at the above address in connection with the proposed works at [BO address] under the Party Wall etc. Act 1996, I write to bring the following matters to your attention...\\n\\n[specific points]\\n\\nPlease do not hesitate to contact me should you require any further information.\\n\\nYours sincerely,\\n[Surveyor name]"
    }
  ]
}

Rules:
- Auto-detect room names from natural speech ("starting in the front room", "moving to the kitchen", "external rear")
- Use formal surveying language: "was observed", "noted at the time of inspection", "no visible defects noted at the time of inspection"
- Describe cracks with approximate dimensions (hairline, very slight, slight, moderate) per crack classification table
- Section room codes: GF=Ground Floor, FF=First Floor, RL=Rear Lounge, KI=Kitchen, HR=Hallway, MB=Main Bedroom, ER=External Rear, EF=External Front etc.
- Number refs sequentially per room
- Site comments: include ALL party-flagged items even if they overlap with SOC observations
- Party drafts: one per party mentioned, professional letter format
- Remove "SOC complete" trigger from output`;

    try {
      const result = await callEly({ prompt, surface: 'soc', projectId });
      const jsonMatch = (result.reply || '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI response. Please try again.');
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.aoAddress) setAoAddress(parsed.aoAddress);
      else if (project?.aos?.[0]?.premise) setAoAddress(project.aos[0].premise);

      setSocSections((parsed.sections || []).map(sec => ({
        id: uid(), title: sec.title || '', roomCode: sec.roomCode || '',
        rows: (sec.rows || []).map(r => ({ id: uid(), ref: r.ref || '', description: r.description || '', action: r.action || 'Record only' })),
      })));

      setSiteComments((parsed.siteComments || []).map(c => ({
        id: uid(), ref: c.ref || '', party: c.party || '', description: c.description || '',
      })));

      setPartyDrafts((parsed.partyDrafts || []).map(d => ({
        id: uid(), party: d.party || '', subject: d.subject || '', body: d.body || '',
        expanded: true, selectedEmail: '',
      })));

      setPhase('review');
    } catch (err) {
      alert('Error generating SOC: ' + err.message);
    } finally {
      setProcessing(false);
    }
  }, [fullTranscript, projectId, projects, stopRecording]);

  // ── Editing helpers ────────────────────────────────────────────────────────
  const updateRow = (secId, rowId, field, val) =>
    setSocSections(secs => secs.map(s => s.id !== secId ? s : {
      ...s, rows: s.rows.map(r => r.id !== rowId ? r : { ...r, [field]: val })
    }));
  const addRow = (secId) => {
    const sec = socSections.find(s => s.id === secId);
    const next = String(sec.rows.length + 1).padStart(2, '0');
    setSocSections(secs => secs.map(s => s.id !== secId ? s : {
      ...s, rows: [...s.rows, { id: uid(), ref: `${s.roomCode}-${next}`, description: '', action: 'Record only' }]
    }));
  };
  const removeRow = (secId, rowId) =>
    setSocSections(secs => secs.map(s => s.id !== secId ? s : { ...s, rows: s.rows.filter(r => r.id !== rowId) }));

  // ── Open in email composer ─────────────────────────────────────────────────
  const sendViaComposer = useCallback((draft) => {
    onOpenComposer?.({
      mode: 'compose',
      to: draft.selectedEmail || '',
      subject: draft.subject,
      body: draft.body,
      projectId,
    });
  }, [onOpenComposer, projectId]);

  const sendSOCByEmail = useCallback(() => {
    onOpenComposer?.({
      mode: 'compose',
      to: '',
      subject: `Schedule of Condition — ${selectedProject?.address || ''}`,
      body: `Dear [Recipient],\n\nPlease find attached the Schedule of Condition prepared in connection with the proposed works at ${selectedProject?.address || '[address]'} under the Party Wall etc. Act 1996.\n\nThis schedule records the existing condition of the adjoining property at ${aoAddress || '[adjoining address]'} prior to the commencement of the notified works.\n\nPlease do not hesitate to contact me should you require any further information.\n\nYours sincerely,\n${state.settings?.surveyorName || ''}`,
      projectId,
    });
  }, [onOpenComposer, selectedProject, aoAddress, projectId, state.settings]);

  // ── PDF Generation ─────────────────────────────────────────────────────────
  const generatePDF = useCallback(() => {
    const project = projects.find(p => p.id === projectId);
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const preparedBy = [state.settings?.surveyorName, state.settings?.qualifications].filter(Boolean).join(' ') + (state.settings?.firmName ? ` - ${state.settings.firmName}` : '');

    const sectionsHTML = socSections.map((sec, sIdx) => `
      <h2 style="font-size:12.5px;font-weight:700;margin:20px 0 0;padding:6px 10px;background:#f0f4ff;border-left:4px solid #1a1a2e;color:#1a1a2e">
        ${sIdx + 2}. ${sec.title}
      </h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="background:#1a1a2e;color:#fff;padding:6px 10px;font-size:9.5px;text-align:left;width:8%">Ref</th>
          <th style="background:#1a1a2e;color:#fff;padding:6px 10px;font-size:9.5px;text-align:left;width:67%">Observation / Description — ${sec.title}</th>
          <th style="background:#1a1a2e;color:#fff;padding:6px 10px;font-size:9.5px;text-align:left;width:25%">Action Required</th>
        </tr></thead>
        <tbody>
          ${sec.rows.map((row, i) => `
            <tr style="${i % 2 === 1 ? 'background:#f9f9fc' : ''}">
              <td style="padding:6px 10px;border-bottom:1px solid #e8e8f0;font-size:10px;font-weight:700;vertical-align:top">${row.ref}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e8e8f0;font-size:10px;vertical-align:top;line-height:1.55">${row.description}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e8e8f0;font-size:10px;vertical-align:top">${row.action}</td>
            </tr>`).join('')}
        </tbody>
      </table>`).join('');

    const siteCommentsHTML = siteComments.length > 0 ? `
      <h2 style="font-size:12.5px;font-weight:700;margin:20px 0 0;padding:6px 10px;background:#fff4e0;border-left:4px solid #e8a020;color:#1a1a2e">
        ${socSections.length + 2}. Site Comments
      </h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="background:#1a1a2e;color:#fff;padding:6px 10px;font-size:9.5px;text-align:left;width:8%">Ref</th>
          <th style="background:#1a1a2e;color:#fff;padding:6px 10px;font-size:9.5px;text-align:left;width:17%">Party</th>
          <th style="background:#1a1a2e;color:#fff;padding:6px 10px;font-size:9.5px;text-align:left;width:75%">Comment / Action</th>
        </tr></thead>
        <tbody>
          ${siteComments.map((c, i) => `
            <tr style="${i % 2 === 1 ? 'background:#f9f9fc' : ''}">
              <td style="padding:6px 10px;border-bottom:1px solid #e8e8f0;font-size:10px;font-weight:700;vertical-align:top">${c.ref}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e8e8f0;font-size:10px;vertical-align:top;font-weight:600">${c.party}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e8e8f0;font-size:10px;vertical-align:top;line-height:1.55">${c.description}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : '';

    const crackSection = socSections.length + (siteComments.length > 0 ? 3 : 2);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Schedule of Condition — ${project?.ref || ''}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a2e;padding:28px 44px}@media print{body{padding:10px 18px}@page{margin:1.5cm}}</style>
</head><body>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:3px solid #1a1a2e">
    <div>
      <div style="font-size:17px;font-weight:700;color:#1a1a2e">SCHEDULE OF CONDITIONS</div>
      <div style="font-size:10.5px;color:#555;margin-top:2px">Party Wall etc. Act 1996</div>
    </div>
    <div style="text-align:right;font-size:9.5px;color:#555;line-height:1.7">
      ${state.settings?.firmName || 'Square One Consulting'}<br>${state.settings?.email || ''}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:10.5px">
    <tbody>
      ${[
        ["Adjoining Owner's Property", aoAddress || '—'],
        ["Adjoining Owners", project?.aos?.map(a => a.name).join(', ') || '—'],
        ["Building Owner's Property", project?.address || '—'],
        ["Building Owner", project?.bo_name || '—'],
        ["Date of Inspection", today],
        ["Proposed Works", project?.works || '—'],
        ["Prepared By", preparedBy || '—'],
        ["Photographic Record", `Photographic thumbnails are not appended to this schedule with the originals saved on file at ${state.settings?.firmName || 'Square One Consulting'}.`],
      ].map(([l, v]) => `<tr>
        <td style="padding:5px 10px;border:1px solid #ccc;font-weight:700;width:28%;background:#f9f9fc">${l}</td>
        <td style="padding:5px 10px;border:1px solid #ccc">${v}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <h2 style="font-size:12.5px;font-weight:700;margin:0 0 7px">1. Introduction</h2>
  <p style="font-size:10.5px;line-height:1.65;color:#222;margin-bottom:8px">
    This Schedule of Conditions has been prepared pursuant to the Party Wall etc. Act 1996 in connection with the proposed notifiable works at the Building Owner's property, ${project?.address || '[address]'}. The purpose of this document is to record the existing condition of the Adjoining Owner's property at ${aoAddress || '[adjoining address]'}, prior to the commencement of those works, thereby establishing a contemporaneous baseline record against which any claims of damage arising during or after the execution of the works may be assessed.
  </p>
  <p style="font-size:10.5px;line-height:1.65;color:#222;margin-bottom:8px">
    The inspection was conducted by way of visual survey only. No opening-up works, testing or investigations were carried out. Where access was restricted or elements were concealed behind fixed finishes or furniture, this has been noted accordingly. Photographs were taken and are retained on file, forming an integral part of this record.
  </p>
  <p style="font-size:10.5px;line-height:1.65;color:#222">
    All references to left and right are made when facing the relevant elevation. Crack widths are classified in accordance with the crack classification table appended to this schedule.
  </p>

  ${sectionsHTML}
  ${siteCommentsHTML}

  <h2 style="font-size:12.5px;font-weight:700;margin:22px 0 7px">${crackSection}. Crack Classification</h2>
  <table style="width:50%;border-collapse:collapse;font-size:10.5px">
    <thead><tr>
      <th style="background:#1a1a2e;color:#fff;padding:6px 10px;text-align:left">Approximate Crack Width</th>
      <th style="background:#1a1a2e;color:#fff;padding:6px 10px;text-align:left">Associated Expression</th>
    </tr></thead>
    <tbody>
      ${[['Up to 0.1mm','Hairline'],['0.1mm to 1.0mm','Very Slight'],['1.1mm to 5.0mm','Slight'],['5.1mm to 15mm','Moderate'],['15.1mm to 25mm','Severe']]
        .map(([w,e],i) => `<tr style="${i%2===1?'background:#f9f9fc':''}">
          <td style="padding:5px 10px;border-bottom:1px solid #e8e8f0">${w}</td>
          <td style="padding:5px 10px;border-bottom:1px solid #e8e8f0">${e}</td>
        </tr>`).join('')}
    </tbody>
  </table>

</body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }, [socSections, siteComments, projectId, projects, aoAddress, state.settings]);

  // ── Render: Setup ──────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>🎙️ SOC Dictation</h1>
        </div>
        <div style={s.card}>
          <div style={s.field}>
            <label style={s.label}>Select project</label>
            <select style={s.select} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.ref} — {p.address}</option>)}
            </select>
          </div>
          <button style={{ ...s.recordBtn, opacity: !projectId ? 0.5 : 1 }} disabled={!projectId}
            onClick={() => { setPhase('recording'); startRecording(); }}>
            🎙️ Start Recording
          </button>
          <div style={s.hint}>
            Just speak naturally — <strong>say the room name as you go</strong>, Ely will pick it up automatically.<br />
            Say <strong>"note for architect / BO / SE / AO surveyor"</strong> to flag items for separate emails.<br />
            Say <strong>"SOC complete"</strong> when finished to generate everything.
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Recording ──────────────────────────────────────────────────────
  if (phase === 'recording') {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>🎙️ SOC Dictation</h1>
          <button onClick={() => handleGenerate()} style={s.doneBtn} disabled={processing}>
            {processing ? 'Generating…' : '✓ SOC Complete'}
          </button>
        </div>
        <div style={s.card}>
          <div style={s.statusBar}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isRecording
                ? <><div style={s.recDot} /><span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 13 }}>Recording…</span></>
                : <span style={{ color: 'var(--text3)', fontSize: 13 }}>Paused</span>}
              {selectedProject && (
                <div style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginLeft: 8,
                  width: '100%',
                  maxWidth: 520,
                }}>
                  <select
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                    style={{
                      ...s.select,
                      minWidth: 180,
                      fontSize: 12,
                      padding: '6px 10px',
                    }}
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.address || p.premise_address || p.bo_premise_address || p.ref}
                      </option>
                    ))}
                  </select>

                  <select
                    value={selectedAOIndex}
                    onChange={e => {
                      setSelectedAOIndex(e.target.value);
                      const ao = aoOptions[Number(e.target.value)];
                      if (ao?.address) setAoAddress(ao.address);
                    }}
                    style={{
                      ...s.select,
                      minWidth: 180,
                      fontSize: 12,
                      padding: '6px 10px',
                    }}
                  >
                    {aoOptions.map((ao, idx) => (
                      <option key={idx} value={idx}>
                        {ao.address || `AO${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isRecording
                ? <button onClick={stopRecording} style={s.stopBtn}>⏸ Pause</button>
                : <button onClick={startRecording} style={s.recordBtn}>🎙️ Resume</button>}
            </div>
          </div>

          <div ref={transcriptBoxRef} style={s.transcript}>
            {transcript || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>Start speaking — transcript appears here…</span>}
          </div>

          <div>
            <label style={{ ...s.label, display: 'block', marginBottom: 5 }}>Or type / paste notes</label>
            <textarea style={{ ...s.input, width: '100%', minHeight: 80, resize: 'vertical', fontSize: 12.5 }}
              placeholder="Type your notes here if not using voice…"
              value={fullTranscript}
              onChange={e => { setFullTranscript(e.target.value); transcriptRef.current = e.target.value; }} />
          </div>

          {processing && (
            <div style={s.processingBar}>
              <div style={s.spinner} /> Ely is generating your Schedule of Condition and party emails…
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Review ─────────────────────────────────────────────────────────
  const contacts = getProjectContacts();

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>📋 Schedule of Condition — Review</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setPhase('recording')} style={s.secondaryBtn}>← Back</button>
          <button onClick={sendSOCByEmail} style={s.secondaryBtn}>✉️ Send SOC by Email</button>
          <button onClick={generatePDF} style={s.primaryBtn}>⬇ Download PDF</button>
        </div>
      </div>

      {/* AO address */}
      <div style={s.card}>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Adjoining owner's address</label>
            <input style={s.input} value={aoAddress} placeholder="Address of property inspected"
              onChange={e => setAoAddress(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Project</label>
            <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text3)' }}
              value={projectDisplayAddress} disabled />
          </div>
        </div>
      </div>

      {/* SOC sections */}
      {socSections.map((sec, sIdx) => (
        <div key={sec.id} style={s.card}>
          <div style={s.sectionHeader}>
            <span style={s.sectionNum}>{sIdx + 2}.</span>
            <input style={{ ...s.input, fontWeight: 600, fontSize: 14, border: 'none', padding: 0, background: 'transparent', flex: 1 }}
              value={sec.title}
              onChange={e => setSocSections(secs => secs.map(s => s.id === sec.id ? { ...s, title: e.target.value } : s))} />
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: '8%' }}>Ref</th>
                <th style={{ ...s.th, width: '65%' }}>Observation / Description</th>
                <th style={{ ...s.th, width: '22%' }}>Action Required</th>
                <th style={{ ...s.th, width: '5%' }}></th>
              </tr>
            </thead>
            <tbody>
              {sec.rows.map(row => (
                <tr key={row.id}>
                  <td style={{ ...s.td, fontWeight: 700 }}>
                    <input style={{ ...s.tableInput, width: 54, textAlign: 'center', fontWeight: 700 }}
                      value={row.ref} onChange={e => updateRow(sec.id, row.id, 'ref', e.target.value)} />
                  </td>
                  <td style={s.td}>
                    <textarea style={{ ...s.tableInput, minHeight: 52, resize: 'vertical', lineHeight: 1.55 }}
                      value={row.description} onChange={e => updateRow(sec.id, row.id, 'description', e.target.value)} />
                  </td>
                  <td style={s.td}>
                    <select style={s.tableInput} value={row.action} onChange={e => updateRow(sec.id, row.id, 'action', e.target.value)}>
                      {ACTIONS.map(a => <option key={a}>{a}</option>)}
                    </select>
                  </td>
                  <td style={s.td}>
                    <button onClick={() => removeRow(sec.id, row.id)} style={s.removeBtn}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => addRow(sec.id)} style={s.addRowBtn}>+ Add observation</button>
        </div>
      ))}

      {/* Site comments section */}
      {siteComments.length > 0 && (
        <div style={s.card}>
          <div style={{ ...s.sectionHeader, background: 'var(--amber-bg, #fff8e0)', borderRadius: 8, padding: '6px 10px', marginBottom: 4 }}>
            <span style={{ ...s.sectionNum, color: 'var(--amber, #e8a020)' }}>{socSections.length + 2}.</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Site Comments</span>
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: '7%' }}>Ref</th>
                <th style={{ ...s.th, width: '15%' }}>Party</th>
                <th style={{ ...s.th, width: '73%' }}>Comment / Action Required</th>
                <th style={{ ...s.th, width: '5%' }}></th>
              </tr>
            </thead>
            <tbody>
              {siteComments.map(c => (
                <tr key={c.id}>
                  <td style={{ ...s.td, fontWeight: 700 }}>
                    <input style={{ ...s.tableInput, width: 54, textAlign: 'center', fontWeight: 700 }}
                      value={c.ref} onChange={e => setSiteComments(cs => cs.map(x => x.id === c.id ? { ...x, ref: e.target.value } : x))} />
                  </td>
                  <td style={s.td}>
                    <input style={s.tableInput} value={c.party}
                      onChange={e => setSiteComments(cs => cs.map(x => x.id === c.id ? { ...x, party: e.target.value } : x))} />
                  </td>
                  <td style={s.td}>
                    <textarea style={{ ...s.tableInput, minHeight: 48, resize: 'vertical', lineHeight: 1.55 }}
                      value={c.description}
                      onChange={e => setSiteComments(cs => cs.map(x => x.id === c.id ? { ...x, description: e.target.value } : x))} />
                  </td>
                  <td style={s.td}>
                    <button onClick={() => setSiteComments(cs => cs.filter(x => x.id !== c.id))} style={s.removeBtn}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Party draft emails */}
      {partyDrafts.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>📧 Draft Emails</div>
          {partyDrafts.map(draft => (
            <div key={draft.id} style={s.draftCard}>
              <div style={s.draftHeader}
                onClick={() => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, expanded: !d.expanded } : d))}>
                <span style={s.draftParty}>{draft.party}</span>
                <span style={{ color: 'var(--text3)', fontSize: 13 }}>{draft.expanded ? '▲' : '▼'}</span>
              </div>
              {draft.expanded && (
                <div style={s.draftBody}>
                  {/* To field — project contacts dropdown */}
                  <div style={s.field}>
                    <label style={s.label}>To</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select style={{ ...s.select, flex: 1 }}
                        value={draft.selectedEmail}
                        onChange={e => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, selectedEmail: e.target.value } : d))}>
                        <option value="">— Select recipient —</option>
                        {contacts.map((c, i) => <option key={i} value={c.email}>{c.label} ({c.email})</option>)}
                        <option value="__manual__">Enter manually…</option>
                      </select>
                    </div>
                    {draft.selectedEmail === '__manual__' && (
                      <input style={{ ...s.input, marginTop: 6 }} placeholder="Enter email address"
                        onChange={e => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, selectedEmail: e.target.value } : d))} />
                    )}
                  </div>
                  <div style={s.field}>
                    <label style={s.label}>Subject</label>
                    <input style={s.input} value={draft.subject}
                      onChange={e => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, subject: e.target.value } : d))} />
                  </div>
                  <div style={s.field}>
                    <label style={s.label}>Message</label>
                    <textarea style={{ ...s.input, minHeight: 180, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
                      value={draft.body}
                      onChange={e => setPartyDrafts(ds => ds.map(d => d.id === draft.id ? { ...d, body: e.target.value } : d))} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => navigator.clipboard.writeText(draft.body)} style={s.secondaryBtn}>📋 Copy</button>
                    <button onClick={() => sendViaComposer(draft)} style={s.primaryBtn}>✉️ Open in Composer</button>
                  </div>
                </div>
              )}
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
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 },
  sectionNum: { fontSize: 15, fontWeight: 700, color: 'var(--blue)', flexShrink: 0 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none' },
  input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box' },
  hint: { fontSize: 12, color: 'var(--text3)', background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.7 },
  recordBtn: { background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 99, padding: '10px 24px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  stopBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 99, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  doneBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 99, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  statusBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 },
  recDot: { width: 9, height: 9, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 },
  transcript: { minHeight: 160, maxHeight: 300, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)', padding: '4px 0' },
  processingBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--blue-bg)', color: 'var(--blue)', fontSize: 13, borderRadius: 8 },
  spinner: { width: 13, height: 13, border: '2px solid var(--blue)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '7px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', borderBottom: '2px solid var(--border)', textAlign: 'left' },
  td: { padding: '5px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' },
  tableInput: { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: 'var(--text)', background: 'var(--bg)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14, padding: 2 },
  addRowBtn: { alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--blue)', borderRadius: 8, color: 'var(--blue)', padding: '6px 14px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 },
  draftCard: { border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  draftHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg3)', cursor: 'pointer' },
  draftParty: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  draftBody: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
  primaryBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer' },
};
