import { useState, useCallback } from 'react';
import sb from '../../supabaseClient';

const mInput = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13.5,
  background: '#fff',
  border: '1px solid #dfe3ea',
  borderRadius: 10,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const mSection = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 16,
};

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.55px',
        marginBottom: 5,
      }}>
        {label}
      </div>

      {hint && (
        <div style={{
          fontSize: 11.5,
          color: 'var(--text3)',
          lineHeight: 1.4,
          marginBottom: 5,
        }}>
          {hint}
        </div>
      )}

      {children}
    </div>
  );
}

function OwnerBlock({ title, obj, set, required = false }) {
  return (
    <div style={{
      background: '#f8fafc',
      border: '1px solid #eef1f5',
      borderRadius: 14,
      padding: 14,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.55px',
        marginBottom: 10,
      }}>
        {title}{required ? ' *' : ' (optional)'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Full name">
          <input value={obj.name} onChange={e => set('name', e.target.value)} style={mInput} />
        </Field>

        <Field label="Email">
          <input value={obj.email} onChange={e => set('email', e.target.value)} style={mInput} />
        </Field>

        <Field label="Phone">
          <input value={obj.phone} onChange={e => set('phone', e.target.value)} style={mInput} />
        </Field>
      </div>
    </div>
  );
}

function AddressBlock({
  title,
  premise,
  service,
  sameAddr,
  onPremise,
  onService,
  onToggle,
  premiseLabel,
  premiseHint,
  required = false,
}) {
  const handlePremise = (value) => {
    onPremise(value);
    if (sameAddr) onService(value);
  };

  const handleToggle = (checked) => {
    onToggle(checked);
    if (checked) onService(premise);
  };

  return (
    <div style={mSection}>
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        marginBottom: 12,
      }}>
        {title}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label={`${premiseLabel}${required ? ' *' : ''}`} hint={premiseHint}>
          <input
            value={premise}
            onChange={e => handlePremise(e.target.value)}
            placeholder="Full address including postcode"
            style={mInput}
          />
        </Field>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--text2)',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <input type="checkbox" checked={sameAddr} onChange={e => handleToggle(e.target.checked)} />
          Service / correspondence address is the same as premise address
        </label>

        {!sameAddr && (
          <Field
            label="Service / correspondence address"
            hint="Use this if notices, awards or appointment documents should be served somewhere other than the property itself."
          >
            <input
              value={service}
              onChange={e => onService(e.target.value)}
              placeholder="Registered or correspondence address"
              style={mInput}
            />
          </Field>
        )}
      </div>
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

    const nums = (data || [])
      .map(p => p.ref || '')
      .filter(r => r.startsWith(`SQ1-${year}-`))
      .map(r => parseInt(r.split('-')[2], 10) || 0);

    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;

    return `SQ1-${year}-${String(next).padStart(3, '0')}`;
  } catch {
    return `SQ1-${new Date().getFullYear()}-001`;
  }
}

function buildAORecord(form, aoService) {
  return {
    id: `ao-${Date.now()}`,
    num: 1,

    premise: form.aoPremise.trim(),
    address: form.aoPremise.trim(),
    reg_addr: aoService || form.aoPremise.trim(),
    service_address: aoService || form.aoPremise.trim(),

    name: form.ao1.name.trim(),
    email: form.ao1.email.trim() || '',
    phone: form.ao1.phone.trim() || '',

    name2: form.ao2.name.trim() || '',
    email2: form.ao2.email.trim() || '',
    phone2: form.ao2.phone.trim() || '',

    status: 'appointed_ao',
    appointed_by_me: true,
    agreed_surveyor: false,

    notice_served_date: '',
    noticeServedDate: '',
    consent_deadline: '',
    consentDeadline: '',
    s10_deadline: '',
    s10Deadline: '',

    surv_name: '',
    surveyorName: '',
    surv_firm: '',
    surveyorFirm: '',
    surv_email: '',
    surveyorEmail: '',
    surv_phone: '',
    surveyorPhone: '',
  };
}

