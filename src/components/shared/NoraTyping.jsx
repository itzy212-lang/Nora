import PulseDots from './PulseDots';

// Shown while Nora is working: her name above a bubble with three pulsing dots.
export default function NoraTyping() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '4px 0' }} role="status" aria-label="Nora is working">
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text3)' }}>Nora</span>
      <div style={{ padding: '11px 15px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 16, borderBottomLeftRadius: 4 }}>
        <PulseDots color="#7c5cf0" size={6} />
      </div>
    </div>
  );
}
