export default function DictationOverlay({ phase, topLine, bottomLine }) {
  if (phase === 'transcribing') {
    return (
      <div style={{
        margin: '0 0 6px 0',
        padding: '8px 12px',
        background: 'rgba(99,102,241,0.05)',
        border: '1px solid rgba(99,102,241,0.15)',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 36,
      }}>
        <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>Transcribing…</span>
      </div>
    );
  }

  if (phase === 'recording') {
    return (
      <div style={{
        margin: '0 0 6px 0',
        padding: '8px 12px',
        background: 'rgba(239,68,68,0.05)',
        border: '1px solid rgba(239,68,68,0.15)',
        borderRadius: 10,
        minHeight: 44,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 3,
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {topLine ? (
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
          {bottomLine || (
            <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>🎤 Listening…</span>
          )}
        </div>
      </div>
    );
  }

  return null;
}
