import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

const INSERT_OPTIONS = [
  { value: 'after_last', label: 'After last page' },
  { value: 'after_current', label: 'After current page' },
  { value: 'after_first', label: 'After first page' },
  { value: 'after_number', label: 'After page…' },
];

function btn(variant, disabled = false) {
  const base = {
    padding: '8px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
    transition: 'all 0.15s',
  };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: '#94a3b8', border: '1px solid #2a2d3a' };
  if (variant === 'primary') return { ...base, background: disabled ? '#1e2130' : '#3b82f6', color: disabled ? '#475569' : '#fff' };
  if (variant === 'danger') return { ...base, background: disabled ? '#21171c' : '#7f1d1d', color: disabled ? '#6b4a55' : '#fecaca', border: '1px solid #7f1d1d' };
  return base;
}

function base64ToObjectUrl(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function AttachModal({ currentPageIdx, totalPages, onConfirm, onClose }) {
  const [file, setFile] = useState(null);
  const [insertMode, setInsertMode] = useState('after_last');
  const [pageNum, setPageNum] = useState('');
  const fileRef = useRef();

  const handleConfirm = () => {
    if (!file) return;
    let position;
    if (insertMode === 'after_current') position = currentPageIdx;
    else if (insertMode === 'after_first') position = 0;
    else if (insertMode === 'after_number') {
      const parsed = Number.parseInt(pageNum, 10);
      position = Number.isFinite(parsed) ? Math.max(0, Math.min(totalPages - 1, parsed - 1)) : totalPages - 1;
    } else position = totalPages - 1;
    onConfirm({ file, position: Math.max(-1, position) });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ background: '#161820', border: '1px solid #2a2d3a', borderRadius: '12px', padding: '24px', width: '380px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9', marginBottom: '16px' }}>Attach PDF</div>
        <div onClick={() => fileRef.current?.click()} style={{ border: '1.5px dashed #334155', borderRadius: '8px', padding: '20px', textAlign: 'center', cursor: 'pointer', marginBottom: '16px', color: file ? '#e2e8f0' : '#64748b', fontSize: '13px' }}>
          {file ? `✓ ${file.name}` : 'Click to select a PDF'}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
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
            <input type="number" min={1} max={Math.max(1, totalPages)} value={pageNum} onChange={e => setPageNum(e.target.value)} placeholder={`1–${Math.max(1, totalPages)}`} style={{ marginLeft: '24px', width: '80px', padding: '4px 8px', background: '#1e2130', border: '1px solid #334155', borderRadius: '4px', color: '#e2e8f0', fontSize: '13px' }} />
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
        <div style={{ fontSize: '12px', color: '#475569', margin: '12px 0 16px' }}>The PDF will be saved to OneDrive and an email to the building owner prepared.</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('ghost')}>Cancel</button>
          <button onClick={() => onConfirm(saveTarget)} style={btn('primary')}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export default function NoticeReviewModal({ aoQueue = [], project, onComplete, onBack, onClose }) {
  const [queueIndex, setQueueIndex] = useState(0);
  const [generating, setGenerating] = useState(true);
  const [pdfB64, setPdfB64] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pages, setPages] = useState([]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [selectedPageIds, setSelectedPageIds] = useState(() => new Set());
  const [showAttach, setShowAttach] = useState(false);
  const [showSave, setShowSave] = useState(false);

  const completedPacks = useRef([]);
  const currentEntry = aoQueue[queueIndex];
  const isLastAO = queueIndex === aoQueue.length - 1;

  const replacePreview = useCallback((b64) => {
    setPdfB64(b64);
    setPdfUrl(previous => {
      if (previous) URL.revokeObjectURL(previous);
      return base64ToObjectUrl(b64);
    });
  }, []);

  const mergePageList = useCallback(async (pageList) => {
    if (!pageList.length) throw new Error('The pack must contain at least one page');
    const mergeRes = await fetch('/api/merge-pdfs-b64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfs: pageList.map((page, index) => ({ b64: page.b64, name: page.label || `Page ${index + 1}` })) }),
    });
    const data = await mergeRes.json();
    if (!mergeRes.ok || !data?.pdf_b64) throw new Error(data?.error || 'Could not rebuild the PDF');
    replacePreview(data.pdf_b64);
  }, [replacePreview]);

  useEffect(() => {
    if (!currentEntry) return undefined;
    let cancelled = false;
    setPdfB64(null);
    setPdfUrl(null);
    setPages([]);
    setCurrentPageIdx(0);
    setSelectedPageIds(new Set());
    setGenerating(true);

    (async () => {
      try {
        const mergeRes = await fetch('/api/merge-notice-pdfs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documents: currentEntry.sortedDocs,
            outputFileName: `${currentEntry.ao?.premise || 'Notice'}_Pack.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_'),
          }),
        });
        const merged = await mergeRes.json();
        if (!mergeRes.ok || !merged?.pdf_b64) throw new Error(merged?.error || 'PDF generation failed');

        const splitRes = await fetch('/api/split-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdf_b64: merged.pdf_b64, filename: 'notice_pack.pdf' }),
        });
        const split = await splitRes.json();
        if (!splitRes.ok || !split?.pages?.length) throw new Error(split?.error || 'Could not prepare PDF pages');
        if (cancelled) return;

        setPages(split.pages.map((page, index) => ({
          id: `notice-${queueIndex}-${index}-${Date.now()}`,
          label: `Notice pack page ${page.page_num}`,
          source: 'notice',
          b64: page.b64,
          originalPageNumber: page.page_num,
        })));
        replacePreview(merged.pdf_b64);
      } catch (err) {
        if (!cancelled) alert(`PDF generation failed: ${err.message}`);
      } finally {
        if (!cancelled) setGenerating(false);
      }
    })();

    return () => { cancelled = true; };
  }, [queueIndex, currentEntry, replacePreview]);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  const selectedCount = selectedPageIds.size;
  const allSelected = pages.length > 0 && selectedCount === pages.length;

  const viewerUrl = useMemo(() => {
    if (!pdfUrl) return null;
    return `${pdfUrl}#page=${currentPageIdx + 1}&zoom=page-width&toolbar=0&navpanes=0`;
  }, [pdfUrl, currentPageIdx]);

  const toggleSelected = useCallback((id) => {
    setSelectedPageIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedPageIds(allSelected ? new Set() : new Set(pages.map(page => page.id)));
  }, [allSelected, pages]);

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedCount) return;
    if (selectedCount === pages.length) {
      alert('At least one page must remain in the pack.');
      return;
    }
    if (!window.confirm(`Delete ${selectedCount} selected page${selectedCount === 1 ? '' : 's'} from the PDF?`)) return;

    const remaining = pages.filter(page => !selectedPageIds.has(page.id));
    setGenerating(true);
    try {
      await mergePageList(remaining);
      setPages(remaining);
      setSelectedPageIds(new Set());
      setCurrentPageIdx(index => Math.min(index, remaining.length - 1));
    } catch (err) {
      alert(`Could not delete pages: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }, [mergePageList, pages, selectedCount, selectedPageIds]);

  const handleAttachConfirm = useCallback(async ({ file, position }) => {
    setShowAttach(false);
    setGenerating(true);
    try {
      const attachB64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the selected file'));
        reader.readAsDataURL(file);
      });

      const splitRes = await fetch('/api/split-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_b64: attachB64, filename: file.name }),
      });
      const split = await splitRes.json();
      if (!splitRes.ok || !split?.pages?.length) throw new Error(split?.error || 'Could not split the attached PDF');

      const stamp = Date.now();
      const attachedPages = split.pages.map((page, index) => ({
        id: `attachment-${stamp}-${index}`,
        label: split.pages.length === 1 ? file.name : `${file.name} — page ${page.page_num}`,
        source: 'attachment',
        fileName: file.name,
        b64: page.b64,
        originalPageNumber: page.page_num,
      }));
      const next = [...pages];
      next.splice(Math.min(next.length, position + 1), 0, ...attachedPages);
      await mergePageList(next);
      setPages(next);
      setCurrentPageIdx(Math.min(next.length - 1, position + 1));
      setSelectedPageIds(new Set());
    } catch (err) {
      alert(`Attach failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }, [mergePageList, pages]);

  const handleSaveConfirm = useCallback((saveTarget) => {
    setShowSave(false);
    if (!pdfB64) return;
    const fileName = `${project?.bo_premise_address || 'Notice'}_${currentEntry.ao?.premise || currentEntry.ao?.name || 'AO'}_Notice_Pack.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    completedPacks.current.push({
      ao: currentEntry.ao,
      aoSections: currentEntry.aoSections,
      aoWorksItems: currentEntry.aoWorksItems,
      aoS2Subs: currentEntry.aoS2Subs,
      pdf_b64: pdfB64,
      fileName,
      saveTarget,
    });
    if (isLastAO) onComplete?.(completedPacks.current);
    else setQueueIndex(index => index + 1);
  }, [currentEntry, isLastAO, onComplete, pdfB64, project]);

  if (!currentEntry) return null;

  const aoLabel = currentEntry.ao?.premise || currentEntry.ao?.address || currentEntry.ao?.name || 'Adjoining Owner';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1117', zIndex: 500, display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', minHeight: '52px', background: '#161820', borderBottom: '1px solid #2a2d3a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>{project?.bo_premise_address || 'Notice Pack'}</span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{aoLabel}</span>
          {aoQueue.length > 1 && <span style={{ fontSize: '11px', padding: '2px 8px', background: '#1a2340', border: '1px solid #1d4ed8', borderRadius: '4px', color: '#93c5fd' }}>AO {queueIndex + 1} of {aoQueue.length}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={onBack} style={btn('ghost')}>← Back to Edit</button>
          <button onClick={onClose} style={btn('ghost')}>Cancel</button>
          {!generating && pdfUrl && <button onClick={() => setShowSave(true)} style={btn('primary')}>{isLastAO ? 'Download & Send →' : `Confirm AO ${queueIndex + 1} & Continue →`}</button>}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside style={{ width: '230px', background: '#13151e', borderRight: '1px solid #2a2d3a', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px', borderBottom: '1px solid #2a2d3a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{pages.length} pages</span>
              <button onClick={handleSelectAll} disabled={generating || !pages.length} style={{ background: 'transparent', border: 0, color: '#93c5fd', fontSize: '11px', cursor: 'pointer' }}>{allSelected ? 'Clear all' : 'Select all'}</button>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setShowAttach(true)} disabled={generating} style={{ ...btn('ghost', generating), padding: '6px 8px', flex: 1, fontSize: '11px' }}>+ Attach PDF</button>
              <button onClick={handleDeleteSelected} disabled={generating || !selectedCount} style={{ ...btn('danger', generating || !selectedCount), padding: '6px 8px', flex: 1, fontSize: '11px' }}>Delete {selectedCount || ''}</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {generating && !pages.length ? (
              <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '24px' }}>Preparing pages…</div>
            ) : pages.map((page, index) => {
              const selected = selectedPageIds.has(page.id);
              const current = currentPageIdx === index;
              return (
                <div key={page.id} onClick={() => setCurrentPageIdx(index)} style={{ position: 'relative', display: 'flex', gap: '9px', padding: '8px', marginBottom: '8px', background: current ? '#1a2340' : '#191c26', border: `1px solid ${current ? '#3b82f6' : selected ? '#64748b' : '#2a2d3a'}`, borderRadius: '7px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected} onClick={event => event.stopPropagation()} onChange={() => toggleSelected(page.id)} style={{ marginTop: '3px', accentColor: '#3b82f6', cursor: 'pointer' }} />
                  <div style={{ width: '48px', height: '66px', background: '#fff', borderRadius: '2px', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>{[88, 64, 78, 54, 82, 70, 45].map((width, row) => <div key={row} style={{ height: row === 0 ? '3px' : '2px', width: `${width}%`, background: row === 0 ? '#9ca3af' : '#d1d5db', borderRadius: '1px' }} />)}</div>
                    <span style={{ position: 'absolute', right: '3px', bottom: '2px', fontSize: '8px', color: '#6b7280' }}>{index + 1}</span>
                  </div>
                  <div style={{ minWidth: 0, paddingTop: '2px' }}>
                    <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: current ? 600 : 500 }}>Page {index + 1}</div>
                    <div title={page.label} style={{ marginTop: '5px', fontSize: '10px', color: '#64748b', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{page.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <main style={{ flex: 1, background: '#d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
          {generating && <div style={{ position: 'absolute', inset: 0, background: 'rgba(209,213,219,0.8)', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: '13px', color: '#475569' }}>Updating PDF…</div></div>}
          {viewerUrl ? <iframe key={viewerUrl} src={viewerUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="Notice preview" /> : !generating && <div style={{ color: '#ef4444', fontSize: '13px' }}>PDF could not be loaded.</div>}
        </main>
      </div>

      {showAttach && <AttachModal currentPageIdx={currentPageIdx} totalPages={pages.length} onConfirm={handleAttachConfirm} onClose={() => setShowAttach(false)} />}
      {showSave && <SaveModal project={project} ao={currentEntry.ao} onConfirm={handleSaveConfirm} onClose={() => setShowSave(false)} />}
    </div>
  );
}
