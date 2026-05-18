import { useState, useRef, useCallback } from 'react';

export default function VoiceInput({ onTranscript, disabled }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const toggle = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Try Chrome.');
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'en-GB';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript || '';
      onTranscript(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening, onTranscript]);

  return (
    <button
      type="button"
      className={`voice-btn${listening ? ' listening' : ''}`}
      onClick={toggle}
      disabled={disabled}
      title={listening ? 'Stop recording' : 'Voice input'}
    >
      {listening ? '⏹' : '🎤'}
    </button>
  );
}
