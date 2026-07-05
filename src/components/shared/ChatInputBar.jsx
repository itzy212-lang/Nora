/**
 * ChatInputBar — single source for ALL input bars across Nora.
 *
 * Layout:
 *   [+ attach]  [textarea — grows with content]  [mic → send when text/done]
 *
 * Props:
 *   value        {string}    controlled value
 *   onChange     {fn}        called with new string
 *   onSend       {fn}        called with final text when user sends
 *   placeholder  {string}
 *   disabled     {boolean}
 *   loading      {boolean}   shows "thinking…" placeholder
 *   onAttach     {fn}        if provided, shows + button on left
 *   stopSignal   {number}    increment to stop recording externally
 *   autoSend     {boolean}   if true, sends immediately after dictation (default false)
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
  onAttach,
  stopSignal = 0,
  autoSend = false,
}) {
  const textareaRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [internalStop, setInternalStop] = useState(0);
  const voiceBaseRef = useRef('');

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 300) + 'px';
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  const handleChange = useCallback((e) => {
    voiceBaseRef.current = '';
    onChange?.(e.target.value);
  }, [onChange]);

  const handleSend = useCallback(() => {
    const text = (value || '').trim();
    if (!text || disabled || loading) return;
    voiceBaseRef.current = '';
    setInternalStop(s => s + 1);
    onSend?.(text);
  }, [value, disabled, loading, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isRecording) {
        // Stop recording, don't send yet
        setInternalStop(s => s + 1);
        return;
      }
      handleSend();
    }
  }, [isRecording, handleSend]);

  const handleVoice = useCallback((transcript, meta) => {
    if (meta?.restarting) return;

    if (meta?.recording === false) {
      setIsRecording(false);
      setIsTranscribing(true);
      setInterimText('');
    } else if (meta?.recording) {
      setIsRecording(true);
      setIsTranscribing(false);
    }

    if (meta?.interim) {
      setInterimText(meta.interim);
    }

    if (!meta?.recording && transcript) {
      // Final transcript received
      setIsTranscribing(false);
      setInterimText('');
      const base = voiceBaseRef.current;
      const next = base ? `${base} ${transcript}` : transcript;
      voiceBaseRef.current = '';
      onChange?.(next);
      if (autoSend) {
        setTimeout(() => onSend?.(next), 50);
      }
    } else if (meta?.recording && transcript) {
      // Accumulate during recording
      if (!voiceBaseRef.current) voiceBaseRef.current = (value || '').trim();
      const base = voiceBaseRef.current;
      const next = base ? `${base} ${transcript}` : transcript;
      onChange?.(next);
    }
  }, [value, onChange, onSend, autoSend]);

  // Safety net — clear transcribing state after 8s
  useEffect(() => {
    if (!isTranscribing) return;
    const t = setTimeout(() => setIsTranscribing(false), 8000);
    return () => clearTimeout(t);
  }, [isTranscribing]);

  const combinedStop = stopSignal + internalStop;
  const hasText = (value || '').trim().length > 0;
  const showSend = (hasText && !isRecording) || isTranscribing;

  return (
    <div style={{ width: '100%' }}>

      {/* Live interim preview above input */}
      {interimText && isRecording && (
        <div style={{
          padding: '4px 14px 6px',
          fontSize: 12, color: 'var(--text3)',
          fontStyle: 'italic',
        }}>
          🎤 {interimText}
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

        {/* + attach button on left */}
        <button
          type="button"
          onClick={onAttach}
          disabled={disabled || !onAttach}
          title="Attach file"
          style={{
            width: 32, height: 32,
            borderRadius: '50%',
            border: '1.5px solid var(--border)',
            background: 'var(--bg)',
            color: onAttach ? 'var(--text2)' : 'var(--border)',
            fontSize: 18, lineHeight: 1,
            flexShrink: 0,
            cursor: onAttach && !disabled ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 2,
            opacity: onAttach ? 1 : 0.3,
          }}
        >+</button>

        {/* Textarea — grows with content */}
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

        {/* Right side — mic or send */}
        <div style={{ flexShrink: 0, marginBottom: 2, position: 'relative', width: 36, height: 36 }}>

          {/* VoiceInput mic — shown when no text and not transcribing */}
          {!showSend && (
            <VoiceInput
              onTranscript={handleVoice}
              onPreview={(preview, meta) => {
                if (meta?.recording) {
                  setIsRecording(true);
                  if (meta.interim || meta.currentPhrase) {
                    setInterimText(meta.currentPhrase || meta.interim || '');
                  }
                }
              }}
              disabled={disabled || loading}
              stopSignal={combinedStop}
            />
          )}

          {/* Send button — shown when there's text or transcribing done */}
          {showSend && (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || loading || isTranscribing || !hasText}
              style={{
                position: 'absolute', inset: 0,
                width: 36, height: 36,
                borderRadius: '50%',
                border: 'none',
                background: hasText && !isTranscribing ? '#3b82f6' : 'var(--bg3)',
                color: hasText && !isTranscribing ? '#fff' : 'var(--text3)',
                cursor: hasText && !isTranscribing && !disabled ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {isTranscribing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
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
