import { useState, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';

export default function Settings({ onNavigate }) {
  const { state, dispatch } = useApp();
  const { settings, currentUser } = state;
  const [activeTab, setActiveTab] = useState('profile');
  const [form, setForm] = useState({ ...settings });
  const [msStatus, setMsStatus] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({ ...settings });
  }, [settings]);

  useEffect(() => {
    checkMicrosoftConnection();
  }, [currentUser]);

  const checkMicrosoftConnection = async () => {
    if (!sb || !currentUser) return;
    try {
      const { data } = await sb
        .from('email_accounts')
        .select('access_token, token_expires_at')
        .eq('provider', 'outlook')
        .eq('user_id', currentUser.email || currentUser.id)
        .limit(1)
        .maybeSingle();
      if (data?.access_token) {
        const expired = data.token_expires_at && new Date(data.token_expires_at) < new Date();
        setMsStatus(expired ? 'Token expired — reconnect' : 'Connected ✓');
      } else {
        setMsStatus('Not connected');
      }
    } catch { setMsStatus('Unknown'); }
  };

  const saveSettings = () => {
    dispatch({ type: 'SET_SETTINGS', payload: form });
    if (form.theme !== settings.theme) dispatch({ type: 'SET_THEME', payload: form.theme });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const connectMicrosoft = () => {
    // Microsoft OAuth flow — redirect to auth endpoint
    const clientId = import.meta.env.VITE_MS_CLIENT_ID || '';
    const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');
    const scope = encodeURIComponent('https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access');
    if (!clientId) {
      alert('Microsoft client ID not configured. Contact your administrator.');
      return;
    }
    window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}`;
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm(f => ({ ...f, logoData: ev.target.result }));
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const TABS = ['profile', 'signature', 'email', 'billing', 'theme'];

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="tabs">
        {TABS.map(tab => (
          <div key={tab} className={`tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)} style={{ textTransform: 'capitalize' }}>
            {tab}
          </div>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div className="card">
          <div className="card-title">Profile</div>
          <div className="two-col">
            <div className="form-row"><label className="form-label">Full name</label><input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Title / qualifications</label><input value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Firm / company</label><input value={form.firm || ''} onChange={e => setForm(f => ({ ...f, firm: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Role</label>
              <select value={form.role || 'partywall'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="partywall">Party Wall Surveyor</option>
                <option value="building">Building Surveyor</option>
                <option value="pm">Project Manager</option>
                <option value="architect">Architect</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
            <div className="form-row"><label className="form-label">Phone</label><input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Mobile</label><input value={form.mobile || ''} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Email</label><input value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Website</label><input value={form.website || ''} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></div>
          </div>
          <div className="form-row"><label className="form-label">Address</label><input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
          <div className="form-row">
            <label className="form-label">Logo</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {form.logoData && <img src={form.logoData} style={{ maxHeight: 38, maxWidth: 78, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6 }} alt="Logo" />}
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                Upload logo <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
              </label>
              {form.logoData && <button className="btn btn-xs btn-ghost" onClick={() => setForm(f => ({ ...f, logoData: '' }))}>Remove</button>}
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Brand colour</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="color" value={form.brandColour || '#4f7fff'} onChange={e => setForm(f => ({ ...f, brandColour: e.target.value }))} style={{ width: 40, height: 34, padding: 2 }} />
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{form.brandColour || '#4f7fff'}</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'signature' && (
        <div className="card">
          <div className="card-title">Email signature</div>
          <div className="two-col">
            <div className="form-row"><label className="form-label">Name</label><input value={form.sigName || form.name || ''} onChange={e => setForm(f => ({ ...f, sigName: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Qualifications</label><input value={form.sigQuals || ''} onChange={e => setForm(f => ({ ...f, sigQuals: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Phone</label><input value={form.sigPhone || form.phone || ''} onChange={e => setForm(f => ({ ...f, sigPhone: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Email</label><input value={form.sigEmail || form.email || ''} onChange={e => setForm(f => ({ ...f, sigEmail: e.target.value }))} /></div>
          </div>
          <div className="form-row"><label className="form-label">Address</label><input value={form.sigAddress || form.address || ''} onChange={e => setForm(f => ({ ...f, sigAddress: e.target.value }))} /></div>
          <div className="form-row"><label className="form-label">Disclaimer</label><textarea value={form.sigDisclaimer || ''} onChange={e => setForm(f => ({ ...f, sigDisclaimer: e.target.value }))} rows={2} /></div>
          <div className="form-row">
            <label className="form-label">Firm logo for signature</label>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              Upload <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const r = new FileReader();
                r.onload = ev => setForm(f => ({ ...f, sigFirmLogoData: ev.target.result }));
                r.readAsDataURL(file);
                e.target.value = '';
              }} />
            </label>
            {form.sigFirmLogoData && <img src={form.sigFirmLogoData} style={{ maxHeight: 38, maxWidth: 78, objectFit: 'contain', marginLeft: 10 }} alt="" />}
          </div>
        </div>
      )}

      {activeTab === 'email' && (
        <div className="card">
          <div className="card-title">📨 Email connections</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 'var(--r)', marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: msStatus.includes('Connected') ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Microsoft Outlook</div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>{msStatus || 'Checking…'}</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={connectMicrosoft}>
              {msStatus.includes('Connected') ? 'Reconnect' : 'Connect Outlook'}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6 }}>
            Connect your Outlook account to send and receive emails directly within Ely.
          </div>
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="card">
          <div className="card-title">Billing & fees</div>
          <div className="two-col">
            <div className="form-row"><label className="form-label">Standard fee (£)</label><input value={form.fee || ''} onChange={e => setForm(f => ({ ...f, fee: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Hourly rate (£)</label><input value={form.hourlyRate || ''} onChange={e => setForm(f => ({ ...f, hourlyRate: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">SOC fee (£)</label><input value={form.socFee || ''} onChange={e => setForm(f => ({ ...f, socFee: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Agreed fee (£)</label><input value={form.agreedFee || ''} onChange={e => setForm(f => ({ ...f, agreedFee: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Bank name</label><input value={form.bankName || ''} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Sort code</label><input value={form.sortCode || ''} onChange={e => setForm(f => ({ ...f, sortCode: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Account no</label><input value={form.accountNo || ''} onChange={e => setForm(f => ({ ...f, accountNo: e.target.value }))} /></div>
            <div className="form-row"><label className="form-label">Payment terms (days)</label><input type="number" value={form.paymentTerms || 14} onChange={e => setForm(f => ({ ...f, paymentTerms: parseInt(e.target.value) || 14 }))} /></div>
          </div>
          <div className="toggle-row">
            <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>VAT registered</span>
            <label className="toggle">
              <input type="checkbox" checked={!!form.vatRegistered} onChange={e => setForm(f => ({ ...f, vatRegistered: e.target.checked }))} />
              <span className="tslider" />
            </label>
          </div>
          {form.vatRegistered && (
            <div className="form-row" style={{ marginTop: 10 }}><label className="form-label">VAT rate (%)</label><input type="number" value={form.vatRate || 20} onChange={e => setForm(f => ({ ...f, vatRate: parseInt(e.target.value) || 20 }))} /></div>
          )}
        </div>
      )}

      {activeTab === 'theme' && (
        <div className="card">
          <div className="card-title">Appearance</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {['dark', 'light', 'system'].map(t => (
              <div
                key={t}
                id={`theme-${t}-opt`}
                onClick={() => setForm(f => ({ ...f, theme: t }))}
                style={{
                  padding: '14px 18px', border: `2px solid ${form.theme === t ? 'var(--blue)' : 'var(--border)'}`,
                  borderRadius: 'var(--rl)', cursor: 'pointer', textAlign: 'center', flex: 1,
                  background: form.theme === t ? 'var(--blue-bg)' : 'var(--bg4)',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 6 }}>{t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '🖥'}</div>
                <div style={{ fontSize: 12.5, fontWeight: 500, textTransform: 'capitalize' }}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={saveSettings} style={{ flex: 1, justifyContent: 'center' }}>
          {saved ? '✓ Saved!' : 'Save settings'}
        </button>
      </div>

      {currentUser && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', fontSize: 12, color: 'var(--text3)' }}>
          Logged in as: {currentUser.email}
          {' '}
          <button className="btn btn-xs btn-danger" onClick={async () => {
            if (sb) await sb.auth.signOut();
            window.location.reload();
          }}>Log out</button>
        </div>
      )}
    </div>
  );
}
