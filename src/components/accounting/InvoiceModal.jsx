import React, { useState, useEffect } from 'react';

const DEFAULT_ITEMS = [{ description: '', qty: 1, unitPrice: '', total: 0 }];

async function polishDescription(text) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are helping a party wall surveyor write professional invoice line item descriptions.

Improve the following invoice line item description: fix spelling, grammar, and make it sound professional and suitable for a formal invoice from a party wall surveyor. Keep it concise. Return ONLY the improved description text with no explanation, quotes, or preamble.

Description to improve: "${text}"`
      }]
    })
  });
  const data = await response.json();
  return data.content?.[0]?.text?.trim() || text;
}

export default function InvoiceModal({ invoice, initialData = {}, nextNumber, settings, projects, onSave, onClose }) {
  const isEdit = !!invoice;
  const role = invoice?.role || initialData?.role || 'BO';
  const isAO = String(role).toUpperCase() === 'AO';

  const [form, setForm] = useState({
    invoice_number: invoice?.invoice_number || nextNumber || 1601,
    invoice_date: invoice?.invoice_date || new Date().toISOString().split('T')[0],
    due_date: invoice?.due_date || '',
    bill_to_name: invoice?.bill_to_name || initialData?.bill_to_name || '',
    bill_to_address: invoice?.bill_to_address || initialData?.bill_to_address || '',
    property_address: invoice?.property_address || initialData?.property_address || '',
    project_id: invoice?.project_id || initialData?.project_id || '',
    project_ref: invoice?.project_ref || initialData?.project_ref || '',
    role,
    acting_for_name: invoice?.acting_for_name || initialData?.acting_for_name || '',
    acting_for_address: invoice?.acting_for_address || initialData?.acting_for_address || '',
    ao_client_name: invoice?.ao_client_name || initialData?.ao_client_name || '',
    ao_client_address: invoice?.ao_client_address || initialData?.ao_client_address || '',
    items: invoice?.items || initialData?.items || DEFAULT_ITEMS,
    vat_rate: invoice?.vat_rate ?? (settings?.vat_rate || 0),
    notes: invoice?.notes || initialData?.notes || '',
    status: invoice?.status || 'unpaid',
  });

  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState({});

  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.unitPrice) || 0) * (parseFloat(it.qty) || 0), 0);
  const vatAmount = subtotal * (form.vat_rate / 100);
  const total = subtotal + vatAmount;

  useEffect(() => {
    if (!form.due_date && form.invoice_date) {
      const terms = settings?.payment_terms || 0;
      const d = new Date(form.invoice_date);
      d.setDate(d.getDate() + terms);
      setForm(f => ({ ...f, due_date: d.toISOString().split('T')[0] }));
    }
  }, [form.invoice_date, settings?.payment_terms]);

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const setItem = (idx, key, val) => {
    const items = form.items.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [key]: val };
      updated.total = (parseFloat(updated.unitPrice) || 0) * (parseFloat(updated.qty) || 0);
      return updated;
    });
    setField('items', items);
  };

  const handlePolish = async (idx) => {
    const currentText = form.items[idx]?.description;
    if (!currentText?.trim()) return;
    setPolishing(p => ({ ...p, [idx]: true }));
    try {
      const improved = await polishDescription(currentText);
      setItem(idx, 'description', improved);
    } catch (e) {
      console.error('AI polish failed:', e);
    } finally {
      setPolishing(p => ({ ...p, [idx]: false }));
    }
  };

  const addItem = () => setField('items', [...form.items, { description: '', qty: 1, unitPrice: '', total: 0 }]);
  const removeItem = (idx) => setField('items', form.items.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, subtotal, vat_amount: vatAmount, total });
      onClose();
    } catch (e) {
      alert('Error saving invoice: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n) => `£${Number(n).toFixed(2)}`;

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>{isEdit ? `Edit Invoice-${form.invoice_number}` : 'Raise Invoice'}</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          <div style={styles.row3}>
            <div style={styles.field}>
              <label style={styles.label}>Invoice Number</label>
              <input style={styles.input} value={form.invoice_number}
                onChange={e => setField('invoice_number', e.target.value)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Invoice Date</label>
              <input style={styles.input} type="date" value={form.invoice_date}
                onChange={e => setField('invoice_date', e.target.value)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Due Date</label>
              <input style={styles.input} type="date" value={form.due_date}
                onChange={e => setField('due_date', e.target.value)} />
            </div>
          </div>

          <div style={{ ...styles.roleNote, ...(isAO ? styles.roleNoteAO : {}) }}>
            <span style={{ fontSize: 13, color: isAO ? '#5b21b6' : '#555' }}>
              Acting as <strong>{isAO ? "Adjoining Owner's Surveyor" : "Building Owner's Surveyor"}</strong>
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 12.5, color: isAO ? '#5b21b6' : '#3d5a99', fontWeight: 600 }}>
              {isAO ? 'Invoice still addressed to the Building Owner' : 'Invoice addressed to the Building Owner'}
            </span>
          </div>

          {isAO && (form.acting_for_name || form.ao_client_name) && (
            <div style={styles.aoNotice}>
              <strong>AO appointment:</strong> Acting for {form.acting_for_name || form.ao_client_name}
              {form.acting_for_address || form.ao_client_address ? ` at ${form.acting_for_address || form.ao_client_address}` : ''}.
              The invoice remains payable by the Building Owner.
            </div>
          )}

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Bill To (Building Owner)</div>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label style={styles.label}>Building Owner Name</label>
                <input style={styles.input} value={form.bill_to_name} placeholder="Building Owner / Company name"
                  onChange={e => setField('bill_to_name', e.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Building Owner's Address</label>
                <input style={styles.input} value={form.bill_to_address} placeholder="BO service / correspondence address"
                  onChange={e => setField('bill_to_address', e.target.value)} />
              </div>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>In Respect Of</div>
            <div style={styles.field}>
              <label style={styles.label}>Property / Works Address</label>
              <input style={styles.input} value={form.property_address}
                placeholder="Address where works are being carried out"
                onChange={e => setField('property_address', e.target.value)} />
            </div>
            {projects?.length > 0 && (
              <div style={styles.field}>
                <label style={styles.label}>Link to Project (optional)</label>
                <select style={styles.input} value={form.project_id}
                  onChange={e => setField('project_id', e.target.value)}>
                  <option value="">— No project linked —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.ref || p.reference || p.id} — {p.bo_premise_address || p.address || ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Line Items</div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: '50%' }}>Description</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Unit Price</th>
                  <th style={styles.th}>Total</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, idx) => (
                  <tr key={idx}>
                    <td style={styles.td}>
                      <div style={styles.descWrapper}>
                        <input
                          style={styles.tableInput}
                          value={item.description}
                          placeholder="e.g. party wall fees for 2 storey extension"
                          onChange={e => setItem(idx, 'description', e.target.value)}
                        />
                        <button
                          onClick={() => handlePolish(idx)}
                          disabled={polishing[idx] || !item.description?.trim()}
                          style={{
                            ...styles.polishBtn,
                            ...(polishing[idx] ? styles.polishBtnActive : {}),
                            ...((!item.description?.trim()) ? styles.polishBtnDisabled : {}),
                          }}
                          title="Ask AI to improve this description"
                        >
                          {polishing[idx] ? (
                            <span style={styles.spinner}>⟳</span>
                          ) : (
                            '✨'
                          )}
                        </button>
                      </div>
                      {!item.description?.trim() && (
                        <div style={styles.aiHint}>Type a description, then click ✨ to polish it</div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <input style={{ ...styles.tableInput, textAlign: 'center', width: 60 }}
                        value={item.qty} type="number" min="1"
                        onChange={e => setItem(idx, 'qty', e.target.value)} />
                    </td>
                    <td style={styles.td}>
                      <input style={{ ...styles.tableInput, textAlign: 'right', width: 90 }}
                        value={item.unitPrice} placeholder="0.00" type="number" step="0.01"
                        onChange={e => setItem(idx, 'unitPrice', e.target.value)} />
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                      {fmt(item.total)}
                    </td>
                    <td style={styles.td}>
                      {form.items.length > 1 && (
                        <button onClick={() => removeItem(idx)} style={styles.removeBtn}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addItem} style={styles.addItemBtn}>+ Add line item</button>
          </div>

          <div style={styles.totalsBlock}>
            <div style={styles.totalRow}>
              <span>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            <div style={styles.totalRow}>
              <span>
                VAT
                <select style={styles.vatSelect} value={form.vat_rate}
                  onChange={e => setField('vat_rate', parseFloat(e.target.value))}>
                  <option value={0}>0%</option>
                  <option value={5}>5%</option>
                  <option value={20}>20%</option>
                </select>
              </span>
              <span>{fmt(vatAmount)}</span>
            </div>
            <div style={{ ...styles.totalRow, ...styles.grandTotal }}>
              <span>Total Due</span><span>{fmt(total)}</span>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Notes (optional)</label>
            <textarea style={{ ...styles.input, height: 60, resize: 'vertical' }}
              value={form.notes} placeholder="Payment instructions, additional notes..."
              onChange={e => setField('notes', e.target.value)} />
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 1000, overflowY: 'auto', padding: '24px 16px',
  },
  modal: {
    background: '#fff', borderRadius: 12, width: '100%', maxWidth: 780,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 24px', borderBottom: '1px solid #e8e8f0',
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a2e' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#666', padding: '4px 8px', borderRadius: 6 },
  body: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
  footer: { padding: '16px 24px', borderTop: '1px solid #e8e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: { border: '1px solid #dde0ee', borderRadius: 8, padding: '8px 12px', fontSize: 14, color: '#1a1a2e', outline: 'none', width: '100%', boxSizing: 'border-box' },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#3d5a99', borderBottom: '1px solid #e8e8f0', paddingBottom: 6 },
  roleNote: { display: 'flex', alignItems: 'center', gap: 8, background: '#f0f4ff', borderRadius: 8, padding: '10px 14px', border: '1px solid transparent' },
  roleNoteAO: { background: '#f3e8ff', borderColor: '#a855f7' },
  aoNotice: { fontSize: 12.5, color: '#5b21b6', background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: 8, padding: '9px 12px', lineHeight: 1.45 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', borderBottom: '2px solid #e8e8f0', textAlign: 'left' },
  td: { padding: '6px 4px', borderBottom: '1px solid #f0f0f8', verticalAlign: 'middle' },
  descWrapper: { display: 'flex', gap: 6, alignItems: 'center' },
  tableInput: { flex: 1, border: '1px solid #dde0ee', borderRadius: 6, padding: '6px 8px', fontSize: 13, outline: 'none', boxSizing: 'border-box', minWidth: 0 },
  polishBtn: {
    flexShrink: 0, width: 32, height: 32, border: '1px solid #c8d4f0',
    borderRadius: 7, background: '#f0f4ff', cursor: 'pointer',
    fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s',
  },
  polishBtnActive: { background: '#e0e8ff', borderColor: '#3d5a99', animation: 'spin 1s linear infinite' },
  polishBtnDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  spinner: { display: 'inline-block', animation: 'spin 0.8s linear infinite', fontSize: 16 },
  aiHint: { fontSize: 10, color: '#bbb', marginTop: 3, paddingLeft: 2 },
  removeBtn: { background: 'none', border: 'none', color: '#cc4444', cursor: 'pointer', fontSize: 14 },
  addItemBtn: { marginTop: 8, background: 'none', border: '1px dashed #3d5a99', borderRadius: 8, color: '#3d5a99', padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  totalsBlock: { marginLeft: 'auto', width: 280, display: 'flex', flexDirection: 'column', gap: 6, background: '#f8f9fe', borderRadius: 10, padding: '12px 16px' },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#444', alignItems: 'center' },
  grandTotal: { borderTop: '2px solid #3d5a99', paddingTop: 8, fontWeight: 700, fontSize: 16, color: '#1a1a2e' },
  vatSelect: { border: '1px solid #dde0ee', borderRadius: 6, padding: '2px 6px', fontSize: 12, marginLeft: 8 },
  cancelBtn: { padding: '9px 20px', borderRadius: 8, border: '1px solid #dde0ee', background: '#fff', color: '#555', cursor: 'pointer', fontSize: 14 },
  saveBtn: { padding: '9px 24px', borderRadius: 8, border: 'none', background: '#3d5a99', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
};
