/**
 * UnifiedVoice.jsx
 * Single voice input component used across all chats in Nora.
 * Features:
 * - Animated waveform bars while recording
 * - 3-line live preview (newest at bottom, older lines fade up)
 * - Clear state: idle → recording → transcribing → done
 * - Full-size text area visible at all times
 * - Whisper transcription via /api/transcribe
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const STATES = { IDLE: 'idle', RECORDING: 'recording', TRANSCRIBING: 'transcribing' };

// ── Waveform bars animation ───────────────────────────────────────────────────
function WaveformBars({ active }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      height: 20, padding: '0 4px',
    }}>
      {[0.6, 1, 0.7, 0.9, 0.5, 1, 0.8, 0.6, 0.9, 0.7, 0.5, 0.8].map((h, i) => (
        <div
          key={i}
          style={{
            width: 3,
            borderRadius: 2,
            background: active ? 'var(--blue, #3b82f6)' : 'var(--border, #e5e7eb)',
            height: active ? `${8 + h * 12}px` : '4px',
            animation: active ? `waveBar 0.8s ease-in-out ${i * 0.06}s infinite alternate` : 'none',
            transition: 'height 0.2s ease, background 0.2s ease',
          }}
        />
      ))}
      <style>{`
        @keyframes waveBar {
          from { transform: scaleY(0.4); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

// ── Live preview lines ────────────────────────────────────────────────────────
function LivePreview({ lines }) {
  // Show last 3 lines, newest at bottom
  const visible = lines.slice(-3);
  return (
    <div style={{
      minHeight: 58,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      gap: 2,
      padding: '4px 0',
      overflow: 'hidden',
    }}>
      {visible.map((line, i) => {
        const age = visible.length - 1 - i; // 0 = newest
        return (
          <div
            key={i}
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: age === 0 ? 'var(--text, #111)' : `rgba(100,100,100,${age === 1 ? 0.55 : 0.3})`,
              fontWeight: age === 0 ? 500 : 400,
              transition: 'all 0.3s ease',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UnifiedVoice({
  onTranscript,          // called with final text when transcription is done
  onInterim,             // called with live interim text while recording (optional)
  placeholder = 'Tap to speak...',
  disabled = false,
  className = '',
}) {
  const [voiceState, setVoiceState] = useState(STATES.IDLE);
  const [previewLines, setPreviewLines] = useState([]);
  const [interimText, setInterimText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const accumulatedRef = useRef('');
  const streamRef = useRef(null);

  // ── Live preview: split accumulated text into lines by sentence/pause ────
  const updatePreview = useCallback((text, interim = '') => {
    const combined = [text, interim].filter(Boolean).join(' ').trim();
    if (!combined) { setPreviewLines([]); return; }
    // Split into chunks of ~40 chars at word boundaries
    const words = combined.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > 42) {
        if (current) lines.push(current.trim());
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    }
    if (current) lines.push(current.trim());
    setPreviewLines(lines);
  }, []);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setErrorMsg('');
    accumulatedRef.current = '';
    chunksRef.current = [];
    setPreviewLines([]);
    setInterimText('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // MediaRecorder for Whisper
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(200);

      // Web Speech API for live preview
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SR();
        recognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-GB';

        recognition.onresult = (e) => {
          let interim = '';
          let final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t + ' ';
            else interim += t;
          }
          if (final) accumulatedRef.current += final;
          setInterimText(interim);
          updatePreview(accumulatedRef.current, interim);
          onInterim?.(accumulatedRef.current + interim);
        };

        recognition.onerror = () => {}; // silent — Whisper handles final result
        recognition.start();
      }

      setVoiceState(STATES.RECORDING);
    } catch (err) {
      setErrorMsg('Microphone access denied');
      setVoiceState(STATES.IDLE);
    }
  }, [updatePreview, onInterim]);

  // ── Stop recording + transcribe ───────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    if (voiceState !== STATES.RECORDING) return;
    setVoiceState(STATES.TRANSCRIBING);
    setInterimText('');

    // Stop speech recognition
    try { recognitionRef.current?.stop(); } catch {}

    // Stop media recorder
    const mr = mediaRecorderRef.current;
    if (!mr) {
      setVoiceState(STATES.IDLE);
      return;
    }

    mr.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());

    // Wait for final chunks
    await new Promise(resolve => { mr.onstop = resolve; });

    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size < 1000) {
        setVoiceState(STATES.IDLE);
        setPreviewLines([]);
        return;
      }

      const fd = new FormData();
      fd.append('audio', blob, 'recording.webm');

      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await res.json();
      const text = data.text?.trim() || '';

      if (text) {
        onTranscript?.(text);
        updatePreview(text);
      }
    } catch (err) {
      setErrorMsg('Transcription failed — please try again');
    } finally {
      setVoiceState(STATES.IDLE);
      chunksRef.current = [];
    }
  }, [voiceState, onTranscript, updatePreview]);

  // ── Toggle on mic button press ────────────────────────────────────────────
  const handleMicPress = useCallback(() => {
    if (disabled) return;
    if (voiceState === STATES.RECORDING) stopRecording();
    else if (voiceState === STATES.IDLE) startRecording();
  }, [voiceState, disabled, startRecording, stopRecording]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const isRecording = voiceState === STATES.RECORDING;
  const isTranscribing = voiceState === STATES.TRANSCRIBING;
  const isActive = isRecording || isTranscribing;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        borderRadius: 14,
        border: `1.5px solid ${isRecording ? 'var(--blue, #3b82f6)' : 'var(--border, #e5e7eb)'}`,
        background: 'var(--bg, #fff)',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
        boxShadow: isRecording ? '0 0 0 3px rgba(59,130,246,0.12)' : 'none',
      }}
    >
      {/* Live preview area */}
      <div style={{ padding: '10px 14px 6px', minHeight: 72 }}>
        {isTranscribing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text3, #9ca3af)', fontSize: 13 }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            Transcribing...
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : previewLines.length > 0 ? (
          <LivePreview lines={previewLines} />
        ) : (
          <div style={{ color: 'var(--text3, #9ca3af)', fontSize: 13, paddingTop: 6 }}>
            {isRecording ? 'Listening...' : placeholder}
          </div>
        )}
        {errorMsg && (
          <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errorMsg}</div>
        )}
      </div>

      {/* Bottom bar — waveform + mic button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 10px 8px',
        borderTop: `1px solid ${isRecording ? 'rgba(59,130,246,0.2)' : 'var(--border, #e5e7eb)'}`,
        gap: 8,
        background: isRecording ? 'rgba(59,130,246,0.04)' : 'transparent',
      }}>
        {/* Waveform fills the space */}
        <div style={{ flex: 1 }}>
          <WaveformBars active={isRecording} />
        </div>

        {/* State label */}
        <div style={{ fontSize: 11, color: 'var(--text3, #9ca3af)', minWidth: 70, textAlign: 'right' }}>
          {isRecording ? 'Tap to send' : isTranscribing ? 'Processing...' : 'Tap to speak'}
        </div>

        {/* Mic button */}
        <button
          onClick={handleMicPress}
          disabled={disabled || isTranscribing}
          style={{
            width: 38, height: 38,
            borderRadius: '50%',
            border: 'none',
            background: isRecording
              ? 'var(--blue, #3b82f6)'
              : 'var(--bg3, #f3f4f6)',
            color: isRecording ? '#fff' : 'var(--text2, #6b7280)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: disabled || isTranscribing ? 'not-allowed' : 'pointer',
            opacity: disabled || isTranscribing ? 0.5 : 1,
            transition: 'all 0.2s ease',
            flexShrink: 0,
            boxShadow: isRecording ? '0 0 0 4px rgba(59,130,246,0.2)' : 'none',
          }}
        >
          {isRecording ? (
            // Stop icon
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="2" />
            </svg>
          ) : (
            // Mic icon
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
