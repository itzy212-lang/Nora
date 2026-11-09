/**
 * VoiceStatus — the one look for dictation, everywhere in Nora.
 *
 * Shown by every surface that has a mic (chat bars, notices, dispute
 * agreement) so recording always looks and reads the same:
 *   recording     → pulsing red dot, timer, moving bars, "tap the mic to finish"
 *   transcribing  → spinner and "Transcribing…" (or a progress message)
 *   error         → one red line
 *
 * Props:
 *   status   'idle' | 'recording' | 'transcribing' | 'error'
 *   message  progress text while transcribing, or the error text
 */

import { useEffect, useState } from 'react';

const BAR_HEIGHTS = [0.6, 1, 0.7, 0.9, 0.5, 1, 0.8, 0.6, 0.9];

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function VoiceStatus({ status = 'idle', message = '' }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'recording') {
      setElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (status === 'idle') return null;

  const base = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '0 0 6px 0',
    padding: '7px 12px',
    borderRadius: 10,
    fontSize: 12.5,
    lineHeight: 1.3,
    boxSizing: 'border-box',
    width: '100%',
  };

  if (status === 'error') {
    return (
      <div role="alert" style={{ ...base, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c' }}>
        {message || 'Dictation did not work. Please try again.'}
      </div>
    );
  }

  if (status === 'transcribing') {
    return (
      <div role="status" style={{ ...base, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', color: 'var(--text2, #4b5563)' }}>
        <style>{'@keyframes noraVoiceSpin { to { transform: rotate(360deg); } }'}</style>
        <span style={{ display: 'inline-block', animation: 'noraVoiceSpin 1s linear infinite' }}>⟳</span>
        <span>{message || 'Transcribing…'}</span>
      </div>
    );
  }

  return (
    <div role="status" style={{ ...base, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', color: 'var(--text2, #4b5563)' }}>
      <style>{`
        @keyframes noraVoiceDot { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes noraVoiceBar { from { transform: scaleY(0.35); } to { transform: scaleY(1); } }
      `}</style>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ef4444', flexShrink: 0, animation: 'noraVoiceDot 1.2s ease-in-out infinite' }} />
      <span style={{ fontWeight: 600, color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>Recording {formatElapsed(elapsed)}</span>
      <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 16 }}>
        {BAR_HEIGHTS.map((h, i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: 4 + h * 11,
              borderRadius: 2,
              background: '#ef4444',
              transformOrigin: 'center',
              animation: `noraVoiceBar 0.7s ease-in-out ${i * 0.07}s infinite alternate`,
            }}
          />
        ))}
      </span>
      <span style={{ marginLeft: 'auto', color: 'var(--text3, #9ca3af)' }}>Tap the mic to finish</span>
    </div>
  );
}
