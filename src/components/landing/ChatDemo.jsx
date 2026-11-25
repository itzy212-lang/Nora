import { useEffect, useRef, useState } from 'react';
import Icon from './icons';
import { useInView } from './hooks';

const EXAMPLES = [
  {
    chip: 'Notices "expired"',
    q: 'I want to discuss the adjoining owner’s surveyor’s last email.',
    a: 'James is questioning the validity of the notices. He says that on Friday it will be one year since they were served, so they have now expired and new notices must be served. We served the notices on 27 November 2025, so Friday is the one-year mark. But the notices have not expired. In Leadbetter v Marylebone Corporation (No. 2), the position is that once notices have been dissented to and surveyors appointed, they do not expire simply because time passes before the award. I’ve drafted a reply for you.',
    draft: {
      subject: 'Re: Request for new notices',
      body: 'Dear James,\n\nThank you for your email. I do not agree that fresh notices are required. The notices were served on 27 November 2025 and dissented to, and surveyors were then appointed. In those circumstances the notices do not expire while we work towards an award, as confirmed in Leadbetter v Marylebone Corporation (No. 2).\n\nI suggest we continue with the award on the basis of the existing notices.\n\nKind regards',
    },
  },
  {
    chip: 'Agreed third surveyor',
    q: 'What third surveyor did we agree for number 16?',
    a: 'I’ve reviewed your correspondence with James Peters at James & Associates. The third surveyor you agreed is Grimshaw Surveyors.',
  },
  {
    chip: 'Insurance certificates clause',
    q: 'I want to respond to the adjoining owner’s surveyor’s email.',
    a: 'They are asking for a clause in the award requiring the building owner to provide copies of the insurance certificates for their selected contractors. That is not a party wall matter, and neither surveyor can enforce it under the Act, so the award should not include it. I’ve drafted a reply setting that out politely.',
    draft: {
      subject: 'Re: Proposed award clause',
      body: 'Dear James,\n\nThank you for your email. I understand why you would like sight of the contractors’ insurance certificates, but I do not think it can form part of the award. It is not a matter the Party Wall etc. Act 1996 gives either of us the power to determine, and we could not enforce it.\n\nI am happy to ask my appointing owner to share them voluntarily, outside the award.\n\nKind regards',
    },
  },
  { chip: 'Notices due to expire', q: 'Which notices are due to expire this week?', a: 'I’ve checked the notice dates across your projects and listed those approaching expiry, with the next step for each.' },
  { chip: 'Outstanding invoices', q: 'Which invoices are still outstanding?', a: 'I’ve listed the unpaid invoices, and I can draft a reminder for any of them.' },
  { chip: 'Outstanding actions', q: 'What actions are still outstanding?', a: 'I’ve gathered the open tasks and deadlines for this project.' },
];

export default function ChatDemo({ reduced }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState('q'); // q (typing question) -> think -> a (typing answer) -> done
  const [chars, setChars] = useState(0);
  const [manual, setManual] = useState(false);
  const ex = EXAMPLES[idx];

  useEffect(() => {
    if (reduced || !inView) return undefined;
    let t;
    if (phase === 'q') {
      t = chars < ex.q.length ? setTimeout(() => setChars((c) => c + 2), 24) : setTimeout(() => { setPhase('think'); setChars(0); }, 450);
    } else if (phase === 'think') {
      t = setTimeout(() => setPhase('a'), 1100);
    } else if (phase === 'a') {
      t = chars < ex.a.length ? setTimeout(() => setChars((c) => c + 3), 16) : setTimeout(() => setPhase('done'), 300);
    } else if (phase === 'done' && !manual) {
      t = setTimeout(() => { setIdx((i) => (i + 1) % EXAMPLES.length); setPhase('q'); setChars(0); }, ex.draft ? 9000 : 4200);
    }
    return () => clearTimeout(t);
  }, [reduced, inView, phase, chars, ex, manual]);

  const pick = (i) => { setManual(true); setIdx(i); setPhase(reduced ? 'done' : 'q'); setChars(0); };

  const showQ = reduced ? ex.q : ex.q.slice(0, phase === 'q' ? chars : ex.q.length);
  const showA = reduced ? ex.a : phase === 'a' ? ex.a.slice(0, chars) : phase === 'done' ? ex.a : '';
  const done = reduced || phase === 'done';

  return (
    <div className="lp-chat" ref={ref}>
      <div className="lp-chat-bar">
        <span className="lp-chat-dot" /><span className="lp-chat-dot" /><span className="lp-chat-dot" />
        <span className="lp-chat-title">Project chat</span>
        <span className="lp-chat-tag">Illustrative example</span>
      </div>
      <div className="lp-chat-body" aria-live="off">
        <div className="lp-bubble lp-bubble-user">
          <span className="lp-bubble-who">Surveyor</span>
          {showQ}{!reduced && phase === 'q' && <span className="lp-caret" />}
        </div>
        {(reduced || phase !== 'q') && (
          <div className="lp-bubble lp-bubble-nora">
            <span className="lp-bubble-who">Nora</span>
            {phase === 'think' && !reduced ? (
              <span className="lp-typing" aria-label="Nora is working"><i /><i /><i /></span>
            ) : (
              <>{showA}{!reduced && phase === 'a' && <span className="lp-caret" />}</>
            )}
          </div>
        )}
        {done && ex.draft && (
          <div className="lp-draftcard">
            <div className="lp-draftcard-head"><span>Draft email</span><span className="lp-draftcard-subj">{ex.draft.subject}</span></div>
            <div className="lp-draftcard-body">{ex.draft.body}</div>
            <div className="lp-draftcard-actions" aria-hidden="true">
              <span className="lp-dc-btn lp-dc-primary">Use this draft</span>
              <span className="lp-dc-btn">Open in composer</span>
              <span className="lp-dc-btn">Copy</span>
            </div>
          </div>
        )}
      </div>
      <div className="lp-chat-chips" role="tablist" aria-label="Example questions">
        {EXAMPLES.map((e, i) => (
          <button key={e.chip} type="button" className={`lp-chip ${i === idx ? 'lp-chip-on' : ''}`} onClick={() => pick(i)} aria-pressed={i === idx}>
            {e.chip}
          </button>
        ))}
      </div>
      <p className="lp-chat-note">Illustrative demonstration, not a live conversation.</p>
    </div>
  );
}
