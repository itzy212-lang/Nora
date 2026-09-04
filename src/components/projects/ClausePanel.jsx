// src/components/projects/ClauseRequestModal.jsx
// Added 2026-09-03, on request: a dedicated place, inside a project,
// to request a short, professional clause for a notice or an award —
// separate from every chat surface, all of which are built to
// explain and hold a conversation, not produce a bare, insertable
// clause. Backed by its own surface ('clause_request') with a strict
// contract in v2-prompt-assembly.js: no preamble, no explanation,
// just the finished clause.
import { useState, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';

export default function ClausePanel({ project }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]); // [{ prompt, clause }]
  const [copiedIndex, setCopiedIndex] = useState(null);

  const { send, loading } = useEly({ surface: 'clause_request', projectId: project?.id });

  const handleGenerate = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || loading) return;
    try {
      const result = await send(prompt);
      const clause = (result?.reply || '').trim();
      if (clause) {
        setHistory(h => [{ prompt, clause }, ...h]);
        setInput('');
      }
    } catch (err) {
      console.warn('[ClausePanel] generate failed:', err?.message);
    }
  }, [input, loading, send]);

  const handleCopy = (clause, idx) => {
    navigator.clipboard.writeText(clause).then(() => {
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 1500);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
        Short, ready-to-paste clauses for a notice or award — describe what it needs to cover, and get back just the clause, nothing else.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
          placeholder="What's the clause for? e.g. access for inspection, security for expenses..."
          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }}
          disabled={loading}
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !input.trim()}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.6 : 1 }}
        >
          {loading ? '…' : 'Generate'}
        </button>
      </div>

      <div>
        {history.length === 0 && !loading && (
          <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: '30px 0' }}>
            Nothing generated yet this session.
          </div>
        )}
        {history.map((item, idx) => (
          <div key={idx} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: idx < history.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{item.prompt}</div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {item.clause}
            </div>
            <button
              onClick={() => handleCopy(item.clause, idx)}
              style={{ marginTop: 6, padding: '4px 12px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 11.5, cursor: 'pointer' }}
            >
              {copiedIndex === idx ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
