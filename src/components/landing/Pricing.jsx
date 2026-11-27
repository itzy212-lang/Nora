// Pricing section for the public landing page. DRAFT: tiers and prices are placeholders until locked.
// Keep the plan list in one place (PLANS) so the numbers can be changed without touching the layout.
import Icon from './icons';

export const PLANS = [
  {
    id: 'essentials',
    name: 'Essentials',
    tag: 'Run your practice',
    price: '£20',
    blurb: 'Everything you need to manage projects, with no AI.',
    features: [
      'Notice, award and letter generators',
      'Project job statuses and deadline tracking',
      'Outlook or Gmail connected to your projects',
      'Automatic reminders and standard email templates',
      'OneDrive or Google Drive project folders',
    ],
    cta: 'Start free trial',
  },
  {
    id: 'inspect',
    name: 'Inspect',
    tag: 'On site',
    price: '£45',
    blurb: 'Everything in Essentials, plus Nora for your inspections.',
    features: [
      'Everything in Essentials',
      'Dictate and build a Schedule of Condition with Nora',
      'Room-by-room structured, professionally written output',
      'Photos and notes kept with the project',
    ],
    cta: 'Start free trial',
  },
  {
    id: 'complete',
    name: 'Complete',
    tag: 'The full assistant',
    price: '£79',
    blurb: 'Nora knows every project and works alongside you.',
    features: [
      'Everything in Inspect',
      'Draft correspondence with Nora from email, project chat and main chat',
      'Project memory: ask anything about a matter’s history',
      'Automatic linking of emails to the right project',
      'Monthly AI allowance, with top-ups if you need more',
    ],
    cta: 'Start free trial',
    featured: true,
  },
];

export default function Pricing({ onSignUp }) {
  return (
    <section id="pricing" className="lp-section lp-wrap">
      <div className="lp-copy lp-center lp-reveal">
        <h2 className="lp-h2">Simple pricing. Start with everything, keep what you need.</h2>
        <p>Every account begins with a 2-week free trial of the full package. No card needed.</p>
      </div>
      <div className="lp-plans">
        {PLANS.map((p, i) => (
          <article className={'lp-plan lp-reveal' + (p.featured ? ' lp-plan-feat' : '')} key={p.id} style={{ transitionDelay: `${i * 70}ms` }}>
            {p.featured && <span className="lp-plan-badge">Most complete</span>}
            <p className="lp-plan-tag">{p.tag}</p>
            <h3>{p.name}</h3>
            <p className="lp-plan-price"><b>{p.price}</b><span> / month + VAT</span></p>
            <p className="lp-plan-blurb">{p.blurb}</p>
            <ul className="lp-plan-list">
              {p.features.map(f => (
                <li key={f}><Icon name="check" size={18} /><span>{f}</span></li>
              ))}
            </ul>
            <button type="button" className={'lp-btn lp-btn-lg ' + (p.featured ? 'lp-btn-primary' : 'lp-btn-ghost')} onClick={onSignUp}>{p.cta}</button>
          </article>
        ))}
      </div>
      <p className="lp-plans-note lp-reveal">After your trial you choose a plan. If you do not, your account is paused until you subscribe, and your data stays safe and downloadable. Prices shown are a draft.</p>
    </section>
  );
}
