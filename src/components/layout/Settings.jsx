import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';
import InvoiceSettings from '../accounting/InvoiceSettings';
import IntegrationsSettings from '../settings/IntegrationsSettings';
import { clearEmailCache, clearReconciledCacheMarker } from '../../utils/emailCache';
import { unregisterPushNotifications } from '../../hooks/usePushNotifications';

const TABS = ['Firm', 'Templates', 'Placeholders', 'Email', 'Invoice', 'Account', 'Integrations', 'AI', 'Nora'];

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
  const { state } = useApp();
  const currentUserEmail = state.currentUser?.email || state.currentUser?.id || null;
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);
  const activeKey = useRef(null);

  useEffect(() => { loadTemplates(); }, [currentUserEmail]);

  // Fixed 2026-09-17, real, confirmed multi-user bug: this table used
  // to have exactly one row per template_key, shared and overwritable
  // by every user of the app — every user's "Replace" silently
  // overwrote the same file everyone else was using. document_templates
  // now has an owner_user_id column: NULL rows are the shared system
  // default (your existing SQ1 templates), non-null rows are a
  // specific user's own private override, enforced by RLS so no user
  // can read or write another user's override. This loads both sets
  // and merges them per template_key so a user sees their own version
  // if they have one, otherwise the system default.
  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data: defaults } = await sb.from('document_templates')
        .select('template_key, label, filename, file_size, generation_mode, is_active, updated_at, owner_user_id')
        .is('owner_user_id', null)
        .order('label');

      let own = [];
      if (currentUserEmail) {
        const { data: ownData } = await sb.from('document_templates')
          .select('template_key, label, filename, file_size, generation_mode, is_active, updated_at, owner_user_id')
          .eq('owner_user_id', currentUserEmail)
          .order('label');
        own = ownData || [];
      }

      const ownByKey = new Map(own.map(t => [t.template_key, t]));
      const merged = (defaults || []).map(def => ownByKey.get(def.template_key) || def);
      // Any own override for a key that doesn't have a system default row
      for (const t of own) {
        if (!merged.some(m => m.template_key === t.template_key)) merged.push(t);
      }

      setTemplates(merged);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleDownload = async (tpl) => {
    try {
      // owner_user_id is nullable — .eq() with a JS null would not
      // match NULL rows in PostgREST, so branch on .is() vs .eq().
      let query = sb.from('document_templates')
        .select('file_b64, filename, mime_type')
        .eq('template_key', tpl.template_key);
      query = tpl.owner_user_id == null
        ? query.is('owner_user_id', null)
        : query.eq('owner_user_id', tpl.owner_user_id);
      const { data } = await query.single();
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
    if (!currentUserEmail) { setMessage('❌ Could not determine your account — please refresh and try again.'); return; }
    activeKey.current = key;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeKey.current || !currentUserEmail) return;
    setUploading(activeKey.current);
    setMessage('');
    try {
      const b64 = await fileToBase64(file);
      const payload = {
        template_key: activeKey.current,
        owner_user_id: currentUserEmail,
        label: TEMPLATE_LABELS[activeKey.current] || activeKey.current,
        file_b64: b64,
        filename: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        generation_mode: 'docx',
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      // upsert() can't target the (template_key, owner_user_id) partial
      // unique index directly — Postgres requires ON CONFLICT to repeat
      // a partial index's WHERE clause, which Supabase-js can't express.
      // Explicit check-then-insert/update instead, scoped to this user's
      // own row only — this is also what makes "Replace" write to your
      // own private row rather than the shared system default.
      const { data: existing } = await sb.from('document_templates')
        .select('id')
        .eq('template_key', activeKey.current)
        .eq('owner_user_id', currentUserEmail)
        .maybeSingle();

      const { error } = existing
        ? await sb.from('document_templates').update(payload).eq('id', existing.id)
        : await sb.from('document_templates').insert(payload);

      if (error) throw error;
      setMessage(`✅ ${file.name} uploaded successfully — this is your own private version, only you will see it`);
      loadTemplates();
    } catch (err) {
      setMessage(`❌ Upload failed: ${err.message}`);
    }
    setUploading(null);
  };

  const handleResetToDefault = async (key) => {
    if (!currentUserEmail) return;
    setResetting(key);
    setMessage('');
    try {
      const { error } = await sb.from('document_templates')
        .delete()
        .eq('template_key', key)
        .eq('owner_user_id', currentUserEmail);
      if (error) throw error;
      setMessage('✅ Reverted to the system default template');
      loadTemplates();
    } catch (err) {
      setMessage(`❌ Reset failed: ${err.message}`);
    }
    setResetting(null);
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading templates...</div>;

  return (
    <div>
      <input ref={fileInputRef} type="file" accept=".docx,.doc,.pdf,.html" style={{ display: 'none' }} onChange={handleFileChange} />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Document Templates</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          These are the DOCX templates used to generate notices, awards and letters. <strong>Replace</strong> uploads your own private version — only your account will use it; other users still see the standard Nora template. <strong>Download</strong> gets a copy of whichever version you're currently using.
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
          const isCustom = !!tpl?.owner_user_id;
          const isUploading = uploading === key;
          const isResetting = resetting === key;
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: tpl ? 'var(--blue-bg)' : 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                {tpl ? '📄' : '⬜'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {tpl?.label || defaultLabel}
                  {isCustom && (
                    <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-bg)', borderRadius: 99, padding: '2px 8px' }}>YOUR VERSION</span>
                  )}
                  {tpl && !isCustom && (
                    <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 8px' }}>SYSTEM DEFAULT</span>
                  )}
                </div>
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
                {isCustom && (
                  <button onClick={() => handleResetToDefault(key)} disabled={isResetting} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', fontWeight: 500 }}>
                    {isResetting ? 'Reverting…' : '↺ Use system default'}
                  </button>
                )}
                <button onClick={() => handleReplaceClick(key)} disabled={isUploading} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>
                  {isUploading ? 'Uploading...' : tpl ? '↑ Replace' : '↑ Upload'}
                </button>
              </div>
            </div>
          );
        })}
        {templates.filter(t => !TEMPLATE_LABELS[t.template_key]).map(tpl => {
          const isCustom = !!tpl.owner_user_id;
          return (
          <div key={tpl.template_key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--blue-bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
              📄
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {tpl.label || tpl.template_key}
                {isCustom && (
                  <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-bg)', borderRadius: 99, padding: '2px 8px' }}>YOUR VERSION</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                {tpl.filename} · {fmtSize(tpl.file_size)} · Updated {fmtDate(tpl.updated_at)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => handleDownload(tpl)} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 500 }}>
                ⬇ Download
              </button>
              {isCustom && (
                <button onClick={() => handleResetToDefault(tpl.template_key)} disabled={resetting === tpl.template_key} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', fontWeight: 500 }}>
                  {resetting === tpl.template_key ? 'Reverting…' : '↺ Use system default'}
                </button>
              )}
              <button onClick={() => handleReplaceClick(tpl.template_key)} disabled={uploading === tpl.template_key} style={{ padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>
                {uploading === tpl.template_key ? 'Uploading...' : '↑ Replace'}
              </button>
            </div>
          </div>
          );
        })}
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
        { key: 'BO_OWNER_S', desc: '"owner" or "owners" (lowercase)' },
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
        { key: 'AO_SERVICE_LINE_1', desc: 'AO service address — line 1' },
        { key: 'AO_SERVICE_LINE_2', desc: 'AO service address — line 2' },
        { key: 'AO_SERVICE_LINE_3', desc: 'AO service address — line 3' },
        { key: 'AO_PARTY', desc: '"Adjoining Owner" or "Adjoining Owners"' },
        { key: 'AO_OWNER_S', desc: '"owner" or "owners" (lowercase)' },
        { key: 'AO_SURVEYOR_NAME', desc: 'AO appointed surveyor name' },
        { key: 'AO_SURVEYOR_FIRM', desc: 'AO appointed surveyor firm' },
      ],
    },
    {
      title: 'Grammatical Variants (Building Owner)',
      items: [
        { key: 'BO_I_WE', desc: '"I" or "We" (auto-selected based on number of BOs)' },
        { key: 'BO_MY_OUR', desc: '"my" or "our" (auto-selected)' },
        { key: 'BO_AM_ARE', desc: '"am" or "are" (auto-selected)' },
      ],
    },
    {
      title: 'Grammatical Variants (Adjoining Owner)',
      items: [
        { key: 'AO_I_WE', desc: '"I" or "We" (auto-selected based on number of AOs)' },
        { key: 'AO_MY_OUR', desc: '"my" or "our" (auto-selected)' },
        { key: 'AO_AM_ARE', desc: '"am" or "are" (auto-selected)' },
      ],
    },
    {
      title: 'Notice & Works',
      items: [
        { key: 'NOTICE_DATE', desc: 'Notice served date (long format, e.g. 1st January 2026)' },
        { key: 'NOTICE_DATE_SHORT', desc: 'Notice served date (short format, e.g. 2026-01-01)' },
        { key: 'NOTICE_SECTION', desc: 'Notice section (e.g. Section 1(5), Section 6(1))' },
        { key: 'NOTICE_SECTION_FULL', desc: 'Full section string including all sections in notice run' },
        { key: 'NOTIFIABLE_WORKS', desc: 'Description of notifiable works' },
      ],
    },
    {
      title: 'Award & Schedules',
      items: [
        { key: 'AWARD_DATE', desc: 'Award date (long format)' },
        { key: 'AWARD_DATE_SHORT', desc: 'Award date (short format)' },
        { key: 'AWARD_TYPE_LABEL', desc: 'e.g. "Agreed Surveyor Award", "Draft Award"' },
        { key: 'SOC_AGREED_DATE', desc: 'Schedule of conditions agreed date' },
        { key: 'ALL_NOTIFIABLE_WORKS', desc: 'All notifiable works from all schedules' },
        { key: 'SECURITY_AMOUNT', desc: 'Section 11 security amount (£)' },
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
      title: 'Mediation Agreement',
      items: [
        { key: 'PARTY_A_NAME_1', desc: 'First named person, Party A' },
        { key: 'PARTY_A_NAME_2', desc: 'Second named person, Party A (if any)' },
        { key: 'PARTY_A_ADDRESS_1', desc: 'Address of first named person, Party A' },
        { key: 'PARTY_A_ADDRESS_2', desc: 'Address of second named person, Party A (if any)' },
        { key: 'PARTY_B_NAME_1', desc: 'First named person, Party B' },
        { key: 'PARTY_B_NAME_2', desc: 'Second named person, Party B (if any)' },
        { key: 'PARTY_B_ADDRESS_1', desc: 'Address of first named person, Party B' },
        { key: 'PARTY_B_ADDRESS_2', desc: 'Address of second named person, Party B (if any)' },
        { key: 'DISPUTE_DESCRIPTION', desc: "Summary of the dispute — from each party's case notes" },
        { key: 'AGREEMENT_DAY', desc: "Day of the agreement date, e.g. '14th'" },
        { key: 'AGREEMENT_MONTH', desc: "Month of the agreement date, e.g. 'August'" },
        { key: 'AGREEMENT_YEAR', desc: "Year of the agreement date, e.g. '2026'" },
        { key: 'PARTY_A_FEE', desc: "Party A's fee for the mediation (numeric)" },
        { key: 'PARTY_B_FEE', desc: "Party B's fee for the mediation (numeric)" },
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

      {/* Fixed 2026-08-20: removed the VAT checkbox added here on
          2026-08-19 — a genuine mistake, correctly pointed out live.
          It created a second, disconnected VAT setting instead of
          using the real one that already existed and already governed
          actual invoices (Settings > Invoice > VAT). Quote generation
          now reads that same, single, real setting instead. */}

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
  // Fixed 2026-09-12, on request: "locked for everyone, but not for
  // me" — testers rolling out now should only see Party Wall;
  // Construction/PM and Dispute stay visible but locked, "coming
  // soon", until the user's own account is what's logged in. Stored
  // directly on the account itself (Supabase user metadata), not a
  // separate table — reading and writing it is a normal auth call.
  const isOwner = currentUser?.email === 'help@sq1consulting.co.uk';
  const [enabledTypes, setEnabledTypes] = useState(
    currentUser?.user_metadata?.enabled_project_types || ['party_wall']
  );
  const [savingTypes, setSavingTypes] = useState(false);

  // Fixed 2026-09-12, on request: "Connect Outlook" existed once,
  // was accidentally deleted in a refactor, and even the deleted
  // version never actually worked end to end — it redirected to
  // Microsoft's login correctly but pointed back to a callback route
  // (/auth/callback) that nothing in this app ever handled, so no
  // token was ever saved through it. Rebuilt properly this time: a
  // real backend endpoint (api/microsoft-oauth-callback.js) does the
  // token exchange server-side and saves it against the actual
  // signed-in user, and this popup-based flow (rather than a
  // full-page redirect) keeps the user on this page throughout.
  const [msStatus, setMsStatus] = useState('Checking…');

  const checkMicrosoftConnection = useCallback(async () => {
    if (!sb || !currentUser) return;
    try {
      const { data } = await sb
        .from('email_accounts')
        .select('access_token, token_expires_at')
        .eq('provider', 'outlook')
        .eq('user_id', currentUser.email || currentUser.id)
        .maybeSingle();
      if (data?.access_token) {
        const expired = data.token_expires_at && new Date(data.token_expires_at) < new Date();
        setMsStatus(expired ? 'Token expired — reconnect' : 'Connected ✓');
      } else {
        setMsStatus('Not connected');
      }
    } catch {
      setMsStatus('Unknown');
    }
  }, [currentUser]);

  useEffect(() => {
    checkMicrosoftConnection();
  }, [checkMicrosoftConnection]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.type !== 'ms-oauth-result') return;
      checkMicrosoftConnection();
      if (!event.data.success) {
        alert(`Could not connect Outlook: ${event.data.message || 'unknown error'}`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [checkMicrosoftConnection]);

  const connectMicrosoft = () => {
    const clientId = import.meta.env.VITE_MS_CLIENT_ID || '';
    if (!clientId) {
      alert('Microsoft client ID not configured. Contact your administrator.');
      return;
    }
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/microsoft-oauth-callback`);
    const scope = encodeURIComponent('https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access');
    const state = encodeURIComponent(currentUser?.email || currentUser?.id || '');
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
    window.open(authUrl, 'ms-oauth', 'width=520,height=680');
  };

  const toggleType = async (value) => {
    if (!isOwner) return; // locked for everyone else — checkbox itself is disabled too, this is a second guard
    const next = enabledTypes.includes(value)
      ? enabledTypes.filter(t => t !== value)
      : [...enabledTypes, value];
    setEnabledTypes(next);
    setSavingTypes(true);
    try {
      await sb.auth.updateUser({ data: { enabled_project_types: next } });
    } catch (err) {
      console.warn('[AccountTab] saving enabled_project_types failed:', err.message);
    } finally {
      setSavingTypes(false);
    }
  };

  const SERVICE_OPTIONS = [
    { value: 'party_wall', label: 'Party wall', desc: 'Notices, awards, schedules of condition' },
    { value: 'construction', label: 'Construction / PM', desc: 'Projects, programme, financials' },
    { value: 'dispute', label: 'Dispute resolution', desc: 'Standalone mediation, not tied to a project' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Logged in as</div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>{currentUser?.email}</div>
      </div>

      <div style={{ padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: msStatus.includes('Connected') ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Microsoft Outlook</div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>{msStatus}</div>
            </div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={connectMicrosoft} style={{ cursor: 'pointer', borderRadius: 99 }}>
            {msStatus.includes('Connected') ? 'Reconnect' : 'Connect Outlook'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6 }}>
          Connect your Outlook account to send and receive emails directly within Nora.
        </div>
      </div>

      <div style={{ padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Which services do you need?</div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 12 }}>
          {isOwner ? 'This decides what shows up in "New project".' : 'Construction / PM and Dispute resolution are coming soon.'}
        </div>
        {SERVICE_OPTIONS.map(opt => {
          const checked = enabledTypes.includes(opt.value);
          const locked = !isOwner;
          return (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, marginBottom: 8,
              border: `1px solid ${locked ? 'var(--border)' : checked ? 'var(--blue)' : 'var(--border)'}`,
              background: locked ? 'transparent' : checked ? 'var(--blue-bg)' : 'transparent',
              borderRadius: 10, opacity: locked && opt.value !== 'party_wall' ? 0.55 : 1,
              cursor: locked ? 'default' : 'pointer',
            }}>
              <input
                type="checkbox"
                checked={checked}
                disabled={locked || savingTypes}
                onChange={() => toggleType(opt.value)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                  {locked && opt.value !== 'party_wall' ? 'Coming soon' : opt.desc}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <button onClick={async () => {
          if (sb) {
            // Fixed 2026-09-17, real, confirmed multi-user gap on
            // shared devices: neither the local email cache
            // (IndexedDB) nor this device's push subscription were
            // torn down on logout — the cache only ever got cleared
            // reactively, once a *different* user's session mounted
            // and detected the change, leaving a window where a
            // freshly-logged-out device could still show the
            // previous person's cached inbox contents, or still
            // receive a push notification meant for them, right up
            // until someone else actually logged in. Both explicitly
            // torn down here instead, before sign-out even completes.
            await clearEmailCache().catch(() => {});
            clearReconciledCacheMarker();
            await unregisterPushNotifications().catch(() => {});
            await sb.auth.signOut();
            window.location.reload();
          }
        }}
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

      <UserBrainV2Section />
    </div>
  );
}

// Fixed 2026-09-17, on direct instruction, correcting my own earlier
// reasoning here: fields start genuinely pre-populated for a new
// user, not blank — "it means the user has a brain to start with,
// and then they can modify it." voice_content and banned_phrases are
// pre-filled with the platform's own actual default text (pulled
// directly from ai_instruction_sets, name='default_voice_profile_v2'
// — not written fresh here), sign_off with "Kind regards," matching
// what that same default text already assumes. identity_content and
// fee_structure_content stay blank — a name, a company, a price list
// have no sensible generic version the way a writing style does.
const SOC_GOLD_STANDARD_DEFAULT = `EXAMPLES — SQUARE ONE SCHEDULE OF CONDITION STANDARD

FACTUAL FIDELITY EXAMPLES — apply these rules in every observation

──────────────────────────────────────────────────────
EXAMPLE A — Directional measurement preservation

Raw dictation:
"from the utility room wall running towards the rear approximately 1.8m has been larder units"

Correct output:
"Larder units extend approximately 1.8m from the utility room wall towards the rear elevation."
action: "Record only"

Incorrect (do not produce):
"Larder units are approximately 1.8m high." — WRONG: axis changed from horizontal distance to vertical height.
"Larder units of approximately 1.8m in height." — WRONG: same error.
"Larder units are installed against the party wall, extending approximately 1.8m from the utility room wall towards the rear elevation." — WRONG if the party wall relationship was not stated in the dictation: adds an inferred positional relationship.

──────────────────────────────────────────────────────
EXAMPLE B — Preserving awkward dictated wording rather than adding formal precision

Raw dictation:
"there's a crack above the door maybe 200 mil going up, it kind of goes up and maybe a bit to the side"

Correct output:
"A crack was noted above the door, extending approximately 200mm upward and then slightly to one side."
action: "Record pre-existing defect"

Incorrect (do not produce):
"A vertical hairline crack extends approximately 200mm from the door architrave, consistent with shrinkage movement." — WRONG: width invented ("hairline"), element invented ("architrave"), cause invented ("shrinkage"), and the diagonal component was dropped entirely.

──────────────────────────────────────────────────────
EXAMPLE C — Refusing to infer or classify where dictation is unclear

Raw dictation:
"the flank wall brickwork, can't really see it properly, something going on at the bottom"

Correct output:
"The brickwork to the flank wall was not clearly visible. [UNCLEAR: an unidentified condition was dictated at low level — please confirm]"
action: "Record only"

Incorrect (do not produce):
"Perished pointing was noted to the lower courses of the flank wall brickwork with evidence of moisture ingress." — WRONG: defect type, material condition, moisture and extent were invented.
"Some deterioration was noted at low level." — WRONG: deterioration is an unsupported defect classification.

──────────────────────────────────────────────────────
=====================================================

PREFERRED TERMINOLOGY — always use these terms where applicable:

- "Plaster and emulsion finish" — standard phrasing for painted plaster (walls/ceilings). NOT "plaster paint finish" or generic "paint finish".
- "Segmental brick arch" — a curved brick arch spanning an opening, bricks laid on edge following the curve, as opposed to a flat/horizontal lintel.
- "Perished pointing" — for loose, crumbling, or missing mortar pointing. NOT "loose and friable mortar" or "missing pointing".
- "Perished brickwork" / "localised perished brickwork" — for deteriorated, crumbling, or flaking brick faces. NOT "spalling" or "localised spalling".
- "Stepped crack" — a crack that follows the mortar joints in a zig-zag pattern rather than running straight through brick or render.
- "Slight inward lean" / "slight outward lean" — for masonry (parapets, walls, piers) showing a lean out of true.
- "Render appeared blown at [location]" — for render that has detached/hollowed from the substrate.
- "Not visible from ground level" — standard limitation phrase when an element could not be inspected due to height/access.
- "Detailed inspection limited by vantage point" — standard limitation phrase for hard-to-reach elements (chimneys, high-level roofwork) that were visible but not closely inspectable.
- "Inspection was partially restricted by stored contents" — for cupboards/storage areas where full inspection was not possible.
- Do NOT use "heavily weathered and over-rendered" or similar vague weathering descriptions — be specific (perished, blown, spalled-equivalent perished brickwork, etc.) rather than generic.

---

EXAMPLE 1 — Painted plaster wall, no defects

Raw: "party wall plaster finish painted no visible defects"
Required row:
"The party wall has a painted plaster finish. No visible defects were noted at the time of inspection."

---

EXAMPLE 2 — Wallpaper-lined party wall, no defects

Raw: "party wall wallpaper lined finish no defects"
Required row:
"The party wall has a wallpaper-lined finish. No visible defects were noted at the time of inspection."

---

EXAMPLE 3 — Plasterboard ceiling with skim, no defects

Raw: "ceiling plasterboard skim no visible defects"
Required row:
"The ceiling is formed in plasterboard with a plaster skim finish. No visible defects were noted at the time of inspection."

---

EXAMPLE 4 — Perished brickwork and mortar pointing

Raw: "brickwork on the flank wall looks perished, pointing eroded in places, especially lower section"
Required row:
"Localised sections of perished brickwork and eroded mortar pointing were noted to the lower section of the flank wall."

---

EXAMPLE 5 — Pebble-dash render with cracking

Raw: "pebble dash finish to the upper section, few hairline cracks running vertically, render looks a bit perished in places"
Required row:
"The upper section of the elevation has a pebble-dash render finish. Localised sections of perished render and isolated vertical hairline cracks were noted."

---

EXAMPLE 6 — Complex crack route

Raw: "crack starts at the bottom left corner of the window, goes diagonally down, then turns vertical when it gets to the brick course below, runs about 300mm total before it stops"
Required row:
"A crack was noted originating from the lower left-hand corner of the window opening and extending diagonally downwards before changing direction and continuing vertically within the brickwork below. The crack extended approximately 300mm in total before terminating."

---

EXAMPLE 7 — Window test, satisfactory

Raw: "UPVC window tested opens and closes no sticking no jamming"
Required row:
"The UPVC window was tested and operated satisfactorily without sticking, binding or jamming."

---

EXAMPLE 8 — Window test, partial binding

Raw: "window opens but sticks on the frame, can't open it fully past the frame"
Required row:
"The opening leaf was tested and opened partially but bound against the frame, preventing it from opening fully."

---

EXAMPLE 9 — Party wall concealed behind fitted wardrobes

Raw: "party wall is behind floor to ceiling wardrobes, can't see it, accessible in the corner, no defects in the corner section"
Required row:
"The party wall is substantially concealed behind fitted floor-to-ceiling wardrobes. A limited section remained visible within the corner and was inspected, with no visible defects noted to the accessible area at the time of inspection."

---

EXAMPLE 10 — Historic water staining, dry at inspection, remote from works

Raw: "some staining on the ceiling looks like old water ingress, dry now, remote from the works"
Required row:
"Localised staining, appearing historic in nature, was noted to the ceiling finish. The affected area appeared dry at the time of inspection. Although remote from the proposed notifiable works, this was recorded for scheduling purposes only."

---

EXAMPLE 11 — Skirting open joint with route

Raw: "open joint along top of skirting where it meets the party wall, runs from the door frame to the rear elevation wall"
Required row:
"An open joint was noted along the junction between the upper edge of the timber skirting and the party wall, extending from the door frame to the rear elevation wall."

---

EXAMPLE 12 — Bathroom grout and silicone

Raw: "grout around the bath looks perished, silicone at the base of the bath has an open joint along its full length"
Required row:
"Localised sections of perished grout were noted around the bath surround. An open joint was noted in the silicone seal at the base of the bath, extending along its full length."

---

EXAMPLE 13 — Photograph-only area

Raw: "loft room is remote from the works, just photographed it, didn't do a full schedule"
Required row:
"The loft room is remote from the proposed notifiable works and was documented photographically only."

---

EXAMPLE 14 — Explicit correction, crack classification not stated

Raw: "crack runs from the left-hand corner, sorry, I mean the right-hand corner, diagonally up about 400mm"
Required row:
"A crack was noted at the right-hand corner, extending diagonally upwards for approximately 400mm."

Note: "hairline" not used — not stated in dictation and no measurement supports classification.

---

EXAMPLE 15 — Implicit rear outrigger correction

Raw: "starting in the rear extension, rear outrigger, no visible defects noted along the party wall"
Resolved section: Ground Floor Rear Outrigger. "Rear extension" was a false start — discarded.
Required row:
"The party wall within the ground-floor rear outrigger was inspected. No visible defects were noted at the time of inspection."

---

EXAMPLE 16 — Complex bifurcating crack with branching

Raw: "top right corner of the Velux window, crack goes up about 250mm then splits, one branch goes horizontal to the dormer cheek, another traces into the reveal along the head and down the right-hand side to the frame"
Required row:
"At the top right-hand corner of the Velux window, a hairline crack extends approximately 250mm upward toward the ridge before bifurcating. One branch extends horizontally toward the dormer cheek, continuing to the junction with the pitched roof slope. A second branch traces into the Velux reveal, running along the junction of the head and right-hand side reveal and terminating at the frame abutment."
Action: Record pre-existing defect. To be monitored during and following notifiable works.

---

EXAMPLE 17 — Multiple crack runs on chimney breast, numbered sequence

Raw: "chimney breast cracks — vertical diagonal from top left down toward mirror, vertical right of mirror going up branching toward front, two horizontals from behind mirror toward wardrobe with vertical branch down, horizontal left of mirror branching up and down"
Required row:
"A complex pattern of cracking is recorded to the face of the chimney breast: (i) a vertical and diagonal crack extending from the top left-hand corner downward toward the mirror fitting; (ii) a vertical crack to the right of the mirror, extending upward and branching toward the front elevation; (iii) two horizontal cracks extending from behind the mirror toward the fitted wardrobe, with a vertical branch extending downward; and (iv) a further horizontal crack to the left of the mirror, with branches extending both upward and downward."
Action: Record pre-existing defect. Extent photographically recorded.

---

EXAMPLE 18 — Party wall concealed behind wardrobes, chimney breast obscured

Raw: "party wall behind full height fitted wardrobes, chimney breast behind them too, base of chimney breast behind a chest of drawers, no access"
Required row:
"The party wall within this room is fully concealed behind full-height fitted wardrobes. The central chimney breast appears to have been partially concealed, with its base obscured by a chest of drawers. No direct inspection of the party wall face was possible in these areas."
Action: Record only. Access restricted.

---

EXAMPLE 19 — Crack in proximity to works, monitor action

Raw: "vertical crack in plaster about a metre from the party wall, full height floor to ceiling, looks like shrinkage not structural but near the works"
Required row:
"A vertical crack is present in the plaster finish approximately 1.0m from the party wall, extending full height from floor level to ceiling. The crack is consistent with shrinkage or restraint cracking and does not appear to be of structural significance. It is, however, in proximity to the proposed notifiable works and should be monitored."
Action: Record pre-existing defect. Monitor during and following works.

---

EXAMPLE 20 — Historic ceiling staining, dry at inspection

Raw: "ceiling staining looks historic, dry when I inspected, not ongoing"
Required row:
"Localised staining, appearing historic in nature, was noted to the ceiling finish. The affected area appeared dry at the time of inspection. No visible evidence of ongoing water ingress was noted at the time of inspection."
Action: Record pre-existing defect.

---

EXAMPLE 21 — ACTION COLUMN RULES (mandatory)

"Record only" — conditions with no defect; elements remote from works; general finishes in good condition.
"Record pre-existing defect" — any crack, open joint, staining, deterioration, or operational issue.
"Record pre-existing defect. Monitor during works." — defects in proximity to the proposed notifiable works.
"Record pre-existing defect. Nature and extent to be re-assessed post-works." — defects where post-works comparison is needed.
"Record — not tested" — elements that could not be tested (locked, fixed, inaccessible).
"Further investigation required" — items requiring specialist input before works commence.
NEVER use "Record only" for a defect.

---

COMPLETE REFERENCE DOCUMENT — SQUARE ONE SCHEDULE OF CONDITIONS GOLD STANDARD
This is a complete Schedule of Conditions prepared by Square One Consulting. This represents the required standard of writing, structure, terminology, action column differentiation, crack description, and professional presentation. Study it in full before drafting any output.

PROPERTY: 61 Cissbury Ring South, London N12 7BG (Adjoining Owner: Andrew David Rose & Nicole Louise Rose)
WORKS AT: 59 Cissbury Ring South, London N12 7BG (Building Owner: Somani Portfolio Ltd)
DATE OF INSPECTION: Tuesday 22nd April 2026
PROPOSED WORKS: Loft conversion; construction of a new single-storey rear extension with new foundations within 3 metres of the Adjoining Owners' property; removal of chimney breasts; cutting into the flank wall for the purpose of installing a weathering detail.

SECTION: Front Elevation
FE-01 | The subject property forms part of a semi-detached pair, linked to the Building Owner's property at No. 59. The party wall is slightly raised above the Building Owner's roof level, with lead flashing tucked down the abutment and lapped beneath the Building Owner's roof covering. The arrangement appeared weathertight at the time of inspection. | Record only
FE-02 | The external facing brickwork is in generally good condition throughout the front elevation. No significant structural defects or widespread deterioration were observed. | Record only
FE-03 | To the front bay window, spanning ground to first floor level, a discrete area of missing pointing is present in a vertical alignment, centrally positioned within the bay. The void is approximately equivalent in extent to one full brick in size. No associated cracking or displacement of surrounding masonry is evident. | Record pre-existing defect. Monitor during works.
FE-04 | The roof covering appears in good condition and is assessed to be relatively recently renewed, exhibiting only minor and isolated areas of moss growth. No lifting, slippage or displacement of roof tiles is noted. | Record only
FE-05 | A shared central chimney stack is present at the ridge. The lead flashing to the Building Owner's side of the stack appears in good condition, with no visible lifting, displacement or deterioration at the time of inspection. | Record only

SECTION: Loft Space
LS-01 | The dormer cheek is constructed of plasterboard fixed to a timber frame. The structural member at ridge level is formed in timber; no steel beam is present at this location. | Record only
LS-02 | At the junction between the bulkhead and the dormer cheek, a vertical hairline crack is present, extending approximately 1.0-1.1 metres downward from the corner. The crack is consistent with differential movement at the interface of two separate elements. | Record pre-existing defect
LS-03 | At the underside of the timber member supporting the central light fitting, where it meets the dormer cheek on the Building Owner's side, a slight open joint is visible along the line of abutment. | Record pre-existing defect
LS-04 | To the front elevation side of the ridge, at its junction with the roof slope, a faint hairline crack extends downward along the face of the dormer cheek for a distance of approximately 1.5 metres, dissipating toward the eaves level. | Record pre-existing defect
LS-05 | At the top right-hand corner of the Velux window (the corner in closest proximity to the Building Owner's side), a vertical hairline crack extends approximately 250mm upward toward the ridge. The crack then bifurcates, with a horizontal branch extending toward the dormer cheek and continuing to the junction with the pitched roof slope. The crack is traced internally into the Velux reveal, running along the junction of the head and right-hand side reveal, terminating at the frame abutment. Refer to photographs. | Record pre-existing defect. To be monitored during and following notifiable works.
LS-06 | To the rear dormer, which comprises a central sliding door flanked by fixed glazed panes, intermittent vertical cracking is noted at the junction between the fixed pane closest to the Building Owner's side and the dormer cheek. Additional cracking is present along the head of the glazing where it meets the ceiling, extending continuously across the sliding door and adjacent fixed glazing. | Record pre-existing defect
LS-07 | At the base of the fixed glazed pane closest to the Building Owner's side, at its junction with the sliding door frame, a pronounced crack and open joint is present. This crack tapers from a notably wider opening at low level to a hairline at mid-height, becoming intermittent as it continues toward the head of the frame. | Record pre-existing defect. Nature and extent to be re-assessed post-works.
LS-08 | Within the front eaves void, the line of the party wall is not visible owing to the presence of boarding and plasterboard lining. No defects are noted to the visible elements within this void and the general condition appears satisfactory. | Record only. Inaccessible area noted.
LS-09 | Ceiling finishes throughout the loft space are generally in good condition. No defects are noted, with the exception of those associated with the Velux window and front roof slope junction as described at LS-04 and LS-05 above. | Record only
LS-10 | At the top right-hand corner of the loft door architrave, a hairline crack extends vertically to the underside of the dormer bulkhead. This defect is considered remote from the notifiable works and is recorded photographically. | Record only — remote from notifiable works

SECTION: First Floor — Front Bedroom
FF-01 | The party wall within the front bedroom is fully concealed behind full-height fitted wardrobes with a lined backing to both faces. The central chimney breast appears to have been partially concealed, with its base obscured by a chest of drawers. No direct inspection of the party wall face was possible in these areas. | Record only. Access restricted.
FF-02 | At the junction between the fitted wardrobes and the presumed chimney breast recess, symmetrical vertical hairline open joints are present on both sides, extending from cornice level down to the underside of the first shelf. The symmetrical nature of this cracking is consistent with differential movement between the chimney breast and flanking elements. | Record pre-existing defect
FF-03 | To the exposed sections of the chimney breast, widespread faint and intermittent hairline cracking is present throughout. At ceiling level, a continuous open joint and associated crack runs along the full width of the abutment between the chimney breast face and ceiling soffit, extending the full width between the wardrobes. | Record pre-existing defect
FF-04 | The cracking described at FF-03 continues onto the face of the left-hand fitted wardrobe, extending across toward the front elevation and wrapping around the corner of the unit. | Record pre-existing defect
FF-05 | To the right-hand side of the chimney breast, a similar pattern of cracking is present along the ceiling junction, extending across the ceiling plane toward the wall abutting the rear bedroom. A vertical open joint is noted at the junction of the fitted wardrobe and the flanking wall. | Record pre-existing defect
FF-06 | To the wall abutting the rear bedroom, a complex crack pattern is recorded: a horizontal hairline crack approximately 350mm in length at mid-height; branching upward to ceiling level; and continuing downward to socket level, with further multiple hairline branches radiating from the socket position. A diagonal crack extends from the vertical crack at approximately 1.0m above finished floor level, tracking toward a picture location on the adjacent wall. | Record pre-existing defect. Pattern to be photographically monitored.
FF-07 | Additional cracking is present around the picture location and radiator, including cracks which extend behind the fittings and re-emerge, forming an arching crack pattern which tracks toward the door opening. The full extent of cracking in these areas is partially obscured by furnishings. | Record pre-existing defect. Refer to photographs.
FF-08 | To the MDF face above the doors of the left-hand fitted wardrobe unit, open joints are present at panel junctions. A crack is noted at the top left-hand corner and along the ceiling junction extending approximately 350mm. | Record pre-existing defect
FF-09 | The front bay window comprises six sections. Open joints are present at the base of each frame where they meet the window cill. The section of the bay window in closest proximity to the Building Owner's property exhibits an open joint extending approximately 80-90mm up the side of the frame. | Record pre-existing defect
FF-10 | At the internal junction of the bay window reveal and the party wall, intermittent vertical hairline cracking is present. | Record pre-existing defect
FF-11 | The window casement closest to the Building Owner's side was secured in the locked position at the time of inspection and was not tested for operation. | Record — not tested
FF-12 | Minor cracking is noted at the window sill (bottom left corner) and above the door opening. These defects are considered remote from the notifiable works and are recorded photographically only. | Record only — remote from notifiable works

SECTION: First Floor — Rear Bedroom
FR-01 | The chimney breast within the rear bedroom is concealed behind wall finishes. A full-height fitted wardrobe is positioned to the right of the chimney breast and floating shelves with a desk are located to the left. | Record only. Chimney breast concealed — direct inspection not possible.
FR-02 | Above the uppermost shelf on the party wall, a diagonal hairline crack extends upward toward the ceiling. The crack is consistent with restraint and differential movement at the interface of the party wall and ceiling plane. | Record pre-existing defect
FR-03 | A complex pattern of cracking is recorded to the face of the chimney breast: (i) a vertical and diagonal crack extending from the top left-hand corner downward toward a mirror fitting; (ii) a vertical crack to the right of the mirror, extending upward and branching toward the front elevation; (iii) two horizontal cracks extending from behind the mirror toward the fitted wardrobe, with a vertical branch extending downward; and (iv) a further horizontal crack to the left of the mirror, with branches extending both upward and downward. The cracking pattern is consistent with long-term thermal movement and differential settlement at the chimney breast. | Record pre-existing defect. Extent photographically recorded.
FR-04 | At skirting level, along the base of the chimney breast, a horizontal open joint extends approximately 400mm. This is consistent with movement between the chimney breast and the adjacent floor finish. | Record pre-existing defect
FR-05 | To the wall abutting the front bedroom, a diagonal crack originating approximately 1.0m from the party wall extends downward for approximately 900mm. This crack continues onto the ceiling plane in a quadrant configuration. A secondary crack branches downward toward the adjacent shelving unit. | Record pre-existing defect
FR-06 | Above the desk, a horizontal crack extends outward from the party wall and branches upward at the far end of the desk. The crack is consistent with restraint cracking at the wall/ceiling junction in proximity to the party wall. | Record pre-existing defect
FR-07 | To the rear bedroom window: an open joint is present at the base of the frame where it meets the wall, extending onto the adjacent wall surface with associated branching. A diagonal crack is noted at the top left-hand corner, extending toward the ceiling. The MDF window sill exhibits an open joint along its wall abutment, the right-hand end being more pronounced. | Record pre-existing defect
FR-08 | To the ceiling: staining is visible, indicative of historic water ingress. The affected area was dry at the time of inspection. A zigzag crack extends from the rear wall toward the centre of the ceiling with branching. Two vertical cracks are present above the window opening. A further crack is noted at the top right-hand corner, continuing onto the ceiling plane. A quadrant-shaped crack extends across the ceiling. Refer to photographs for full extent. | Record pre-existing defect. Source of historic water ingress to be investigated if reactivated during works.

SECTION: Ground Floor — Rear Extension
GR-01 | Full-width sliding doors to the rear elevation open and close without impediment. The locking mechanism operates correctly. No visible defects are noted to the glazing, frames or threshold. | Record only
GR-02 | A gap and open joint is present between the floor tiling and the base of the sliding door frame along the full width of the threshold. | Record pre-existing defect
GR-03 | The property has been extended to the rear. Structural beams are present but concealed within the wall and ceiling construction. Technical confirmation is required as to whether sequential excavation and underpinning is necessary in connection with the proposed foundation works; failing this, written confirmation from a suitably qualified Structural Engineer should be provided to the Two Surveyors prior to commencement of notifiable works. | Further investigation required — see Discussion Items
GR-04 | At the junction of the flank wall and the rear elevation, above the sliding door head, a vertical open joint extends onto the ceiling soffit and continues along the flank wall for approximately 1.5 metres. This defect is in proximity to the proposed notifiable works. | Record pre-existing defect. To be monitored throughout the works.
GR-05 | No defects are noted to skirting junctions throughout the extension. The decorative finishes are in generally good condition throughout. | Record only
GR-06 | The wood-effect tiled floor finish is in good condition throughout the area in proximity to the notifiable works. At the far end of the room, remote from the notifiable works, localised lifting of tiles and loss of grout is noted. This is recorded photographically. | Record only — remote defect noted photographically

SECTION: Ground Floor — Front Room
GF-01 | The floor tiles throughout the front reception room are in good condition. No cracking, lifting or other defects are noted. | Record only
GF-02 | The chimney breast within the front room is boarded over. No defects are noted to the visible surface of the party wall or the boarded chimney breast face. | Record only. Chimney breast concealed.
GF-03 | A vertical crack is present in the plaster finish approximately 1.0m from the party wall, extending full height from floor level to ceiling. The crack is consistent with shrinkage or restraint cracking and does not appear to be of structural significance. It is, however, in proximity to the proposed notifiable works and should be monitored. | Record pre-existing defect. Monitor during and following works.

SECTION: External Rear
ER-01 | The rear extension is externally clad in tongue and groove timber boarding. The cladding is in good condition throughout. No defects, deterioration or displacement are noted. | Record only
ER-02 | The patio at ground level comprises large-format paving slabs laid to a fall toward a linear drainage channel. The slabs and drainage channel are in generally good condition. | Record only
ER-03 | At the corner nearest to the sliding doors and flank wall junction, a cracked paving slab is present and an open joint is noted between adjacent slabs. Slight movement of the slabs is detectable at this location. | Record pre-existing defect
ER-04 | To the rendered face below the patio step, horizontal cracking is present, extending in the direction of the boundary. Localised loss of render has occurred at points along this run, revealing the underlying brickwork substrate. On inspection, the cracking appears confined to the render layer and does not appear to extend into the structural masonry. | Record pre-existing defect. Render layer only — monitor during works.
ER-05 | No defects are noted to the timber boundary fencing or associated cladding. | Record only

END OF COMPLETE REFERENCE DOCUMENT`;

const V2_DEFAULTS = {
  identity_content: '',
  voice_content: `Write as an experienced professional speaking naturally to another professional. The writing should feel: conversational, friendly, warm, approachable, confident, measured, practical, commercially sensible. The recipient should feel they are communicating with a real person, not reading a carefully constructed corporate letter. Professional does not mean formal — avoid sounding like a solicitor, corporate adviser or AI assistant unless expressly asked for that style. The finished correspondence should feel as though the writer considered the issue carefully and then explained it naturally in their own words.

Prefer natural conversational wording over stock phrases — "I think...", "In my view...", "I'd suggest...", "That said...", "Just let me know..." — as examples of tone, not fixed templates.

Use UK English. Do not use long dashes or em dashes.`,
  sign_off: 'Kind regards,',
  fee_structure_content: '',
  banned_phrases: `duly, accordingly (unless genuinely necessary), for the avoidance of doubt, notwithstanding the foregoing, in this regard, at this juncture, please be advised, I trust this clarifies, I would be grateful if, kindly confirm, pursuant to, I write further to, we refer to, I look forward to hearing from you, please do not hesitate to contact me, I hope this finds you well, I trust this meets your requirements.`,
  soc_gold_standard: SOC_GOLD_STANDARD_DEFAULT,
};

function UserBrainV2Section() {
  const [fields, setFields] = React.useState(null);
  const [userId, setUserId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef(null);

  React.useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user?.id) { setError('Could not determine your account.'); return; }
      setUserId(user.id);
      const { data } = await sb.from('user_brain_v2').select('*').eq('user_id', user.id).maybeSingle();
      setFields(data ? {
        identity_content: data.identity_content ?? V2_DEFAULTS.identity_content,
        voice_content: data.voice_content ?? V2_DEFAULTS.voice_content,
        sign_off: data.sign_off ?? V2_DEFAULTS.sign_off,
        fee_structure_content: data.fee_structure_content ?? V2_DEFAULTS.fee_structure_content,
        banned_phrases: data.banned_phrases ?? V2_DEFAULTS.banned_phrases,
        soc_gold_standard: data.soc_gold_standard ?? V2_DEFAULTS.soc_gold_standard,
      } : { ...V2_DEFAULTS });
    })();
  }, []);

  const save = async () => {
    if (!userId || !fields) return;
    setSaving(true);
    setError('');
    const payload = { user_id: userId, ...fields, updated_at: new Date().toISOString() };
    const { error: err } = await sb.from('user_brain_v2').upsert(payload, { onConflict: 'user_id' });
    setSaving(false);
    if (err) setError(err.message || 'Could not save.');
    else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  // Fixed 2026-09-17, on request: lets a user upload a real Schedule
  // of Condition document, which gets read and dropped straight into
  // this same field — same destination as pasting text in by hand.
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the selected file'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/extract-document-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_base64: base64, filename: file.name }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not read this file.');
      setFields(prev => ({ ...prev, soc_gold_standard: data.text }));
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const field = (key, label, desc, rows = 4) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{label}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{desc}</div>}
      <textarea
        value={fields[key]}
        onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
        rows={rows}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13,
          borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
        }}
      />
    </div>
  );

  return (
    <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Your Nora brain</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
        How Nora drafts and speaks on your behalf, specifically. Writing voice, sign-off and banned phrases start pre-filled with sensible defaults — edit them however you like. Identity and fee structure are entirely yours to fill in.
      </div>

      {!fields ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{error || 'Loading…'}</div>
      ) : (
        <>
          {field('identity_content', 'Identity', 'Who you are and how Nora should refer to you and your practice.', 3)}
          {field('voice_content', 'Writing voice', 'How Nora should sound — tone, formality, sentence style.', 6)}
          {field('sign_off', 'Sign-off', 'What every drafted email ends with, before your saved signature.', 1)}
          {field('fee_structure_content', 'Fee structure', 'Your own pricing — notices, consent, dissent options, whatever structure you quote.', 8)}
          {field('banned_phrases', 'Banned phrases', 'Words or stock phrases Nora should never use in your drafts.', 4)}

          <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Schedule of Condition — gold standard</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
              What every SOC observation gets checked against before you see it. Starts as a copy of Nora's own working standard — paste in your own terminology and examples, or upload a real Schedule of Condition and Nora will read the text straight in.
            </div>
            <div style={{ marginBottom: 8 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 500,
                  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
                  cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1,
                }}
              >
                {uploading ? 'Reading file…' : '📄 Upload a Schedule of Condition'}
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
            </div>
            <textarea
              value={fields.soc_gold_standard}
              onChange={e => setFields(prev => ({ ...prev, soc_gold_standard: e.target.value }))}
              rows={10}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13,
                borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
            {error && <div style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{error}</div>}
            {saved && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Saved</div>}
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'var(--accent, #2563eb)', color: '#fff', border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
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
      {activeTab === 'Integrations' && <IntegrationsSettings />}
      {activeTab === 'Account' && <AccountTab />}
      {activeTab === 'AI' && <AITab />}
      {activeTab === 'Nora' && <NoraTab />}
    </div>
  );
}
