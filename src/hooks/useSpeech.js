/**
 * useSpeech.js — shared Text-to-Speech hook for Nora
 *
 * Uses the browser's built-in Web Speech API (speechSynthesis).
 * No external service, no cost.
 *
 * Features:
 * - speak(text) — reads text aloud
 * - stop() — stops playback
 * - speaking — whether currently playing
 * - autoPlay / setAutoPlay — global toggle (persisted to localStorage)
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const AUTO_PLAY_KEY = 'nora_tts_autoplay';

// Shared state across all hook instances via module-level ref
let globalSpeaking = false;
const listeners = new Set();
function notifyListeners() {
  listeners.forEach(fn => fn(globalSpeaking));
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [autoPlay, setAutoPlayState] = useState(() => {
    try { return localStorage.getItem(AUTO_PLAY_KEY) === 'true'; }
    catch { return false; }
  });

  const utteranceRef = useRef(null);

  // Subscribe to global speaking state
  useEffect(() => {
    const handler = (val) => setSpeaking(val);
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
    if (!text || !text.trim()) return;

    // Stop any current speech
    window.speechSynthesis.cancel();

    // Strip HTML tags and clean up text
    const clean = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/Kind regards,?\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return;

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'en-GB';
    utter.rate = 1.0;
    utter.pitch = 1.0;

    // Prefer a UK English voice if available
    const voices = window.speechSynthesis.getVoices();
    const ukVoice = voices.find(v =>
      v.lang === 'en-GB' && (v.name.includes('Daniel') || v.name.includes('Google') || v.name.includes('UK'))
    ) || voices.find(v => v.lang === 'en-GB') || voices.find(v => v.lang.startsWith('en'));
    if (ukVoice) utter.voice = ukVoice;

    utter.onstart = () => { globalSpeaking = true; notifyListeners(); };
    utter.onend = () => { globalSpeaking = false; notifyListeners(); };
    utter.onerror = () => { globalSpeaking = false; notifyListeners(); };

    utteranceRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, []);

  const setAutoPlay = useCallback((val) => {
    setAutoPlayState(val);
    try { localStorage.setItem(AUTO_PLAY_KEY, val ? 'true' : 'false'); }
    catch {}
    if (!val) stop();
  }, [stop]);

  const toggle = useCallback(() => {
    if (speaking) { stop(); }
    else { /* caller provides text */ }
  }, [speaking, stop]);

  return { speak, stop, speaking, autoPlay, setAutoPlay, toggle };
}

// Singleton for TopBar toggle — reads/writes the persisted preference
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
