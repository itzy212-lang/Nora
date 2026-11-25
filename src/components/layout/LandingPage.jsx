// Front page for visitors who are not signed in. Anyone who has signed in or
// created an account on this device goes straight to the sign-in screen instead
// (see App.jsx), so registered users do not see this page again.

const FEATURES = [
  {
    icon: '🧠',
    title: 'Nora knows everything about your project',
    text: 'She keeps every email, note and conversation against the right project. If you are in a dispute with a surveyor or an adjoining owner, Nora can tell you what was said and when, then help you draft your reply.',
  },
  {
    icon: '⏰',
    title: 'She keeps you on track',
    text: 'Nora sets reminders, including notice reminders, and follows up with surveyors for you. She tells you when to serve a Section 10 notice and when you need a 10(4)(b), and she generates them for you.',
  },
  {
    icon: '📚',
    title: 'Knows the Act inside out',
    text: 'Nora knows the Party Wall etc. Act 1996 inside out and is up to date with case law, so what she tells you rests on the Act, not guesswork.',
  },
  {
    icon: '📋',
    title: 'Shave hours off your schedules of condition',
    text: 'Dictate to Nora as you walk through the property. By the time you reach your car she has transcribed it and drafted your schedule of condition as a PDF, ready to send to the adjoining owner’s surveyor, straight from your phone.',
  },
  {
    icon: '⚖️',
    title: 'Draft custom awards within minutes',
    text: 'Nora adds the notice, building owner and adjoining owner details straight into the award, and you download the Word document to review.',
  },
  {
    icon: '📄',
    title: 'Generate notices in seconds',
    text: 'Create notices straight from your mobile. Nora helps you append drawings and supporting documents, and compiles everything into one PDF, ready to print or email immediately.',
  },
  {
    icon: '📬',
    title: 'All your emails in one place',
    text: 'Connect Outlook or Gmail, and OneDrive or Google Drive. Your mail, your project folders and Nora all work together.',
  },
];

const ASK_NORA = [
  'Can’t remember which third surveyor was nominated? Ask Nora.',
  'Can’t remember whether you have spoken to an adjoining owner’s surveyor? Ask Nora.',
  'On the go and need to answer an email? Ask Nora.',
];

const wrap = { maxWidth: 960, margin: '0 auto', padding: '0 20px' };

export default function LandingPage({ onSignIn, onSignUp }) {
  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px' }}>
        <div style={{ fontFamily: "'Bahnschrift Light', 'DIN Alternate', sans-serif", fontSize: 28, fontWeight: 300, letterSpacing: '-0.5px' }}>
          nora
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onSignIn}>Sign in</button>
      </header>

      <section style={{ ...wrap, textAlign: 'center', padding: '56px 20px 40px' }}>
        <div style={{ fontSize: 12, letterSpacing: '2px', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 14 }}>
          Party wall specialist assistant
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5.6vw, 44px)', lineHeight: 1.14, fontWeight: 600, letterSpacing: '-1px', margin: '0 auto 20px', maxWidth: 760 }}>
          Nora is your reliable 24‑hour, 7‑day‑a‑week party wall specialist assistant.
        </h1>
        <p style={{ fontSize: 'clamp(15px, 2.4vw, 18px)', color: 'var(--text2)', lineHeight: 1.55, maxWidth: 680, margin: '0 auto 18px' }}>
          She remembers every communication, note and piece of correspondence, kept specifically to each of your projects, and she automatically links your emails to the right project.
        </p>
        <div style={{ maxWidth: 560, margin: '0 auto 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ASK_NORA.map((t) => (
            <div key={t} style={{ fontSize: 'clamp(14px, 2.2vw, 16px)', color: 'var(--text)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 14px', lineHeight: 1.45 }}>{t}</div>
          ))}
        </div>
        <p style={{ fontSize: 'clamp(15px, 2.4vw, 18px)', color: 'var(--text2)', lineHeight: 1.55, maxWidth: 680, margin: '0 auto 28px' }}>
          Dictate your email straight to your personal assistant and she drafts it, ready for you to send.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ padding: '12px 26px', fontSize: 15 }} onClick={onSignUp}>Get started</button>
          <button className="btn btn-ghost" style={{ padding: '12px 26px', fontSize: 15 }} onClick={onSignIn}>Sign in</button>
        </div>
      </section>

      <section style={{ ...wrap, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, padding: '20px 20px 40px' }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--rxl)', padding: 22 }}>
            <div style={{ fontSize: 26, marginBottom: 10 }}>{f.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{f.title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.55 }}>{f.text}</div>
          </div>
        ))}
      </section>

      <section style={{ ...wrap, textAlign: 'center', padding: '10px 20px 56px' }}>
        <button className="btn btn-primary" style={{ padding: '12px 26px', fontSize: 15 }} onClick={onSignUp}>Create your account</button>
      </section>

      <footer style={{ ...wrap, textAlign: 'center', padding: '0 20px 36px', fontSize: 12, color: 'var(--text3)' }}>
        Nora · Square One Consulting
      </footer>
    </div>
  );
}
