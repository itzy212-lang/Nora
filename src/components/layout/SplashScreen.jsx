import { useEffect, useState } from 'react';

export default function SplashScreen({ onDone }) {
  // Fixed 2026-08-14 (revised): the icon that drives the native
  // OS splash now shows 'nora' + dots again, redrawn to actually
  // match this component's real layout (not the old, outdated
  // design that caused the original mismatch). With the two now
  // genuinely matching, the earlier 'flash to black first' delay
  // would only get in the way — it would interrupt two consistent
  // things with an unnecessary black gap in between, rather than
  // hiding a mismatch that no longer exists. Content shows
  // immediately again.
  const [dot1, setDot1] = useState(0.55);
  const [dot2, setDot2] = useState(0.3);
  const [dot3, setDot3] = useState(0.15);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Animate dots manually — guaranteed to work on first render
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      // Each dot pulses upward in sequence: dot1 first, dot2 second, dot3 third
      const wave = (delayFrames) => {
        const f = Math.max(0, frame - delayFrames);
        const phase = (f % 14) / 14;
        return phase < 0.28 ? 0.15 + (0.85 * phase / 0.28)
          : phase < 0.55 ? 1 - (0.85 * (phase - 0.28) / 0.27)
          : 0.15;
      };
      setDot1(wave(0));
      setDot2(wave(3));  // 3 frames later = ~300ms after dot1
      setDot3(wave(6));  // 6 frames later = ~600ms after dot1
    }, 100);

    // Minimum 2.5s display time, then fade out
    const fadeTimer = setTimeout(() => setFadeOut(true), 2500);
    const doneTimer = setTimeout(() => onDone?.(), 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: fadeOut ? 0 : 1,
      transition: 'opacity 0.5s ease',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{
            fontFamily: "'Bahnschrift Light', 'DIN Alternate', Arial, sans-serif",
            fontSize: 64, fontWeight: 300, letterSpacing: '-1px',
            lineHeight: 1, color: 'white',
          }}>nora</span>
          <span style={{ display: 'flex', alignItems: 'flex-end', gap: 7, paddingLeft: 9, paddingBottom: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'white', display: 'inline-block', opacity: dot1, transform: `translateY(${-(dot1 - 0.15) * 6}px)` }}/>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'white', display: 'inline-block', opacity: dot2, transform: `translateY(${-(dot2 - 0.15) * 6}px)` }}/>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'white', display: 'inline-block', opacity: dot3, transform: `translateY(${-(dot3 - 0.15) * 6}px)` }}/>
          </span>
        </div>
        <div style={{
          fontSize: 12, color: 'rgba(255,255,255,0.35)',
          letterSpacing: '3px', marginTop: 10,
          fontFamily: "'Bahnschrift Light', 'DIN Alternate', Arial, sans-serif",
          fontWeight: 300, textAlign: 'center',
        }}>
          virtual assistant
        </div>
      </div>
    </div>
  );
}
