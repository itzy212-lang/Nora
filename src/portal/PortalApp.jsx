import { useState, useEffect } from 'react';

const S = {
  page: { minHeight: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column' },
  authWrap: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  authCard: { background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 380, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' },
  logo: { fontSize: 18, fontWeight: 700, color: '#1F2937', marginBottom: 4 },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 24 },
  label: { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 },
  input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, marginBottom: 14, boxSizing: 'border-box' },
  button: { width: '100%', padding: 12, borderRadius: 10, background: '#1F2937', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  error: { fontSize: 12, color: '#dc2626', marginBottom: 12 },
  header: { background: '#1F2937', color: '#fff', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  tabs: { display: 'flex', gap: 4, padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb', overflowX: 'auto' },
  tab: (active) => ({ padding: '7px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', background: active ? '#1F2937' : 'transparent', color: active ? '#fff' : '#6b7280', border: active ? 'none' : '1px solid #e5e7eb' }),
  content: { flex: 1, padding: 20, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 10 },
  empty: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', padding: '40px 0' },
};

function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function ActivateScreen({ token, onActivated }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', token, password }),
      });
      const json = await res.json();
      if (res.ok) {
        onActivated(json.user);
      } else {
        setError(json.error || 'Could not activate account.');
      }
    } catch (err) {
      setError('Could not activate account.');
    }
    setLoading(false);
  };

  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={S.logo}>Set up your access</div>
        <div style={S.sub}>Create a password to activate your project portal account.</div>
        {error && <div style={S.error}>{error}</div>}
        <div style={S.label}>Password</div>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={S.input} />
        <div style={S.label}>Confirm password</div>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={S.input} />
        <button onClick={handleActivate} disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Activating...' : 'Activate account'}
        </button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, onForgotPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email, password }),
      });
      const json = await res.json();
      if (res.ok) {
        localStorage.setItem('portal_session', json.session_token);
        localStorage.setItem('portal_user', JSON.stringify(json.user));
        onLogin(json.session_token, json.user);
      } else {
        setError(json.error || 'Invalid email or password.');
      }
    } catch (err) {
      setError('Could not log in.');
    }
    setLoading(false);
  };

  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={S.logo}>Project Portal</div>
        <div style={S.sub}>Sign in to view your project.</div>
        {error && <div style={S.error}>{error}</div>}
        <div style={S.label}>Email</div>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={S.input} />
        <div style={S.label}>Password</div>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()} style={S.input} />
        <button onClick={handleLogin} disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button onClick={onForgotPassword} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}

function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRequest = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_reset', email }),
      });
      setSent(true);
    } catch (err) {
      setSent(true); // don't reveal errors either way
    }
    setLoading(false);
  };

  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={S.logo}>Reset your password</div>
        {sent ? (
          <>
            <div style={S.sub}>If an account exists for that email, a reset link has been sent.</div>
            <button onClick={onBack} style={S.button}>Back to sign in</button>
          </>
        ) : (
          <>
            <div style={S.sub}>Enter your email and we'll send you a reset link.</div>
            <div style={S.label}>Email</div>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={S.input} />
            <button onClick={handleRequest} disabled={loading || !email.trim()} style={{ ...S.button, opacity: (loading || !email.trim()) ? 0.6 : 1 }}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Back to sign in</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResetPasswordScreen({ token, onReset }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', token, password }),
      });
      const json = await res.json();
      if (res.ok) {
        onReset();
      } else {
        setError(json.error || 'Could not reset password.');
      }
    } catch (err) {
      setError('Could not reset password.');
    }
    setLoading(false);
  };

  return (
    <div style={S.authWrap}>
      <div style={S.authCard}>
        <div style={S.logo}>Set a new password</div>
        {error && <div style={S.error}>{error}</div>}
        <div style={S.label}>New password</div>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={S.input} />
        <div style={S.label}>Confirm password</div>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={S.input} />
        <button onClick={handleReset} disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Resetting...' : 'Reset password'}
        </button>
      </div>
    </div>
  );
}

