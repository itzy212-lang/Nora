import { useState, useEffect, useRef, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import useDocumentGenerator from '../../hooks/useDocumentGenerator';
import { buildBOLOAPlaceholders, buildAOLOAPlaceholders, buildLOAFileName } from '../../utils/buildLOAPlaceholders';
import sb from '../../supabaseClient';

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return width;
}

const aoAddress = ao => ao?.premise || ao?.reg_addr || ao?.address || '';
const aoServiceAddress = ao => ao?.service_address || ao?.serviceAddress || ao?.reg_addr || aoAddress(ao);
const aoSurvName = ao => ao?.surv_name || ao?.surveyorName || '';
const aoSurvFirm = ao => ao?.surv_firm || ao?.surveyorFirm || '';
const aoSurvEmail = ao => ao?.surv_email || ao?.surveyorEmail || '';
const aoSurvPhone = ao => ao?.surv_phone || ao?.surveyorPhone || '';
const aoConsent = ao => ao?.consent_deadline || ao?.consentDeadline || '';
const aoNotice = ao => ao?.notice_served_date || ao?.noticeServedDate || '';
const aoS10 = ao => ao?.s10_deadline || ao?.s10Deadline || '';
const aoName2 = ao => ao?.name2 || '';

const STAGES = ['Notice served', 'Consent', 'Appt made', 'Award', 'Complete'];

function fmtDate(d) {
  if (!d) return '';

  try {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function fmtGBP(v) {
  return `£${(parseFloat(v) || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
  })}`;
}

function getAOColour(ao, projectRole = 'BO') {
  if (projectRole === 'AO' && ao?.appointed_by_me) return '#a855f7';

  const st = (ao.status || '').toLowerCase();

  if (st === 'consent') return '#22c55e';
  if (st === 'dissent' || st === 's10') return '#ef4444';

  const cd = aoConsent(ao);
  const sd = aoS10(ao);
  const now = Date.now();

  if ((cd && new Date(cd).getTime() < now) || (sd && new Date(sd).getTime() < now)) return '#ef4444';
  if (aoNotice(ao) || st === 'notice_served' || cd) return '#22c55e';

  return '#9ca3af';
}

function getProjectColour(project) {
  const role = (project.role || project.appointment_role || 'BO').toUpperCase();
  const aos = project.aos || [];

  if (role === 'AO') return '#a855f7';
  if (!aos.length) return '#9ca3af';

  const now = Date.now();

  const hasOverdue = aos.some(ao => {
    const cd = aoConsent(ao);
    const sd = aoS10(ao);
    const st = (ao.status || '').toLowerCase();

    return (
      (cd && new Date(cd).getTime() < now && !['consent', 'dissent'].includes(st)) ||
      (sd && new Date(sd).getTime() < now)
    );
  });

  if (hasOverdue) return '#ef4444';

  if (aos.some(ao => aoNotice(ao) || aoConsent(ao) || (ao.status || '').toLowerCase() === 'notice_served')) {
    return '#22c55e';
  }

  return '#9ca3af';
}

function getRole(project) {
  return (project.role || project.appointment_role || 'BO').toUpperCase() === 'AO' ? 'AO' : 'BO';
}

function getPrimaryAO(project) {
  return (project.aos || [])[0] || null;
}

function getAppointmentAddress(project) {
  const role = getRole(project);
  const primaryAO = getPrimaryAO(project);

  if (project.appointment_address) return project.appointment_address;
  if (role === 'AO') return aoAddress(primaryAO) || project.address || project.bo_premise_address || '';
  return project.address || project.bo_premise_address || '';
}

function getAppointmentName(project) {
  const role = getRole(project);
  const primaryAO = getPrimaryAO(project);

  if (project.appointment_name) return project.appointment_name;
  if (role === 'AO') return primaryAO?.name || '';
  return project.bo || project.bo_1_name || '';
}

const card = (extra = {}) => ({
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  ...extra,
});

async function updateProjectSafely(projectId, payload) {
  let p = { ...payload };
  let lastError = null;

  for (let i = 0; i < 12; i += 1) {
    const { data, error } = await sb
      .from('projects')
      .update(p)
      .eq('id', projectId)
      .select('*')
      .single();

    if (!error) return data;

    lastError = error;

    const missingColumn = error.message?.match(/Could not find the '([^']+)' column/)?.[1];

    if (missingColumn && Object.prototype.hasOwnProperty.call(p, missingColumn)) {
      const nextPayload = { ...p };
      delete nextPayload[missingColumn];
      p = nextPayload;
      continue;
    }

    throw error;
  }

  throw lastError || new Error('Could not save.');
}

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

function ModalShell({ title, children, onClose }) {
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
        maxHeight: '88vh',
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
            {title}
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

        {children}
      </div>
    </div>
  );
}

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

function AddressBlock({
  premise,
  service,
  serviceSame,
  onPremise,
  onService,
  onToggle,
  premiseLabel = 'Premise address',
  premiseHint,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field label={premiseLabel} hint={premiseHint}>
        <input
          value={premise}
          onChange={e => onPremise(e.target.value)}
          style={mInput}
          placeholder="Full address including postcode"
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
        <input type="checkbox" checked={serviceSame} onChange={e => onToggle(e.target.checked)} />
        Service / correspondence address is the same as premise address
      </label>

      {!serviceSame && (
        <Field
          label="Service / correspondence address"
          hint="Use this if the owner is a company with a different registered office, lives at a different address, or notices and awards should be served somewhere other than the property itself."
        >
          <input
            value={service}
            onChange={e => onService(e.target.value)}
            style={mInput}
            placeholder="Registered or correspondence address"
          />
        </Field>
      )}
    </div>
  );
}

function OwnerBlock({ title, optional, form, set }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 14, padding: 14 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.55px',
        marginBottom: 10,
      }}>
        {title}{optional && <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6 }}>(optional)</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Full name">
          <input value={form.name} onChange={e => set('name', e.target.value)} style={mInput} />
        </Field>

        <Field label="Email">
          <input value={form.email} onChange={e => set('email', e.target.value)} style={mInput} />
        </Field>

        <Field label="Phone">
          <input value={form.phone} onChange={e => set('phone', e.target.value)} style={mInput} />
        </Field>
      </div>
    </div>
  );
}

