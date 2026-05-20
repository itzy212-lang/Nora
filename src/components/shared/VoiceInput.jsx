import { useCallback, useEffect, useRef, useState } from 'react';

function collapseRepeatedWords(text = '') {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const out = [];

  for (const word of words) {
    const previous = out[out.length - 1] || '';
    if (previous.toLowerCase() === word.toLowerCase()) continue;
    out.push(word);
  }

  return out.join(' ');
}

function collapseRepeatedPhrases(text = '') {
  let cleaned = collapseRepeatedWords(text);

  // Stops mobile speech recognition repeatedly appending the same short phrase.
  for (let size = 2; size <= 8; size++) {
    const words = cleaned.split(/\s+/).filter(Boolean);
    const out = [];

    for (let i = 0; i < words.length; i++) {
      const current = words.slice(i, i + size).join(' ').toLowerCase();
      const next = words.slice(i + size, i + size * 2).join(' ').toLowerCase();

      if (current && current === next) {
        out.push(...words.slice(i, i + size));
        i += size;
      } else {
        out.push(words[i]);
      }
    }

    cleaned = out.join(' ');
  }

  return cleaned;
}

export default function VoiceInput({
  onTranscript,
  disabled = false,
  stopSignal = 0,
}) {
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef(null);
  const listeningRef = useRef(false);
  const manualStopRef = useRef(false);
  const finalTranscriptRef = useRef('');
  const lastEmittedRef = useRef('');

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    listeningRef.current = false;
    finalTranscriptRef.current = '';
    lastEmittedRef.current = '';

    try {
      recognitionRef.current?.stop();
    } catch {}

    setListening(false);
  }, []);

  useEffect(() => {
    if (!stopSignal) return;
    stopListening();
  }, [stopSignal, stopListening]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  const startListening = useCallback(() => {
    if (disabled) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Try Chrome.');
      return;
    }

    manualStopRef.current = false;
    listeningRef.current = true;
    finalTranscriptRef.current = '';
    lastEmittedRef.current = '';

    const recognition = new SpeechRecognition();

    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = finalTranscriptRef.current;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i]?.[0]?.transcript || '';

        if (event.results[i].isFinal) {
          finalTranscript += `${transcript} `;
        } else {
          interimTranscript += transcript;
        }
      }

      finalTranscriptRef.current = finalTranscript;

      const combined = collapseRepeatedPhrases(`${finalTranscript}${interimTranscript}`.trim());

      if (combined && combined !== lastEmittedRef.current) {
        lastEmittedRef.current = combined;

        onTranscript?.(combined, {
          listening: true,
          interim: interimTranscript,
          final: collapseRepeatedPhrases(finalTranscript.trim()),
        });
      }
    };

    recognition.onend = () => {
      if (listeningRef.current && !manualStopRef.current && !disabled) {
        try {
          recognition.start();
          return;
        } catch {}
      }

      listeningRef.current = false;
      setListening(false);
    };

    recognition.onerror = () => {
      if (listeningRef.current && !manualStopRef.current && !disabled) {
        try {
          recognition.stop();
        } catch {}
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setListening(true);
    } catch {
      listeningRef.current = false;
      setListening(false);
    }
  }, [disabled, onTranscript]);

  const toggle = useCallback(() => {
    if (disabled) return;

    if (listeningRef.current || listening) {
      stopListening();
      return;
    }

    startListening();
  }, [disabled, listening, startListening, stopListening]);

  return (
    <button
      type="button"
      className={`voice-btn${listening ? ' listening' : ''}`}
      onClick={toggle}
      disabled={disabled}
      title={listening ? 'Stop recording' : 'Voice input'}
      aria-label={listening ? 'Stop recording' : 'Voice input'}
      style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: listening ? '#ef4444' : '#9ca3af',
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
        <path d="M12 3.5a3 3 0 0 0-3 3v5.5a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3z" />
        <path d="M19 11.5v.5a7 7 0 0 1-14 0v-.5" />
        <path d="M12 19v3" />
        <path d="M8.5 22h7" />
      </svg>
    </button>
  );
}
