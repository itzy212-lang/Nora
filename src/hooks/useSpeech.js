/**
 * useSpeech.js — shared Text-to-Speech hook for Nora
 * Uses the browser's built-in Web Speech API (speechSynthesis).
 * No external service, no cost.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const AUTO_PLAY_KEY = 'nora_tts_autoplay';

// Shared speaking state across all hook instances
let globalSpeaking = false;
const listeners = new Set();
function notifyListeners() {
  listeners.forEach(fn => fn(globalSpeaking));
}

// Load voices — they load async in Chrome, synchronously in Firefox/Safari
function getVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

function pickVoice() {
  const voices = getVoices();
  if (!voices.length) return null;
  return (
    voices.find(v => v.lang === 'en-GB' && /daniel|google uk/i.test(v.name)) ||
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang.startsWith('en-')) ||
    voices[0]
  );
}

// Pre-warm voices on module load so they are ready when speak() is called
if (typeof window !== 'undefined' && window.speechSynthesis) {
  // Chrome loads voices async — listen for the event
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => getVoices();
  }
  // Firefox / Safari load them synchronously — trigger load
  getVoices();
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [autoPlay, setAutoPlayState] = useState(() => {
    try { return localStorage.getItem(AUTO_PLAY_KEY) === 'true'; }
    catch { return false; }
  });

  const utteranceRef = useRef(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Subscribe to global speaking state
  useEffect(() => {
    const handler = (val) => { if (isMounted.current) setSpeaking(val); };
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    globalSpeaking = false;
    notifyListeners();
  }, []);

  const speak = useCallback((text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (!text || !String(text).trim()) return;

    window.speechSynthesis.cancel();

    const clean = String(text)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/Kind regards,?\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!clean) return;

    // Small delay so Chrome's autoplay policy doesn't block it
    // and voices have time to load if not already ready
    const doSpeak = () => {
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'en-GB';
      utter.rate = 1.05;
      utter.pitch = 1.0;
      utter.volume = 1.0;

      const voice = pickVoice();
      if (voice) utter.voice = voice;

      utter.onstart = () => { globalSpeaking = true; notifyListeners(); };
      utter.onend   = () => { globalSpeaking = false; notifyListeners(); };
      utter.onerror = (e) => {
        // 'interrupted' is normal when stop() is called — don't treat as error
        if (e.error !== 'interrupted') {
          console.warn('[useSpeech] error:', e.error);
        }
        globalSpeaking = false;
        notifyListeners();
      };

      utteranceRef.current = utter;
      window.speechSynthesis.speak(utter);
    };

    // If voices aren't loaded yet, wait for them
    if (!getVoices().length) {
      const onVoices = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
      window.speechSynthesis.onvoiceschanged = onVoices;
      // Fallback if event never fires
      setTimeout(doSpeak, 300);
    } else {
      doSpeak();
    }
  }, []);

  const setAutoPlay = useCallback((val) => {
    setAutoPlayState(val);
    try { localStorage.setItem(AUTO_PLAY_KEY, val ? 'true' : 'false'); }
    catch {}
    if (!val) stop();
  }, [stop]);

  return { speak, stop, speaking, autoPlay, setAutoPlay };
}

export function getAutoPlay() {
  try { return localStorage.getItem(AUTO_PLAY_KEY) === 'true'; }
  catch { return false; }
}

export function setAutoPlayGlobal(val) {
  try { localStorage.setItem(AUTO_PLAY_KEY, val ? 'true' : 'false'); }
  catch {}
  if (!val && typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
