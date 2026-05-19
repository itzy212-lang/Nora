import React, { useState, useEffect } from 'react';
import sb from '../../supabaseClient';
import { useApp } from '../../state/appStore';

const STORAGE_KEY = 'ely_invoice_settings';

export default function InvoiceSettings() {
  const { state } = useApp();
  const { currentUser } = state;

  const [settings, setSettings] = useState({
    next_invoice_number: 1601,
    bank_name: '',
    sort_code: '',
    account_number: '',
    account_name: '',
    vat_registered: false,
    vat_number: '',
    vat_rate: 0,
    payment_terms: 0,
    invoice_notes: 'Thank you for your business.',
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadSettings(); }, [currentUser]);

  const loadSettings = async () => {
    // Try Supabase first
    if (sb && currentUser?.id) {
      try {
        const { data } = await sb
          .from('ely_data')
          .select('data')
          .eq('user_id', currentUser.id)
          .eq('data_type', 'invoice_settings')
          .single();
        if (data?.data) {
          setSettings(prev => ({ ...prev, ...data.data }));
          setLoading(false);
          return;
        }
      } catch {}
    }
    // Fallback to localStorage
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) setSettings(prev => ({ ...prev, ...JSON.parse(local) }));
    } catch {}
    setLoading(false);
  };

  const saveSettings = async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (sb && currentUser?.id) {
      try {
        await sb.from('ely_data').upsert({
          user_id: currentUser.id,
          data_type: 'invoice_settings',
          data: settings,
        }, { onConflict: 'user_id,data_type' });
      } catch {}
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const setField = (key, val) => setSettings(s => ({ ...s, [key]: val }));

  if (loading) return <p style={{ color: 'var(--text3)', padding: 16 }}>Loading...</p>;

  return (
    <div style={s.container}>
      <div style={s.sectionTitle}>Invoice Settings</div>

      {/* Invoice numbering */}
      <div style={s.group}>
        <div style={s.groupTitle}>Invoice Numbering</div>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Next Invoice Number</label>
            <input style={s.input} type="number"
              value={settings.next_invoice_number}
              onChange={e => setField('next_invoice_number', parseInt(e.target.value))} />
            <span style={s.hint}>New invoices will use this number and auto-increment</span>
          </div>
          <div style={s.field}>
            <label style={s.label}>Invoice Prefix</label>
            <input style={{ ...s.input, background: 'var(--bg3)', color: 'var(--text3)' }}
              value="Invoice-" disabled />
            <span style={s.hint}>Format: Invoice-1601, Invoice-1602 etc.</span>
          </div>
        </div>
      </div>

      {/* Bank details */}
      <div style={s.group}>
        <div style={s.groupTitle}>Bank Details</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
          These appear on every invoice footer automatically
        </div>
        <div style={s.row2}>
          <div style={s.field}>
            <label style={s.label}>Account Name</label>
            <input style={s.input} value={settings.account_name}
              placeholder="e.g. Itzik Ltd"
              onChange={e => setField('account_name', e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Bank Name</label>
            <input style={s.input} value={settings.bank_name}
              placeholder="e.g. Barclays"
              onChange={e => setField('bank_name', e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Sort Code</label>
            <input style={s.input} value={settings.sort_code}
              placeholder="e.g. 04-03-33"
              onChange={e => setField('sort_code', e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Account Number</label>
            <input style={s.input} value={settings.account_number}
              placeholder="e.g. 67644868"
              onChange={e => setField('account_number', e.target.value)} />
          </div>
        </div>
      </div>

      {/* VAT */}
      <div style={s.group}>
        <div style={s.groupTitle}>VAT</div>
        <div style={s.toggleRow}>
          <label style={s.toggleLabel}>
            <input type="checkbox" checked={settings.vat_registered}
              onChange={e => setField('vat_registered', e.target.checked)}
              style={{ marginRight: 8 }} />
            I am VAT registered
          </label>
          <span style={s.hint}>If unticked, VAT is not added to any invoice</span>
        </div>
        {settings.vat_registered && (
          <div style={s.row2}>
            <div style={s.field}>
              <label style={s.label}>VAT Number</label>
              <input style={s.input} value={settings.vat_number}
                placeholder="GB 123 456 789"
                onChange={e => setField('vat_number', e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Default VAT Rate</label>
              <select style={s.input} value={settings.vat_rate}
                onChange={e => setField('vat_rate', parseInt(e.target.value))}>
                <option value={0}>0%</option>
                <option value={5}>5%</option>
                <option value={20}>20%</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Payment terms */}
      <div style={s.group}>
        <div style={s.groupTitle}>Payment Terms</div>
        <div style={s.field}>
          <label style={s.label}>Default Due Date</label>
          <select style={{ ...s.input, maxWidth: 260 }} value={settings.payment_terms}
            onChange={e => setField('payment_terms', parseInt(e.target.value))}>
            <option value={0}>Due on receipt</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <span style={s.hint}>Can be overridden per invoice</span>
        </div>
      </div>

      {/* Default notes */}
      <div style={s.group}>
        <div style={s.groupTitle}>Default Invoice Notes</div>
        <textarea style={{ ...s.input, height: 80, resize: 'vertical' }}
          value={settings.invoice_notes}
          placeholder="Text shown at the bottom of every invoice"
          onChange={e => setField('invoice_notes', e.target.value)} />
      </div>

      {/* Save */}
      <div style={s.saveRow}>
        <button onClick={saveSettings} style={s.saveBtn}>
          {saved ? '✓ Saved' : 'Save Invoice Settings'}
        </button>
        {saved && <span style={s.savedMsg}>Settings saved</span>}
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
