import sb from '../../supabaseClient';
import { useState, useEffect, useCallback, useRef } from 'react';

// ── Styles ────────────────────────────────────────────────────────────────────
const c = {
  shell: { display:'flex', flexDirection:'column', height:'100%', background:'#fff' },

  topbar: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #edf0f4', flexShrink:0 },
  topLeft: { display:'flex', alignItems:'center', gap:10 },
  avatar: { width:30, height:30, borderRadius:'50%', background:'linear-gradient(135deg,#3b82f6,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 },
  topTitle: { fontSize:14, fontWeight:700, color:'var(--text)' },
  topSub: { fontSize:11, color:'var(--text3)', marginTop:1 },
  backBtn: { fontSize:13, color:'var(--text3)', background:'none', border:'none', cursor:'pointer', padding:'4px 8px', borderRadius:8, marginRight:4 },
  pill: { fontSize:11, fontWeight:600, background:'#f0f5ff', color:'#3b82f6', padding:'4px 12px', borderRadius:99, border:'1px solid #dce8ff', whiteSpace:'nowrap' },

  chat: { flex:1, overflowY:'auto', padding:'14px', display:'flex', flexDirection:'column', gap:12 },

  // Nora bubble
  noraRow: { display:'flex', alignItems:'flex-start', gap:8 },
  noraSm: { width:26, height:26, borderRadius:'50%', background:'linear-gradient(135deg,#3b82f6,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0, marginTop:2 },
  noraBubble: { background:'#f4f5f7', borderRadius:'4px 14px 14px 14px', padding:'10px 13px', fontSize:13, color:'var(--text2)', lineHeight:1.6, maxWidth:'85%' },

  // User bubble
  userRow: { display:'flex', justifyContent:'flex-end' },
  userBubble: { background:'#3b82f6', color:'#fff', borderRadius:'14px 4px 14px 14px', padding:'9px 13px', fontSize:13, maxWidth:'60%', lineHeight:1.5 },

  // Summary card
  summaryCard: { borderRadius:14, border:'1px solid #dce8ff', background:'#f0f5ff', padding:'14px 16px', marginLeft:34 },
  summaryTitle: { fontSize:13, fontWeight:700, color:'#1e3a8a', marginBottom:8 },
  summaryRow: { display:'flex', alignItems:'center', gap:8, marginBottom:5, fontSize:12, color:'#374151' },
  summaryDot: (col) => ({ width:8, height:8, borderRadius:'50%', background:col, flexShrink:0 }),

  // AO card
  aoCard: (level) => ({
    marginLeft:34, borderRadius:16,
    border:`1px solid ${level==='red'?'#fca5a5':level==='amber'?'#fde68a':'#6ee7b7'}`,
    overflow:'hidden', background:'#fff',
  }),
  aoStrip: (level) => ({
    padding:'9px 13px', display:'flex', alignItems:'center', gap:8,
    background:level==='red'?'#fff5f5':level==='amber'?'#fffbeb':'#f0fdf4',
  }),
  aoDot: (level) => ({ width:8, height:8, borderRadius:'50%', flexShrink:0, background:level==='red'?'#ef4444':level==='amber'?'#f59e0b':'#10b981' }),
  aoStripLabel: (level) => ({ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', color:level==='red'?'#ef4444':level==='amber'?'#d97706':'#059669' }),
  aoNum: { fontSize:10, fontWeight:600, color:'#b0b8c4', marginLeft:'auto' },
  aoBody: { padding:'12px 13px' },
  aoName: { fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:2 },
  aoAddr: { fontSize:12, color:'var(--text3)', marginBottom:8 },
  infoRow: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #f4f5f7', fontSize:12 },
  infoLabel: { color:'var(--text3)', fontWeight:500 },
  infoVal: (col) => ({ color:col==='red'?'#ef4444':col==='amber'?'#d97706':col==='green'?'#059669':'var(--text)', fontWeight:600 }),
  insight: { marginTop:10, padding:'9px 11px', background:'#fafafa', borderRadius:10, borderLeft:'3px solid #3b82f6', fontSize:12, color:'var(--text2)', lineHeight:1.55 },
  insightLabel: { fontSize:9.5, fontWeight:700, color:'#3b82f6', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 },
  aoActions: (level) => ({
    padding:'10px 13px', display:'flex', gap:7, flexWrap:'wrap',
    borderTop:`1px solid ${level==='red'?'#fee2e2':level==='amber'?'#fde68a':'#d1fae5'}`,
    background:level==='red'?'#fff5f5':level==='amber'?'#fffbeb':'#f0fdf4',
  }),

  // Status track
  track: { display:'flex', alignItems:'center', marginBottom:12 },
  trackStep: { display:'flex', flexDirection:'column', alignItems:'center', flex:1 },
  trackDot: (done, active) => ({
    width:20, height:20, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:10, fontWeight:700, flexShrink:0,
    background:active?'#ef4444':done?'#10b981':'#e8eaed',
    color:(active||done)?'#fff':'#b0b8c4',
    boxShadow:active?'0 0 0 3px rgba(239,68,68,0.2)':'none',
  }),
  trackLabel: (done, active) => ({
    fontSize:9, fontWeight:600, marginTop:3, textAlign:'center', lineHeight:1.3,
    color:active?'#ef4444':done?'#10b981':'#b0b8c4', whiteSpace:'nowrap',
  }),
  trackLine: (done) => ({ height:2, flex:1, marginBottom:16, background:done?'#10b981':'#e8eaed' }),

  // Email card
  emailCard: (isChasing) => ({
    marginLeft:34, borderRadius:14,
    border:`1px solid ${isChasing?'#fde68a':'#dce8ff'}`,
    overflow:'hidden', background:'#fff',
  }),
  emailStrip: (isChasing) => ({
    padding:'9px 13px', display:'flex', alignItems:'center', gap:8,
    background:isChasing?'#fffbeb':'#f0f5ff',
  }),
  emailStripLabel: (isChasing) => ({ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', color:isChasing?'#d97706':'#3b82f6' }),
  emailBody: { padding:'12px 13px' },
  emailSender: { fontSize:14, fontWeight:700, color:'var(--text)', marginBottom:2 },
  emailSubject: { fontSize:12.5, fontWeight:600, color:'var(--text2)', marginBottom:6 },
  emailPreview: { fontSize:12, color:'var(--text3)', lineHeight:1.5, fontStyle:'italic' },
  emailActions: { padding:'10px 13px', display:'flex', gap:7, flexWrap:'wrap', borderTop:'1px solid #edf0f4', background:'#fafafa' },

  // Done card
  doneCard: { marginLeft:34, padding:'10px 14px', borderRadius:12, background:'#f0fdf4', border:'1px solid #6ee7b7', fontSize:12, color:'#059669', fontWeight:500 },

  // All done
  allDone: { marginLeft:34, textAlign:'center', padding:'24px 20px', background:'#f0fdf4', borderRadius:16, border:'1px solid #6ee7b7' },

  // Section divider
  divider: { display:'flex', alignItems:'center', gap:10, marginLeft:34 },
  dividerLine: { flex:1, height:1, background:'#edf0f4' },
  dividerLabel: { fontSize:10, fontWeight:700, color:'#c0c7d0', textTransform:'uppercase', letterSpacing:'0.6px', whiteSpace:'nowrap' },

  // Input bar
  inputbar: { borderTop:'1px solid #edf0f4', padding:'10px 12px', display:'flex', gap:8, alignItems:'center', background:'#fff', flexShrink:0 },
  input: { flex:1, fontSize:14, padding:'9px 14px', borderRadius:99, border:'1px solid #e8eaed', background:'#f9fafb', outline:'none', color:'var(--text)', fontFamily:'inherit' },
  micBtn: { width:36, height:36, borderRadius:'50%', background:'#f4f5f7', border:'1px solid #e8eaed', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, cursor:'pointer', flexShrink:0 },
  sendBtn: (active) => ({ width:36, height:36, borderRadius:'50%', background:active?'#3b82f6':'#e8eaed', border:'none', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, cursor:active?'pointer':'default', flexShrink:0, color:'#fff' }),
};

// ── Button ────────────────────────────────────────────────────────────────────
function Btn({ variant='ghost', onClick, disabled, children }) {
  const variants = {
    red:     { background:'#ef4444', color:'#fff', border:'none' },
    amber:   { background:'#f59e0b', color:'#fff', border:'none' },
    primary: { background:'#3b82f6', color:'#fff', border:'none' },
    green:   { background:'#10b981', color:'#fff', border:'none' },
    ghost:   { background:'#fff', color:'var(--text3)', border:'1px solid #e8eaed' },
    skip:    { background:'transparent', color:'#9ca3af', border:'none', fontSize:11.5 },
  };
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{ fontSize:12, fontWeight:600, padding:'7px 13px', borderRadius:9, cursor:disabled?'default':'pointer',
               display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap', opacity:disabled?0.5:1,
               ...variants[variant] }}
    >
      {children}
    </button>
  );
}

// ── Status Track ──────────────────────────────────────────────────────────────
function StatusTrack({ steps }) {
  const activeIdx = steps.findIndex(s => !s.done);
  return (
    <div style={c.track}>
      {steps.map((step, i) => {
        const isActive = i === activeIdx;
        return (
          <div key={i} style={{ display:'flex', alignItems:'center', flex:1 }}>
            <div style={c.trackStep}>
              <div style={c.trackDot(step.done, isActive)}>{step.done?'✓':isActive?'!':'—'}</div>
              <div style={c.trackLabel(step.done, isActive)}>{step.label}</div>
            </div>
            {i < steps.length-1 && <div style={c.trackLine(step.done)} />}
          </div>
        );
      })}
    </div>
  );
}

// ── AO Queue Card ─────────────────────────────────────────────────────────────
function AOQueueCard({ item, onAction }) {
  const { card, project } = item;
  const kd = card.keyDates || {};
  return (
    <div style={c.aoCard(card.level)}>
      <div style={c.aoStrip(card.level)}>
        <div style={c.aoDot(card.level)} />
        <div style={c.aoStripLabel(card.level)}>{card.level==='red'?'Action required':'Attention needed'}</div>
        <div style={c.aoNum}>{project.ref || project.address}</div>
      </div>
      <div style={c.aoBody}>
        <div style={c.aoName}>{card.name}</div>
        {card.address && <div style={c.aoAddr}>{card.address}</div>}
        {card.statusTrack?.length > 0 && <StatusTrack steps={card.statusTrack} />}
        {card.surveyor && (
          <div style={c.infoRow}>
            <span style={c.infoLabel}>Their surveyor</span>
            <span style={c.infoVal()}>{card.surveyor.name}{card.surveyor.firm?` · ${card.surveyor.firm}`:''}</span>
          </div>
        )}
        {kd.consentDeadline && (
          <div style={c.infoRow}>
            <span style={c.infoLabel}>Consent deadline</span>
            <span style={c.infoVal(kd.consentDeadlineDays<0?'red':kd.consentDeadlineDays<=3?'amber':null)}>
              {kd.consentDeadlineDays<0?`Expired ${Math.abs(kd.consentDeadlineDays)}d ago`:kd.consentDeadlineDays<=3?`In ${kd.consentDeadlineDays}d`:new Date(kd.consentDeadline).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
            </span>
          </div>
        )}
        {kd.s10Deadline && (
          <div style={c.infoRow}>
            <span style={c.infoLabel}>Section 10 deadline</span>
            <span style={c.infoVal(kd.s10DeadlineDays<0?'red':kd.s10DeadlineDays<=3?'amber':null)}>
              {kd.s10DeadlineDays<0?`Expired ${Math.abs(kd.s10DeadlineDays)}d ago`:kd.s10DeadlineDays<=3?`In ${kd.s10DeadlineDays}d`:new Date(kd.s10Deadline).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
            </span>
          </div>
        )}
        {kd.staleDays>=10 && (
          <div style={c.infoRow}>
            <span style={c.infoLabel}>Last activity</span>
            <span style={c.infoVal(kd.staleDays>=14?'red':'amber')}>{kd.staleDays} days ago</span>
          </div>
        )}
        {card.reason && (
          <div style={c.insight}>
            <div style={c.insightLabel}>Why this needs attention</div>
            {card.reason}
          </div>
        )}
      </div>
      <div style={c.aoActions(card.level)}>
        {card.actions?.map(action => (
          <Btn key={action.id} variant={action.style} onClick={() => onAction(action, item)}>
            {action.style==='red'?'⚡':action.style==='primary'?'👤':'✉️'} {action.label}
          </Btn>
        ))}
        <Btn variant="skip" onClick={() => onAction({id:'skip'}, item)}>Skip →</Btn>
      </div>
    </div>
  );
}

// ── Email Queue Card ──────────────────────────────────────────────────────────
function EmailQueueCard({ item, onAction, onOpenComposer }) {
  const { email } = item;
  return (
    <div style={c.emailCard(email.isChasing)}>
      <div style={c.emailStrip(email.isChasing)}>
        <div style={c.aoDot(email.isChasing?'amber':'blue')} />
        <div style={c.emailStripLabel(email.isChasing)}>{email.isChasing?'⚡ Chasing — needs reply':'Unreplied email'}</div>
        {email.daysAgo > 0 && (
          <span style={{ marginLeft:'auto', fontSize:10.5, fontWeight:600,
            background:email.daysAgo>=3?'rgba(239,68,68,0.1)':'rgba(59,130,246,0.1)',
            color:email.daysAgo>=3?'#ef4444':'#3b82f6', padding:'2px 7px', borderRadius:99 }}>
            {email.daysAgo}d ago
          </span>
        )}
      </div>
      <div style={c.emailBody}>
        <div style={c.emailSender}>{email.sender}</div>
        <div style={c.emailSubject}>{email.subject}</div>
        {email.preview && <div style={c.emailPreview}>"{email.preview}…"</div>}
        {email.projectAddress && (
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>📁 {email.projectAddress}</div>
        )}
      </div>
      <div style={c.emailActions}>
        <Btn variant="primary" onClick={() => {
          onAction({id:'draft_reply'}, item);
          onOpenComposer?.({ mode:'reply', emailId:email.id, to:email.senderEmail, toName:email.sender, subject:`Re: ${email.subject}` });
        }}>✉️ Draft reply</Btn>
        <Btn variant="ghost" onClick={() => onAction({id:'skip'}, item)}>Skip →</Btn>
      </div>
    </div>
  );
}

// ── Main BriefingChat ─────────────────────────────────────────────────────────
export default function BriefingChat({ onBack, onOpenProject, onOpenComposer }) {
  const [loading, setLoading]     = useState(true);
  const [data, setData]           = useState(null);
  const [queue, setQueue]         = useState([]);       // flat ordered queue of items
  const [currentIdx, setCurrentIdx] = useState(0);     // which item we're on
  const [messages, setMessages]   = useState([]);
  const [inputVal, setInputVal]   = useState('');
  const [sending, setSending]     = useState(false);
  const chatRef = useRef(null);

  const scrollBottom = () => {
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 80);
  };

  const addMessage = useCallback((role, content) => {
    setMessages(prev => [...prev, { role, content, id: Date.now() + Math.random() }]);
    scrollBottom();
  }, []);

  // Build the flat queue from API data
  const buildQueue = useCallback((d) => {
    const q = [];

    // AO cards: red first across all projects, then amber
    const redItems = [], amberItems = [];
    (d.projects || []).forEach(project => {
      (project.aoCards || []).forEach(card => {
        const item = { type:'ao', card, project };
        if (card.level === 'red') redItems.push(item);
        else amberItems.push(item);
      });
    });
    q.push(...redItems, ...amberItems);

    // Email cards after all AO cards
    (d.emails || []).forEach(email => {
      q.push({ type:'email', email });
    });

    return q;
  }, []);

  // Load briefing on mount
  useEffect(() => {
    setLoading(true);
    fetch('/api/briefing')
      .then(async r => {
        const text = await r.text();
        if (!r.ok) {
          setLoading(false);
          addMessage('nora', `Briefing API error ${r.status}: ${text.slice(0, 300)}`);
          return;
        }
        let d;
        try { d = JSON.parse(text); } catch(e) {
          setLoading(false);
          addMessage('nora', `Briefing parse error: ${text.slice(0, 200)}`);
          return;
        }
        if (d.error) { setLoading(false); addMessage('nora', `Error: ${d.error}`); return; }

        const q = buildQueue(d);
        setData(d);
        setQueue(q);
        setLoading(false);

        if (q.length === 0) {
          addMessage('nora', 'All projects are on track — nothing needs your attention right now. 🎉');
          return;
        }

        // Opening summary
        const parts = [];
        if (d.totalRed > 0) parts.push(`**${d.totalRed} urgent AO${d.totalRed!==1?'s':''}**`);
        if (d.totalAmber > 0) parts.push(`${d.totalAmber} AO${d.totalAmber!==1?'s':''} needing attention`);
        if (d.totalEmails > 0) parts.push(`${d.totalEmails} email${d.totalEmails!==1?'s':''} to reply to`);
        addMessage('nora', `I've reviewed everything. ${parts.join(' · ')}. I'll walk you through them one by one — action or skip each one.`);
      })
      .catch(err => {
        setLoading(false);
        addMessage('nora', `Network error: ${err.message}`);
      });
  }, [addMessage, buildQueue]);

  // Scroll when new messages or queue item changes
  useEffect(() => { scrollBottom(); }, [messages, currentIdx]);

  const advance = useCallback((userMsg) => {
    if (userMsg) addMessage('user', userMsg);
    setCurrentIdx(prev => prev + 1);
    scrollBottom();
  }, [addMessage]);

  const handleAction = useCallback((action, item) => {
    if (action.id === 'skip') {
      advance('Skip — next one');
      return;
    }
    if (action.id === 'draft_reply') {
      advance('Draft reply');
      return;
    }
    if (action.id === 'generate_s104b') {
      addMessage('user', 'Generate s.10(4)(b)');
      addMessage('nora', `Opening ${item.card.name}'s project — use the s.10(4)(b) button to generate the appointment letter.`);
      setCurrentIdx(prev => prev + 1);
      if (onOpenProject) { const proj = data?.projects?.find(p => p.id === item.project.id); onOpenProject(proj || item.project); }
      return;
    }
    if (action.id === 'generate_s10') {
      addMessage('user', 'Generate Section 10');
      addMessage('nora', `Opening ${item.card.name}'s project — use the Section 10 button to generate and serve the notice.`);
      setCurrentIdx(prev => prev + 1);
      if (onOpenProject) { const proj = data?.projects?.find(p => p.id === item.project.id); onOpenProject(proj || item.project); }
      return;
    }
    if (action.id === 'add_surveyor') {
      addMessage('user', 'Add surveyor');
      addMessage('nora', `Opening ${item.card.name}'s project — add the surveyor in the AO card.`);
      setCurrentIdx(prev => prev + 1);
      if (onOpenProject) { const proj = data?.projects?.find(p => p.id === item.project.id); onOpenProject(proj || item.project); }
      return;
    }
    if (action.id === 'email_ao') {
      addMessage('user', `Email ${item.card.name}`);
      advance(null);
      onOpenComposer?.({ mode:'compose', to:item.card.email||'', toName:item.card.name, subject:`Re: Party Wall — ${item.card.address||''}` });
      return;
    }
  }, [addMessage, advance, data, onOpenProject, onOpenComposer]);

  const handleSend = async () => {
    const text = inputVal.trim();
    if (!text || sending) return;
    setInputVal('');
    addMessage('user', text);
    setSending(true);
    try {
      const { data: { session: _briefingSession } } = await (sb?.auth.getSession() || Promise.resolve({ data: { session: null } }));
      const res = await fetch('/api/ely-smart', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          ...(_briefingSession?.access_token ? { 'Authorization': `Bearer ${_briefingSession.access_token}` } : {}),
        },
        body:JSON.stringify({ prompt:text, surface:'briefing_chat', mode:'discuss' }),
      });
      const d = await res.json();
      addMessage('nora', d.reply || d.message || d.content || 'Try again.');
    } catch { addMessage('nora', 'Something went wrong.'); }
    finally { setSending(false); }
  };

  const totalItems = queue.length;
  const isDone = !loading && totalItems > 0 && currentIdx >= totalItems;
  const currentItem = queue[currentIdx];

  // Inject section divider message when crossing from AOs to emails
  const prevItem = queue[currentIdx - 1];
  const showEmailDivider = currentItem?.type === 'email' && (!prevItem || prevItem.type === 'ao');

  return (
    <div style={c.shell}>
      {/* Topbar */}
      <div style={c.topbar}>
        <div style={c.topLeft}>
          <button style={c.backBtn} onClick={onBack}>← Back</button>
          <div style={c.avatar}>N</div>
          <div>
            <div style={c.topTitle}>Briefing</div>
            <div style={c.topSub}>{loading ? 'Loading…' : data?.summary || ''}</div>
          </div>
        </div>
        {totalItems > 0 && !isDone && (
          <div style={c.pill}>{currentIdx} of {totalItems} done</div>
        )}
      </div>

      {/* Chat */}
      <div style={c.chat} ref={chatRef}>

        {/* Past messages */}
        {messages.map(msg => (
          msg.role === 'nora' ? (
            <div key={msg.id} style={c.noraRow}>
              <div style={c.noraSm}>N</div>
              <div style={c.noraBubble}
                dangerouslySetInnerHTML={{ __html:(msg.content||'').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>') }}
              />
            </div>
          ) : (
            <div key={msg.id} style={c.userRow}>
              <div style={c.userBubble}>{msg.content}</div>
            </div>
          )
        ))}

        {/* Loading */}
        {loading && (
          <div style={c.noraRow}>
            <div style={c.noraSm}>N</div>
            <div style={{ ...c.noraBubble, color:'var(--text3)', fontStyle:'italic' }}>Reviewing all projects…</div>
          </div>
        )}

        {/* Email section divider */}
        {!loading && showEmailDivider && (
          <div style={c.divider}>
            <div style={c.dividerLine} />
            <span style={c.dividerLabel}>Emails to reply to</span>
            <div style={c.dividerLine} />
          </div>
        )}

        {/* Current queue item */}
        {!loading && !isDone && currentItem && (
          currentItem.type === 'ao' ? (
            <AOQueueCard key={currentIdx} item={currentItem} onAction={handleAction} />
          ) : (
            <EmailQueueCard key={currentIdx} item={currentItem} onAction={handleAction} onOpenComposer={onOpenComposer} />
          )
        )}

        {/* All done */}
        {isDone && (
          <div style={c.allDone}>
            <div style={{ fontSize:28, marginBottom:8 }}>🎉</div>
            <div style={{ fontSize:14, fontWeight:700, color:'#059669', marginBottom:4 }}>All done — you're up to date</div>
            <div style={{ fontSize:12, color:'var(--text3)' }}>{totalItems} of {totalItems} items actioned</div>
          </div>
        )}

        <div style={{ height:8 }} />
      </div>

      {/* Input bar */}
      <div style={c.inputbar}>
        <div style={c.micBtn}>🎤</div>
        <input
          style={c.input}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key==='Enter' && handleSend()}
          placeholder="Ask Nora about a project…"
        />
        <button style={c.sendBtn(!!inputVal.trim())} onClick={handleSend}>↑</button>
      </div>
    </div>
  );
}
