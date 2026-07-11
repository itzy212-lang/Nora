import { useState, useEffect, useRef, useCallback } from 'react';
import { useEly } from '../../hooks/useEly';
import useDocumentGenerator from '../../hooks/useDocumentGenerator';
import NoticeServingModal from './NoticeServingModal';
import { buildBOLOAPlaceholders, buildAOLOAPlaceholders, buildLOAFileName, buildBOLOAPdfPlaceholders, buildAOLOAPdfPlaceholders, buildLOAPdfFileName } from '../../utils/buildLOAPlaceholders';
import { buildNoticePlaceholders } from '../../utils/buildNoticePlaceholders';
import { buildAwardPlaceholders } from '../../utils/buildAwardPlaceholders';
import sb from '../../supabaseClient';
import PizZip from 'pizzip';
import ChatInputBar from '../shared/ChatInputBar';

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
const aoS10Served = ao => ao?.s10_served_date || ao?.s10ServedDate || '';
const ao104BServed = ao => ao?.s104b_served_date || ao?.s104bServedDate || '';
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

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addDaysIsoFromDate(value, days) {
  const [year, month, day] = String(value || todayIso()).split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function ordinalSuffix(day) {
  const n = Number(day);
  if ([11, 12, 13].includes(n % 100)) return 'th';
  if (n % 10 === 1) return 'st';
  if (n % 10 === 2) return 'nd';
  if (n % 10 === 3) return 'rd';
  return 'th';
}

function formatLongNoticeDate(value) {
  if (!value) return '';

  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return '';

  const date = new Date(year, month - 1, day);
  const monthName = date.toLocaleString('en-GB', { month: 'long' });

  return `${day}${ordinalSuffix(day)} ${monthName} ${year}`;
}

function aoSOCDate(ao) {
  return ao?.soc_agreed_date || ao?.soc_date || ao?.schedule_of_condition_date || ao?.scheduleOfConditionDate || '';
}

function aoSOCTime(ao) {
  return ao?.soc_time || ao?.socTime || '';
}

function fmtTime(value) {
  if (!value) return '';

  const [hours, minutes = '00'] = String(value).split(':');
  const h = Number(hours);

  if (!Number.isFinite(h)) return String(value);

  return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatSOCBadgeDate(value) {
  return formatLongNoticeDate(value) || fmtDate(value) || value || '';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function safeFilePart(value) {
  return String(value || 'Document')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function safeNoticeFilePart(value) {
  return String(value || 'Document')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function addDocxToZip(zip, fileName, b64) {
  if (!zip || !b64) return;
  zip.file(fileName, b64, { base64: true });
}

function downloadB64File(b64, fileName, mimeType) {
  const byteCharacters = atob(b64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function joinOwnerNames(name1, name2) {
  const a = String(name1 || '').trim();
  const b = String(name2 || '').trim();
  if (a && b) return `${a} & ${b}`;
  return a || b || '';
}

function buildNoticeMergeData({ project, ao, sectionKey, includeCover = false, noticeDate: suppliedNoticeDate, allSections = [], section2Subsections = '', worksItems = [] }) {
  const noticeDate = suppliedNoticeDate || todayIso();
  const boPremise = project?.bo_premise_address || project?.address || '';
  const aoPremise = aoAddress(ao);

  const sectionLabels = {
    s1: 'Section 1(5)',
    s2: 'Section 2(2)',
    s3: 'Section 3',
    s6: 'Section 6(1)',
    s10: 'Section 10',
    cover: 'Covering Letter',
  };

  const fileLabels = {
    s1: 'Section 1(5) Notice',
    s2: 'Section 2(2) Notice',
    s3: 'Section 3 Notice',
    s6: 'Section 6(1) Notice',
    s10: 'Section 10 Notice',
    cover: 'Covering Letter',
  };

  const fileAddress = aoPremise || 'Address not recorded';
  const fileBase = `${safeNoticeFilePart(fileLabels[sectionKey] || sectionKey)} - ${safeNoticeFilePart(fileAddress)}`;

  const originalNoticeDate =
    sectionKey === 's10'
      ? (
          ao?.notice_served_date ||
          ao?.noticeServedDate ||
          ao?.notice_date ||
          noticeDate
        )
      : noticeDate;

  const placeholders = buildNoticePlaceholders(project, ao, {
    noticeType: sectionKey,
    noticeSection: sectionLabels[sectionKey] || sectionKey,
    noticeDate,
    originalNoticeDate,
    section10NoticeDate: noticeDate,
    notifiableWorks: worksItems?.length
      ? worksItems.filter(w => w.trim()).join('\n')
      : (project?.works || ''),
    works_items: (worksItems?.length ? worksItems.filter(w => w.trim()) : (project?.works ? [project.works] : [])).map(item => ({ item })),
    includeCover,
    allSections: allSections.length ? allSections : [sectionKey],
    section2Subsections,
  });

  return {
    ...placeholders,
    project_id: project?.id || '',
    ao_id: ao?.id || String(ao?.num || ''),
    file_name: `${fileBase}.docx`,
    category: 'notice',
    section_type: sectionKey,
    source_template: sectionKey,
  };
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function aoKeyMatches(a, target) {
  if (!a || !target) return false;
  if (a.id && target.id) return a.id === target.id;
  if (a.num && target.num) return a.num === target.num;
  return a.name === target.name && aoAddress(a) === aoAddress(target);
}

function isAOResolved(ao) {
  const st = (ao?.status || '').toLowerCase();
  return ['consent', 'dissent', 's10', 'section_10_served', 'award', 'complete'].includes(st);
}

function hasS10BeenServed(ao) {
  const st = (ao?.status || '').toLowerCase();
  return st === 's10' || st === 'section_10_served' || !!ao?.s10_served_date || !!ao?.s10ServedDate;
}

function consentPeriodExpired(ao) {
  const cd = aoConsent(ao);
  if (!cd || isAOResolved(ao)) return false;
  return new Date(cd).getTime() < Date.now();
}

function getAOStatusMeta(ao, projectRole = 'BO') {
  const st = (ao?.status || '').toLowerCase();
  const noticed = !!aoNotice(ao);
  const s10Served = hasS10BeenServed(ao);
  const s104bServed = !!ao104BServed(ao);
  const awardServed = !!(ao?.award_served_date || ao?.awardServedDate);
  const awardGenerated = !!(ao?.award_generated_at || ao?.awardGeneratedAt || st === 'award');
  const surveyorAppointed = !!(aoSurvName(ao) && (st === 'dissent' || s104bServed));
  const overdue = consentPeriodExpired(ao);
  const s10Deadline = daysUntil(aoS10(ao));

  if (projectRole === 'AO' && ao?.appointed_by_me) {
    return { label: 'Your AO client', colour: '#a855f7', action: null };
  }

  // Award served — final state
  if (awardServed || st === 'complete') {
    return { label: 'Award served', colour: '#22c55e', action: null };
  }

  // Award generated — needs serving
  if (awardGenerated) {
    return { label: 'Award drafted — serve award', colour: '#f59e0b', action: 'serve_award' };
  }

  // Consent
  if (st === 'consent') {
    return { label: 'Consent received', colour: '#22c55e', action: null };
  }

  // Dissent — agreed surveyor
  if (st === 'dissent' && ao?.agreed_surveyor) {
    return { label: 'Agreed surveyor', colour: '#22c55e', action: null };
  }

  // Dissent — named surveyor appointed
  if (st === 'dissent' && surveyorAppointed) {
    return { label: 'Surveyor appointed', colour: '#22c55e', action: null };
  }

  // Dissent — no surveyor yet
  if (st === 'dissent') {
    return { label: 'Dissent received', colour: '#f59e0b', action: null };
  }

  // 104b served — awaiting surveyor appointment
  if (s104bServed) {
    return { label: surveyorAppointed ? 'Surveyor appointed' : '10(4)(b) served', colour: '#22c55e', action: null };
  }

  // S10 served — countdown to 104b
  if (s10Served) {
    if (s10Deadline !== null && s10Deadline <= 0) {
      return { label: 'Serve 10(4)(b)', colour: '#ef4444', action: 'serve_104b' };
    }
    return {
      label: s10Deadline === null ? 'S.10 served' : s10Deadline === 0 ? 'S.10 expires today' : `S.10 -- ${s10Deadline}d left`,
      colour: s10Deadline !== null && s10Deadline <= 3 ? '#f59e0b' : '#22c55e',
      action: null,
    };
  }

  // Notice served — overdue, serve S10
  if (noticed && overdue) {
    return { label: 'Serve Section 10', colour: '#ef4444', action: 'serve_s10' };
  }

  // Notice served — within deadline
  if (noticed) {
    return { label: 'Notice served', colour: '#22c55e', action: null };
  }

  return { label: 'Serve notice', colour: '#3b82f6', action: 'serve_notice' };
}

function fmtGBP(v) {
  return `£${(parseFloat(v) || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
  })}`;
}

function getAOColour(ao, projectRole = 'BO') {
  return getAOStatusMeta(ao, projectRole).colour || '#9ca3af';
}

function getProjectColour(project) {
  const role = (project.role || project.appointment_role || 'BO').toUpperCase();
  const aos = project.aos || [];
  const modalAOs = Array.isArray(aos) && aos.length ? aos : (Array.isArray(project?.aos) ? project.aos : []);

  if (role === 'AO') return '#a855f7';
  if (!aos.length) return '#9ca3af';

  const now = Date.now();

  const hasOverdue = aos.some(ao => {
    const cd = aoConsent(ao);
    const sd = aoS10(ao);
    const st = (ao.status || '').toLowerCase();

    return (
      (cd && new Date(cd).getTime() < now && !isAOResolved(ao)) ||
      (sd && new Date(sd).getTime() < now && !['consent', 'dissent', 's10', 'section_10_served', 'award', 'complete'].includes(st))
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
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;

      const { data } = await sb
        .from('contacts')
        .select('id, name, firm, email, phone')
        .ilike('name', `%${query}%`)
        .eq('type', 'surveyor')
        .eq('user_id', user.id)
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
  if (!surv?.name?.trim()) return;

  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // Check by name + firm if no email, otherwise by email
    let existing;
    if (surv.email?.trim()) {
      const { data } = await sb
        .from('contacts')
        .select('id, name, firm, email, phone')
        .ilike('email', surv.email.trim())
        .eq('user_id', user.id)
        .limit(1);
      existing = data;
    } else {
      const { data } = await sb
        .from('contacts')
        .select('id, name, firm, email, phone')
        .ilike('name', surv.name.trim())
        .eq('user_id', user.id)
        .limit(1);
      existing = data;
    }

    if (existing?.length > 0) {
      // Update with any new details
      await sb.from('contacts').update({
        firm: surv.firm?.trim() || existing[0].firm,
        email: surv.email?.trim() || existing[0].email,
        phone: surv.phone?.trim() || existing[0].phone,
      }).eq('id', existing[0].id);
      return;
    }

    await sb.from('contacts').insert([{
      user_id: user.id,
      type: 'surveyor',
      name: surv.name.trim(),
      firm: surv.firm?.trim() || null,
      email: surv.email?.trim() || null,
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
                  rows={1}
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
  const isNew = mode === 'add' || ao?._mode === 'add' || ao?.isNew === true;
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


function getAOWorkflowAction(ao, projectRole = 'BO') {
  const st = (ao.status || '').toLowerCase();
  const noticed = !!aoNotice(ao);
  const consentDeadlineDays = daysUntil(aoConsent(ao));
  const s10DeadlineDays = daysUntil(aoS10(ao));
  const s10Served = !!aoS10Served(ao);
  const s104bServed = !!ao104BServed(ao);

  if (projectRole === 'AO' && ao?.appointed_by_me) {
    return { label: 'Your AO client', action: null, colour: '#a855f7', active: false };
  }

  if (st === 'consent') return { label: 'Consent received', action: null, colour: 'var(--green)', active: false };
  if (st === 'dissent' && ao.agreed_surveyor) return { label: 'Agreed surveyor', action: null, colour: 'var(--green)', active: false };
  if (st === 'dissent') return { label: 'Dissent received', action: null, colour: 'var(--amber)', active: false };

  if (s104bServed || st === 's104b') {
    return { label: '10(4)(b) served', action: null, colour: 'var(--green)', active: false };
  }

  if (s10Served || st === 's10') {
    if (s10DeadlineDays !== null && s10DeadlineDays <= 0) {
      return { label: 'Serve 10(4)(b) papers', action: 'serve104b', colour: 'var(--red)', active: true };
    }
    return {
      label: s10DeadlineDays === null ? 'Section 10 served' : s10DeadlineDays === 0 ? 'S.10 deadline today' : `S.10 deadline -- ${s10DeadlineDays}d`,
      action: null,
      colour: 'var(--green)',
      active: false,
    };
  }

  if (noticed && consentDeadlineDays !== null && consentDeadlineDays <= 0) {
    return { label: 'Serve Section 10', action: 'serveS10', colour: 'var(--red)', active: true };
  }

  if (noticed) return { label: 'Notice served', action: null, colour: 'var(--green)', active: false };

  return { label: 'Serve notice', action: 'serveNotice', colour: 'var(--blue)', active: true };
}

function AOCard({
  ao,
  projectRole,
  project,
  onOpenComposer,
  onGenerateAOLOA,
  onGenerateAward,
  onEditAO,
  onServeNotice,
  onServeS10,
  onServe104b,
  onServeAward,
  onSetAOStatus,
  onToggleAgreedSurveyor,
  onNoteIntention,
  onOpenSOCForAO,
  loaLoading,
  awardLoading,
  emailResponseTasks = [],
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

  const statusMeta = getAOStatusMeta(ao, projectRole);

  // Find open email_response task for this AO (matched by surveyor email or any task on this project)
  const aoEmail = ao?.surv_email || ao?.surveyorEmail || ao?.email || '';
  const emailTask = emailResponseTasks.find(t => {
    if (!t.due_date) return false;
    try {
      const meta = typeof t.metadata === 'string' ? JSON.parse(t.metadata) : (t.metadata || {});
      // email_response: match by to_email (we sent to surveyor)
      if (t.task_type === 'email_response') {
        return aoEmail && meta.to_email && meta.to_email.toLowerCase() === aoEmail.toLowerCase();
      }
      // email_action: match by sender_email (surveyor emailed us)
      if (t.task_type === 'email_action') {
        return aoEmail && meta.sender_email && meta.sender_email.toLowerCase() === aoEmail.toLowerCase();
      }
      return false;
    } catch { return false; }
  }) || null;
  const emailTaskDays = emailTask ? daysUntil(emailTask.due_date) : null;

  // Stale inactivity — days since last status change
  const resolvedStatuses = ['consent', 'complete', 'award_served'];
  const st = (ao?.status || '').toLowerCase();
  const isResolved = resolvedStatuses.includes(st) || !!(ao?.award_served_date || ao?.awardServedDate);
  const lastChange = ao?.last_status_change ? new Date(ao.last_status_change) : null;
  const daysSinceChange = lastChange ? Math.floor((Date.now() - lastChange.getTime()) / 86400000) : null;
  const isStale = !isResolved && noticed && daysSinceChange !== null && daysSinceChange >= 10;
  const statusLabel = statusMeta.label;
  const statusColour = statusMeta.colour || colour;
  const socDate = aoSOCDate(ao);
  const socTime = aoSOCTime(ao);
  const socStatus = String(ao?.soc_status || '').toLowerCase();
  const socLabel = socDate
    ? `SOC booked - ${formatSOCBadgeDate(socDate)}${socTime ? ` - ${fmtTime(socTime)}` : ''}${socStatus === 'complete' ? ' - complete' : ''}`
    : '';

  return (
    <div style={{ ...card({ marginBottom: 12, overflow: 'hidden' }) }}>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 5, background: colour, borderRadius: '16px 0 0 16px', flexShrink: 0 }} />

        <div style={{ flex: 1, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colour }}>
                AO{ao.num} - {(ao.name || '').toUpperCase()}
              </div>
              {aoName2(ao) && (
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
                  {aoName2(ao)}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* LOA status icons */}
              {ao.loa_signed_at ? (
                <span title={`LOA signed ${new Date(ao.loa_signed_at).toLocaleDateString('en-GB')}`}
                  style={{ fontSize: 16, cursor: ao.loa_signed_pdf_url ? 'pointer' : 'default' }}
                  onClick={() => ao.loa_signed_pdf_url && window.open(ao.loa_signed_pdf_url, '_blank')}
                >✅</span>
              ) : ao.loa_sent_at ? (
                <span title={`LOA sent ${new Date(ao.loa_sent_at).toLocaleDateString('en-GB')} -- awaiting signature`}
                  style={{ fontSize: 16 }}
                >📤</span>
              ) : null}

              {statusLabel && (
                statusMeta.action ? (
                <button
                  onClick={() => {
                    if (statusMeta.action === 'serve_s10') onServeS10?.(ao);
                    else if (statusMeta.action === 'serve_notice') onServeNotice?.(ao);
                    else if (statusMeta.action === 'serve_104b') onServe104b?.(ao);
                    else if (statusMeta.action === 'serve_award') onServeAward?.(ao);
                  }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: `1px solid ${statusColour}`,
                    background: statusMeta.action === 'serve_s10' || statusMeta.action === 'serve_104b' ? 'var(--red-bg)'
                      : statusMeta.action === 'serve_award' ? 'var(--amber-bg)' : 'var(--blue-bg)',
                    color: statusColour,
                    marginLeft: 8,
                  }}
                >
                  {statusLabel}
                </button>
              ) : (
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColour, paddingLeft: 8 }}>
                  {statusLabel}
                </span>
              )
            )}
            </div>
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

          {socLabel && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              margin: '6px 0',
              padding: '4px 12px',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 700,
              background: socStatus === 'complete' ? 'var(--green-bg)' : 'var(--purple-bg)',
              color: socStatus === 'complete' ? 'var(--green)' : 'var(--purple)',
              border: `1px solid ${socStatus === 'complete' ? 'var(--green)' : 'var(--purple)'}`,
            }}>
              📋 {socLabel}
            </div>
          )}

          {(() => {
            const st2 = (ao.status || '').toLowerCase();
            const actionTaken = ['consent','dissent','s10','s104b','complete'].includes(st2)
              || !!aoS10Served(ao) || !!ao104BServed(ao)
              || !!(ao?.award_served_date || ao?.awardServedDate);

            // Consent deadline badge — only show if no action taken yet
            if (!isAOAppointment && noticed && cd && !actionTaken) {
              return (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  margin: '6px 0', padding: '4px 12px', borderRadius: 99,
                  fontSize: 12, fontWeight: 600,
                  background: days !== null && days <= 0 ? 'var(--red-bg)' : days !== null && days <= 7 ? 'var(--amber-bg)' : 'var(--green-bg)',
                  color: days !== null && days <= 0 ? 'var(--red)' : days !== null && days <= 7 ? 'var(--amber)' : 'var(--green)',
                }}>
                  ⏱ {days === null ? fmtDate(cd) : days < 0 ? `Consent deadline -- ${Math.abs(days)}d overdue` : days === 0 ? 'Consent deadline TODAY' : `Consent deadline -- ${days}d`}
                </div>
              );
            }

            // S10 countdown — show while S10 served but 104b not yet served
            const s10Dd = aoS10(ao);
            const s10Days = daysUntil(s10Dd);
            if (!isAOAppointment && !!aoS10Served(ao) && !ao104BServed(ao) && s10Dd) {
              return (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  margin: '6px 0', padding: '4px 12px', borderRadius: 99,
                  fontSize: 12, fontWeight: 600,
                  background: s10Days !== null && s10Days <= 0 ? 'var(--red-bg)' : s10Days !== null && s10Days <= 3 ? 'var(--amber-bg)' : 'var(--green-bg)',
                  color: s10Days !== null && s10Days <= 0 ? 'var(--red)' : s10Days !== null && s10Days <= 3 ? 'var(--amber)' : 'var(--green)',
                }}>
                  ⏱ {s10Days === null ? fmtDate(s10Dd) : s10Days < 0 ? `S.10 expired -- ${Math.abs(s10Days)}d overdue` : s10Days === 0 ? 'S.10 expires TODAY' : `S.10 expires -- ${s10Days}d`}
                </div>
              );
            }

            // Email response tracker badge
            if (!isAOAppointment && emailTask) {
              return (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  margin: '6px 0', padding: '4px 12px', borderRadius: 99,
                  fontSize: 12, fontWeight: 600,
                  background: emailTaskDays !== null && emailTaskDays <= 0 ? 'var(--red-bg)' : emailTaskDays !== null && emailTaskDays <= 3 ? 'var(--amber-bg)' : 'var(--blue-bg)',
                  color: emailTaskDays !== null && emailTaskDays <= 0 ? 'var(--red)' : emailTaskDays !== null && emailTaskDays <= 3 ? 'var(--amber)' : 'var(--blue)',
                }}>
                  {emailTask?.task_type === 'email_action' ? '📩' : '📬'} {emailTask?.task_type === 'email_action'
                    ? (emailTaskDays !== null && emailTaskDays <= 0 ? `Email action overdue -- ${Math.abs(emailTaskDays)}d` : `Action required -- ${emailTaskDays}d`)
                    : (emailTaskDays !== null && emailTaskDays <= 0 ? `Awaiting response -- ${Math.abs(emailTaskDays)}d overdue` : `Awaiting response -- ${emailTaskDays}d`)}
                </div>
              );
            }

            // Stale inactivity badge
            if (!isAOAppointment && isStale) {
              return (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  margin: '6px 0', padding: '4px 12px', borderRadius: 99,
                  fontSize: 12, fontWeight: 600,
                  background: daysSinceChange >= 14 ? 'var(--red-bg)' : 'var(--amber-bg)',
                  color: daysSinceChange >= 14 ? 'var(--red)' : 'var(--amber)',
                }}>
                  ⏸ No progress — {daysSinceChange}d
                </div>
              );
            }

            return null;
          })()}

          {!isAOAppointment && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
              <div
                onClick={() => onToggleAgreedSurveyor?.(ao)}
                role="switch"
                aria-checked={!!ao.agreed_surveyor}
                title="Toggle agreed surveyor appointment"
                style={{
                  width: 32,
                  height: 18,
                  borderRadius: 9,
                  cursor: 'pointer',
                  position: 'relative',
                  flexShrink: 0,
                  background: ao.agreed_surveyor ? 'var(--blue)' : 'var(--border2)',
                }}
              >
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
                lineHeight: '20px',
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
                {survName}{survFirm ? ` - ${survFirm}` : ''}
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
              <button
                key={a}
                onClick={() => onSetAOStatus?.(ao, a.toLowerCase())}
                style={{
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: `1px solid ${a === 'Consent' ? 'var(--green)' : 'var(--red)'}`,
                  background: (ao.status || '').toLowerCase() === a.toLowerCase() ? (a === 'Consent' ? 'var(--green-bg)' : 'var(--red-bg)') : 'transparent',
                  color: a === 'Consent' ? 'var(--green)' : 'var(--red)',
                }}
              >
                {a}
              </button>
            ))}

            {!isAOAppointment && noticed && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => onNoteIntention?.(ao)}
                style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  borderRadius: 99,
                  color: ao.intention_noted ? 'var(--green)' : undefined,
                }}
              >
                {ao.intention_noted ? 'Intention noted' : 'Note intention'}
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

            <div style={{ display: 'flex', gap: 1 }}>
              <button
                className="btn btn-sm btn-ghost"
                disabled={!!loaLoading}
                onClick={() => onGenerateAOLOA?.(ao)}
                style={{
                  cursor: loaLoading ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  borderRadius: '99px 0 0 99px',
                  opacity: loaLoading ? 0.65 : 1,
                  color: isAOAppointment ? 'var(--purple)' : 'var(--text2)',
                  paddingRight: 8,
                }}
              >
                {loaLoading ? 'Sending…' : isAOAppointment ? '📄 LoA eSignature' : '🔥 Agreed Surveyor LoA'}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={!!loaLoading}
                onClick={() => onDownloadAOLOAPdf?.(ao)}
                style={{
                  cursor: loaLoading ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  borderRadius: '0 99px 99px 0',
                  opacity: loaLoading ? 0.65 : 1,
                  color: isAOAppointment ? 'var(--purple)' : 'var(--text2)',
                  paddingLeft: 8,
                  borderLeft: '1px solid var(--border2)',
                }}
              >
                {loaLoading === `ao-pdf-${ao.id || ao.num || ao.name || 'unknown'}` ? 'Generating...' : '⬇ PDF'}
              </button>
            </div>

            <button
              className="btn btn-sm btn-ghost"
              disabled={awardLoading}
              onClick={() => onGenerateAward?.(ao)}
              style={{
                cursor: awardLoading ? 'not-allowed' : 'pointer',
                fontSize: 12,
                borderRadius: 99,
                opacity: awardLoading ? 0.65 : 1,
                color: 'var(--blue)',
              }}
            >
              {awardLoading ? 'Generating…' : '🏆 Generate Award'}
            </button>

            {!isAOAppointment && (
              <button
                onClick={() => onOpenSOCForAO?.(ao)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid var(--purple)',
                  background: ao.soc_required || ao.status === 'consent_soc' ? 'var(--purple-bg)' : 'transparent',
                  color: 'var(--purple)',
                }}
              >
                Schedule of Condition
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



function NoticeServeModal({ project, ao, defaultSections = [], onServe, onClose }) {
  const [sections, setSections] = useState({
    s1: defaultSections.includes('s1'),
    s3: defaultSections.includes('s3'),
    s6: defaultSections.includes('s6'),
    s10: defaultSections.includes('s10'),
  });
  const [includeCover, setIncludeCover] = useState(!defaultSections.includes('s10'));
  const [saving, setSaving] = useState(false);

  const selectedSections = Object.keys(sections).filter(k => sections[k]);

  const toggle = key => setSections(prev => ({ ...prev, [key]: !prev[key] }));

  const handleServe = async () => {
    if (selectedSections.length === 0 && !includeCover) {
      alert('Please select at least one notice or covering letter.');
      return;
    }

    setSaving(true);
    try {
      await onServe({ sections: selectedSections, includeCover });
      onClose();
    } catch (err) {
      alert(err.message || 'Could not serve notices.');
      setSaving(false);
    }
  };

  return (
    <ModalShell title={sections.s10 ? 'Serve Section 10 notice' : 'Serve notice pack'} onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          background: 'var(--blue-bg)',
          border: '1px solid var(--blue)',
          color: 'var(--blue)',
          borderRadius: 14,
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          Serving notices for <strong>{ao?.name || `AO${ao?.num || ''}`}</strong>
          {aoAddress(ao) ? ` at ${aoAddress(ao)}` : ''}.
          If more than one document is generated, Ely will download a ZIP pack.
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
            Select notices
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['s1', 'Section 1 Notice'],
              ['s3', 'Section 3 Notice'],
              ['s6', 'Section 6 Notice'],
              ['s10', 'Section 10 Notice'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggle(key)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: sections[key] ? '2px solid var(--blue)' : '1px solid #e5e7eb',
                  background: sections[key] ? 'var(--blue-bg)' : '#fff',
                  color: sections[key] ? 'var(--blue)' : 'var(--text)',
                  cursor: 'pointer',
                  fontWeight: sections[key] ? 700 : 500,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={mSection}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: 'var(--text2)' }}>
            <input type="checkbox" checked={includeCover} onChange={e => setIncludeCover(e.target.checked)} />
            Include notice covering letter
          </label>
        </div>

        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 14,
          padding: '10px 14px',
          fontSize: 12.5,
          color: 'var(--text3)',
          lineHeight: 1.55,
        }}>
          Deadline rule: S1/S3/S6 create one 14-day deadline task for this AO. Section 10 creates one 10-day deadline task. Duplicate tasks are skipped automatically.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>
            Cancel
          </button>

          <button onClick={handleServe} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>
            {saving ? 'Serving…' : 'Serve notice pack'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}


