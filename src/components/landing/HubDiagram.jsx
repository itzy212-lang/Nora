import Icon from './icons';

const LEFT = [
  { icon: 'mail', title: 'Outlook & Gmail', text: 'Integrated email accounts and project correspondence.' },
  { icon: 'history', title: 'Intelligent Project Memory', text: 'Project history, documents, previous agreements and discussions.' },
  { icon: 'doc', title: 'Party Wall Notices', text: 'Generate, save, email, print and track notices.' },
  { icon: 'qr', title: 'Online Notice Responses', text: 'Allow adjoining owners to respond electronically.' },
  { icon: 'calendar', title: 'Deadlines & Reminders', text: 'Track notice responses, expiry dates, tasks and appointments.' },
  { icon: 'link', title: 'Section 10 Notices', text: 'Generate notices relating to surveyor appointments and disputes.' },
];
const RIGHT = [
  { icon: 'gavel', title: 'Party Wall Awards', text: 'Prepare awards using project information, templates and clauses.' },
  { icon: 'clipboard', title: 'Schedules of Condition', text: 'Dictate observations on site and generate professional schedules.' },
  { icon: 'scale', title: 'Case Law & Legislation', text: 'Discuss party wall legislation, relevant case law and procedural matters.' },
  { icon: 'chat', title: 'Disputes & AI Assistance', text: 'Analyse correspondence, establish chronologies and prepare detailed responses.' },
  { icon: 'pen', title: 'Electronic Signatures', text: 'Issue letters of appointment and receive signed documents.' },
  { icon: 'pound', title: 'Invoices & Payments', text: 'Generate invoices, track payments and chase outstanding fees.' },
];

const W = 1000;
const H = 900;
const row = (i) => (H / 6) * (i + 0.5);

function Card({ n, style, className = '' }) {
  return (
    <div className={`lp-node ${className}`} style={style}>
      <span className="lp-node-icon"><Icon name={n.icon} size={22} /></span>
      <span className="lp-node-body">
        <span className="lp-node-title">{n.title}</span>
        <span className="lp-node-text">{n.text}</span>
      </span>
    </div>
  );
}

function Hub() {
  return (
    <div className="lp-hub" aria-hidden="false">
      <span className="lp-hub-ring lp-hub-ring-1" />
      <span className="lp-hub-ring lp-hub-ring-2" />
      <div className="lp-hub-core">
        <span className="lp-hub-wordrow">
          <span className="lp-hub-word">nora</span>
          <span className="lp-hub-dots" aria-hidden="true"><i /><i /><i /></span>
        </span>
        <span className="lp-hub-sub">Your Party Wall Assistant</span>
      </div>
    </div>
  );
}

export default function HubDiagram({ reduced }) {
  const paths = [
    ...LEFT.map((_, i) => `M330 ${row(i)} C 430 ${row(i)}, 410 ${H / 2}, 500 ${H / 2}`),
    ...RIGHT.map((_, i) => `M670 ${row(i)} C 570 ${row(i)}, 590 ${H / 2}, 500 ${H / 2}`),
  ];

  return (
    <figure className="lp-hubfig">
      <p className="lp-sr">Nora sits at the centre of your practice. Connected to her are: {[...LEFT, ...RIGHT].map((n) => n.title).join(', ')}.</p>

      {/* Desktop: Nora in the middle, branches either side, pulses of light flowing in and out. */}
      <div className="lp-hub-desktop" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg className="lp-hub-lines" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="lp-line" x1="0" x2="1">
              <stop offset="0" stopColor="#7c6cf0" stopOpacity="0.55" />
              <stop offset="1" stopColor="#3b82f6" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          {paths.map((d, i) => (
            <g key={i}>
              <path d={d} fill="none" stroke="url(#lp-line)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {!reduced && (
                <>
                  <circle r="4.5" fill="#3b82f6" className="lp-pulse" opacity="0">
                    <set attributeName="opacity" to="1" begin={`${(i * 0.45).toFixed(2)}s`} />
                    <animateMotion dur={`${4 + (i % 4) * 0.6}s`} begin={`${(i * 0.45).toFixed(2)}s`} repeatCount="indefinite" path={d} />
                  </circle>
                  <circle r="4.5" fill="#8b5cf6" className="lp-pulse" opacity="0">
                    <set attributeName="opacity" to="1" begin={`${(i * 0.45 + 2).toFixed(2)}s`} />
                    <animateMotion dur={`${4.6 + (i % 3) * 0.5}s`} begin={`${(i * 0.45 + 2).toFixed(2)}s`} repeatCount="indefinite" path={d} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
                  </circle>
                </>
              )}
            </g>
          ))}
        </svg>
        {LEFT.map((n, i) => <Card key={n.title} n={n} style={{ left: 0, top: `${(row(i) / H) * 100}%` }} />)}
        {RIGHT.map((n, i) => <Card key={n.title} n={n} style={{ right: 0, top: `${(row(i) / H) * 100}%` }} />)}
        <Hub />
      </div>

      {/* Tablet and mobile: Nora first, then everything connected to her down a single line of light. */}
      <div className="lp-hub-stack">
        <Hub />
        <div className="lp-stack-list">
          <span className="lp-stack-spine" aria-hidden="true">{!reduced && <span className="lp-stack-pulse" />}{!reduced && <span className="lp-stack-pulse lp-stack-pulse-2" />}</span>
          {[...LEFT, ...RIGHT].map((n) => <Card key={n.title} n={n} className="lp-node-stack" />)}
        </div>
      </div>

      <figcaption className="lp-hub-caption">One assistant. Every aspect of your practice connected.</figcaption>
    </figure>
  );
}
