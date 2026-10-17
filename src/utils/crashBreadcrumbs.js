// Added 2026-10-17. Instrumentation, NOT a fix, for the mobile "Aw, Snap!"
// tab crash. A crashed tab can't report itself, so this leaves a note on the
// device every few seconds (what the app was doing, memory, visible or not) and,
// on the NEXT launch, reports it if the previous session never ended normally
// (no page-hide / backgrounding seen, i.e. it died while on screen).
// Goes to the existing /api/client-diagnostic log as 'previous_session_crashed'.
import { logDiag } from './draftUtils';

const KEY = 'nora_session_note';
const trail = [];

export function noteAction(label) {
  trail.push(`${new Date().toISOString().slice(11, 19)} ${label}`);
  if (trail.length > 12) trail.shift();
}

function readNote() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function writeNote(state) {
  try {
    const mem = performance?.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    localStorage.setItem(KEY, JSON.stringify({
      state, at: new Date().toISOString(), heapMB: mem, path: location.pathname + location.hash,
      trail, nodes: document.getElementsByTagName('*').length, iframes: document.getElementsByTagName('iframe').length,
      imgs: document.getElementsByTagName('img').length,
    }));
  } catch { /* storage unavailable - nothing to do */ }
}

export function initCrashBreadcrumbs() {
  try {
    const prev = readNote();
    if (prev && prev.state === 'visible') logDiag('previous_session_crashed', { prev });
    writeNote(document.visibilityState === 'visible' ? 'visible' : 'hidden');
    setInterval(() => writeNote(document.visibilityState === 'visible' ? 'visible' : 'hidden'), 5000);
    document.addEventListener('visibilitychange', () => writeNote(document.visibilityState === 'visible' ? 'visible' : 'hidden'));
    window.addEventListener('pagehide', () => writeNote('closed'));
    window.addEventListener('click', (e) => {
      const el = e.target?.closest?.('button,a,[role=button]');
      if (el) noteAction('tap: ' + String(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40));
    }, true);
  } catch { /* never let diagnostics break the app */ }
}
