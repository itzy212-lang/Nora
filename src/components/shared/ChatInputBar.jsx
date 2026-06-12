/**
 * ChatInputBar — THE shared input bar for all Nora chats.
 *
 * Layout (matches Claude chat):
 *   [+ attach?]  [textarea with waveform when recording]  [mic / send]
 *
 * Behaviour:
 *   - Textarea expands up to 200px, then scrolls
 *   - When recording: waveform bars shown inside box, mic turns red
 *   - When transcribing: "Transcribing..." shown inside box
 *   - Enter sends (if text present), Shift+Enter = new line
 *   - While recording, Enter stops recording
 *   - Send button replaces mic when text is present and idle
 *   - Live preview lines shown above input while recording
 *   - Mobile: input bar lifts with keyboard automatically
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import VoiceInput from './VoiceInput';

const MAX_HEIGHT = 200;
const WAVEFORM_HEIGHTS = [0.5,0.9,0.6,1,0.7,0.8,0.4,1,0.6,0.9,0.7,0.8,0.5,0.9,0.6,1,0.7,0.8,0.5,0.9,0.6,1];

export default function ChatInputBar({
  value = '',
  onChange,
  onSend,
  onTranscript,
  placeholder = 'Type or tap mic to speak…',
  disabled = false,
  loading = false,
  showAttach = false,
  onAttach,
  stopSignal = 0,
}) {
  const textareaRef = useRef(null);
  const [voicePhase, setVoicePhase] = useState('idle');
  const [livePreview, setLivePreview] = useState('');

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, []);

  useEffect(() => { resize(); }, [value, resize]);

  const handleChange = useCallback((e) => {
    onChange?.(e.target.value);
  }, [onChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (voicePhase === 'recording') {
        setVoicePhase('transcribing');
        return;
      }
      if (value.trim() && !disabled && !loading) {
        onSend?.(value);
      }
    }
  }, [value, voicePhase, disabled, loading, onSend]);

  const handleVoicePreview = useCallback((preview, meta = {}) => {
    if (meta.recording === true) {
      setVoicePhase('recording');
      const p = meta.currentPhrase || meta.interim || preview || '';
      if (p && !p.toLowerCase().includes('speak now') && !p.toLowerCase().includes('recording')) {
        setLivePreview(p);
        onChange?.(p);
      }
    } else if (meta.recording === false) {
      setVoicePhase('transcribing');
      setLivePreview('');
    }
  }, [onChange]);

  const handleTranscript = useCallback((transcript) => {
    setVoicePhase('idle');
    setLivePreview('');
    onChange?.(transcript);
    onTranscript?.(transcript);
    setTimeout(resize, 50);
  }, [onChange, onTranscript, resize]);

  const handleSend = useCallback(() => {
    if (value.trim() && !disabled && !loading) {
      onSend?.(value);
    }
  }, [value, disabled, loading, onSend]);

  const isRecording = voicePhase === 'recording';
  const isTranscribing = voicePhase === 'transcribing';
  const hasText = value.trim().length > 0;

  const previewLines = (() => {
    if (!isRecording || !livePreview) return [];
    const words = livePreview.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 40) {
        if (cur) lines.push(cur.trim());
        cur = w;
      } else {
        cur = cur ? cur + ' ' + w : w;
      }
    }
    if (cur) lines.push(cur.trim());
    return lines.slice(-2);
  })();

  return (
    <div style={{ width: '100%' }}>

      {isRecording && previewLines.length > 0 && (
        <div style={{ padding: '0 4px 6px' }}>
          {previewLines.map((line, i, arr) => {
            const age = arr.length - 1 - i;
            return (
              <div key={i} style={{
                fontSize: 13, lineHeight: 1.4,
                color: age === 0 ? 'var(--text)' : 'rgba(120,120,120,0.4)',
                fontWeight: age === 0 ? 500 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{line}</div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>

        {showAttach && (
          <button
            type="button"
            onClick={onAttach}
            disabled={disabled}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              border: '1.5px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text3)',
              fontSize: 20, lineHeight: 1,
              flexShrink: 0, cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 4,
            }}
          >+</button>
        )}

        <div style={{
          flex: 1, minWidth: 0,
          border: `1.5px solid ${isRecording ? '#3b82f6' : 'var(--border)'}`,
          borderRadius: 14,
          background: 'var(--bg2, #f8f8f8)',
          display: 'flex', alignItems: 'center',
          padding: '0 14px',
          minHeight: 44,
          transition: 'border-color 0.15s',
          boxSizing: 'border-box',
        }}>
          {isRecording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 24, width: '100%' }}>
              {WAVEFORM_HEIGHTS.map((h, i) => (
                <div key={i} style={{
                  width: 3, borderRadius: 2,
                  background: '#3b82f6',
                  height: `${3 + h * 18}px`,
                  animation: `nora-wave 0.65s ease-in-out ${(i * 0.04).toFixed(2)}s infinite alternate`,
                }} />
              ))}
              <style>{`@keyframes nora-wave{from{transform:scaleY(0.15)}to{transform:scaleY(1)}}`}</style>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={isTranscribing ? 'Transcribing…' : loading ? 'Thinking…' : placeholder}
              rows={1}
              disabled={disabled || isTranscribing}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontSize: 14,
                lineHeight: '20px',
                color: 'var(--text)',
                fontFamily: 'inherit',
                minHeight: 24,
                maxHeight: MAX_HEIGHT,
                padding: '12px 0',
                boxSizing: 'border-box',
                overflowY: 'auto',
              }}
            />
          )}
        </div>

        <div style={{ position: 'relative', flexShrink: 0, marginBottom: 4 }}>
          <VoiceInput
            disabled={disabled || loading}
            stopSignal={stopSignal}
            onTranscript={handleTranscript}
            onPreview={handleVoicePreview}
          />
          {hasText && !isRecording && !isTranscribing && (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || loading}
              style={{
                position: 'absolute', inset: 0,
                borderRadius: '50%',
                border: 'none',
                background: '#3b82f6',
                color: '#fff',
                cursor: disabled || loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2,
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