function S104BSurveyorModal({ ao, onSave, onClose }) {
  const [form, setForm] = useState({
    name: aoSurvName(ao || ''),
    firm: aoSurvFirm(ao || ''),
    email: aoSurvEmail(ao || ''),
    phone: aoSurvPhone(ao || ''),
  });
  const [third, setThird] = useState({
    name: ao?.third_surveyor_name || '',
    firm: ao?.third_surveyor_firm || '',
    email: ao?.third_surveyor_email || '',
    phone: ao?.third_surveyor_phone || '',
  });
  const [saving, setSaving] = useState(false);

  const setSurveyor = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const setThirdSurveyor = (k, v) => setThird(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name?.trim()) {
      alert('Please enter the surveyor name.');
      return;
    }

    setSaving(true);
    try {
      await maybeSaveSurveyor(form);
      await maybeSaveSurveyor(third);
      await onSave({ surveyor: form, third });
      onClose();
    } catch (err) {
      alert(err.message || 'Could not save 10(4)(b) surveyor details.');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Serve 10(4)(b) papers" onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          background: 'var(--amber-bg)',
          border: '1px solid var(--amber)',
          color: 'var(--amber)',
          borderRadius: 14,
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.55,
        }}>
          Enter the surveyor details to be used for the Section 10(4)(b) appointment papers.
          Start typing a surveyor name to search existing contacts, or enter the details manually.
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
            Surveyor details
          </div>

          <SurveyorBlock title="Surveyor appointed under Section 10(4)(b)" form={form} set={setSurveyor} />
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
            Third surveyor details
          </div>

          <SurveyorBlock title="Third surveyor" form={third} set={setThirdSurveyor} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>
            Cancel
          </button>

          <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>
            {saving ? 'Saving…' : 'Save and prepare 10(4)(b) papers'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}


