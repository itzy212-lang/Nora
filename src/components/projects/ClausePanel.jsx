// src/components/projects/ClausePanel.jsx
// Added 2026-09-03, on request: a dedicated place, inside a project,
// to request a short, professional clause for a notice or an award -
// separate from every chat surface, all of which are built to
// explain and hold a conversation, not produce a bare, insertable
// clause. Backed by its own surface ('clause_request') with a strict
// contract in v2-prompt-assembly.js: no preamble, no explanation,
// just the finished clause.
//
// Added 2026-09-10, on request: a small library of the user's own
// example clauses ("upload a couple of clauses I'd like to use") -
// saved either by pasting an existing clause directly, or by saving
// a generated result they liked. A new request is matched against
// this library server-side (api/clause-library.js +
// matchClauseLibrary in ely-smart.js) and the closest, genuinely
// relevant examples are fed in as inspiration, not a template to
// copy blindly.
import { useState, useCallback, useEffect } from 'react';
import { useEly } from '../../hooks/useEly';

export default function ClausePanel({ project }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]); // [{ prompt, clause }]
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [savedIndex, setSavedIndex] = useState(null);

  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteLabel, setPasteLabel] = useState('');
  const [pasteSaving, setPasteSaving] = useState(false);

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

  const saveExample = async (text, label) => {
    const res = await fetch('/api/clause-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', text, label: label || null }),
    });
    if (!res.ok) throw new Error('Could not save example');
    return res.json();
  };

  const handleSaveResult = async (item, idx) => {
    try {
      await saveExample(item.clause, item.prompt);
      setSavedIndex(idx);
      setTimeout(() => setSavedIndex(null), 1500);
    } catch (err) {
      console.warn('[ClausePanel] save example failed:', err?.message);
    }
  };

  const handlePasteSave = async () => {
    const text = pasteText.trim();
    if (!text || pasteSaving) return;
    setPasteSaving(true);
    try {
      await saveExample(text, pasteLabel.trim());
      setPasteText('');
      setPasteLabel('');
      if (showLibrary) loadLibrary();
    } catch (err) {
      console.warn('[ClausePanel] paste-save failed:', err?.message);
    } finally {
      setPasteSaving(false);
    }
  };

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch('/api/clause-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await res.json();
      setLibraryItems(data?.items || []);
    } catch (err) {
      console.warn('[ClausePanel] library list failed:', err?.message);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showLibrary) loadLibrary();
  }, [showLibrary, loadLibrary]);

  const deleteExample = async (id) => {
    try {
      await fetch('/api/clause-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      setLibraryItems(items => items.filter(i => i.id !== id));
    } catch (err) {
      console.warn('[ClausePanel] delete example failed:', err?.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
          Short, ready-to-paste clauses for a notice or award - describe what it needs to cover, and get back just the clause, nothing else.
        </div>
        <button
          onClick={() => setShowLibrary(v => !v)}
          style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 99, border: '1px solid var(--border)', background: showLibrary ? 'var(--bg3)' : 'transparent', color: 'var(--text2)', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          My clauses
        </button>
      </div>

      {showLibrary && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Add a clause you already use</div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste in a clause you'd like to save as an example..."
            rows={3}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={pasteLabel}
              onChange={e => setPasteLabel(e.target.value)}
              placeholder="What's it for? (optional, e.g. excavations)"
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5 }}
            />
            <button
              onClick={handlePasteSave}
              disabled={pasteSaving || !pasteText.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: pasteSaving ? 'not-allowed' : 'pointer', opacity: pasteSaving || !pasteText.trim() ? 0.6 : 1 }}
            >
              {pasteSaving ? '...' : 'Save'}
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Saved clauses ({libraryItems.length})</div>
            {libraryLoading && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading...</div>}
            {!libraryLoading && libraryItems.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nothing saved yet - paste one above, or save a generated result below.</div>
            )}
            {libraryItems.map(item => (
              <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{item.label || 'Untitled'}</div>
                  <button
                    onClick={() => deleteExample(item.id)}
                    style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--red)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          {loading ? '...' : 'Generate'}
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
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                onClick={() => handleCopy(item.clause, idx)}
                style={{ padding: '4px 12px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 11.5, cursor: 'pointer' }}
              >
                {copiedIndex === idx ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => handleSaveResult(item, idx)}
                style={{ padding: '4px 12px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 11.5, cursor: 'pointer' }}
              >
                {savedIndex === idx ? 'Saved to my clauses' : 'Save as example'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
