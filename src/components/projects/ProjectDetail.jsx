import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import { useEly } from '../../hooks/useEly';
import sb from '../../supabaseClient';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STAGES = ['Notice served', 'Consent', 'Appt made', 'Award', 'Complete'];

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtGBP(v) {
  const n = parseFloat(v) || 0;
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

function getAOColour(ao) {
  const st = (ao.status || ao.ao_status || '').toLowerCase();
  if (st === 'consent') return '#22c55e';
  if (st === 'dissent') return '#ef4444';
  const now = Date.now();
  const cd = ao.consentDeadline || ao.ao_consent_deadline;
  const sd = ao.s10Deadline     || ao.ao_s10_deadline;
  if ((cd && new Date(cd).getTime() < now) || (sd && new Date(sd).getTime() < now)) return '#ef4444';
  if (cd || ao.noticeServedDate || ao.ao_notice_served_date) return '#22c55e';
  return '#a855f7';
}

function getProjectColour(project) {
  const aos = project.aos || [];
  if (!aos.length) return '#9ca3af';
  const now = Date.now();
  const hasOverdue = aos.some(ao => {
    const cd = ao.consentDeadline || ao.ao_consent_deadline;
    const sd = ao.s10Deadline     || ao.ao_s10_deadline;
    const st = (ao.status || '').toLowerCase();
    if (cd && new Date(cd).getTime() < now && st !== 'consent' && st !== 'dissent') return true;
    if (sd && new Date(sd).getTime() < now) return true;
    return false;
  });
  if (hasOverdue) return '#ef4444';
  const hasNotices = aos.some(ao => ao.consentDeadline || ao.noticeServedDate || ao.ao_notice_served_date);
  if (hasNotices) return '#22c55e';
  return '#a855f7';
}

// ── AO Card ───────────────────────────────────────────────────────────────────
function AOCard({ ao, onOpenComposer }) {
  const colour = getAOColour(ao);
  const st = (ao.status || 'unknown').toLowerCase();
  const statusLabel = { consent: 'Consented', dissent: 'Dissented', s10: 'S.10', pending: 'Awaiting', unknown: '' }[st] || 'Notice served';
  const cd = ao.consentDeadline || ao.ao_consent_deadline;
  const days = daysUntil(cd);
  const surveyorName  = ao.surveyorName  || ao.surveyor_name  || '';
  const surveyorFirm  = ao.surveyorFirm  || ao.surveyor_firm  || '';
  const surveyorEmail = ao.surveyorEmail || ao.surveyor_email || '';
  const surveyorPhone = ao.surveyorPhone || ao.surveyor_phone || '';
  const surveyorAddr  = ao.surveyorAddress || '';
  const address = ao.address || ao.ao_premise_address || '';
  const phone   = ao.phone   || ao.ao_phone || '';
  const email   = ao.email   || ao.ao_email || '';
  const name    = ao.name    || ao.label || `AO ${ao.num || ''}`;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', background: 'var(--bg2)' }}>
        <div style={{ width: 4, background: colour, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colour, marginBottom: 2 }}>
                AO{ao.num} — {name.toUpperCase()}
              </div>
              {address && (
                <div style={{ fontSize: 12.5, color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer', marginBottom: 2 }}>
                  {address}
                </div>
              )}
              {phone && (
                <div style={{ fontSize: 12.5, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📞 {phone}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colour, flexShrink: 0 }}>{statusLabel}</div>
          </div>

          {/* AI alert (intention noted etc.) */}
          {ao.intentionNote && (
            <div style={{ margin: '8px 0', padding: '8px 10px', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 6, fontSize: 12, color: 'var(--amber)', lineHeight: 1.5 }}>
              {ao.intentionNote}
            </div>
          )}

          {/* Deadline countdown */}
          {cd && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, padding: '3px 10px', borderRadius: 99, background: days !== null && days < 0 ? 'var(--red-bg)' : 'var(--green-bg)', fontSize: 12, fontWeight: 600, color: days !== null && days < 0 ? 'var(--red)' : 'var(--green)' }}>
              ⏱ {days !== null ? (days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d to consent deadline`) : fmtDate(cd)}
            </div>
          )}

          {/* Agreed surveyor toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 4 }}>
            <div style={{ width: 32, height: 18, borderRadius: 9, background: ao.agreedSurveyor ? 'var(--blue)' : 'var(--border2)', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: ao.agreedSurveyor ? 16 : 2, transition: 'left 0.15s' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>I am the Agreed Surveyor for this AO</span>
          </div>

          {/* AO Surveyor detail */}
          {surveyorName && (
            <div style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>AO Surveyor</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)', lineHeight: 1.5 }}>
                {surveyorName}{surveyorFirm ? ` — ${surveyorFirm}` : ''}
              </div>
              {surveyorAddr  && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{surveyorAddr}</div>}
              {surveyorEmail && <div style={{ fontSize: 12, color: 'var(--blue)',  marginTop: 2 }}>{surveyorEmail}</div>}
              {surveyorPhone && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>📞 {surveyorPhone}</div>}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {['Consent', 'Dissent'].map(action => (
              <button key={action} style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${action === 'Consent' ? 'var(--green)' : 'var(--red)'}`,
                background: 'transparent',
                color: action === 'Consent' ? 'var(--green)' : 'var(--red)',
              }}>{action}</button>
            ))}
            <button className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11.5 }}>Note intention</button>
            <button className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--purple)', borderColor: 'var(--purple)' }}>Schedule of Condition</button>
            <button className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11.5 }}>Edit</button>
            {email ? (
              <button className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11.5 }}
                onClick={() => onOpenComposer?.({ mode: 'compose', to: email, toName: name })}>
                📧 Email AO
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11.5, opacity: 0.5 }}>✉ Add email first</button>
            )}
            <button className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11.5 }}>Agreed Surveyor LoA</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SOC Chat Modal ────────────────────────────────────────────────────────────