function SurveyorBlock({ title, form, set }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);

  const searchContacts = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const { data } = await sb
        .from('contacts')
        .select('id, name, firm, email, phone')
        .ilike('name', `%${query}%`)
        .eq('type', 'surveyor')
        .limit(8);

      setSuggestions(data || []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const handleNameChange = (val) => {
    set('name', val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchContacts(val), 250);
    setShowDropdown(true);
  };

  const selectContact = (contact) => {
    set('name', contact.name);
    set('firm', contact.firm || '');
    set('email', contact.email || '');
    set('phone', contact.phone || '');
    setSuggestions([]);
    setShowDropdown(false);
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (!dropdownRef.current?.contains(e.target)) setShowDropdown(false);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 14, padding: 14 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.55px',
        marginBottom: 10,
      }}>
        {title}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <Field label="Surveyor name">
            <input
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              onFocus={() => form.name?.length >= 2 && setShowDropdown(true)}
              style={mInput}
              placeholder="Start typing to search contacts…"
              autoComplete="off"
            />
          </Field>

          {showDropdown && suggestions.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 100,
              background: '#fff',
              border: '1px solid #dfe3ea',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              overflow: 'hidden',
            }}>
              {suggestions.map(c => (
                <div
                  key={c.id}
                  onMouseDown={() => selectContact(c)}
                  style={{
                    padding: '9px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    fontSize: 13,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f0f4ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {c.name}
                  </div>
                  {c.firm && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                      {c.firm}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Firm">
          <input value={form.firm} onChange={e => set('firm', e.target.value)} style={mInput} />
        </Field>

        <Field label="Email">
          <input value={form.email} onChange={e => set('email', e.target.value)} style={mInput} />
        </Field>

        <Field label="Phone">
          <input value={form.phone} onChange={e => set('phone', e.target.value)} style={mInput} />
        </Field>
      </div>
    </div>
  );
}

async function maybeSaveSurveyor(surv) {
  if (!surv?.name?.trim() || !surv?.email?.trim()) return;

  try {
    const { data } = await sb
      .from('contacts')
      .select('id')
      .ilike('email', surv.email.trim())
      .limit(1);

    if (data?.length > 0) return;

    await sb.from('contacts').insert([{
      type: 'surveyor',
      name: surv.name.trim(),
      firm: surv.firm?.trim() || null,
      email: surv.email.trim(),
      phone: surv.phone?.trim() || null,
    }]);
  } catch (err) {
    console.warn('Could not save surveyor to contacts:', err.message);
  }
}

function ProjectEditModal({ project, onSave, onClose }) {
  const ip = project.bo_premise_address || project.address || '';
  const is = project.bo_service_address || project.bo_1_service_address || project.bo_address || ip;

  const [sameAddr, setSameAddr] = useState(false);
  const [form, setForm] = useState({
    role: project.role || project.surveyor_role || project.appointment_role || 'BO',
    premise: ip,
    service: is,
    bo1: {
      name: project.bo_1_name || project.bo || '',
      email: project.bo_1_email || project.bo_email || '',
      phone: project.bo_1_phone || project.bo_phone || '',
    },
    bo2: {
      name: project.bo_2_name || '',
      email: project.bo_2_email || '',
      phone: project.bo_2_phone || '',
    },
    ref: project.ref || '',
    status: project.status || 'active',
    works: project.works || '',
    fee: project.fee ?? '',
  });

  const [saving, setSaving] = useState(false);

  const setBo1 = (k, v) => setForm(f => ({ ...f, bo1: { ...f.bo1, [k]: v } }));
  const setBo2 = (k, v) => setForm(f => ({ ...f, bo2: { ...f.bo2, [k]: v } }));

  const handlePremise = v => setForm(f => ({ ...f, premise: v, service: sameAddr ? v : f.service }));
  const handleToggle = c => {
    setSameAddr(c);
    if (c) setForm(f => ({ ...f, service: f.premise }));
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      await onSave({ ...form, service: sameAddr ? form.premise : form.service });
      onClose();
    } catch (err) {
      alert(err.message || 'Could not save.');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit project" onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.55px',
            marginBottom: 8,
          }}>
            Your role
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { value: 'BO', title: "Building Owner's Surveyor", sub: 'Acting for the BO' },
              { value: 'AO', title: "Adjoining Owner's Surveyor", sub: 'Acting for the AO' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setForm(f => ({ ...f, role: opt.value }))}
                style={{
                  textAlign: 'left',
                  padding: '13px 15px',
                  borderRadius: 14,
                  border: form.role === opt.value ? '2px solid var(--blue)' : '1px solid #e5e7eb',
                  background: form.role === opt.value ? 'var(--blue-bg)' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                  {opt.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  {opt.sub}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={mSection}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 12,
          }}>
            Building owner property
          </div>

          <AddressBlock
            premise={form.premise}
            service={form.service}
            serviceSame={sameAddr}
            onPremise={handlePremise}
            onService={v => setForm(f => ({ ...f, service: v }))}
            onToggle={handleToggle}
            premiseHint="The Building Owner's property or the property where the works are taking place."
          />
        </div>

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
            <OwnerBlock title="Owner 1" form={form.bo1} set={setBo1} />
            <OwnerBlock title="Owner 2" optional form={form.bo2} set={setBo2} />
          </div>
        </div>

        <div style={mSection}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 12,
          }}>
            Project details
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Reference">
              <input value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} style={mInput} />
            </Field>

            <Field label="Status">
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={mInput}>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="on_hold">On hold</option>
                <option value="dispute">Dispute</option>
              </select>
            </Field>

            <div style={{ gridColumn: '1/-1' }}>
              <Field label="Works description">
                <textarea
                  rows={2}
                  value={form.works}
                  onChange={e => setForm(f => ({ ...f, works: e.target.value }))}
                  style={{ ...mInput, resize: 'vertical' }}
                />
              </Field>
            </div>

            <Field label="Projected fee (£)">
              <input value={form.fee} onChange={e => setForm(f => ({ ...f, fee: e.target.value }))} style={mInput} />
            </Field>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>
            Cancel
          </button>

          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AOEditModal({ ao, mode, onSave, onClose }) {
  const isNew = mode === 'add';
  const ip = aoAddress(ao || {});
  const is = aoServiceAddress(ao || {}) || ip;

  const [sameAddr, setSameAddr] = useState(false);
  const [form, setForm] = useState({
    premise: ip,
    service: is,
    ao1: { name: ao?.name || '', email: ao?.email || '', phone: ao?.phone || '' },
    ao2: { name: ao?.name2 || '', email: ao?.email2 || '', phone: ao?.phone2 || '' },
    surv: { name: aoSurvName(ao || {}), firm: aoSurvFirm(ao || {}), email: aoSurvEmail(ao || {}), phone: aoSurvPhone(ao || {}) },
    third: { name: ao?.third_surveyor_name || '', firm: ao?.third_surveyor_firm || '', email: ao?.third_surveyor_email || '', phone: ao?.third_surveyor_phone || '' },
  });

  const [saving, setSaving] = useState(false);

  const setAo1 = (k, v) => setForm(f => ({ ...f, ao1: { ...f.ao1, [k]: v } }));
  const setAo2 = (k, v) => setForm(f => ({ ...f, ao2: { ...f.ao2, [k]: v } }));
  const setSurv = (k, v) => setForm(f => ({ ...f, surv: { ...f.surv, [k]: v } }));
  const setThird = (k, v) => setForm(f => ({ ...f, third: { ...f.third, [k]: v } }));

  const handlePremise = v => setForm(f => ({ ...f, premise: v, service: sameAddr ? v : f.service }));
  const handleToggle = c => {
    setSameAddr(c);
    if (c) setForm(f => ({ ...f, service: f.premise }));
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      await maybeSaveSurveyor(form.surv);
      await maybeSaveSurveyor(form.third);
      await onSave({ ...form, service: sameAddr ? form.premise : form.service });
      onClose();
    } catch (err) {
      alert(err.message || 'Could not save AO.');
      setSaving(false);
    }
  };

  return (
    <ModalShell title={isNew ? 'Add adjoining owner' : 'Edit adjoining owner'} onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={mSection}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 12,
          }}>
            Adjoining property
          </div>

          <AddressBlock
            premise={form.premise}
            service={form.service}
            serviceSame={sameAddr}
            onPremise={handlePremise}
            onService={v => setForm(f => ({ ...f, service: v }))}
            onToggle={handleToggle}
            premiseHint="The adjoining property relevant to this party wall matter."
          />
        </div>

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
            <OwnerBlock title="Owner 1" form={form.ao1} set={setAo1} />
            <OwnerBlock title="Owner 2" optional form={form.ao2} set={setAo2} />
          </div>
        </div>

        <div style={mSection}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 12,
          }}>
            AO surveyor
          </div>

          <SurveyorBlock title="AO Surveyor" form={form.surv} set={setSurv} />
        </div>

        <div style={mSection}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            marginBottom: 12,
          }}>
            Third surveyor
          </div>

          <SurveyorBlock title="Third Surveyor" form={form.third} set={setThird} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>
            Cancel
          </button>

          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>
            {saving ? 'Saving…' : isNew ? 'Add AO' : 'Save changes'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AOCard({
  ao,
  projectRole,
  onOpenComposer,
  onGenerateAOLOA,
  onEditAO,
  onServeNotice,
  loaLoading,
}) {
  const isAOAppointment = projectRole === 'AO' && ao.appointed_by_me;
  const colour = getAOColour(ao, projectRole);
  const address = aoAddress(ao);
  const cd = aoConsent(ao);
  const days = daysUntil(cd);
  const noticed = !!aoNotice(ao);
  const survName = aoSurvName(ao);
  const survFirm = aoSurvFirm(ao);
  const survEmail = aoSurvEmail(ao);
  const survPhone = aoSurvPhone(ao);

  const statusLabel = isAOAppointment
    ? 'Your AO client'
    : ({ consent: 'Consent', dissent: 'Dissent', s10: 'S.10', notice_served: 'Notice served' }[(ao.status || '').toLowerCase()] || (noticed ? 'Notice served' : ''));

  return (
    <div style={{ ...card({ marginBottom: 12, overflow: 'hidden' }) }}>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 5, background: colour, borderRadius: '16px 0 0 16px', flexShrink: 0 }} />

        <div style={{ flex: 1, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colour }}>
                AO{ao.num} — {(ao.name || '').toUpperCase()}
              </div>
              {aoName2(ao) && (
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
                  {aoName2(ao)}
                </div>
              )}
            </div>

            {statusLabel && (
              <span style={{ fontSize: 12, fontWeight: 600, color: colour, paddingLeft: 8 }}>
                {statusLabel}
              </span>
            )}
          </div>

          {address && (
            <div style={{ fontSize: 13, color: 'var(--blue)', marginBottom: 4, lineHeight: 1.4 }}>
              {address}
            </div>
          )}

          {ao.phone && (
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 6 }}>
              📞 {ao.phone}
            </div>
          )}

          {!isAOAppointment && noticed && cd && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              margin: '6px 0',
              padding: '4px 12px',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 600,
              background: days !== null && days <= 0 ? 'var(--red-bg)' : days !== null && days <= 7 ? 'var(--amber-bg)' : 'var(--green-bg)',
              color: days !== null && days <= 0 ? 'var(--red)' : days !== null && days <= 7 ? 'var(--amber)' : 'var(--green)',
            }}>
              ⏱ {days === null ? fmtDate(cd) : days < 0 ? `Consent deadline — ${Math.abs(days)}d overdue` : days === 0 ? 'Consent deadline TODAY' : `Consent deadline — ${days}d`}
            </div>
          )}

          {!isAOAppointment && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
              <div style={{
                width: 32,
                height: 18,
                borderRadius: 9,
                cursor: 'pointer',
                position: 'relative',
                flexShrink: 0,
                background: ao.agreed_surveyor ? 'var(--blue)' : 'var(--border2)',
              }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: ao.agreed_surveyor ? 16 : 2,
                  transition: 'left 0.15s',
                }} />
              </div>

              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                I am the Agreed Surveyor for this AO
              </span>
            </div>
          )}

          {!isAOAppointment && (survName || survFirm) && (
            <div style={{
              margin: '8px 0',
              padding: '10px 12px',
              background: 'var(--bg3)',
              borderRadius: 10,
              border: '1px solid var(--border)',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text3)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 5,
              }}>
                AO Surveyor
              </div>

              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)', lineHeight: 1.5 }}>
                {survName}{survFirm ? ` — ${survFirm}` : ''}
              </div>

              {survEmail && (
                <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 3 }}>
                  {survEmail}
                </div>
              )}

              {survPhone && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  📞 {survPhone}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {!isAOAppointment && !noticed && (
              <button onClick={() => onServeNotice?.(ao)} style={{
                padding: '5px 14px',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: 'var(--blue)',
                color: '#fff',
                border: 'none',
              }}>
                Serve notice
              </button>
            )}

            {!isAOAppointment && noticed && ['Consent', 'Dissent'].map(a => (
              <button key={a} style={{
                padding: '4px 12px',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                border: `1px solid ${a === 'Consent' ? 'var(--green)' : 'var(--red)'}`,
                background: 'transparent',
                color: a === 'Consent' ? 'var(--green)' : 'var(--red)',
              }}>
                {a}
              </button>
            ))}

            {!isAOAppointment && noticed && (
              <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>
                Note intention
              </button>
            )}

            <button className="btn btn-sm btn-ghost" onClick={() => onEditAO?.(ao)} style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>
              Edit
            </button>

            {ao.email ? (
              <button
                className="btn btn-sm btn-ghost"
                style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}
                onClick={() => onOpenComposer?.({ mode: 'compose', to: ao.email, toName: ao.name })}
              >
                📧 Email AO
              </button>
            ) : (
              <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99, opacity: 0.5 }}>
                Add email first
              </button>
            )}

            <button
              className="btn btn-sm btn-ghost"
              disabled={loaLoading}
              onClick={() => onGenerateAOLOA?.(ao)}
              style={{
                cursor: loaLoading ? 'not-allowed' : 'pointer',
                fontSize: 12,
                borderRadius: 99,
                opacity: loaLoading ? 0.65 : 1,
                color: isAOAppointment ? 'var(--purple)' : 'var(--text2)',
              }}
            >
              {loaLoading ? 'Sending…' : isAOAppointment ? '📄 Send AO LoA' : '🔥 Agreed Surveyor LoA'}
            </button>

            {!isAOAppointment && (
              <button style={{
                padding: '4px 12px',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                border: '1px solid var(--purple)',
                background: 'transparent',
                color: 'var(--purple)',
              }}>
                Schedule of Condition
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectChat({ project, onOpenComposer }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const { send, loading } = useEly({ surface: 'project_chat', projectId: project.id });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();

    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);

    try {
      const result = await send(text);
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: result.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ely', content: `Error: ${err.message}` }]);
    }
  }, [input, loading, send]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '60vh', minHeight: 400 }}>
      <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        <button
          className="btn btn-sm btn-ghost"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}
        >
          ✉ Compose email
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            Ask Ely anything about {project.ref}
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
            color: msg.role === 'user' ? '#fff' : 'var(--text)',
            padding: '10px 14px',
            borderRadius: 12,
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {msg.content}
          </div>
        ))}

        {loading && (
          <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>
            ✨ Thinking…
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Ask about ${project.ref}…`}
          rows={2}
          style={{
            flex: 1,
            padding: '9px 12px',
            fontSize: 13,
            resize: 'none',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: 'var(--text)',
            outline: 'none',
          }}
        />

        <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', alignSelf: 'flex-end' }}>
          Send
        </button>
      </div>
    </div>
  );
}

export default function ProjectDetail({ project: initialProject, onBack, onOpenComposer, onRaiseInvoice, onOpenSOC }) {
  const [tab, setTab] = useState('details');
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [loaLoading, setLoaLoading] = useState(null);
  const [noticeModal, setNoticeModal] = useState(null);
  const [s104bAO, setS104bAO] = useState(null);
  const [project, setProject] = useState(initialProject);
  const [showProjectEdit, setShowProjectEdit] = useState(false);
  const [editingAO, setEditingAO] = useState(null);
  const [showAddAO, setShowAddAO] = useState(false);

  const windowWidth = useWindowWidth();

  useEffect(() => {
    setProject(initialProject);
  }, [initialProject]);

  const { sendForSignature } = useDocumentGenerator();

  const role = getRole(project);
  const primaryAO = getPrimaryAO(project);
  const appointmentAddress = getAppointmentAddress(project);
  const appointmentName = getAppointmentName(project);
  const boAddress = project.bo_premise_address || '';
  const bo = project.bo || project.bo_1_name || '';
  const boEmail = project.bo_email || project.bo_1_email || '';
  const works = project.works || '';
  const aos = project.aos || [];
  const docs = project.documents || [];
  const projColour = getProjectColour(project);
  const roleLabel = role === 'AO' ? "Adjoining Owner's Surveyor" : "Building Owner's Surveyor";
  const titleAddress = appointmentAddress || boAddress || 'Address not recorded';

  const stageIndex = project.status === 'complete' ? 4
    : role === 'AO' ? 2
    : aos.some(ao => ['consent', 'dissent', 's10'].includes((ao.status || '').toLowerCase())) ? 2
    : aos.some(ao => aoNotice(ao) || (ao.status || '').toLowerCase() === 'notice_served') ? 1
    : 0;

  const upcoming = [];

  if (role !== 'AO') {
    aos.forEach(ao => {
      const cd = aoConsent(ao);
      if (cd) upcoming.push({ label: `Consent deadline — ${aoAddress(ao) || ao.name}`, date: cd, days: daysUntil(cd) });

      const sd = aoS10(ao);
      if (sd) upcoming.push({ label: `S.10 deadline — ${ao.name}`, date: sd, days: daysUntil(sd) });
    });
  }

  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  useEffect(() => {
    if (tab !== 'emails' || !sb) return;

    setEmailsLoading(true);

    sb.from('emails')
      .select('id,subject,sender_name,sender_email,received_at,is_read,body_preview')
      .eq('project_id', project.id)
      .order('received_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setEmails(data || []);
        setEmailsLoading(false);
      });
  }, [tab, project.id]);

  const handleGenerateBOLOA = useCallback(async () => {
    if (!boEmail) {
      alert('No email for the Building Owner. Please add one first.');
      return;
    }

    setLoaLoading('bo');

    try {
      const r = await sendForSignature({
        templateKey: 'loa_bo',
        mergeData: buildBOLOAPlaceholders(project),
        fileName: buildLOAFileName('bo', project),
        projectId: project.id,
        appointmentType: 'bo_loa',
        signers: [
          { name: bo, email: boEmail },
          ...(project.bo_2_name && project.bo_2_email ? [{ name: project.bo_2_name, email: project.bo_2_email }] : []),
        ],
      });

      r.success ? alert(`LoA sent to ${boEmail} for signature.`) : alert(r.error || 'Could not send LoA.');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoaLoading(null);
    }
  }, [sendForSignature, project, bo, boEmail]);

  const handleGenerateAOLOA = useCallback(async (ao) => {
    const aoEmail = ao.email || ao.surv_email || ao.surveyorEmail;

    if (!aoEmail) {
      alert('No email for this AO. Please add one first.');
      return;
    }

    const aoKey = `ao-${ao.id || ao.num || ao.name || 'unknown'}`;
    setLoaLoading(aoKey);

    try {
      const r = await sendForSignature({
        templateKey: 'loa_ao',
        mergeData: buildAOLOAPlaceholders(project, ao),
        fileName: buildLOAFileName('ao', project, ao),
        projectId: project.id,
        appointmentType: role === 'AO' ? 'ao_loa' : ao.agreed_surveyor ? 'ao_agreed_surveyor_loa' : 'ao_loa',
        signers: [
          { name: ao.name, email: aoEmail },
          ...(ao.name2 && ao.email2 ? [{ name: ao.name2, email: ao.email2 }] : []),
        ],
      });

      r.success ? alert(`LoA sent to ${aoEmail} for signature.`) : alert(r.error || 'Could not send LoA.');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoaLoading(null);
    }
  }, [sendForSignature, project, role]);

  const handleSaveProjectEdit = useCallback(async (form) => {
    const fee = String(form.fee ?? '').trim() === '' ? null : Number(form.fee);
    const svc = form.service || form.premise || null;

    const payload = {
      ref: form.ref || null,
      role: form.role,
      appointment_role: form.role,

      bo_premise_address: form.premise || null,
      bo_service_address: svc,

      bo_1_name: form.bo1?.name || null,
      bo: form.bo1?.name || null,
      bo_1_email: form.bo1?.email || null,
      bo_email: form.bo1?.email || null,
      bo_phone: form.bo1?.phone || null,
      bo_2_name: form.bo2?.name || null,
      bo_2_email: form.bo2?.email || null,

      works: form.works || null,
      fee: Number.isFinite(fee) ? fee : null,
      status: form.status || 'active',
    };

    if (form.role === 'BO') {
      payload.address = payload.bo_premise_address || null;
      payload.appointment_address = payload.bo_premise_address || null;
      payload.appointment_name = payload.bo_1_name || null;
    }

    const data = await updateProjectSafely(project.id, payload);

    setProject(prev => ({
      ...prev,
      ...payload,
      ...(data || {}),
    }));
  }, [project.id]);

  const handleSaveAO = useCallback(async (form, existingAO = null) => {
    const currentAOs = project.aos || [];

    const newAO = {
      ...(existingAO || {}),
      id: existingAO?.id || `ao-${Date.now()}`,
      num: existingAO?.num || currentAOs.length + 1,

      premise: form.premise || '',
      address: form.premise || '',
      reg_addr: form.service || form.premise || '',
      service_address: form.service || form.premise || '',

      name: form.ao1?.name || '',
      email: form.ao1?.email || '',
      phone: form.ao1?.phone || '',

      name2: form.ao2?.name || '',
      email2: form.ao2?.email || '',
      phone2: form.ao2?.phone || '',

      status: existingAO?.status || (role === 'AO' ? 'appointed_ao' : 'details_added'),
      appointed_by_me: existingAO?.appointed_by_me || role === 'AO',

      notice_served_date: existingAO?.notice_served_date || '',
      noticeServedDate: existingAO?.noticeServedDate || '',
      consent_deadline: existingAO?.consent_deadline || '',
      consentDeadline: existingAO?.consentDeadline || '',
      s10_deadline: existingAO?.s10_deadline || '',
      s10Deadline: existingAO?.s10Deadline || '',

      surv_name: form.surv?.name || '',
      surveyorName: form.surv?.name || '',
      surv_firm: form.surv?.firm || '',
      surveyorFirm: form.surv?.firm || '',
      surv_email: form.surv?.email || '',
      surveyorEmail: form.surv?.email || '',
      surv_phone: form.surv?.phone || '',
      surveyorPhone: form.surv?.phone || '',

      third_surveyor_name: form.third?.name || '',
      third_surveyor_firm: form.third?.firm || '',
      third_surveyor_email: form.third?.email || '',
      third_surveyor_phone: form.third?.phone || '',
    };

    const updatedAOs = existingAO
      ? currentAOs.map(a => (a.id && existingAO.id ? a.id === existingAO.id : a.num === existingAO.num) ? newAO : a)
      : [...currentAOs, newAO];

    // Direct update — no select('*') to avoid schema cache errors
    const { error } = await sb.from('projects').update({ aos: updatedAOs }).eq('id', project.id);
    if (error) throw new Error('Could not save AO: ' + error.message);
    setProject(prev => ({ ...prev, aos: updatedAOs }));
  }, [project, role]);


  // ── AO record update (direct — no select('*') to avoid schema cache errors) ──
  const updateAORecord = useCallback(async (ao, patch) => {
    const currentAOs = project.aos || [];
    const updatedAOs = currentAOs.map(item => aoKeyMatches(item, ao)
      ? { ...item, ...patch, updated_at: new Date().toISOString() }
      : item
    );
    const { error } = await sb.from('projects').update({ aos: updatedAOs }).eq('id', project.id);
    if (error) throw error;
    setProject(prev => ({ ...prev, aos: updatedAOs }));
  }, [project.id, project.aos]);

  // ── Create deadline task ──
  const createProjectTask = useCallback(async ({ title, description, due_date, task_type, ao }) => {
    try {
      const aoToken = ao?.id || `AO${ao?.num || ''}`;
      const { data: existing } = await sb.from('tasks').select('id')
        .eq('project_id', project.id).eq('task_type', task_type)
        .eq('due_date', due_date).ilike('description', `%AO_REF:${aoToken}%`).limit(1);
      if (existing?.length) return existing[0];
      const { data, error } = await sb.from('tasks').insert([{
        project_id: project.id,
        title,
        description: `${description || ''}\nAO_REF:${aoToken}`,
        due_date,
        task_type,
        status: 'open',
        priority: 'high',
        project_address_snapshot: aoAddress(ao) || project.bo_premise_address || '',
      }]).select('id').single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('Could not create task:', err?.message || err);
      return null;
    }
  }, [project.id, project.bo_premise_address]);

  // ── Save notice record to DB ──
  const saveNoticeRecord = useCallback(async ({ ao, selectedSections, includeCover, noticeDate }) => {
    const record = {
      project_id: project.id,
      ao_id: ao?.id || String(ao?.num || ''),
      section_1: selectedSections.includes('s1'),
      section_3: selectedSections.includes('s3'),
      section_6: selectedSections.includes('s6'),
      section_10: selectedSections.includes('s10'),
      notice_cover_letter: !!includeCover,
      notice_date: noticeDate,
      status: 'served',
      template_type: selectedSections.includes('s10') ? 's10' : 'notice_pack',
    };
    try { await sb.from('notices').insert([record]); }
    catch (err) { console.warn('notices table insert warn:', err?.message); }
    try {
      const existing = Array.isArray(project.notices) ? project.notices : [];
      const updated = [...existing, { ...record, id: `notice-${Date.now()}`, created_at: new Date().toISOString(), sections: selectedSections }];
      const { error } = await sb.from('projects').update({ notices: updated }).eq('id', project.id);
      if (!error) setProject(prev => ({ ...prev, notices: updated }));
    } catch (err) { console.warn('notices json update warn:', err?.message); }
  }, [project]);

  // ── Notice modal open/serve ──
  const handleOpenNoticeModal = useCallback((ao, defaultSections = []) => {
    setNoticeModal({ ao, defaultSections });
  }, []);

  const handleServeNotice = useCallback((ao) => {
    handleOpenNoticeModal(ao, ['s1', 's3', 's6']);
  }, [handleOpenNoticeModal]);

  const handleServeS10 = useCallback((ao) => {
    handleOpenNoticeModal(ao, ['s10']);
  }, [handleOpenNoticeModal]);

  // ── Generate + download notices ──
  const handleServeNoticePack = useCallback(async ({ ao, sections, includeCover }) => {
    const noticeDate = todayIso();
    const generatedDocs = [];
    const zip = new PizZip();
    const keysToGenerate = [...sections];
    if (includeCover) keysToGenerate.unshift('cover');

    for (const key of keysToGenerate) {
      const mergeData = buildNoticeMergeData({ project, ao, sectionKey: key, includeCover });
      const result = await generateDocument({
        templateKey: key, mergeData, fileName: mergeData.file_name, projectId: project.id,
      });
      if (!result?.success) { console.warn(`Notice template '${key}' not found:`, result?.error); continue; }
      generatedDocs.push({ key, fileName: mergeData.file_name, docx_b64: result.docx_b64 });
      addDocxToZip(zip, mergeData.file_name, result.docx_b64);
    }

    if (generatedDocs.length === 0) {
      alert('No notice templates found. Please check your document templates.');
      return;
    }
    if (generatedDocs.length > 1) {
      const zipB64 = zip.generate({ type: 'base64', compression: 'DEFLATE' });
      const zipName = `${safeFilePart(project.ref || 'Project')}_${safeFilePart(ao?.name || `AO${ao?.num || ''}`)}_Notice_Pack.zip`;
      downloadB64File(zipB64, zipName, 'application/zip');
    } else {
      downloadB64File(generatedDocs[0].docx_b64, generatedDocs[0].fileName,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }

    await saveNoticeRecord({ ao, selectedSections: sections, includeCover, noticeDate });

    const nonS10 = sections.filter(s => ['s1', 's3', 's6'].includes(s));
    if (nonS10.length > 0) {
      const deadline = addDaysIso(14);
      await updateAORecord(ao, {
        status: 'notice_served', notice_served_date: noticeDate, noticeServedDate: noticeDate,
        consent_deadline: deadline, consentDeadline: deadline,
      });
      await createProjectTask({
        title: `Consent deadline — AO${ao.num || ''} ${ao.name || ''}`.trim(),
        description: '14-day notice consent period expired. Review whether Section 10 is required.',
        due_date: deadline, task_type: 'consent_deadline', ao,
      });
    }
    if (sections.includes('s10')) {
      const deadline = addDaysIso(10);
      await updateAORecord(ao, {
        status: 's10', s10_served_date: noticeDate, s10ServedDate: noticeDate,
        s10_deadline: deadline, s10Deadline: deadline,
      });
      await createProjectTask({
        title: `Section 10 deadline — AO${ao.num || ''} ${ao.name || ''}`.trim(),
        description: '10-day Section 10 notice period expired.',
        due_date: deadline, task_type: 'section_10_deadline', ao,
      });
    }
    alert(generatedDocs.length > 1 ? 'Notice pack generated and served.' : 'Notice generated and served.');
  }, [project, generateDocument, saveNoticeRecord, updateAORecord, createProjectTask]);

  // ── Handle 10(4)(b) surveyor save ──
  const handleSave104BSurveyorDetails = useCallback(async ({ surveyor, third }) => {
    if (!s104bAO) return;
    await updateAORecord(s104bAO, {
      surv_name: surveyor.name, surv_firm: surveyor.firm,
      surv_email: surveyor.email, surv_phone: surveyor.phone,
      surveyorName: surveyor.name, surveyorFirm: surveyor.firm,
      surveyorEmail: surveyor.email, surveyorPhone: surveyor.phone,
      third_surveyor_name: third.name, third_surveyor_firm: third.firm,
      third_surveyor_email: third.email, third_surveyor_phone: third.phone,
      status: 's104b', s104b_served_date: new Date().toISOString().slice(0, 10),
    });
    setS104bAO(null);
  }, [s104bAO, updateAORecord]);

  const handleRaiseInvoice = useCallback(() => {
    onRaiseInvoice?.({
      property_address: appointmentAddress || boAddress,
      bill_to_name: appointmentName || bo,
      bill_to_address: role === 'AO' ? aoServiceAddress(primaryAO) : project.bo_address || project.bo_service_address || '',
      role,
      project_id: project.id,
    });
  }, [onRaiseInvoice, project, appointmentAddress, appointmentName, boAddress, bo, role, primaryAO]);


  const handleDeleteProject = useCallback(async () => {
    const confirmed = window.confirm(
      'Delete this project? Emails will be retained but unlinked from the project.'
    );

    if (!confirmed) return;

    try {
      await sb
        .from('emails')
        .update({ project_id: null })
        .eq('project_id', project.id);

      const cleanupTables = [
        'tasks',
        'project_events',
        'ai_sessions',
        'ai_messages',
        'ai_working_context',
        'soc_reports',
        'soc_drafts',
      ];

      for (const table of cleanupTables) {
        try {
          await sb.from(table).delete().eq('project_id', project.id);
        } catch (err) {
          console.warn(`Could not clean ${table}:`, err?.message);
        }
      }

      const { error } = await sb
        .from('projects')
        .delete()
        .eq('id', project.id);

      if (error) throw error;

      onBack?.();
    } catch (err) {
      alert(err.message || 'Could not delete project.');
    }
  }, [project.id, onBack]);


  const TABS = [
    { id: 'details', label: 'Details' },
    { id: 'emails', label: 'Emails' },
    { id: 'documents', label: 'Documents' },
    { id: 'chat', label: '💬 Chat' },
  ];

  return (
    <div style={{ padding: '0 24px 32px' }}>
      {showProjectEdit && (
        <ProjectEditModal
          project={project}
          onSave={handleSaveProjectEdit}
          onClose={() => setShowProjectEdit(false)}
        />
      )}

      {showAddAO && (
        <AOEditModal
          mode="add"
          ao={{}}
          onSave={form => handleSaveAO(form, null)}
          onClose={() => setShowAddAO(false)}
        />
      )}

      {editingAO && (
        <AOEditModal
          mode="edit"
          ao={editingAO}
          onSave={form => handleSaveAO(form, editingAO)}
          onClose={() => setEditingAO(null)}
        />
      )}

      {tab === 'details' && noticeModal && (
        <NoticeServeModal
          project={project}
          ao={noticeModal.ao}
          defaultSections={noticeModal.defaultSections || []}
          onServe={({ sections, includeCover }) => handleServeNoticePack({ ao: noticeModal.ao, sections, includeCover })}
          onClose={() => setNoticeModal(null)}
        />
      )}

      {tab === 'details' && s104bAO && (
        <S104BSurveyorModal
          ao={s104bAO}
          onSave={handleSave104BSurveyorDetails}
          onClose={() => setS104bAO(null)}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 14px' }}>
        <button onClick={onBack} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 16px',
          borderRadius: 99,
          border: '1px solid var(--border)',
          background: 'var(--bg2)',
          color: 'var(--text2)',
          fontSize: 13,
          cursor: 'pointer',
          fontWeight: 500,
        }}>
          ← Back
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowProjectEdit(true)} style={{ cursor: 'pointer', borderRadius: 99 }}>
            Edit
          </button>

          <button
            className="btn btn-sm btn-ghost"
            onClick={handleDeleteProject}
            style={{ cursor: 'pointer', color: 'var(--red)', borderRadius: 99 }}
          >
            Delete
          </button>

          <button style={{
            padding: '6px 14px',
            borderRadius: 99,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            background: 'var(--amber-bg)',
            color: 'var(--amber)',
            border: '1px solid var(--amber)',
          }}>
            🔒 Close project
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 2 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              border: 'none',
              cursor: 'pointer',
              background: 'none',
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
              borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: windowWidth < 768 ? '1fr' : 'minmax(0, 1fr) 300px',
          gap: 18,
          alignItems: 'start',
        }}>
          <div>
            <div style={{ ...card({ padding: '18px 20px', marginBottom: 16 }) }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14, lineHeight: 1.4 }}>
                {project.ref} — {titleAddress}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                    Role
                  </div>
                  <span style={{
                    fontSize: 12.5,
                    padding: '3px 10px',
                    borderRadius: 99,
                    background: role === 'AO' ? 'var(--purple-bg)' : 'var(--blue-bg)',
                    color: role === 'AO' ? 'var(--purple)' : 'var(--blue)',
                    fontWeight: 500,
                  }}>
                    {roleLabel}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                    Status
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: projColour }}>
                    {project.status || 'active'}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                    Building owner
                  </div>

                  <div style={{ fontSize: 13.5, fontWeight: 600, color: bo ? 'var(--text)' : 'var(--text3)' }}>
                    {bo || 'Not yet recorded'}
                  </div>

                  {boEmail && (
                    <div style={{ fontSize: 12.5, color: 'var(--blue)', marginTop: 2 }}>
                      {boEmail}
                    </div>
                  )}

                  {role === 'BO' && (
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={loaLoading === 'bo'}
                      onClick={handleGenerateBOLOA}
                      style={{
                        cursor: loaLoading === 'bo' ? 'not-allowed' : 'pointer',
                        marginTop: 6,
                        fontSize: 12,
                        borderRadius: 99,
                        opacity: loaLoading === 'bo' ? 0.65 : 1,
                      }}
                    >
                      {loaLoading === 'bo' ? 'Sending…' : '📄 Send BO LoA'}
                    </button>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                    BO address
                  </div>
                  <div style={{ fontSize: 13, color: boAddress ? 'var(--text2)' : 'var(--text3)', lineHeight: 1.5 }}>
                    {boAddress || 'Not yet recorded'}
                  </div>
                </div>

                {role === 'AO' && primaryAO && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                      Appointment side
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                      Acting for {primaryAO.name || 'the Adjoining Owner'} at {aoAddress(primaryAO)}
                    </div>
                  </div>
                )}

                {works && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                      Works
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                      {works}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {STAGES.map((s, i) => (
                  <div
                    key={s}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '8px 0',
                      fontSize: 11.5,
                      fontWeight: i === stageIndex ? 600 : 400,
                      background: i === stageIndex ? projColour : i < stageIndex ? `${projColour}33` : 'transparent',
                      color: i === stageIndex ? '#fff' : i < stageIndex ? projColour : 'var(--text3)',
                      borderRight: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  Adjoining owners
                </div>

                <button className="btn btn-sm btn-primary" onClick={() => setShowAddAO(true)} style={{ cursor: 'pointer', borderRadius: 99 }}>
                  + Add AO
                </button>
              </div>

              {aos.length === 0 ? (
                <div style={{ ...card({ padding: '20px', textAlign: 'center' }) }}>
                  <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>
                    No adjoining owners recorded yet.
                  </div>
                </div>
              ) : (
                aos.map((ao, i) => {
                  const aoKey = `ao-${ao.id || ao.num || ao.name || i}`;

                  return (
                    <AOCard
                      key={ao.id || i}
                      ao={ao}
                      projectRole={role}
                      onOpenComposer={onOpenComposer}
                      onGenerateAOLOA={handleGenerateAOLOA}
                      onEditAO={setEditingAO}
                      onServeNotice={() => {}}
                      loaLoading={loaLoading === aoKey}
                    />
                  );
                })
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...card({ padding: '14px 16px' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  📅 Upcoming & tasks
                </div>

                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 11, borderRadius: 99 }}>
                  + Task
                </button>
              </div>

              {upcoming.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
                  No upcoming deadlines.
                </div>
              ) : (
                upcoming.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {fmtDate(u.date)}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        marginTop: 4,
                        flexShrink: 0,
                        background: u.days !== null && u.days <= 3 ? 'var(--red)' : 'var(--blue)',
                      }} />

                      <span style={{ color: 'var(--text2)', lineHeight: 1.4, flex: 1 }}>
                        {u.label}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div
              style={{ ...card({ padding: '14px 16px', cursor: 'pointer' }) }}
              onClick={() => onOpenSOC?.(project)}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--purple)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: 'var(--purple-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}>
                  🎙️
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    SOC Dictation
                  </div>

                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                    Dictate conditions · generate PDF
                  </div>
                </div>

                <span style={{ color: 'var(--text3)', fontSize: 16 }}>›</span>
              </div>
            </div>

            <div style={{ ...card({ padding: '14px 16px' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  Financials
                </div>

                <button onClick={handleRaiseInvoice} style={{
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'var(--amber-bg)',
                  color: 'var(--amber)',
                  border: '1px solid var(--amber)',
                }}>
                  💰 Raise invoice
                </button>
              </div>

              {[
                { label: 'Projected', val: fmtGBP(project.fee), colour: 'var(--text)' },
                { label: 'Invoiced', val: fmtGBP(project.fee_invoiced), colour: parseFloat(project.fee_invoiced) > 0 ? 'var(--blue)' : 'var(--red)' },
                { label: 'Paid', val: fmtGBP(project.fee_paid), colour: parseFloat(project.fee_paid) > 0 ? 'var(--green)' : 'var(--text3)' },
                { label: 'Outstanding', val: fmtGBP((parseFloat(project.fee_invoiced) || 0) - (parseFloat(project.fee_paid) || 0)), colour: 'var(--amber)' },
              ].map(({ label, val, colour }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text2)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: colour }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }} onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>
              + Compose
            </button>
          </div>

          <div style={{ ...card() }}>
            {emailsLoading ? (
              <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>
                Loading emails…
              </div>
            ) : emails.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                No emails linked to this project.
              </div>
            ) : (
              emails.map((e, i) => (
                <div key={e.id} style={{
                  padding: '12px 16px',
                  borderBottom: i < emails.length - 1 ? '1px solid var(--border)' : 'none',
                  background: e.is_read ? 'transparent' : 'var(--blue-bg)',
                  cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: e.is_read ? 400 : 600, color: 'var(--text)' }}>
                      {e.sender_name || e.sender_email}
                    </span>

                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                    </span>
                  </div>

                  <div style={{ fontSize: 12.5, fontWeight: e.is_read ? 400 : 600, color: 'var(--text2)', marginBottom: 2 }}>
                    {e.subject}
                  </div>

                  <div style={{
                    fontSize: 12,
                    color: 'var(--text3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {e.body_preview}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>
              + Upload
            </button>
          </div>

          {/* BO documents */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10, padding: '6px 0', borderBottom: '2px solid var(--border)' }}>
              📁 Building Owner — {project.bo_1_name || project.bo || 'BO'}
            </div>
            <div style={{ ...card() }}>
              {docs.filter(d => !d.ao_id && !d.ao_num).length === 0 ? (
                <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                  No documents for the Building Owner.
                </div>
              ) : docs.filter(d => !d.ao_id && !d.ao_num).map((d, i, arr) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>📄 {d.file_name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{d.category || 'document'} · {fmtDate(d.created_at)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Preview</button>
                    <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>DOCX</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-AO documents */}
          {aos.map((ao, aoIdx) => {
            const aoDocs = docs.filter(d => d.ao_id === ao.id || String(d.ao_num) === String(ao.num));
            return (
              <div key={ao.id || aoIdx} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: getAOColour(ao, role), marginBottom: 10, padding: '6px 0', borderBottom: '2px solid var(--border)' }}>
                  📁 AO{ao.num} — {ao.name || aoAddress(ao) || 'Adjoining Owner'}
                </div>
                <div style={{ ...card() }}>
                  {aoDocs.length === 0 ? (
                    <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                      No documents for this AO.
                    </div>
                  ) : aoDocs.map((d, i, arr) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>📄 {d.file_name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{d.category || 'document'} · {fmtDate(d.created_at)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Preview</button>
                        <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>DOCX</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'chat' && <ProjectChat project={project} onOpenComposer={onOpenComposer} />}
    </div>
  );
}
