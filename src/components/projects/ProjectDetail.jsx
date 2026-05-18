import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import { useEly } from '../../hooks/useEly';
import sb from '../../supabaseClient';

const STAGES = ['Notice served', 'Consent', 'Appt made', 'Award', 'Complete'];

// ── Colour logic (same as ProjectList) ────────────────────────────────────────
function getAOColour(ao) {
  const now = Date.now();
  const st = (ao.status || ao.ao_status || '').toLowerCase();
  if (st === 'consent') return '#22c55e';
  if (st === 'dissent') return '#ef4444';
  const cd = ao.consentDeadline || ao.ao_consent_deadline;
  const sd = ao.s10Deadline     || ao.ao_s10_deadline;
  if (cd && new Date(cd).getTime() < now) return '#ef4444'; // overdue
  if (sd && new Date(sd).getTime() < now) return '#ef4444';
  if (cd || ao.noticeServedDate || ao.ao_notice_served_date) return '#22c55e'; // notice served
  return '#a855f7'; // AO exists but no notice
}

function getProjectColour(project) {
  const aos = project.aos || [];
  if (aos.length === 0) return '#9ca3af';
  const now = Date.now();
  const hasOverdue = aos.some(ao => {
    const cd = ao.consentDeadline || ao.ao_consent_deadline;
    const sd = ao.s10Deadline     || ao.ao_s10_deadline;
    const st = (ao.status || ao.ao_status || '').toLowerCase();
    if (cd && new Date(cd).getTime() < now && st !== 'consent' && st !== 'dissent') return true;
    if (sd && new Date(sd).getTime() < now) return true;
    return false;
  });
  if (hasOverdue) return '#ef4444';
  const hasNotices = aos.some(ao => ao.consentDeadline || ao.noticeServedDate || ao.ao_notice_served_date || ao.ao_consent_deadline);
  if (hasNotices) return '#22c55e';
  return '#a855f7';
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    consent:  { label: 'Consented',  bg: '#dcfce7', text: '#15803d' },
    dissent:  { label: 'Dissented',  bg: '#fee2e2', text: '#dc2626' },
    s10:      { label: 'S.10',       bg: '#fef9c3', text: '#854d0e' },
    pending:  { label: 'Awaiting',   bg: '#f3f4f6', text: '#6b7280' },
    unknown:  { label: 'Unknown',    bg: '#f3f4f6', text: '#6b7280' },
  };
  const s = map[(status || 'unknown').toLowerCase()] || map.unknown;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: s.bg, color: s.text }}>
      {s.label}
    </span>
  );
}

