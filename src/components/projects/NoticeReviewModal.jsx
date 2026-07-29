import { useState, useRef, useCallback, useEffect } from 'react';

const INSERT_OPTIONS = [
  { value: 'after_last',     label: 'After last page'     },
  { value: 'after_selected', label: 'After selected page' },
  { value: 'after_first',    label: 'After first page'    },
  { value: 'after_number',   label: 'After page…'         },
];

const DOC_LABELS = {
  cover: 'Covering Letter',
  s1: 'Section 1(5) Notice',
  s2: 'Section 2(2) Notice',
  s6: 'Section 6(1) Notice',
  s10: 'Section 10 Notice',
};

function btn(variant, disabled = false) {
  const base = { padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.15s' };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: '#94a3b8', border: '1px solid #2a2d3a' };
  if (variant === 'primary') return { ...base, background: disabled ? '#1e2130' : '#3b82f6', color: disabled ? '#475569' : '#fff' };
  if (variant === 'danger') return { ...base, background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d' };
  return base;
}

function AttachModal({ currentPageIdx, totalPages, onConfirm, onClose }) {
  const [file, setFile] = useState(null);
  const [insertMode, setInsertMode] = useState('after_last');
  const [pageNum, setPageNum] = useState('');
  const fileRef = useRef();

  const handleConfirm = () => {
    if (!file) return;
    let position;
    if (insertMode === 'after_selected') position = currentPageIdx;
    else if (insertMode === 'after_first') position = 0;
    else if (insertMode === 'after_last') position = Math.max(0, totalPages - 1);
    else if (insertMode === 'after_number') position = Math.max(0, Math.min(totalPages - 1, parseInt(pageNum, 10) - 1));
    else position = Math.max(0, totalPages - 1);
    onConfirm({ file, position });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ background: '#161820', border: '1px solid #2a2d3a', borderRadius: '12px', padding: '24px', width: '360px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9', marginBottom: '16px' }}>Attach document</div>

        <div onClick={() => fileRef.current?.click()} style={{ border: '1.5px dashed #334155', borderRadius: '8px', padding: '20px', textAlign: 'center', cursor: 'pointer', marginBottom: '16px', color: file ? '#e2e8f0' : '#475569', fontSize: '13px' }}>
          {file ? `✓ ${file.name}` : 'Click to select a PDF'}
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Insert position</div>
          {INSERT_OPTIONS.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#94a3b8', marginBottom: '8px', cursor: 'pointer' }}>
              <input type="radio" name="insertMode" value={opt.value} checked={insertMode === opt.value} onChange={() => setInsertMode(opt.value)} style={{ accentColor: '#3b82f6' }} />
              {opt.label}
            </label>
          ))}
          {insertMode === 'after_number' && (
            <input type="number" min={1} max={totalPages} value={pageNum} onChange={e => setPageNum(e.target.value)}
              placeholder={`1–${totalPages}`}
              style={{ marginLeft: '24px', width: '80px', padding: '4px 8px', background: '#1e2130', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', fontSize: '13px' }} />
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('ghost')}>Cancel</button>
          <button onClick={handleConfirm} disabled={!file} style={btn('primary', !file)}>Insert</button>
        </div>
      </div>
    </div>
  );
}

function SaveModal({ project, ao, onConfirm, onClose }) {
  const [saveTarget, setSaveTarget] = useState('ao_folder');
  const options = [
    { value: 'ao_folder', label: `AO folder — ${ao?.premise || ao?.address || ao?.name || 'Adjoining Owner'}` },
    { value: 'project_folder', label: `Project folder — ${project?.bo_premise_address || project?.ref || 'Project'}` },
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ background: '#161820', border: '1px solid #2a2d3a', borderRadius: '12px', padding: '24px', width: '400px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9', marginBottom: '6px' }}>Download & Send</div>
        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>Where should the PDF be saved?</div>
        {options.map(opt => (
          <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', background: saveTarget === opt.value ? '#1a2340' : '#1e2130', border: `1.5px solid ${saveTarget === opt.value ? '#3b82f6' : '#2a2d3a'}`, borderRadius: '8px', marginBottom: '8px', cursor: 'pointer' }}>
            <input type="radio" name="saveTarget" value={opt.value} checked={saveTarget === opt.value} onChange={() => setSaveTarget(opt.value)} style={{ accentColor: '#3b82f6', marginTop: '2px' }} />
            <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500 }}>{opt.label}</div>
          </label>
        ))}
        <div style={{ fontSize: '12px', color: '#475569', margin: '12px 0 16px' }}>
          The PDF will be saved to OneDrive and an email to the building owner prepared.
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('ghost')}>Cancel</button>
          <button onClick={() => onConfirm(saveTarget)} style={btn('primary')}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/**
 * NoticeReviewModal
 *
 * Props:
 *   aoQueue      — [{ ao, sortedDocs, aoSections, aoWorksItems, aoS2Subs }]
 *   project      — project object
 *   onComplete   — (packs) => void  — called after final AO confirmed
 *   onBack       — () => void       — reopens NoticeServingModal with original data
 *   onClose      — () => void
 */
