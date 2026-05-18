import { useState, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import { fmtShort } from '../../utils/formatters';

const dashboardCardStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.06)',
};

function StatCard({ label, value, colour }) {
  const colours = {
    blue:  { val: 'var(--blue)'  },
    amber: { val: 'var(--amber)' },
    red:   { val: 'var(--red)'   },
    green: { val: 'var(--green)' },
    purple:{ val: 'var(--purple)' },
    default: { val: 'var(--text)' },
  };
  const c = colours[colour] || colours.default;
  return (
    <div style={{
      ...dashboardCardStyle,
      padding: '18px 20px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: c.val, letterSpacing: '-0.5px' }}>
        {value}
      </div>
    </div>
  );
}

export default function Dashboard({ onNavigate, onOpenProject }) {
  const { state } = useApp();
  const { projects = [], emails = [], leads = [], invoices = [] } = state;

  const [briefing, setBriefing] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(false);

  // ── Stats ──────────────────────────────────────────────
  const activeProjects = projects.filter(p => p.status !== 'complete').length;

  const unpaidInvoices = invoices
    .filter(inv => inv.status === 'unpaid' || inv.status === 'sent')
    .reduce((s, inv) => s + parseFloat(inv.amount || 0), 0);

  const needsAttention = projects.reduce((sum, p) =>
    sum + (p.aos || []).filter(ao =>
      ['notice_expired', 's10_expired', '104b_triggered', 'consent_due'].includes(ao.status)
    ).length, 0);

  const feePipeline = projects
    .filter(p => p.status !== 'complete')
    .reduce((s, p) => s + parseFloat(p.fee || 0), 0);

  const leadPipeline = leads
    .filter(l => l.status !== 'lost')
    .reduce((s, l) => s + parseFloat(l.fee || 0), 0);

  // ── Cash flow ──────────────────────────────────────────
  const now = Date.now();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const paidThisMonth = invoices
    .filter(inv => inv.status === 'paid' && inv.paidAt >= monthStart.getTime())
    .reduce((s, inv) => s + parseFloat(inv.amount || 0), 0);
  const unpaidTotal = invoices
    .filter(inv => inv.status === 'unpaid' || inv.status === 'sent')
    .reduce((s, inv) => s + parseFloat(inv.amount || 0), 0);
  const overdue = invoices
    .filter(inv => (inv.status === 'unpaid' || inv.status === 'sent') && inv.dueAt && inv.dueAt < now)
    .reduce((s, inv) => s + parseFloat(inv.amount || 0), 0);
  const uninvoicedPipeline = feePipeline;

  // ── Leads (for widget) ─────────────────────────────────
  const activeLeads = [...leads]
    .filter(l => l.status === 'new' || l.status === 'contacted')
    .sort((a, b) => (a._t || 0) - (b._t || 0))
    .slice(0, 5);

  // ── Next 14 days ──────────────────────────────────────
  const in14 = now + 14 * 86400000;
  const upcoming = [];
  projects.forEach(p => {
    (p.aos || []).forEach(ao => {
      if (ao.consentDeadline) {
        const d = new Date(ao.consentDeadline).getTime();
        if (d >= now && d <= in14) {
          upcoming.push({ label: `Consent deadline – ${p.ref} ${ao.label || 'AO'} – ${p.address}`, date: d, projectId: p.id, ref: p.ref });
        }
      }
      if (ao.s10Deadline) {
        const d = new Date(ao.s10Deadline).getTime();
        if (d >= now && d <= in14) {
          upcoming.push({ label: `S10 deadline – ${p.ref} ${ao.label || 'AO'} – ${p.address}`, date: d, projectId: p.id, ref: p.ref });
        }
      }
    });
    (p.reminders || []).forEach(r => {
      const d = new Date(r.date).getTime();
      if (d >= now && d <= in14) {
        upcoming.push({ label: `${r.text} – ${p.ref} – ${p.address}`, date: d, projectId: p.id, ref: p.ref });
      }
    });
  });
  upcoming.sort((a, b) => a.date - b.date);

  // Group by day label
  const dayGroups = [];
  upcoming.forEach(item => {
    const d = new Date(item.date);
    const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else dayGroups.push({ label, items: [item] });
  });

  // ── Morning briefing ───────────────────────────────────
  const refreshBriefing = useCallback(async () => {
    setBriefingLoading(true);
    setBriefing('');
    try {
      const projSummary = projects
        .filter(p => p.status !== 'complete')
        .slice(0, 10)
        .map(p => `${p.ref}: ${p.address}, status: ${p.status}`)
        .join('\n');
      const deadlineSummary = upcoming.slice(0, 5)
        .map(u => `${u.label} on ${new Date(u.date).toLocaleDateString('en-GB')}`)
        .join('\n');
      const res = await fetch('/api/ely-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: 'morning_briefing',
          message: 'Give me a brief morning briefing.',
          context: { projSummary, deadlineSummary, leadCount: activeLeads.length },
        }),
      });
      const data = await res.json();
      setBriefing(data.reply || 'No briefing available.');
    } catch {
      setBriefing('Could not load briefing. Check your connection.');
    }
    setBriefingLoading(false);
  }, [projects, upcoming, activeLeads.length]);

  const fmt = v => v === 0 ? '£0' : `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16, background: '#f1f3f6', minHeight: '100%' }}>

      {/* ── Row 1: 5 stat cards ── */}
      <div style={{ display: 'flex', gap: 14 }}>
        <StatCard label="Active projects"  value={activeProjects}   colour="blue"  />
        <StatCard label="Unpaid invoices"  value={fmt(unpaidInvoices)} colour="amber" />
        <StatCard label="Needs attention"  value={needsAttention}   colour="red"   />
        <StatCard label="Fee pipeline"     value={fmt(feePipeline)} colour="green" />
        <StatCard label="Lead pipeline"    value={fmt(leadPipeline)} colour="purple" />
      </div>

      {/* ── Row 2: Morning briefing (75%) + Cash flow (25%) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 14 }}>

        {/* Morning briefing */}
        <div style={{
          ...dashboardCardStyle,
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              ✨ Morning Briefing
            </div>
            <button
              onClick={refreshBriefing}
              disabled={briefingLoading}
              style={{
                background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12,
                cursor: 'pointer', fontWeight: 500, padding: 0, display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {briefingLoading ? '…' : '↻ REFRESH'}
            </button>
          </div>
          <div style={{ fontSize: 13, color: briefing ? 'var(--text2)' : 'var(--text3)', lineHeight: 1.65, minHeight: 60, fontStyle: briefing ? 'normal' : 'italic' }}>
            {briefingLoading
              ? 'Generating your briefing…'
              : briefing || 'Click refresh for your AI morning briefing…'}
          </div>
        </div>

        {/* Cash flow */}
        <div style={{
          ...dashboardCardStyle,
          padding: '16px 20px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>
            💰 Cash Flow
          </div>
          {[
            { label: 'Paid this month',    val: fmt(paidThisMonth),    colour: 'var(--green)' },
            { label: 'Unpaid invoices',    val: fmt(unpaidTotal),      colour: 'var(--amber)' },
            { label: 'Overdue',            val: fmt(overdue),          colour: 'var(--red)'   },
          ].map(({ label, val, colour }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #edf0f4', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text2)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: colour }}>{val}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 0', fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Uninvoiced pipeline</span>
            <span style={{ fontWeight: 700, color: 'var(--blue)', fontSize: 15 }}>{fmt(uninvoicedPipeline)}</span>
          </div>
        </div>
      </div>

      {/* ── Row 3: Leads (30%) + Next 14 days (70%) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>

        {/* Leads */}
        <div style={{
          ...dashboardCardStyle,
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              🎯 Leads
            </div>
            <span
              onClick={() => onNavigate('leads')}
              style={{ fontSize: 11.5, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}
            >
              ALL →
            </span>
          </div>
          {activeLeads.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No active leads.</div>
          ) : activeLeads.map(lead => {
            const ageDays = lead._t ? Math.floor((Date.now() - lead._t) / 86400000) : 0;
            const ageColour = ageDays >= 7 ? 'var(--red)' : ageDays >= 3 ? 'var(--amber)' : 'var(--green)';
            return (
              <div
                key={lead.id}
                onClick={() => onNavigate('leads')}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 10px', borderRadius: 12, marginBottom: 6,
                  border: '1px solid #e7eaf0', cursor: 'pointer',
                  background: '#fafafa',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f6f8'}
                onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{lead.name}</div>
                  {lead.address && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{lead.address}</div>}
                </div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: ageColour, background: `${ageColour}22`, padding: '2px 7px', borderRadius: 99 }}>
                    {ageDays}d
                  </span>
                  <span style={{ fontSize: 11, background: 'var(--blue-bg)', color: 'var(--blue)', padding: '2px 6px', borderRadius: 99, fontWeight: 600 }}>
                    AI
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Next 14 days */}
        <div style={{
          ...dashboardCardStyle,
          padding: '16px 20px', overflowY: 'auto', maxHeight: 340,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              📅 Next 14 Days
            </div>
            <span
              onClick={() => onNavigate('calendar')}
              style={{ fontSize: 11.5, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}
            >
              CALENDAR →
            </span>
          </div>
          {dayGroups.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No upcoming deadlines.</div>
          ) : dayGroups.map(({ label, items }) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.5px', marginBottom: 5 }}>
                {label}
              </div>
              {items.map((item, i) => (
                <div
                  key={i}
                  onClick={() => item.projectId && onOpenProject && onOpenProject(projects.find(p => p.id === item.projectId))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', fontSize: 12.5, color: 'var(--text2)',
                    cursor: item.projectId ? 'pointer' : 'default',
                    border: '1px solid #edf0f4',
                    background: '#fafafa',
                    borderRadius: 10,
                    marginBottom: 5,
                  }}
                  onMouseEnter={e => { if (item.projectId) e.currentTarget.style.background = '#f5f6f8'; }}
                  onMouseLeave={e => { if (item.projectId) e.currentTarget.style.background = '#fafafa'; }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.ref && (
                    <span style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>{item.ref}</span>
                  )}
                  {item.projectId && (
                    <span
                      style={{ fontSize: 10.5, color: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}
                    >
                      open
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
