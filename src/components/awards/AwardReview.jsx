import { useState, useRef } from 'react';
import { AWARD_REVIEW_SYSTEM_PROMPT } from '../../data/masterAward';

const card = (extra = {}) => ({
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, ...extra,
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractTextFromDocx(file) {
  // Use mammoth via the API or just send the raw base64 to the AI
  const base64 = await fileToBase64(file);
  return base64;
}

export default function AwardReview() {
  const [doc1, setDoc1]           = useState(null);
  const [doc2, setDoc2]           = useState(null);
  const [mode, setMode]           = useState('benchmark'); // 'benchmark' | 'compare'
  const [loading, setLoading]     = useState(false);
  const [review, setReview]       = useState('');
  const [error, setError]         = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatLoading, setChatLoading]   = useState(false);
  const [docText1, setDocText1]         = useState('');
  const [docText2, setDocText2]         = useState('');
  const chatEndRef = useRef(null);
  const ref1 = useRef(null);
  const ref2 = useRef(null);

  const handleFile = (e, setter) => {
    const file = e.target.files?.[0];
    if (file) setter(file);
  };

  const handleReview = async () => {
    if (!doc1) return;
    setLoading(true);
    setReview('');
    setError('');

    try {
      const apiKey = null; // handled server-side via ely-smart

      // Read file(s) as base64
      const base64_1 = await fileToBase64(doc1);
      const base64_2 = doc2 ? await fileToBase64(doc2) : null;

      const systemPrompt = `You are Ely, a party wall surveying expert assistant to Itzik Darel MIPWS ACIArb of Square One Consulting. You have deep knowledge of the Party Wall etc. Act 1996, award drafting, and best practice. You review awards with the eye of an experienced practitioner -- precise, direct, and focused on what actually matters legally and practically. Always use British English spelling and terminology throughout.

${AWARD_REVIEW_SYSTEM_PROMPT}`;

      const response = await fetch('/api/review-award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc1_b64: base64_1,
          doc2_b64: base64_2 || null,
          mode,
          system: systemPrompt,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Review failed');

      const text = data.content?.find(c => c.type === 'text')?.text || '';
      setReview(text);
      // Seed chat history with the review as Ely's first message
      setChatMessages([{ role: 'assistant', content: text }]);
      setDocText1(text1);
      if (text2) setDocText2(text2);

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    const userMsg = { role: 'user', content: text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatLoading(true);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      const systemPrompt = `You are Ely, a party wall surveying expert assistant to Itzik Darel MIPWS ACIArb of Square One Consulting. You are collaborating on a party wall award review. Always use British English spelling and terminology throughout.

${mode === 'benchmark' ? `MASTER TEMPLATE AWARD (Itzik's standard):
${docText1 ? '[Document text was extracted and reviewed]' : ''}

REVIEWED AWARD: [as per initial review]` : `TWO DRAFTS BEING COMPARED: [as per initial review]`}

You are now in a collaborative chat. The user may ask you to:
- Draft specific clauses or additions
- Discard or de-prioritise certain review points
- Rewrite clauses in Itzik's style
- Produce a final clean list of amendments
- Answer questions about the Act or award drafting

Be direct and practical. When drafting clauses, produce complete ready-to-use wording. Never use em dashes.`;

      const history = [...chatMessages, userMsg].map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      const response = await fetch('/api/review-award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_mode: true,
          system: systemPrompt,
          chat_history: history,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chat failed');
      const reply = data.content?.[0]?.text || '';
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const renderReview = (text) => {
    // Simple markdown-like rendering
    return text.split('\n').map((line, i) => {
      if (line.startsWith('## ') || line.startsWith('# ')) {
        return <div key={i} style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '20px 0 8px', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>{line.replace(/^#+\s/, '')}</div>;
      }
      if (line.startsWith('**') && line.endsWith('**')) {
        return <div key={i} style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', margin: '12px 0 4px' }}>{line.replace(/\*\*/g, '')}</div>;
      }
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 4, paddingLeft: 8 }}>
          <span style={{ flexShrink: 0, color: 'var(--blue)' }}>•</span>
          <span>{line.replace(/^[-•]\s/, '')}</span>
        </div>;
      }
      if (line.trim() === '') return <div key={i} style={{ height: 8 }} />;
      return <div key={i} style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 4 }}>{line}</div>;
    });
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>🏆 Award Review</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text3)', margin: 0 }}>
          Review an award against your master template, or compare two drafts side by side.
        </p>
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {[
          { id: 'benchmark', label: '📋 Review against my master', sub: 'Check what\'s missing or weaker' },
          { id: 'compare',   label: '🔄 Compare two drafts', sub: 'See what changed between versions' },
        ].map(opt => (
          <button key={opt.id} onClick={() => { setMode(opt.id); setReview(''); setDoc2(null); }}
            style={{ flex: 1, textAlign: 'left', padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
              border: mode === opt.id ? '2px solid var(--blue)' : '1px solid var(--border)',
              background: mode === opt.id ? 'var(--blue-bg)' : 'var(--bg2)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{opt.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{opt.sub}</div>
          </button>
        ))}
      </div>

      {/* Upload area */}
      <div style={{ ...card({ padding: '20px', marginBottom: 16 }) }}>
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'compare' ? '1fr 1fr' : '1fr', gap: 14 }}>
          {/* Doc 1 */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              {mode === 'benchmark' ? 'Award to review (required)' : 'Document 1 — Base draft (required)'}
            </div>
            <div onClick={() => ref1.current?.click()}
              style={{ border: `2px dashed ${doc1 ? 'var(--green)' : 'var(--border)'}`, borderRadius: 12, padding: '20px', textAlign: 'center', cursor: 'pointer', background: doc1 ? 'var(--green-bg)' : 'var(--bg3)', transition: 'all 0.15s' }}
              onMouseEnter={e => !doc1 && (e.currentTarget.style.borderColor = 'var(--blue)')}
              onMouseLeave={e => !doc1 && (e.currentTarget.style.borderColor = 'var(--border)')}>
              <input ref={ref1} type="file" accept=".docx,.doc,.pdf" style={{ display: 'none' }} onChange={e => handleFile(e, setDoc1)} />
              {doc1
                ? <div><div style={{ fontSize: 24, marginBottom: 6 }}>✅</div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{doc1.name}</div><div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3 }}>Click to replace</div></div>
                : <div><div style={{ fontSize: 28, marginBottom: 8 }}>📄</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)' }}>Click to upload</div><div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>DOCX or PDF</div></div>
              }
            </div>
          </div>

          {/* Doc 2 — compare mode only */}
          {mode === 'compare' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Document 2 — Revised draft (required)
              </div>
              <div onClick={() => ref2.current?.click()}
                style={{ border: `2px dashed ${doc2 ? 'var(--green)' : 'var(--border)'}`, borderRadius: 12, padding: '20px', textAlign: 'center', cursor: 'pointer', background: doc2 ? 'var(--green-bg)' : 'var(--bg3)', transition: 'all 0.15s' }}
                onMouseEnter={e => !doc2 && (e.currentTarget.style.borderColor = 'var(--blue)')}
                onMouseLeave={e => !doc2 && (e.currentTarget.style.borderColor = 'var(--border)')}>
                <input ref={ref2} type="file" accept=".docx,.doc,.pdf" style={{ display: 'none' }} onChange={e => handleFile(e, setDoc2)} />
                {doc2
                  ? <div><div style={{ fontSize: 24, marginBottom: 6 }}>✅</div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{doc2.name}</div><div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3 }}>Click to replace</div></div>
                  : <div><div style={{ fontSize: 28, marginBottom: 8 }}>📄</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)' }}>Click to upload</div><div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>DOCX or PDF</div></div>
                }
              </div>
            </div>
          )}
        </div>

        {/* Review button */}
        <button
          onClick={handleReview}
          disabled={loading || !doc1 || (mode === 'compare' && !doc2)}
          style={{
            width: '100%', marginTop: 16, padding: '13px', borderRadius: 12, border: 'none',
            background: loading || !doc1 || (mode === 'compare' && !doc2) ? 'var(--border)' : 'var(--blue)',
            color: loading || !doc1 || (mode === 'compare' && !doc2) ? 'var(--text3)' : '#fff',
            fontSize: 14, fontWeight: 600, cursor: loading || !doc1 ? 'not-allowed' : 'pointer',
          }}>
          {loading ? '✨ Reviewing…' : mode === 'benchmark' ? '✨ Review with Nora' : '✨ Compare with Nora'}
        </button>

        {mode === 'benchmark' && !review && !loading && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6 }}>
            Ely will compare the uploaded award against your master template and tell you what's missing,<br />
            what's weaker, and specific wording improvements that would make it stronger.
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...card({ padding: '14px 16px', marginBottom: 16, background: 'var(--red-bg)', border: '1px solid var(--red)' }) }}>
          <div style={{ fontSize: 13, color: 'var(--red)' }}>⚠️ {error}</div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ ...card({ padding: '40px', textAlign: 'center' }) }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Reviewing your award…</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Ely is reading the document and checking it against the master template.</div>
        </div>
      )}

      {/* Review output */}
      {review && !loading && (
        <div style={{ ...card({ padding: '24px' }) }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {mode === 'benchmark' ? '📋 Award Review' : '🔄 Draft Comparison'}
            </div>
            <button onClick={() => navigator.clipboard.writeText(review)}
              style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>
              📋 Copy
            </button>
          </div>
          <div style={{ lineHeight: 1.7 }}>{renderReview(review)}</div>
        </div>
      )}

      {/* Chat — shown after initial review */}
      {review && !loading && (
        <div style={{ ...card({ padding: '0', overflow: 'hidden' }) }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>✨</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Continue with Nora</div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Ask Nora to draft clauses, discard points, rewrite wording, or produce a final amendment list</div>
            </div>
          </div>

          {/* Quick suggestions */}
          {chatMessages.length <= 1 && (
            <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--border)' }}>
              {[
                'Draft the missing clauses for me',
                'Produce a final list of amendments to make',
                'Ignore the Security for Expenses point — not applicable here',
                'Rewrite the weakest clause in my style',
                'Which of these issues are most critical before service?',
              ].map(s => (
                <button key={s} onClick={() => setChatInput(s)}
                  style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)' }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Messages — skip first (it's the review shown above) */}
          {chatMessages.length > 1 && (
            <div style={{ maxHeight: 500, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {chatMessages.slice(1).map((msg, i) => (
                <div key={i} style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text)',
                  padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                </div>
              ))}
              {chatLoading && (
                <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>✨ Thinking…</div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Input */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(); }}}
              placeholder="Ask Nora to draft a clause, discard a point, rewrite something…"
              rows={2}
              style={{ flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', outline: 'none' }}
            />
            <button onClick={handleChat} disabled={chatLoading || !chatInput.trim()}
              style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: chatLoading || !chatInput.trim() ? 'var(--border)' : 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer', alignSelf: 'flex-end', height: 38 }}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
