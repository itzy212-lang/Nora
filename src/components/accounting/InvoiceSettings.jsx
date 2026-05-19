import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

const STORAGE_KEY = 'ely_invoice_settings';

export default function InvoiceSettings() {
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

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    // Try Supabase first, fall back to localStorage
    try {
      const { data } = await supabase
        .from('ely_data')
        .select('value')
        .eq('key', 'invoice_settings')
        .single();
      if (data?.value) {
        setSettings(prev => ({ ...prev, ...data.value }));
        setLoading(false);
        return;
      }
    } catch {}
    // Fallback to localStorage
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try { setSettings(prev => ({ ...prev, ...JSON.parse(local) })); } catch {}
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    // Save to localStorage immediately
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Save to Supabase
    try {
      await supabase.from('ely_data').upsert({
        key: 'invoice_settings',
        value: settings,
      }, { onConflict: 'key' });
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const setField = (key, val) => setSettings(s => ({ ...s, [key]: val }));

  if (loading) return <p style={{ color: '#aaa', padding: 16 }}>Loading...</p>;

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Invoice Settings</div>

      {/* Invoice numbering */}
      <div style={styles.group}>
        <div style={styles.groupTitle}>Invoice Numbering</div>
        <div style={styles.row2}>
          <div style={styles.field}>
            <label style={styles.label}>Next Invoice Number</label>
            <input style={styles.input} type="number"
              value={settings.next_invoice_number}
              onChange={e => setField('next_invoice_number', parseInt(e.target.value))} />
            <span style={styles.hint}>New invoices will use this number and auto-increment</span>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Invoice Prefix</label>
            <input style={{ ...styles.input, background: '#f5f5f8', color: '#aaa' }} value="Invoice-" disabled />
            <span style={styles.hint}>Format: Invoice-1601, Invoice-1602 etc.</span>
          </div>
        </div>
      </div>

      {/* Bank details */}
      <div style={styles.group}>
        <div style={styles.groupTitle}>Bank Details</div>
        <div style={{ ...styles.hint, marginBottom: 12 }}>
          These appear on every invoice footer automatically
        </div>
        <div style={styles.row2}>
          <div style={styles.field}>
            <label style={styles.label}>Account Name</label>
            <input style={styles.input} value={settings.account_name}
              placeholder="e.g. Itzik Ltd"
              onChange={e => setField('account_name', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Bank Name</label>
            <input style={styles.input} value={settings.bank_name}
              placeholder="e.g. Barclays"
              onChange={e => setField('bank_name', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Sort Code</label>
            <input style={styles.input} value={settings.sort_code}
              placeholder="e.g. 04-03-33"
              onChange={e => setField('sort_code', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Account Number</label>
            <input style={styles.input} value={settings.account_number}
              placeholder="e.g. 67644868"
              onChange={e => setField('account_number', e.target.value)} />
          </div>
        </div>
      </div>

      {/* VAT */}
      <div style={styles.group}>
        <div style={styles.groupTitle}>VAT</div>
        <div style={styles.toggleRow}>
          <label style={styles.toggleLabel}>
            <input type="checkbox" checked={settings.vat_registered}
              onChange={e => setField('vat_registered', e.target.checked)}
              style={{ marginRight: 8 }} />
            I am VAT registered
          </label>
          <span style={styles.hint}>If unticked, VAT is not added to any invoice</span>
        </div>
        {settings.vat_registered && (
          <div style={styles.row2}>
            <div style={styles.field}>
              <label style={styles.label}>VAT Number</label>
              <input style={styles.input} value={settings.vat_number}
                placeholder="GB 123 456 789"
                onChange={e => setField('vat_number', e.target.value)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Default VAT Rate</label>
              <select style={styles.input} value={settings.vat_rate}
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
      <div style={styles.group}>
        <div style={styles.groupTitle}>Payment Terms</div>
        <div style={styles.field}>
          <label style={styles.label}>Default Due Date</label>
          <select style={{ ...styles.input, maxWidth: 260 }} value={settings.payment_terms}
            onChange={e => setField('payment_terms', parseInt(e.target.value))}>
            <option value={0}>Due on receipt</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <span style={styles.hint}>Can be overridden per invoice</span>
        </div>
      </div>

      {/* Default invoice notes */}
      <div style={styles.group}>
        <div style={styles.groupTitle}>Default Invoice Notes</div>
        <textarea style={{ ...styles.input, height: 80, resize: 'vertical' }}
          value={settings.invoice_notes}
          placeholder="Text shown at the bottom of every invoice"
          onChange={e => setField('invoice_notes', e.target.value)} />
      </div>

      {/* Save */}
      <div style={styles.saveRow}>
        <button onClick={saveSettings} style={styles.saveBtn}>
          {saved ? '✓ Saved' : 'Save Invoice Settings'}
        </button>
        {saved && <span style={styles.savedMsg}>Settings saved</span>}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#1a1a2e', paddingBottom: 8, borderBottom: '2px solid #e8e8f0' },
  group: {
    background: '#f9f9fc', borderRadius: 10, padding: '16px 20px',
    border: '1px solid #e8e8f0', display: 'flex', flexDirection: 'column', gap: 12,
  },
  groupTitle: { fontSize: 13, fontWeight: 700, color: '#3d5a99' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: {
    border: '1px solid #dde0ee', borderRadius: 8, padding: '8px 12px',
    fontSize: 14, color: '#1a1a2e', outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  hint: { fontSize: 11, color: '#aaa', marginTop: 2 },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 16 },
  toggleLabel: { display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: 500, color: '#1a1a2e', cursor: 'pointer' },
  saveRow: { display: 'flex', alignItems: 'center', gap: 14 },
  saveBtn: {
    background: '#3d5a99', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
  },
  savedMsg: { color: '#2e8b57', fontSize: 13, fontWeight: 600 },
};
