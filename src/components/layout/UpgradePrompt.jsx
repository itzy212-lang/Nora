// src/components/layout/UpgradePrompt.jsx
//
// Shown when a feature needs a bolt-on the account does not have (the server answers 402, see
// src/utils/apiAuth.js). Mounted once in App.jsx. There is no billing yet, so "Request" records the request
// (api/request-upgrade.js) and it appears against that user on the Admin page.
import React, { useEffect, useState } from 'react';
import sb from '../../supabaseClient';

const ADDONS = {
  assistant: { name: 'Nora Assistant', price: '£39', what: 'Nora chat, drafting, project memory and the AI helpers.' },
  soc: { name: 'Schedule of Condition', price: '£20', what: 'Nora builds your Schedules of Condition from your dictated notes and photos.' },
};

export default function UpgradePrompt() {
  const [info, setInfo] = useState(null);
  const [sent, setSent] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const open = e => { setInfo(e.detail); setError(''); };
    window.addEventListener('nora:upgrade-needed', open);
    return () => window.removeEventListener('nora:upgrade-needed', open);
  }, []);

  if (!info) return null;
  const options = [].concat(info.needs).filter(id => ADDONS[id]);

  const request = async id => {
    setBusy(id); setError('');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch('/api/request-upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ addon: id }),
      });
      if (!res.ok) throw new Error('Could not send your request');
      setSent(s => ({ ...s, [id]: true }));
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  return (
    <div className="modal-bd" style={{ zIndex: 2000 }} onClick={() => setInfo(null)}>
      <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <h3>{options.length > 1 ? 'Add a bolt-on to use this' : `Add ${ADDONS[options[0]]?.name || 'a bolt-on'} to use this`}</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--text2)' }}>{info.message || 'This feature is not part of your plan yet.'}</p>
        {options.map(id => (
          <div key={id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{ADDONS[id].name} <span style={{ fontWeight: 400, color: 'var(--text3)' }}>+{ADDONS[id].price} a month + VAT</span></div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', margin: '4px 0 8px' }}>{ADDONS[id].what}</div>
            {sent[id]
              ? <div style={{ fontSize: 13, color: 'var(--green)' }}>Thanks, your request has been sent. We will be in touch.</div>
              : <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => request(id)}>{busy === id ? 'Sending…' : `Request ${ADDONS[id].name}`}</button>}
          </div>
        ))}
        {error && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{error}</div>}
        <div className="modal-footer"><button className="btn btn-ghost btn-sm" onClick={() => setInfo(null)}>Close</button></div>
      </div>
    </div>
  );
}
