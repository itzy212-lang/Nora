import React, { useState, useEffect } from 'react';

const DEFAULT_ITEMS = [{ description: '', qty: 1, unitPrice: '', total: 0 }];

async function polishDescription(text) {
  const raw = String(text || '').trim();

  if (!raw) return text;

  const response = await fetch('/api/invoice-polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: raw }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Could not polish invoice description');
  }

  return data?.description?.trim() || text;
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
      const {
        acting_for_name,
        acting_for_address,
        ao_client_name,
        ao_client_address,
        project_ref,
        ...invoicePayload
      } = form;

      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      const safeInvoicePayload = {
        ...invoicePayload,
        project_id: uuidPattern.test(String(invoicePayload.project_id || ''))
          ? invoicePayload.project_id
          : null,
      };

      await onSave({
        ...safeInvoicePayload,
        subtotal,
        vat_amount: vatAmount,
        total,
      });

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
        </div>
      </div>
    </div>
  );
}

const styles = {};