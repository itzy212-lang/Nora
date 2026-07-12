import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.06)',
};

function StatCard({ label, value, colour, isMobile }) {
  const colours = {
    blue:   'var(--blue)',
    amber:  'var(--amber)',
    red:    'var(--red)',
    green:  'var(--green)',
    purple: 'var(--purple)',
    default:'var(--text)',
  };
  const c = colours[colour] || colours.default;
  return (
    <div style={{ ...cardStyle, padding: isMobile ? '16px' : '18px 20px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 700, color: c, letterSpacing: '-0.5px', lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

const ageDays = (dateStr) => {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
};

const ageLabel = (days) => {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days}d`;
};

const ageColour = (days) => {
  if (days <= 0) return 'var(--green)';
  if (days <= 2) return 'var(--amber)';
  return 'var(--red)';
};

export default function Dashboard({ onNavigate, onOpenProject }) {
  const { state } = useApp();
  const { projects = [], leads = [] } = state;

  const isMobile = window.innerWidth < 768;

  const [briefing, setBriefing] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(false);
  const briefingLoaded = useRef(false);

  const [invoices, setInvoices] = useState([]);
  const [freshLeads, setFreshLeads] = useState(leads);
  const [inboxEmails, setInboxEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  // Load leads
  useEffect(() => {
    if (!sb) return;
    sb.from('leads').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setFreshLeads(data);
    });
  }, []);

  // Load invoices
  useEffect(() => {
    if (!sb) return;
    sb.from('invoices').select('*').then(({ data }) => {
      if (data) setInvoices(data);
    });
  }, []);

  // Load inbox emails (inbound, not sent, not draft, last 60 days)
  const loadInboxEmails = useCallback(async () => {
    if (!sb) return;
    setEmailsLoading(true);
    try {
      const since = new Date(Date.now() - 60 * 86400000).toISOString();
      const { data } = await sb
        .from('emails')
        .select('id, sender_name, sender_email, subject, received_at, is_read, is_replied, flagged, project_id, body_preview, folder')
        .not('folder', 'eq', 'sent')
        .or('is_sent.is.null,is_sent.eq.false')
        .or('is_draft.is.null,is_draft.eq.false')
        .gte('received_at', since)
        .order('received_at', { ascending: false })
        .limit(60);
      if (data) setInboxEmails(data);
    } catch (err) {
      console.warn('[Dashboard] inbox emails load failed:', err.message);
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  useEffect(() => { loadInboxEmails(); }, [loadInboxEmails]);

  // Helper — is a project closed (award served on all AOs, or manually closed)
  const isProjectClosed = (p) => {
    if (p.status === 'complete' || p.status === 'closed' || p.status === 'award_served') return true;
    const aos = p.aos || [];
    if (aos.length === 0) return false;
    // Closed if ALL AOs have award served
    return aos.every(ao => !!(ao.award_served_date || ao.awardServedDate || (ao.status || '') === 'complete'));
  };

  // Helper — does an AO show as RED on the project list (i.e. needs urgent attention)
  const aoIsRed = (ao) => {
    const st = (ao?.status || '').toLowerCase();
    if (ao?.award_served_date || ao?.awardServedDate || st === 'complete') return false;
    // S10 deadline overdue
    if (st === 's10' || st === 'notice_served') {
      const deadline = ao?.s10_deadline || ao?.s10Deadline || ao?.consent_deadline || ao?.consentDeadline || '';
      if (deadline && new Date(deadline) < new Date()) return true;
    }
    // Dissent with no surveyor appointed
    if (st === 'dissent' && !ao?.ao_surveyor_name && !ao?.aoSurveyorName) return true;
    return false;
  };

  // Stats
  const activeProjects = projects.filter(p => !isProjectClosed(p)).length;

  const needsAttention = projects.filter(p => !isProjectClosed(p)).reduce((sum, p) =>
    sum + (p.aos || []).filter(aoIsRed).length, 0);

  const feePipeline = projects
    .filter(p => !isProjectClosed(p))
    .reduce((s, p) => s + Math.max(0, parseFloat(p.fee || 0) - parseFloat(p.fee_invoiced || 0)), 0);

  const leadPipeline = freshLeads
    .filter(l => (l.lead_stage || l.status) !== 'lost')
    .reduce((s, l) => s + parseFloat(l.estimated_value || l.fee || 0), 0);

  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const unpaidInvoices = invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + parseFloat(i.total || 0), 0);
  const paidThisMonth  = invoices.filter(i => i.status === 'paid' && i.paid_date && new Date(i.paid_date) >= monthStart).reduce((s, i) => s + parseFloat(i.total || 0), 0);
  const overdue        = invoices.filter(i => i.status === 'unpaid' && i.due_date && new Date(i.due_date) < new Date()).reduce((s, i) => s + parseFloat(i.total || 0), 0);

  const activeLeads = [...freshLeads]
    .filter(l => ['new','contacted','quoted','follow_up'].includes(l.lead_stage || l.status))
    .sort((a, b) => (a._t || 0) - (b._t || 0))
    .slice(0, 5);

  // Upcoming deadlines
  const in14 = now + 14 * 86400000;
  const upcoming = [];
  projects.forEach(p => {
    (p.aos || []).forEach(ao => {
      if (ao.consentDeadline) {
        const d = new Date(ao.consentDeadline).getTime();
        if (d >= now && d <= in14) upcoming.push({ label: `Consent deadline - ${ao.label || 'AO'} - ${p.address}`, date: d, projectId: p.id });
      }
      if (ao.s10Deadline) {
        const d = new Date(ao.s10Deadline).getTime();
        if (d >= now && d <= in14) upcoming.push({ label: `S10 deadline - ${ao.label || 'AO'} - ${p.address}`, date: d, projectId: p.id });
      }
    });
    (p.reminders || []).forEach(r => {
      const d = new Date(r.date).getTime();
      if (d >= now && d <= in14) upcoming.push({ label: `${r.text} - ${p.address}`, date: d, projectId: p.id });
    });
  });
  upcoming.sort((a, b) => a.date - b.date);

  const dayGroups = [];
  upcoming.forEach(item => {
    const d = new Date(item.date);
    const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else dayGroups.push({ label, items: [item] });
  });

  // Email attention: flagged first, then unread, sorted oldest-first within each group
  const flaggedEmails = inboxEmails.filter(e => e.flagged);
  const unrepliedEmails = inboxEmails.filter(e => !e.flagged && !e.is_replied);
  const attentionEmails = [
    ...flaggedEmails.sort((a, b) => new Date(a.received_at) - new Date(b.received_at)),
    ...unrepliedEmails.sort((a, b) => new Date(a.received_at) - new Date(b.received_at)),
  ].slice(0, 15);

  const unreadCount = inboxEmails.filter(e => !e.is_read).length;
  const flaggedCount = inboxEmails.filter(e => e.flagged).length;

  // Toggle flag on email
  const toggleFlag = useCallback(async (emailId, currentFlagged, e) => {
    e.stopPropagation();
    if (!sb) return;
    setInboxEmails(prev => prev.map(em => em.id === emailId ? { ...em, flagged: !currentFlagged } : em));
    await sb.from('emails').update({ flagged: !currentFlagged }).eq('id', emailId);
  }, []);

  // Morning briefing
  const refreshBriefing = useCallback(async () => {
    setBriefingLoading(true);
    setBriefing('');

    const projSummary = projects
      .filter(p => p.status !== 'complete')
      .slice(0, 10)
      .map(p => `${p.address || p.ref} (${p.status || 'active'})`)
      .join('; ');

    const deadlineSummary = upcoming
      .slice(0, 5)
      .map(u => `${u.label} on ${new Date(u.date).toLocaleDateString('en-GB')}`)
      .join('; ');

    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const emailSummary = `${unreadCount} unread, ${flaggedCount} flagged, ${attentionEmails.length} needing attention`;

    const prompt = `Morning briefing for Itzik - ${today}.

Active projects (${activeProjects}): ${projSummary || 'none'}.
Needs attention: ${needsAttention} project AOs with urgent status.
Upcoming deadlines (14 days): ${deadlineSummary || 'none'}.
Email inbox: ${emailSummary}.
Unpaid invoices: £${unpaidInvoices.toLocaleString('en-GB', { maximumFractionDigits: 0 })}.
Active leads: ${activeLeads.length}.

Give Itzik a concise morning briefing in 2-3 sentences. UK English. No bullet points. No AI phrases. Focus on what needs attention today. Be direct and practical like a trusted colleague.`;

    try {
      const res = await fetch('/api/ely-smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'morning_briefing', prompt }),
      });
      const data = await res.json();
      const text = data.reply || data.message || '';
      setBriefing(text || 'No briefing available.');

      // Cache for today
      try {
        const todayKey = new Date().toISOString().slice(0, 10);
        sessionStorage.setItem('ely_briefing_date', todayKey);
        sessionStorage.setItem('ely_briefing_text', text);
      } catch {}
    } catch {
      setBriefing('Could not load briefing.');
    }

    setBriefingLoading(false);
  }, [projects, upcoming, activeProjects, needsAttention, unreadCount, flaggedCount, attentionEmails.length, unpaidInvoices, activeLeads.length]);

  // Auto-load briefing once per session (cached per calendar day)
  useEffect(() => {
    if (briefingLoaded.current) return;
    briefingLoaded.current = true;

    try {
      const todayKey = new Date().toISOString().slice(0, 10);
      const cachedDate = sessionStorage.getItem('ely_briefing_date');
      const cachedText = sessionStorage.getItem('ely_briefing_text');
      if (cachedDate === todayKey && cachedText) {
        setBriefing(cachedText);
        return;
      }
    } catch {}

    // Small delay so project/email data loads first
    const timer = setTimeout(refreshBriefing, 1200);
    return () => clearTimeout(timer);
  }, [refreshBriefing]);

  const fmt = v => v === 0 ? '£0' : `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

  return (
    <div style={{ padding: isMobile ? '16px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 16, background: '#f1f3f6', minHeight: '100%' }}>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 14 }}>
        <StatCard label="Active projects" value={activeProjects} colour="blue" isMobile={isMobile} />
        <StatCard label="Unpaid invoices" value={fmt(unpaidInvoices)} colour="amber" isMobile={isMobile} />
        <StatCard label="Needs attention" value={needsAttention} colour="red" isMobile={isMobile} />
        <StatCard label="Fee pipeline" value={fmt(feePipeline)} colour="green" isMobile={isMobile} />
        <StatCard label="Lead pipeline" value={fmt(leadPipeline)} colour="purple" isMobile={isMobile} />
      </div>

      {/* Briefing + Cashflow */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 1fr', gap: 14 }}>
        <div style={{ ...cardStyle, padding: isMobile ? '18px' : '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              ✨ Morning Briefing
            </div>
            <button onClick={refreshBriefing} disabled={briefingLoading} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontWeight: 500, padding: 0 }}>
              {briefingLoading ? '…' : '↻ REFRESH'}
            </button>
          </div>
          <div style={{ fontSize: isMobile ? 15 : 13, color: briefing ? 'var(--text2)' : 'var(--text3)', lineHeight: 1.7, minHeight: isMobile ? 80 : 60, fontStyle: briefing ? 'normal' : 'italic' }}>
            {briefingLoading ? 'Generating your briefing…' : briefing || 'Loading briefing…'}
          </div>
        </div>

        <div style={{ ...cardStyle, padding: isMobile ? '18px' : '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>💰 Cash Flow</div>
            <span onClick={() => onNavigate('accounting')} style={{ fontSize: 11, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}>VIEW →</span>
          </div>
          {[
            { label: 'Paid this month', val: fmt(paidThisMonth), colour: 'var(--green)' },
            { label: 'Unpaid invoices', val: fmt(unpaidInvoices), colour: 'var(--amber)' },
            { label: 'Overdue', val: fmt(overdue), colour: 'var(--red)' },
          ].map(({ label, val, colour }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #edf0f4', fontSize: isMobile ? 15 : 12.5 }}>
              <span style={{ color: 'var(--text2)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: colour }}>{val}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 0', fontSize: isMobile ? 16 : 13 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Remaining to invoice</span>
            <span style={{ fontWeight: 700, color: 'var(--blue)', fontSize: isMobile ? 22 : 15 }}>{fmt(feePipeline)}</span>
          </div>
        </div>
      </div>

      {/* Emails needing attention */}
      <div style={{ ...cardStyle, padding: isMobile ? '18px' : '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              📧 Emails Needing Attention
            </div>
            {unreadCount > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: 'var(--red)', padding: '2px 7px', borderRadius: 99 }}>
                {unreadCount} unread
              </span>
            )}
            {flaggedCount > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 600, background: 'rgba(245,158,11,0.1)', color: 'var(--amber)', padding: '2px 7px', borderRadius: 99 }}>
                {flaggedCount} flagged
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={loadInboxEmails} disabled={emailsLoading} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontWeight: 500, padding: 0 }}>
              {emailsLoading ? '…' : '↻'}
            </button>
            <span onClick={() => onNavigate('inbox')} style={{ fontSize: 11.5, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}>ALL →</span>
          </div>
        </div>

        {emailsLoading ? (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>Loading emails…</div>
        ) : attentionEmails.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No emails needing attention.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {attentionEmails.map(email => {
              const days = ageDays(email.received_at);
              const isFlagged = email.flagged;
              return (
                <div
                  key={email.id}
                  onClick={() => onNavigate('inbox')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: isMobile ? '12px' : '8px 10px',
                    borderRadius: 10,
                    border: `1px solid ${isFlagged ? 'rgba(245,158,11,0.3)' : '#edf0f4'}`,
                    background: isFlagged ? 'rgba(245,158,11,0.04)' : email.is_read ? '#fafafa' : '#f0f4ff',
                    cursor: 'pointer',
                  }}
                >
                  {/* Flag button */}
                  <button
                    onClick={(e) => toggleFlag(email.id, isFlagged, e)}
                    title={isFlagged ? 'Remove flag' : 'Flag this email'}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: 0,
                      flexShrink: 0,
                      opacity: isFlagged ? 1 : 0.3,
                      color: isFlagged ? 'var(--amber)' : 'var(--text3)',
                    }}
                  >
                    🚩
                  </button>

                  {/* Unread dot */}
                  {!email.is_read && (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />
                  )}

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: isMobile ? 13.5 : 12.5, fontWeight: email.is_read ? 400 : 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                        {email.sender_name || email.sender_email || 'Unknown'}
                      </span>
                      <span style={{ fontSize: isMobile ? 13 : 12, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {email.subject || '(no subject)'}
                      </span>
                    </div>
                    {email.body_preview && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {email.body_preview.slice(0, 120)}
                      </div>
                    )}
                  </div>

                  {/* Age */}
                  <span style={{ fontSize: 11, fontWeight: 600, color: ageColour(days), background: `${ageColour(days)}22`, padding: '2px 7px', borderRadius: 99, flexShrink: 0 }}>
                    {ageLabel(days)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Leads + Next 14 Days */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr', gap: 14 }}>

        {/* Leads */}
        <div style={{ ...cardStyle, padding: isMobile ? '18px' : '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>🎯 Leads</div>
            <span onClick={() => onNavigate('leads')} style={{ fontSize: 11.5, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}>ALL →</span>
          </div>
          {activeLeads.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No active leads.</div>
          ) : activeLeads.map(lead => {
            const days = lead._t ? Math.floor((Date.now() - lead._t) / 86400000) : 0;
            return (
              <div key={lead.id} onClick={() => onNavigate('leads')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '12px' : '9px 10px', borderRadius: 12, marginBottom: 6, border: '1px solid #e7eaf0', cursor: 'pointer', background: '#fafafa' }}>
                <div>
                  <div style={{ fontSize: isMobile ? 14 : 13, fontWeight: 500, color: 'var(--text)' }}>{lead.contact_name || lead.name}</div>
                  {(lead.project_address || lead.address) && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{lead.project_address || lead.address}</div>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: ageColour(days), background: `${ageColour(days)}22`, padding: '2px 7px', borderRadius: 99 }}>
                  {days}d
                </span>
              </div>
            );
          })}
        </div>

        {/* Next 14 Days */}
        <div style={{ ...cardStyle, padding: isMobile ? '18px' : '16px 20px', overflowY: 'auto', maxHeight: isMobile ? 'unset' : 340 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>📅 Next 14 Days</div>
            <span onClick={() => onNavigate('calendar')} style={{ fontSize: 11.5, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}>CALENDAR →</span>
          </div>
          {dayGroups.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No upcoming deadlines.</div>
          ) : dayGroups.map(({ label, items }) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.5px', marginBottom: 5 }}>{label}</div>
              {items.map((item, i) => (
                <div key={i} onClick={() => item.projectId && onOpenProject?.(projects.find(p => p.id === item.projectId))} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '12px' : '7px 10px', fontSize: isMobile ? 14 : 12.5, color: 'var(--text2)', cursor: item.projectId ? 'pointer' : 'default', border: '1px solid #edf0f4', background: '#fafafa', borderRadius: 10, marginBottom: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.projectId && <span style={{ fontSize: 10.5, color: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}>open</span>}
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
