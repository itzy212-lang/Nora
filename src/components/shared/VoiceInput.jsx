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
  const resultsRef = useRef({});
  const lastTranscriptRef = useRef('');

  const resetSpeechState = useCallback(() => {
    resultsRef.current = {};
    lastTranscriptRef.current = '';
  }, []);

  const stopRecording = useCallback(() => {
    manualStopRef.current = true;
    recordingRef.current = false;

    try {
      recognitionRef.current?.abort?.();
    } catch {}

    try {
      recognitionRef.current?.stop?.();
    } catch {}

    recognitionRef.current = null;
    resetSpeechState();

    onPreview?.('', {
      recording: false,
      currentPhrase: '',
      interim: '',
      final: '',
    });

    setRecording(false);
  }, [onPreview, resetSpeechState]);

  const startRecording = useCallback(() => {
    if (disabled) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please use Chrome.');
      return;
    }

    manualStopRef.current = false;
    recordingRef.current = true;
    resetSpeechState();

    const recognition = new SpeechRecognition();

    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (manualStopRef.current) return;
      setRecording(true);
    };

    recognition.onresult = (event) => {
      if (!recordingRef.current || manualStopRef.current) return;

      let latestInterim = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const spoken = cleanText(event.results[i]?.[0]?.transcript || '');

        if (!spoken) continue;

        // Critical rule:
        // Replace each recognition result by its index.
        // Never append interim/final chunks manually.
        resultsRef.current[i] = spoken;

        if (!event.results[i].isFinal && i >= event.resultIndex) {
          latestInterim = spoken;
        }
      }

      const transcript = removeImmediateDuplicateWords(orderedResultText(resultsRef.current));

      if (transcript === lastTranscriptRef.current && !latestInterim) {
        return;
      }

      lastTranscriptRef.current = transcript;

      onPreview?.(cleanText(latestInterim), {
        recording: true,
        currentPhrase: cleanText(latestInterim),
        interim: cleanText(latestInterim),
        final: transcript,
      });

      onTranscript?.(transcript, {
        recording: true,
        currentPhrase: cleanText(latestInterim),
        interim: cleanText(latestInterim),
        final: transcript,
      });
    };

    recognition.onend = () => {
      if (manualStopRef.current || disabled) {
        setRecording(false);
        return;
      }

      // Browser may end naturally. Mark as not recording rather than stitching/restarting,
      // because stitching was the source of duplicate phrases.
      recordingRef.current = false;
      setRecording(false);

      onPreview?.('', {
        recording: false,
        currentPhrase: '',
        interim: '',
        final: lastTranscriptRef.current,
      });
    };

    recognition.onerror = () => {
      recordingRef.current = false;
      setRecording(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recordingRef.current = false;
      setRecording(false);
    }
  }, [disabled, onPreview, onTranscript, resetSpeechState]);

  const toggleRecording = useCallback(() => {
    if (disabled) return;

    if (recordingRef.current || recording) {
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
      try {
        recognitionRef.current?.abort?.();
      } catch {}

      try {
        recognitionRef.current?.stop?.();
      } catch {}
    };
  }, []);

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
