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
  background: '#f8fafc',
  border: '1px solid #dde3ea',
  borderRadius: 12,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
};

function ModalShell({ title, children, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 500,
      background: 'rgba(15, 23, 42, 0.48)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: 760,
        maxWidth: 'calc(100vw - 40px)',
        maxHeight: '88vh',
        overflowY: 'auto',
        background: '#eef1f5',
        border: '1px solid #d9dee7',
        borderRadius: 18,
        boxShadow: '0 22px 55px rgba(15, 23, 42, 0.28)',
      }}>
        <div style={{
          padding: '18px 24px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              fontSize: 24,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: '#334155', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function ProjectEditModal({ project, onSave, onClose }) {
  const [form, setForm] = useState({
    bo_1_name: project.bo_1_name || project.bo || '',
    bo_1_email: project.bo_1_email || project.bo_email || '',
    bo_2_name: project.bo_2_name || '',
    bo_2_email: project.bo_2_email || '',
    bo_premise_address: project.bo_premise_address || project.address || '',
    works: project.works || '',
    fee: project.fee || '',
    status: project.status || 'active',
    role: project.role || project.surveyor_role || 'BO',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title="Edit project" onClose={onClose}>
      <div style={{ padding: '0 24px 24px' }}>

        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.7px',
          margin: '4px 0 12px',
        }}>
          Your role on this project
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
          {[
            ['BO', "Building Owner Surveyor", 'Acting for the BO'],
            ['AO', "Adjoining Owner Surveyor", 'Acting for the AO'],
            ['AGREED', "Agreed Surveyor", 'Acting for both sides'],
          ].map(([value, label, sub]) => {
            const active = form.role === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => set('role', value)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: active ? '1px solid var(--blue)' : '1px solid #dde3ea',
                  background: active ? 'var(--blue-bg)' : '#ffffff',
                  color: active ? 'var(--blue)' : '#111827',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 11.5, color: active ? 'var(--blue)' : '#94a3b8', marginTop: 2 }}>{sub}</div>
              </button>
            );
          })}
        </div>

        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.7px',
          margin: '18px 0 10px',
          paddingTop: 16,
          borderTop: '1px solid #d9dee7',
        }}>
          Premise address
        </div>

        <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
          <Field label="Premise address">
            <textarea
              value={form.bo_premise_address}
              onChange={e => set('bo_premise_address', e.target.value)}
              rows={2}
              style={{ ...modalInput, resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.7px',
          margin: '18px 0 10px',
          paddingTop: 16,
          borderTop: '1px solid #d9dee7',
        }}>
          Building owner
        </div>

        <div style={{
          background: '#f8fafc',
          border: '1px solid #dde3ea',
          borderRadius: 16,
          padding: 16,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 14,
        }}>
          <div style={{ gridColumn: '1/-1', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            Owner 1
          </div>
          <Field label="Full name">
            <input value={form.bo_1_name} onChange={e => set('bo_1_name', e.target.value)} style={modalInput} />
          </Field>
          <Field label="Email">
            <input value={form.bo_1_email} onChange={e => set('bo_1_email', e.target.value)} style={modalInput} />
          </Field>
        </div>

        <div style={{
          background: '#f8fafc',
          border: '1px solid #dde3ea',
          borderRadius: 16,
          padding: 16,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 18,
        }}>
          <div style={{ gridColumn: '1/-1', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
            Owner 2 optional, joint owner
          </div>
          <Field label="Full name">
            <input value={form.bo_2_name || ''} onChange={e => set('bo_2_name', e.target.value)} style={modalInput} />
          </Field>
          <Field label="Email, e-signature if joint">
            <input value={form.bo_2_email || ''} onChange={e => set('bo_2_email', e.target.value)} style={modalInput} />
          </Field>
        </div>

        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.7px',
          margin: '18px 0 10px',
          paddingTop: 16,
          borderTop: '1px solid #d9dee7',
        }}>
          Project details
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Reference">
            <input value={project.ref || ''} disabled style={{ ...modalInput, color: '#94a3b8' }} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} style={modalInput}>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
              <option value="on_hold">On hold</option>
              <option value="dispute">Dispute</option>
            </select>
          </Field>
          <div style={{ gridColumn: '1/-1' }}>
            <Field label="Works description">
              <textarea value={form.works} onChange={e => set('works', e.target.value)} rows={3} style={{ ...modalInput, resize: 'vertical' }} />
            </Field>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <Field label="Projected fee">
              <input
                value={form.fee}
                onChange={e => set('fee', e.target.value)}
                placeholder="Leave blank if no fee set"
                style={modalInput}
              />
            </Field>
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          marginTop: 18,
          paddingTop: 18,
          borderTop: '1px solid #d9dee7',
        }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99, padding: '8px 18px' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99, padding: '8px 18px', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </ModalShell>
  );

