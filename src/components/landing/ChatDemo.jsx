import { useEffect, useRef, useState } from 'react';
import Icon from './icons';
import { useInView } from './hooks';

const EXAMPLES = [
  {
    chip: 'Review the foundation correspondence',
    q: 'Nora, review the correspondence with the adjoining owner’s surveyor regarding the foundation design. Establish what was previously agreed, identify the outstanding issues and draft a response.',
    a: 'I’ve reviewed the relevant project correspondence, identified the previous agreements and established a chronology of the outstanding issues. I’ve prepared a draft response for your review.',
    draft: true,
  },
  { chip: 'Notices due to expire', q: 'Which notices are due to expire this week?', a: 'I’ve checked the notice dates across your projects and listed those approaching expiry, with the next step for each.' },
  { chip: 'What was agreed', q: 'What did the adjoining owner’s surveyor previously agree to?', a: 'I’ve found the relevant emails and notes and summarised what was agreed, with the dates.' },
  { chip: 'Signed appointments', q: 'Have we received all the signed letters of appointment?', a: 'I’ve checked the signing status on this project and listed who has signed and who is still outstanding.' },
  { chip: 'Position on a dispute', q: 'What is the current position on this dispute?', a: 'I’ve summarised the history of the matter, the points still in dispute and a sensible next step.' },
  { chip: 'Outstanding invoices', q: 'Which invoices are still outstanding?', a: 'I’ve listed the unpaid invoices, and I can draft a reminder for any of them.' },
  { chip: 'Summarise correspondence', q: 'Summarise the correspondence on this project.', a: 'Here is a short summary of the correspondence, in date order.' },
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
      t = setTimeout(() => { setIdx((i) => (i + 1) % EXAMPLES.length); setPhase('q'); setChars(0); }, 4200);
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
            {done && ex.draft && (
              <span className="lp-draftchip"><Icon name="check" size={14} stroke={2.4} /> Draft ready for your review</span>
            )}
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
