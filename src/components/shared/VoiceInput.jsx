import { useCallback, useEffect, useRef, useState } from 'react';

function cleanText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

function wordKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"“”‘’]/g, '')
    .trim();
}

function removeImmediateDuplicateWords(value = '') {
  const words = cleanText(value).split(' ').filter(Boolean);
  const output = [];

  for (const word of words) {
    const previous = output[output.length - 1];

    if (previous && wordKey(previous) === wordKey(word)) {
      continue;
    }

    output.push(word);
  }

  return output.join(' ').trim();
}

function orderedResultText(results = {}) {
  return Object.keys(results)
    .map(Number)
    .sort((a, b) => a - b)
    .map(index => results[index])
    .filter(Boolean)
    .join(' ')
    .trim();
}

function mergeWithoutRepeating(previous = '', next = '') {
  const prev = removeImmediateDuplicateWords(previous);
  const curr = removeImmediateDuplicateWords(next);

  if (!curr) return prev;
  if (!prev) return curr;

  const prevLower = prev.toLowerCase();
  const currLower = curr.toLowerCase();

  if (prevLower === currLower) return prev;
  if (prevLower.endsWith(currLower)) return prev;
  if (currLower.startsWith(prevLower)) return curr;

  const prevWords = prev.split(' ').filter(Boolean);
  const currWords = curr.split(' ').filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, currWords.length, 20);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const prevTail = prevWords.slice(-size).map(wordKey).join(' ');
    const currHead = currWords.slice(0, size).map(wordKey).join(' ');

    if (prevTail && prevTail === currHead) {
      return removeImmediateDuplicateWords([
        ...prevWords,
        ...currWords.slice(size),
      ].join(' '));
    }
  }

  return removeImmediateDuplicateWords(`${prev} ${curr}`);
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';

  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';

  // iOS Safari only supports mp4/aac — check for that first on mobile
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const candidates = isIOS
    ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];

  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export default function VoiceInput({
  onTranscript,
  onPreview,
  disabled = false,
  stopSignal = 0,
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recognitionRef = useRef(null);
  const shouldKeepRecordingRef = useRef(false);
  const manualStopRef = useRef(false);
  const restartTimerRef = useRef(null);

  const committedRef = useRef('');
  const sessionResultsRef = useRef({});
  const lastEmittedRef = useRef('');

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaChunksRef = useRef([]);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopMediaTracks = useCallback(() => {
    try {
      mediaStreamRef.current?.getTracks?.().forEach(track => track.stop());
    } catch {}

    mediaStreamRef.current = null;
  }, []);

  const emit = useCallback((fullText = '', currentPhrase = '', finalText = '') => {
    const cleanFull = removeImmediateDuplicateWords(fullText);
    const cleanPhrase = removeImmediateDuplicateWords(currentPhrase);
    const cleanFinal = removeImmediateDuplicateWords(finalText);

    if (cleanFull === lastEmittedRef.current && !cleanPhrase) {
      return;
    }

    lastEmittedRef.current = cleanFull;

    onPreview?.(cleanPhrase, {
      recording: shouldKeepRecordingRef.current,
      currentPhrase: cleanPhrase,
      interim: cleanPhrase,
      final: cleanFinal,
    });

    onTranscript?.(cleanFull, {
      recording: shouldKeepRecordingRef.current,
      currentPhrase: cleanPhrase,
      interim: cleanPhrase,
      final: cleanFinal,
    });
  }, [onPreview, onTranscript]);

  const stopRecording = useCallback(() => {
    manualStopRef.current = true;
    shouldKeepRecordingRef.current = false;
    clearRestartTimer();

    try {
      recognitionRef.current?.abort?.();
    } catch {}

    try {
      recognitionRef.current?.stop?.();
    } catch {}

    recognitionRef.current = null;
    committedRef.current = '';
    sessionResultsRef.current = {};
    lastEmittedRef.current = '';

    try {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch {}

    onPreview?.('', {
      recording: false,
      currentPhrase: '',
      interim: '',
      final: '',
    });

    setRecording(false);
  }, [clearRestartTimer, onPreview]);

  const sendMobileAudioForTranscription = useCallback(async (blob) => {
    if (!blob || blob.size === 0) return;

    setTranscribing(true);

    // Log file size to help diagnose slow transcription on mobile
    const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
    console.log(`[transcribe] sending audio: ${sizeMB}MB, type: ${blob.type}`);

    try {
      const formData = new FormData();
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';

      formData.append('audio', blob, `voice.${extension}`);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        const detail = payload?.error || payload?.message || JSON.stringify(payload) || '';
        throw new Error(`Transcription failed (${response.status})${detail ? ': ' + detail : ''}`);
      }

      const text = cleanText(payload.text || '');

      if (text) {
        lastEmittedRef.current = text;

        onPreview?.('', {
          recording: false,
          currentPhrase: '',
          interim: '',
          final: text,
        });

        onTranscript?.(text, {
          recording: false,
          currentPhrase: '',
          interim: '',
          final: text,
        });
      }
    } catch (error) {
      console.error('[VoiceInput] mobile transcription failed:', error);
      const msg = error?.message || 'Voice transcription failed. Please try again.';
      alert(`[Transcription error — please screenshot this]\n\n${msg}`);
    } finally {
      setTranscribing(false);
      setRecording(false);
      // Reset refs so mic can be tapped again for a new recording
      manualStopRef.current = false;
      shouldKeepRecordingRef.current = false;
      stopMediaTracks();
      mediaRecorderRef.current = null;
      mediaChunksRef.current = [];
    }
  }, [onPreview, onTranscript, stopMediaTracks]);

  const startMobileRecording = useCallback(async () => {
    if (disabled || transcribing) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Audio recording is not supported in this browser.');
      return;
    }

    // Warm up the transcribe function immediately — prevents cold start delay
    fetch('/api/transcribe', { method: 'GET' }).catch(() => {});

    try {
      manualStopRef.current = false;
      shouldKeepRecordingRef.current = true;
      mediaChunksRef.current = [];

      // Request low-bitrate mono audio — faster to upload, faster to transcribe
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      const mimeType = getSupportedAudioMimeType();

      const recorderOptions = { audioBitsPerSecond: 16000 };
      if (mimeType) recorderOptions.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, recorderOptions);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        shouldKeepRecordingRef.current = false;

        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(mediaChunksRef.current, { type });

        sendMobileAudioForTranscription(blob);
      };

      recorder.onerror = () => {
        shouldKeepRecordingRef.current = false;
        setRecording(false);
        stopMediaTracks();
      };

      recorder.start();
      setRecording(true);

      onPreview?.('', {
        recording: true,
        currentPhrase: '',
        interim: '',
        final: '',
      });

      // Run Web Speech in parallel for live preview only — Whisper handles final accuracy
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const previewRec = new SpeechRecognition();
          previewRec.continuous = true;
          previewRec.interimResults = true;
          previewRec.maxAlternatives = 1;
          previewRec.onresult = (event) => {
            if (!shouldKeepRecordingRef.current) return;
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (!event.results[i].isFinal) {
                interim = cleanText(event.results[i][0]?.transcript || '');
              }
            }
            if (interim) {
              onPreview?.(interim, { recording: true, currentPhrase: interim, interim, final: '' });
            }
          };
          previewRec.onerror = () => {};
          previewRec.onend = () => {};
          previewRec.start();
          // Store so we can stop it when recording stops
          recognitionRef.current = previewRec;
        } catch {}
      }
    } catch (error) {
      console.error('[VoiceInput] mobile recording failed:', error);
      shouldKeepRecordingRef.current = false;
      setRecording(false);
      stopMediaTracks();
      alert(error?.message || 'Could not start voice recording.');
    }
  }, [disabled, onPreview, sendMobileAudioForTranscription, stopMediaTracks, transcribing]);

  const startRecognitionSession = useCallback(() => {
    if (disabled || manualStopRef.current || !shouldKeepRecordingRef.current) {
      setRecording(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please use Chrome.');
      shouldKeepRecordingRef.current = false;
      setRecording(false);
      return;
    }

    clearRestartTimer();
    sessionResultsRef.current = {};

    const recognition = new SpeechRecognition();

    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (manualStopRef.current || !shouldKeepRecordingRef.current) return;
      setRecording(true);
    };

    recognition.onresult = (event) => {
      if (manualStopRef.current || !shouldKeepRecordingRef.current) return;

      let latestInterim = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const spoken = cleanText(event.results[i]?.[0]?.transcript || '');

        if (!spoken) continue;

        sessionResultsRef.current[i] = spoken;

        if (!event.results[i].isFinal && i >= event.resultIndex) {
          latestInterim = spoken;
        }
      }

      const sessionText = removeImmediateDuplicateWords(orderedResultText(sessionResultsRef.current));
      const fullText = mergeWithoutRepeating(committedRef.current, sessionText);

      emit(fullText, latestInterim, sessionText);
    };

    recognition.onend = () => {
      if (manualStopRef.current || !shouldKeepRecordingRef.current || disabled) {
        setRecording(false);
        return;
      }

      const sessionText = removeImmediateDuplicateWords(orderedResultText(sessionResultsRef.current));

      if (sessionText) {
        committedRef.current = mergeWithoutRepeating(committedRef.current, sessionText);
      }

      sessionResultsRef.current = {};

      // Signal consumers that this is a restart gap, not a final stop
      // This prevents voicePhase switching to idle/transcribing during the gap
      const restartMeta = { recording: true, restarting: true, currentPhrase: '', interim: '', final: '' };
      onPreview?.(committedRef.current || '', restartMeta);
      if (committedRef.current) {
        onTranscript?.(committedRef.current, restartMeta);
      }

      setRecording(true);

      restartTimerRef.current = setTimeout(() => {
        if (manualStopRef.current || !shouldKeepRecordingRef.current || disabled) return;
        startRecognitionSession();
      }, 180);
    };

    recognition.onerror = (event) => {
      const errorType = event?.error || '';
      console.warn('[VoiceInput] Web Speech error:', errorType);

      // Permission denied or service unavailable — fall back to Whisper
      if (errorType === 'not-allowed' || errorType === 'service-not-allowed') {
        shouldKeepRecordingRef.current = false;
        setRecording(false);
        console.log('[VoiceInput] Microphone permission denied or service unavailable — falling back to Whisper');
        startMobileRecording();
        return;
      }

      if (manualStopRef.current || !shouldKeepRecordingRef.current || disabled) {
        setRecording(false);
        return;
      }

      try {
        recognition.stop();
      } catch {}
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setRecording(true);
    } catch {
      restartTimerRef.current = setTimeout(() => {
        if (manualStopRef.current || !shouldKeepRecordingRef.current || disabled) return;
        startRecognitionSession();
      }, 250);
    }
  }, [clearRestartTimer, disabled, emit]);

  const startDesktopRecording = useCallback(() => {
    if (disabled) return;

    manualStopRef.current = false;
    shouldKeepRecordingRef.current = true;
    committedRef.current = '';
    sessionResultsRef.current = {};
    lastEmittedRef.current = '';

    // Check if Web Speech API is available — if not, fall back to Whisper (same as mobile)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.log('[VoiceInput] Web Speech API not available on desktop — falling back to Whisper');
      startMobileRecording();
      return;
    }

    startRecognitionSession();
  }, [disabled, startMobileRecording, startRecognitionSession]);

  const toggleRecording = useCallback(() => {
    if (disabled || transcribing) return;

    if (shouldKeepRecordingRef.current || recording) {
      stopRecording();
      return;
    }

    // Use Web Speech API if available — works on desktop Chrome, Android Chrome,
    // and any browser with reliable Web Speech support. Text appears in real time,
    // no upload delay, no Whisper round-trip needed.
    // Falls back to Whisper (startMobileRecording) automatically on iOS Safari
    // where Web Speech is unreliable or unavailable.
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      startDesktopRecording();
      return;
    }

    // No Web Speech API available (iOS Safari) — use Whisper
    startMobileRecording();
  }, [disabled, recording, startDesktopRecording, startMobileRecording, stopRecording, transcribing]);

  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);

  useEffect(() => {
    if (!stopSignal) return;
    stopRecordingRef.current();
  }, [stopSignal]);

  useEffect(() => {
    return () => {
      clearRestartTimer();

      try {
        recognitionRef.current?.abort?.();
      } catch {}

      try {
        recognitionRef.current?.stop?.();
      } catch {}

      try {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch {}

      stopMediaTracks();
    };
  }, [clearRestartTimer, stopMediaTracks]);

  const active = recording || transcribing;

  return (
    <>
    <style>{`@keyframes voicePulse { 0%,100%{box-shadow:0 0 0 3px rgba(239,68,68,0.2)} 50%{box-shadow:0 0 0 7px rgba(239,68,68,0.35)} }`}</style>
    <button
      type="button"
      className={`voice-btn${active ? ' listening recording' : ''}`}
      onClick={toggleRecording}
      disabled={disabled || transcribing}
      title={transcribing ? 'Transcribing…' : recording ? 'Stop recording' : 'Voice input'}
      aria-label={transcribing ? 'Transcribing…' : recording ? 'Stop recording' : 'Voice input'}
      style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        border: 'none',
        background: active ? 'rgba(239,68,68,0.12)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? '#ef4444' : '#9ca3af',
        cursor: disabled || transcribing ? 'not-allowed' : 'pointer',
        opacity: disabled || transcribing ? 0.45 : 1,
        flexShrink: 0,
        padding: 0,
        boxShadow: active ? '0 0 0 4px rgba(239,68,68,0.18)' : 'none',
        transition: 'box-shadow 0.3s, background 0.3s',
        animation: recording ? 'voicePulse 1.2s ease-in-out infinite' : 'none',
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <path d="M12 18v4" />
        <path d="M8 22h8" />
      </svg>
    </button>
    </>
  );
}







