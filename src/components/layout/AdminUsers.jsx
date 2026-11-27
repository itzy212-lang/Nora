// src/components/layout/AdminUsers.jsx
//
// Admin page (owner only; the server checks user_plans.is_admin on every call, api/admin-users.js).
// Every user with their plan, the bolt-ons they pay for, free access (until a date or indefinitely),
// trial and lock. Works the same for every user, whichever mail or storage provider they use.
import React, { useState, useEffect, useCallback } from 'react';
import sb from '../../supabaseClient';

const ADDONS = [
  { id: 'assistant', name: 'Nora Assistant', price: '£39' },
  { id: 'soc', name: 'Schedule of Condition', price: '£20' },
];

async function call(method, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch('/api/admin-users', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'That did not work');
  return json;
}

const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
const dateInput = iso => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const same = (a, b) => [...a].sort().join() === [...b].sort().join();

function Boxes({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {ADDONS.map(a => (
        <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: disabled ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={value.includes(a.id)} disabled={disabled} onChange={() => onChange(toggle(value, a.id))} />
          {a.name} <span style={{ color: 'var(--text3)' }}>+{a.price}</span>
        </label>
      ))}
    </div>
  );
}

function UserCard({ u, me, onUsers }) {
  const [addons, setAddons] = useState(u.addons);
  const [freeMode, setFreeMode] = useState(u.complimentary_addons == null ? 'none' : (u.complimentary_until ? 'until' : 'always'));
  const [freeAddons, setFreeAddons] = useState(u.complimentary_addons || []);
  const [until, setUntil] = useState(dateInput(u.complimentary_until));
  const [note, setNote] = useState(u.complimentary_note || '');
  const [trialDays, setTrialDays] = useState('14');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const run = async (key, body, okText) => {
    setBusy(key); setMsg('');
    try {
      const out = await call('POST', { user_id: u.user_id, ...body });
      onUsers(out.users);
      setMsg(okText);
      window.dispatchEvent(new CustomEvent('ely:plan-changed'));
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  const locked = u.status === 'locked';
  const freeChanged = freeMode !== (u.complimentary_addons == null ? 'none' : (u.complimentary_until ? 'until' : 'always'))
    || (freeMode !== 'none' && (!same(freeAddons, u.complimentary_addons || []) || note !== (u.complimentary_note || '') || (freeMode === 'until' && until !== dateInput(u.complimentary_until))));
  const saveFree = () => run('free', freeMode === 'none'
    ? { action: 'set_complimentary', addons: null }
    : { action: 'set_complimentary', addons: freeAddons, until: freeMode === 'until' ? `${until}T23:59:59` : null, note },
  'Free access saved.');

  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 };
  const box = { marginTop: 14 };

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 4 }}>
        <span>{u.email || u.user_id}{u.is_admin ? <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--blue)' }}>ADMIN</span> : null}</span>
        <span style={{ fontWeight: 500, color: locked ? 'var(--red)' : 'var(--text2)' }}>{u.access.label}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
        {u.access.note ? `${u.access.note} · ` : ''}Joined {fmt(u.created_at)} · Last seen {fmt(u.last_sign_in_at)}
        {u.status === 'trial' && u.trial_ends_at ? ` · Trial ends ${fmt(u.trial_ends_at)}` : ''}
        {locked && u.locked_reason ? ` · ${u.locked_reason}` : ''}
      </div>

      <div style={box}>
        <div style={lbl}>Bolt-ons they pay for (Core is included)</div>
        <Boxes value={addons} onChange={setAddons} />
        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy || same(addons, u.addons)} onClick={() => run('addons', { action: 'set_addons', addons }, 'Bolt-ons saved.')}>
          {busy === 'addons' ? 'Saving…' : 'Save bolt-ons'}
        </button>
      </div>

      <div style={box}>
        <div style={lbl}>Free access (Core plus the bolt-ons ticked)</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8, fontSize: 13 }}>
          {[['none', 'None'], ['until', 'Until a date'], ['always', 'Indefinitely']].map(([id, text]) => (
            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name={`free-${u.user_id}`} checked={freeMode === id} onChange={() => setFreeMode(id)} /> {text}
            </label>
          ))}
        </div>
        {freeMode !== 'none' && (
          <>
            <Boxes value={freeAddons} onChange={setFreeAddons} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {freeMode === 'until' && <input type="date" value={until} onChange={e => setUntil(e.target.value)} style={{ padding: '5px 8px' }} />}
              <input type="text" placeholder="Note (why, e.g. friend, pilot)" value={note} onChange={e => setNote(e.target.value)} style={{ padding: '5px 8px', flex: 1, minWidth: 180 }} />
            </div>
          </>
        )}
        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy || !freeChanged || (freeMode === 'until' && !until)} onClick={saveFree}>
          {busy === 'free' ? 'Saving…' : 'Save free access'}
        </button>
      </div>

      <div style={{ ...box, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="number" min="1" max="365" value={trialDays} onChange={e => setTrialDays(e.target.value)} style={{ width: 64, padding: '5px 8px' }} />
        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('trial', { action: 'set_trial', days: trialDays }, 'Trial started.')}>Start free trial (days)</button>
        {locked
          ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('lock', { action: 'unlock' }, 'Unlocked.')}>Unlock account</button>
          : <button className="btn btn-ghost btn-sm" disabled={!!busy || u.user_id === me} style={{ color: 'var(--red)' }} onClick={() => { if (window.confirm(`Lock ${u.email}? Once plans are enforced they will lose access.`)) run('lock', { action: 'lock', reason: 'Locked by admin' }, 'Locked.'); }}>Lock account</button>}
        {msg && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{msg}</span>}
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [me, setMe] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      setMe(session?.user?.id || '');
      setUsers((await call('GET')).users);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 20, maxWidth: 760 }}>
      <h2 style={{ margin: '0 0 4px' }}>Admin</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        Core £20, Nora Assistant +£39, Schedule of Condition +£20 (ex VAT). All three £79. New accounts get a 14-day trial of everything.
      </p>
      <div className="card" style={{ background: 'var(--bg2)', fontSize: 12.5, color: 'var(--text2)' }}>
        Plans are not enforced yet. What you set here is recorded and shown in each person&apos;s left-hand menu, but nobody is blocked from anything until enforcement is switched on.
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
      {!users && !error && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}
      {users && users.map(u => <UserCard key={u.user_id} u={u} me={me} onUsers={setUsers} />)}
    </div>
  );
}
