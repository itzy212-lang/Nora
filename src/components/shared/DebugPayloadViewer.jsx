/**
 * DebugPayloadViewer
 * Developer-only tool — shows the exact payload Nora sent to OpenAI.
 * To capture a payload: use Draft with Ely normally, then view it here.
 * The capture is triggered by sending body.debug=true — handled in DraftWithEly.
 */

import { useState, useEffect, useCallback } from 'react';
import sb from '../../supabaseClient';

export default function DebugPayloadViewer() {
  const [payloads, setPayloads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [copied, setCopied] = useState('');

  const fetchPayloads = useCallback(async () => {
    setLoading(true);
    const { data } = await sb
      .from('debug_payloads')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(10);
    setPayloads(data || []);
    if (data?.length && !selected) setSelected(data[0]);
    setLoading(false);
  }, [selected]);

  useEffect(() => { fetchPayloads(); }, []);

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  const systemMsg = selected?.messages?.find(m => m.role === 'system');
  const otherMsgs = selected?.messages?.filter(m => m.role !== 'system') || [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc' }}>🔍 Payload Inspector</span>
          <span style={{ marginLeft: 12, color: '#64748b', fontSize: 11 }}>Exact OpenAI request from production runtime</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={debugMode} onChange={e => setDebugMode(e.target.checked)} />
            Debug mode {debugMode ? '(ON — next Draft with Ely will capture)' : '(OFF)'}
          </label>
          <button onClick={fetchPayloads} style={{ padding: '4px 12px', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {debugMode && (
        <div style={{ padding: '8px 16px', background: '#1c1917', borderBottom: '1px solid #292524', fontSize: 11, color: '#f59e0b' }}>
          ⚠ Debug mode is ON. The next Draft with Ely request will capture its full payload here. Refresh after drafting to see it.
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar — payload list */}
        <div style={{ width: 220, borderRight: '1px solid #1e293b', overflowY: 'auto', flexShrink: 0 }}>
          {payloads.length === 0 && !loading && (
            <div style={{ padding: 16, color: '#475569', fontSize: 11 }}>
              No captures yet. Enable debug mode above, then use Draft with Ely to capture a payload.
            </div>
          )}
          {payloads.map(p => (
            <div
              key={p.id}
              onClick={() => setSelected(p)}
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid #1e293b',
                cursor: 'pointer',
                background: selected?.id === p.id ? '#1e293b' : 'transparent',
              }}
            >
              <div style={{ color: '#f8fafc', fontWeight: selected?.id === p.id ? 700 : 400, fontSize: 11, marginBottom: 2 }}>
                {p.mode || 'unknown'} / {p.surface || 'unknown'}
              </div>
              <div style={{ color: '#64748b', fontSize: 10 }}>
                {new Date(p.captured_at).toLocaleTimeString()} — {p.total_messages} msgs
              </div>
              <div style={{ color: '#475569', fontSize: 10 }}>
                {p.model} @ {p.temperature ?? '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Main — payload detail */}
        {selected ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Meta */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                ['Model', selected.model],
                ['Temperature', selected.temperature ?? '—'],
                ['Mode', selected.mode],
                ['Surface', selected.surface],
                ['Messages', selected.total_messages],
                ['System prompt', `${selected.system_prompt_length} chars`],
                ['Captured', new Date(selected.captured_at).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '4px 10px', background: '#1e293b', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: '#64748b' }}>{k}: </span>
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* System prompt */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>System prompt ({systemMsg?.content?.length || 0} chars)</span>
                <button onClick={() => copy(systemMsg?.content || '', 'system')} style={{ padding: '2px 10px', background: '#1e293b', color: copied === 'system' ? '#22c55e' : '#94a3b8', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>
                  {copied === 'system' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 8, padding: 12, maxHeight: 400, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#cbd5e1', fontSize: 11 }}>
                {systemMsg?.content || '(no system message found)'}
              </div>
            </div>

            {/* Other messages */}
            {otherMsgs.map((m, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ color: m.role === 'user' ? '#86efac' : '#93c5fd', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {m.role} ({(m.content || '').length} chars)
                  </span>
                  <button onClick={() => copy(m.content || '', `msg${i}`)} style={{ padding: '2px 10px', background: '#1e293b', color: copied === `msg${i}` ? '#22c55e' : '#94a3b8', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>
                    {copied === `msg${i}` ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 8, padding: 12, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#cbd5e1', fontSize: 11 }}>
                  {m.content || '(empty)'}
                </div>
              </div>
            ))}

            {/* OpenAI response */}
            {selected.openai_response && (
              <div>
                <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>OpenAI response</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  {[
                    ['Model returned', selected.openai_response.model],
                    ['Prompt tokens', selected.openai_response.usage?.prompt_tokens],
                    ['Completion tokens', selected.openai_response.usage?.completion_tokens],
                    ['Total tokens', selected.openai_response.usage?.total_tokens],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: '4px 10px', background: '#1c1917', borderRadius: 6, fontSize: 11 }}>
                      <span style={{ color: '#64748b' }}>{k}: </span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{v ?? '—'}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: '#020617', border: '1px solid #292524', borderRadius: 8, padding: 12, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#fde68a', fontSize: 11 }}>
                  {selected.openai_response.reply_preview || '(no reply captured)'}
                </div>
              </div>
            )}

            {/* Full JSON */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#64748b', fontSize: 11 }}>Full payload JSON</span>
                <button onClick={() => copy(JSON.stringify(selected, null, 2), 'full')} style={{ padding: '2px 10px', background: '#1e293b', color: copied === 'full' ? '#22c55e' : '#94a3b8', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>
                  {copied === 'full' ? '✓ Copied' : 'Copy full JSON'}
                </button>
              </div>
            </div>

          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
            Select a captured payload from the left
          </div>
        )}
      </div>

      {/* Debug mode wire — passes flag to DraftWithEly via localStorage */}
      <script dangerouslySetInnerHTML={{ __html: `
        window.__NORA_DEBUG__ = ${debugMode};
        localStorage.setItem('nora_debug_mode', '${debugMode}');
      ` }} />
    </div>
  );
}
