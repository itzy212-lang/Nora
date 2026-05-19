import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';
import InvoiceSettings from '../accounting/InvoiceSettings';

const TABS = ['Firm', 'Templates', 'Email', 'Invoice', 'Account'];

const TEMPLATE_LABELS = {
  loa_bo:                    'LoA — Building Owner',
  loa_ao:                    'LoA — Adjoining Owner',
  s1:                        'Section 1 Notice',
  s3:                        'Section 3 Notice',
  s6:                        'Section 6 Notice',
  s10:                       'Section 10 Notice',
  award_2s:                  'Two Surveyor Award',
  award_as:                  'Agreed Surveyor Award',
  award_s10:                 'Section 10(4)(b) Award',
  s10_4b_letter_ao:          '10(4)(b) Letter to AO',
  s10_4b_surveyor_appointment: '10(4)(b) Surveyor Appointment',
  appt:                      'Appointment Letter',
  cover:                     'Covering Letter',
  soc:                       'Schedule of Condition',
  invoice:                   'Invoice',
};

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Templates tab ─────────────────────────────────────────────────────────────
function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(null);
  const [message, setMessage]     = useState('');
  const fileInputRef = useRef(null);
  const activeKey    = useRef(null);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from('document_templates')
        .select('template_key, label, filename, file_size, generation_mode, is_active, updated_at')
        .order('label');
      setTemplates(data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const handleDownload = async (tpl) => {
    try {
      const { data } = await sb.from('document_templates')
        .select('file_b64, filename, mime_type')
        .eq('template_key', tpl.template_key)
        .single();
      if (!data?.file_b64) { alert('No file stored for this template.'); return; }
      const mime = data.mime_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const binary = atob(data.file_b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = data.filename || `${tpl.template_key}.docx`;
      a.click(); URL.revokeObjectURL(url);
    } catch (err) { alert('Download failed: ' + err.message); }
  };

  const handleReplaceClick = (key) => {
    activeKey.current = key;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeKey.current) return;
    setUploading(activeKey.current);
    setMessage('');
    try {
      const b64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const { error } = await sb.from('document_templates').update({
        file_b64:   b64,
        filename:   file.name,
        file_size:  file.size,
        mime_type:  file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        updated_at: new Date().toISOString(),
      }).eq('template_key', activeKey.current);
      if (error) throw error;
      setMessage(`✅ ${file.name} uploaded successfully`);
      loadTemplates();
    } catch (err) { setMessage(`❌ Upload failed: ${err.message}`); }
    setUploading(null);
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading templates…</div>;

  return (
    <div>
      <input ref={fileInputRef} type="file" accept=".docx,.doc,.pdf,.html" style={{ display: 'none' }} onChange={handleFileChange} />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Document Templates</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          These are the DOCX templates used to generate notices, awards and letters. Click <strong>Replace</strong> to upload a new version — the existing template is overwritten. Click <strong>Download</strong> to get a copy of the current file.
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: message.startsWith('✅') ? 'var(--green-bg)' : 'var(--red-bg)', color: message.startsWith('✅') ? 'var(--green)' : 'var(--red)', fontSize: 13, fontWeight: 500 }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(TEMPLATE_LABELS).map(([key, defaultLabel]) => {
          const tpl = templates.find(t => t.template_key === key);
          const isUploading = uploading === key;
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: 'var(--bg3)',
              border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: tpl ? 'var(--blue-bg)' : 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                {tpl ? '📄' : '⬜'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tpl?.label || defaultLabel}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                  {tpl ? `${tpl.filename} · ${fmtSize(tpl.file_size)} · Updated ${fmtDate(tpl.updated_at)}` : 'No file uploaded yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {tpl && (
                  <button onClick={() => handleDownload(tpl)}
                    style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 500 }}>
                    ⬇ Download
                  </button>
                )}
                <button onClick={() => handleReplaceClick(key)} disabled={isUploading}
                  style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>
                  {isUploading ? 'Uploading…' : tpl ? '↑ Replace' : '↑ Upload'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Firm tab ──────────────────────────────────────────────────────────────────
function FirmTab() {
  const { state, dispatch } = useApp();
  const { currentUser } = state;
  const [form, setForm] = useState({
    firmName: '', surveyorName: '', qualifications: '',
    addressLine1: '', addressLine2: '', city: '', postcode: '',
    tel: '', email: '', website: '',
  });
  const [sigB64, setSigB64]   = useState(null);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);
  const sigInputRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      if (!sb) return;
      try {
        const { data } = await sb.from('firm_settings').select('*').limit(1).single();
        if (data) {
          setForm({
            firmName:      data.firm_name      || '',
            surveyorName:  data.surveyor_name  || '',
            qualifications: data.qualifications || '',
            addressLine1:  data.address_line1  || '',
            addressLine2:  data.address_line2  || '',
            city:          data.city           || '',
            postcode:      data.postcode       || '',
            tel:           data.tel            || '',
            email:         data.email          || '',
            website:       data.website        || '',
          });
          if (data.signature_b64) setSigB64(data.signature_b64);
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, [currentUser]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!sb) return;
    try {
      await sb.from('firm_settings').upsert({
        user_id:       currentUser?.id,
        firm_name:     form.firmName,
        surveyor_name: form.surveyorName,
        qualifications: form.qualifications,
        address_line1: form.addressLine1,
        address_line2: form.addressLine2,
        city:          form.city,
        postcode:      form.postcode,
        tel:           form.tel,
        email:         form.email,
        website:       form.website,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id' });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { alert('Save failed: ' + err.message); }
  };

  const handleSigUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    setSigB64(b64);
    await sb.from('firm_settings').update({ signature_b64: b64, updated_at: new Date().toISOString() }).eq('user_id', currentUser?.id);
  };

  const clearSignature = async () => {
    setSigB64(null);
    await sb.from('firm_settings').update({ signature_b64: null }).eq('user_id', currentUser?.id);
  };

  const inp = { width: '100%', padding: '8px 11px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[
        { label: 'Firm name',      key: 'firmName' },
        { label: 'Surveyor name',  key: 'surveyorName' },
        { label: 'Qualifications', key: 'qualifications', placeholder: 'e.g. MRICS ACIArb' },
        { label: 'Address line 1', key: 'addressLine1' },
        { label: 'Address line 2', key: 'addressLine2' },
        { label: 'City',           key: 'city' },
        { label: 'Postcode',       key: 'postcode' },
        { label: 'Phone',          key: 'tel' },
        { label: 'Email',          key: 'email' },
        { label: 'Website',        key: 'website' },
      ].map(({ label, key, placeholder }) => (
        <div key={key}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{label}</div>
          <input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={placeholder || ''} style={inp} />
        </div>
      ))}

      <button onClick={save} className="btn btn-primary" style={{ cursor: 'pointer', borderRadius: 99, marginTop: 4, justifyContent: 'center' }}>
        {saved ? '✓ Saved!' : 'Save firm details'}
      </button>

      <div style={{ marginTop: 8, padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Email signature image</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
          Upload a PNG or JPG of your signature. It will be appended to emails and included in generated documents.
        </div>
        {sigB64 ? (
          <div>
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 12, display: 'inline-block', maxWidth: '100%' }}>
              <img src={`data:image/png;base64,${sigB64}`} alt="Signature" style={{ maxWidth: 400, maxHeight: 120, display: 'block' }} onError={e => { e.target.src = `data:image/jpeg;base64,${sigB64}`; }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input ref={sigInputRef} type="file" accept="image/png,image/jpeg,image/gif" style={{ display: 'none' }} onChange={handleSigUpload} />
              <button onClick={() => sigInputRef.current?.click()} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>↑ Replace signature</button>
              <button onClick={clearSignature} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)' }}>Remove</button>
            </div>
          </div>
        ) : (
          <div>
            <input ref={sigInputRef} type="file" accept="image/png,image/jpeg,image/gif" style={{ display: 'none' }} onChange={handleSigUpload} />
            <button onClick={() => sigInputRef.current?.click()} style={{ padding: '8px 16px', borderRadius: 99, fontSize: 13, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>↑ Upload signature image</button>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>PNG or JPG, ideally on a transparent background</div>
          </div>
        )}
      </div>

      {(form.surveyorName || form.firmName) && (
        <div style={{ padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Signature preview</div>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '20px 24px', color: '#222', fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{form.surveyorName}</div>
            {form.qualifications && <div style={{ color: '#555' }}>{form.qualifications}</div>}
            <hr style={{ border: 'none', borderTop: '2px solid #4f7fff', margin: '8px 0' }} />
            <div style={{ fontWeight: 600 }}>{form.firmName}</div>
            {(form.addressLine1 || form.addressLine2) && <div style={{ color: '#555' }}>{[form.addressLine1, form.addressLine2, form.city, form.postcode].filter(Boolean).join(', ')}</div>}
            {form.tel   && <div style={{ color: '#555' }}>T: {form.tel}</div>}
            {form.email && <div><a href={`mailto:${form.email}`} style={{ color: '#4f7fff' }}>{form.email}</a></div>}
            {form.website && <div><a href={form.website} style={{ color: '#4f7fff' }}>{form.website}</a></div>}
            {sigB64 && <img src={`data:image/png;base64,${sigB64}`} alt="sig" style={{ maxHeight: 60, marginTop: 8 }} onError={e => { e.target.src = `data:image/jpeg;base64,${sigB64}`; }} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Account tab ───────────────────────────────────────────────────────────────
function AccountTab() {
  const { state } = useApp();
  const { currentUser } = state;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Logged in as</div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>{currentUser?.email}</div>
      </div>
      <button onClick={async () => { if (sb) { await sb.auth.signOut(); window.location.reload(); } }}
        style={{ padding: '8px 16px', borderRadius: 99, fontSize: 13, cursor: 'pointer', background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)', fontWeight: 600, textAlign: 'center' }}>
        Log out
      </button>
    </div>
  );
}

// ── Email settings tab ────────────────────────────────────────────────────────
function EmailTab() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!sb) return;
      const { data } = await sb.from('email_accounts').select('*').limit(1).single();
      setAccount(data);
      setLoading(false);
    };
    load();
  }, []);

  const tokenExpiry    = account?.token_expires_at ? new Date(account.token_expires_at) : null;
  const tokenValid     = tokenExpiry && tokenExpiry > new Date();
  const needsReconnect = account?.reconnect_required;
  const statusColour   = needsReconnect ? 'var(--red)' : tokenValid ? 'var(--green)' : 'var(--amber)';
  const statusLabel    = needsReconnect ? 'Reconnection required' : tokenValid ? 'Connected & syncing' : 'Token expired';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Microsoft / Outlook</div>
        {loading ? (
          <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Checking connection…</div>
        ) : account ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColour, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{account.email_address}</div>
                <div style={{ fontSize: 11.5, color: statusColour, marginTop: 1 }}>{statusLabel}</div>
              </div>
            </div>
            {tokenExpiry && (
              <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                Token expires: {tokenExpiry.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {account.last_token_error && (
              <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 10px', background: 'var(--red-bg)', borderRadius: 8 }}>⚠️ {account.last_token_error}</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>No email account connected.</div>
        )}
      </div>
      <div style={{ padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Email signature</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Your signature is built from your firm details (Firm tab) and attached automatically to outgoing emails.</div>
      </div>
    </div>
  );
}

// ── Main Settings ─────────────────────────────────────────────────────────────
export default function Settings() {
  const [activeTab, setActiveTab] = useState('Firm');

  return (
    <div style={{ padding: '24px 28px', maxWidth: 700 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>Settings</div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 2 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 18px', fontSize: 13, border: 'none', cursor: 'pointer',
            background: 'none', fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? 'var(--blue)' : 'var(--text2)',
            borderBottom: activeTab === tab ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: -1,
          }}>{tab}</button>
        ))}
      </div>

      {activeTab === 'Firm'      && <FirmTab />}
      {activeTab === 'Templates' && <TemplatesTab />}
      {activeTab === 'Email'     && <EmailTab />}
      {activeTab === 'Invoice'   && <InvoiceSettings />}
      {activeTab === 'Account'   && <AccountTab />}
    </div>
  );
}
