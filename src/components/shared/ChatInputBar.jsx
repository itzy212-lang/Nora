/**
 * ChatInputBar — shared input bar used by ALL chat surfaces in Nora.
 *
 * Layout:  [+ attach?]  [textarea / waveform]  [mic → send]
 *
 * Props:
 *   value          {string}   controlled input value
 *   onChange       {fn}       called with new string value
 *   onSend         {fn}       called when user sends (text passed as arg)
 *   onTranscript   {fn}       called with final Whisper transcript
 *   placeholder    {string}
 *   disabled       {boolean}
 *   loading        {boolean}  shows "thinking…" state
 *   showAttach     {boolean}  show + file button (default false)
 *   onAttach       {fn}       called when + tapped
 *   attachInputRef {ref}      ref for hidden file input
 *   voicePhase     {string}   'idle' | 'recording' | 'transcribing'  (controlled externally via onVoicePhase)
 *   onVoicePhase   {fn}       called when voice phase changes
 *   livePreview    {string}   live dictation preview text
 *   onLivePreview  {fn}       called with new preview text
 */

import { useRef, useCallback } from 'react';
import VoiceInput from './VoiceInput';

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
  attachInputRef,
  voicePhase = 'idle',
  onVoicePhase,
  livePreview = '',
  onLivePreview,
  voiceStopSignal = 0,
}) {
  const textareaRef = useRef(null);

  // Auto-expand textarea
  const handleChange = useCallback((e) => {
    onChange?.(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [onChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) onSend?.(value);
    }
  }, [value, onSend]);

  const handleVoicePreview = useCallback((preview, meta = {}) => {
    if (meta.recording === true) {
      onVoicePhase?.('recording');
      const p = meta.currentPhrase || meta.interim || preview || '';
      if (p && !p.includes('speak now') && !p.includes('Recording')) {
        onLivePreview?.(p);
      }
    } else if (meta.recording === false) {
      onVoicePhase?.('transcribing');
      onLivePreview?.('');
    }
  }, [onVoicePhase, onLivePreview]);

  const handleTranscript = useCallback((transcript) => {
    onVoicePhase?.('idle');
    onLivePreview?.('');
    onTranscript?.(transcript);
    // Also set in textarea
    onChange?.(transcript);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
      }
    }, 50);
  }, [onVoicePhase, onLivePreview, onTranscript, onChange]);

  const isRecording = voicePhase === 'recording';
  const isTranscribing = voicePhase === 'transcribing';

  // Build preview lines from livePreview text
  const previewLines = (() => {
    const text = livePreview || value || '';
    if (!text || !isRecording) return [];
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 38) {
        if (cur) lines.push(cur.trim());
        cur = w;
      } else {
        cur = cur ? cur + ' ' + w : w;
      }
    }
    if (cur) lines.push(cur.trim());
    return lines.slice(-3);
  })();

  return (
    <div style={{ width: '100%' }}>

      {/* Live preview lines — above input row when recording */}
      {isRecording && previewLines.length > 0 && (
        <div style={{ padding: '4px 4px 6px', marginBottom: 2 }}>
          {previewLines.map((line, i, arr) => {
            const age = arr.length - 1 - i;
            return (
              <div key={i} style={{
                fontSize: 13.5, lineHeight: 1.45,
                color: age === 0 ? 'var(--text)' : `rgba(100,100,100,${age === 1 ? 0.45 : 0.2})`,
                fontWeight: age === 0 ? 500 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{line}</div>
            );
          })}
        </div>
      )}

      {/* Input row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>

        {/* + attach button */}
        {showAttach && (
          <button
            type="button"
            onClick={onAttach}
            disabled={disabled}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text3)', fontSize: 20, flexShrink: 0,
              cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >+</button>
        )}

        {/* Input box — waveform when recording, textarea otherwise */}
        <div style={{
          flex: 1, minWidth: 0, position: 'relative',
          border: `1.5px solid ${isRecording ? '#3b82f6' : 'var(--border)'}`,
          borderRadius: 12, background: 'var(--bg2)',
          display: 'flex', alignItems: 'center', padding: '0 12px',
          minHeight: 44, transition: 'border-color 0.2s',
        }}>
          {isRecording ? (
            /* Waveform bars */
            <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 22, width: '100%' }}>
              {[0.5,0.9,0.6,1,0.7,0.8,0.4,1,0.6,0.9,0.7,0.8,0.5,0.9,0.6,1,0.7,0.8,0.5,0.9,0.6,1].map((h, i) => (
                <div key={i} style={{
                  width: 3, borderRadius: 2, background: '#3b82f6',
                  height: `${3 + h * 18}px`,
                  animation: `chatBarWave 0.7s ease-in-out ${i * 0.05}s infinite alternate`,
                }} />
              ))}
              <style>{`@keyframes chatBarWave{from{transform:scaleY(0.2)}to{transform:scaleY(1)}}`}</style>
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
                width: '100%', background: 'transparent', border: 'none',
                fontSize: 13.5, color: 'var(--text)', outline: 'none',
                resize: 'none', lineHeight: '20px',
                minHeight: 24, maxHeight: 200,
                padding: '10px 0', boxSizing: 'border-box',
                overflowY: 'auto', fontFamily: 'inherit',
              }}
            />
          )}
        </div>

        {/* Mic / Send button */}
        <div style={{ flexShrink: 0, position: 'relative' }}>
          <VoiceInput
            disabled={disabled || loading}
            stopSignal={voiceStopSignal}
            onTranscript={handleTranscript}
            onPreview={handleVoicePreview}
          />
          {/* Send arrow overlays mic when text is present and idle */}
          {value.trim() && voicePhase === 'idle' && (
            <button
              onClick={() => onSend?.(value)}
              disabled={disabled || loading}
              style={{
                position: 'absolute', inset: 0,
                borderRadius: '50%', border: 'none',
                background: '#3b82f6', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 2,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
