import { useState } from 'react';
import Icon from './icons';

// Official Outlook and Gmail logo files go in /public/logos (outlook.svg, gmail.svg).
// Until they are added, a plain text label is shown so nothing looks broken.
export function BrandLogo({ name, file, size = 56 }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="lp-logo-fallback" style={{ height: size }}>{name}</span>;
  return <img src={`/logos/${file}`} alt={name} height={size} style={{ height: size, width: 'auto' }} onError={() => setBroken(true)} />;
}

export function DisputeVisual() {
  const sources = [
    { icon: 'mail', label: 'Emails' },
    { icon: 'doc', label: 'Documents' },
    { icon: 'list', label: 'Notes' },
    { icon: 'history', label: 'Previous agreements' },
  ];
  return (
    <div className="lp-dispute" aria-hidden="true">
      <div className="lp-dispute-sources">
        {sources.map((s, i) => (
          <div className="lp-source" key={s.label} style={{ animationDelay: `${i * 0.35}s` }}>
            <Icon name={s.icon} size={20} /> <span>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="lp-dispute-flow"><span /><span /><span /></div>
      <div className="lp-draft">
        <div className="lp-draft-head"><Icon name="sparkle" size={16} /> Draft email, ready to review</div>
        <div className="lp-draft-line lp-w90" /><div className="lp-draft-line lp-w70" /><div className="lp-draft-line lp-w95" />
        <div className="lp-draft-line lp-w60" /><div className="lp-draft-line lp-w80" />
        <div className="lp-draft-foot"><span><Icon name="check" size={14} stroke={2.4} /> Chronology included</span></div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: 'doc', title: 'Generate', text: 'Prepare party wall notices using existing project information without repeatedly entering the same details.' },
  { icon: 'folder', title: 'Save and issue', text: 'Save notices directly to the relevant project file, ready to email or print.' },
  { icon: 'calendar', title: 'Track', text: 'Record service dates, create tasks and track relevant statutory deadlines.' },
  { icon: 'qr', title: 'Receive responses', text: 'Allow adjoining owners to respond online through their dedicated link or QR code.' },
  { icon: 'check', title: 'Update', text: 'Record responses directly against the relevant project and update its status.' },
  { icon: 'bell', title: 'Remind', text: 'Receive reminders about outstanding responses, approaching deadlines and notice expiry dates.' },
];

export function Workflow() {
  return (
    <ol className="lp-flow">
      {STEPS.map((s, i) => (
        <li className="lp-step" key={s.title} style={{ '--i': i }}>
          <span className="lp-step-icon"><Icon name={s.icon} size={24} /></span>
          <span className="lp-step-n">{i + 1}</span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function PhoneDemo() {
  return (
    <div className="lp-phone" aria-hidden="true">
      <div className="lp-phone-notch" />
      <div className="lp-phone-screen">
        <div className="lp-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="lp-heard"><Icon name="mic" size={14} /> “Tell the surveyor we can meet on site on Thursday morning and ask him to confirm the access arrangements.”</div>
        <div className="lp-arrow-down"><Icon name="arrow" size={18} style={{ transform: 'rotate(90deg)' }} /></div>
        <div className="lp-mail">
          <div className="lp-mail-row"><b>To</b> Adjoining owner’s surveyor</div>
          <div className="lp-mail-row"><b>Subject</b> Site meeting and access</div>
          <div className="lp-mail-body">
            <div className="lp-draft-line lp-w95" /><div className="lp-draft-line lp-w80" /><div className="lp-draft-line lp-w90" /><div className="lp-draft-line lp-w50" />
          </div>
          <div className="lp-mail-send"><Icon name="send" size={14} /> Review and send</div>
        </div>
      </div>
    </div>
  );
}

export function ScheduleDemo() {
  const heard = [
    'Kitchen. Ceiling plaster, one hairline crack above the window.',
    'Kitchen. Party wall, painted, no visible cracking.',
    'Hallway. Floor tiles intact, no lipping at the threshold.',
  ];
  return (
    <div className="lp-soc" aria-hidden="true">
      <div className="lp-soc-in">
        <div className="lp-soc-label"><Icon name="mic" size={14} /> Dictated on site</div>
        {heard.map((h, i) => <div className="lp-soc-bubble" key={h} style={{ animationDelay: `${i * 0.5}s` }}>{h}</div>)}
      </div>
      <div className="lp-soc-arrow"><Icon name="arrow" size={22} /></div>
      <div className="lp-soc-out">
        <div className="lp-soc-label"><Icon name="clipboard" size={14} /> Schedule of condition</div>
        <table>
          <thead><tr><th>Room</th><th>Element</th><th>Condition</th></tr></thead>
          <tbody>
            <tr><td>Kitchen</td><td>Ceiling</td><td>Plaster, one hairline crack above the window</td></tr>
            <tr><td>Kitchen</td><td>Party wall</td><td>Painted, no visible cracking</td></tr>
            <tr><td>Hallway</td><td>Floor</td><td>Tiles intact, no lipping at the threshold</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const GRID = [
  { icon: 'gavel', title: 'Party wall awards', text: 'Generate awards using your project information, templates and clauses, ready for your professional review.' },
  { icon: 'scale', title: 'Case law and legislation', text: 'Discuss the Party Wall etc. Act 1996, relevant case law, procedural questions and complex disputes with Nora.' },
  { icon: 'pen', title: 'Electronic signatures', text: 'Send letters of appointment and notices for electronic signature or acknowledgement, with responses recorded directly against your project.' },
  { icon: 'layers', title: 'Project management', text: 'Manage building owners, adjoining owners, surveyors, notices, awards, correspondence and documents within a connected workspace.' },
  { icon: 'pound', title: 'Invoicing and payments', text: 'Generate invoices, track outstanding fees and chase overdue payments directly from your projects.' },
  { icon: 'calendar', title: 'Tasks and calendar', text: 'Manage inspections, appointments, statutory deadlines and outstanding project actions.' },
  { icon: 'folder', title: 'Document management', text: 'Keep drawings, photographs, reports, notices, awards and correspondence together.' },
  { icon: 'chat', title: 'Intelligent AI chat', text: 'Discuss your projects with Nora without having to explain their entire history every time you need assistance.' },
];
