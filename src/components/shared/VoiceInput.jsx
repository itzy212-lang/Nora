import { useCallback, useEffect, useRef, useState } from 'react';

function normaliseSpaces(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function wordKey(word = '') {
  return String(word || '')
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"“”‘’]/g, '')
    .trim();
}

function removeImmediateWordRepeats(text = '') {
  const words = normaliseSpaces(text).split(' ').filter(Boolean);
  const out = [];

  for (const word of words) {
    const prev = out[out.length - 1];
    if (prev && wordKey(prev) === wordKey(word)) continue;
    out.push(word);
  }

  return out.join(' ');
}

function removeRepeatedTail(text = '') {
  let cleaned = removeImmediateWordRepeats(text);

  for (let phraseSize = 2; phraseSize <= 12; phraseSize++) {
    const words = cleaned.split(' ').filter(Boolean);
    if (words.length < phraseSize * 2) continue;

    const out = [];
    let i = 0;

    while (i < words.length) {
      const phrase = words.slice(i, i + phraseSize).map(wordKey).join(' ');
      const nextPhrase = words.slice(i + phraseSize, i + phraseSize * 2).map(wordKey).join(' ');

      if (phrase && phrase === nextPhrase) {
        out.push(...words.slice(i, i + phraseSize));
        i += phraseSize * 2;
      } else {
        out.push(words[i]);
        i += 1;
      }
    }

    cleaned = out.join(' ');
  }

  return cleaned;
}

function mergeSpeechResult(previous = '', next = '') {
  const prev = normaliseSpaces(previous);
  const rawNext = normaliseSpaces(next);

  if (!rawNext) return prev;
  if (!prev) return removeRepeatedTail(rawNext);

  const cleanedNext = removeRepeatedTail(rawNext);

  if (cleanedNext.toLowerCase().startsWith(prev.toLowerCase())) {
    return removeRepeatedTail(cleanedNext);
  }

  if (prev.toLowerCase().includes(cleanedNext.toLowerCase())) {
    return removeRepeatedTail(prev);
  }

  const prevWords = prev.split(' ').filter(Boolean);
  const nextWords = cleanedNext.split(' ').filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, nextWords.length, 20);

  for (let overlap = maxOverlap; overlap >= 1; overlap--) {
    const prevTail = prevWords.slice(-overlap).map(wordKey).join(' ');
    const nextHead = nextWords.slice(0, overlap).map(wordKey).join(' ');

    if (prevTail && prevTail === nextHead) {
      return removeRepeatedTail([...prevWords, ...nextWords.slice(overlap)].join(' '));
    }
  }

  return removeRepeatedTail(`${prev} ${cleanedNext}`);
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
  const committedTranscriptRef = useRef('');
  const lastRawTranscriptRef = useRef('');
  const restartTimerRef = useRef(null);

  const stopRecording = useCallback(() => {
    manualStopRef.current = true;
    recordingRef.current = false;
    committedTranscriptRef.current = '';
    lastRawTranscriptRef.current = '';

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
      let finalPart = '';
      let interimPart = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript || '';

        if (event.results[i].isFinal) {
          finalPart += ` ${transcript}`;
        } else {
          interimPart += ` ${transcript}`;
        }
      }

      const rawChunk = normaliseSpaces(`${finalPart} ${interimPart}`);
      if (!rawChunk) return;

      if (rawChunk === lastRawTranscriptRef.current && !finalPart) return;
      lastRawTranscriptRef.current = rawChunk;

      let nextTranscript;

      if (finalPart.trim()) {
        nextTranscript = mergeSpeechResult(committedTranscriptRef.current, finalPart);
        committedTranscriptRef.current = nextTranscript;
      } else {
        nextTranscript = mergeSpeechResult(committedTranscriptRef.current, interimPart);
      }

      nextTranscript = removeRepeatedTail(nextTranscript);

      const currentPhrase = removeRepeatedTail(interimPart || finalPart || rawChunk);
      const fullTranscript = removeRepeatedTail(nextTranscript);

      onPreview?.(currentPhrase, {
        recording: true,
        interim: removeRepeatedTail(interimPart),
        final: committedTranscriptRef.current,
        currentPhrase,
      });

      onTranscript?.(fullTranscript, {
        recording: true,
        interim: removeRepeatedTail(interimPart),
        final: committedTranscriptRef.current,
        currentPhrase,
      });
    };

    recognition.onend = () => {
      if (!recordingRef.current || manualStopRef.current || disabled) {
        setRecording(false);
        return;
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
  }, [disabled, onPreview, onTranscript]);

  const startRecording = useCallback(() => {
    if (disabled) return;

    manualStopRef.current = false;
    recordingRef.current = true;
    committedTranscriptRef.current = '';
    lastRawTranscriptRef.current = '';

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
        <path d="M12 3.5a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3z" />
        <path d="M19 11.5v.5a7 7 0 0 1-14 0v-.5" />
        <path d="M12 19v3" />
        <path d="M8.5 22h7" />
      </svg>
    </button>
  );
}
