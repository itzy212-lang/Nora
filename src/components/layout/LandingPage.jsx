// Public front page for visitors who are not signed in. Anyone who has signed in
// or registered on this device goes straight to the sign-in screen instead (see
// App.jsx), so registered users do not see this page again.
import { useEffect, useRef } from 'react';
import '../landing/landing.css';
import Icon from '../landing/icons';
import HubDiagram from '../landing/HubDiagram';
import ChatDemo from '../landing/ChatDemo';
import { BrandLogo, DisputeVisual, Workflow, PhoneDemo, ScheduleDemo, GRID } from '../landing/Sections';
import Pricing from '../landing/Pricing';
import { usePrefersReducedMotion, useReveal } from '../landing/hooks';

const TITLE = 'Nora | The intelligent assistant for party wall surveyors';
const DESCRIPTION = 'Nora is an intelligent personal assistant built for party wall surveyors. She knows your projects, understands your profession and works alongside you: notices, awards, schedules of condition, correspondence and deadlines.';

export default function LandingPage({ onSignIn, onSignUp }) {
  const rootRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  useReveal(rootRef, reduced);

  // Page title and description for search engines and sharing, restored when the page goes.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', DESCRIPTION);
    // The "new version ready" bar belongs inside the signed-in app, not on this page.
    document.body.dataset.noraLanding = '1';
    document.getElementById('nora-update-bar')?.remove();
    return () => {
      document.title = prevTitle;
      if (created) meta.remove(); else meta.setAttribute('content', prevDesc || '');
      delete document.body.dataset.noraLanding;
    };
  }, []);

  const go = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="lp" ref={rootRef}>
      <a className="lp-skip" href="#lp-main" onClick={go('lp-main')}>Skip to content</a>

      <header className="lp-header">
        <div className="lp-wrap lp-header-in">
          <a className="lp-logo" href="#top" onClick={go('top')} aria-label="nora, home">nora<span className="lp-logo-dots" aria-hidden="true"><i /><i /><i /></span></a>
          <nav className="lp-nav" aria-label="Page sections">
            <a href="#memory" onClick={go('memory')}>Project memory</a>
            <a href="#how-it-works" onClick={go('how-it-works')}>How it works</a>
            <a href="#features" onClick={go('features')}>Features</a>
            <a href="#pricing" onClick={go('pricing')}>Pricing</a>
          </nav>
          <div className="lp-header-cta">
            <button type="button" className="lp-btn lp-btn-ghost lp-btn-sm" onClick={onSignIn}>Sign in</button>
            <button type="button" className="lp-btn lp-btn-primary lp-btn-sm" onClick={onSignUp}>Get started</button>
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section id="top" className="lp-hero lp-wrap">
          <p className="lp-eyebrow">The intelligent assistant for party wall surveyors</p>
          <h1 className="lp-h1">
            <span>She knows your projects.</span>
            <span>She understands your work.</span>
            <span className="lp-grad">She’s always there to assist.</span>
          </h1>
          <p className="lp-lead">
            Nora brings together your correspondence, documents, deadlines and project history, building an intelligent understanding of every matter you work on. From serving your first notice to resolving complex disputes, Nora works alongside you.
          </p>
          <div className="lp-hero-cta">
            <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={onSignUp}>Meet your new assistant <Icon name="arrow" size={18} /></button>
            <button type="button" className="lp-btn lp-btn-ghost lp-btn-lg" onClick={go('how-it-works')}><Icon name="play" size={16} /> See how Nora works</button>
          </div>
          <ul className="lp-principles">
            <li><Icon name="history" size={20} /> Nora knows your projects.</li>
            <li><Icon name="scale" size={20} /> Nora understands your profession.</li>
            <li><Icon name="phone" size={20} /> Nora works alongside you, wherever you are.</li>
          </ul>
        </section>

        <section id="how-it-works" className="lp-wrap lp-section lp-section-hub">
          <HubDiagram reduced={reduced} />
        </section>

        <section id="memory" className="lp-section lp-band">
          <div className="lp-wrap lp-two">
            <div className="lp-copy lp-reveal">
              <h2 className="lp-h2">Every project has a history. Nora remembers yours.</h2>
              <p>Nora builds an understanding of your projects as you work. Your emails, correspondence, documents, notices, responses and previous discussions become part of her project knowledge.</p>
              <p>When an issue arises, you don’t need to spend hours searching through old emails, establishing what was agreed or reconstructing the sequence of events.</p>
              <p className="lp-strong">Simply ask Nora.</p>
              <p>She can retrieve relevant correspondence, identify key information, establish a chronology and help you prepare a considered, professional response based on the history of the matter.</p>
            </div>
            <div className="lp-reveal"><ChatDemo reduced={reduced} /></div>
          </div>
        </section>

        <section id="disputes" className="lp-section lp-wrap lp-two lp-two-flip">
          <div className="lp-reveal"><DisputeVisual /></div>
          <div className="lp-copy lp-reveal">
            <h2 className="lp-h2">Complex disputes. Powerful correspondence. Minutes, not hours.</h2>
            <p>Dealing with a difficult adjoining owner’s surveyor? Responding to a complex technical issue? Trying to establish what was agreed months ago?</p>
            <p>Nora can draw upon your project history, previous correspondence, documents and discussions to extract the relevant information, establish a chronology and help you construct a detailed, well-reasoned response.</p>
            <p>Rather than spending hours searching through emails and piecing together the history of a dispute, let Nora bring the information together and prepare professionally written correspondence, ready for you to review and send.</p>
            <p>Nora helps you present your position clearly, confidently and with the benefit of your project’s recorded history.</p>
          </div>
        </section>

        <section id="notices" className="lp-section lp-band">
          <div className="lp-wrap">
            <div className="lp-copy lp-center lp-reveal">
              <h2 className="lp-h2">Draft a notice in seconds. Let Nora keep track of what happens next.</h2>
              <p>Generate party wall notices directly from the information already held within your project. Nora prepares the notice, saves it to the relevant project file and makes it ready to email or print.</p>
              <p className="lp-strong">But her work doesn’t stop there.</p>
            </div>
            <div className="lp-reveal"><Workflow /></div>
            <p className="lp-closing-line lp-reveal">From initial notices and Section 10 notices to letters of appointment and party wall awards, Nora helps you manage the entire party wall process.</p>
          </div>
        </section>

        <section id="email" className="lp-section lp-wrap lp-two">
          <div className="lp-copy lp-reveal">
            <h2 className="lp-h2">Your inbox is part of your project knowledge.</h2>
            <p>Nora integrates with Outlook and Gmail, bringing your correspondence and project information together.</p>
            <p>Rather than treating your emails as isolated conversations, Nora can use relevant correspondence to build an understanding of the matters you’re working on.</p>
            <p>Find previous agreements, retrieve important information, summarise conversations and draft responses without spending your day searching through your inbox.</p>
          </div>
          <div className="lp-logos lp-reveal">
            <div className="lp-logo-card"><BrandLogo name="Outlook" file="outlook.svg" /></div>
            <div className="lp-logo-card"><BrandLogo name="Gmail" file="gmail.svg" /></div>
          </div>
        </section>

        <section id="onthego" className="lp-section lp-band">
          <div className="lp-wrap lp-two lp-two-flip">
            <div className="lp-reveal lp-center-mobile"><PhoneDemo /></div>
            <div className="lp-copy lp-reveal">
              <h2 className="lp-h2">Work on the go. Write like you’re in the office.</h2>
              <p>Between inspections, travelling to appointments or working away from your desk, simply tell Nora what you want to say.</p>
              <p>Nora understands the context of your project and turns your spoken instructions into professionally written correspondence.</p>
              <p>Review it, send it and move on with your day.</p>
              <p>Your clients won’t know whether you’re sitting at your desk or standing outside your next inspection.</p>
            </div>
          </div>
        </section>

        <section id="soc" className="lp-section lp-wrap">
          <div className="lp-copy lp-center lp-reveal">
            <h2 className="lp-h2">Finish your schedule before you reach the car.</h2>
            <p>Dictate your observations room by room as you carry out your inspection. Nora transforms your spoken observations into a structured, professionally written schedule of condition.</p>
            <p>No returning to the office to transcribe recordings. No hours spent typing up handwritten notes.</p>
            <p>Complete your inspection, review your schedule and have it ready to issue.</p>
          </div>
          <div className="lp-reveal"><ScheduleDemo /></div>
        </section>

        <section id="features" className="lp-section lp-band">
          <div className="lp-wrap">
            <h2 className="lp-h2 lp-center lp-reveal">Your specialist party wall assistant</h2>
            <div className="lp-grid">
              {GRID.map((g, i) => (
                <article className="lp-card lp-reveal" key={g.title} style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
                  <span className="lp-card-icon"><Icon name={g.icon} size={24} /></span>
                  <h3>{g.title}</h3>
                  <p>{g.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <Pricing onSignUp={onSignUp} />

        <section id="closing" className="lp-closing">
          <div className="lp-wrap lp-center">
            <h2 className="lp-h2 lp-reveal">You’re the surveyor. Nora is your assistant.</h2>
            <p className="lp-lead lp-reveal">Spend less time searching through correspondence, drafting documents and managing administration. Spend more time doing the work that requires your professional expertise.</p>
            <p className="lp-lead lp-reveal">In the office, on site or on the move, Nora is there to assist you.</p>
            <p className="lp-big lp-reveal"><span>Less searching.</span> <span>Less typing.</span> <span>Less chasing.</span> <span className="lp-grad">More surveying.</span></p>
            <div className="lp-reveal"><button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={onSignUp}>Get started with Nora <Icon name="arrow" size={18} /></button></div>
            <p className="lp-brandline lp-reveal">Your practice. Your knowledge. Your assistant.</p>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <span className="lp-logo lp-logo-sm">nora</span>
          <span>Square One Consulting</span>
          <button type="button" className="lp-link" onClick={onSignIn}>Sign in</button>
        </div>
      </footer>
    </div>
  );
}
