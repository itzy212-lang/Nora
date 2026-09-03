// src/hooks/useLongPressCopy.js
// Added 2026-09-03, on request: the long-press-to-copy behaviour on a
// user's own message bubble had drifted — Main Chat had it (though
// too sensitive, fixed separately today), Project Chat never had it
// at all, and native text selection had crept in where it shouldn't
// be. Reported directly as exactly the kind of drift the shared
// component work months ago was meant to prevent. This is the one
// place this behaviour is now defined; every chat surface's own
// bubble calls this instead of implementing its own copy of it.
import { useRef, useState } from 'react';

const HOLD_MS = 2000;

// Fixed 2026-08-06 (kept from the original Main Chat implementation):
// the clipboard write must happen synchronously within a direct
// user-gesture event handler. Deferring it via setTimeout loses the
// "recent user activation" that navigator.clipboard.writeText and
// the execCommand('copy') fallback both require on mobile browsers —
// causing a silent failure with no error and nothing copied.
async function performCopy(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Same styles every bubble that supports this gesture should apply —
// disables native text selection, since the gesture is "hold to copy
// the whole message", not selecting individual words.
const longPressBubbleStyle = { userSelect: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' };

// Plain, non-hook version for call sites that render bubbles inside a
// loop (e.g. a .map() callback), where a React hook cannot be called
// per-iteration. Wire directly onto the bubble element's
// onTouchStart/onMouseDown and onTouchEnd/onMouseUp(/onMouseLeave).
function createLongPressCopyHandlers(getText, onCopied) {
  let start = null;
  return {
    onPressStart: () => { start = Date.now(); },
    onPressEnd: async () => {
      const s = start;
      start = null;
      if (!s || Date.now() - s < HOLD_MS) return;
      const text = typeof getText === 'function' ? getText() : getText;
      const ok = await performCopy(text);
      if (ok) onCopied?.();
    },
  };
}

export function useLongPressCopy(getText) {
  const startTime = useRef(null);
  const [copied, setCopied] = useState(false);

  const onPressStart = () => {
    startTime.current = Date.now();
  };

  const onPressEnd = async () => {
    const start = startTime.current;
    startTime.current = null;
    if (!start || Date.now() - start < HOLD_MS) return;
    const text = typeof getText === 'function' ? getText() : getText;
    const ok = await performCopy(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  // Spread directly onto the bubble element. userSelect: 'none' (and
  // the Webkit equivalents) intentionally disables native text
  // selection on the bubble — the whole point of this gesture is
  // "hold to copy the whole message", not selecting individual words,
  // which is the specific regression reported.
  const handlers = {
    onMouseDown: onPressStart,
    onMouseUp: onPressEnd,
    onMouseLeave: onPressEnd,
    onTouchStart: onPressStart,
    onTouchEnd: onPressEnd,
    style: longPressBubbleStyle,
  };

  return { handlers, copied };
}

export { createLongPressCopyHandlers, performCopy, longPressBubbleStyle, HOLD_MS };

// Added 2026-09-03, on request: generic version of the same
// long-press mechanism above, for any action (not just copying
// text) — e.g. opening an address in the phone's maps app. Same
// timing and gesture, different action performed on release.
export function createLongPressActionHandlers(action) {
  let start = null;
  return {
    onPressStart: () => { start = Date.now(); },
    onPressEnd: () => {
      const s = start;
      start = null;
      if (!s || Date.now() - s < HOLD_MS) return;
      action?.();
    },
  };
}
