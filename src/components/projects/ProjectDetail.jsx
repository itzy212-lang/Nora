import { useState, useEffect, useRef, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import useDocumentGenerator from '../../hooks/useDocumentGenerator';
import {
  buildBOLOAPlaceholders,
  buildAOLOAPlaceholders,
  buildLOAFileName
} from '../../utils/buildLOAPlaceholders';
import sb from '../../supabaseClient';

const aoAddress   = ao => ao.premise   || ao.reg_addr   || ao.address || '';
const aoSurvName  = ao => ao.surv_name  || ao.surveyorName  || '';
const aoSurvFirm  = ao => ao.surv_firm  || ao.surveyorFirm  || '';
const aoSurvEmail = ao => ao.surv_email || ao.surveyorEmail || '';
const aoSurvPhone = ao => ao.surv_phone || ao.surveyorPhone || '';
const aoConsent   = ao => ao.consent_deadline  || ao.consentDeadline  || '';
const aoNotice    = ao => ao.notice_served_date || ao.noticeServedDate || '';
const aoS10       = ao => ao.s10_deadline       || ao.s10Deadline      || '';
const aoName2     = ao => ao.name2 || '';

const STAGES = ['Notice served', 'Consent', 'Appt made', 'Award', 'Complete'];

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function fmtGBP(v) {
  return `£${(parseFloat(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

function getAOColour(ao) {
  const st = (ao.status || '').toLowerCase();
  if (st === 'consent') return '#22c55e';
  if (st === 'dissent' || st === 's10') return '#ef4444';
  const cd = aoConsent(ao);
  const sd = aoS10(ao);
  const now = Date.now();
  if ((cd && new Date(cd).getTime() < now) || (sd && new Date(sd).getTime() < now)) return '#ef4444';
  if (cd || aoNotice(ao) || st === 'notice_served' || st === 'details_added') return '#22c55e';
  if (aoAddress(ao)) return '#a855f7';
  return '#9ca3af';
}

function getProjectColour(project) {
  const aos = project.aos || [];
  if (!aos.length) return '#9ca3af';
  const now = Date.now();
  const hasOverdue = aos.some(ao => {
    const cd = aoConsent(ao); const sd = aoS10(ao); const st = (ao.status || '').toLowerCase();
    return (cd && new Date(cd).getTime() < now && !['consent','dissent'].includes(st)) || (sd && new Date(sd).getTime() < now);
  });
  if (hasOverdue) return '#ef4444';
  if (aos.some(ao => aoNotice(ao) || aoConsent(ao) || (ao.status||'').toLowerCase() === 'notice_served')) return '#22c55e';
  if (aos.some(ao => aoAddress(ao))) return '#a855f7';
  return '#9ca3af';
}

const card = (extra = {}) => ({ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, ...extra });

const modalInput = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 13.5,
  background: '#fff',
  border: '1px solid #dfe3ea',
  borderRadius: 12,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const modalSection = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 16,
};

function ModalShell({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={{ width: 760, maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto', background: '#eef1f5', border: '1px solid #d8dde6', borderRadius: 22, boxShadow: '0 24px 70px rgba(15, 23, 42, 0.35)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#eef1f5', padding: '18px 22px 12px', borderBottom: '1px solid #d8dde6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4, marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}

function ProjectEditModal({ project, onSave, onClose }) {
  const initialPremise = project.bo_premise_address || project.address || '';
  const initialService = project.bo_service_address || project.bo_1_service_address || project.bo_address || initialPremise;
  const [sameAddress, setSameAddress] = useState(!initialService || initialService === initialPremise);
  const [form, setForm] = useState({
    role: project.role || project.surveyor_role || 'BO',
    bo_premise_address: initialPremise,
    bo_service_address: initialService,
    bo_1_name: project.bo_1_name || project.bo || '',
    bo_1_email: project.bo_1_email || project.bo_email || '',
    bo_1_phone: project.bo_1_phone || project.bo_phone || '',
    bo_2_name: project.bo_2_name || '',
    bo_2_email: project.bo_2_email || '',
    bo_2_phone: project.bo_2_phone || '',
    ref: project.ref || '',
    status: project.status || 'active',
    works: project.works || '',
    fee: project.fee ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setPremise = value => {
    setForm(f => ({ ...f, bo_premise_address: value, bo_service_address: sameAddress ? value : f.bo_service_address }));
  };

  const toggleSame = checked => {
    setSameAddress(checked);
    if (checked) set('bo_service_address', form.bo_premise_address);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, bo_service_address: sameAddress ? form.bo_premise_address : form.bo_service_address });
      onClose();
    } catch (err) {
      alert(err.message || 'Could not save project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit project" onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 8 }}>Your role on this project</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { value: 'BO', title: 'Building Owner Surveyor', sub: 'Acting for the BO' },
              { value: 'AO', title: 'Adjoining Owner Surveyor', sub: 'Acting for the AO' },
            ].map(opt => (
              <button key={opt.value} onClick={() => set('role', opt.value)} style={{ textAlign: 'left', padding: '13px 15px', borderRadius: 14, border: form.role === opt.value ? '1px solid var(--blue)' : '1px solid #e5e7eb', background: form.role === opt.value ? 'var(--blue-bg)' : '#fff', cursor: 'pointer' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>● {opt.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Premise and service address</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Premise address" hint="The property where the works are taking place.">
              <textarea rows={2} value={form.bo_premise_address} onChange={e => setPremise(e.target.value)} style={{ ...modalInput, resize: 'vertical' }} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sameAddress} onChange={e => toggleSame(e.target.checked)} />
              Service address is the same as the premise address
            </label>
            {!sameAddress && (
              <Field label="Service / correspondence address" hint="Use this only if correspondence should go somewhere else, for example a different home address, company registered office, or managing agent address.">
                <textarea rows={2} value={form.bo_service_address} onChange={e => set('bo_service_address', e.target.value)} style={{ ...modalInput, resize: 'vertical' }} />
              </Field>
            )}
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Building owner details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 10 }}>Owner 1</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Full name"><input value={form.bo_1_name} onChange={e => set('bo_1_name', e.target.value)} style={modalInput} /></Field>
                <Field label="Email"><input value={form.bo_1_email} onChange={e => set('bo_1_email', e.target.value)} style={modalInput} /></Field>
                <Field label="Phone"><input value={form.bo_1_phone} onChange={e => set('bo_1_phone', e.target.value)} style={modalInput} /></Field>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 10 }}>Owner 2 optional</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Full name"><input value={form.bo_2_name} onChange={e => set('bo_2_name', e.target.value)} style={modalInput} /></Field>
                <Field label="Email"><input value={form.bo_2_email} onChange={e => set('bo_2_email', e.target.value)} style={modalInput} /></Field>
                <Field label="Phone"><input value={form.bo_2_phone} onChange={e => set('bo_2_phone', e.target.value)} style={modalInput} /></Field>
              </div>
            </div>
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Project details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Reference"><input value={form.ref} onChange={e => set('ref', e.target.value)} style={modalInput} /></Field>
            <Field label="Status"><select value={form.status} onChange={e => set('status', e.target.value)} style={modalInput}><option value="active">Active</option><option value="complete">Complete</option><option value="on_hold">On hold</option><option value="dispute">Dispute</option></select></Field>
            <div style={{ gridColumn: '1 / -1' }}><Field label="Works description"><textarea rows={3} value={form.works} onChange={e => set('works', e.target.value)} style={{ ...modalInput, resize: 'vertical' }} /></Field></div>
            <Field label="Projected fee"><input value={form.fee} onChange={e => set('fee', e.target.value)} style={modalInput} /></Field>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 2 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

function AOEditModal({ ao, mode, onSave, onClose }) {
  const isNew = mode === 'add';
  const initialPremise = aoAddress(ao || {});
  const initialService = (ao && (ao.service_address || ao.serviceAddress || ao.reg_addr)) || initialPremise;
  const [sameAddress, setSameAddress] = useState(!initialService || initialService === initialPremise);
  const [form, setForm] = useState({
    premise: initialPremise,
    service_address: initialService,
    name: ao?.name || '',
    email: ao?.email || '',
    phone: ao?.phone || '',
    name2: ao?.name2 || '',
    email2: ao?.email2 || '',
    phone2: ao?.phone2 || '',
    status: ao?.status || 'details_added',
    consent_deadline: aoConsent(ao || {}),
    notice_served_date: aoNotice(ao || {}),
    s10_deadline: aoS10(ao || {}),
    surv_name: aoSurvName(ao || {}),
    surv_firm: aoSurvFirm(ao || {}),
    surv_email: aoSurvEmail(ao || {}),
    surv_phone: aoSurvPhone(ao || {}),
    third_surveyor_name: ao?.third_surveyor_name || ao?.thirdSurveyorName || '',
    third_surveyor_firm: ao?.third_surveyor_firm || ao?.thirdSurveyorFirm || '',
    third_surveyor_email: ao?.third_surveyor_email || ao?.thirdSurveyorEmail || '',
    third_surveyor_phone: ao?.third_surveyor_phone || ao?.thirdSurveyorPhone || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setPremise = value => setForm(f => ({ ...f, premise: value, service_address: sameAddress ? value : f.service_address }));
  const toggleSame = checked => {
    setSameAddress(checked);
    if (checked) set('service_address', form.premise);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, service_address: sameAddress ? form.premise : form.service_address });
      onClose();
    } catch (err) {
      alert(err.message || 'Could not save AO.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={isNew ? 'Add adjoining owner' : 'Edit adjoining owner'} onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Premise and service address</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Premise address" hint="The adjoining property relevant to the party wall matter.">
              <textarea rows={2} value={form.premise} onChange={e => setPremise(e.target.value)} style={{ ...modalInput, resize: 'vertical' }} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sameAddress} onChange={e => toggleSame(e.target.checked)} />
              Service address is the same as the premise address
            </label>
            {!sameAddress && (
              <Field label="Service / correspondence address" hint="Use this only if the adjoining owner should be served or contacted at a different address.">
                <textarea rows={2} value={form.service_address} onChange={e => set('service_address', e.target.value)} style={{ ...modalInput, resize: 'vertical' }} />
              </Field>
            )}
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Adjoining owner details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 10 }}>Owner 1</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Full name"><input value={form.name} onChange={e => set('name', e.target.value)} style={modalInput} /></Field>
                <Field label="Email"><input value={form.email} onChange={e => set('email', e.target.value)} style={modalInput} /></Field>
                <Field label="Phone"><input value={form.phone} onChange={e => set('phone', e.target.value)} style={modalInput} /></Field>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #eef1f5', borderRadius: 16, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 10 }}>Owner 2 optional</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Full name"><input value={form.name2} onChange={e => set('name2', e.target.value)} style={modalInput} /></Field>
                <Field label="Email"><input value={form.email2} onChange={e => set('email2', e.target.value)} style={modalInput} /></Field>
                <Field label="Phone"><input value={form.phone2} onChange={e => set('phone2', e.target.value)} style={modalInput} /></Field>
              </div>
            </div>
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Notice and status</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Status"><select value={form.status} onChange={e => set('status', e.target.value)} style={modalInput}><option value="details_added">Details added</option><option value="notice_served">Notice served</option><option value="consent">Consent</option><option value="dissent">Dissent</option><option value="s10">S.10</option></select></Field>
            <Field label="Notice served date"><input type="date" value={form.notice_served_date || ''} onChange={e => set('notice_served_date', e.target.value)} style={modalInput} /></Field>
            <Field label="Consent deadline"><input type="date" value={form.consent_deadline || ''} onChange={e => set('consent_deadline', e.target.value)} style={modalInput} /></Field>
            <Field label="S.10 deadline"><input type="date" value={form.s10_deadline || ''} onChange={e => set('s10_deadline', e.target.value)} style={modalInput} /></Field>
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>AO surveyor details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Surveyor name"><input value={form.surv_name} onChange={e => set('surv_name', e.target.value)} style={modalInput} /></Field>
            <Field label="Firm"><input value={form.surv_firm} onChange={e => set('surv_firm', e.target.value)} style={modalInput} /></Field>
            <Field label="Email"><input value={form.surv_email} onChange={e => set('surv_email', e.target.value)} style={modalInput} /></Field>
            <Field label="Phone"><input value={form.surv_phone} onChange={e => set('surv_phone', e.target.value)} style={modalInput} /></Field>
          </div>
        </div>

        <div style={modalSection}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Third surveyor details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Third surveyor name"><input value={form.third_surveyor_name} onChange={e => set('third_surveyor_name', e.target.value)} style={modalInput} /></Field>
            <Field label="Firm"><input value={form.third_surveyor_firm} onChange={e => set('third_surveyor_firm', e.target.value)} style={modalInput} /></Field>
            <Field label="Email"><input value={form.third_surveyor_email} onChange={e => set('third_surveyor_email', e.target.value)} style={modalInput} /></Field>
            <Field label="Phone"><input value={form.third_surveyor_phone} onChange={e => set('third_surveyor_phone', e.target.value)} style={modalInput} /></Field>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 2 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </ModalShell>
  );
}


function AOCard({ ao, onOpenComposer, onGenerateAOLOA, onEditAO, loaLoading }) {
  const colour    = getAOColour(ao);
  const address   = aoAddress(ao);
  const cd        = aoConsent(ao);
  const days      = daysUntil(cd);
  const survName  = aoSurvName(ao);
  const survFirm  = aoSurvFirm(ao);
  const survEmail = aoSurvEmail(ao);
  const survPhone = aoSurvPhone(ao);
  const statusLabel = { consent: 'Consented', dissent: 'Dissented', s10: 'S.10', notice_served: 'Notice served', details_added: 'Details added' }[(ao.status || '').toLowerCase()] || '';

  return (
    <div style={{ ...card({ marginBottom: 12, overflow: 'hidden' }) }}>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 5, background: colour, borderRadius: '16px 0 0 16px', flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colour }}>AO{ao.num} — {(ao.name || '').toUpperCase()}</div>
              {aoName2(ao) && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{aoName2(ao)}</div>}
            </div>
            {statusLabel && <span style={{ fontSize: 12, fontWeight: 600, color: colour, paddingLeft: 8 }}>{statusLabel}</span>}
          </div>

          {address && <div style={{ fontSize: 13, color: 'var(--blue)', marginBottom: 4, lineHeight: 1.4 }}>{address}</div>}
          {ao.phone && <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 6 }}>📞 {ao.phone}</div>}

          {cd && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, margin: '6px 0',
              padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
              background: days !== null && days < 0 ? 'var(--red-bg)' : days !== null && days <= 7 ? 'var(--amber-bg)' : 'var(--green-bg)',
              color: days !== null && days < 0 ? 'var(--red)' : days !== null && days <= 7 ? 'var(--amber)' : 'var(--green)',
            }}>
              ⏱ {days === null ? fmtDate(cd) : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d to consent deadline`}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
            <div style={{ width: 32, height: 18, borderRadius: 9, cursor: 'pointer', position: 'relative', flexShrink: 0, background: ao.agreed_surveyor ? 'var(--blue)' : 'var(--border2)' }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: ao.agreed_surveyor ? 16 : 2, transition: 'left 0.15s' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>I am the Agreed Surveyor for this AO</span>
          </div>

          {(survName || survFirm) && (
            <div style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>AO Surveyor</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)', lineHeight: 1.5 }}>{survName}{survFirm ? ` — ${survFirm}` : ''}</div>
              {survEmail && <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 3 }}>{survEmail}</div>}
              {survPhone && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>📞 {survPhone}</div>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {['Consent', 'Dissent'].map(a => (
              <button key={a} style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: `1px solid ${a === 'Consent' ? 'var(--green)' : 'var(--red)'}`, background: 'transparent', color: a === 'Consent' ? 'var(--green)' : 'var(--red)' }}>{a}</button>
            ))}
            <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>Note intention</button>
            <button style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--purple)', background: 'transparent', color: 'var(--purple)' }}>Schedule of Condition</button>
            <button className="btn btn-sm btn-ghost" onClick={() => onEditAO?.(ao)} style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }}>Edit</button>
            {ao.email
              ? <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99 }} onClick={() => onOpenComposer?.({ mode: 'compose', to: ao.email, toName: ao.name })}>📧 Email AO</button>
              : <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 99, opacity: 0.5 }}>✉ Add email first</button>
            }
            <button
              className="btn btn-sm btn-ghost"
              disabled={loaLoading}
              onClick={() => onGenerateAOLOA?.(ao)}
              style={{ cursor: loaLoading ? 'not-allowed' : 'pointer', fontSize: 12, borderRadius: 99, opacity: loaLoading ? 0.65 : 1 }}
            >
              {loaLoading ? 'Sending…' : 'Agreed Surveyor LoA'}
            </button>
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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
        <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }} onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>✉ Compose email</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            Ask Ely anything about {project.ref}
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)', color: msg.role === 'user' ? '#fff' : 'var(--text)', padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {msg.content}
          </div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>✨ Thinking…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}} placeholder={`Ask about ${project.ref}…`} rows={2}
          style={{ flex: 1, padding: '9px 12px', fontSize: 13, resize: 'none', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', outline: 'none' }} />
        <button onClick={handleSend} disabled={loading || !input.trim()} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', alignSelf: 'flex-end' }}>Send</button>
      </div>
    </div>
  );
}

