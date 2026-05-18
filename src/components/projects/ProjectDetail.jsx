import { useState, useEffect, useRef, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import sb from '../../supabaseClient';

// ── Field helpers — matches actual JSONB structure from old app ───────────────
const aoAddress   = ao => ao.premise   || ao.reg_addr   || ao.address || '';
const aoSurvName  = ao => ao.surv_name  || ao.surveyorName  || '';
const aoSurvFirm  = ao => ao.surv_firm  || ao.surveyorFirm  || '';
const aoSurvEmail = ao => ao.surv_email || ao.surveyorEmail || '';
const aoSurvPhone = ao => ao.surv_phone || ao.surveyorPhone || '';
const aoConsent   = ao => ao.consent_deadline  || ao.consentDeadline  || '';
const aoNotice    = ao => ao.notice_served_date || ao.noticeServedDate || '';
const aoS10       = ao => ao.s10_deadline       || ao.s10Deadline      || '';
const aoName2     = ao => ao.name2 || '';

const STAGES = ['Notice served', 'Consent', 'Appt made', 'Award', 'Complete'];

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtGBP(v) {
  return `£${(parseFloat(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

// ── Colour logic using correct field names ────────────────────────────────────
function getAOColour(ao) {
  const st = (ao.status || '').toLowerCase();
  if (st === 'consent') return '#22c55e';
  if (st === 'dissent' || st === 's10') return '#ef4444';
  const cd = aoConsent(ao);
  const sd = aoS10(ao);
  const now = Date.now();
  if ((cd && new Date(cd).getTime() < now) || (sd && sd && new Date(sd).getTime() < now)) return '#ef4444';
  if (cd || aoNotice(ao)) return '#22c55e';
  if (st === 'notice_served' || st === 'details_added') return '#22c55e';
  if (aoAddress(ao)) return '#a855f7'; // has details but no notice
  return '#9ca3af'; // grey
}

function getProjectColour(project) {
  const aos = project.aos || [];
  if (!aos.length) return '#9ca3af';
  const now = Date.now();
  const hasOverdue = aos.some(ao => {
    const cd = aoConsent(ao); const sd = aoS10(ao); const st = (ao.status || '').toLowerCase();
    if (cd && new Date(cd).getTime() < now && st !== 'consent' && st !== 'dissent') return true;
    if (sd && new Date(sd).getTime() < now) return true;
    return false;
  });
  if (hasOverdue) return '#ef4444';
  const hasNotice = aos.some(ao => aoNotice(ao) || aoConsent(ao) || ['notice_served'].includes((ao.status || '').toLowerCase()));
  if (hasNotice) return '#22c55e';
  const hasDetails = aos.some(ao => aoAddress(ao));
  if (hasDetails) return '#a855f7';
  return '#9ca3af';
}

// ── Card style helper ─────────────────────────────────────────────────────────
const card = (extra = {}) => ({
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  ...extra,
});

// ── AO Card ───────────────────────────────────────────────────────────────────
function AOCard({ ao, onOpenComposer }) {
  const colour  = getAOColour(ao);
  const address = aoAddress(ao);
  const name2   = aoName2(ao);
  const cd      = aoConsent(ao);
  const days    = daysUntil(cd);
  const survName  = aoSurvName(ao);
  const survFirm  = aoSurvFirm(ao);
  const survEmail = aoSurvEmail(ao);
  const survPhone = aoSurvPhone(ao);

  const statusLabel = {
    consent: 'Consented', dissent: 'Dissented', s10: 'S.10',
    notice_served: 'Notice served', details_added: 'Details added',
  }[(ao.status || '').toLowerCase()] || '';

  return (
    <div style={{ ...card({ marginBottom: 12, overflow: 'hidden' }) }}>
      <div style={{ display: 'flex' }}>
        {/* Colour stripe */}
        <div style={{ width: 5, background: colour, borderRadius: '16px 0 0 16px', flexShrink: 0 }} />

        <div style={{ flex: 1, padding: '14px 16px' }}>
          {/* Name & status */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colour }}>
                AO{ao.num} — {(ao.name || '').toUpperCase()}
              </div>
              {name2 && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{name2}</div>}
            </div>
            {statusLabel && (
              <span style={{ fontSize: 12, fontWeight: 600, color: colour, flexShrink: 0, paddingLeft: 8 }}>{statusLabel}</span>
            )}
          </div>

          {/* Address */}
          {address && (
            <div style={{ fontSize: 13, color: 'var(--blue)', marginBottom: 4, lineHeight: 1.4 }}>
              {address}
            </div>
          )}

          {/* Phone */}
          {ao.phone && (
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              📞 {ao.phone}
            </div>
          )}

          {/* Consent deadline countdown */}
          {cd && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, margin: '6px 0',
              padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
              background: days !== null && days < 0 ? 'var(--red-bg)' : days !== null && days <= 7 ? 'var(--amber-bg)' : 'var(--green-bg)',
              color: days !== null && days < 0 ? 'var(--red)' : days !== null && days <= 7 ? 'var(--amber)' : 'var(--green)',
            }}>
              ⏱ {days === null ? fmtDate(cd) : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d to consent deadline`}
            </div>
          )}

          {/* Agreed surveyor toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
            <div style={{
              width: 32, height: 18, borderRadius: 9, cursor: 'pointer', position: 'relative', flexShrink: 0,
              background: ao.agreed_surveyor ? 'var(--blue)' : 'var(--border2)',
            }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: ao.agreed_surveyor ? 16 : 2, transition: 'left 0.15s' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>I am the Agreed Surveyor for this AO</span>
          </div>

          {/* AO Surveyor block */}
          {(survName || survFirm) && (
            <div style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>AO Surveyor</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)', lineHeight: 1.5 }}>
                {survName}{survFirm ? ` — ${survFirm}` : ''}
              </div>
              {survEmail && <div style={{ fontSize: 12, color: 'var(--blue)',  marginTop: 3 }}>{survEmail}</div>}
              {survPhone && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>📞 {survPhone}</div>}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {['Consent', 'Dissent'].map(a => (
              <button key={a} style={{
                padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${a === 'Consent' ? 'var(--green)' : 'var(--red)'}`,
                background: 'transparent', color: a === 'Consent' ? 'var(--green)' : 'var(--red)',
              }}>{a}</button>
            ))}
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>Note intention</button>
            <button style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--purple)', background: 'transparent', color: 'var(--purple)' }}>
              Schedule of Condition
            </button>
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>Edit</button>
            {ao.email
              ? <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}
                  onClick={() => onOpenComposer?.({ mode: 'compose', to: ao.email, toName: ao.name })}>
                  📧 Email AO
                </button>
              : <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99, opacity: 0.5 }}>✉ Add email first</button>
            }
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>
              Agreed Surveyor LoA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SOC Modal ─────────────────────────────────────────────────────────────────
function SOCModal({ project, onClose }) {
  const [messages, setMessages] = useState([{
    id: 0, role: 'ely',
    content: `Ready to dictate the Schedule of Condition for ${project.ref}.\n\nTell me the room you're in and describe what you see — I'll structure it as we go.\n\nStart with: "Room 1 — [room name]"`
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
    } catch {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: 'Something went wrong. Please try again.' }]);
    }
  }, [input, loading, send]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 680, maxWidth: '95vw', height: '80vh', ...card({ display: 'flex', flexDirection: 'column', overflow: 'hidden' }) }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>🎙️ SOC Dictation</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{project.ref} — {project.address}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map(msg => (
            <div key={msg.id} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%',
              background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
              color: msg.role === 'user' ? '#fff' : 'var(--text)',
              padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>{msg.content}</div>
          ))}
          {loading && <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>✨ Processing…</div>}
          <div ref={endRef} />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
            placeholder="Dictate room observations…" rows={2}
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', outline: 'none' }} />
          <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', alignSelf: 'flex-end' }}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ── Project Chat tab ──────────────────────────────────────────────────────────
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
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            Ask Ely anything about {project.ref}
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
          style={{ flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', outline: 'none' }} />
        <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', alignSelf: 'flex-end' }}>Send</button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProjectDetail({ project, onBack, onOpenComposer }) {
  const [tab, setTab]       = useState('details');
  const [showSOC, setShowSOC] = useState(false);
  const [emails, setEmails]   = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const address  = project.address  || project.bo_premise_address || '';
  const bo       = project.bo       || project.bo_1_name || '';
  const boEmail  = project.bo_email || project.bo_1_email || '';
  const works    = project.works    || '';
  const aos      = project.aos      || [];
  const docs     = project.documents || [];
  const projColour = getProjectColour(project);

  // Stage
  const stageIndex = project.status === 'complete' ? 4
    : aos.some(ao => ['consent','dissent','s10'].includes((ao.status||'').toLowerCase())) ? 2
    : aos.some(ao => aoNotice(ao) || (ao.status||'').toLowerCase() === 'notice_served') ? 1
    : 0;

  // Upcoming deadlines
  const upcoming = [];
  aos.forEach(ao => {
    const cd = aoConsent(ao);
    if (cd) upcoming.push({ label: `Consent deadline — ${aoAddress(ao) || ao.name}`, date: cd, days: daysUntil(cd) });
    const sd = aoS10(ao);
    if (sd) upcoming.push({ label: `S.10 deadline — ${ao.name}`, date: sd, days: daysUntil(sd) });
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  useEffect(() => {
    if (tab !== 'emails' || !sb) return;
    setEmailsLoading(true);
    sb.from('emails')
      .select('id,subject,sender_name,sender_email,received_at,is_read,body_preview')
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
    <div style={{ padding: '0 24px 32px' }}>
      {showSOC && <SOCModal project={project} onClose={() => setShowSOC(false)} />}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 14px' }}>
        <button onClick={onBack} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 16px', borderRadius: 99,
          border: '1px solid var(--border)', background: 'var(--bg2)',
          color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontWeight: 500,
        }}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Edit</button>
          <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', color: 'var(--red)', borderRadius: 99 }}>Delete</button>
          <button style={{
            padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--amber)',
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

      {/* ── DETAILS: two-column ── */}
      {tab === 'details' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>

          {/* LEFT */}
          <div>
            {/* Project header */}
            <div style={{ ...card({ padding: '18px 20px', marginBottom: 16 }) }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14, lineHeight: 1.4 }}>
                {project.ref} — {bo} — {address}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Role</div>
                  <span style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 99, background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 500 }}>Building Owner's Surveyor</span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Status</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: projColour }}>{project.status || 'active'}</span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Building owner</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{bo}</div>
                  {boEmail && <div style={{ fontSize: 12.5, color: 'var(--blue)', marginTop: 2 }}>{boEmail}</div>}
                  <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', marginTop: 6, fontSize: 12, borderRadius: 99 }}>📧 Send BO LoA</button>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Address</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{address}</div>
                </div>
                {works && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Works</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)' }}>{works}</div>
                  </div>
                )}
              </div>
              {/* Stage bar */}
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {STAGES.map((s, i) => (
                  <div key={s} style={{
                    flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 11.5,
                    fontWeight: i === stageIndex ? 600 : 400,
                    background: i === stageIndex ? projColour : i < stageIndex ? `${projColour}33` : 'transparent',
                    color: i === stageIndex ? '#fff' : i < stageIndex ? projColour : 'var(--text3)',
                    borderRight: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>{s}</div>
                ))}
              </div>
            </div>

            {/* AOs */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Adjoining owners</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add AO</button>
              </div>
              {aos.length === 0
                ? <div style={{ ...card({ padding: '20px', textAlign: 'center' }) }}>
                    <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>No adjoining owners recorded yet.</div>
                  </div>
                : aos.map((ao, i) => <AOCard key={ao.id || i} ao={ao} onOpenComposer={onOpenComposer} />)
              }
            </div>
          </div>

          {/* RIGHT SIDEBAR */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Upcoming & tasks */}
            <div style={{ ...card({ padding: '14px 16px' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>📅 Upcoming & tasks</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 11, borderRadius: 99 }}>+ Task</button>
              </div>
              {upcoming.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No upcoming deadlines.</div>
                : upcoming.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{fmtDate(u.date)}</div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: u.days !== null && u.days <= 3 ? 'var(--red)' : 'var(--blue)' }} />
                      <span style={{ color: 'var(--text2)', lineHeight: 1.4, flex: 1 }}>{u.label}</span>
                    </div>
                  </div>
                ))
              }
            </div>

            {/* SOC Dictation */}
            <div style={{ ...card({ padding: '14px 16px', cursor: 'pointer' }) }}
              onClick={() => setShowSOC(true)}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--purple-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎙️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>SOC Dictation</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>Dictate conditions · generate DOCX</div>
                </div>
                <span style={{ color: 'var(--text3)', fontSize: 16 }}>›</span>
              </div>
            </div>

            {/* Financials */}
            <div style={{ ...card({ padding: '14px 16px' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Financials</div>
                <button style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>
                  💰 Raise invoice
                </button>
              </div>
              {[
                { label: 'Projected',   val: fmtGBP(project.fee),          colour: 'var(--text)' },
                { label: 'Invoiced',    val: fmtGBP(project.fee_invoiced),  colour: parseFloat(project.fee_invoiced) > 0 ? 'var(--blue)' : 'var(--red)' },
                { label: 'Paid',        val: fmtGBP(project.fee_paid),      colour: parseFloat(project.fee_paid) > 0 ? 'var(--green)' : 'var(--text3)' },
                { label: 'Outstanding', val: fmtGBP((parseFloat(project.fee_invoiced)||0) - (parseFloat(project.fee_paid)||0)), colour: 'var(--amber)' },
              ].map(({ label, val, colour }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text2)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: colour }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── EMAILS TAB ── */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}
              onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>+ Compose</button>
          </div>
          <div style={{ ...card() }}>
            {emailsLoading
              ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading emails…</div>
              : emails.length === 0
                ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No emails linked to this project.</div>
                : emails.map((e, i) => (
                  <div key={e.id} style={{ padding: '12px 16px', borderBottom: i < emails.length - 1 ? '1px solid var(--border)' : 'none', background: e.is_read ? 'transparent' : 'var(--blue-bg)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: e.is_read ? 400 : 600, color: 'var(--text)' }}>{e.sender_name || e.sender_email}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: e.is_read ? 400 : 600, color: 'var(--text2)', marginBottom: 2 }}>{e.subject}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.body_preview}</div>
                  </div>
                ))
            }
          </div>
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Upload</button>
          </div>
          <div style={{ ...card() }}>
            {docs.length === 0
              ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No documents uploaded yet.</div>
              : docs.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < docs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>📄 {d.file_name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{fmtDate(d.created_at)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Preview</button>
                    <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>DOCX</button>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === 'chat' && <ProjectChat project={project} onOpenComposer={onOpenComposer} />}
    </div>
  );
}
