import { useCallback, useEffect, useRef, useState } from 'react';

function cleanSpeech(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordKey(word = '') {
  return String(word || '')
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"“”‘’]/g, '')
    .trim();
}

function removeImmediateRepeats(text = '') {
  const words = cleanSpeech(text).split(' ').filter(Boolean);
  const out = [];

  for (const word of words) {
    const prev = out[out.length - 1];
    if (prev && wordKey(prev) === wordKey(word)) continue;
    out.push(word);
  }

  return out.join(' ');
}

function mergeByOverlap(previous = '', next = '') {
  const prev = cleanSpeech(previous);
  const nxt = removeImmediateRepeats(next);

  if (!nxt) return prev;
  if (!prev) return nxt;

  const prevLower = prev.toLowerCase();
  const nextLower = nxt.toLowerCase();

  if (prevLower === nextLower) return prev;
  if (prevLower.endsWith(nextLower)) return prev;
  if (nextLower.startsWith(prevLower)) return nxt;

  const prevWords = prev.split(' ').filter(Boolean);
  const nextWords = nxt.split(' ').filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, nextWords.length, 24);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const prevTail = prevWords.slice(-overlap).map(wordKey).join(' ');
    const nextHead = nextWords.slice(0, overlap).map(wordKey).join(' ');

    if (prevTail && prevTail === nextHead) {
      return removeImmediateRepeats([...prevWords, ...nextWords.slice(overlap)].join(' '));
    }
  }

  return removeImmediateRepeats(`${prev} ${nxt}`);
}

export default function VoiceInput({
  onTranscript,
  onPreview,
  disabled = false,
  stopSignal = 0,
}) {
  const [recording, setRecording] = useState(false);

  const recognitionRef = useRef(null);
  const recordingRef = useRef(false);
  const manualStopRef = useRef(false);
  const committedRef = useRef('');
  const sessionFinalRef = useRef('');
  const lastPreviewRef = useRef('');
  const restartTimerRef = useRef(null);

  const stopRecording = useCallback(() => {
    manualStopRef.current = true;
    recordingRef.current = false;
    committedRef.current = '';
    sessionFinalRef.current = '';
    lastPreviewRef.current = '';

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    try {
      recognitionRef.current?.stop();
    } catch {}

    setRecording(false);
  }, []);

  useEffect(() => {
    if (!stopSignal) return;
    stopRecording();
  }, [stopSignal, stopRecording]);

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);

      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  const emit = useCallback((fullTranscript, currentPhrase, interim, final) => {
    const cleanFull = cleanSpeech(fullTranscript);
    const cleanPhrase = cleanSpeech(currentPhrase);

    if (cleanPhrase) {
      lastPreviewRef.current = cleanPhrase;
    }

    onPreview?.(cleanPhrase || lastPreviewRef.current || '', {
      recording: true,
      interim: cleanSpeech(interim),
      final: cleanSpeech(final),
      currentPhrase: cleanPhrase || lastPreviewRef.current || '',
    });

    onTranscript?.(cleanFull, {
      recording: true,
      interim: cleanSpeech(interim),
      final: cleanSpeech(final),
      currentPhrase: cleanPhrase || lastPreviewRef.current || '',
    });
  }, [onPreview, onTranscript]);

  const startRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please use Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let allFinal = '';
      let interim = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript || '';

        if (event.results[i].isFinal) {
          allFinal += ` ${transcript}`;
        } else if (i >= event.resultIndex) {
          interim += ` ${transcript}`;
        }
      }

      allFinal = cleanSpeech(allFinal);
      interim = cleanSpeech(interim);

      if (allFinal && allFinal !== sessionFinalRef.current) {
        sessionFinalRef.current = allFinal;
      }

      const committedPlusFinal = mergeByOverlap(committedRef.current, sessionFinalRef.current);
      const fullTranscript = interim
        ? mergeByOverlap(committedPlusFinal, interim)
        : committedPlusFinal;

      const currentPhrase = interim || sessionFinalRef.current.split(' ').slice(-10).join(' ');

      emit(fullTranscript, currentPhrase, interim, sessionFinalRef.current);
    };

    recognition.onend = () => {
      if (!recordingRef.current || manualStopRef.current || disabled) {
        setRecording(false);
        return;
      }

      if (sessionFinalRef.current) {
        committedRef.current = mergeByOverlap(committedRef.current, sessionFinalRef.current);
        sessionFinalRef.current = '';
      }

      restartTimerRef.current = setTimeout(() => {
        if (!recordingRef.current || manualStopRef.current || disabled) return;

        try {
          recognition.start();
        } catch {}
      }, 250);
    };

    recognition.onerror = () => {
      if (!recordingRef.current || manualStopRef.current || disabled) {
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
      recordingRef.current = false;
      setRecording(false);
    }
  }, [disabled, emit]);

  const startRecording = useCallback(() => {
    if (disabled) return;

    manualStopRef.current = false;
    recordingRef.current = true;
    committedRef.current = '';
    sessionFinalRef.current = '';
    lastPreviewRef.current = '';

    startRecognition();
  }, [disabled, startRecognition]);

  const toggleRecording = useCallback(() => {
    if (disabled) return;

    if (recordingRef.current || recording) {
      stopRecording();
      return;
    }

    startRecording();
  }, [disabled, recording, startRecording, stopRecording]);

  return (
    <button
      type="button"
      className={`voice-btn${recording ? ' listening recording' : ''}`}
      onClick={toggleRecording}
      disabled={disabled}
      title={recording ? 'Stop recording' : 'Voice input'}
      aria-label={recording ? 'Stop recording' : 'Voice input'}
      style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: recording ? '#ef4444' : '#9ca3af',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        flexShrink: 0,
        padding: 0,
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
  );
}
