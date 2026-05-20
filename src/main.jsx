import { useState, useRef } from 'react';
import { callEly } from '../../api/elyRouter';
import { useApp } from '../../state/appStore';
import { renderMarkdown, uid } from '../../utils/formatters';

export default function AwardReview() {
  const { state } = useApp();
  const [doc1, setDoc1] = useState(null);
  const [doc2, setDoc2] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const file1Ref = useRef(null);
  const file2Ref = useRef(null);

  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve({ name: file.name, data: e.target.result, type: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFile = async (e, setDoc) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const docData = await readFileAsBase64(file);
    setDoc(docData);
    e.target.value = '';
  };

  const handleReview = async () => {
    if (!doc1) { alert('Upload at least one award document.'); return; }
    setReviewing(true);
    setError(null);
    setResult(null);
    try {
      const docs = [doc1, doc2].filter(Boolean).map(d => ({
        name: d.name,
        data: d.data,
        type: d.type,
      }));
      const result = await callEly({
        prompt: `Please review this party wall award document${docs.length > 1 ? 's' : ''} and provide a structured analysis.`,
        surface: 'award_review',
        mode: 'award_review',
        instructionSet: 'award_review',
        uploadedDocuments: docs,
        userId: state.currentUser?.id || state.currentUser?.email,
      });
      setResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  };

  const handleReset = () => {
    setDoc1(null);
    setDoc2(null);
    setResult(null);
    setError(null);
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="card">
        <div className="card-title">🏆 Award Review</div>
        <p style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.6 }}>
          Upload one or two party wall award documents and Ely will review them for completeness, legal compliance, and potential issues.
        </p>

        <div className="two-col" style={{ marginBottom: 16 }}>
          {/* Document 1 */}
          <div>
            <label className="form-label">Award document 1 (required)</label>
            {doc1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg4)', border: '1px solid var(--green)', borderRadius: 'var(--r)' }}>
                <span>📄</span>
                <span style={{ flex: 1, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc1.name}</span>
                <button className="btn btn-xs btn-ghost" onClick={() => setDoc1(null)}>✕</button>
              </div>
            ) : (
              <label className="btn" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
                📎 Upload document
                <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx,.txt" ref={file1Ref} onChange={e => handleFile(e, setDoc1)} />
              </label>
            )}
          </div>

          {/* Document 2 */}
          <div>
            <label className="form-label">Award document 2 (optional)</label>
            {doc2 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg4)', border: '1px solid var(--green)', borderRadius: 'var(--r)' }}>
                <span>📄</span>
                <span style={{ flex: 1, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc2.name}</span>
                <button className="btn btn-xs btn-ghost" onClick={() => setDoc2(null)}>✕</button>
              </div>
            ) : (
              <label className="btn" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
                📎 Upload document
                <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx,.txt" ref={file2Ref} onChange={e => handleFile(e, setDoc2)} />
              </label>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={handleReview} disabled={reviewing || !doc1} style={{ flex: 1, justifyContent: 'center' }}>
            {reviewing ? '⟳ Reviewing…' : '✨ Review with Ely'}
          </button>
          {(result || doc1) && (
            <button className="btn" onClick={handleReset}>Reset</button>
          )}
        </div>
      </div>

      {/* Result */}
      {reviewing && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>✨</div>
          <div style={{ fontSize: 13.5, color: 'var(--text2)' }}>Reviewing award document{doc2 ? 's' : ''}…</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6 }}>This may take a moment.</div>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 'var(--rl)', padding: '14px 16px', color: 'var(--red)', fontSize: 13 }}>
          ⚠ Review failed: {error}
        </div>
      )}

      {result && !reviewing && (
        <div className="card">
          <div className="card-title">📋 Review Results</div>
          {result.draft && (
            <div className="draft-card" style={{ marginBottom: 16 }}>
              <div className="draft-card-header">📄 Review report</div>
              <div className="draft-card-body" style={{ maxHeight: 500 }}>
                <div className="ely-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.draft) }} />
              </div>
              <div className="draft-card-actions">
                <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(result.draft)}>📋 Copy report</button>
              </div>
            </div>
          )}
          {result.reply && (
            <div className="ely-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.reply) }} />
          )}
        </div>
      )}
    </div>
  );
}
