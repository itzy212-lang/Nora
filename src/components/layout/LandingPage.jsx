// Front page for visitors who are not signed in. Anyone who has signed in or
// created an account on this device goes straight to the sign-in screen instead
// (see App.jsx), so registered users do not see this page again.

const FEATURES = [
  {
    icon: '🗂️',
    title: 'Manages your projects',
    text: 'Every party wall job in one place: building owners, adjoining owners, notices, responses, letters of appointment and awards, with the emails kept alongside.',
  },
  {
    icon: '🧾',
    title: 'Invoices',
    text: 'Raise and track invoices against each project, and chase the ones that are overdue without leaving the job.',
  },
  {
    icon: '🎙️',
    title: 'Dictate your emails',
    text: 'Say what you want to say and Nora writes the email, in your voice, ready for you to check and send.',
  },
  {
    icon: '📋',
    title: 'Schedules of condition, done on site',
    text: 'Dictate the schedule of condition room by room while you are standing in the property, and send it before you reach your car. It saves around 3 hours on every schedule.',
  },
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
          Specialist assistant for party wall surveyors
        </div>
        <h1 style={{ fontSize: 'clamp(30px, 6vw, 48px)', lineHeight: 1.12, fontWeight: 600, letterSpacing: '-1px', margin: '0 auto 18px', maxWidth: 720 }}>
          Run your party wall practice from your phone.
        </h1>
        <p style={{ fontSize: 'clamp(15px, 2.4vw, 18px)', color: 'var(--text2)', lineHeight: 1.55, maxWidth: 620, margin: '0 auto 28px' }}>
          Nora is built for party wall work. She keeps your projects, emails and invoices together, writes your emails when you dictate them, and turns what you say on site into a finished schedule of condition.
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
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--rxl)', padding: '34px 22px' }}>
          <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Finish the schedule before you reach the car.</div>
          <p style={{ fontSize: 14, color: 'var(--text2)', margin: '0 auto 20px', maxWidth: 520, lineHeight: 1.55 }}>
            Letters of appointment and notices can also be sent for electronic signature, with the responses recorded on the project for you.
          </p>
          <button className="btn btn-primary" style={{ padding: '12px 26px', fontSize: 15 }} onClick={onSignUp}>Create your account</button>
        </div>
      </section>

      <footer style={{ ...wrap, textAlign: 'center', padding: '0 20px 36px', fontSize: 12, color: 'var(--text3)' }}>
        Nora · Square One Consulting
      </footer>
    </div>
  );
}