function ExpandableTaskCard({ t, sessionToken, onMarkedComplete }) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const isPending = !!t.marked_complete_at;
  const isDone = t.status === 'complete';

  const handleMarkComplete = async (e) => {
    e.stopPropagation();
    setMarking(true);
    try {
      const res = await fetch('/api/portal-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken, action: 'mark_task_complete', task_id: t.id }),
      });
      if (res.ok) onMarkedComplete(t.id);
    } catch (err) { /* noop */ }
    setMarking(false);
  };

  return (
    <div style={{ ...S.card, cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{t.title}</div>
        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
        {t.start_date && t.end_date ? `${t.start_date} → ${t.end_date}` : 'Dates TBC'}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: isDone ? '#059669' : isPending ? '#d97706' : '#6b7280', marginTop: 6, textTransform: 'capitalize' }}>
        {isDone ? 'Complete' : isPending ? 'Marked complete — awaiting confirmation' : (t.status || 'not started').replace('_', ' ')}
      </div>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
          {t.trade && (
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}><strong>Trade:</strong> {t.trade}</div>
          )}
          {t.notes && (
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}><strong>Notes:</strong> {t.notes}</div>
          )}
          {!t.trade && !t.notes && (
            <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', marginBottom: 8 }}>No further detail added yet.</div>
          )}
          {!isDone && !isPending && (
            <button onClick={handleMarkComplete} disabled={marking}
              style={{ marginTop: 6, width: '100%', padding: 8, borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: marking ? 0.6 : 1 }}>
              {marking ? 'Marking...' : 'Mark as complete'}
            </button>
          )}
          {isPending && (
            <div style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', padding: 8, borderRadius: 6 }}>
              Waiting for the project manager or main contractor to confirm.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgrammeTab({ sessionToken }) {
  const [tasks, setTasks] = useState(null);
  useEffect(() => {
    fetch('/api/portal-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken, action: 'programme' }) })
      .then(r => r.json()).then(j => setTasks(j.tasks || []));
  }, [sessionToken]);

  const handleMarkedComplete = (taskId) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, marked_complete_at: new Date().toISOString() } : t));
  };

  if (tasks === null) return <div style={S.empty}>Loading...</div>;
  if (!tasks.length) return <div style={S.empty}>No programme items have been shared yet.</div>;

  // Group tasks by room — unallocated tasks (no room_id) go under "General"
  const groups = {};
  tasks.forEach(t => {
    const roomName = t.project_rooms?.name || 'General';
    if (!groups[roomName]) groups[roomName] = [];
    groups[roomName].push(t);
  });
  const roomNames = Object.keys(groups).sort((a, b) => a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b));

  return roomNames.map(roomName => (
    <div key={roomName} style={{ marginBottom: 20 }}>
      <div style={{ background: '#1F2937', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
        {roomName}
      </div>
      {groups[roomName].map(t => <ExpandableTaskCard key={t.id} t={t} sessionToken={sessionToken} onMarkedComplete={handleMarkedComplete} />)}
    </div>
  ));
}

function SiteLogTab({ sessionToken }) {
  const [visits, setVisits] = useState(null);
  useEffect(() => {
    fetch('/api/portal-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken, action: 'site_log' }) })
      .then(r => r.json()).then(j => setVisits(j.visits || []));
  }, [sessionToken]);

  if (visits === null) return <div style={S.empty}>Loading...</div>;
  if (!visits.length) return <div style={S.empty}>No site visits recorded yet.</div>;

  return visits.map(v => (
    <div key={v.id} style={S.card}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{v.week_label}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{v.visit_date}</div>
    </div>
  ));
}

function PaymentsTab({ sessionToken }) {
  const [invoices, setInvoices] = useState(null);
  useEffect(() => {
    fetch('/api/portal-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken, action: 'payments' }) })
      .then(r => r.json()).then(j => setInvoices(j.invoices || []));
  }, [sessionToken]);

  if (invoices === null) return <div style={S.empty}>Loading...</div>;
  if (!invoices.length) return <div style={S.empty}>No invoices yet.</div>;

  return invoices.map(inv => (
    <div key={inv.id} style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{inv.invoice_number}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>£{parseFloat(inv.total || 0).toFixed(2)}</div>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Issued {inv.invoice_date} · Due {inv.due_date}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: inv.status === 'paid' ? '#059669' : '#d97706', marginTop: 6, textTransform: 'capitalize' }}>{inv.status}</div>
    </div>
  ));
}

function DocumentsTab({ sessionToken }) {
  const [docs, setDocs] = useState(null);
  useEffect(() => {
    fetch('/api/portal-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken, action: 'documents' }) })
      .then(r => r.json()).then(j => setDocs(j.documents || []));
  }, [sessionToken]);

  if (docs === null) return <div style={S.empty}>Loading...</div>;
  if (!docs.length) return <div style={S.empty}>No documents have been shared yet.</div>;

  return docs.map(d => (
    <a key={d.id} href={d.signed_url || d.public_url || d.file_url} target="_blank" rel="noreferrer"
      style={{ ...S.card, display: 'block', textDecoration: 'none' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{d.file_name}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{d.category || 'Document'}</div>
    </a>
  ));
}

function ApprovalsTab({ sessionToken }) {
  const [approvals, setApprovals] = useState(null);
  const [comment, setComment] = useState({});

  const load = () => {
    fetch('/api/portal-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken, action: 'approvals' }) })
      .then(r => r.json()).then(j => setApprovals(j.approvals || []));
  };
  useEffect(load, [sessionToken]);

  const respond = async (id, response) => {
    await fetch('/api/portal-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: sessionToken, action: 'respond_approval', approval_id: id, response, comment: comment[id] || '' }),
    });
    load();
  };

  if (approvals === null) return <div style={S.empty}>Loading...</div>;
  if (!approvals.length) return <div style={S.empty}>Nothing awaiting your approval.</div>;

  return approvals.map(a => (
    <div key={a.id} style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{a.title}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginTop: 2 }}>{a.approval_type}</div>
        </div>
        {a.client_facing_amount != null && (
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>£{parseFloat(a.client_facing_amount).toFixed(2)}</div>
        )}
      </div>
      {a.description && <div style={{ fontSize: 13, color: '#374151', marginTop: 10 }}>{a.description}</div>}
      {a.time_impact_days ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Adds {a.time_impact_days} day(s) to the programme</div> : null}

      {a.status === 'pending' ? (
        <>
          <textarea placeholder="Add a comment (optional)" value={comment[a.id] || ''} onChange={e => setComment(prev => ({ ...prev, [a.id]: e.target.value }))}
            rows={2} style={{ width: '100%', marginTop: 12, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => respond(a.id, 'accepted')} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#059669', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Accept</button>
            <button onClick={() => respond(a.id, 'rejected')} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', color: '#374151', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Decline</button>
            {comment[a.id] && <button onClick={() => respond(a.id, 'commented')} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#eff6ff', color: '#2563eb', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Send comment</button>}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, fontWeight: 700, color: a.status === 'accepted' ? '#059669' : '#dc2626', marginTop: 10, textTransform: 'capitalize' }}>
          {a.status}
        </div>
      )}
    </div>
  ));
}

const TABS = [
  { key: 'programme', label: 'Programme', Component: ProgrammeTab },
  { key: 'site_log', label: 'Site Log', Component: SiteLogTab },
  { key: 'payments', label: 'Payments', Component: PaymentsTab },
  { key: 'documents', label: 'Documents', Component: DocumentsTab },
  { key: 'approvals', label: 'Approvals', Component: ApprovalsTab },
];

export default function PortalApp() {
  const [screen, setScreen] = useState('loading'); // loading | activate | login | app
  const [sessionToken, setSessionToken] = useState(null);
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('approvals');

  useEffect(() => {
    const token = getUrlParam('token');
    if (window.location.pathname.includes('/activate') && token) {
      setScreen('activate');
      return;
    }
    if (window.location.pathname.includes('/reset') && token) {
      setScreen('reset');
      return;
    }
    const storedSession = localStorage.getItem('portal_session');
    const storedUser = localStorage.getItem('portal_user');
    if (storedSession && storedUser) {
      setSessionToken(storedSession);
      setUser(JSON.parse(storedUser));
      setScreen('app');
    } else {
      setScreen('login');
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('portal_session');
    localStorage.removeItem('portal_user');
    setSessionToken(null);
    setUser(null);
    setScreen('login');
  };

  if (screen === 'loading') return null;

  if (screen === 'activate') {
    return <ActivateScreen token={getUrlParam('token')} onActivated={() => {
      window.location.href = '/portal';
    }} />;
  }

  if (screen === 'reset') {
    return <ResetPasswordScreen token={getUrlParam('token')} onReset={() => {
      window.location.href = '/portal';
    }} />;
  }

  if (screen === 'forgot') {
    return <ForgotPasswordScreen onBack={() => setScreen('login')} />;
  }

  if (screen === 'login') {
    return <LoginScreen
      onLogin={(token, u) => { setSessionToken(token); setUser(u); setScreen('app'); }}
      onForgotPassword={() => setScreen('forgot')}
    />;
  }

  const visibleTabs = user?.user_type === 'subcontractor'
    ? TABS.filter(t => ['programme', 'site_log'].includes(t.key))
    : TABS;

  const ActiveComponent = (visibleTabs.find(t => t.key === activeTab) || visibleTabs[0])?.Component;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Project Portal</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#d1d5db' }}>{user?.name || user?.email}</div>
          <button onClick={handleLogout} style={{ background: 'none', border: '1px solid #374151', color: '#d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
      <div style={S.tabs}>
        {visibleTabs.map(t => (
          <div key={t.key} style={S.tab(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>{t.label}</div>
        ))}
      </div>
      <div style={S.content}>
        {ActiveComponent && <ActiveComponent sessionToken={sessionToken} />}
      </div>
    </div>
  );
}
