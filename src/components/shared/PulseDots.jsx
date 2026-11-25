// Three softly pulsing dots, the same mark as the one beside the "nora" logo.
export default function PulseDots({ color = '#fff', size = 4 }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(2, size - 1) }}>
      <style>{`@keyframes noraBtnPulse{0%,55%,100%{opacity:.35;transform:translateY(0)}28%{opacity:1;transform:translateY(-2px)}}
.nora-btn-dot{animation:noraBtnPulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.nora-btn-dot{animation:none;opacity:.9}}`}</style>
      {[0, 0.22, 0.44].map((d) => (
        <span key={d} className="nora-btn-dot" style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}
