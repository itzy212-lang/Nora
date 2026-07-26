import { useState, useEffect, useRef, useCallback } from 'react';

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  shell: { display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' },

  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #edf0f4', flexShrink: 0 },
  topbarLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 },
  topbarTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  topbarSub: { fontSize: 11, color: 'var(--text3)', marginTop: 1 },
  progressPill: { fontSize: 11, fontWeight: 600, background: '#f0f5ff', color: '#3b82f6', padding: '4px 12px', borderRadius: 99, border: '1px solid #dce8ff', whiteSpace: 'nowrap' },
  backBtn: { fontSize: 12, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 8 },

  chat: { flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 },

  // Nora message
  noraMsgRow: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  noraSm: { width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: 2 },
  noraBubble: { background: '#f4f5f7', borderRadius: '4px 14px 14px 14px', padding: '10px 13px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, maxWidth: '85%' },

  // User bubble
  userRow: { display: 'flex', justifyContent: 'flex-end' },
  userBubble: { background: '#3b82f6', color: '#fff', borderRadius: '14px 4px 14px 14px', padding: '9px 13px', fontSize: 13, maxWidth: '60%', lineHeight: 1.5 },

  // Project group header
  projectHeader: { marginLeft: 34, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0 2px' },
  projectRef: { fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' },
  projectName: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  projectDivider: { flex: 1, height: 1, background: '#edf0f4' },

  // AO Card
  aoCard: (level) => ({
    marginLeft: 34,
    borderRadius: 16,
    border: `1px solid ${level === 'red' ? '#fca5a5' : level === 'amber' ? '#fde68a' : '#6ee7b7'}`,
    overflow: 'hidden',
    background: '#fff',
  }),
  aoStrip: (level) => ({
    padding: '9px 13px',
    display: 'flex', alignItems: 'center', gap: 8,
    background: level === 'red' ? '#fff5f5' : level === 'amber' ? '#fffbeb' : '#f0fdf4',
  }),
  aoStripDot: (level) => ({
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    background: level === 'red' ? '#ef4444' : level === 'amber' ? '#f59e0b' : '#10b981',
  }),
  aoStripLabel: (level) => ({
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: level === 'red' ? '#ef4444' : level === 'amber' ? '#d97706' : '#059669',
  }),
  aoNum: { fontSize: 10, fontWeight: 600, color: '#b0b8c4', marginLeft: 'auto' },

  aoBody: { padding: '12px 13px' },
  aoName: { fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 2 },
  aoAddress: { fontSize: 12, color: 'var(--text3)', marginBottom: 10 },

  // Status track
  track: { display: 'flex', alignItems: 'center', marginBottom: 12 },
  trackStep: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  trackDot: (done, active) => ({
    width: 20, height: 20, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 700, flexShrink: 0,
    background: active ? '#ef4444' : done ? '#10b981' : '#e8eaed',
    color: (active || done) ? '#fff' : '#b0b8c4',
    boxShadow: active ? '0 0 0 3px rgba(239,68,68,0.2)' : 'none',
  }),
  trackLabel: (done, active) => ({
    fontSize: 9, fontWeight: 600, marginTop: 3, textAlign: 'center', lineHeight: 1.3,
    color: active ? '#ef4444' : done ? '#10b981' : '#b0b8c4',
    whiteSpace: 'nowrap',
  }),
  trackLine: (done) => ({
    height: 2, flex: 1, marginBottom: 16,
    background: done ? '#10b981' : '#e8eaed',
  }),

  // Info rows
  infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f4f5f7', fontSize: 12 },
  infoLabel: { color: 'var(--text3)', fontWeight: 500 },
  infoVal: (c) => ({ color: c === 'red' ? '#ef4444' : c === 'amber' ? '#d97706' : c === 'green' ? '#059669' : 'var(--text)', fontWeight: 600, textAlign: 'right' }),

  // Nora insight
  insight: { marginTop: 10, padding: '9px 11px', background: '#fafafa', borderRadius: 10, borderLeft: '3px solid #3b82f6', fontSize: 12, color: 'var(--text2)', lineHeight: 1.55 },
  insightLabel: { fontSize: 9.5, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 },

  // Chasing email strip
  chasingStrip: { marginTop: 8, padding: '8px 11px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', fontSize: 12, color: '#92400e' },
  chasingLabel: { fontSize: 9.5, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 },

  // Actions
  aoActions: (level) => ({
    padding: '10px 13px',
    display: 'flex', gap: 7, flexWrap: 'wrap',
    borderTop: `1px solid ${level === 'red' ? '#fee2e2' : level === 'amber' ? '#fde68a' : '#d1fae5'}`,
    background: level === 'red' ? '#fff5f5' : level === 'amber' ? '#fffbeb' : '#f0fdf4',
  }),

  // Confirm strip
  confirmStrip: { marginLeft: 34, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#10b981', fontWeight: 500 },

  // All done
  allDone: { marginLeft: 34, textAlign: 'center', padding: '20px', background: '#f0fdf4', borderRadius: 14, border: '1px solid #6ee7b7' },

  // Input bar
  inputbar: { borderTop: '1px solid #edf0f4', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', background: '#fff', flexShrink: 0 },
  input: { flex: 1, fontSize: 14, padding: '9px 14px', borderRadius: 99, border: '1px solid #e8eaed', background: '#f9fafb', outline: 'none', color: 'var(--text)', fontFamily: 'inherit' },
  micBtn: { width: 36, height: 36, borderRadius: '50%', background: '#f4f5f7', border: '1px solid #e8eaed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, cursor: 'pointer', flexShrink: 0 },
  sendBtn: (active) => ({ width: 36, height: 36, borderRadius: '50%', background: active ? '#3b82f6' : '#e8eaed', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, cursor: active ? 'pointer' : 'default', flexShrink: 0, color: '#fff' }),
};

// ── Button helper ─────────────────────────────────────────────────────────────
function Btn({ style, onClick, children, disabled }) {
  const styles = {
    red: { background: '#ef4444', color: '#fff' },
    amber: { background: '#f59e0b', color: '#fff' },
    primary: { background: '#3b82f6', color: '#fff' },
    green: { background: '#10b981', color: '#fff' },
    ghost: { background: '#fff', color: 'var(--text3)', border: '1px solid #e8eaed' },
    skip: { background: 'transparent', color: '#9ca3af', border: 'none', fontSize: 11.5 },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 9, border: 'none', cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1, ...styles[style] }}
    >
      {children}
    </button>
  );
}

// ── Status Track ─────────────────────────────────────────────────────────────
function StatusTrack({ steps }) {
  // Find first incomplete step (active)
  let activeIdx = steps.findIndex(s => !s.done);

  return (
    <div style={s.track}>
      {steps.map((step, i) => {
        const isActive = i === activeIdx && !step.done;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={s.trackStep}>
              <div style={s.trackDot(step.done, isActive)}>
                {step.done ? '✓' : isActive ? '!' : '—'}
              </div>
              <div style={s.trackLabel(step.done, isActive)}>{step.label}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={s.trackLine(step.done)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── AO Card ──────────────────────────────────────────────────────────────────
function AOCard({ card, aoIndex, totalAOs, projectId, onAction, done }) {
  if (done) {
    return (
      <div style={{ ...s.aoCard('green'), opacity: 0.55 }}>
        <div style={s.aoStrip('green')}>
          <div style={s.aoStripDot('green')} />
          <div style={s.aoStripLabel('green')}>Done · Moving on</div>
          <div style={s.aoNum}>AO {aoIndex + 1} of {totalAOs}</div>
        </div>
        <div style={{ ...s.aoBody, paddingTop: 8, paddingBottom: 8 }}>
          <div style={s.aoName}>{card.name}</div>
          <div style={s.aoAddress}>{card.address}</div>
        </div>
      </div>
    );
  }

  const kd = card.keyDates || {};

  return (
    <div style={s.aoCard(card.level)}>
      {/* Strip */}
      <div style={s.aoStrip(card.level)}>
        <div style={s.aoStripDot(card.level)} />
        <div style={s.aoStripLabel(card.level)}>
          {card.level === 'red' ? 'Action required' : 'Attention needed'}
        </div>
        <div style={s.aoNum}>AO {aoIndex + 1} of {totalAOs}</div>
      </div>

      {/* Body */}
      <div style={s.aoBody}>
        <div style={s.aoName}>{card.name}</div>
        {card.address && <div style={s.aoAddress}>{card.address}</div>}

        {/* Status track */}
        {card.statusTrack?.length > 0 && <StatusTrack steps={card.statusTrack} />}

        {/* Key info rows */}
        {card.surveyor && (
          <div style={s.infoRow}>
            <span style={s.infoLabel}>Their surveyor</span>
            <span style={s.infoVal()}>{card.surveyor.name}{card.surveyor.firm ? ` · ${card.surveyor.firm}` : ''}</span>
          </div>
        )}
        {kd.consentDeadline && (
          <div style={s.infoRow}>
            <span style={s.infoLabel}>Consent deadline</span>
            <span style={s.infoVal(kd.consentDeadlineDays !== null && kd.consentDeadlineDays < 0 ? 'red' : kd.consentDeadlineDays <= 3 ? 'amber' : null)}>
              {kd.consentDeadlineDays !== null && kd.consentDeadlineDays < 0
                ? `Expired ${Math.abs(kd.consentDeadlineDays)}d ago`
                : kd.consentDeadlineDays <= 3
                ? `In ${kd.consentDeadlineDays}d`
                : new Date(kd.consentDeadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        )}
        {kd.s10Deadline && (
          <div style={s.infoRow}>
            <span style={s.infoLabel}>Section 10 deadline</span>
            <span style={s.infoVal(kd.s10DeadlineDays !== null && kd.s10DeadlineDays < 0 ? 'red' : kd.s10DeadlineDays <= 3 ? 'amber' : null)}>
              {kd.s10DeadlineDays !== null && kd.s10DeadlineDays < 0
                ? `Expired ${Math.abs(kd.s10DeadlineDays)}d ago`
                : kd.s10DeadlineDays <= 3
                ? `In ${kd.s10DeadlineDays}d`
                : new Date(kd.s10Deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        )}
        {kd.staleDays !== null && kd.staleDays >= 10 && (
          <div style={s.infoRow}>
            <span style={s.infoLabel}>Last activity</span>
            <span style={s.infoVal(kd.staleDays >= 14 ? 'red' : 'amber')}>{kd.staleDays} days ago</span>
          </div>
        )}

        {/* Nora insight */}
        {card.reason && (
          <div style={s.insight}>
            <div style={s.insightLabel}>Nora · Why this needs attention</div>
            {card.reason}
          </div>
        )}

        {/* Chasing email */}
        {card.chasingEmail && (
          <div style={s.chasingStrip}>
            <div style={s.chasingLabel}>⚡ Unreplied email · {card.chasingEmail.daysAgo}d ago</div>
            <strong>{card.chasingEmail.sender}</strong> — {card.chasingEmail.subject}
            {card.chasingEmail.preview && <div style={{ marginTop: 3, opacity: 0.8 }}>"{card.chasingEmail.preview}…"</div>}
          </div>
        )}
      </div>

      {/* Actions */}
      {card.actions?.length > 0 && (
        <div style={s.aoActions(card.level)}>
          {card.actions.map(action => (
            <Btn key={action.id} style={action.style} onClick={() => onAction(action, card, projectId)}>
              {action.style === 'red' ? '⚡' : action.style === 'primary' ? '👤' : '✉️'} {action.label}
            </Btn>
          ))}
          <Btn style="skip" onClick={() => onAction({ id: 'skip' }, card, projectId)}>Skip →</Btn>
        </div>
      )}
    </div>
  );
}

// ── Main BriefingChat component ───────────────────────────────────────────────
export default function BriefingChat({ onBack, onOpenProject, onOpenComposer }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [doneCards, setDoneCards] = useState(new Set()); // Set of "projectId:aoId"
  const [inputVal, setInputVal] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef(null);

  const scrollBottom = () => {
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, 80);
  };

  const addMessage = useCallback((role, content) => {
    setMessages(prev => [...prev, { role, content, id: Date.now() + Math.random() }]);
    scrollBottom();
  }, []);

  // Load briefing on mount
  useEffect(() => {
    setLoading(true);
    fetch('/api/briefing')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
        if (d.totalCards === 0) {
          addMessage('nora', 'Good morning Itzik — all projects are on track. Nothing urgent today. 🎉');
        } else {
          addMessage('nora',
            `Good morning Itzik. I've reviewed everything. ${d.totalRed > 0 ? `**${d.totalRed} urgent item${d.totalRed !== 1 ? 's' : ''}** ` : ''}${d.totalAmber > 0 ? `${d.totalRed > 0 ? 'and ' : ''}${d.totalAmber} needing attention ` : ''}across ${d.projects.length} project${d.projects.length !== 1 ? 's' : ''}. Let's work through them.`
          );
        }
      })
      .catch(() => {
        setLoading(false);
        addMessage('nora', 'Sorry — I couldn\'t load the briefing right now. Try refreshing.');
      });
  }, [addMessage]);

  // Count total and done cards
  const totalCards = data?.projects?.reduce((s, p) => s + p.aoCards.length, 0) || 0;
  const doneCount = doneCards.size;

  // Handle action button press
  const handleAction = useCallback((action, card, projectId) => {
    const key = `${projectId}:${card.aoId}`;

    if (action.id === 'skip') {
      addMessage('user', 'Skip — show me the next one');
      setDoneCards(prev => new Set([...prev, key]));
      addMessage('nora', 'Skipped. Moving on.');
      return;
    }

    if (action.id === 'generate_s104b') {
      addMessage('user', 'Generate s.10(4)(b)');
      addMessage('nora', `Opening ${card.name}'s project — use the s.10(4)(b) button to generate the appointment letter.`);
      setDoneCards(prev => new Set([...prev, key]));
      if (onOpenProject) { const proj = data?.projects?.find(p => p.id === projectId); onOpenProject(proj || projectId); }
    }

    if (action.id === 'generate_s10') {
      addMessage('user', 'Generate Section 10 notice');
      addMessage('nora', `Opening ${card.name}'s project — use the Section 10 button to generate and serve the notice.`);
      setDoneCards(prev => new Set([...prev, key]));
      if (onOpenProject) { const proj = data?.projects?.find(p => p.id === projectId); onOpenProject(proj || projectId); }
    }

    if (action.id === 'add_surveyor') {
      addMessage('user', 'Add surveyor');
      addMessage('nora', `Opening ${card.name}'s project — add the surveyor details in the AO card.`);
      setDoneCards(prev => new Set([...prev, key]));
      if (onOpenProject) { const proj = data?.projects?.find(p => p.id === projectId); onOpenProject(proj || projectId); }
    }

    if (action.id === 'email_ao') {
      addMessage('user', `Email ${card.name}`);
      if (onOpenComposer) {
        onOpenComposer({
          mode: 'compose',
          to: card.email || '',
          toName: card.name,
          subject: `Re: Party Wall — ${card.address || ''}`,
        });
      }
    }
  }, [addMessage, onOpenProject, onOpenComposer]);

  // Send freeform message to Nora
  const handleSend = async () => {
    const text = inputVal.trim();
    if (!text || sending) return;
    setInputVal('');
    addMessage('user', text);
    setSending(true);
    try {
      const res = await fetch('/api/ely-smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, surface: 'briefing_chat', mode: 'discuss' }),
      });
      const d = await res.json();
      const reply = d.reply || d.message || d.content || 'I didn\'t catch that — try again.';
      addMessage('nora', reply);
    } catch {
      addMessage('nora', 'Something went wrong — please try again.');
    } finally {
      setSending(false);
    }
  };

  const allDone = totalCards > 0 && doneCount >= totalCards;

  return (
    <div style={s.shell}>
      {/* Top bar */}
      <div style={s.topbar}>
        <div style={s.topbarLeft}>
          <button style={s.backBtn} onClick={onBack}>← Back</button>
          <div style={s.avatar}>N</div>
          <div>
            <div style={s.topbarTitle}>Briefing</div>
            <div style={s.topbarSub}>
              {loading ? 'Loading…' : data?.totalCards === 0 ? 'All clear' : data?.summary}
            </div>
          </div>
        </div>
        {totalCards > 0 && (
          <div style={s.progressPill}>{doneCount} of {totalCards} done</div>
        )}
      </div>

      {/* Chat */}
      <div style={s.chat} ref={chatRef}>

        {/* Nora messages */}
        {messages.map(msg => (
          msg.role === 'nora' ? (
            <div key={msg.id} style={s.noraMsgRow}>
              <div style={s.noraSm}>N</div>
              <div style={s.noraBubble}
                dangerouslySetInnerHTML={{ __html: (msg.content || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }}
              />
            </div>
          ) : (
            <div key={msg.id} style={s.userRow}>
              <div style={s.userBubble}>{msg.content}</div>
            </div>
          )
        ))}

        {/* Loading skeleton */}
        {loading && (
          <div style={s.noraMsgRow}>
            <div style={s.noraSm}>N</div>
            <div style={{ ...s.noraBubble, color: 'var(--text3)', fontStyle: 'italic' }}>Reading your projects…</div>
          </div>
        )}

        {/* Project groups + AO cards */}
        {!loading && data?.projects?.map((project, pi) => (
          <div key={project.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Project header */}
            <div style={s.projectHeader}>
              <div>
                <div style={s.projectRef}>{project.ref}{project.ref ? ' · ' : ''}Party Wall</div>
                <div style={s.projectName}>{project.address}</div>
              </div>
              <div style={s.projectDivider} />
            </div>

            {/* AO Cards */}
            {project.aoCards.map((card, ci) => {
              const key = `${project.id}:${card.aoId}`;
              return (
                <AOCard
                  key={key}
                  card={card}
                  aoIndex={ci}
                  totalAOs={project.aoCards.length}
                  projectId={project.id}
                  onAction={handleAction}
                  done={doneCards.has(key)}
                />
              );
            })}
          </div>
        ))}

        {/* All done */}
        {allDone && (
          <div style={s.allDone}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#059669', marginBottom: 4 }}>You're all caught up</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{totalCards} of {totalCards} actions complete</div>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>

      {/* Input bar */}
      <div style={s.inputbar}>
        <div style={s.micBtn}>🎤</div>
        <input
          style={s.input}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask Nora about a project…"
        />
        <button style={s.sendBtn(!!inputVal.trim())} onClick={handleSend}>↑</button>
      </div>
    </div>
  );
}
