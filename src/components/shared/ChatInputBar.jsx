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

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [internalStop, setInternalStop] = useState(0);
  const [attachedFile, setAttachedFile] = useState(null); // { name, text }
  const voiceBaseRef = useRef('');

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 300) + 'px';
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  // Safety net — clear transcribing after 8s
  useEffect(() => {
    if (!isTranscribing) return;
    const t = setTimeout(() => setIsTranscribing(false), 8000);
    return () => clearTimeout(t);
  }, [isTranscribing]);

  const handleChange = useCallback((e) => {
    voiceBaseRef.current = '';
    onChange?.(e.target.value);
  }, [onChange]);

  const handleSend = useCallback(() => {
    const text = (value || '').trim();
    if (!text || disabled || loading) return;
    voiceBaseRef.current = '';
    setInternalStop(s => s + 1);
    setAttachedFile(null);
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

  // Voice handlers
  const handleVoice = useCallback((transcript, meta) => {
    // Ignore restart gaps — VoiceInput restarts Web Speech sessions continuously
    // while recording. restarting=true means still recording, not finished.
    if (meta?.restarting) return;

    if (meta?.recording) {
      // Still recording — accumulate transcript, show interim
      setIsRecording(true);
      setIsTranscribing(false);
      if (meta?.interim) setInterimText(meta.interim);
      if (transcript) {
        if (!voiceBaseRef.current) voiceBaseRef.current = (value || '').trim();
        const next = voiceBaseRef.current
          ? `${voiceBaseRef.current} ${transcript}`
          : transcript;
        onChange?.(next);
      }
    } else {
      // recording === false AND restarting is not set — truly finished
      setIsRecording(false);
      setInterimText('');
      if (transcript) {
        // Final transcript — land it in the field, switch to send
        setIsTranscribing(false);
        const base = voiceBaseRef.current;
        const next = base ? `${base} ${transcript}` : transcript;
        voiceBaseRef.current = '';
        onChange?.(next);
      } else {
        // No transcript yet — show transcribing state while Whisper processes
        setIsTranscribing(true);
      }
    }
  }, [value, onChange]);

  const handleVoicePreview = useCallback((preview, meta = {}) => {
    if (meta?.restarting) return;
    if (meta?.recording) {
      setIsRecording(true);
      if (meta.interim || meta.currentPhrase) {
        setInterimText(meta.currentPhrase || meta.interim || '');
      }
    }
  }, []);

  const combinedStop = stopSignal + internalStop;
  const hasText = (value || '').trim().length > 0;
  const showSend = hasText || isTranscribing; // show send as soon as recording stops

  return (
    <div style={{ width: '100%' }}>

      {/* Live interim preview */}
      {interimText && isRecording && (
        <div style={{
          padding: '4px 14px 6px',
          fontSize: 12,
          color: 'var(--text3)',
          fontStyle: 'italic',
        }}>
          🎤 {interimText}
        </div>
      )}

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

        {/* Right: mic or send */}
        <div style={{ flexShrink: 0, marginBottom: 2, position: 'relative', width: 36, height: 36 }}>

          {/* Mic — shown when no text and not transcribing */}
          {!showSend && !isRecording && !isTranscribing && (
            <VoiceInput
              onTranscript={handleVoice}
              onPreview={handleVoicePreview}
              disabled={disabled || loading}
              stopSignal={combinedStop}
            />
          )}

          {/* Transcribing spinner */}
          {isTranscribing && (
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--bg3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text3)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
          )}

          {/* Send — shown when there's text */}
          {showSend && (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || loading || isTranscribing}
              style={{
                position: 'absolute', inset: 0,
                width: 36, height: 36,
                borderRadius: '50%',
                border: 'none',
                background: isTranscribing ? 'var(--bg3)' : '#3b82f6',
                color: isTranscribing ? 'var(--text3)' : '#fff',
                cursor: disabled || loading || isTranscribing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