export default function ProjectDetail({ project: initialProject, onBack, onOpenComposer, onRaiseInvoice, onOpenSOC }) {
  const [tab, setTab] = useState('details');
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [loaLoading, setLoaLoading] = useState(null);
  const [project, setProject] = useState(initialProject);
  const [showProjectEdit, setShowProjectEdit] = useState(false);
  const [editingAO, setEditingAO] = useState(null);
  const [showAddAO, setShowAddAO] = useState(false);

  useEffect(() => { setProject(initialProject); }, [initialProject]);

  const { generateDocument, sendForSignature } = useDocumentGenerator();

  const address    = project.address  || project.bo_premise_address || '';
  const bo         = project.bo       || project.bo_1_name || '';
  const boEmail    = project.bo_email || project.bo_1_email || '';
  const works      = project.works    || '';
  const aos        = project.aos      || [];
  const docs       = project.documents || [];
  const projColour = getProjectColour(project);

  const roleLabel = (() => {
    const r = (project.role || project.surveyor_role || 'BO').toUpperCase();
    if (r === 'AO') return "Adjoining Owner's Surveyor";
    if (r === 'AS' || r === 'AGREED') return 'Agreed Surveyor';
    return "Building Owner's Surveyor";
  })();

  const stageIndex = project.status === 'complete' ? 4
    : aos.some(ao => ['consent','dissent','s10'].includes((ao.status||'').toLowerCase())) ? 2
    : aos.some(ao => aoNotice(ao) || (ao.status||'').toLowerCase() === 'notice_served') ? 1
    : 0;

  const upcoming = [];
  aos.forEach(ao => {
    const cd = aoConsent(ao);
    if (cd) upcoming.push({ label: `Consent deadline — ${aoAddress(ao) || ao.name}`, date: cd, days: daysUntil(cd) });
    const sd = aoS10(ao);
    if (sd) upcoming.push({ label: `S.10 deadline — ${ao.name}`, date: sd, days: daysUntil(sd) });
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  useEffect(() => {
    if (tab !== 'emails' || !sb) return;
    setEmailsLoading(true);
    sb.from('emails').select('id,subject,sender_name,sender_email,received_at,is_read,body_preview')
      .eq('project_id', project.id).order('received_at', { ascending: false }).limit(50)
      .then(({ data }) => { setEmails(data || []); setEmailsLoading(false); });
  }, [tab, project.id]);

  // ── BO LoA — send for signature ────────────────────────────
  const handleGenerateBOLOA = useCallback(async () => {
    if (!boEmail) {
      alert('No email address saved for the Building Owner. Please add one first.');
      return;
    }
    setLoaLoading('bo');
    try {
      const mergeData = buildBOLOAPlaceholders(project);
      const fileName  = buildLOAFileName('bo', project);
      const result    = await sendForSignature({
        templateKey:     'loa_bo',
        mergeData,
        fileName,
        projectId:       project.id,
        appointmentType: 'bo_loa',
        signers: [
          { name: bo, email: boEmail },
          ...(project.bo_2_name && project.bo_2_email
            ? [{ name: project.bo_2_name, email: project.bo_2_email }]
            : []),
        ],
      });
      if (result.success) {
        alert(`LoA sent to ${boEmail} for signature.`);
      } else {
        alert(result.error || 'Could not send LoA.');
      }
    } catch (err) {
      alert(err.message || 'Could not send LoA.');
    } finally {
      setLoaLoading(null);
    }
  }, [sendForSignature, project, bo, boEmail]);

  // ── AO LoA — send for signature ────────────────────────────
  const handleGenerateAOLOA = useCallback(async (ao) => {
    const aoEmail = ao.email || ao.surv_email || ao.surveyorEmail;
    if (!aoEmail) {
      alert('No email address saved for this AO. Please add one first.');
      return;
    }
    const aoKey = `ao-${ao.id || ao.num || ao.name || 'unknown'}`;
    setLoaLoading(aoKey);
    try {
      const mergeData = buildAOLOAPlaceholders(project, ao);
      const fileName  = buildLOAFileName('ao', project, ao);
      const isAgreed  = !!ao.agreed_surveyor;
      const result    = await sendForSignature({
        templateKey:     'loa_ao',
        mergeData,
        fileName,
        projectId:       project.id,
        appointmentType: isAgreed ? 'ao_agreed_surveyor_loa' : 'ao_loa',
        signers: [
          { name: ao.name, email: aoEmail },
          ...(ao.name2 && ao.email2 ? [{ name: ao.name2, email: ao.email2 }] : []),
        ],
      });
      if (result.success) {
        alert(`LoA sent to ${aoEmail} for signature.`);
      } else {
        alert(result.error || 'Could not send LoA.');
      }
    } catch (err) {
      alert(err.message || 'Could not send LoA.');
    } finally {
      setLoaLoading(null);
    }
  }, [sendForSignature, project]);


  const handleSaveProjectEdit = useCallback(async (form) => {
    const feeValue = String(form.fee ?? '').trim() === '' ? null : Number(form.fee);
    const payload = {
      ref: form.ref || null,
      role: form.role || 'BO',
      surveyor_role: form.role || 'BO',
      bo_premise_address: form.bo_premise_address || null,
      address: form.bo_premise_address || null,
      bo_service_address: form.bo_service_address || form.bo_premise_address || null,
      bo_1_service_address: form.bo_service_address || form.bo_premise_address || null,
      bo_1_name: form.bo_1_name || null,
      bo: form.bo_1_name || null,
      bo_1_email: form.bo_1_email || null,
      bo_email: form.bo_1_email || null,
      bo_1_phone: form.bo_1_phone || null,
      bo_phone: form.bo_1_phone || null,
      bo_2_name: form.bo_2_name || null,
      bo_2_email: form.bo_2_email || null,
      bo_2_phone: form.bo_2_phone || null,
      works: form.works || null,
      fee: Number.isFinite(feeValue) ? feeValue : null,
      status: form.status || 'active',
    };

    const { data, error } = await sb
      .from('projects')
      .update(payload)
      .eq('id', project.id)
      .select('*')
      .single();

    if (error) throw new Error('Could not save project: ' + error.message);
    setProject(prev => ({ ...prev, ...payload, ...(data || {}) }));
  }, [project.id]);

  const handleSaveAO = useCallback(async (form, existingAO = null) => {
    const currentAOs = project.aos || [];
    const newAO = {
      ...(existingAO || {}),
      id: existingAO?.id || `ao-${Date.now()}`,
      num: existingAO?.num || currentAOs.length + 1,
      premise: form.premise || '',
      address: form.premise || '',
      reg_addr: form.service_address || form.premise || '',
      service_address: form.service_address || form.premise || '',
      name: form.name || '',
      email: form.email || '',
      phone: form.phone || '',
      name2: form.name2 || '',
      email2: form.email2 || '',
      phone2: form.phone2 || '',
      status: form.status || 'details_added',
      notice_served_date: form.notice_served_date || '',
      noticeServedDate: form.notice_served_date || '',
      consent_deadline: form.consent_deadline || '',
      consentDeadline: form.consent_deadline || '',
      s10_deadline: form.s10_deadline || '',
      s10Deadline: form.s10_deadline || '',
      surv_name: form.surv_name || '',
      surveyorName: form.surv_name || '',
      surv_firm: form.surv_firm || '',
      surveyorFirm: form.surv_firm || '',
      surv_email: form.surv_email || '',
      surveyorEmail: form.surv_email || '',
      surv_phone: form.surv_phone || '',
      surveyorPhone: form.surv_phone || '',
      third_surveyor_name: form.third_surveyor_name || '',
      third_surveyor_firm: form.third_surveyor_firm || '',
      third_surveyor_email: form.third_surveyor_email || '',
      third_surveyor_phone: form.third_surveyor_phone || '',
    };

    const updatedAOs = existingAO
      ? currentAOs.map(a => (a.id && existingAO.id ? a.id === existingAO.id : a.num === existingAO.num) ? newAO : a)
      : [...currentAOs, newAO];

    const { data, error } = await sb
      .from('projects')
      .update({ aos: updatedAOs })
      .eq('id', project.id)
      .select('*')
      .single();

    if (error) throw new Error('Could not save adjoining owner: ' + error.message);
    setProject(prev => ({ ...prev, aos: updatedAOs, ...(data || {}) }));
  }, [project]);

  const handleRaiseInvoice = useCallback(() => {
    if (onRaiseInvoice) {
      onRaiseInvoice({ property_address: address, bill_to_name: bo, bill_to_address: project.bo_address || '', role: (project.role || 'BO').toUpperCase() === 'AO' ? 'AO' : 'BO', project_id: project.id });
    }
  }, [onRaiseInvoice, project, address, bo]);

  const handleOpenSOC = useCallback(() => { onOpenSOC?.(project); }, [onOpenSOC, project]);

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
          onSave={(form) => handleSaveAO(form, null)}
          onClose={() => setShowAddAO(false)}
        />
      )}
      {editingAO && (
        <AOEditModal
          mode="edit"
          ao={editingAO}
          onSave={(form) => handleSaveAO(form, editingAO)}
          onClose={() => setEditingAO(null)}
        />
      )}
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 14px' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 99, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowProjectEdit(true)} style={{ cursor: 'pointer', borderRadius: 99 }}>Edit</button>
          <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', color: 'var(--red)', borderRadius: 99 }}>Delete</button>
          <button style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>🔒 Close project</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 2 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 18px', fontSize: 13, border: 'none', cursor: 'pointer', background: 'none', fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--blue)' : 'var(--text2)', borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent', marginBottom: -1 }}>{t.label}</button>
        ))}
      </div>

      {/* DETAILS */}
      {tab === 'details' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
          <div>
            <div style={{ ...card({ padding: '18px 20px', marginBottom: 16 }) }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14, lineHeight: 1.4 }}>{project.ref} — {bo} — {address}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Role</div>
                  <span style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 99, background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 500 }}>{roleLabel}</span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Status</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: projColour }}>{project.status || 'active'}</span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Building owner</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{bo}</div>
                  {boEmail && <div style={{ fontSize: 12.5, color: 'var(--blue)', marginTop: 2 }}>{boEmail}</div>}
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={loaLoading === 'bo'}
                    onClick={handleGenerateBOLOA}
                    style={{ cursor: loaLoading === 'bo' ? 'not-allowed' : 'pointer', marginTop: 6, fontSize: 12, borderRadius: 99, opacity: loaLoading === 'bo' ? 0.65 : 1 }}
                  >
                    {loaLoading === 'bo' ? 'Sending…' : '📄 Send BO LoA'}
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Address</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{address}</div>
                </div>
                {works && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Works</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)' }}>{works}</div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {STAGES.map((s, i) => (
                  <div key={s} style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 11.5, fontWeight: i === stageIndex ? 600 : 400, background: i === stageIndex ? projColour : i < stageIndex ? `${projColour}33` : 'transparent', color: i === stageIndex ? '#fff' : i < stageIndex ? projColour : 'var(--text3)', borderRight: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none' }}>{s}</div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Adjoining owners</div>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddAO(true)} style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add AO</button>
              </div>
              {aos.length === 0
                ? <div style={{ ...card({ padding: '20px', textAlign: 'center' }) }}><div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>No adjoining owners recorded yet.</div></div>
                : aos.map((ao, i) => {
                  const aoKey = `ao-${ao.id || ao.num || ao.name || i}`;
                  return (
                    <AOCard key={ao.id || i} ao={ao} onOpenComposer={onOpenComposer} onGenerateAOLOA={handleGenerateAOLOA} onEditAO={setEditingAO} loaLoading={loaLoading === aoKey} />
                  );
                })
              }
            </div>
          </div>

          {/* Right sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...card({ padding: '14px 16px' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>📅 Upcoming & tasks</div>
                <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', fontSize: 11, borderRadius: 99 }}>+ Task</button>
              </div>
              {upcoming.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No upcoming deadlines.</div>
                : upcoming.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{fmtDate(u.date)}</div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: u.days !== null && u.days <= 3 ? 'var(--red)' : 'var(--blue)' }} />
                      <span style={{ color: 'var(--text2)', lineHeight: 1.4, flex: 1 }}>{u.label}</span>
                    </div>
                  </div>
                ))
              }
            </div>

            <div style={{ ...card({ padding: '14px 16px', cursor: 'pointer' }) }} onClick={handleOpenSOC} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--purple-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎙️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>SOC Dictation</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>Dictate conditions · generate PDF</div>
                </div>
                <span style={{ color: 'var(--text3)', fontSize: 16 }}>›</span>
              </div>
            </div>

            <div style={{ ...card({ padding: '14px 16px' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Financials</div>
                <button onClick={handleRaiseInvoice} style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>💰 Raise invoice</button>
              </div>
              {[
                { label: 'Projected',   val: fmtGBP(project.fee),         colour: 'var(--text)' },
                { label: 'Invoiced',    val: fmtGBP(project.fee_invoiced), colour: parseFloat(project.fee_invoiced) > 0 ? 'var(--blue)' : 'var(--red)' },
                { label: 'Paid',        val: fmtGBP(project.fee_paid),     colour: parseFloat(project.fee_paid) > 0 ? 'var(--green)' : 'var(--text3)' },
                { label: 'Outstanding', val: fmtGBP((parseFloat(project.fee_invoiced)||0) - (parseFloat(project.fee_paid)||0)), colour: 'var(--amber)' },
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

      {/* EMAILS */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }} onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}>+ Compose</button>
          </div>
          <div style={{ ...card() }}>
            {emailsLoading
              ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading emails…</div>
              : emails.length === 0
                ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No emails linked to this project.</div>
                : emails.map((e, i) => (
                  <div key={e.id} style={{ padding: '12px 16px', borderBottom: i < emails.length - 1 ? '1px solid var(--border)' : 'none', background: e.is_read ? 'transparent' : 'var(--blue-bg)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: e.is_read ? 400 : 600, color: 'var(--text)' }}>{e.sender_name || e.sender_email}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: e.is_read ? 400 : 600, color: 'var(--text2)', marginBottom: 2 }}>{e.subject}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.body_preview}</div>
                  </div>
                ))
            }
          </div>
        </div>
      )}

      {/* DOCUMENTS */}
      {tab === 'documents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Upload</button>
          </div>
          <div style={{ ...card() }}>
            {docs.length === 0
              ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No documents uploaded yet.</div>
              : docs.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < docs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>📄 {d.file_name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{fmtDate(d.created_at)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Preview</button>
                    <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }}>DOCX</button>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* CHAT */}
      {tab === 'chat' && <ProjectChat project={project} onOpenComposer={onOpenComposer} />}
    </div>
  );
}
