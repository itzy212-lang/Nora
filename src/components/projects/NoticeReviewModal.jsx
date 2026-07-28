import { useState, useRef, useCallback, useEffect } from 'react';
import mammoth from 'mammoth';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_ORDER = ['cover', 's2', 's6', 's1', 's10'];

const DOC_LABELS = {
  cover: 'Covering Letter',
  s1: 'Section 1(5) Notice',
  s2: 'Section 2(2) Notice',
  s6: 'Section 6(1) Notice',
  s10: 'Section 10 Notice',
};

const INSERT_OPTIONS = [
  { value: 'after_selected', label: 'After selected page' },
  { value: 'after_first',    label: 'After first page'    },
  { value: 'after_last',     label: 'After last page'     },
  { value: 'after_number',   label: 'After page…'         },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function docxB64ToHtml(docx_b64) {
  try {
    // Convert base64 to ArrayBuffer
    const binary = atob(docx_b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const result = await mammoth.convertToHtml(
      { arrayBuffer: bytes.buffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h2:fresh",
          "p[style-name='Heading 2'] => h3:fresh",
        ],
      }
    );
    return result.value || '<p>(Empty document)</p>';
  } catch (err) {
    console.error('[NoticeReviewModal] mammoth conversion failed:', err);
    return '<p style="color:#ef4444">[Could not render document content — please generate PDF directly]</p>';
  }
}

function getPageStyle() {
  return {
    width: '794px',
    minHeight: '1123px',
    background: '#fff',
    color: '#111',
    padding: '72px 80px',
    fontFamily: "'Times New Roman', Times, serif",
    fontSize: '13px',
    lineHeight: '1.65',
    boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
    marginBottom: '12px',
    outline: 'none',
    boxSizing: 'border-box',
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ current, total, aoName }) {
  if (total <= 1) return null;
  return (
    <div style={{
      padding: '6px 20px',
      background: '#1a2340',
      borderBottom: '1px solid #2a2d3a',
      fontSize: '12px',
      color: '#93c5fd',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    }}>
      <span style={{ fontWeight: 600 }}>AO {current} of {total}</span>
      <span style={{ color: '#475569' }}>—</span>
      <span>{aoName}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: i < current ? '#3b82f6' : i === current - 1 ? '#60a5fa' : '#2a2d3a',
          }} />
        ))}
      </div>
    </div>
  );
}

function EditScreen({ docs, editorRefs, loading }) {
  if (loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#d1d5db', flexDirection: 'column', gap: '12px',
      }}>
        <div style={{
          width: '32px', height: '32px', border: '3px solid #e5e7eb',
          borderTopColor: '#3b82f6', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: '13px', color: '#6b7280', fontFamily: '-apple-system, sans-serif' }}>
          Loading document…
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      background: '#d1d5db',
      padding: '32px 0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      {docs.map((doc, i) => (
        <div key={doc.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Section label between documents */}
          <div style={{
            width: '794px',
            textAlign: 'center',
            fontSize: '11px',
            color: '#6b7280',
            fontFamily: '-apple-system, sans-serif',
            padding: '10px 0 8px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            {DOC_LABELS[doc.key] || doc.key}
          </div>

          {/* Editable page */}
          <div
            ref={el => { editorRefs.current[i] = el; }}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            dangerouslySetInnerHTML={{ __html: doc.html }}
            onKeyDown={e => handleEditorKeyDown(e)}
            style={getPageStyle()}
          />
        </div>
      ))}
    </div>
  );
}

function handleEditorKeyDown(e) {
  // Ensure Enter inside a list item continues the list
  if (e.key === 'Enter') {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const node = sel.getRangeAt(0).startContainer;
    const li = node.nodeType === 3 ? node.parentElement?.closest('li') : node.closest?.('li');
    if (li) {
      // Let browser handle it — it will continue the list
      return;
    }
  }
}

