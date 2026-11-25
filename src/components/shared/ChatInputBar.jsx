/**
 * ChatInputBar — THE single source for all input bars across Nora.
 *
 * Every surface gets exactly this. No configuration props to toggle features.
 * Change this file → changes everywhere instantly.
 *
 * Layout:
 *   [+ file]  [textarea — grows with content]  [mic → send]
 *
 * Props (minimal — only what genuinely differs per surface):
 *   value        {string}   controlled value
 *   onChange     {fn}       called with new string
 *   onSend       {fn}       called with { text, file? } when user sends
 *   placeholder  {string}
 *   disabled     {boolean}
 *   loading      {boolean}
 *   stopSignal   {number}   increment externally to stop recording
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import VoiceInput from './VoiceInput';
import VoiceStatus from './VoiceStatus';
import { logDiag } from '../../utils/draftUtils';

export default function ChatInputBar({
  value = '',
  onChange,
  onSend,
  placeholder = 'Type or tap mic to speak…',
  disabled = false,
  loading = false,
  stopSignal = 0,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | recording | transcribing | error
  const [voiceMessage, setVoiceMessage] = useState('');
  const [stoppedRecording, setStoppedRecording] = useState(false);
  const [internalStop, setInternalStop] = useState(0);
  const [attachedFile, setAttachedFile] = useState(null); // { name, text }
  const isRecording = voiceStatus === 'recording';
  const isTranscribing = voiceStatus === 'transcribing';

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 300) + 'px';
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  const handleChange = useCallback((e) => {
    onChange?.(e.target.value);
  }, [onChange]);

  const handleSend = useCallback(() => {
    const text = (value || '').trim();
    if (!text || disabled || loading) return;
    setInternalStop(s => s + 1);
    setAttachedFile(null);
    setStoppedRecording(false);
    onSend?.({ text, file: attachedFile || null });
  }, [value, disabled, loading, onSend, attachedFile]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isRecording) {
        setInternalStop(s => s + 1);
        return;
      }
      handleSend();
    }
  }, [isRecording, handleSend]);

  // File attach — read as text client-side, no upload needed
  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result || '';
      setAttachedFile({ name: file.name, text: text.slice(0, 8000) });
    };
    reader.onerror = () => setAttachedFile({ name: file.name, text: '' });
    reader.readAsText(file);
  }, []);

  // Voice: the mic records, Whisper transcribes, and the finished text is
  // added to whatever is already in the box (typed text is never replaced).
  const handleVoiceStatus = useCallback((status, info = {}) => {
    setVoiceStatus(status);
    setVoiceMessage(info.message || '');
    if (status === 'recording') {
      logDiag('mic_engaged', { existingTextLen: (value || '').length });
    }
  }, [value]);

  const handleVoice = useCallback((transcript) => {
    const text = (transcript || '').trim();
    logDiag('mic_stopped', { transcriptLen: text.length });
    if (!text) return;
    setStoppedRecording(true);
    const existing = (value || '').trim();
    onChange?.(existing ? `${existing} ${text}` : text);
  }, [value, onChange]);

  const combinedStop = stopSignal + internalStop;
  const hasText = (value || '').trim().length > 0;

  return (
    <div style={{ width: '100%' }}>

      {/* Dictation status — one look everywhere (shared/VoiceStatus) */}
      <VoiceStatus status={voiceStatus} message={voiceMessage} />

      {/* Attached file badge */}
      {attachedFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 14px 6px',
          fontSize: 12, color: 'var(--text2)',
        }}>
          <span style={{
            padding: '3px 10px', borderRadius: 99,
            background: 'var(--bg3)', border: '1px solid var(--border)',
          }}>
            📎 {attachedFile.name}
          </span>
          <button
            onClick={() => setAttachedFile(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, lineHeight: 1, padding: 0 }}
          >×</button>
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        padding: '8px 10px',
        background: 'var(--bg2, #f8f9fa)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxSizing: 'border-box',
      }}>

        {/* + file button — always present */}
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          accept=".txt,.pdf,.docx,.doc,.csv,.md,.json"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach file"
          style={{
            width: 32, height: 32,
            borderRadius: '50%',
            border: '1.5px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text2)',
            fontSize: 18, lineHeight: 1,
            flexShrink: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 2,
          }}
        >+</button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isRecording ? '🔴 Recording… tap mic to stop' :
            isTranscribing ? 'Transcribing…' :
            loading ? 'Thinking…' :
            placeholder
          }
          rows={2}
          disabled={disabled || isTranscribing}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 8px',
            fontSize: 13,
            lineHeight: 1.6,
            resize: 'none',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontFamily: 'inherit',
            minHeight: 44,
            maxHeight: 300,
            boxSizing: 'border-box',
            overflowY: 'auto',
          }}
        />

        {/* Right side: mic always visible + send appears alongside (never overlaid) */}
        <div style={{ flexShrink: 0, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>

          {/* VoiceInput — always rendered and always tappable, even after recording stops */}
          <VoiceInput
            onTranscript={handleVoice}
            onStatus={handleVoiceStatus}
            disabled={disabled || loading}
            stopSignal={combinedStop}
          />

          {/* Send button appears next to mic when there is text — does NOT overlay mic */}
          {!isRecording && (hasText || stoppedRecording) && (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || loading || isTranscribing}
              title={isTranscribing ? 'Transcribing…' : 'Send'}
              style={{
                width: 36, height: 36,
                borderRadius: '50%',
                border: 'none',
                background: isTranscribing ? 'var(--bg3, #f3f4f6)' : '#3b82f6',
                color: isTranscribing ? 'var(--text3)' : '#fff',
                cursor: disabled || loading || isTranscribing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {isTranscribing ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

