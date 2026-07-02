/**
 * VoiceInput.jsx — unified voice dictation for all Nora surfaces
 *
 * Engine: Whisper (final accuracy) + Web Speech API (live preview)
 * Visual: UnifiedVoice style — waveform bars, 3-line live preview, blue when active
 *
 * Props:
 *   onTranscript(text)     — called with final Whisper transcript
 *   onPreview(text, meta)  — called with live interim text (optional)
 *   disabled               — disables the button
 *   stopSignal             — increment to force-stop recording
 *   placeholder            — idle placeholder text
 *   className              — outer class
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const STATES = { IDLE: 'idle', RECORDING: 'recording', TRANSCRIBING: 'transcribing' };

// ── Waveform bars ─────────────────────────────────────────────────────────────
function WaveformBars({ active }) {
  const heights = [0.6, 1, 0.7, 0.9, 0.5, 1, 0.8, 0.6, 0.9, 0.7, 0.5, 0.8];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 20, padding: '0 4px' }}>
      {heights.map((h, i) => (
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
      <style>{`@keyframes waveBar { from { transform: scaleY(0.4); } to { transform: scaleY(1); } }`}</style>
    </div>
  );
}

// ── Live preview lines ────────────────────────────────────────────────────────
function LivePreview({ lines }) {
  const visible = lines.slice(-3);
  return (
    <div style={{ minHeight: 58, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, padding: '4px 0', overflow: 'hidden' }}>
      {visible.map((line, i) => {
        const age = visible.length - 1 - i;
        return (
          <div key={i} style={{
            fontSize: 14, lineHeight: 1.5,
            color: age === 0 ? 'var(--text, #111)' : `rgba(100,100,100,${age === 1 ? 0.55 : 0.3})`,
            fontWeight: age === 0 ? 500 : 400,
            transition: 'all 0.3s ease',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

// ── Text to preview lines ─────────────────────────────────────────────────────
function textToLines(text, interim = '') {
  const combined = [text, interim].filter(Boolean).join(' ').trim();
  if (!combined) return [];
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
  return lines;
}

// ── Best supported audio mime type ───────────────────────────────────────────
function getBestMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const candidates = isIOS
    ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VoiceInput({
  onTranscript,
  onPreview,
  disabled = false,
  stopSignal = 0,
  placeholder = 'Tap to speak...',
  className = '',
}) {
  const [state, setState] = useState(STATES.IDLE);
  const [previewLines, setPreviewLines] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const accumulatedRef = useRef('');
  const streamRef = useRef(null);
  const stateRef = useRef(STATES.IDLE);

  const isRecording = state === STATES.RECORDING;
  const isTranscribing = state === STATES.TRANSCRIBING;

  const setStateSync = useCallback((s) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // ── Stop all recording ────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Stop signal from parent ───────────────────────────────────────────────
  useEffect(() => {
    if (stopSignal > 0 && stateRef.current !== STATES.IDLE) {
      stopAll();
      setStateSync(STATES.IDLE);
      setPreviewLines([]);
    }
  }, [stopSignal, stopAll, setStateSync]);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setErrorMsg('');
    accumulatedRef.current = '';
    chunksRef.current = [];
    setPreviewLines([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = getBestMimeType();

      // MediaRecorder → Whisper for final accuracy
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      mr.onstop = async () => {
        setStateSync(STATES.TRANSCRIBING);
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
          const fd = new FormData();
          fd.append('audio', blob, 'recording.' + (mimeType.includes('mp4') ? 'm4a' : 'webm'));
          const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
          if (!res.ok) throw new Error('Transcribe failed');
          const data = await res.json();
          const text = (data.text || '').trim();
          if (text) onTranscript?.(text);
        } catch (err) {
          setErrorMsg('Could not transcribe. Please try again.');
        } finally {
          setStateSync(STATES.IDLE);
          setPreviewLines([]);
        }
      };

      mr.start(200);

      // Web Speech API in parallel — live preview only
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-GB';
        recognitionRef.current = rec;

        rec.onresult = e => {
          let interim = '';
          let final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript;
            else interim += e.results[i][0].transcript;
          }
          if (final) accumulatedRef.current += (accumulatedRef.current ? ' ' : '') + final.trim();
          const lines = textToLines(accumulatedRef.current, interim);
          setPreviewLines(lines);
          onPreview?.(accumulatedRef.current, { recording: true, interim, currentPhrase: interim || accumulatedRef.current });
        };

        rec.onerror = () => {}; // silent — Whisper handles final result
        try { rec.start(); } catch (_) {}
      }

      setStateSync(STATES.RECORDING);

    } catch (err) {
      setErrorMsg('Microphone access denied.');
      setStateSync(STATES.IDLE);
    }
  }, [onTranscript, onPreview, setStateSync]);

  // ── Handle mic button press ───────────────────────────────────────────────
  const handleMicPress = useCallback(() => {
    if (isRecording) {
      stopAll();
      // onstop fires → Whisper transcription
    } else if (!isTranscribing) {
      startRecording();
    }
  }, [isRecording, isTranscribing, stopAll, startRecording]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={className}
      style={{
        display: 'flex', flexDirection: 'column', gap: 0,
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
        {errorMsg && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errorMsg}</div>}
      </div>

      {/* Bottom bar — waveform + label + mic button */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '6px 10px 8px',
        borderTop: `1px solid ${isRecording ? 'rgba(59,130,246,0.2)' : 'var(--border, #e5e7eb)'}`,
        gap: 8,
        background: isRecording ? 'rgba(59,130,246,0.04)' : 'transparent',
      }}>
        <div style={{ flex: 1 }}><WaveformBars active={isRecording} /></div>
        <div style={{ fontSize: 11, color: 'var(--text3, #9ca3af)', minWidth: 70, textAlign: 'right' }}>
          {isRecording ? 'Tap to send' : isTranscribing ? 'Processing...' : 'Tap to speak'}
        </div>
        <button
          onClick={handleMicPress}
          disabled={disabled || isTranscribing}
          style={{
            width: 38, height: 38, borderRadius: '50%', border: 'none',
            background: isRecording ? 'var(--blue, #3b82f6)' : 'var(--bg3, #f3f4f6)',
            color: isRecording ? '#fff' : 'var(--text2, #6b7280)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: disabled || isTranscribing ? 'not-allowed' : 'pointer',
            opacity: disabled || isTranscribing ? 0.5 : 1,
            transition: 'all 0.2s ease', flexShrink: 0,
            boxShadow: isRecording ? '0 0 0 4px rgba(59,130,246,0.2)' : 'none',
          }}
        >
          {isRecording ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="2" />
            </svg>
          ) : (
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
