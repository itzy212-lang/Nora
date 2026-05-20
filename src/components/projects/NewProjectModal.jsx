import { useState, useCallback } from 'react';
import sb from '../../supabaseClient';

const modalInput = {
  width: '100%', padding: '10px 12px', fontSize: 13.5,
  background: '#fff', border: '1px solid #dfe3ea', borderRadius: 12,
  color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
};
const modalSection = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16,
};

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}

async function getNextRef() {
  try {
    const { data } = await sb
      .from('projects')
      .select('ref')
      .order('created_at', { ascending: false })
      .limit(20);

    const year = new Date().getFullYear();
    const existing = (data || [])
      .map(p => p.ref || '')
      .filter(r => r.startsWith(`SQ1-${year}-`))
      .map(r => parseInt(r.split('-')[2]) || 0);

    const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    return `SQ1-${year}-${String(next).padStart(3, '0')}`;
  } catch {
    return `SQ1-${new Date().getFullYear()}-001`;
  }
}

export default function NewProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    role: 'BO',
    address: '',
    bo_1_name: '',
    bo_1_email: '',
    bo_1_phone: '',
    bo_2_name: '',
    bo_2_email: '',
    works: '',
    fee: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = useCallback(async () => {
    if (!form.address.trim()) { setError('Property address is required.'); return; }
    if (!form.bo_1_name.trim()) { setError('Building owner name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const ref = await getNextRef();
      const feeValue = form.fee.trim() ? parseFloat(form.fee) : null;

      const payload = {
        ref,
        role: form.role,
        surveyor_role: form.role,
        address: form.address.trim(),
        bo_premise_address: form.address.trim(),
        bo_1_name: form.bo_1_name.trim(),
        bo: form.bo_1_name.trim(),
        bo_1_email: form.bo_1_email.trim() || null,
        bo_email: form.bo_1_email.trim() || null,
        bo_1_phone: form.bo_1_phone.trim() || null,
        bo_2_name: form.bo_2_name.trim() || null,
        bo_2_email: form.bo_2_email.trim() || null,
        works: form.works.trim() || null,
        fee: Number.isFinite(feeValue) ? feeValue : null,
        status: 'active',
        aos: [],
        created_at: new Date().toISOString(),
      };

      const { data, error: insertError } = await sb
        .from('projects')
        .insert([payload])
        .select('*')
        .single();

      if (insertError) throw insertError;
      onCreated?.(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not create project.');
    } finally {
      setSaving(false);
    }
  }, [form, onClose, onCreated]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={{ width: 700, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', background: '#eef1f5', border: '1px solid #d8dde6', borderRadius: 22, boxShadow: '0 24px 70px rgba(15,23,42,0.35)' }}>

        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#eef1f5', padding: '18px 22px 12px', borderBottom: '1px solid #d8dde6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>New project</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Role */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 8 }}>Your role on this project</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                { value: 'BO', title: "Building Owner's Surveyor", sub: 'Acting for the BO' },
                { value: 'AO', title: "Adjoining Owner's Surveyor", sub: 'Acting for the AO' },
              ].map(opt => (
                <button key={opt.value} onClick={() => set('role', opt.value)} style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                  border: form.role === opt.value ? '2px solid var(--blue)' : '1px solid #e5e7eb',
                  background: form.role === opt.value ? 'var(--blue-bg)' : '#fff',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{opt.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Address */}
          <div style={modalSection}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Property</div>
            <Field label="Premise address *" hint="The property where the works are taking place.">
              <textarea rows={2} value={form.address} onChange={e => set('address', e.target.value)}
                placeholder="Full address including postcode" style={{ ...modalInput, resize: 'vertical' }} />
            </Field>
          </div>

          {/* Building Owner */}
          <div style={modalSection}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Building owner</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Owner 1</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Full name *"><input value={form.bo_1_name} onChange={e => set('bo_1_name', e.target.value)} placeholder="e.g. John Smith" style={modalInput} /></Field>
                  <Field label="Email"><input value={form.bo_1_email} onChange={e => set('bo_1_email', e.target.value)} placeholder="email@example.com" style={modalInput} /></Field>
                  <Field label="Phone"><input value={form.bo_1_phone} onChange={e => set('bo_1_phone', e.target.value)} placeholder="07..." style={modalInput} /></Field>
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Owner 2 <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Full name"><input value={form.bo_2_name} onChange={e => set('bo_2_name', e.target.value)} style={modalInput} /></Field>
                  <Field label="Email"><input value={form.bo_2_email} onChange={e => set('bo_2_email', e.target.value)} style={modalInput} /></Field>
                </div>
              </div>
            </div>
          </div>

          {/* Works + Fee */}
          <div style={modalSection}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Works & fees</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Description of works">
                <textarea rows={3} value={form.works} onChange={e => set('works', e.target.value)}
                  placeholder="e.g. Single storey rear extension, chimney breast removal..." style={{ ...modalInput, resize: 'vertical' }} />
              </Field>
              <Field label="Projected fee (£)" hint="Your fee for this project — can be updated later.">
                <input value={form.fee} onChange={e => set('fee', e.target.value)} placeholder="e.g. 1200" style={{ ...modalInput, width: '50%' }} />
              </Field>
            </div>
          </div>

          {error && <div style={{ color: 'var(--red)', fontSize: 13, padding: '8px 12px', background: 'var(--red-bg)', borderRadius: 8 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 99, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
            <button onClick={handleCreate} disabled={saving} style={{ padding: '9px 24px', borderRadius: 99, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Creating…' : 'Create project →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
