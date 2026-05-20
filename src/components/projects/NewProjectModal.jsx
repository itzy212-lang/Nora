import { useState, useCallback } from 'react';
import sb from '../../supabaseClient';

const mInput = {
  width: '100%', padding: '8px 12px', fontSize: 13.5,
  background: '#fff', border: '1px solid #dfe3ea', borderRadius: 10,
  color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
};
const mSection = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 };

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4, marginBottom: 5 }}>{hint}</div>}
      {children}
    </div>
  );
}

async function getNextRef() {
  try {
    const { data } = await sb.from('projects').select('ref').order('created_at', { ascending: false }).limit(20);
    const year = new Date().getFullYear();
    const nums = (data || []).map(p => p.ref || '').filter(r => r.startsWith(`SQ1-${year}-`)).map(r => parseInt(r.split('-')[2]) || 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `SQ1-${year}-${String(next).padStart(3, '0')}`;
  } catch { return `SQ1-${new Date().getFullYear()}-001`; }
}

export default function NewProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    role: 'BO', premise: '', service: '',
    bo1: { name: '', email: '', phone: '' },
    bo2: { name: '', email: '', phone: '' },
    works: '', fee: '',
  });
  const [sameAddr, setSameAddr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setBo1 = (k, v) => setForm(f => ({ ...f, bo1: { ...f.bo1, [k]: v } }));
  const setBo2 = (k, v) => setForm(f => ({ ...f, bo2: { ...f.bo2, [k]: v } }));
  const handlePremise = v => setForm(f => ({ ...f, premise: v, service: sameAddr ? v : f.service }));
  const handleToggle  = c => { setSameAddr(c); if (c) setForm(f => ({ ...f, service: f.premise })); };

  const handleCreate = useCallback(async () => {
    if (!form.premise.trim()) { setError('Premise address is required.'); return; }
    if (!form.bo1.name.trim()) { setError('Building owner name is required.'); return; }
    setSaving(true); setError('');
    try {
      const ref = await getNextRef();
      const fee = form.fee.trim() ? parseFloat(form.fee) : null;
      const svc = sameAddr ? form.premise : form.service;
      const { data: { user } } = await sb.auth.getUser();
      // Generate a unique text id (projects.id is text NOT NULL with no default)
      const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const payload = {
        id: newId,
        user_id: user?.id || null,
        ref,
        role: form.role,
        status: 'active',
        bo_premise_address: form.premise.trim(),
        bo_service_address: svc || null,
        bo_1_name: form.bo1.name.trim(),
        bo: form.bo1.name.trim(),
        bo_1_email: form.bo1.email.trim() || null,
        bo_phone: form.bo1.phone.trim() || null,
        bo_2_name: form.bo2.name.trim() || null,
        bo_2_email: form.bo2.email.trim() || null,
        works: form.works.trim() || null,
        fee: Number.isFinite(fee) ? fee : null,
      };
      const { data, error: err } = await sb.from('projects').insert([payload]).select('*').single();
      if (err) throw err;
      onCreated?.(data);
      onClose();
    } catch (err) { setError(err.message || 'Could not create project.'); setSaving(false); }
  }, [form, sameAddr, onClose, onCreated]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={{ width: 700, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', background: '#eef1f5', border: '1px solid #d8dde6', borderRadius: 22, boxShadow: '0 24px 70px rgba(15,23,42,0.35)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#eef1f5', padding: '18px 22px 12px', borderBottom: '1px solid #d8dde6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>New project</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Role */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 8 }}>Your role on this project</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[{ value: 'BO', title: "Building Owner's Surveyor", sub: 'Acting for the BO' }, { value: 'AO', title: "Adjoining Owner's Surveyor", sub: 'Acting for the AO' }].map(opt => (
                <button key={opt.value} onClick={() => setForm(f => ({ ...f, role: opt.value }))} style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer', border: form.role === opt.value ? '2px solid var(--blue)' : '1px solid #e5e7eb', background: form.role === opt.value ? 'var(--blue-bg)' : '#fff' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{opt.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Address */}
          <div style={mSection}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Property addresses</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Premise address *" hint="The property where the works are taking place.">
                <input value={form.premise} onChange={e => handlePremise(e.target.value)} placeholder="Full address including postcode" style={mInput} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={sameAddr} onChange={e => handleToggle(e.target.checked)} />
                Service / correspondence address is the same as premise address
              </label>
              {!sameAddr && (
                <Field label="Service / correspondence address" hint="Use this if the owner is a company with a different registered office, lives elsewhere, or notices and awards should go to a different address.">
                  <input value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} placeholder="Registered or correspondence address" style={mInput} />
                </Field>
              )}
            </div>
          </div>

          {/* Building owner */}
          <div style={mSection}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Building owner</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[{ title: 'Owner 1', obj: form.bo1, set: setBo1 }, { title: 'Owner 2 (optional)', obj: form.bo2, set: setBo2 }].map(({ title, obj, set }) => (
                <div key={title} style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 14, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 10 }}>{title}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Full name"><input value={obj.name} onChange={e => set('name', e.target.value)} style={mInput} /></Field>
                    <Field label="Email"><input value={obj.email} onChange={e => set('email', e.target.value)} style={mInput} /></Field>
                    <Field label="Phone"><input value={obj.phone} onChange={e => set('phone', e.target.value)} style={mInput} /></Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Works + fee */}
          <div style={mSection}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Works & fees</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Description of works">
                <textarea rows={2} value={form.works} onChange={e => setForm(f => ({ ...f, works: e.target.value }))} placeholder="e.g. Single storey rear extension, chimney breast removal…" style={{ ...mInput, resize: 'vertical' }} />
              </Field>
              <div style={{ width: '50%' }}>
                <Field label="Projected fee (£)" hint="Can be updated later.">
                  <input value={form.fee} onChange={e => setForm(f => ({ ...f, fee: e.target.value }))} placeholder="e.g. 1200" style={mInput} />
                </Field>
              </div>
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