// ── AO Card (Image 3 style) ───────────────────────────────────────────────────
function AOCard({ ao, index, projectRef, onOpenComposer }) {
  const [open, setOpen] = useState(false);
  const colour = getAOColour(ao);
  const status = ao.status || ao.ao_status || 'unknown';
  const surveyorName  = ao.surveyorName  || ao.surveyor_name  || '';
  const surveyorFirm  = ao.surveyorFirm  || ao.surveyor_firm  || '';
  const surveyorEmail = ao.surveyorEmail || ao.surveyor_email || '';
  const name = ao.name || `AO ${index + 1}`;
  const address = ao.address || ao.ao_premise_address || '';

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      marginBottom: 10, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 0,
          cursor: 'pointer', background: 'var(--bg2)',
        }}
      >
        {/* Colour stripe */}
        <div style={{ width: 4, alignSelf: 'stretch', background: colour, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: colour }}>
              AO{index + 1} — {name}
            </div>
            {address && (
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{address}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusBadge status={status} />
            <span style={{ color: 'var(--text3)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg3)', padding: '14px 18px' }}>

          {/* Dates */}
          {(ao.consentDeadline || ao.noticeServedDate) && (
            <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
              {ao.noticeServedDate && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Notice served</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{fmtDate(ao.noticeServedDate)}</div>
                </div>
              )}
              {ao.consentDeadline && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Consent deadline</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{fmtDate(ao.consentDeadline)}</div>
                </div>
              )}
              {ao.s10Deadline && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>S.10 deadline</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{fmtDate(ao.s10Deadline)}</div>
                </div>
              )}
            </div>
          )}

          {/* AO contact */}
          {(ao.email || ao.phone) && (
            <div style={{ marginBottom: 12 }}>
              {ao.email && <div style={{ fontSize: 12.5, color: 'var(--blue)', marginBottom: 2 }}>{ao.email}</div>}
              {ao.phone && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{ao.phone}</div>}
            </div>
          )}

          {/* AO Surveyor */}
          {(surveyorName || surveyorFirm) && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>AO Surveyor</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)', lineHeight: 1.5 }}>
                {surveyorName}{surveyorFirm ? ` — ${surveyorFirm}` : ''}
              </div>
              {ao.surveyorAddress && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{ao.surveyorAddress}</div>}
              {surveyorEmail && <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 2 }}>{surveyorEmail}</div>}
              {ao.surveyorPhone && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{ao.surveyorPhone}</div>}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11.5 }}>
              Log surveyor
            </button>
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11.5 }}>
              Schedule of Condition
            </button>
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11.5 }}>
              Edit
            </button>
            {ao.email ? (
              <button
                className="btn btn-sm btn-ghost"
                style={{ cursor: 'pointer', fontSize: 11.5 }}
                onClick={() => onOpenComposer?.({ mode: 'compose', to: ao.email, toName: name })}
              >
                📧 Email AO
              </button>
            ) : (
              <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11.5, opacity: 0.5 }}>
                ✉ Add email first
              </button>
            )}
            {surveyorEmail && (
              <button
                className="btn btn-sm btn-ghost"
                style={{ cursor: 'pointer', fontSize: 11.5 }}
                onClick={() => onOpenComposer?.({ mode: 'compose', to: surveyorEmail, toName: surveyorName })}
              >
                ✉ Email surveyor
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project Chat (embedded) ───────────────────────────────────────────────────
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
    const userMsg = { id: Date.now(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    try {
      const result = await send(text);
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: result.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: `Sorry, something went wrong. ${err.message}` }]);
    }
  }, [input, loading, send]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }}>
      {/* Compose email shortcut */}
      <div style={{ padding: '10px 0 14px', borderBottom: '1px solid var(--border)', marginBottom: 14, display: 'flex', gap: 8 }}>
        <button
          className="btn btn-sm btn-ghost"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id, projectRef: project.ref })}
        >
          ✉ Compose email
        </button>
        <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>
          or chat with Ely below about this project
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            Ask Ely anything about this project — draft a notice, chase a response, summarise status…
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
            color: msg.role === 'user' ? '#fff' : 'var(--text)',
            padding: '10px 14px', borderRadius: 12,
            fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>
            ✨ Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={`Ask about ${project.ref}…`}
          rows={2}
          style={{
            flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none',
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="btn btn-primary btn-sm"
          style={{ cursor: 'pointer', alignSelf: 'flex-end' }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Main ProjectDetail ────────────────────────────────────────────────────────
export default function ProjectDetail({ project, onBack, onOpenComposer }) {
  const [tab, setTab] = useState('details');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({});
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const address  = project.address  || project.bo_premise_address || '';
  const bo       = project.bo       || project.bo_1_name || '';
  const boEmail  = project.bo_email || project.bo_1_email || '';
  const boPhone  = project.bo_phone || '';
  const works    = project.works    || '';
  const fee      = project.fee ? `£${parseFloat(project.fee).toLocaleString('en-GB')}` : '';
  const aos      = project.aos || [];
  const projColour = getProjectColour(project);

  // Stage: derive from AO statuses
  const hasConsent  = aos.some(ao => (ao.status || '').toLowerCase() === 'consent');
  const hasDissent  = aos.some(ao => (ao.status || '').toLowerCase() === 'dissent' || (ao.status || '').toLowerCase() === 's10');
  const hasNotices  = aos.some(ao => ao.consentDeadline || ao.noticeServedDate);
  const stageIndex  = project.status === 'complete' ? 4
                    : hasDissent ? 2
                    : hasConsent ? 2
                    : hasNotices ? 1
                    : 0;

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

  const handleSave = async () => {
    if (!sb) return;
    setSaving(true);
    try {
      await sb.from('projects').update({
        bo_premise_address: editData.address ?? address,
        bo_1_name:          editData.bo      ?? bo,
        bo_1_email:         editData.boEmail ?? boEmail,
        bo_phone:           editData.boPhone ?? boPhone,
        works:              editData.works   ?? works,
        fee:                parseFloat(editData.fee) || parseFloat(project.fee) || 0,
      }).eq('id', project.id);
      setEditing(false);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
    setSaving(false);
  };

  const TABS = [
    { id: 'details',   label: 'Details' },
    { id: 'chat',      label: '💬 Chat' },
    { id: 'emails',    label: 'Emails' },
    { id: 'documents', label: 'Documents' },
    { id: 'timeline',  label: 'Timeline' },
  ];

  return (
    <div style={{ padding: '24px 28px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            ← Projects
          </button>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{project.ref}</div>
          <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: `${projColour}22`, color: projColour }}>
            {project.status || 'active'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}
            onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id, projectRef: project.ref })}>
            ✉ Compose email
          </button>
          <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}
            onClick={() => setTab('chat')}>
            💬 Chat with Ely
          </button>
        </div>
      </div>

      {/* Stage bar */}
      <div style={{
        display: 'flex', background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20,
      }}>
        {STAGES.map((stage, i) => (
          <div key={stage} style={{
            flex: 1, textAlign: 'center', padding: '10px 0', fontSize: 12,
            fontWeight: i === stageIndex ? 600 : 400,
            background: i === stageIndex ? projColour : i < stageIndex ? `${projColour}33` : 'transparent',
            color: i === stageIndex ? '#fff' : i < stageIndex ? projColour : 'var(--text3)',
            borderRight: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            {stage}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 2 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
            background: 'none', fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
            borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── DETAILS TAB ── */}
      {tab === 'details' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Adjoining Owners</div>
              <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 11.5 }}>+ Add AO</button>
            </div>
            {aos.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic', padding: '16px 0' }}>No AOs recorded yet.</div>
            ) : aos.map((ao, i) => (
              <AOCard key={ao.id || i} ao={ao} index={i} projectRef={project.ref} onOpenComposer={onOpenComposer} />
            ))}
          </div>

          <div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Project details</div>
                {!editing ? (
                  <button onClick={() => { setEditing(true); setEditData({ address, bo, boEmail, boPhone, works, fee: project.fee }); }}
                    style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12.5, cursor: 'pointer', fontWeight: 500 }}>
                    ✎ Edit
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={handleSave} disabled={saving} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 }}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Address',  key: 'address',  val: editData.address  },
                    { label: 'BO Name',  key: 'bo',       val: editData.bo       },
                    { label: 'BO Email', key: 'boEmail',  val: editData.boEmail  },
                    { label: 'BO Phone', key: 'boPhone',  val: editData.boPhone  },
                    { label: 'Works',    key: 'works',    val: editData.works    },
                    { label: 'Fee (£)',  key: 'fee',      val: editData.fee      },
                  ].map(({ label, key, val }) => (
                    <div key={key}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
                      <input value={val || ''} onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                        style={{ width: '100%', padding: '7px 10px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  {[
                    { label: 'REF',      value: project.ref },
                    { label: 'STATUS',   value: project.status },
                    { label: 'ADDRESS',  value: address },
                    { label: 'FEE',      value: fee },
                    { label: 'BO',       value: bo },
                    { label: 'BO EMAIL', value: boEmail },
                    { label: 'BO PHONE', value: boPhone },
                    { label: 'WORKS',    value: works },
                  ].filter(r => r.value).map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === 'chat' && (
        <ProjectChat project={project} onOpenComposer={onOpenComposer} />
      )}

      {/* ── EMAILS TAB ── */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}
              onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>
              + Compose
            </button>
          </div>
          {emailsLoading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, padding: 20 }}>Loading emails…</div>
          ) : emails.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>No emails linked to this project.</div>
          ) : emails.map(email => (
            <div key={email.id} style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
              background: email.is_read ? 'transparent' : 'var(--blue-bg)', cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: email.is_read ? 400 : 600, color: 'var(--text)' }}>
                  {email.sender_name || email.sender_email}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {email.received_at ? new Date(email.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                </span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: email.is_read ? 400 : 600, color: 'var(--text2)', marginBottom: 3 }}>{email.subject}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.body_preview}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>
          {(project.documents || []).length === 0 ? 'No documents uploaded yet.' : (project.documents || []).map(d => (
            <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>📄 {d.file_name}</div>
          ))}
        </div>
      )}

      {/* ── TIMELINE TAB ── */}
      {tab === 'timeline' && (
        <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>Timeline coming soon.</div>
      )}
    </div>
  );
}
