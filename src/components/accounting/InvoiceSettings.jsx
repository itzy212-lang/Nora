import React, { useState, useEffect } from 'react';
import sb from '../../supabaseClient';
import { useApp } from '../../state/appStore';

const STORAGE_KEY = 'ely_invoice_settings';

function normaliseInvoiceSettings(raw = {}) {
  const lastFromLast = Number(raw.last_invoice_number);
  const lastFromNext = Number(raw.next_invoice_number) - 1;

  return {
    last_invoice_number: Number.isFinite(lastFromLast)
      ? lastFromLast
      : Number.isFinite(lastFromNext)
        ? lastFromNext
        : 1600,
    bank_name: raw.bank_name || '',
    sort_code: raw.sort_code || '',
    account_number: raw.account_number || '',
    account_name: raw.account_name || '',
    vat_registered: !!raw.vat_registered,
    vat_number: raw.vat_number || '',
    vat_rate: Number(raw.vat_rate || 0),
    payment_terms: Number(raw.payment_terms || 0),
    invoice_notes: raw.invoice_notes || 'Thank you for your business.',
  };
}

export default function InvoiceSettings() {
  const { state } = useApp();
  const { currentUser } = state;

  const [settings, setSettings] = useState(normaliseInvoiceSettings());
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadSettings(); }, [currentUser]);

  const loadSettings = async () => {
    let loaded = null;

    try {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) loaded = JSON.parse(local);
    } catch {}

    if (sb && currentUser?.id) {
      try {
        const { data } = await sb
          .from('ely_data')
          .select('data')
          .eq('user_id', currentUser.id)
          .eq('data_type', 'invoice_settings')
          .single();

        if (data?.data) loaded = { ...(loaded || {}), ...data.data };
      } catch {}
    }

    setSettings(normaliseInvoiceSettings(loaded || {}));
    setLoading(false);
  };

  const saveSettings = async () => {
    const clean = normaliseInvoiceSettings(settings);
    const payload = {
      ...clean,
      next_invoice_number: Number(clean.last_invoice_number || 0) + 1,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    if (sb && currentUser?.id) {
      try {
        await sb.from('ely_data').upsert({
          user_id: currentUser.id,
          data_type: 'invoice_settings',
          data: payload,
        }, { onConflict: 'user_id,data_type' });
      } catch {}
    }

    setSettings(clean);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const setField = (key, val) => setSettings(s => ({ ...s, [key]: val }));

  if (loading) return <p style={{ color: 'var(--text3)', padding: 16 }}>Loading...</p>;

  const lastNumber = Number(settings.last_invoice_number || 0);
  const nextNumber = lastNumber + 1;

  return (
    <div style={s.container}>
      <div style={s.sectionTitle}>Invoice Settings</div>

      <div style={s.group}>
        <div style={s.groupTitle}>Invoice Numbering</div>

        <div style={{
          padding: '10px 12px',
          borderRadius: 10,
          background: 'var(--blue-bg)',
          border: '1px solid var(--blue)',
          color: 'var(--blue)',
          fontSize: 12.5,
          lineHeight: 1.5,
          marginBottom: 2,
        }}>
          Set the <strong>last invoice number issued</strong>. Ely will create the next invoice as that number plus one.
          For example, set this to <strong>1600</strong> and the next invoice will be <strong>1601</strong>.
        </div>

        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Last Invoice Number</label>
            <input
              style={s.input}
              type="number"
              value={settings.last_invoice_number}
              onChange={e => setField('last_invoice_number', parseInt(e.target.value || '0', 10))}
            />
            <span style={s.hint}>Change this if you delete or void the latest draft invoice and need to reset the sequence.</span>
          </div>

          <div style={s.field}>
            <label style={s.label}>Next Invoice Number</label>
            <input
              style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text3)' }}
              value={nextNumber}
              disabled
            />
            <span style={s.hint}>Read-only. This is calculated from Last Invoice Number + 1.</span>
          </div>
        </div>
      </div>

      <div style={s.group}>
        <div style={s.groupTitle}>Bank Details</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
          These appear on every invoice footer automatically
        </div>

        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Account Name</label>
            <input
              style={s.input}
              value={settings.account_name}
              placeholder="e.g. Itzik Ltd"
              onChange={e => setField('account_name', e.target.value)}
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Bank Name</label>
            <input
              style={s.input}
              value={settings.bank_name}
              placeholder="e.g. Barclays"
              onChange={e => setField('bank_name', e.target.value)}
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Sort Code</label>
            <input
              style={s.input}
              value={settings.sort_code}
              placeholder="e.g. 04-03-33"
              onChange={e => setField('sort_code', e.target.value)}
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Account Number</label>
            <input
              style={s.input}
              value={settings.account_number}
              placeholder="e.g. 67644868"
              onChange={e => setField('account_number', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div style={s.group}>
        <div style={s.groupTitle}>VAT</div>

        <div style={s.toggleRow}>
          <label style={s.toggleLabel}>
            <input
              type="checkbox"
              checked={settings.vat_registered}
              onChange={e => setField('vat_registered', e.target.checked)}
              style={{ marginRight: 8 }}
            />
            I am VAT registered
          </label>

          <span style={s.hint}>If unticked, VAT is not added to any invoice</span>
        </div>

        {settings.vat_registered && (
          <div style={s.row2}>
            <div style={s.field}>
              <label style={s.label}>VAT Number</label>
              <input
                style={s.input}
                value={settings.vat_number}
                placeholder="GB 123 456 789"
                onChange={e => setField('vat_number', e.target.value)}
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Default VAT Rate</label>
              <select
                style={s.input}
                value={settings.vat_rate}
                onChange={e => setField('vat_rate', parseInt(e.target.value, 10))}
              >
                <option value={0}>0%</option>
                <option value={5}>5%</option>
                <option value={20}>20%</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div style={s.group}>
        <div style={s.groupTitle}>Payment Terms</div>

        <div style={s.field}>
          <label style={s.label}>Default Due Date</label>
          <select
            style={{ ...s.input, maxWidth: 260 }}
            value={settings.payment_terms}
            onChange={e => setField('payment_terms', parseInt(e.target.value, 10))}
          >
            <option value={0}>Due on receipt</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>

          <span style={s.hint}>Can be overridden per invoice</span>
        </div>
      </div>

      <div style={s.group}>
        <div style={s.groupTitle}>Default Invoice Notes</div>

        <textarea
          style={{ ...s.input, height: 80, resize: 'vertical' }}
          value={settings.invoice_notes}
          placeholder="Text shown at the bottom of every invoice"
          onChange={e => setField('invoice_notes', e.target.value)}
        />
      </div>

      <div style={s.saveRow}>
        <button onClick={saveSettings} style={s.saveBtn}>
          {saved ? '✓ Saved' : 'Save Invoice Settings'}
        </button>

        {saved && <span style={s.savedMsg}>Settings saved. Next invoice will be {nextNumber}.</span>}
      </div>
    </div>
  );
}

const s = {
  container: { display: 'flex', flexDirection: 'column', gap: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text)', paddingBottom: 8, borderBottom: '2px solid var(--border)' },
  group: { background: 'var(--bg3)', borderRadius: 10, padding: '16px 20px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 },
  groupTitle: { fontSize: 13, fontWeight: 700, color: 'var(--blue)' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', outline: 'none', width: '100%', boxSizing: 'border-box' },
  hint: { fontSize: 11, color: 'var(--text3)', marginTop: 2 },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 16 },
  toggleLabel: { display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' },
  saveRow: { display: 'flex', alignItems: 'center', gap: 14 },
  saveBtn: { background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  savedMsg: { color: 'var(--green)', fontSize: 13, fontWeight: 600 },
};