export default function NewProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    project_type: 'party_wall',
    role: 'BO',

    boPremise: '',
    boService: '',
    bo1: { name: '', email: '', phone: '' },
    bo2: { name: '', email: '', phone: '' },

    aoPremise: '',
    aoService: '',
    ao1: { name: '', email: '', phone: '' },
    ao2: { name: '', email: '', phone: '' },

    works: '',
    fee: '',
  });

  const [boSameAddr, setBoSameAddr] = useState(false);
  const [aoSameAddr, setAoSameAddr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isAO = form.role === 'AO';
  const isConstruction = form.project_type === 'construction';

  const setBo1 = (k, v) => setForm(f => ({ ...f, bo1: { ...f.bo1, [k]: v } }));
  const setBo2 = (k, v) => setForm(f => ({ ...f, bo2: { ...f.bo2, [k]: v } }));
  const setAo1 = (k, v) => setForm(f => ({ ...f, ao1: { ...f.ao1, [k]: v } }));
  const setAo2 = (k, v) => setForm(f => ({ ...f, ao2: { ...f.ao2, [k]: v } }));

  const handleCreate = useCallback(async () => {
    setError('');

    if (isAO) {
      if (!form.aoPremise.trim()) {
        setError('Adjoining owner premise address is required.');
        return;
      }

      if (!form.ao1.name.trim()) {
        setError('Adjoining owner name is required.');
        return;
      }
    } else {
      if (!form.boPremise.trim()) {
        setError('Building owner premise address is required.');
        return;
      }

      if (!form.bo1.name.trim()) {
        setError('Building owner name is required.');
        return;
      }
    }

    setSaving(true);

    try {
      const ref = await getNextRef();
      const fee = form.fee.trim() ? parseFloat(form.fee) : null;
      const { data: { user } } = await sb.auth.getUser();

      const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const boPremise = form.boPremise.trim();
      const boService = (boSameAddr ? form.boPremise : form.boService).trim();
      const aoPremise = form.aoPremise.trim();
      const aoService = (aoSameAddr ? form.aoPremise : form.aoService).trim();

      const payload = {
        id: newId,
        user_id: user?.id || null,

        ref,
        role: form.role,   // valid column — appointment_role does not exist
        status: 'active',

        // Building owner — top-level columns that exist in schema
        bo_premise_address: boPremise || null,
        bo_service_address: boService || boPremise || null,
        bo_1_name: form.bo1.name.trim() || null,
        bo: form.bo1.name.trim() || null,       // legacy display field
        bo_1_email: form.bo1.email.trim() || null,
        bo_phone: form.bo1.phone.trim() || null, // only one phone column
        bo_2_name: form.bo2.name.trim() || null,
        bo_2_email: form.bo2.email.trim() || null,
        // bo_email / bo_2_phone do not exist in schema — omitted

        // Adjoining owner — schema has ao_client_name, ao_email, ao_phone (single owner)
        // Owner 2 and full AO details live in the aos jsonb array below
        ao_premise_address: aoPremise || null,
        ao_service_address: aoService || aoPremise || null,
        ao_client_name: form.ao1.name.trim() || null,
        ao_email: form.ao1.email.trim() || null,
        ao_phone: form.ao1.phone.trim() || null,
        // ao_2_name / ao_2_email / ao_2_phone are not top-level columns — in aos jsonb

        // Full AO record (including owner 2) stored in aos jsonb
        aos: isAO ? [buildAORecord(form, aoService || aoPremise)] : [],

        works: form.works.trim() || null,
        fee: Number.isFinite(fee) ? fee : null,
        project_type: form.project_type || 'party_wall',
        // PM fields
        client_name: form.project_type === 'construction' ? (form.bo1.name.trim() || null) : null,
        client_email: form.project_type === 'construction' ? (form.bo1.email.trim() || null) : null,
        site_address: form.project_type === 'construction' ? (boPremise || null) : null,
        contract_value: form.project_type === 'construction' && form.fee.trim() ? parseFloat(form.fee) : null,
      };

      const { data, error: err } = await sb
        .from('projects')
        .insert([payload])
        .select('*')
        .single();

      if (err) throw err;

      onCreated?.(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not create project.');
      setSaving(false);
    }
  }, [form, boSameAddr, aoSameAddr, isAO, onClose, onCreated]);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 800,
      background: 'rgba(15,23,42,0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    }}>
      <div style={{
        width: 760,
        maxWidth: '96vw',
        maxHeight: '90vh',
        overflowY: 'auto',
        background: '#eef1f5',
        border: '1px solid #d8dde6',
        borderRadius: 22,
        boxShadow: '0 24px 70px rgba(15,23,42,0.35)',
      }}>
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: '#eef1f5',
          padding: '18px 22px 12px',
          borderBottom: '1px solid #d8dde6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>New project</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {isConstruction ? 'Construction / PM project' : isAO ? 'AO appointment setup' : 'BO appointment setup'}
            </div>
          </div>

          <button onClick={onClose} style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text3)',
            cursor: 'pointer',
            fontSize: 24,
            lineHeight: 1,
          }}>
            ×
          </button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Project type selector */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 8 }}>
              Project type
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { value: 'party_wall', label: '⚖️ Party Wall', desc: 'Notices, awards, SOC' },
                { value: 'construction', label: '🏗️ Construction / PM', desc: 'Projects, programme, financials' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, project_type: opt.value }))}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: form.project_type === opt.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: form.project_type === opt.value ? 'var(--blue-bg)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {isConstruction ? (
            /* ── Construction / PM form ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 }}>Site address *</div>
                <input
                  value={form.boPremise}
                  onChange={e => setForm(f => ({ ...f, boPremise: e.target.value }))}
                  placeholder="Full site address including postcode"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 }}>Client name</div>
                <input
                  value={form.bo1.name}
                  onChange={e => setBo1('name', e.target.value)}
                  placeholder="Client full name"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 }}>Client email</div>
                <input
                  value={form.bo1.email}
                  onChange={e => setBo1('email', e.target.value)}
                  placeholder="client@email.com"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 }}>Client phone</div>
                <input
                  value={form.bo1.phone}
                  onChange={e => setBo1('phone', e.target.value)}
                  placeholder="Phone number"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 }}>Works description</div>
                <input
                  value={form.works}
                  onChange={e => setForm(f => ({ ...f, works: e.target.value }))}
                  placeholder="e.g. Rear extension, loft conversion, bathroom refit"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 }}>Contract value (£)</div>
                <input
                  type="number"
                  value={form.fee}
                  onChange={e => setForm(f => ({ ...f, fee: e.target.value }))}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
            </div>
          ) : (
          <div>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.55px',
              marginBottom: 8,
            }}>
              Your role on this project
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { value: 'BO', title: "Building Owner's Surveyor", sub: 'Acting for the BO' },
                { value: 'AO', title: "Adjoining Owner's Surveyor", sub: 'Acting for the AO' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role: opt.value }))}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    border: form.role === opt.value ? '2px solid var(--blue)' : '1px solid #e5e7eb',
                    background: form.role === opt.value ? 'var(--blue-bg)' : '#fff',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {opt.title}
                  </div>

                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                    {opt.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {isAO ? (
            <>
              <AddressBlock
                title="Adjoining owner property"
                premise={form.aoPremise}
                service={form.aoService}
                sameAddr={aoSameAddr}
                onPremise={v => setForm(f => ({ ...f, aoPremise: v }))}
                onService={v => setForm(f => ({ ...f, aoService: v }))}
                onToggle={setAoSameAddr}
                premiseLabel="Adjoining owner premise address"
                premiseHint="Your client’s property. This becomes the main project display address for this AO appointment."
                required
              />

              <div style={mSection}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  marginBottom: 12,
                }}>
                  Adjoining owner details
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <OwnerBlock title="Owner 1" obj={form.ao1} set={setAo1} required />
                  <OwnerBlock title="Owner 2" obj={form.ao2} set={setAo2} />
                </div>
              </div>

              <AddressBlock
                title="Building owner property"
                premise={form.boPremise}
                service={form.boService}
                sameAddr={boSameAddr}
                onPremise={v => setForm(f => ({ ...f, boPremise: v }))}
                onService={v => setForm(f => ({ ...f, boService: v }))}
                onToggle={setBoSameAddr}
                premiseLabel="Building owner premise address"
                premiseHint="Optional at setup. Add the BO property address if known. BO name and contact details can be completed later."
              />

              <div style={mSection}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  marginBottom: 12,
                }}>
                  Building owner details
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <OwnerBlock title="Owner 1" obj={form.bo1} set={setBo1} />
                  <OwnerBlock title="Owner 2" obj={form.bo2} set={setBo2} />
                </div>
              </div>
            </>
          ) : (
            <>
              <AddressBlock
                title="Building owner property"
                premise={form.boPremise}
                service={form.boService}
                sameAddr={boSameAddr}
                onPremise={v => setForm(f => ({ ...f, boPremise: v }))}
                onService={v => setForm(f => ({ ...f, boService: v }))}
                onToggle={setBoSameAddr}
                premiseLabel="Premise address"
                premiseHint="The property where the works are taking place."
                required
              />

              <div style={mSection}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  marginBottom: 12,
                }}>
                  Building owner
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <OwnerBlock title="Owner 1" obj={form.bo1} set={setBo1} required />
                  <OwnerBlock title="Owner 2" obj={form.bo2} set={setBo2} />
                </div>
              </div>
            </>
          )}

          <div style={mSection}>
            <div style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              marginBottom: 12,
            }}>
              Works & fees
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Description of works">
                <textarea
                  rows={2}
                  value={form.works}
                  onChange={e => setForm(f => ({ ...f, works: e.target.value }))}
                  placeholder="e.g. Single storey rear extension, chimney breast removal…"
                  style={{ ...mInput, resize: 'vertical' }}
                />
              </Field>

              <div style={{ width: '50%' }}>
                <Field label="Projected fee (£)" hint="Can be updated later.">
                  <input
                    value={form.fee}
                    onChange={e => setForm(f => ({ ...f, fee: e.target.value }))}
                    placeholder="e.g. 1200"
                    style={mInput}
                  />
                </Field>
              </div>
            </div>
          </div>
          )} {/* end party wall form */}

          {error && (
            <div style={{
              color: 'var(--red)',
              fontSize: 13,
              padding: '8px 12px',
              background: 'var(--red-bg)',
              borderRadius: 8,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={onClose} style={{
              padding: '9px 20px',
              borderRadius: 99,
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--text)',
            }}>
              Cancel
            </button>

            <button onClick={handleCreate} disabled={saving} style={{
              padding: '9px 24px',
              borderRadius: 99,
              border: 'none',
              background: 'var(--blue)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}>
              {saving ? 'Creating…' : 'Create project →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
