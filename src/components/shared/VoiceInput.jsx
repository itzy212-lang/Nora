import { useCallback, useEffect, useRef, useState } from 'react';

function basicClean(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function wordKey(word = '') {
  return String(word || '')
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"“”‘’]/g, '')
    .trim();
}

function collapseImmediateDuplicateWords(text = '') {
  const words = basicClean(text).split(' ').filter(Boolean);
  const out = [];

  for (const word of words) {
    const prev = out[out.length - 1];
    if (prev && wordKey(prev) === wordKey(word)) continue;
    out.push(word);
  }

  return out.join(' ');
}

function collapseAdjacentRepeatedPhrases(text = '') {
  let words = collapseImmediateDuplicateWords(text).split(' ').filter(Boolean);

  // Android Chrome can repeat whole interim/final chunks, for example:
  // "serve section ten serve section ten notice". This removes adjacent repeated
  // word groups without touching the rest of the sentence.
  for (let size = Math.min(8, Math.floor(words.length / 2)); size >= 2; size -= 1) {
    let i = 0;
    const next = [];

    while (i < words.length) {
      const a = words.slice(i, i + size).map(wordKey).join(' ');
      const b = words.slice(i + size, i + size * 2).map(wordKey).join(' ');

      if (a && a === b) {
        next.push(...words.slice(i, i + size));
        i += size * 2;
      } else {
        next.push(words[i]);
        i += 1;
      }
    }

    words = next;
  }

  return words.join(' ');
}

function cleanSpeech(text = '') {
  return collapseAdjacentRepeatedPhrases(text);
}

function mergeByOverlap(previous = '', next = '') {
  const prev = cleanSpeech(previous);
  const nxt = cleanSpeech(next);

  if (!nxt) return prev;
  if (!prev) return nxt;

  const prevLower = prev.toLowerCase();
  const nextLower = nxt.toLowerCase();

  if (prevLower === nextLower) return prev;
  if (prevLower.endsWith(nextLower)) return prev;
  if (nextLower.startsWith(prevLower)) return nxt;

  const prevWords = prev.split(' ').filter(Boolean);
  const nextWords = nxt.split(' ').filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, nextWords.length, 30);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const prevTail = prevWords.slice(-overlap).map(wordKey).join(' ');
    const nextHead = nextWords.slice(0, overlap).map(wordKey).join(' ');

    if (prevTail && prevTail === nextHead) {
      return cleanSpeech([...prevWords, ...nextWords.slice(overlap)].join(' '));
    }
  }

  return cleanSpeech(`${prev} ${nxt}`);
}

function finalTextFromMap(finalResults) {
  return Object.keys(finalResults.current)
    .map(Number)
    .sort((a, b) => a - b)
    .map(index => finalResults.current[index])
    .filter(Boolean)
    .join(' ');
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
  const finalResultsRef = useRef({});
  const restartTimerRef = useRef(null);

  const clearSpeechState = useCallback(() => {
    committedRef.current = '';
    sessionFinalRef.current = '';
    finalResultsRef.current = {};
  }, []);

  const stopRecording = useCallback(() => {
    manualStopRef.current = true;
    recordingRef.current = false;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    try {
      recognitionRef.current?.abort?.();
    } catch {}

    try {
      recognitionRef.current?.stop?.();
    } catch {}

    recognitionRef.current = null;
    clearSpeechState();
    onPreview?.('', { recording: false, currentPhrase: '', interim: '', final: '' });
    setRecording(false);
  }, [clearSpeechState, onPreview]);

  useEffect(() => {
    if (!stopSignal) return;
    stopRecording();
  }, [stopSignal, stopRecording]);

  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);

      try {
        recognitionRef.current?.abort?.();
      } catch {}

      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

  const emit = useCallback((fullTranscript, currentPhrase, interim, final) => {
    if (!recordingRef.current || manualStopRef.current) return;

    const cleanFull = cleanSpeech(fullTranscript);
    const cleanPhrase = cleanSpeech(currentPhrase);
    const cleanInterim = cleanSpeech(interim);
    const cleanFinal = cleanSpeech(final);

    onPreview?.(cleanPhrase, {
      recording: true,
      interim: cleanInterim,
      final: cleanFinal,
      currentPhrase: cleanPhrase,
    });

    onTranscript?.(cleanFull, {
      recording: true,
      interim: cleanInterim,
      final: cleanFinal,
      currentPhrase: cleanPhrase,
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

    finalResultsRef.current = {};
    sessionFinalRef.current = '';

    recognition.onresult = (event) => {
      if (!recordingRef.current || manualStopRef.current) return;

      let interimText = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const part = event.results[i]?.[0]?.transcript || '';

        if (event.results[i].isFinal) {
          finalResultsRef.current[i] = cleanSpeech(part);
        } else if (i >= event.resultIndex) {
          interimText += ` ${part}`;
        }
      }

      sessionFinalRef.current = cleanSpeech(finalTextFromMap(finalResultsRef));
      interimText = cleanSpeech(interimText);

      const committedPlusFinal = mergeByOverlap(committedRef.current, sessionFinalRef.current);
      const fullTranscript = interimText
        ? mergeByOverlap(committedPlusFinal, interimText)
        : committedPlusFinal;

      const currentPhrase = interimText;

      emit(fullTranscript, currentPhrase, interimText, sessionFinalRef.current);
    };

    recognition.onend = () => {
      if (!recordingRef.current || manualStopRef.current || disabled) {
        onPreview?.('', { recording: false, currentPhrase: '', interim: '', final: '' });
        setRecording(false);
        return;
      }

      if (sessionFinalRef.current) {
        committedRef.current = mergeByOverlap(committedRef.current, sessionFinalRef.current);
      }

      finalResultsRef.current = {};
      sessionFinalRef.current = '';

      restartTimerRef.current = setTimeout(() => {
        if (!recordingRef.current || manualStopRef.current || disabled) return;

        try {
          recognition.start();
        } catch {}
      }, 250);
    };

    recognition.onerror = () => {
      if (!recordingRef.current || manualStopRef.current || disabled) {
        onPreview?.('', { recording: false, currentPhrase: '', interim: '', final: '' });
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
      clearSpeechState();
      onPreview?.('', { recording: false, currentPhrase: '', interim: '', final: '' });
      setRecording(false);
    }
  }, [clearSpeechState, disabled, emit, onPreview]);

  const startRecording = useCallback(() => {
    if (disabled) return;

    manualStopRef.current = false;
    recordingRef.current = true;
    clearSpeechState();

    startRecognition();
  }, [clearSpeechState, disabled, startRecognition]);

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
