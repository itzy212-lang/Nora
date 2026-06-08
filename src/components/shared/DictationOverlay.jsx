import { useState, useEffect, useRef } from 'react';

export default function DictationOverlay({
  phase,
  topLine,
  bottomLine,
  transcript,
  onSend,
  onCancel,
}) {
  const [editText, setEditText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (phase === 'preview') {
      setEditText(transcript || '');
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [phase, transcript]);

  if (phase === 'recording' || phase === 'transcribing') {
    return (
      <div style={{
        margin: '0 0 6px 0',
        padding: '8px 12px',
        background: 'rgba(239,68,68,0.05)',
        border: '1px solid rgba(239,68,68,0.15)',
        borderRadius: 10,
        minHeight: 48,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 3,
        overflow: 'hidden',
      }}>
        {phase === 'recording' && topLine ? (
          <div style={{
            fontSize: 13,
            color: '#6b7280',
            opacity: 0.45,
            lineHeight: 1.45,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}>
            {topLine}
          </div>
        ) : null}
        <div style={{
          fontSize: 13,
          color: '#111827',
          lineHeight: 1.45,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {phase === 'transcribing' ? (
            <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Transcribing…</span>
          ) : bottomLine ? (
            bottomLine
          ) : (
            <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>🎤 Listening…</span>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'preview') {
    return (
      <div style={{ margin: '0 0 8px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (editText.trim()) onSend(editText.trim());
            }
            if (e.key === 'Escape') onCancel();
          }}
          style={{
            width: '100%',
            minHeight: 72,
            maxHeight: 180,
            padding: '9px 12px',
            fontSize: 14,
            lineHeight: 1.5,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
            color: '#111827',
            background: '#fff',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = '#6366f1'; }}
          onBlur={e => { e.target.style.borderColor = '#d1d5db'; }}
          placeholder="Edit your message…"
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              borderRadius: 7,
              border: '1px solid #e5e7eb',
              background: 'transparent',
              color: '#6b7280',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { if (editText.trim()) onSend(editText.trim()); }}
            disabled={!editText.trim()}
            style={{
              padding: '6px 16px',
              borderRadius: 7,
              border: 'none',
              background: editText.trim() ? '#6366f1' : '#e5e7eb',
              color: editText.trim() ? '#fff' : '#9ca3af',
              fontSize: 13,
              fontWeight: 500,
              cursor: editText.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return null;
}