function ProjectChat({ project, onOpenComposer }) {
  const projectId = String(project?.id || '');
  const projectRef = project?.ref || project?.name || 'this project';
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 760;

  const {
    send,
    loading,
    sessionsLoading,
    projectSessions,
    loadSession,
    refreshProjectSessions,
    startNewSession,
    sessionId,
  } = useEly({ surface: 'project_chat', projectId });

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [voiceStopSignal, setVoiceStopSignal] = useState(0);
  const [landRegistryAO, setLandRegistryAO] = useState(null); // proposed AO from LR doc
  const [draftActionStatus, setDraftActionStatus] = useState('');

  const endRef = useRef(null);
  const fileInputRef = useRef(null);

  const flashDraftAction = useCallback((message) => {
    setDraftActionStatus(message);
    window.clearTimeout(window.__elyDraftActionTimer);
    window.__elyDraftActionTimer = window.setTimeout(() => {
      setDraftActionStatus('');
    }, 1800);
  }, []);


  useEffect(() => {
    refreshProjectSessions?.(projectId);
  }, [projectId, refreshProjectSessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!isMobile && sortedSessions.length > 0) {
      setShowHistory(true);
    }
    if (isMobile) {
      setShowHistory(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const resetChat = useCallback(() => {
    startNewSession?.();
    setMessages([]);
    setInput('');
    setAttachedFiles([]);
    setVoiceStopSignal(v => v + 1);
    if (isMobile) setShowHistory(false);
  }, [startNewSession, isMobile]);

  const deleteSession = useCallback(async (targetSessionId) => {
    if (!targetSessionId || !sb) return;
    try {
      await sb.from('ai_messages').delete().eq('session_id', targetSessionId);
      await sb.from('ai_session_uploads').delete().eq('session_id', targetSessionId);
      await sb.from('ai_sessions').delete().eq('id', targetSessionId);
      refreshProjectSessions?.(projectId);
      // If we just deleted the active session, start fresh
      if (String(targetSessionId) === String(sessionId)) {
        resetChat();
      }
    } catch (err) {
      console.error('[deleteSession] failed:', err.message);
    }
  }, [sb, sessionId, projectId, refreshProjectSessions, resetChat]);

  const selectSession = useCallback(async (targetSessionId) => {
    if (!targetSessionId) return;

    try {
      const bundle = await loadSession(targetSessionId);
      setMessages(bundle?.messages || []);
      setAttachedFiles([]);
      setVoiceStopSignal(v => v + 1);
      if (isMobile) setShowHistory(false);
    } catch (err) {
      alert(err.message || 'Could not load this chat.');
    }
  }, [loadSession, isMobile]);

  const insertRecordSafely = useCallback(async (table, payload) => {
    if (!sb || !table || !payload) return null;

    let workingPayload = { ...payload };
    let lastError = null;

    for (let i = 0; i < 12; i += 1) {
      const { data, error } = await sb
        .from(table)
        .insert([workingPayload])
        .select('*')
        .single();

      if (!error) return data || null;

      lastError = error;

      const missingColumn = error.message?.match(/Could not find the '([^']+)' column/)?.[1];

      if (missingColumn && Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
        const nextPayload = { ...workingPayload };
        delete nextPayload[missingColumn];
        workingPayload = nextPayload;
        continue;
      }

      console.warn(`[ProjectChat] Could not insert ${table}:`, error.message);
      return null;
    }

    console.warn(`[ProjectChat] Could not insert ${table}:`, lastError?.message);
    return null;
  }, []);

  const handleFilesSelected = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!files.length || !projectId) return;

    setUploading(true);

    const uploaded = [];

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('project_id', projectId);
        if (sessionId) formData.append('session_id', sessionId);

        const res = await fetch('/api/project-chat-upload', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (res.ok && data) {
          uploaded.push({
            id: data.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file_name: file.name,
            name: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size || 0,
            storage_path: data.storage_path || null,
            storage_bucket: data.storage_bucket || null,
            upload_status: data.extraction_status || 'stored',
            extracted_text: data.extracted_text || '',
            extraction_status: data.extraction_status || '',
          });
        }
      } catch (err) {
        console.warn('[ProjectChat] Upload failed:', err.message);
      }
    }

    setAttachedFiles(prev => [...prev, ...uploaded]);

    setMessages(prev => [
      ...prev,
      {
        id: `${Date.now()}-upload`,
        role: 'ely',
        content: `Attached ${uploaded.length === 1 ? 'file' : 'files'} to this project chat:\n${uploaded.map(f => `- ${f.file_name}`).join('\n')}`,
      },
    ]);

    setUploading(false);
  }, [projectId, sessionId, insertRecordSafely]);


  const handleSend = useCallback(async () => {
    const text = input.trim();

    if ((!text && attachedFiles.length === 0) || loading || uploading) return;

    setVoiceStopSignal(v => v + 1);


    const attachmentContext = attachedFiles.map(file => ({
      id: file.id,
      fileName: file.file_name,
      file_name: file.file_name,
      mimeType: file.mime_type,
      mime_type: file.mime_type,
      sizeBytes: file.size_bytes,
      storageBucket: file.storage_bucket,
      storagePath: file.storage_path,
      uploadStatus: file.upload_status,
      extracted_text: file.extracted_text || '',
    }));

    const displayText = text || 'Please review the attached project file.';
    const promptForEly = attachmentContext.length
      ? `${displayText}\n\nAttached project file metadata:\n${attachmentContext.map(f => `- ${f.fileName} (${f.mimeType || 'unknown'}, ${f.sizeBytes || 0} bytes)`).join('\n')}`
      : displayText;

    setInput('');
    setAttachedFiles([]);
    setVoiceStopSignal(v => v + 1);

    setMessages(prev => [
      ...prev,
      {
        id: `${Date.now()}-user`,
        role: 'user',
        content: displayText,
      },
    ]);

    try {
      const result = await send(promptForEly, {
        projectId,
        uploadIds: attachmentContext.map(f => f.id),
        context: {
          activeProjectId: projectId,
          projectUploadContext: attachmentContext,
          uploadedExtractedText: attachmentContext.filter(f => f.extracted_text),
        },
      });

      if (result.land_registry_ao) {
        setLandRegistryAO(result.land_registry_ao);
      }

      setMessages(prev => [
        ...prev,
        {
          id: `${Date.now()}-ely`,
          role: 'ely',
          content: result.reply || result.replyText || 'Done.',
        },
      ]);

      refreshProjectSessions?.(projectId);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          id: `${Date.now()}-error`,
          role: 'ely',
          content: `Error: ${err.message}`,
        },
      ]);
    }
  }, [input, attachedFiles, loading, uploading, send, projectId, refreshProjectSessions]);

  const sortedSessions = [...(projectSessions || [])].sort((a, b) => {
    const at = new Date(a.last_message_at || a.updated_at || a.created_at || 0).getTime();
    const bt = new Date(b.last_message_at || b.updated_at || b.created_at || 0).getTime();
    return bt - at;
  });

  const renderHistoryPanel = (mobile = false) => (
    <div style={{
      height: '100%',
      border: mobile ? 'none' : '1px solid var(--border)',
      borderRadius: mobile ? 0 : 16,
      background: 'var(--bg2)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: mobile ? '0 18px 60px rgba(15,23,42,0.25)' : 'none',
    }}>
      <div style={{
        padding: '12px 12px 10px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Chat history
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={resetChat}
            className="btn btn-sm btn-ghost"
            style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12, padding: '4px 8px' }}
          >
            + New
          </button>

          {mobile && (
            <button
              type="button"
              className="ely-draft-action-btn"
              onClick={() => setShowHistory(false)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text3)',
                cursor: 'pointer',
                fontSize: 24,
                lineHeight: 1,
                padding: '0 2px',
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessionsLoading && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)' }}>
            Loading chats...
          </div>
        )}

        {!sessionsLoading && sortedSessions.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
            No saved project chats yet.
          </div>
        )}

        {sortedSessions.map(session => {
          const active = String(session.id) === String(sessionId);
          const title = session.title || session.auto_title || 'Project chat';
          const date = session.last_message_at || session.updated_at || session.created_at;

          return (
            <div key={session.id} style={{ position: 'relative', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'stretch' }}>
              <button
                type="button"
                onClick={() => selectSession(session.id)}
                style={{
                  flex: 1, textAlign: 'left', border: 'none',
                  background: active ? 'var(--blue-bg)' : 'transparent',
                  color: active ? 'var(--blue)' : 'var(--text)',
                  cursor: 'pointer', padding: '10px 12px', lineHeight: '20px',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: active ? 800 : 650, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {title}
                </div>
                {date && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                    {new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); if (window.confirm('Delete this chat session? This cannot be undone.')) deleteSession(session.id); }}
                title="Delete session"
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '0 10px', fontSize: 14, flexShrink: 0, opacity: 0.5 }}
              >🗑</button>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{
      position: 'relative',
      display: isMobile ? 'flex' : 'grid',
      gridTemplateColumns: !isMobile && showHistory ? '230px minmax(0, 1fr)' : 'minmax(0, 1fr)',
      gap: isMobile ? 0 : 14,
      height: isMobile ? 'calc(100dvh - 190px)' : '60vh',
      minHeight: isMobile ? 0 : 430,
      width: '100%',
      maxWidth: '100%',
      overflow: 'hidden',
    }}>
      {!isMobile && showHistory && renderHistoryPanel(false)}

      {isMobile && showHistory && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 900,
          background: 'rgba(15,23,42,0.45)',
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
        }}>
          <div style={{ width: '82vw', maxWidth: 320, height: '100%' }}>
            {renderHistoryPanel(true)}
          </div>
          <button
            type="button"
            aria-label="Close chat history"
            onClick={() => setShowHistory(false)}
            style={{ flex: 1, border: 'none', background: 'transparent' }}
          />
        </div>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        background: isMobile ? 'var(--bg)' : 'transparent',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: isMobile ? '8px 0 10px' : '0 0 10px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 10,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button
              type="button"
              onClick={() => setShowHistory(prev => isMobile ? true : !prev)}
              title="Chat history"
              aria-label="Chat history"
              className="btn btn-sm btn-ghost"
              style={{
                cursor: 'pointer',
                borderRadius: 99,
                minWidth: isMobile ? 38 : 'auto',
                height: isMobile ? 34 : 'auto',
                padding: isMobile ? 0 : '6px 10px',
                fontSize: isMobile ? 20 : 12,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                overflow: 'visible',
              }}
            >
              {isMobile ? '☰' : showHistory ? 'Hide history' : 'Show history'}
            </button>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 14 : 13, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>
                Project Chat
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? '58vw' : 420 }}>
                {projectRef}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={resetChat}
            className="btn btn-sm btn-ghost"
            style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12, flexShrink: 0 }}
          >
            + New
          </button>
        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: isMobile ? '0 0 130px' : '0 0 12px',
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: isMobile ? '50px 16px' : '40px 16px', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
              Ask Ely anything about {projectRef}
            </div>
          )}

          


