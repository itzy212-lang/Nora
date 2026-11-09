import { useCallback, useEffect, useRef, useState } from 'react';
import { logDiag } from '../../utils/draftUtils';
import { transcribeAudio } from '../../utils/transcribeAudio';

/**
 * VoiceInput — the mic button. Records audio and sends it to Whisper.
 *
 * It no longer uses the browser's built-in speech engine to produce text.
 * That engine re-sends overlapping phrases while you talk, which pasted the
 * same sentence into the message many times, and it restarted whenever you
 * paused. Recording audio has neither problem, and Whisper knows party wall
 * vocabulary.
 *
 * Props:
 *   onTranscript(text, meta)  final text, once, after transcription
 *   onStatus(status, info)    'recording' | 'transcribing' | 'error' | 'idle'
 *                             info.message = progress or error text
 *   onPreview                 legacy; only told when recording starts/stops
 *   disabled, stopSignal      stopSignal: increment to finish recording
 */

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';

  // iOS Safari only supports mp4/aac — check for that first there
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const candidates = isIOS
    ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];

  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

// 24kbps is clear enough for Whisper and keeps about 25 minutes of speech
// inside a single upload; anything longer is split automatically.
const AUDIO_BITS_PER_SECOND = 24000;
const MIN_AUDIO_BYTES = 1500;

export default function VoiceInput({
  onTranscript,
  onStatus,
  onPreview,
  disabled = false,
  stopSignal = 0,
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  // Always call the latest callbacks without re-creating the handlers.
  const callbacksRef = useRef({});
  callbacksRef.current = { onTranscript, onStatus, onPreview };

  const report = useCallback((status, info = {}) => {
    callbacksRef.current.onStatus?.(status, info);
  }, []);

  const stopTracks = useCallback(() => {
    try {
      streamRef.current?.getTracks?.().forEach(track => track.stop());
    } catch {}
    streamRef.current = null;
  }, []);

  const finish = useCallback(async (blob) => {
    if (cancelledRef.current || !mountedRef.current) return;

    if (!blob || blob.size < MIN_AUDIO_BYTES) {
      report('error', { message: "Didn't catch anything. Tap the mic and try again." });
      return;
    }

    setTranscribing(true);
    report('transcribing', { message: 'Transcribing…' });

    try {
      const text = await transcribeAudio(blob, {
        onProgress: (message) => { if (mountedRef.current) report('transcribing', { message }); },
      });
      if (cancelledRef.current || !mountedRef.current) return;

      if (!text) {
        report('error', { message: 'No speech detected. Tap the mic and try again.' });
        return;
      }

      report('idle');
      callbacksRef.current.onTranscript?.(text, { recording: false, currentPhrase: '', interim: '', final: text });
    } catch (error) {
      console.error('[VoiceInput] transcription failed:', error);
      if (mountedRef.current) {
        report('error', { message: "Couldn't transcribe that recording. Please check your connection and try again." });
      }
    } finally {
      if (mountedRef.current) setTranscribing(false);
    }
  }, [report]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    } else {
      stopTracks();
    }
    setRecording(false);
    callbacksRef.current.onPreview?.('', { recording: false, currentPhrase: '', interim: '', final: '' });
  }, [stopTracks]);

  const startRecording = useCallback(async () => {
    if (disabled || transcribing || startingRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      report('error', { message: 'Audio recording is not supported in this browser.' });
      return;
    }

    startingRef.current = true;
    cancelledRef.current = false;

    // Warm up the transcribe function so the first request is not slow
    fetch('/api/transcribe', { method: 'GET' }).catch(() => {});

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const mimeType = getSupportedAudioMimeType();
      const options = { audioBitsPerSecond: AUDIO_BITS_PER_SECOND };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        recorderRef.current = null;
        cancelledRef.current = true;
        stopTracks();
        if (mountedRef.current) {
          setRecording(false);
          report('error', { message: 'The recording stopped unexpectedly. Please try again.' });
        }
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        stopTracks();
        finish(blob);
      };

      // A slice every second so a long dictation is never held in one piece
      recorder.start(1000);
      setRecording(true);
      report('recording');
      callbacksRef.current.onPreview?.('', { recording: true, currentPhrase: '', interim: '', final: '' });
    } catch (error) {
      console.error('[VoiceInput] could not start recording:', error);
      stopTracks();
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      report('error', {
        message: denied
          ? 'The microphone is blocked. Allow it in your browser settings, then try again.'
          : 'Could not start the microphone. Please try again.',
      });
    } finally {
      startingRef.current = false;
    }
  }, [disabled, finish, report, stopTracks, transcribing]);

  const toggleRecording = useCallback(() => {
    if (disabled || transcribing) return;

    logDiag('mic_tapped', { wasRecording: recording, engine: 'whisper' });

    if (recording) {
      stopRecording();
      return;
    }

    startRecording();
  }, [disabled, recording, startRecording, stopRecording, transcribing]);

  // Finish when the surface asks (Enter while recording, etc.)
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);
  const recordingRef = useRef(recording);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  useEffect(() => {
    if (!stopSignal) return;
    if (recordingRef.current) stopRecordingRef.current();
  }, [stopSignal]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Leaving the screen discards the recording rather than transcribing it
      mountedRef.current = false;
      cancelledRef.current = true;
      try {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch {}
      recorderRef.current = null;
      stopTracks();
    };
  }, [stopTracks]);

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