function ThumbnailStrip({
  pages,
  selectedPages,
  onSelect,
  onDeleteSelected,
  onAttachClick,
}) {
  const anySelected = selectedPages.size > 0;

  return (
    <div style={{
      width: '160px',
      background: '#13151e',
      borderRight: '1px solid #2a2d3a',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      {/* Delete toolbar */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid #2a2d3a',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minHeight: '40px',
      }}>
        {anySelected ? (
          <>
            <span style={{ fontSize: '11px', color: '#94a3b8', flex: 1 }}>
              {selectedPages.size} selected
            </span>
            <button
              onClick={onDeleteSelected}
              style={{
                padding: '4px 8px',
                background: '#7f1d1d',
                border: '1px solid #991b1b',
                borderRadius: '4px',
                color: '#fca5a5',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Delete
            </button>
          </>
        ) : (
          <span style={{ fontSize: '11px', color: '#475569' }}>Pages</span>
        )}
      </div>

      {/* Thumbnails */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 0' }}>
        {pages.map((page, i) => {
          const isSelected = selectedPages.has(page.id);
          return (
            <div
              key={page.id}
              onClick={() => onSelect(page.id)}
              style={{
                position: 'relative',
                background: '#fff',
                borderRadius: '3px',
                aspectRatio: '0.707',
                cursor: 'pointer',
                border: `2px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
                marginBottom: '10px',
                overflow: 'hidden',
                transition: 'border-color 0.1s',
              }}
            >
              {/* Checkbox top-left */}
              <div
                onClick={e => { e.stopPropagation(); onSelect(page.id); }}
                style={{
                  position: 'absolute',
                  top: '4px',
                  left: '4px',
                  width: '16px',
                  height: '16px',
                  background: isSelected ? '#3b82f6' : 'rgba(255,255,255,0.8)',
                  border: `1.5px solid ${isSelected ? '#3b82f6' : '#9ca3af'}`,
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: '#fff',
                  zIndex: 2,
                }}
              >
                {isSelected ? '✓' : ''}
              </div>

              {/* Fake page lines */}
              <div style={{ padding: '24px 8px 8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {[80, 60, 90, 50, 75, 40, 85, 55, 70, 45, 80].map((w, j) => (
                  <div key={j} style={{
                    height: j === 0 ? '4px' : '3px',
                    width: `${w}%`,
                    background: j === 0 ? '#9ca3af' : '#e5e7eb',
                    borderRadius: '1px',
                  }} />
                ))}
              </div>

              {/* Label */}
              <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                background: 'rgba(255,255,255,0.92)',
                padding: '2px 4px',
                fontSize: '9px',
                color: '#6b7280',
                textAlign: 'center',
                fontFamily: '-apple-system, sans-serif',
                lineHeight: 1.3,
              }}>
                {page.label}<br />
                <span style={{ color: '#9ca3af' }}>p.{i + 1}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Attach button */}
      <div style={{ padding: '10px' }}>
        <button
          onClick={onAttachClick}
          style={{
            width: '100%',
            padding: '8px 0',
            background: '#1e2130',
            border: '1px dashed #334155',
            borderRadius: '5px',
            color: '#475569',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: '-apple-system, sans-serif',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.target.style.borderColor = '#3b82f6'; e.target.style.color = '#93c5fd'; }}
          onMouseLeave={e => { e.target.style.borderColor = '#334155'; e.target.style.color = '#475569'; }}
        >
          + Attach document
        </button>
      </div>
    </div>
  );
}

function AttachModal({ currentPage, totalPages, onConfirm, onClose }) {
  const [file, setFile] = useState(null);
  const [insertMode, setInsertMode] = useState('after_last');
  const [pageNum, setPageNum] = useState('');
  const fileRef = useRef();

  const handleConfirm = () => {
    if (!file) return;
    let position;
    if (insertMode === 'after_selected') position = currentPage;
    else if (insertMode === 'after_first') position = 0;
    else if (insertMode === 'after_last') position = totalPages - 1;
    else if (insertMode === 'after_number') position = Math.max(0, Math.min(totalPages - 1, parseInt(pageNum, 10) - 1));
    onConfirm({ file, position });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#161820',
        border: '1px solid #2a2d3a',
        borderRadius: '10px',
        padding: '24px',
        width: '380px',
      }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9', marginBottom: '16px' }}>
          Attach document
        </div>

        {/* File picker */}
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border: '1.5px dashed #334155',
            borderRadius: '6px',
            padding: '20px',
            textAlign: 'center',
            cursor: 'pointer',
            marginBottom: '16px',
            color: file ? '#e2e8f0' : '#475569',
            fontSize: '13px',
          }}
        >
          {file ? file.name : 'Click to select a PDF or image'}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            style={{ display: 'none' }}
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
        </div>

        {/* Insert position */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Insert position</div>
          {INSERT_OPTIONS.map(opt => (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '13px', color: '#94a3b8',
              marginBottom: '8px', cursor: 'pointer',
            }}>
              <input
                type="radio"
                name="insertMode"
                value={opt.value}
                checked={insertMode === opt.value}
                onChange={() => setInsertMode(opt.value)}
                style={{ accentColor: '#3b82f6' }}
              />
              {opt.label}
            </label>
          ))}
          {insertMode === 'after_number' && (
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageNum}
              onChange={e => setPageNum(e.target.value)}
              placeholder={`Page 1–${totalPages}`}
              style={{
                marginLeft: '24px',
                width: '80px',
                padding: '4px 8px',
                background: '#1e2130',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#e2e8f0',
                fontSize: '13px',
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', background: 'transparent',
            border: '1px solid #2a2d3a', borderRadius: '6px',
            color: '#94a3b8', fontSize: '13px', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!file}
            style={{
              padding: '7px 16px', background: file ? '#3b82f6' : '#1e2130',
              border: 'none', borderRadius: '6px',
              color: file ? '#fff' : '#475569', fontSize: '13px',
              cursor: file ? 'pointer' : 'not-allowed', fontWeight: 500,
            }}
          >
            Insert
          </button>
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#161820',
        border: '1px solid #2a2d3a',
        borderRadius: '10px',
        padding: '24px',
        width: '400px',
      }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9', marginBottom: '6px' }}>
          Download &amp; Send
        </div>
        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
          Where should the PDF be saved?
        </div>

        {options.map(opt => (
          <label key={opt.value} style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '12px',
            background: saveTarget === opt.value ? '#1a2340' : '#1e2130',
            border: `1.5px solid ${saveTarget === opt.value ? '#3b82f6' : '#2a2d3a'}`,
            borderRadius: '6px',
            marginBottom: '8px',
            cursor: 'pointer',
            transition: 'all 0.1s',
          }}>
            <input
              type="radio"
              name="saveTarget"
              value={opt.value}
              checked={saveTarget === opt.value}
              onChange={() => setSaveTarget(opt.value)}
              style={{ accentColor: '#3b82f6', marginTop: '2px' }}
            />
            <div>
              <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500 }}>
                {opt.label}
              </div>
            </div>
          </label>
        ))}

        <div style={{ fontSize: '12px', color: '#475569', margin: '12px 0 16px' }}>
          The PDF will also be downloaded locally and an email to the building owner will be prepared.
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', background: 'transparent',
            border: '1px solid #2a2d3a', borderRadius: '6px',
            color: '#94a3b8', fontSize: '13px', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm(saveTarget)}
            style={{
              padding: '7px 16px', background: '#3b82f6',
              border: 'none', borderRadius: '6px',
              color: '#fff', fontSize: '13px',
              cursor: 'pointer', fontWeight: 500,
            }}
          >
            Download &amp; Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * NoticeReviewModal
 *
 * Props:
 *   aoQueue      — [{ ao, sortedDocs: [{ key, fileName, docx_b64 }] }]
 *                  One entry per AO. Work through them in order.
 *   project      — project object (for folder IDs, address)
 *   onComplete   — called when all AOs done: ({ pdfPacks: [{ ao, pdf_b64, saveTarget }] }) => void
 *                  Caller handles the final email to BO and OneDrive upload.
 *   onClose      — called if user cancels
 */
export default function NoticeReviewModal({ aoQueue = [], project, onComplete, onClose }) {
  const [queueIndex, setQueueIndex] = useState(0);
  const [tab, setTab] = useState('edit'); // 'edit' | 'pdf'
  const [generating, setGenerating] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState('');

  // Edit state — one editable HTML block per doc section
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const editorRefs = useRef([]);

  // PDF preview state
  const [pages, setPages] = useState([]);          // [{ id, label, source, pdf_b64? }]
  const [selectedPages, setSelectedPages] = useState(new Set());
  const [focusedPageIdx, setFocusedPageIdx] = useState(0);
  const [showAttach, setShowAttach] = useState(false);
  const [showSave, setShowSave] = useState(false);

  // Accumulated results
  const completedPacks = useRef([]);

  const currentEntry = aoQueue[queueIndex];
  const isLastAO = queueIndex === aoQueue.length - 1;

  // ── Initialise docs when AO changes — convert docx → HTML via mammoth ──
  useEffect(() => {
    if (!currentEntry) return;
    setDocsLoading(true);
    setTab('edit');
    setPages([]);
    setSelectedPages(new Set());
    editorRefs.current = [];

    (async () => {
      const converted = await Promise.all(
        currentEntry.sortedDocs.map(async d => ({
          key: d.key,
          fileName: d.fileName,
          docx_b64: d.docx_b64,
          html: await docxB64ToHtml(d.docx_b64),
        }))
      );
      setDocs(converted);
      setDocsLoading(false);
    })();
  }, [queueIndex, currentEntry]);

  // ── Generate PDF from edited content ──
  const handleGeneratePdf = useCallback(async () => {
    setGenerating(true);
    setGeneratingMsg('Converting to PDF…');
    try {
      // Collect edited HTML from contentEditable refs
      const editedDocs = docs.map((doc, i) => ({
        ...doc,
        editedHtml: editorRefs.current[i]?.innerHTML || doc.html,
      }));

      // For now, call merge-notice-pdfs with original docx_b64 values.
      // In the full implementation, edited HTML would be converted back to docx
      // via a new API endpoint before being sent to API2PDF.
      const res = await fetch('/api/merge-notice-pdfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: editedDocs.map(d => ({ key: d.key, fileName: d.fileName, docx_b64: d.docx_b64 })),
          outputFileName: currentEntry.sortedDocs[0]?.fileName?.replace(/\.[^.]+$/, '') + '_pack.pdf',
        }),
      });

      const data = await res.json();
      if (!data?.pdf_b64) throw new Error(data?.error || 'PDF generation failed');

      // Build pages list (one per original doc, plus space for attachments)
      const initialPages = editedDocs.map((d, i) => ({
        id: `doc-${i}`,
        label: DOC_LABELS[d.key] || d.key,
        source: 'document',
        pdf_b64: data.pdf_b64, // in real impl, track per-page
        originalIndex: i,
      }));

      setPages(initialPages);
      setSelectedPages(new Set());
      setTab('pdf');
    } catch (err) {
      alert(`PDF generation failed: ${err.message}`);
    } finally {
      setGenerating(false);
      setGeneratingMsg('');
    }
  }, [docs, currentEntry]);

  // ── Page selection ──
  const handleSelectPage = useCallback((id) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFocusedPageIdx(pages.findIndex(p => p.id === id));
  }, [pages]);

  // ── Delete selected pages ──
  const handleDeleteSelected = useCallback(() => {
    if (!window.confirm(`Remove ${selectedPages.size} page(s) from the PDF?`)) return;
    setPages(prev => prev.filter(p => !selectedPages.has(p.id)));
    setSelectedPages(new Set());
  }, [selectedPages]);

  // ── Attach document ──
  const handleAttachConfirm = useCallback(({ file, position }) => {
    const id = `attach-${Date.now()}`;
    const newPage = {
      id,
      label: file.name,
      source: 'attachment',
      file,
    };

    setPages(prev => {
      const next = [...prev];
      next.splice(position + 1, 0, newPage);
      return next;
    });

    setShowAttach(false);
  }, []);

  // ── Download & Send ──
  const handleSaveConfirm = useCallback(async (saveTarget) => {
    setShowSave(false);
    setGenerating(true);
    setGeneratingMsg('Saving…');

    try {
      // Find the merged PDF b64 from pages (first document page has it)
      const docPage = pages.find(p => p.source === 'document');
      const pdf_b64 = docPage?.pdf_b64;

      if (!pdf_b64) throw new Error('No PDF available');

      // Store this AO's result
      completedPacks.current.push({
        ao: currentEntry.ao,
        pdf_b64,
        saveTarget,
        fileName: `${project?.bo_premise_address || 'Project'}_${currentEntry.ao?.premise || currentEntry.ao?.name || 'AO'}_Notice_Pack.pdf`
          .replace(/[^a-zA-Z0-9._-]/g, '_'),
      });

      // Move to next AO or finish
      if (isLastAO) {
        setGenerating(false);
        onComplete?.(completedPacks.current);
      } else {
        setQueueIndex(i => i + 1);
        setGenerating(false);
      }
    } catch (err) {
      setGenerating(false);
      alert(`Save failed: ${err.message}`);
    }
  }, [pages, currentEntry, project, isLastAO, onComplete]);

  // ── Styles ──
  const s = {
    overlay: {
      position: 'fixed', inset: 0, background: '#0f1117',
      zIndex: 500, display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    topbar: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', height: '52px',
      background: '#161820', borderBottom: '1px solid #2a2d3a',
      flexShrink: 0,
    },
    tabBar: {
      display: 'flex', alignItems: 'flex-end',
      padding: '0 20px', height: '38px',
      background: '#13151e', borderBottom: '1px solid #2a2d3a',
      flexShrink: 0,
    },
    main: { flex: 1, display: 'flex', overflow: 'hidden' },
  };

  if (!currentEntry) return null;

  const aoLabel = currentEntry.ao?.premise || currentEntry.ao?.address || currentEntry.ao?.name || 'Adjoining Owner';

  return (
    <div style={s.overlay}>

      {/* ── Topbar ── */}
      <div style={s.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>
            {project?.bo_premise_address || 'Notice Pack'}
          </span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {aoLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
          {tab === 'pdf' && (
            <button
              onClick={() => setShowSave(true)}
              style={btnStyle('primary')}
            >
              Download &amp; Send →
            </button>
          )}
        </div>
      </div>

      {/* ── Progress bar (multi-AO) ── */}
      <ProgressBar
        current={queueIndex + 1}
        total={aoQueue.length}
        aoName={aoLabel}
      />

      {/* ── Tab bar ── */}
      <div style={s.tabBar}>
        <TabItem label="1 · Review & Edit" active={tab === 'edit'} onClick={() => setTab('edit')} />
        <TabItem label="2 · PDF Preview"   active={tab === 'pdf'}  onClick={() => tab === 'pdf' && setTab('pdf')} disabled={tab !== 'pdf'} />
      </div>

      {/* ── Main content ── */}
      <div style={{ ...s.main, flexDirection: 'column' }}>

        {/* EDIT tab */}
        {tab === 'edit' && (
          <>
            <EditScreen docs={docs} editorRefs={editorRefs} loading={docsLoading} />

            {/* Sticky footer — always visible */}
            <div style={{
              flexShrink: 0,
              padding: '12px 24px',
              background: '#161820',
              borderTop: '1px solid #2a2d3a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: '12px', color: '#475569' }}>
                {docsLoading ? 'Loading document content…' : 'Review and edit the notices above, then generate the PDF.'}
              </span>
              <button
                onClick={handleGeneratePdf}
                disabled={generating || docsLoading}
                style={btnStyle('primary', generating || docsLoading)}
              >
                {generating ? generatingMsg : 'Generate PDF →'}
              </button>
            </div>
          </>
        )}

        {/* PDF tab */}
        {tab === 'pdf' && (
          <>
            <ThumbnailStrip
              pages={pages}
              selectedPages={selectedPages}
              onSelect={handleSelectPage}
              onDeleteSelected={handleDeleteSelected}
              onAttachClick={() => setShowAttach(true)}
            />
            <div style={{
              flex: 1, overflowY: 'auto',
              background: '#d1d5db',
              display: 'flex', justifyContent: 'center',
              padding: '32px',
            }}>
              {/* Show focused page */}
              {pages[focusedPageIdx] ? (
                <div style={{
                  ...getPageStyle(),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#374151',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                      {pages[focusedPageIdx].label}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Page {focusedPageIdx + 1} of {pages.length}
                    </div>
                    {pages[focusedPageIdx].source === 'attachment' && (
                      <div style={{ marginTop: '12px', fontSize: '12px', color: '#9ca3af' }}>
                        Attached: {pages[focusedPageIdx].file?.name}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ color: '#475569', fontSize: '13px', marginTop: '60px' }}>
                  No pages — attach documents using the panel on the left.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showAttach && (
        <AttachModal
          currentPage={focusedPageIdx}
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

// ─── Tiny style helpers ───────────────────────────────────────────────────────

function btnStyle(variant, disabled = false) {
  const base = {
    padding: '7px 16px', borderRadius: '6px', fontSize: '13px',
    fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', transition: 'all 0.15s',
  };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: '#94a3b8', border: '1px solid #2a2d3a' };
  if (variant === 'primary') return { ...base, background: disabled ? '#1e2130' : '#3b82f6', color: disabled ? '#475569' : '#fff' };
  return base;
}

function TabItem({ label, active, onClick, disabled }) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '8px 18px',
        fontSize: '13px',
        color: active ? '#93c5fd' : disabled ? '#2a2d3a' : '#475569',
        cursor: disabled ? 'default' : 'pointer',
        borderBottom: `2px solid ${active ? '#3b82f6' : 'transparent'}`,
        marginBottom: '-1px',
        fontWeight: active ? 500 : 400,
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  );
}