{messages.map(msg => {
  const split = msg.role !== 'user'
    ? splitDraftMessage(msg.content)
    : { intro: msg.content, draft: '', outro: '' };

  const inferredRecipient = getProjectDraftRecipient({
    project,
    draft: split.draft,
    intro: split.intro,
  });

  const inferredSubject = split.intro?.match(/subject[:\s]+(.+)/i)?.[1]?.trim()
    || (project?.ref ? `Re: ${project.ref}` : '');

  return (
    <div
      key={msg.id}
      style={{
        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: isMobile ? '94%' : '82%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {split.intro && (
        <div style={{
          width: 'fit-content',
          maxWidth: '100%',
          overflowWrap: 'anywhere',
          background: msg.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
          color: msg.role === 'user' ? '#fff' : 'var(--text)',
          padding: '10px 14px',
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}>
          {split.intro}
        </div>
      )}

      {split.draft && (
        <div style={{
          background: '#fff',
          color: '#111827',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '12px 14px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            whiteSpace: 'pre-wrap',
            fontSize: 13,
            lineHeight: 1.55,
          }}>
            {split.draft}
          </div>

          <div style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid #e5e7eb',
          }}>
            <button
              type="button"
              className="ely-draft-action-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(split.draft);
                  flashDraftAction('Draft copied');
                } catch {
                  flashDraftAction('Copy failed');
                }
              }}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg2)',
                borderRadius: 999,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Copy draft
            </button>

            <button
              type="button"
              className="ely-draft-action-btn"
              onClick={() => {
                if (typeof onOpenComposer === 'function') {
                  onOpenComposer({
                    mode: 'compose',
                    body: split.draft,
                    subject: split.subject || inferredSubject || '',
                    to: inferredRecipient,
                    projectId: project?.id || projectId,
                  });
                } else {
                  window.dispatchEvent(new CustomEvent('ely-compose-draft', {
                    detail: { body: split.draft, to: inferredRecipient, subject: split.subject || inferredSubject || '' }
                  }));
                }
                flashDraftAction('Draft sent to email composer');
              }}
              style={{
                border: '1px solid var(--blue)',
                background: 'var(--blue-bg)',
                color: 'var(--blue)',
                borderRadius: 999,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Open in email composer
            </button>

            <button
              type="button"
              className="ely-draft-action-btn"
              onClick={() => {
                const win = window.open('', '_blank', 'noopener,noreferrer');
                if (!win) {
                  flashDraftAction('Popup blocked');
                  return;
                }

                const escaped = split.draft
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\n/g, '<br />');

                win.document.write(`
                  <!doctype html>
                  <html>
                    <head>
                      <title>Draft PDF</title>
                      <style>
                        body {
                          font-family: Arial, sans-serif;
                          font-size: 12pt;
                          line-height: 1.55;
                          padding: 36px;
                          color: #111827;
                        }
                      </style>
                    </head>
                    <body>${escaped}</body>
                  </html>
                `);
                win.document.close();
                win.focus();
                setTimeout(() => win.print(), 300);
                flashDraftAction('PDF window opened');
              }}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg2)',
                borderRadius: 999,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Generate PDF
            </button>
          </div>

          {draftActionStatus && (
            <div style={{
              marginTop: 8,
              fontSize: 12,
              color: 'var(--green)',
              fontWeight: 600,
            }}>
              {draftActionStatus}
            </div>
          )}
        </div>
      )}

      {split.outro && (
        <div style={{
          width: 'fit-content',
          maxWidth: '100%',
          overflowWrap: 'anywhere',
          background: 'var(--bg3)',
          color: 'var(--text)',
          padding: '10px 14px',
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}>
          {split.outro}
        </div>
      )}
    </div>
  );
})}


          {loading && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--bg3)', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: 'var(--text3)' }}>
              ✨ Thinking...
            </div>
          )}

          <div ref={endRef} />
        </div>

        <div style={isMobile ? {
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: 'var(--bg)',
          padding: '0 12px env(safe-area-inset-bottom, 8px)',
          boxShadow: '0 -1px 0 var(--border)',
        } : { flexShrink: 0 }}>
          {attachedFiles.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: 8,
              maxHeight: 74,
              overflowY: 'auto',
            }}>
              {attachedFiles.map(file => (
                <div
                  key={file.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 9px',
                    borderRadius: 99,
                    border: '1px solid var(--border)',
                    background: 'var(--bg3)',
                    fontSize: 12,
                    color: 'var(--text2)',
                    maxWidth: isMobile ? '100%' : 260,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📎 {file.file_name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedFiles(prev => prev.filter(f => f.id !== file.id))}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text3)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', width: '100%', padding: '8px 0 0' }}>
            <input ref={fileInputRef} type="file" multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
              onChange={handleFilesSelected} style={{ display: 'none' }} />

            {/* Land Registry AO suggestion banner */}
            {landRegistryAO && (
              <div style={{
                margin: '8px 0', padding: '12px 16px', borderRadius: 10,
                background: 'var(--blue-bg)', border: '1px solid var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                    🏠 Add as Adjoining Owner?
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    <strong>{landRegistryAO.name}</strong> — {landRegistryAO.premise}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => {
                      setLandRegistryAO(null);
                      setEditingAO({ ...landRegistryAO, isNew: true, _mode: 'add' });
                    }}
                    style={{
                      padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none',
                    }}
                  >
                    + Add AO
                  </button>
                  <button
                    onClick={() => setLandRegistryAO(null)}
                    style={{
                      padding: '6px 12px', borderRadius: 99, fontSize: 12,
                      cursor: 'pointer', background: 'transparent', color: 'var(--text3)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Input bar — shared ChatInputBar */}
            <ChatInputBar
              value={input}
              onChange={setInput}
              onSend={({ text, file }) => handleSend(text, file)}
              placeholder={`Ask about ${projectRef}...`}
              disabled={loading || uploading}
              loading={loading}
              stopSignal={voiceStopSignal}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function getProjectDraftRecipient({ project, draft = '', intro = '' }) {
  const haystack = `${intro || ''}\n${draft || ''}`.toLowerCase();

  const boEmail = firstNonEmpty(
    project?.bo_email,
    project?.bo_1_email,
    project?.building_owner_email,
    project?.owner_email,
  );

  const aoEmail = firstNonEmpty(
    project?.ao_email,
    project?.ao_1_email,
    project?.adjoining_owner_email,
  );

  const mentionsBO =
    haystack.includes('building owner') ||
    haystack.includes('bo ') ||
    haystack.includes('bo,') ||
    haystack.includes('bo.') ||
    haystack.includes(String(project?.bo_1_name || project?.bo || '').toLowerCase());

  const mentionsAO =
    haystack.includes('adjoining owner') ||
    haystack.includes('ao ') ||
    haystack.includes('ao,') ||
    haystack.includes('ao.') ||
    haystack.includes(String(project?.ao_1_name || project?.ao || '').toLowerCase());

  if (mentionsBO && boEmail) return boEmail;
  if (mentionsAO && aoEmail) return aoEmail;

  return boEmail || aoEmail || '';
}


function splitDraftMessage(content = '') {
  const text = String(content || '').trim();

  const markers = ['Subject:', 'Dear ', 'Hi ', 'Hello '];
  let idx = -1;

  for (const marker of markers) {
    const found = text.indexOf(marker);
    if (found !== -1 && (idx === -1 || found < idx)) idx = found;
  }

  if (idx === -1) {
    return { intro: text, draft: '', outro: '' };
  }

  const intro = text.slice(0, idx).trim();
  let draft = text.slice(idx).trim();
  let outro = '';

  const outroPatterns = [
    /\n\s*Let me know if[\s\S]*$/i,
    /\n\s*Please let me know if[\s\S]*$/i,
    /\n\s*Happy to amend[\s\S]*$/i,
    /\n\s*I can amend[\s\S]*$/i,
    /\n\s*I can revise[\s\S]*$/i,
    /\n\s*I can also[\s\S]*$/i,
    /\n\s*This keeps[\s\S]*$/i,
    /\n\s*That should[\s\S]*$/i,
  ];

  for (const rx of outroPatterns) {
    const match = draft.match(rx);
    if (match) {
      outro = match[0].trim();
      draft = draft.replace(rx, '').trim();
      break;
    }
  }

  return { intro, draft, outro };
}

export default function ProjectDetail({ project: initialProject, onBack, onOpenComposer, onRaiseInvoice, onOpenSOC, onOpenDisputeAgreement }) {
  const [tab, setTab] = useState('details');
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [oneDriveFiles, setOneDriveFiles] = useState([]);
  const [oneDriveLoading, setOneDriveLoading] = useState(false);
  const [oneDriveError, setOneDriveError] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = project root
  const [subFolders, setSubFolders] = useState([]); // AO subfolders discovered in root
  const [oneDriveRefresh, setOneDriveRefresh] = useState(0); // increment to force reload
  const [loaLoading, setLoaLoading] = useState(null);
  const [awardLoading, setAwardLoading] = useState(null);
  const [boAgreedSurveyorMode, setBoAgreedSurveyorMode] = useState(
    () => (initialProject?.aos || []).some(a => a.agreed_surveyor || a.agreedSurveyor)
  );
  const [project, setProject] = useState(initialProject);
  const [showProjectEdit, setShowProjectEdit] = useState(false);
  const [editingAO, setEditingAO] = useState(null);
  const [showAddAO, setShowAddAO] = useState(false);
  const [s104bAO, setS104bAO] = useState(null);
  const [noticeModal, setNoticeModal] = useState(null);
  const [emailResponseTasks, setEmailResponseTasks] = useState([]);

  // Defensive cleanup: remove legacy floating Notices card only.
  useEffect(() => {
    const killGhostNoticeCard = () => {
      try {
        const allDivs = Array.from(document.querySelectorAll('div'));

        allDivs.forEach(el => {
          const txt = (el.innerText || '').trim();

          const isLegacyNoticeCard =
            txt.includes('Generate and record notices for one or more adjoining owners') &&
            txt.includes('Serve notice');

          const isCorrectNewCard =
            txt.includes('Select AOs') ||
            txt.includes('generate notice pack');

          if (isLegacyNoticeCard && !isCorrectNewCard) {
            const card =
              el.closest('[style*="position"]') ||
              el.closest('div');

            if (card) {
              card.style.display = 'none';
            }
          }
        });
      } catch (err) {
        console.warn('Ghost notice cleanup failed', err);
      }
    };

    const timer = setTimeout(killGhostNoticeCard, 300);

    return () => clearTimeout(timer);
  }, [tab, project?.id, noticeModal]);


  const windowWidth = useWindowWidth();

  // Re-fetch from DB on every project open — prevents stale parent cache overwriting saved notice data
  useEffect(() => {
    if (!initialProject?.id) { setProject(initialProject); return; }
    sb.from('projects').select('*').eq('id', initialProject.id).single()
      .then(({ data, error }) => {
        if (data && !error) setProject(data);
        else setProject(initialProject);
      })
      .catch(() => setProject(initialProject));
  }, [initialProject?.id]);

  const { generateDocument, sendForSignature } = useDocumentGenerator();

  const role = getRole(project);
  const primaryAO = getPrimaryAO(project);
  const appointmentAddress = getAppointmentAddress(project);
  const appointmentName = getAppointmentName(project);
  const boAddress = project.bo_premise_address || '';
  const bo = project.bo || project.bo_1_name || '';
  const boEmail = project.bo_email || project.bo_1_email || '';
  const works = project.works || '';
  const aos = project.aos || [];
  const modalAOs = Array.isArray(aos) && aos.length ? aos : (Array.isArray(project?.aos) ? project.aos : []);
  const docs = project.documents || [];
  const projColour = getProjectColour(project);
  const roleLabel = role === 'AO' ? "Adjoining Owner's Surveyor" : "Building Owner's Surveyor";
  const titleAddress = appointmentAddress || boAddress || 'Address not recorded';

  const stageIndex = project.status === 'complete' ? 4
    : role === 'AO' ? 2
    : aos.some(ao => ['consent', 'dissent', 's10'].includes((ao.status || '').toLowerCase())) ? 2
    : aos.some(ao => aoNotice(ao) || (ao.status || '').toLowerCase() === 'notice_served') ? 1
    : 0;

  // Load open email_response tasks for this project
  useEffect(() => {
    if (!project?.id || !sb) return;
    sb.from('tasks')
      .select('id, title, due_date, status, metadata, task_type')
      .eq('project_id', project.id)
      .in('task_type', ['email_response', 'email_action'])
      .eq('status', 'open')
      .then(({ data }) => setEmailResponseTasks(data || []));
  }, [project?.id]);

  const upcoming = [];

  if (role !== 'AO') {
    aos.forEach(ao => {
      const cd = aoConsent(ao);
      if (cd) upcoming.push({ label: `Consent deadline -- ${aoAddress(ao) || ao.name}`, date: cd, days: daysUntil(cd) });

      const sd = aoS10(ao);
      if (sd) upcoming.push({ label: `S.10 deadline -- ${ao.name}`, date: sd, days: daysUntil(sd) });
    });
  }

  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  useEffect(() => {
    if (tab !== 'emails' || !sb) return;

    setEmailsLoading(true);

    sb.from('emails')
      .select('id,subject,sender_name,sender_email,to_email,direction,received_at,sent_at,is_read,body_preview,body,raw_recipients')
      .eq('project_id', project.id)
      .order('received_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setEmails(data || []);
        setEmailsLoading(false);
      });
  }, [tab, project.id]);

  // Reset folder selection when leaving documents tab
  useEffect(() => {
    if (tab !== 'documents') {
      setSelectedFolderId(null);
      setSubFolders([]);
      setOneDriveFiles([]);
    }
  }, [tab]);

  // Load OneDrive files when Documents tab opens or folder selection changes
  useEffect(() => {
    if (tab !== 'documents') return;
    const rootFolderId = project?.onedrive_folder_id;
    if (!rootFolderId) { setOneDriveFiles([]); setSubFolders([]); return; }
    // Which folder to load — selected subfolder or project root
    const folderId = selectedFolderId || rootFolderId;
    setOneDriveLoading(true);
    setOneDriveError(null);
    fetch('/api/onedrive-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'help@sq1consulting.co.uk',
        action: 'get_folder_contents',
        project_folder_id: folderId,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const items = data.items || [];
          setOneDriveFiles(items);
          // When loading root, extract subfolders for pills
          if (!selectedFolderId) {
            setSubFolders(items.filter(i => !!i.folder));
          }
        } else {
          setOneDriveError(data.error || 'Failed to load files');
        }
      })
      .catch(err => setOneDriveError(err.message))
      .finally(() => setOneDriveLoading(false));
  }, [tab, project?.onedrive_folder_id, selectedFolderId, oneDriveRefresh]);

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

  const handleDownloadBOLOAPdf = useCallback(async () => {
    setLoaLoading('bo_pdf');
    try {
      const r = await generateDocument({
        templateKey: 'loa_bo_pdf',
        mergeData: buildBOLOAPdfPlaceholders(project),
        fileName: buildLOAPdfFileName('bo', project),
        projectId: project.id,
      });
      if (!r.success) alert(r.error || 'Could not generate LoA PDF.');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoaLoading(null);
    }
  }, [generateDocument, project]);

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

  const handleDownloadAOLOAPdf = useCallback(async (ao) => {
    const aoKey = `ao-pdf-${ao.id || ao.num || ao.name || 'unknown'}`;
    setLoaLoading(aoKey);
    try {
      const r = await generateDocument({
        templateKey: 'loa_ao_pdf',
        mergeData: buildAOLOAPdfPlaceholders(project, ao),
        fileName: buildLOAPdfFileName('ao', project, ao),
        projectId: project.id,
      });
      if (!r.success) alert(r.error || 'Could not generate LoA PDF.');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoaLoading(null);
    }
  }, [generateDocument, project]);

  const handleGenerateAward = useCallback(async (ao) => {
    const aoKey = `ao-${ao.id || ao.num || ao.name || 'unknown'}`;
    setAwardLoading(aoKey);

    try {
      // Load notices served for this project and AO to build the correct section string
      let noticeSection = null;
      let noticeServedDate = null;
      try {
        const { data: noticeRows } = await sb
          .from('notices')
          .select('section_1, section_2, section_3, section_6, section_2_subsections, notice_date')
          .eq('project_id', String(project.id))
          .eq('status', 'served')
          .order('notice_date', { ascending: true });

        if (noticeRows && noticeRows.length > 0) {
          const hasS1 = noticeRows.some(n => n.section_1);
          const hasS2 = noticeRows.some(n => n.section_2);
          const hasS3 = noticeRows.some(n => n.section_3);
          const hasS6 = noticeRows.some(n => n.section_6);
          const s2Subs = noticeRows
            .filter(n => n.section_2 && n.section_2_subsections)
            .map(n => n.section_2_subsections)
            .join(',');
          const s2SubFormatted = s2Subs
            ? s2Subs.split(',').map(s => '(' + s.trim() + ')').filter(Boolean).join('')
            : '';

          const parts = [];
          if (hasS6) parts.push('Section 6(1)');
          if (hasS1) parts.push('Section 1(5)');
          if (hasS2) parts.push('Section 2(2)' + s2SubFormatted);
          if (hasS3 && !hasS2) parts.push('Section 3');
          if (parts.length > 0) {
            noticeSection = parts.length === 1
              ? parts[0]
              : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
          }
          noticeServedDate = noticeRows[0].notice_date;
        }
      } catch (e) {
        console.warn('[Award] Could not load notices:', e.message);
      }

      const award = buildAwardPlaceholders(project, ao, {
        ...(noticeSection ? { noticeSection } : {}),
        ...(noticeServedDate ? { noticeDate: noticeServedDate } : {}),
        ...(boAgreedSurveyorMode ? { agreedSurveyor: true } : {}),
      });

      if (!award?.isValid) {
        alert(`Cannot generate ${award?.awardTypeLabel || 'award'} yet. Missing:\n\n${(award?.missing || []).map(item => `- ${item}`).join('\n')}`);
        return;
      }

      const result = await generateDocument({
        templateKey: award.templateKey,
        mergeData: award.mergeData,
        fileName: award.fileName,
        projectId: project.id,
      });

      if (!result?.success) {
        throw new Error(result?.error || 'Could not generate award.');
      }

      alert(`${award.awardTypeLabel || 'Award'} generated successfully.`);
    } catch (err) {
      alert(err.message || 'Could not generate award.');
    } finally {
      setAwardLoading(null);
    }
  }, [generateDocument, project]);

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
      bo_phone: form.bo1?.phone || null,
      bo_2_name: form.bo2?.name || null,
      bo_2_email: form.bo2?.email || null,

      works: form.works || null,
      fee: Number.isFinite(fee) ? fee : null,
      status: form.status || 'active',
    };

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

    // Only update the aos jsonb column — address/appointment_address/appointment_name
    // do not exist as top-level columns; getAppointmentAddress/Name read from the aos array directly
    const data = await updateProjectSafely(project.id, { aos: updatedAOs });

    setProject(prev => ({
      ...prev,
      aos: updatedAOs,
      ...(data || {}),
    }));

    // Auto-create OneDrive subfolder for new AOs and save folder ID back
    if (!existingAO) {
      const aoAddress = form.premise || '';
      const projectFolderId = project.onedrive_folder_id || data?.onedrive_folder_id;
      if (aoAddress && projectFolderId) {
        try {
          const folderRes = await fetch('/api/onedrive-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: 'help@sq1consulting.co.uk',
              action: 'create_ao_folder',
              project_folder_id: projectFolderId,
              ao_address: aoAddress,
            }),
          });
          const folderData = await folderRes.json();
          if (folderData.success && folderData.folder_id) {
            // Save folder ID into the AO's entry in the aos array
            const withFolder = updatedAOs.map(a =>
              a.id === newAO.id ? {
                ...a,
                onedrive_folder_id: folderData.folder_id,
                onedrive_folder_url: folderData.web_url || null,
              } : a
            );
            await updateProjectSafely(project.id, { aos: withFolder });
            setProject(prev => ({ ...prev, aos: withFolder }));
          }
        } catch (err) {
          console.warn('[handleSaveAO] OneDrive AO folder creation failed:', err.message);
        }
      }
    }
  }, [project, role]);

  const updateAORecord = useCallback(async (ao, patch) => {
    const currentAOs = project.aos || [];
    const updatedAOs = currentAOs.map(item => aoKeyMatches(item, ao)
      ? { ...item, ...patch, updated_at: new Date().toISOString() }
      : item
    );

    const data = await updateProjectSafely(project.id, { aos: updatedAOs });

    setProject(prev => ({
      ...prev,
      aos: updatedAOs,
      ...(data || {}),
    }));
  }, [project.id, project.aos]);

  const createProjectTask = useCallback(async ({ title, description, due_date, task_type, ao }) => {
    try {
      const aoToken = ao?.id || `AO${ao?.num || ''}`;

      const { data: existing } = await sb
        .from('tasks')
        .select('id')
        .eq('project_id', project.id)
        .eq('task_type', task_type)
        .eq('due_date', due_date)
        .ilike('description', `%AO_REF:${aoToken}%`)
        .limit(1);

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


  const saveNoticeRecord = useCallback(async ({ ao, selectedSections, includeCover, noticeDate, section2Subsections = '' }) => {
    // Calculate next run_number for this project/AO
    const aoId = ao?.id || String(ao?.num || '');
    const { data: existingRuns } = await sb
      .from('notices')
      .select('run_number')
      .eq('project_id', project.id)
      .eq('ao_id', aoId)
      .order('run_number', { ascending: false })
      .limit(1);
    const runNumber = existingRuns?.[0]?.run_number ? existingRuns[0].run_number + 1 : 1;

    const record = {
      project_id: project.id,
      ao_id: aoId,
      section_1: selectedSections.includes('s1'),
      section_3: selectedSections.includes('s3'),
      section_6: selectedSections.includes('s6'),
      section_2: selectedSections.includes('s2'),
      section_10: selectedSections.includes('s10'),
      notice_cover_letter: !!includeCover,
      notice_date: noticeDate,
      status: 'served',
      template_type: selectedSections.includes('s10') ? 's10' : 'notice_pack',
      run_number: runNumber,
      section_2_subsections: selectedSections.includes('s2') ? section2Subsections : null,
    };

    try {
      await sb.from('notices').insert([record]);
    } catch (err) {
      console.warn('Could not save notices table record:', err?.message || err);
    }

    try {
      const existing = Array.isArray(project.notices) ? project.notices : [];
      await updateProjectSafely(project.id, {
        notices: [
          ...existing,
          {
            ...record,
            id: `notice-${Date.now()}`,
            created_at: new Date().toISOString(),
            sections: selectedSections,
          },
        ],
      });
    } catch (err) {
      console.warn('Could not update project notices json:', err?.message || err);
    }
  }, [project]);

  const handleOpenNoticeModal = useCallback((ao, defaultSections = []) => {
    setNoticeModal({ ao, defaultSections });
  }, []);

  const handleServeNotice = useCallback((ao) => {
    handleOpenNoticeModal(ao, []);
  }, [handleOpenNoticeModal]);

  const handleServe104b = useCallback(async (ao) => {
    if (!window.confirm('Confirm 10(4)(b) papers have been served?')) return;
    const date = new Date().toISOString().slice(0, 10);
    const updatedAOs = (project.aos || []).map(a =>
      a.id === ao.id ? { ...a, s104b_served_date: date, s104bServedDate: date, status: 's104b' } : a
    );
    await sb.from('projects').update({ aos: updatedAOs }).eq('id', project.id);
    setProject(p => ({ ...p, aos: updatedAOs }));
  }, [project, sb]);

  const handleServeAward = useCallback(async (ao) => {
    if (!window.confirm('Confirm the award has been served?')) return;
    const date = new Date().toISOString().slice(0, 10);
    const updatedAOs = (project.aos || []).map(a =>
      a.id === ao.id ? { ...a, award_served_date: date, awardServedDate: date, status: 'complete' } : a
    );
    await sb.from('projects').update({ aos: updatedAOs }).eq('id', project.id);
    setProject(p => ({ ...p, aos: updatedAOs }));
  }, [project, sb]);

  const handleServeS10 = useCallback((ao) => {
    handleOpenNoticeModal(ao, ['s10']);
  }, [handleOpenNoticeModal]);

  // ── Serve notices: persist workflow first, generate documents second ──
  const handleServeNoticePack = useCallback(async ({
    ao,
    sections,
    includeCover,
    noticeDate: suppliedNoticeDate,
    createDeadlineTask = true,
    section2Subsections = '',
    worksItems = [],
  }) => {
    const noticeDate = suppliedNoticeDate || todayIso();
    const generatedDocs = [];
    const warnings = [];

    if (!ao) throw new Error('No adjoining owner selected.');
    if (!sections?.length && !includeCover) throw new Error('No notice selected.');

    // STEP 1: persist legal/workflow state first
    await saveNoticeRecord({ ao, selectedSections: sections, includeCover, noticeDate, section2Subsections });

    const nonS10 = sections.filter(s => ['s1', 's2', 's3', 's6'].includes(s));
    if (nonS10.length > 0) {
      const deadline = addDaysIsoFromDate(noticeDate, 14);

      await updateAORecord(ao, {
        status: 'notice_served',
        notice_served_date: noticeDate,
        noticeServedDate: noticeDate,
        consent_deadline: deadline,
        consentDeadline: deadline,
      });

      if (createDeadlineTask) {
        await createProjectTask({
          title: `Consent deadline -- AO${ao.num || ''} ${ao.name || ''}`.trim(),
          description: '14-day notice consent period expired. Review whether Section 10 is required.',
          due_date: deadline,
          task_type: 'notice_consent_deadline',
          ao,
        });
      }
    }

    if (sections.includes('s10')) {
      const deadline = addDaysIsoFromDate(noticeDate, 10);

      await updateAORecord(ao, {
        status: 's10',
        s10_served_date: noticeDate,
        s10ServedDate: noticeDate,
        s10_deadline: deadline,
        s10Deadline: deadline,
      });

      if (createDeadlineTask) {
        await createProjectTask({
          title: `Section 10 deadline -- AO${ao.num || ''} ${ao.name || ''}`.trim(),
          description: '10-day Section 10 notice period expired.',
          due_date: deadline,
          task_type: 'notice_section10_deadline',
          ao,
        });
      }
    }

    // STEP 2: generate documents after workflow state is safely saved
    const zip = new PizZip();

    const keysToGenerate = [...sections];
    if (includeCover) keysToGenerate.unshift('cover');

    for (const key of keysToGenerate) {
      try {
        const mergeData = buildNoticeMergeData({ project, ao, sectionKey: key, includeCover, noticeDate, section2Subsections, allSections: sections, worksItems });
        const result = await generateDocument({
          templateKey: key === 's2' ? 's3' : key, // s2 (Section 2(2)) uses the s3 template
          mergeData,
          fileName: mergeData.file_name,
          projectId: project.id,
          skipDownload: keysToGenerate.length > 1,
        });

        if (result?.success && result?.docx_b64) {
          generatedDocs.push({ key, fileName: mergeData.file_name, docx_b64: result.docx_b64 });
          addDocxToZip(zip, mergeData.file_name, result.docx_b64);
        } else {
          warnings.push(`${key}: ${result?.error || 'document not generated'}`);
        }
      } catch (err) {
        warnings.push(`${key}: ${err.message}`);
      }
    }

    // STEP 3: download ZIP pack where more than one document generated
    if (generatedDocs.length > 1) {
      const zipB64 = zip.generate({ type: 'base64', compression: 'DEFLATE' });
      const zipName = `${safeFilePart(project.ref || 'Project')}_${safeFilePart(ao?.name || `AO${ao?.num || ''}`)}_Notice_Pack.zip`;
      downloadB64File(zipB64, zipName, 'application/zip');
    }

    const warningText = warnings.length ? `\n\nWarnings:\n${warnings.join('\n')}` : '';
    alert(`Notice workflow saved. ${generatedDocs.length} document(s) generated.${warningText}`);
  }, [project, generateDocument, saveNoticeRecord, updateAORecord, createProjectTask]);

  const handleSetAOStatus = useCallback(async (ao, status) => {
    const patch = { status, last_status_change: new Date().toISOString() };

    if (status === 'consent') {
      patch.consent_received_date = todayISODate();
      patch.consentReceivedDate = todayISODate();
    }

    if (status === 'dissent') {
      patch.dissent_received_date = todayISODate();
      patch.dissentReceivedDate = todayISODate();
    }

    await updateAORecord(ao, patch);

    // Close any open deadline tasks for this AO when consent or dissent is received
    if (['consent', 'dissent'].includes(status) && sb && project?.id) {
      const aoId = ao?.id || String(ao?.num || '');
      if (aoId) {
        await sb.from('tasks')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('project_id', project.id)
          .eq('ao_id', aoId)
          .in('task_type', ['notice_consent_deadline', 'notice_section10_deadline'])
          .eq('status', 'open');
      }
    }
  }, [updateAORecord, project?.id]);

  const handleToggleAgreedSurveyor = useCallback(async (ao) => {
    const next = !ao.agreed_surveyor;
    await updateAORecord(ao, {
      agreed_surveyor: next,
      agreedSurveyor: next,
      status: next ? 'dissent' : (ao.status || 'notice_served'),
      agreed_surveyor_updated_at: todayISODate(),
      last_status_change: new Date().toISOString(),
    });
  }, [updateAORecord]);

  const handleNoteIntention = useCallback(async (ao) => {
    await updateAORecord(ao, {
      intention_noted: true,
      intention_noted_date: todayISODate(),
      status: ao.status || 'notice_served',
    });
  }, [updateAORecord]);

  const handleOpenSOCForAO = useCallback((ao) => {
    onOpenSOC?.({
      ...project,
      selectedAO: ao,
      selected_ao: ao,
      selected_ao_id: ao.id || ao.num,
      soc_target_ao: ao,
    });
  }, [onOpenSOC, project]);

  const handleRaiseInvoice = useCallback(() => {
    // Invoice is always raised against the Building Owner regardless of surveyor role
    const boBillToName = project.bo || project.bo_1_name || project.bo_name || '';
    const boBillToAddress =
      project.bo_service_address ||
      project.bo_1_service_address ||
      project.bo_address ||
      project.bo_premise_address ||
      project.address ||
      '';

    onRaiseInvoice?.({
      property_address: appointmentAddress || boAddress,
      bill_to_name: boBillToName,
      bill_to_address: boBillToAddress,
      role,
      project_id: project.id,
    });
  }, [onRaiseInvoice, project, appointmentAddress, boAddress, role]);


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
  }, [sb, project, onBack]);

  const handleMarkAwardServed = async () => {
    if (!window.confirm('Mark this project as Award Served? It will move out of the active project list.')) return;
    try {
      const { error } = await sb
        .from('projects')
        .update({ status: 'award_served' })
        .eq('id', project.id);
      if (error) throw error;
      onBack?.(); // Return to project list after marking award served
    } catch (err) {
      console.error('[ProjectDetail] mark award served failed:', err.message);
      // Don't alert — update likely succeeded, onBack may have caused the catch
    }
  };

  const handleReactivateProject = async () => {
    if (!window.confirm('Reactivate this project? It will return to the active project list.')) return;
    try {
      const { error } = await sb
        .from('projects')
        .update({ status: 'active' })
        .eq('id', project.id);
      if (error) throw error;
      onBack?.(); // Return to list after reactivating
    } catch (err) {
      console.error('[ProjectDetail] reactivate failed:', err.message);
    }
  };


  const TABS = [
    { id: 'details', label: 'Details' },
    { id: 'emails', label: 'Emails' },
    { id: 'documents', label: 'Documents' },
    { id: 'chat', label: '💬 Chat' },
  ];

  return (
    <div style={{ padding: '0 18px 28px' }}>
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



      {tab === 'details' && noticeModal && (
        <NoticeServingModal
          project={project}
          ao={noticeModal.ao}
          aos={modalAOs}
          defaultSections={noticeModal.defaultSections || []}
          generateDocument={generateDocument}
          onServe={({ ao: servedAO, sections, includeCover, noticeDate, createDeadlineTask, section2Subsections, worksItems }) =>
            handleServeNoticePack({
              ao: servedAO || noticeModal.ao,
              sections,
              includeCover,
              noticeDate,
              createDeadlineTask,
              section2Subsections,
              worksItems,
            })
          }
          onClose={() => setNoticeModal(null)}
        />
      )}

      {s104bAO && (
        <S104BSurveyorModal
          ao={s104bAO}
          onSave={handleSave104BSurveyorDetails}
          onClose={() => setS104bAO(null)}
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

      <div style={{
        display: 'grid',
        gridTemplateColumns: windowWidth < 768 ? '1fr' : 'auto minmax(260px, 1fr) auto',
        alignItems: 'center',
        gap: 12,
        padding: '8px 0 12px',
        marginBottom: 10,
        borderBottom: '1px solid var(--border)',
      }}>
        <button onClick={onBack} style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          padding: '4px 11px',
          borderRadius: 99,
          border: '1px solid var(--border)',
          background: 'var(--bg2)',
          color: 'var(--text2)',
          fontSize: 12,
          cursor: 'pointer',
          fontWeight: 500,
          height: 30,
          width: windowWidth < 768 ? 'fit-content' : 'auto',
        }}>
          ← Back
        </button>

        <div style={{
          display: 'flex',
          justifyContent: windowWidth < 768 ? 'flex-start' : 'center',
          alignItems: 'center',
          gap: 3,
          minWidth: 0,
          overflowX: 'auto',
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setNoticeModal(null); }}
              style={{
                padding: '6px 14px',
                fontSize: 12.5,
                border: 'none',
                cursor: 'pointer',
                background: tab === t.id ? 'var(--blue-bg)' : 'transparent',
                fontWeight: tab === t.id ? 700 : 500,
                color: tab === t.id ? 'var(--blue)' : 'var(--text2)',
                borderRadius: 99,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{
          display: 'flex',
          gap: 6,
          justifyContent: windowWidth < 768 ? 'flex-start' : 'flex-end',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowProjectEdit(true)} style={{
            cursor: 'pointer',
            borderRadius: 99,
            padding: '4px 10px',
            fontSize: 12,
            minHeight: 30,
          }}>
            Edit
          </button>

          {project.status !== 'award_served' && project.status !== 'complete' && (
            <button
              onClick={handleMarkAwardServed}
              style={{
                cursor: 'pointer',
                borderRadius: 99,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                minHeight: 30,
                background: '#f0fdf4',
                color: '#16a34a',
                border: '1px solid #bbf7d0',
              }}
            >
              ✓ Award Served
            </button>
          )}

          {project.status === 'award_served' && (
            <button
              onClick={handleReactivateProject}
              style={{
                cursor: 'pointer',
                borderRadius: 99,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 500,
                minHeight: 30,
                background: 'var(--bg2)',
                color: 'var(--text2)',
                border: '1px solid var(--border)',
              }}
            >
              ↩ Reactivate
            </button>
          )}

          <button
            className="btn btn-sm btn-ghost"
            onClick={handleDeleteProject}
            style={{
              cursor: 'pointer',
              color: 'var(--red)',
              borderRadius: 99,
              padding: '4px 10px',
              fontSize: 12,
              minHeight: 30,
            }}
          >
            Delete
          </button>

          <button style={{
            padding: '4px 11px',
            borderRadius: 99,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            background: 'var(--amber-bg)',
            color: 'var(--amber)',
            border: '1px solid var(--amber)',
            minHeight: 30,
          }}>
            🔒 Close project
          </button>
        </div>
      </div>

      {tab === 'details' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: windowWidth < 768 ? '1fr' : 'minmax(0, 1fr) 268px',
          gap: 14,
          alignItems: 'start',
        }}>
          <div>
            <div style={{ ...card({ padding: '16px 18px', marginBottom: 14 }) }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12, lineHeight: 1.35 }}>
                {titleAddress}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', marginBottom: 12 }}>
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

                  {role === 'AO' && (
                    <div style={{
                      marginTop: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}>
                      <div
                        onClick={async () => {
                          const next = !boAgreedSurveyorMode;
                          setBoAgreedSurveyorMode(next);
                          // Save agreed_surveyor flag into each AO in the aos JSON array
                          const currentAOs = project.aos || [];
                          const updatedAOs = currentAOs.map(a => ({
                            ...a,
                            agreed_surveyor: next,
                            agreedSurveyor: next,
                          }));
                          try {
                            await updateProjectSafely(project.id, { aos: updatedAOs });
                            setProject(prev => ({ ...prev, aos: updatedAOs }));
                          } catch (e) {
                            console.warn('[agreed surveyor toggle] save failed:', e.message);
                          }
                        }}
                        role="switch"
                        aria-checked={boAgreedSurveyorMode}
                        title="Toggle agreed surveyor appointment for the Building Owner"
                        style={{
                          width: 34,
                          height: 19,
                          borderRadius: 10,
                          cursor: 'pointer',
                          position: 'relative',
                          flexShrink: 0,
                          background: boAgreedSurveyorMode ? 'var(--blue)' : 'var(--border2)',
                        }}
                      >
                        <div style={{
                          width: 15,
                          height: 15,
                          borderRadius: '50%',
                          background: '#fff',
                          position: 'absolute',
                          top: 2,
                          left: boAgreedSurveyorMode ? 17 : 2,
                          transition: 'left 0.15s',
                        }} />
                      </div>

                      <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.35 }}>
                        Building Owner agrees to appoint me as Agreed Surveyor
                      </span>
                    </div>
                  )}

                  {(role === 'BO' || boAgreedSurveyorMode) && (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <div style={{ display: 'flex', gap: 1, marginTop: 6 }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={!!loaLoading}
                          onClick={handleGenerateBOLOA}
                          style={{
                            cursor: loaLoading ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            borderRadius: '99px 0 0 99px',
                            opacity: loaLoading ? 0.65 : 1,
                            paddingRight: 8,
                          }}
                        >
                          {loaLoading === 'bo' ? 'Sending…' : '📄 LoA eSignature'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={!!loaLoading}
                          onClick={handleDownloadBOLOAPdf}
                          style={{
                            cursor: loaLoading ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            borderRadius: '0 99px 99px 0',
                            opacity: loaLoading ? 0.65 : 1,
                            paddingLeft: 8,
                            borderLeft: '1px solid var(--border2)',
                          }}
                        >
                          {loaLoading === 'bo_pdf' ? 'Generating…' : '⬇ PDF'}
                        </button>
                      </div>
                    </div>
                  )}
                  {project.bo_loa_signed_at ? (
                    <span title={`BO LOA signed ${new Date(project.bo_loa_signed_at).toLocaleDateString('en-GB')}`}
                      style={{ fontSize: 16, display: 'inline-block', marginTop: 6, cursor: project.bo_loa_signed_pdf_url ? 'pointer' : 'default' }}
                      onClick={() => project.bo_loa_signed_pdf_url && window.open(project.bo_loa_signed_pdf_url, '_blank')}
                    >✅</span>
                  ) : project.bo_loa_sent_at ? (
                    <span title={`BO LOA sent ${new Date(project.bo_loa_sent_at).toLocaleDateString('en-GB')} -- awaiting signature`}
                      style={{ fontSize: 16, display: 'inline-block', marginTop: 6 }}
                    >📤</span>
                  ) : null}
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
                      project={project}
                      onGenerateAOLOA={handleGenerateAOLOA}
                      onDownloadAOLOAPdf={handleDownloadAOLOAPdf}
                      onGenerateAward={handleGenerateAward}
                      onEditAO={setEditingAO}
                      onServeNotice={handleServeNotice}
                      onServeS10={handleServeS10}
                      onServe104b={handleServe104b}
                      onServeAward={handleServeAward}
                      onSetAOStatus={handleSetAOStatus}
                      onToggleAgreedSurveyor={handleToggleAgreedSurveyor}
                      onNoteIntention={handleNoteIntention}
                      onOpenSOCForAO={handleOpenSOCForAO}
                      loaLoading={loaLoading === aoKey}
                      awardLoading={awardLoading === aoKey}
                      emailResponseTasks={emailResponseTasks}
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
              style={{ ...card({ padding: '12px 14px', cursor: 'pointer' }) }}
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

            <div
              style={{ ...card({ padding: '12px 14px', cursor: 'pointer' }) }}
              onClick={() => onOpenDisputeAgreement?.(project)}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--orange, #f97316)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: 'var(--orange-bg, #fff7ed)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}>
                  🤝
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    Dispute Agreement
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                    Dictate · generate Party Agreement · download .docx
                  </div>
                </div>
                <span style={{ color: 'var(--text3)', fontSize: 16 }}>›</span>
              </div>
            </div>

            <div
              style={{ ...card({ padding: '12px 14px', cursor: 'pointer' }) }}
              onClick={() => setNoticeModal({ ao: null, defaultSections: [] })}
            >              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: 'var(--blue-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}>
                  📄
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    Serve Notices
                  </div>

                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                    Select AOs · generate notice pack
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
              emails.map((e, i) => {
                const isOpen = selectedEmailId === e.id;
                const isOutgoing = e.direction === 'outgoing';
                const replyTo = isOutgoing ? e.to_email : (e.sender_email || e.raw_recipients?.from?.email || '');
                const replyName = isOutgoing
                  ? (e.to_email || 'Recipient')
                  : (e.sender_name || e.raw_recipients?.from?.name || e.sender_email || '');
                const displayName = isOutgoing
                  ? `-> ${e.to_email || 'Sent'}`
                  : (e.sender_name || e.raw_recipients?.from?.name || e.sender_email);
                const emailDate = e.sent_at || e.received_at;
                const bodyContent = e.body || e.body_preview || '';
                return (
                  <div key={e.id} style={{
                    borderBottom: i < emails.length - 1 ? '1px solid var(--border)' : 'none',
                    background: isOpen ? 'var(--bg2)' : !e.is_read && !isOutgoing ? 'var(--blue-bg)' : 'transparent',
                  }}>
                    {/* Row header — always visible, click to expand */}
                    <div
                      onClick={() => setSelectedEmailId(isOpen ? null : e.id)}
                      style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: !e.is_read && !isOutgoing ? 600 : 400, color: isOutgoing ? 'var(--text3)' : 'var(--text)' }}>
                          {displayName}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {emailDate ? new Date(emailDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: e.is_read ? 400 : 600, color: 'var(--text2)' }}>
                        {e.subject}
                      </div>
                      {!isOpen && (
                        <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.body_preview || (e.body ? e.body.replace(/<[^>]+>/g, ' ').slice(0, 120) : '')}
                        </div>
                      )}
                    </div>

                    {/* Expanded body */}
                    {isOpen && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, paddingTop: 10 }}>
                          {isOutgoing ? (
                            <><strong>Sent</strong> to: {e.to_email}</>
                          ) : (
                            <>From: <strong>{replyName}</strong>{replyTo && replyTo !== replyName ? ` <${replyTo}>` : ''}</>
                          )}
                          {emailDate && <span style={{ marginLeft: 12 }}>{new Date(emailDate).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                        <div
                          style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, maxHeight: 400, overflowY: 'auto', background: 'var(--bg)', borderRadius: 6, padding: '12px 14px', border: '1px solid var(--border)' }}
                          dangerouslySetInnerHTML={{ __html: bodyContent || '<p style="color:var(--text3);font-style:italic">No content available.</p>' }}
                        />
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          {replyTo && (
                            <button
                              className="btn btn-sm btn-primary"
                              style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12 }}
                              onClick={() => onOpenComposer?.({
                                mode: 'reply',
                                projectId: project.id,
                                to: replyTo,
                                subject: e.subject?.startsWith('Re:') ? e.subject : `Re: ${e.subject || ''}`,
                                replyToEmailId: e.id,
                                threadId: e.thread_id,
                                originalEmail: { from: replyName, subject: e.subject, sender_email: replyTo },
                              })}
                            >
                              ↩ Reply
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12 }}
                            onClick={() => onOpenComposer?.({
                              mode: 'compose',
                              projectId: project.id,
                              to: replyTo,
                              subject: `Re: ${e.subject || ''}`,
                            })}
                          >
                            Forward / New
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div>
          <div style={{ ...card(), padding: 0 }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Project Files</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {project?.onedrive_folder_url && (
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12 }}
                    onClick={() => window.open(project.onedrive_folder_url, '_blank')}
                  >
                    OneDrive ↗
                  </button>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12 }}
                  onClick={() => { setOneDriveFiles([]); setSubFolders([]); setOneDriveError(null); setOneDriveRefresh(n => n + 1); }}
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            {/* Folder pills — project root + AO subfolders */}
            {project?.onedrive_folder_id && (subFolders.length > 0 || selectedFolderId) && (
              <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setSelectedFolderId(null)}
                  style={{
                    padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)',
                    background: !selectedFolderId ? 'var(--accent)' : 'transparent',
                    color: !selectedFolderId ? '#fff' : 'var(--text2)',
                    fontWeight: !selectedFolderId ? 600 : 400,
                  }}
                >
                  📁 Project
                </button>
                {subFolders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                    style={{
                      padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)',
                      background: selectedFolderId === folder.id ? 'var(--accent)' : 'transparent',
                      color: selectedFolderId === folder.id ? '#fff' : 'var(--text2)',
                      fontWeight: selectedFolderId === folder.id ? 600 : 400,
                      maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    📁 {folder.name}
                  </button>
                ))}
              </div>
            )}

            {/* No OneDrive folder linked */}
            {!project?.onedrive_folder_id && (
              <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                No OneDrive folder linked to this project yet. One will be created automatically when the first document is generated.
              </div>
            )}

            {/* Loading */}
            {project?.onedrive_folder_id && oneDriveLoading && (
              <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading files from OneDrive…</div>
            )}

            {/* Error */}
            {oneDriveError && (
              <div style={{ padding: 16, color: 'var(--error, #c0392b)', fontSize: 13 }}>
                Could not load files: {oneDriveError}
              </div>
            )}

            {/* File list */}
            {!oneDriveLoading && !oneDriveError && project?.onedrive_folder_id && oneDriveFiles.length === 0 && (
              <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                No files in this project folder yet. Files you generate or upload to OneDrive will appear here.
              </div>
            )}

            {oneDriveFiles.filter(f => selectedFolderId || !f.folder).map((f, i) => {
              // In root view, subfolders are shown as pills above — hide them from the file list
              // In a subfolder view, show everything including any nested folders
              const isFolder = !!f.folder;
              const ext = (f.name || '').split('.').pop().toLowerCase();
              const icon = isFolder ? '📁' : { pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', jpg: '🖼️', jpeg: '🖼️', png: '🖼️' }[ext] || '📄';
              const sizeKb = f.size ? Math.round(f.size / 1024) : null;
              const modified = f.lastModifiedDateTime ? new Date(f.lastModifiedDateTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

              return (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 16px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {icon} {f.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                      {modified}{sizeKb ? ` . ${sizeKb}kb` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12 }}
                      onClick={() => window.open(f.webUrl, '_blank')}
                    >
                      Open
                    </button>
                    {!isFolder && f.webUrl && (
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ cursor: 'pointer', borderRadius: 99, fontSize: 12 }}
                        onClick={() => onOpenComposer?.({
                          mode: 'compose',
                          projectId: project.id,
                          subject: f.name?.replace(/\.[^.]+$/, '') || 'Document',
                          oneDriveAttachment: { name: f.name, url: f.webUrl, item_id: f.id },
                        })}
                      >
                        Email
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'chat' && <ProjectChat project={project} onOpenComposer={onOpenComposer} />}
    </div>
  );
}






