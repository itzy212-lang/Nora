import { useEffect, useState } from 'react';

export default function SplashScreen({ onDone }) {
  const [dot1, setDot1] = useState(0.15);
  const [dot2, setDot2] = useState(0.15);
  const [dot3, setDot3] = useState(0.15);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Animate dots manually — guaranteed to work on first render
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      const t = (frame % 14) / 14; // 0..1 over 14 frames (~1.4s at 100ms)
      const wave = (offset) => {
        const phase = (t + offset) % 1;
        return phase < 0.28 ? 0.15 + (0.85 * phase / 0.28)
          : phase < 0.55 ? 1 - (0.85 * (phase - 0.28) / 0.27)
          : 0.15;
      };
      setDot1(wave(0));
      setDot2(wave(0.22));
      setDot3(wave(0.44));
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
        fontWeight: 300,
      }}>
        virtual assistant
      </div>
    </div>
  );
}
