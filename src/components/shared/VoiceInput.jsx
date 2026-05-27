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

export default function VoiceInput({
  onTranscript,
  onPreview,
  disabled = false,
  stopSignal = 0,
}) {
  const [recording, setRecording] = useState(false);

  const recognitionRef = useRef(null);
  const shouldKeepRecordingRef = useRef(false);
  const manualStopRef = useRef(false);
  const restartTimerRef = useRef(null);

  const committedRef = useRef('');
  const sessionResultsRef = useRef({});
  const lastEmittedRef = useRef('');

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
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

    onPreview?.('', {
      recording: false,
      currentPhrase: '',
      interim: '',
      final: '',
    });

    setRecording(false);
  }, [clearRestartTimer, onPreview]);

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

      // Keep the mic visually active and restart quietly after Chrome ends on silence.
      setRecording(true);

      restartTimerRef.current = setTimeout(() => {
        if (manualStopRef.current || !shouldKeepRecordingRef.current || disabled) return;
        startRecognitionSession();
      }, 180);
    };

    recognition.onerror = () => {
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

  const startRecording = useCallback(() => {
    if (disabled) return;

    manualStopRef.current = false;
    shouldKeepRecordingRef.current = true;
    committedRef.current = '';
    sessionResultsRef.current = {};
    lastEmittedRef.current = '';

    startRecognitionSession();
  }, [disabled, startRecognitionSession]);

  const toggleRecording = useCallback(() => {
    if (disabled) return;

    if (shouldKeepRecordingRef.current || recording) {
      stopRecording();
      return;
    }

    startRecording();
  }, [disabled, recording, startRecording, stopRecording]);

  useEffect(() => {
    if (!stopSignal) return;
    stopRecording();
  }, [stopSignal, stopRecording]);

  useEffect(() => {
    return () => {
      clearRestartTimer();

      try {
        recognitionRef.current?.abort?.();
      } catch {}

      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, [clearRestartTimer]);

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