function SOCModal({ project, onClose }) {
  const [messages, setMessages] = useState([{
    id: 0, role: 'ely',
    content: `Hi! I'm ready to help you dictate the Schedule of Condition for **${project.ref} — ${project.address || ''}**.\n\nTell me the room you're in and describe what you see. I'll structure it as we go and generate the full SOC document at the end.\n\nStart with: "Room 1 — [room name]"`
  }]);
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const { send, loading } = useEly({ surface: 'soc_dictation', projectId: project.id });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    try {
      const result = await send(text);
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: result.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: 'Sorry, something went wrong.' }]);
    }
  }, [input, loading, send]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 680, maxWidth: '95vw', height: '80vh', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>🎙️ SOC Dictation</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{project.ref} — {project.address}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
              color: msg.role === 'user' ? '#fff' : 'var(--text)',
              padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>✨ Processing…</div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
            placeholder="Dictate observations for this room…"
            rows={2}
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>Send</button>
            <button onClick={() => {
              setInput('');
              handleSend();
            }} disabled={loading} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11 }}>
              🎙️ Voice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Project Chat (embedded in tab) ────────────────────────────────────────────
function ProjectChat({ project, onOpenComposer }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const { send, loading } = useEly({ surface: 'project_chat', projectId: project.id });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    try {
      const result = await send(text);
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: result.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: `Error: ${err.message}` }]);
    }
  }, [input, loading, send]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '60vh', minHeight: 400 }}>
      <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}
          onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>
          ✉ Compose email
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            Ask Ely anything about this project
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%',
            background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
            color: msg.role === 'user' ? '#fff' : 'var(--text)',
            padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>{msg.content}</div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>✨ Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
          placeholder={`Ask about ${project.ref}…`} rows={2}
          style={{ flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none' }} />
        <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', alignSelf: 'flex-end' }}>Send</button>
      </div>
    </div>
  );
}