export default function NoticeReviewModal({ aoQueue = [], project, onComplete, onBack, onClose }) {
  const [queueIndex, setQueueIndex] = useState(0);
  const [generating, setGenerating] = useState(true); // start true — PDF generates on mount
  const [pdfB64, setPdfB64] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);

  // Pages for thumbnail strip — starts as the merged doc pages, grows with attachments
  const [pages, setPages] = useState([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showSave, setShowSave] = useState(false);

  const completedPacks = useRef([]);
  const currentEntry = aoQueue[queueIndex];
  const isLastAO = queueIndex === aoQueue.length - 1;

  // ── Generate merged PDF for current AO on mount / AO change ──
  useEffect(() => {
    if (!currentEntry) return;
    let cancelled = false;

    setPdfB64(null);
    setPdfUrl(null);
    setPages([]);
    setSelectedPageIdx(null);
    setGenerating(true);

    (async () => {
      try {
        const res = await fetch('/api/merge-notice-pdfs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documents: currentEntry.sortedDocs,
            outputFileName: `${currentEntry.ao?.premise || 'Notice'}_Pack.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_'),
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data?.pdf_b64) throw new Error(data?.error || 'PDF generation failed');

        const binary = atob(data.pdf_b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        if (!cancelled) {
          setPdfB64(data.pdf_b64);
          setPdfUrl(url);
          // Build initial page list — one entry per source doc
          setPages(currentEntry.sortedDocs.map((d, i) => ({
            id: `doc-${i}`,
            label: DOC_LABELS[d.key] || d.key,
            source: 'document',
          })));
          setGenerating(false);
        }
      } catch (err) {
        if (!cancelled) {
          alert(`PDF generation failed: ${err.message}`);
          setGenerating(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [queueIndex, currentEntry]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  const handleDeletePage = useCallback((idx) => {
    if (!window.confirm(`Remove page ${idx + 1} from the PDF?`)) return;
    setPages(prev => prev.filter((_, i) => i !== idx));
    setSelectedPageIdx(null);
    // In full implementation: regenerate PDF without that page
  }, []);

  const handleAttachConfirm = useCallback(async ({ file, position }) => {
    setShowAttach(false);
    setGenerating(true);

    try {
      // Read the attached PDF as base64
      const attachB64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Build ordered document list with attachment inserted at position
      const id = `attach-${Date.now()}`;
      const newPage = { id, label: file.name, source: 'attachment', pdf_b64: attachB64 };

      // Insert into pages at position+1
      const newPages = [...pages];
      newPages.splice(position + 1, 0, newPage);

      // Re-merge: build documents array in page order
      // Original doc pages share the main pdf_b64; attachment has its own
      // We need to re-merge via API using the current main PDF + attachment
      const mergeRes = await fetch('/api/merge-pdfs-b64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Pass PDFs in page order: main pack first or second depending on position
          pdfs: position >= pages.length - 1
            ? [{ b64: pdfB64, name: 'notice_pack.pdf' }, { b64: attachB64, name: file.name }]
            : [{ b64: attachB64, name: file.name }, { b64: pdfB64, name: 'notice_pack.pdf' }],
        }),
      });

      const data = await mergeRes.json();
      if (!data?.pdf_b64) throw new Error(data?.error || 'Merge failed');

      // Update blob URL
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const binary = atob(data.pdf_b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });

      setPdfB64(data.pdf_b64);
      setPdfUrl(URL.createObjectURL(blob));
      setPages(newPages);
    } catch (err) {
      alert(`Attach failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }, [pages, pdfB64, pdfUrl]);

  const handleSaveConfirm = useCallback(async (saveTarget) => {
    setShowSave(false);
    if (!pdfB64) return;

    const fileName = `${project?.bo_premise_address || 'Notice'}_${currentEntry.ao?.premise || currentEntry.ao?.name || 'AO'}_Notice_Pack.pdf`
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    completedPacks.current.push({
      ao: currentEntry.ao,
      aoSections: currentEntry.aoSections,
      aoWorksItems: currentEntry.aoWorksItems,
      aoS2Subs: currentEntry.aoS2Subs,
      pdf_b64: pdfB64,
      fileName,
      saveTarget,
    });

    if (isLastAO) {
      onComplete?.(completedPacks.current);
    } else {
      setQueueIndex(i => i + 1);
    }
  }, [pdfB64, currentEntry, project, isLastAO, onComplete]);

  if (!currentEntry) return null;

  const aoLabel = currentEntry.ao?.premise || currentEntry.ao?.address || currentEntry.ao?.name || 'Adjoining Owner';
  const totalAOs = aoQueue.length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1117', zIndex: 500, display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: '52px', background: '#161820', borderBottom: '1px solid #2a2d3a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>{project?.bo_premise_address || 'Notice Pack'}</span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{aoLabel}</span>
          {totalAOs > 1 && (
            <span style={{ fontSize: '11px', padding: '2px 8px', background: '#1a2340', border: '1px solid #1d4ed8', borderRadius: '4px', color: '#93c5fd' }}>
              AO {queueIndex + 1} of {totalAOs}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={onBack} style={btn('ghost')}>← Back to Edit</button>
          <button onClick={onClose} style={btn('ghost')}>Cancel</button>
          {!generating && pdfUrl && (
            <button onClick={() => setShowSave(true)} style={btn('primary')}>
              {isLastAO ? 'Download & Send →' : `Confirm AO ${queueIndex + 1} & Continue →`}
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left thumbnail strip */}
        <div style={{ width: '160px', background: '#13151e', borderRight: '1px solid #2a2d3a', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px 10px 6px', fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2a2d3a' }}>
            Pages
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {generating ? (
              <div style={{ color: '#475569', fontSize: '11px', textAlign: 'center', marginTop: '20px' }}>Generating…</div>
            ) : pages.map((page, i) => (
              <div key={page.id} onClick={() => setSelectedPageIdx(selectedPageIdx === i ? null : i)}
                style={{ position: 'relative', background: '#fff', borderRadius: '3px', aspectRatio: '0.707', cursor: 'pointer', border: `2px solid ${selectedPageIdx === i ? '#3b82f6' : 'transparent'}`, marginBottom: '10px', overflow: 'hidden' }}>
                {/* Checkbox */}
                <div style={{ position: 'absolute', top: '4px', left: '4px', width: '16px', height: '16px', background: selectedPageIdx === i ? '#3b82f6' : 'rgba(255,255,255,0.8)', border: `1.5px solid ${selectedPageIdx === i ? '#3b82f6' : '#9ca3af'}`, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', zIndex: 2 }}>
                  {selectedPageIdx === i ? '✓' : ''}
                </div>
                {/* Fake lines */}
                <div style={{ padding: '24px 8px 8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {[80,60,90,50,75,40,85,55,70].map((w,j) => (
                    <div key={j} style={{ height: j===0?'4px':'3px', width:`${w}%`, background: j===0?'#9ca3af':'#e5e7eb', borderRadius:'1px' }} />
                  ))}
                </div>
                {/* Label */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(255,255,255,0.92)', padding: '2px 4px', fontSize: '9px', color: '#6b7280', textAlign: 'center', fontFamily: '-apple-system, sans-serif', lineHeight: 1.3 }}>
                  {page.label}<br /><span style={{ color: '#9ca3af' }}>p.{i+1}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          {!generating && (
            <div style={{ padding: '10px', borderTop: '1px solid #2a2d3a', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {selectedPageIdx !== null && (
                <button onClick={() => handleDeletePage(selectedPageIdx)}
                  style={{ ...btn('danger'), fontSize: '12px', padding: '6px 8px', width: '100%' }}>
                  Delete page {selectedPageIdx + 1}
                </button>
              )}
              <button onClick={() => setShowAttach(true)}
                style={{ width: '100%', padding: '7px 0', background: '#1e2130', border: '1px dashed #334155', borderRadius: '5px', color: '#475569', fontSize: '11px', cursor: 'pointer', fontFamily: '-apple-system, sans-serif' }}
                onMouseEnter={e => { e.target.style.borderColor='#3b82f6'; e.target.style.color='#93c5fd'; }}
                onMouseLeave={e => { e.target.style.borderColor='#334155'; e.target.style.color='#475569'; }}>
                + Attach document
              </button>
            </div>
          )}
        </div>

        {/* PDF viewer */}
        <div style={{ flex: 1, background: '#d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {generating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: '13px', color: '#6b7280', fontFamily: '-apple-system, sans-serif' }}>Generating PDF…</div>
            </div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="Notice preview"
            />
          ) : (
            <div style={{ color: '#ef4444', fontSize: '13px', fontFamily: '-apple-system, sans-serif' }}>PDF could not be loaded.</div>
          )}
        </div>
      </div>

      {showAttach && (
        <AttachModal
          currentPageIdx={selectedPageIdx ?? Math.max(0, pages.length - 1)}
          totalPages={pages.length}
          onConfirm={handleAttachConfirm}
          onClose={() => setShowAttach(false)}
        />
      )}

      {showSave && (
        <SaveModal
          project={project}
          ao={currentEntry.ao}
          onConfirm={handleSaveConfirm}
          onClose={() => setShowSave(false)}
        />
      )}
    </div>
  );
}
