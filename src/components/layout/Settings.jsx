import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';
import InvoiceSettings from '../accounting/InvoiceSettings';

const TABS = ['Firm', 'Templates', 'Placeholders', 'Email', 'Invoice', 'Account', 'AI', 'Nora'];

const TEMPLATE_LABELS = {
  loa_bo: 'LoA - Building Owner',
  loa_bo_pdf: 'LoA - Building Owner (PDF)',
  loa_ao: 'LoA - Adjoining Owner',
  loa_ao_pdf: 'LoA - Adjoining Owner (PDF)',
  loa_as_pdf: 'LoA - Agreed Surveyor (PDF)',
  s1: 'Section 1 Notice',
  s3: 'Section 3 Notice',
  s6: 'Section 6 Notice',
  s10: 'Section 10 Notice',
  award_2s: 'Two Surveyor Award',
  award_as: 'Agreed Surveyor Award',
  award_s10: 'Section 10(4)(b) Award',
  s10_4b_letter_ao: '10(4)(b) Letter to AO',
  s10_4b_surveyor_appointment: '10(4)(b) Surveyor Appointment',
  appt: 'Appointment Letter',
  cover: 'Covering Letter',
  soc: 'Schedule of Condition',
  invoice: 'Invoice',
  mediation_agreement: 'Mediation Agreement',
};

function fmtSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function imageSrcFromBase64(value) {
  if (!value) return '';
  const text = String(value);
  if (text.startsWith('data:')) return text;
  return `data:image/png;base64,${text}`;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ImageAssetBlock({ title, description, value, inputRef, onUpload, onClear, uploadLabel, replaceLabel, maxWidth = 400, maxHeight = 120 }) {
  return (
    <div style={{ marginTop: 8, padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>{description}</div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" style={{ display: 'none' }} onChange={onUpload} />

      {value ? (
        <div>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 12, display: 'inline-block', maxWidth: '100%' }}>
            <img
              src={imageSrcFromBase64(value)}
              alt={title}
              style={{ maxWidth, maxHeight, display: 'block', objectFit: 'contain' }}
              onError={e => { e.currentTarget.src = `data:image/jpeg;base64,${value}`; }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => inputRef.current?.click()} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>{replaceLabel}</button>
            <button onClick={onClear} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)' }}>Remove</button>
          </div>
        </div>
      ) : (
        <div>
          <button onClick={() => inputRef.current?.click()} style={{ padding: '8px 16px', borderRadius: 99, fontSize: 13, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>{uploadLabel}</button>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>PNG or JPG, ideally on a transparent background.</div>
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);
  const activeKey = useRef(null);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from('document_templates')
        .select('template_key, label, filename, file_size, generation_mode, is_active, updated_at')
        .order('label');
      setTemplates(data || []);
    } catch (err) {
      console.error(err);
    }
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || `${tpl.template_key}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed: ' + err.message);
    }
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
      const b64 = await fileToBase64(file);
      const payload = {
        template_key: activeKey.current,
        label: TEMPLATE_LABELS[activeKey.current] || activeKey.current,
        file_b64: b64,
        filename: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        generation_mode: 'docx',
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from('document_templates')
        .upsert(payload, {
          onConflict: 'template_key',
        });

      if (error) throw error;
      setMessage(`✅ ${file.name} uploaded successfully`);
      loadTemplates();
    } catch (err) {
      setMessage(`❌ Upload failed: ${err.message}`);
    }
    setUploading(null);
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading templates...</div>;

  return (
    <div>
      <input ref={fileInputRef} type="file" accept=".docx,.doc,.pdf,.html" style={{ display: 'none' }} onChange={handleFileChange} />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Document Templates</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          These are the DOCX templates used to generate notices, awards and letters. Click <strong>Replace</strong> to upload a new version. The existing template is overwritten. Click <strong>Download</strong> to get a copy of the current file.
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
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: tpl ? 'var(--blue-bg)' : 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                {tpl ? '📄' : '⬜'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tpl?.label || defaultLabel}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                  {tpl ? `${tpl.filename} . ${fmtSize(tpl.file_size)} . Updated ${fmtDate(tpl.updated_at)}` : 'No file uploaded yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {tpl && (
                  <button onClick={() => handleDownload(tpl)} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 500 }}>
                    ⬇ Download
                  </button>
                )}
                <button onClick={() => handleReplaceClick(key)} disabled={isUploading} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>
                  {isUploading ? 'Uploading...' : tpl ? '↑ Replace' : '↑ Upload'}
                </button>
              </div>
            </div>
          );
        })}
        {templates.filter(t => !TEMPLATE_LABELS[t.template_key]).map(tpl => (
          <div key={tpl.template_key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--blue-bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
              📄
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tpl.label || tpl.template_key}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                {tpl.filename} · {fmtSize(tpl.file_size)} · Updated {fmtDate(tpl.updated_at)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => handleDownload(tpl)} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 500 }}>
                ⬇ Download
              </button>
              <button onClick={() => handleReplaceClick(tpl.template_key)} disabled={uploading === tpl.template_key} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>
                {uploading === tpl.template_key ? 'Uploading...' : '↑ Replace'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function PlaceholdersTab() {
  const [copied, setCopied] = useState(null);

  const copy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const groups = [
    {
      title: 'Building Owner',
      items: [
        { key: 'BO_NAME', desc: 'Full name(s) of building owner(s)' },
        { key: 'BO_NAME_1', desc: 'First building owner name' },
        { key: 'BO_NAME_2', desc: 'Second building owner name (if any)' },
        { key: 'BO_PREMISE', desc: 'Building owner property address' },
        { key: 'BO_SERVICE_ADDRESS', desc: 'Building owner service address' },
        { key: 'BO_PARTY', desc: '"Building Owner" or "Building Owners"' },
        { key: 'BO_I_WE', desc: '"I" or "We" (based on number of BOs)' },
        { key: 'BO_MY_OUR', desc: '"my" or "our"' },
        { key: 'BO_AM_ARE', desc: '"am" or "are"' },
        { key: 'BO_OWNER_S', desc: '"owner" or "owners"' },
      ],
    },
    {
      title: 'Adjoining Owner',
      items: [
        { key: 'AO_NAME', desc: 'Full name(s) of adjoining owner(s)' },
        { key: 'AO_NAME_1', desc: 'First adjoining owner name' },
        { key: 'AO_NAME_2', desc: 'Second adjoining owner name (if any)' },
        { key: 'AO_PREMISE', desc: 'Adjoining owner property address' },
        { key: 'AO_SERVICE_ADDRESS', desc: 'Adjoining owner service address' },
        { key: 'AO_SERVICE_LINE_1', desc: 'AO service address line 1' },
        { key: 'AO_SERVICE_LINE_2', desc: 'AO service address line 2' },
        { key: 'AO_SERVICE_LINE_3', desc: 'AO service address line 3' },
        { key: 'AO_PARTY', desc: '"Adjoining Owner" or "Adjoining Owners"' },
        { key: 'AO_I_WE', desc: '"I" or "We" (based on number of AOs)' },
        { key: 'AO_MY_OUR', desc: '"my" or "our"' },
        { key: 'AO_AM_ARE', desc: '"am" or "are"' },
        { key: 'AO_OWNER_S', desc: '"owner" or "owners"' },
        { key: 'AO_SURVEYOR_NAME', desc: 'AO appointed surveyor name' },
        { key: 'AO_SURVEYOR_FIRM', desc: 'AO appointed surveyor firm' },
      ],
    },
    {
      title: 'Notice & Dates',
      items: [
        { key: 'NOTICE_DATE', desc: 'Notice served date (long format, e.g. 1st January 2026)' },
        { key: 'NOTICE_DATE_SHORT', desc: 'Notice served date (short, e.g. 2026-01-01)' },
        { key: 'NOTICE_SECTION', desc: 'Notice section (e.g. Section 1(5), Section 6(1))' },
        { key: 'NOTICE_SECTION_FULL', desc: 'Full section string including all sections in run' },
        { key: 'SECTION_10_NOTICE_DATE', desc: 'Section 10 notice date (long format)' },
        { key: 'SECTION_10_4_B_DATE', desc: 'Section 10(4)(b) date (long format)' },
        { key: 'SECTION_2_SUBSECTIONS', desc: 'Section 2 subsections (e.g. (a)(f)(j))' },
        { key: 'NOTIFIABLE_WORKS', desc: 'Description of notifiable works' },
      ],
    },
    {
      title: 'Multi-Run Notices',
      items: [
        { key: 'NOTICE_RUN_1_SECTIONS', desc: 'First notice run sections string' },
        { key: 'NOTICE_RUN_1_DATE', desc: 'First notice run date' },
        { key: 'NOTICE_RUN_1_AND', desc: '"and a further Notice under" (if run 2 exists)' },
        { key: 'NOTICE_RUN_2_SECTIONS', desc: 'Second notice run sections string' },
        { key: 'NOTICE_RUN_2_DATE', desc: 'Second notice run date' },
        { key: 'NOTICE_RUN_2_AND', desc: '"and a further Notice under" (if run 3 exists)' },
        { key: 'NOTICE_RUN_3_SECTIONS', desc: 'Third notice run sections string' },
        { key: 'NOTICE_RUN_3_DATE', desc: 'Third notice run date' },
        { key: 'MULTIPLE_NOTICE_RUN_RESPECTFULLY', desc: '"respectively" if multiple runs exist' },
      ],
    },
    {
      title: 'Award',
      items: [
        { key: 'AWARD_DATE', desc: 'Award date (long format)' },
        { key: 'AWARD_DATE_SHORT', desc: 'Award date (short)' },
        { key: 'AWARD_TYPE_LABEL', desc: 'e.g. "Agreed Surveyor Award", "Draft Award"' },
        { key: 'SOC_AGREED_DATE', desc: 'Schedule of conditions agreed date' },
        { key: 'SCHEDULE_1_DATE', desc: 'First schedule of conditions inspection date' },
        { key: 'SCHEDULE_2_DATE', desc: 'Second schedule inspection date (if any)' },
        { key: 'SCHEDULE_3_DATE', desc: 'Third schedule inspection date (if any)' },
        { key: 'ALL_NOTIFIABLE_WORKS', desc: 'All notifiable works description' },
        { key: 'SECTION_11_AMOUNT', desc: 'Section 11 security amount (£)' },
        { key: 'SECURITY_AMOUNT', desc: 'Security amount (£)' },
        { key: 'THIRD_SURVEYOR', desc: 'Third surveyor name' },
        { key: 'THIRD_SURVEYOR_FIRM', desc: 'Third surveyor firm' },
      ],
    },
    {
      title: 'Surveyor / Firm',
      items: [
        { key: 'SURVEYOR_NAME', desc: 'Your name' },
        { key: 'SURVEYOR_FIRM', desc: 'Your firm name' },
        { key: 'PROJECT_REF', desc: 'Project reference number' },
      ],
    },
    {
      title: 'LOA (Letter of Appointment)',
      items: [
        { key: 'AO_NAME_1', desc: 'First AO name' },
        { key: 'AO_NAME_2', desc: 'Second AO name (if any)' },
        { key: 'AO_PREMISE', desc: 'AO property address' },
        { key: 'AO_SERVICE_ADDRESS', desc: 'AO service address' },
        { key: 'BO_PREMISE', desc: 'BO property address' },
      ],
    },
    {
      title: 'Mediation Agreement',
      items: [
        { key: 'PARTY_A_1_NAME', desc: 'First named person, Party A' },
        { key: 'PARTY_A_1_ADDRESS', desc: 'Address of first named person, Party A' },
        { key: 'PARTY_A_2_NAME', desc: 'Second named person, Party A (if any)' },
        { key: 'PARTY_A_2_ADDRESS', desc: 'Address of second named person, Party A (if any)' },
        { key: 'PARTY_B_1_NAME', desc: 'First named person, Party B' },
        { key: 'PARTY_B_1_ADDRESS', desc: 'Address of first named person, Party B' },
        { key: 'PARTY_B_2_NAME', desc: 'Second named person, Party B (if any)' },
        { key: 'PARTY_B_2_ADDRESS', desc: 'Address of second named person, Party B (if any)' },
        { key: 'DISPUTE_DESCRIPTION', desc: "Summary of the dispute — from each party's case notes" },
        { key: 'AGREEMENT_DAY', desc: "Day of the agreement date, e.g. '14th'" },
        { key: 'AGREEMENT_MONTH', desc: "Month of the agreement date, e.g. 'August'" },
        { key: 'AGREEMENT_YEAR', desc: "Year of the agreement date, e.g. '2026'" },
      ],
    },
  ];

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: 13,
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Template Placeholders</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          Use these placeholders in your Word templates. Wrap each one in double curly braces — e.g. <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>{'{{AO_NAME}}'}</code>. Click the copy button to copy it ready to paste.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map(group => (
          <div key={group.title} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg2)' }}>
            <div style={{ padding: '10px 14px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {group.title}
            </div>
            {group.items.map((item, i) => {
              const tag = `{{${item.key}}}`;
              const id = `${group.title}-${item.key}`;
              const isCopied = copied === id;
              return (
                <div key={item.key} style={{ ...rowStyle, background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)' }}>
                  <code style={{ fontSize: 12, background: 'var(--bg3)', padding: '2px 7px', borderRadius: 6, color: 'var(--blue)', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {tag}
                  </code>
                  <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text3)' }}>{item.desc}</div>
                  <button
                    onClick={() => copy(tag, id)}
                    style={{
                      padding: '4px 10px', borderRadius: 99, fontSize: 11.5, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: isCopied ? 'var(--green-bg)' : 'var(--bg3)',
                      color: isCopied ? 'var(--green)' : 'var(--text2)',
                      fontWeight: 500, flexShrink: 0, transition: 'all 0.15s',
                    }}
                  >
                    {isCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FirmTab() {
  const { state } = useApp();
  const { currentUser } = state;
  const [form, setForm] = useState({
    firmName: '', surveyorName: '', qualifications: '',
    addressLine1: '', addressLine2: '', city: '', postcode: '',
    tel: '', email: '', website: '',
  });
  const [firmSettingsId, setFirmSettingsId] = useState(null);
  const [sigB64, setSigB64] = useState(null);
  const [logoB64, setLogoB64] = useState(null);
  const [accreditationB64, setAccreditationB64] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const sigInputRef = useRef(null);
  const logoInputRef = useRef(null);
  const accreditationInputRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      if (!sb) return;
      setLoading(true);
      try {
        const { data, error } = await sb.from('firm_settings').select('*').limit(1).maybeSingle();
        if (error) throw error;
        if (data) {
          setFirmSettingsId(data.id || null);
          setForm({
            firmName: data.firm_name || '',
            surveyorName: data.surveyor_name || '',
            qualifications: data.qualifications || '',
            addressLine1: data.address_line1 || '',
            addressLine2: data.address_line2 || '',
            city: data.city || '',
            postcode: data.postcode || '',
            tel: data.tel || '',
            email: data.email || '',
            website: data.website || '',
          });
          setSigB64(data.signature_b64 || null);
          setLogoB64(data.logo_base64 || null);
          setAccreditationB64(data.accreditation_b64 || null);
        }
      } catch (err) {
        console.error('[Settings] firm_settings load failed:', err);
      }
      setLoading(false);
    };
    load();
  }, [currentUser]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const updateFirmSettings = async (payload) => {
    if (!sb) return;
    const cleanPayload = {
      ...payload,
      user_id: currentUser?.id || undefined,
      updated_at: new Date().toISOString(),
    };

    if (firmSettingsId) {
      const { error } = await sb.from('firm_settings').update(cleanPayload).eq('id', firmSettingsId);
      if (error) throw error;
      return;
    }

    const { data, error } = await sb.from('firm_settings').insert([cleanPayload]).select('id').single();
    if (error) throw error;
    if (data?.id) setFirmSettingsId(data.id);
  };

  const save = async () => {
    if (!sb) return;
    try {
      await updateFirmSettings({
        firm_name: form.firmName,
        surveyor_name: form.surveyorName,
        qualifications: form.qualifications,
        address_line1: form.addressLine1,
        address_line2: form.addressLine2,
        city: form.city,
        postcode: form.postcode,
        tel: form.tel,
        email: form.email,
        website: form.website,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  };

  const handleImageUpload = async (e, fieldName, setter) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await fileToBase64(file);
      setter(b64);
      await updateFirmSettings({ [fieldName]: b64 });
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  const clearImage = async (fieldName, setter) => {
    try {
      setter(null);
      await updateFirmSettings({ [fieldName]: null });
    } catch (err) {
      alert('Remove failed: ' + err.message);
    }
  };

  const inp = { width: '100%', padding: '8px 11px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[
        { label: 'Firm name', key: 'firmName' },
        { label: 'Surveyor name', key: 'surveyorName' },
        { label: 'Qualifications', key: 'qualifications', placeholder: 'e.g. MRICS ACIArb' },
        { label: 'Address line 1', key: 'addressLine1' },
        { label: 'Address line 2', key: 'addressLine2' },
        { label: 'City', key: 'city' },
        { label: 'Postcode', key: 'postcode' },
        { label: 'Phone', key: 'tel' },
        { label: 'Email', key: 'email' },
        { label: 'Website', key: 'website' },
      ].map(({ label, key, placeholder }) => (
        <div key={key}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{label}</div>
          <input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={placeholder || ''} style={inp} />
        </div>
      ))}

      <button onClick={save} className="btn btn-primary" style={{ cursor: 'pointer', borderRadius: 99, marginTop: 4, justifyContent: 'center' }}>
        {saved ? '✓ Saved!' : 'Save firm details'}
      </button>

      <ImageAssetBlock
        title="Firm logo"
        description="Upload the Square One Consulting logo used in email signatures and generated documents."
        value={logoB64}
        inputRef={logoInputRef}
        onUpload={(e) => handleImageUpload(e, 'logo_base64', setLogoB64)}
        onClear={() => clearImage('logo_base64', setLogoB64)}
        uploadLabel="↑ Upload logo"
        replaceLabel="↑ Replace logo"
        maxWidth={260}
        maxHeight={90}
      />

      <ImageAssetBlock
        title="Email signature image"
        description="Upload a PNG or JPG of your handwritten signature. It will be appended to emails and included in generated documents."
        value={sigB64}
        inputRef={sigInputRef}
        onUpload={(e) => handleImageUpload(e, 'signature_b64', setSigB64)}
        onClear={() => clearImage('signature_b64', setSigB64)}
        uploadLabel="↑ Upload signature image"
        replaceLabel="↑ Replace signature"
        maxWidth={400}
        maxHeight={120}
      />

      <ImageAssetBlock
        title="Accreditation image"
        description="Upload the accreditation or membership badge used in email signatures and generated documents."
        value={accreditationB64}
        inputRef={accreditationInputRef}
        onUpload={(e) => handleImageUpload(e, 'accreditation_b64', setAccreditationB64)}
        onClear={() => clearImage('accreditation_b64', setAccreditationB64)}
        uploadLabel="↑ Upload accreditation image"
        replaceLabel="↑ Replace accreditation"
        maxWidth={260}
        maxHeight={90}
      />

      {(form.surveyorName || form.firmName) && (
        <div style={{ padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Signature preview</div>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '20px 24px', color: '#222', fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.8 }}>
            {logoB64 && <img src={imageSrcFromBase64(logoB64)} alt="Logo" style={{ maxHeight: 52, maxWidth: 190, objectFit: 'contain', display: 'block', marginBottom: 10 }} onError={e => { e.currentTarget.src = `data:image/jpeg;base64,${logoB64}`; }} />}
            <div style={{ fontWeight: 700, fontSize: 14 }}>{form.surveyorName}</div>
            {form.qualifications && <div style={{ color: '#555' }}>{form.qualifications}</div>}
            <hr style={{ border: 'none', borderTop: '2px solid #4f7fff', margin: '8px 0' }} />
            <div style={{ fontWeight: 600 }}>{form.firmName}</div>
            {(form.addressLine1 || form.addressLine2) && <div style={{ color: '#555' }}>{[form.addressLine1, form.addressLine2, form.city, form.postcode].filter(Boolean).join(', ')}</div>}
            {form.tel && <div style={{ color: '#555' }}>T: {form.tel}</div>}
            {form.email && <div><a href={`mailto:${form.email}`} style={{ color: '#4f7fff' }}>{form.email}</a></div>}
            {form.website && <div><a href={form.website} style={{ color: '#4f7fff' }}>{form.website}</a></div>}
            {sigB64 && <img src={imageSrcFromBase64(sigB64)} alt="Signature" style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', marginTop: 8, display: 'block' }} onError={e => { e.currentTarget.src = `data:image/jpeg;base64,${sigB64}`; }} />}
            {accreditationB64 && <img src={imageSrcFromBase64(accreditationB64)} alt="Accreditation" style={{ maxHeight: 44, maxWidth: 180, objectFit: 'contain', marginTop: 10, display: 'block' }} onError={e => { e.currentTarget.src = `data:image/jpeg;base64,${accreditationB64}`; }} />}
          </div>
        </div>
      )}
    </div>
  );
}

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

  const tokenExpiry = account?.token_expires_at ? new Date(account.token_expires_at) : null;
  const tokenValid = tokenExpiry && tokenExpiry > new Date();
  const needsReconnect = account?.reconnect_required;
  const statusColour = needsReconnect ? 'var(--red)' : tokenValid ? 'var(--green)' : 'var(--amber)';
  const statusLabel = needsReconnect ? 'Reconnection required' : tokenValid ? 'Connected and syncing' : 'Token expired';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Microsoft / Outlook</div>
        {loading ? (
          <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Checking connection...</div>
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
        <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Your signature is built from your firm details and images in the Firm tab and attached automatically to outgoing emails.</div>
      </div>
    </div>
  );
}

function NoraTab() {
  const [settings, setSettings] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [firmId, setFirmId] = React.useState(null);

  React.useEffect(() => {
    sb.from('firm_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      if (data) {
        setFirmId(data.id);
        setSettings({
          nora_auto_send:        data.nora_auto_send        ?? false,
          nora_auto_draft:       data.nora_auto_draft       ?? false,
          nora_use_templates:    data.nora_use_templates    ?? true,
          nora_personality:      data.nora_personality      || 'professional',
        });
      } else {
        setSettings({ nora_auto_send: false, nora_auto_draft: false, nora_use_templates: true, nora_personality: 'professional' });
      }
    });
  }, []);

  const save = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    const payload = {
      nora_auto_send:     next.nora_auto_send,
      nora_auto_draft:    next.nora_auto_draft,
      nora_use_templates: next.nora_use_templates,
      nora_personality:   next.nora_personality,
      updated_at: new Date().toISOString(),
    };
    if (firmId) {
      await sb.from('firm_settings').update(payload).eq('id', firmId);
    } else {
      const { data } = await sb.from('firm_settings').insert([payload]).select('id').single();
      if (data?.id) setFirmId(data.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!settings) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</div>;

  const row = (label, desc, key) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{desc}</div>
      </div>
      <div
        onClick={() => save({ [key]: !settings[key] })}
        style={{
          width: 42, height: 24, borderRadius: 99, cursor: 'pointer', flexShrink: 0,
          background: settings[key] ? 'var(--accent, #2563eb)' : 'var(--border)',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: settings[key] ? 21 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
    </div>
  );

  const PERSONALITIES = [
    { value: 'professional', label: 'Professional', desc: 'Formal, measured, precise — standard surveyor tone' },
    { value: 'conversational', label: 'Conversational', desc: 'Friendly but professional — approachable and clear' },
    { value: 'warm', label: 'Warm', desc: 'Empathetic and personable — good for difficult AO relations' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
        Control how Nora behaves across the app. Changes take effect immediately.
      </div>

      {row('Auto-send emails', 'Nora sends drafted emails automatically without asking for review first', 'nora_auto_send')}
      {row('Auto-draft responses', 'Nora automatically drafts a reply when an email arrives that needs a response', 'nora_auto_draft')}
      {row('Use built-in notice templates', 'Use SQ1 master templates for notices and awards rather than custom uploads', 'nora_use_templates')}

      {/* Personality selector */}
      <div style={{ padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Nora personality</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>How Nora sounds when drafting emails and notices on your behalf</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PERSONALITIES.map(p => (
            <div
              key={p.value}
              onClick={() => save({ nora_personality: p.value })}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                borderRadius: 8, cursor: 'pointer',
                border: `1.5px solid ${settings.nora_personality === p.value ? 'var(--accent, #2563eb)' : 'var(--border)'}`,
                background: settings.nora_personality === p.value ? 'var(--blue-bg, #eff6ff)' : 'var(--bg)',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${settings.nora_personality === p.value ? 'var(--accent, #2563eb)' : 'var(--border)'}`,
                background: settings.nora_personality === p.value ? 'var(--accent, #2563eb)' : 'transparent',
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{p.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(saving || saved) && (
        <div style={{ fontSize: 12, color: saving ? 'var(--text3)' : 'var(--green)', textAlign: 'right' }}>
          {saving ? 'Saving…' : '✓ Saved'}
        </div>
      )}
    </div>
  );
}

function AITab() {
  const [status, setStatus] = useState(null); // null | 'running' | 'done' | 'error'
  const [progress, setProgress] = useState({ emails: 0, messages: 0, memory: 0, errors: 0, batches: 0, last_error: null });
  const [counts, setCounts] = useState(null);
  const runningRef = React.useRef(false);

  const checkCounts = async () => {
    try {
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'count' }),
      });
      const data = await res.json();
      if (data.counts) setCounts(data.counts);
    } catch {}
  };

  React.useEffect(() => { checkCounts(); }, []);

  const runBackfill = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('running');
    setProgress({ emails: 0, messages: 0, memory: 0, errors: 0, batches: 0 });

    let totalEmails = 0, totalMessages = 0, totalMemory = 0, totalErrors = 0, batches = 0;
    let hasMore = true;

    while (hasMore && runningRef.current) {
      try {
        const res = await fetch('/api/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'backfill' }),
        });
        const data = await res.json();
        if (!data.success) { setStatus('error'); setProgress(p => ({ ...p, last_error: data.error || 'Unknown error' })); break; }

        const r = data.results || {};
        totalEmails += r.emails || 0;
        totalMessages += r.messages || 0;
        totalMemory += r.memory || 0;
        totalErrors += r.errors || 0;
        batches++;

        setProgress({ emails: totalEmails, messages: totalMessages, memory: totalMemory, errors: totalErrors, batches });

        // If this batch processed nothing, we're done
        const batchTotal = (r.emails || 0) + (r.messages || 0) + (r.memory || 0);
        if (batchTotal === 0) {
          hasMore = false;
        } else {
          // Small delay between batches to avoid rate limits
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (err) {
        setStatus('error');
        break;
      }
    }

    if (hasMore === false) setStatus('done');
    runningRef.current = false;
    checkCounts();
  };

  const stopBackfill = () => { runningRef.current = false; setStatus(null); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '16px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>🔍 Semantic Search Index</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>
          Indexes all project emails, chat messages and documents so Ely can search across everything instantly — no limits.
          Run this once to index existing content. New content is indexed automatically going forward.
        </div>

        {counts && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Emails indexed', done: counts.emails_done, total: counts.emails_total },
              { label: 'Chat messages', done: counts.messages_done, total: counts.messages_total },
              { label: 'Documents & notes', done: counts.memory_done, total: counts.memory_total },
            ].map(({ label, done, total }) => (
              <div key={label} style={{ flex: 1, minWidth: 120, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: done === total && total > 0 ? 'var(--green)' : 'var(--text)' }}>
                  {done} / {total}
                </div>
                {total > 0 && (
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 6 }}>
                    <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${Math.round((done/total)*100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {status === 'running' && (
          <div style={{ padding: '10px 12px', background: 'var(--blue-bg)', borderRadius: 8, marginBottom: 12, fontSize: 12.5 }}>
            ⚙️ Indexing... Batch {progress.batches} — {progress.emails} emails, {progress.messages} messages, {progress.memory} documents indexed
            {progress.errors > 0 && <span style={{ color: 'var(--red)', marginLeft: 8 }}>{progress.errors} errors</span>}
          </div>
        )}

        {status === 'done' && (
          <div style={{ padding: '10px 12px', background: 'var(--green-bg, #f0fdf4)', borderRadius: 8, marginBottom: 12, fontSize: 12.5, color: 'var(--green)' }}>
            ✅ All done — {progress.emails} emails, {progress.messages} messages, {progress.memory} documents indexed across {progress.batches} batches.
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: '10px 12px', background: 'var(--red-bg)', borderRadius: 8, marginBottom: 12, fontSize: 12.5, color: 'var(--red)' }}>
            ⚠️ Something went wrong — {progress.last_error || 'Check that OPENAI_API_KEY is set in Vercel env vars.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {status !== 'running' ? (
            <button
              onClick={runBackfill}
              style={{ padding: '8px 18px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              {status === 'done' ? '↻ Re-index' : '▶ Start Indexing'}
            </button>
          ) : (
            <button
              onClick={stopBackfill}
              style={{ padding: '8px 18px', borderRadius: 99, fontSize: 13, cursor: 'pointer', background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red)' }}
            >
              ⏹ Stop
            </button>
          )}
          <button
            onClick={checkCounts}
            style={{ padding: '8px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)' }}
          >
            ↻ Refresh counts
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('Firm');

  return (
    <div style={{ padding: '24px 28px', maxWidth: 700 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>Settings</div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 18px', fontSize: 13, border: 'none', cursor: 'pointer',
            background: 'none', fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? 'var(--blue)' : 'var(--text2)',
            borderBottom: activeTab === tab ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: 0,
          }}>{tab}</button>
        ))}
      </div>

      {activeTab === 'Firm' && <FirmTab />}
      {activeTab === 'Templates' && <TemplatesTab />}
      {activeTab === 'Placeholders' && <PlaceholdersTab />}
      {activeTab === 'Email' && <EmailTab />}
      {activeTab === 'Invoice' && <InvoiceSettings />}
      {activeTab === 'Account' && <AccountTab />}
      {activeTab === 'AI' && <AITab />}
      {activeTab === 'Nora' && <NoraTab />}
    </div>
  );
}