// ── Main ProjectDetail ────────────────────────────────────────────────────────
export default function ProjectDetail({ project, onBack, onOpenComposer }) {
  const [tab, setTab] = useState('details');
  const [showSOC, setShowSOC] = useState(false);
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const address  = project.address  || project.bo_premise_address || '';
  const bo       = project.bo       || project.bo_1_name || '';
  const boEmail  = project.bo_email || project.bo_1_email || '';
  const boPhone  = project.bo_phone || '';
  const works    = project.works    || '';
  const aos      = project.aos      || [];
  const notices  = Array.isArray(project.notices) ? project.notices : [];
  const documents = project.documents || [];
  const projColour = getProjectColour(project);

  // Stage index
  const hasConsent = aos.some(ao => (ao.status || '').toLowerCase() === 'consent');
  const hasDissent = aos.some(ao => ['dissent', 's10'].includes((ao.status || '').toLowerCase()));
  const hasNotices = aos.some(ao => ao.consentDeadline || ao.noticeServedDate || ao.ao_notice_served_date);
  const stageIndex = project.status === 'complete' ? 4 : (hasDissent || hasConsent) ? 2 : hasNotices ? 1 : 0;

  // Upcoming deadlines from AO data
  const upcoming = [];
  aos.forEach(ao => {
    const cd = ao.consentDeadline || ao.ao_consent_deadline;
    if (cd) upcoming.push({ label: `Consent deadline — ${ao.address || ao.name || `AO${ao.num}`}`, date: cd, days: daysUntil(cd) });
    const sd = ao.s10Deadline || ao.ao_s10_deadline;
    if (sd) upcoming.push({ label: `S.10 deadline — ${ao.name || `AO${ao.num}`}`, date: sd, days: daysUntil(sd) });
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Load emails when tab changes
  useEffect(() => {
    if (tab !== 'emails' || !sb) return;
    setEmailsLoading(true);
    sb.from('emails')
      .select('id, subject, sender_name, sender_email, received_at, is_read, body_preview')
      .eq('project_id', project.id)
      .order('received_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { setEmails(data || []); setEmailsLoading(false); });
  }, [tab, project.id]);

  const TABS = [
    { id: 'details',   label: 'Details'   },
    { id: 'emails',    label: 'Emails'    },
    { id: 'documents', label: 'Documents' },
    { id: 'chat',      label: '💬 Chat'   },
  ];

  return (
    <div style={{ padding: '0 28px 28px' }}>
      {showSOC && <SOCModal project={project} onClose={() => setShowSOC(false)} />}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 14px' }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          border: '1px solid var(--border)', borderRadius: 99, background: 'var(--bg2)',
          color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontWeight: 500,
        }}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>Edit</button>
          <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', color: 'var(--red)' }}>Delete</button>
          <button className="btn btn-sm" style={{
            cursor: 'pointer', background: 'var(--amber-bg)', color: 'var(--amber)',
            border: '1px solid var(--amber)', borderRadius: 'var(--radius)', padding: '5px 14px', fontSize: 12.5, fontWeight: 600,
          }}>🔒 Close project</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 2 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', fontSize: 13, border: 'none', cursor: 'pointer',
            background: 'none', fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── DETAILS TAB: Two-column layout ── */}
      {tab === 'details' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

          {/* ── LEFT: main content ── */}
          <div>
            {/* Project header card */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '18px 20px', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
                {project.ref} — {bo} — {address}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Role</div>
                  <span style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 99, background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 500 }}>
                    Building Owner's Surveyor
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Status</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: projColour }}>{project.status || 'active'}</span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Building owner</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{bo}</div>
                  {boEmail && <div style={{ fontSize: 12.5, color: 'var(--blue)', marginTop: 2 }}>{boEmail}</div>}
                  <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', marginTop: 6, fontSize: 11.5 }}>📧 Send BO LoA</button>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Address</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{address}</div>
                </div>
                {works && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Works</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)' }}>{works}</div>
                  </div>
                )}
              </div>

              {/* Stage bar */}
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {STAGES.map((stage, i) => (
                  <div key={stage} style={{
                    flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 11.5,
                    fontWeight: i === stageIndex ? 600 : 400,
                    background: i === stageIndex ? projColour : i < stageIndex ? `${projColour}33` : 'transparent',
                    color: i === stageIndex ? '#fff' : i < stageIndex ? projColour : 'var(--text3)',
                    borderRight: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>{stage}</div>
                ))}
              </div>
            </div>

            {/* AOs */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Adjoining owners</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>+ Add AO</button>
              </div>
              {aos.length === 0
                ? <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic', padding: '12px 0' }}>No adjoining owners recorded.</div>
                : aos.map((ao, i) => <AOCard key={ao.id || i} ao={ao} onOpenComposer={onOpenComposer} />)
              }
            </div>

            {/* Notices */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Notices</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>+ Serve notice</button>
              </div>
              {notices.length === 0
                ? <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No notices served yet.</div>
                : notices.map((n, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{n.type || n.ref || 'Notice'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                        {n.servedDate && `Served: ${fmtDate(n.servedDate)}`}
                        {n.consentDeadline && ` · Consent deadline: ${fmtDate(n.consentDeadline)}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--green)' }}>Served</span>
                      <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', color: 'var(--red)', fontSize: 11 }}>Delete</button>
                    </div>
                  </div>
                ))
              }
            </div>

            {/* Awards */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Awards</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>+ Draft award</button>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No awards drafted yet.</div>
            </div>
          </div>

          {/* ── RIGHT: sidebar ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Upcoming & tasks */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>📅 Upcoming & tasks</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 11 }}>+ Task</button>
              </div>
              {upcoming.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No upcoming deadlines.</div>
                : upcoming.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 2 }}>
                      {fmtDate(u.date)?.toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: u.days !== null && u.days < 3 ? 'var(--red)' : 'var(--blue)', flexShrink: 0 }} />
                      <span style={{ color: 'var(--text2)', lineHeight: 1.4 }}>{u.label}</span>
                      <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer' }}>open</button>
                    </div>
                  </div>
                ))
              }
            </div>

            {/* SOC Dictation */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', cursor: 'pointer' }}
              onClick={() => setShowSOC(true)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--purple-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎙️</div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>SOC Dictation</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Dictate conditions · generate DOCX</div>
                </div>
                <div style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 13 }}>›</div>
              </div>
            </div>

            {/* Project Chat shortcut */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', cursor: 'pointer' }}
              onClick={() => setTab('chat')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--blue-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>💬</div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Project Chat</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>SOC · site notes · SE queries · emails</div>
                </div>
                <div style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 13 }}>›</div>
              </div>
            </div>

            {/* Documents */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Documents</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => setTab('documents')}>Expand</button>
                  <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 11 }}>+ Upload</button>
                </div>
              </div>
              {documents.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No documents yet.</div>
                : documents.slice(0, 4).map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{d.file_name?.replace(/\.[^.]+$/, '') || 'Document'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{d.created_at ? new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 10.5 }}>Preview</button>
                      <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 10.5 }}>DOCX</button>
                    </div>
                  </div>
                ))
              }
              {documents.length > 4 && (
                <div style={{ fontSize: 11.5, color: 'var(--blue)', marginTop: 8, cursor: 'pointer' }} onClick={() => setTab('documents')}>
                  +{documents.length - 4} more documents
                </div>
              )}
            </div>

            {/* Financials */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Financials</div>
                <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11, color: 'var(--amber)', borderColor: 'var(--amber)' }}>💰 Raise invoice</button>
              </div>
              {[
                { label: 'Projected',   value: fmtGBP(project.fee),         colour: 'var(--text)' },
                { label: 'Invoiced',    value: fmtGBP(project.fee_invoiced), colour: project.fee_invoiced > 0 ? 'var(--blue)'  : 'var(--red)' },
                { label: 'Paid',        value: fmtGBP(project.fee_paid),     colour: project.fee_paid > 0     ? 'var(--green)' : 'var(--text3)' },
                { label: 'Outstanding', value: fmtGBP((parseFloat(project.fee_invoiced) || 0) - (parseFloat(project.fee_paid) || 0)), colour: 'var(--amber)' },
              ].map(({ label, value, colour }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text2)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: colour }}>{value}</span>
                </div>
              ))}
            </div>

          </div>{/* end sidebar */}
        </div>
      )}

      {/* ── EMAILS TAB ── */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}
              onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>+ Compose</button>
          </div>
          {emailsLoading
            ? <div style={{ color: 'var(--text3)', fontSize: 13, padding: 20 }}>Loading emails…</div>
            : emails.length === 0
              ? <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>No emails linked to this project.</div>
              : emails.map(email => (
                <div key={email.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: email.is_read ? 'transparent' : 'var(--blue-bg)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: email.is_read ? 400 : 600, color: 'var(--text)' }}>{email.sender_name || email.sender_email}</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{email.received_at ? new Date(email.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: email.is_read ? 400 : 600, color: 'var(--text2)', marginBottom: 3 }}>{email.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.body_preview}</div>
                </div>
              ))
          }
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>+ Upload</button>
          </div>
          {documents.length === 0
            ? <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>No documents uploaded yet.</div>
            : documents.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>📄 {d.file_name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{d.created_at ? new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11.5 }}>Preview</button>
                  <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 11.5 }}>DOCX</button>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === 'chat' && <ProjectChat project={project} onOpenComposer={onOpenComposer} />}
    </div>
  );
}