function AOEditModal({ ao, title, onSave, onClose }) {
  const [form, setForm] = useState({
    num: ao?.num || '',
    name: ao?.name || '',
    name2: ao?.name2 || '',
    premise: ao?.premise || ao?.reg_addr || ao?.address || '',
    email: ao?.email || '',
    email2: ao?.email2 || '',
    phone: ao?.phone || '',
    status: ao?.status || 'details_added',
    agreed_surveyor: !!ao?.agreed_surveyor,
    notice_served_date: aoNotice(ao || {}),
    consent_deadline: aoConsent(ao || {}),
    s10_deadline: aoS10(ao || {}),
    surv_name: aoSurvName(ao || {}),
    surv_firm: aoSurvFirm(ao || {}),
    surv_email: aoSurvEmail(ao || {}),
    surv_phone: aoSurvPhone(ao || {}),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim() && !form.premise.trim()) {
      alert('Please enter at least an AO name or address.');
      return;
    }
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={title} onClose={onClose}>
      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="AO number"><input value={form.num} onChange={e => set('num', e.target.value)} style={modalInput} /></Field>
        <Field label="Status">
          <select value={form.status} onChange={e => set('status', e.target.value)} style={modalInput}>
            <option value="details_added">Details added</option>
            <option value="notice_served">Notice served</option>
            <option value="consent">Consent</option>
            <option value="dissent">Dissent</option>
            <option value="s10">S.10</option>
            <option value="complete">Complete</option>
          </select>
        </Field>
        <Field label="AO name"><input value={form.name} onChange={e => set('name', e.target.value)} style={modalInput} /></Field>
        <Field label="Second AO name"><input value={form.name2} onChange={e => set('name2', e.target.value)} style={modalInput} /></Field>
        <Field label="AO email"><input value={form.email} onChange={e => set('email', e.target.value)} style={modalInput} /></Field>
        <Field label="Second AO email"><input value={form.email2} onChange={e => set('email2', e.target.value)} style={modalInput} /></Field>
        <Field label="Phone"><input value={form.phone} onChange={e => set('phone', e.target.value)} style={modalInput} /></Field>
        <Field label="AO premise / address"><textarea value={form.premise} onChange={e => set('premise', e.target.value)} rows={2} style={{ ...modalInput, resize: 'vertical' }} /></Field>
        <Field label="Notice served"><input type="date" value={form.notice_served_date || ''} onChange={e => set('notice_served_date', e.target.value)} style={modalInput} /></Field>
        <Field label="Consent deadline"><input type="date" value={form.consent_deadline || ''} onChange={e => set('consent_deadline', e.target.value)} style={modalInput} /></Field>
        <Field label="S.10 deadline"><input type="date" value={form.s10_deadline || ''} onChange={e => set('s10_deadline', e.target.value)} style={modalInput} /></Field>
        <Field label="AO surveyor name"><input value={form.surv_name} onChange={e => set('surv_name', e.target.value)} style={modalInput} /></Field>
        <Field label="AO surveyor firm"><input value={form.surv_firm} onChange={e => set('surv_firm', e.target.value)} style={modalInput} /></Field>
        <Field label="AO surveyor email"><input value={form.surv_email} onChange={e => set('surv_email', e.target.value)} style={modalInput} /></Field>
        <Field label="AO surveyor phone"><input value={form.surv_phone} onChange={e => set('surv_phone', e.target.value)} style={modalInput} /></Field>
        <label style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.agreed_surveyor} onChange={e => set('agreed_surveyor', e.target.checked)} />
          I am the Agreed Surveyor for this AO
        </label>
        <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save AO'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

function AOCard({ ao, onOpenComposer, onGenerateAOLOA, loaLoading, onEditAO }) {
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

export default function ProjectDetail({ project, onBack, onOpenComposer, onRaiseInvoice, onOpenSOC }) {
  const [tab, setTab] = useState('details');
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [loaLoading, setLoaLoading] = useState(null);
  const [localProject, setLocalProject] = useState(project);
  const [showProjectEdit, setShowProjectEdit] = useState(false);
  const [aoModal, setAoModal] = useState(null);

  useEffect(() => { setLocalProject(project); }, [project]);

  const currentProject = localProject || project;

  const { generateDocument, sendForSignature } = useDocumentGenerator();

  const address    = currentProject.address  || currentProject.bo_premise_address || '';
  const bo         = currentProject.bo       || currentProject.bo_1_name || '';
  const boEmail    = currentProject.bo_email || currentProject.bo_1_email || '';
  const works      = currentProject.works    || '';
  const aos        = currentProject.aos      || [];
  const docs       = currentProject.documents || [];
  const projColour = getProjectColour(currentProject);

  const handleSaveProjectEdit = useCallback(async (form) => {
    const feeText = String(form.fee ?? '').trim();

    if (feeText && Number.isNaN(Number(feeText))) {
      alert('Fee must be a number, or left blank.');
      throw new Error('Invalid fee value');
    }

    const update = {
      bo_1_name: form.bo_1_name || '',
      bo_1_email: form.bo_1_email || '',
      bo_2_name: form.bo_2_name || '',
      bo_2_email: form.bo_2_email || '',
      bo_premise_address: form.bo_premise_address || '',
      works: form.works || '',
      fee: feeText === '' ? null : Number(feeText),
      status: form.status || 'active',
      role: form.role || 'BO',
    };

    const { error } = await sb
      .from('projects')
      .update(update)
      .eq('id', currentProject.id);

    if (error) {
      console.error('save project edit', error);
      alert('Could not save project: ' + error.message);
      throw error;
    }

    setLocalProject(prev => ({
      ...prev,
      ...update,
      bo: update.bo_1_name,
      bo_email: update.bo_1_email,
      address: update.bo_premise_address,
    }));
  }, [currentProject.id]);

  const normaliseAOForSave = (form, existing = {}) => ({
    ...existing,
    id: existing.id || `ao_${Date.now()}`,
    num: form.num || existing.num || ((currentProject.aos || []).length + 1),
    name: form.name || '',
    name2: form.name2 || '',
    premise: form.premise || '',
    address: form.premise || '',
    email: form.email || '',
    email2: form.email2 || '',
    phone: form.phone || '',
    status: form.status || 'details_added',
    agreed_surveyor: !!form.agreed_surveyor,
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
  });

  const handleSaveAO = useCallback(async (form) => {
    const aosNow = currentProject.aos || [];
    let nextAos;

    if (aoModal?.mode === 'edit') {
      nextAos = aosNow.map((item, idx) => {
        const sameById = aoModal.ao?.id && item.id === aoModal.ao.id;
        const sameByIndex = idx === aoModal.index;
        return sameById || sameByIndex ? normaliseAOForSave(form, item) : item;
      });
    } else {
      nextAos = [...aosNow, normaliseAOForSave(form, { num: aosNow.length + 1 })];
    }

    const { error } = await sb
      .from('projects')
      .update({ aos: nextAos })
      .eq('id', currentProject.id);

    if (error) {
      console.error('save AO', error);
      alert('Could not save AO: ' + error.message);
      throw error;
    }

    setLocalProject(prev => ({ ...prev, aos: nextAos }));
  }, [currentProject, aoModal]);


  const roleLabel = (() => {
    const r = (currentProject.role || currentProject.surveyor_role || 'BO').toUpperCase();
    if (r === 'AO') return "Adjoining Owner's Surveyor";
    if (r === 'AS' || r === 'AGREED') return 'Agreed Surveyor';
    return "Building Owner's Surveyor";
  })();

  const stageIndex = currentProject.status === 'complete' ? 4
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
      .eq('project_id', currentProject.id).order('received_at', { ascending: false }).limit(50)
      .then(({ data }) => { setEmails(data || []); setEmailsLoading(false); });
  }, [tab, currentProject.id]);

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
        projectId:       currentProject.id,
        appointmentType: 'bo_loa',
        signers: [
          { name: bo, email: boEmail },
          ...(currentProject.bo_2_name && currentProject.bo_2_email
            ? [{ name: currentProject.bo_2_name, email: currentProject.bo_2_email }]
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
        projectId:       currentProject.id,
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

  const handleRaiseInvoice = useCallback(() => {
    if (onRaiseInvoice) {
      onRaiseInvoice({ property_address: address, bill_to_name: bo, bill_to_address: currentProject.bo_address || '', role: (currentProject.role || 'BO').toUpperCase() === 'AO' ? 'AO' : 'BO', project_id: currentProject.id });
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
          project={currentProject}
          onSave={handleSaveProjectEdit}
          onClose={() => setShowProjectEdit(false)}
        />
      )}

      {aoModal && (
        <AOEditModal
          title={aoModal.mode === 'edit' ? 'Edit adjoining owner' : 'Add adjoining owner'}
          ao={aoModal.ao || { num: (currentProject.aos || []).length + 1 }}
          onSave={handleSaveAO}
          onClose={() => setAoModal(null)}
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
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14, lineHeight: 1.4 }}>{currentProject.ref} — {bo} — {address}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Role</div>
                  <span style={{ fontSize: 12.5, padding: '3px 10px', borderRadius: 99, background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 500 }}>{roleLabel}</span>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Status</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: projColour }}>{currentProject.status || 'active'}</span>
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
                <button className="btn btn-sm btn-primary" onClick={() => setAoModal({ mode: 'add', ao: null, index: null })} style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add AO</button>
              </div>
              {aos.length === 0
                ? <div style={{ ...card({ padding: '20px', textAlign: 'center' }) }}><div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>No adjoining owners recorded yet.</div></div>
                : aos.map((ao, i) => {
                  const aoKey = `ao-${ao.id || ao.num || ao.name || i}`;
                  return (
                    <AOCard key={ao.id || i} ao={ao} onOpenComposer={onOpenComposer} onGenerateAOLOA={handleGenerateAOLOA} loaLoading={loaLoading === aoKey} onEditAO={() => setAoModal({ mode: 'edit', ao, index: i })} />
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
                { label: 'Projected',   val: fmtGBP(currentProject.fee),         colour: 'var(--text)' },
                { label: 'Invoiced',    val: fmtGBP(currentProject.fee_invoiced), colour: parseFloat(currentProject.fee_invoiced) > 0 ? 'var(--blue)' : 'var(--red)' },
                { label: 'Paid',        val: fmtGBP(currentProject.fee_paid),     colour: parseFloat(currentProject.fee_paid) > 0 ? 'var(--green)' : 'var(--text3)' },
                { label: 'Outstanding', val: fmtGBP((parseFloat(currentProject.fee_invoiced)||0) - (parseFloat(currentProject.fee_paid)||0)), colour: 'var(--amber)' },
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
            <button className="btn btn-sm btn-primary" style={{ cursor: 'pointer', borderRadius: 99 }} onClick={() => onOpenComposer?.({ mode: 'compose', projectId: currentProject.id })}>+ Compose</button>
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
