import { useState } from 'react';
import { buildNoticePlaceholders } from '../../utils/buildNoticePlaceholders';
import PizZip from 'pizzip';

const NOTICE_TYPES = [
  { key: 'section_1', label: 'Section 1', templateKeys: ['s1', 'section_1', 'section_1_notice', 'notice_section_1'] },
  { key: 'section_3', label: 'Section 3', templateKeys: ['s3', 'section_3', 'section_3_notice', 'notice_section_3'] },
  { key: 'section_6', label: 'Section 6', templateKeys: ['s6', 'section_6', 'section_6_notice', 'notice_section_6'] },
  { key: 'section_10', label: 'Section 10', templateKeys: ['s10', 'section_10', 'section_10_notice', 'notice_section_10'] },
];

const aoAddress = ao => ao?.premise || ao?.reg_addr || ao?.address || '';
const aoKey = ao => String(ao?.id || ao?.num || `${ao?.name || ''}-${aoAddress(ao)}`);

function todayISO() { return new Date().toISOString().slice(0, 10); }

function cleanFileName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function downloadB64File(b64, fileName, mimeType) {
  const byteCharacters = atob(b64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); window.URL.revokeObjectURL(url);
}

function ModalShell({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={{ width: 760, maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto', background: '#eef1f5', border: '1px solid #d8dde6', borderRadius: 22, boxShadow: '0 24px 70px rgba(15,23,42,0.35)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#eef1f5', padding: '18px 22px 12px', borderBottom: '1px solid #d8dde6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Serve notice</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: '100%', padding: '8px 12px', fontSize: 13.5, background: '#fff', border: '1px solid #dfe3ea', borderRadius: 10, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };
const sectionStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 };

export default function NoticeServingModal({ project, initialAO = null, generateDocument, onServed, onClose }) {
  const aos = project?.aos || [];
  const [selectedAOKeys, setSelectedAOKeys] = useState(initialAO ? [aoKey(initialAO)] : aos.map(aoKey));
  const [noticeTypes, setNoticeTypes] = useState({ section_1: false, section_3: false, section_6: true, section_10: false });
  const [noticeDate, setNoticeDate] = useState(todayISO());
  const [works, setWorks] = useState(project?.works || '');
  const [includeCoverLetter, setIncludeCoverLetter] = useState(true);
  const [createReminder, setCreateReminder] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const selectedAOs = aos.filter(ao => selectedAOKeys.includes(aoKey(ao)));
  const selectedTypes = NOTICE_TYPES.filter(type => noticeTypes[type.key]);

  const toggleAO = key => setSelectedAOKeys(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]);
  const toggleType = key => setNoticeTypes(prev => ({ ...prev, [key]: !prev[key] }));

  const tryGenerateNotice = async ({ ao, type }) => {
    const fileName = `${cleanFileName(project?.ref || 'Project')} - ${type.label} Notice - AO${ao.num || ''} ${cleanFileName(aoAddress(ao) || ao.name)}.docx`;
    const mergeData = buildNoticePlaceholders(project, ao, {
      noticeDate, noticeType: type.label, noticeSection: type.label, notifiableWorks: works,
    });
    const enrichedMergeData = {
      ...mergeData,
      project_id: project.id,
      ao_id: ao.id || String(ao.num || ''),
      file_name: fileName,
      category: 'notice',
      section_type: type.key,
      template_key: type.templateKeys[0],
      notice_cover_letter: includeCoverLetter ? 'Yes' : 'No',
    };

    let lastError = '';
    for (const templateKey of type.templateKeys) {
      setStatusMessage(`Trying template ${templateKey}…`);
      const result = await generateDocument({
        templateKey,
        mergeData: { ...enrichedMergeData, TEMPLATE_KEY: templateKey, template_key: templateKey },
        fileName,
        projectId: project.id,
      });
      if (result?.success) {
        setStatusMessage(`${type.label} generated successfully.`);
        return { ...result, templateKey, fileName };
      }
      lastError = result?.error || lastError;
    }
    throw new Error(`Could not generate ${type.label} notice for ${aoAddress(ao) || ao.name}. ${lastError || 'No matching template found.'}`);
  };

  const recordServedNotice = async ({ ao, type, generated }) => {
    setStatusMessage('Recording notice and creating tasks…');
    const response = await fetch('/api/serve-notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: project.id,
        ao_id: ao.id || String(ao.num || ''),
        notice_type: type.key,
        notice_date: noticeDate,
        notifiable_works: works,
        template_type: generated.templateKey,
        include_cover_letter: includeCoverLetter,
        create_reminder: createReminder,
        document_id: generated.doc_id || null,
        storage_path: generated.storage_path || null,
        file_name: generated.fileName || null,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || 'Notice was generated but could not be recorded.');
    }
    return data;
  };

  const handleServe = async () => {
    if (!selectedAOs.length) return alert('Please select at least one adjoining owner.');
    if (!selectedTypes.length) return alert('Please select at least one notice type.');
    if (!noticeDate) return alert('Please enter the notice date.');

    setSaving(true);
    setErrorMessage('');
    setStatusMessage('Preparing notice generation…');

    try {
      const completed = [];
      const zip = new PizZip();
      const allDocs = [];

      for (const ao of selectedAOs) {
        for (const type of selectedTypes) {
          setStatusMessage(`Generating ${type.label} for ${aoAddress(ao) || ao.name}…`);
          const generated = await tryGenerateNotice({ ao, type });
          const recorded = await recordServedNotice({ ao, type, generated });

          allDocs.push({ fileName: generated.fileName, docx_b64: generated.docx_b64 });
          if (generated.docx_b64) {
            zip.file(generated.fileName, generated.docx_b64, { base64: true });
          }
          completed.push({ ao, type, generated, recorded });
        }
      }

      // Download: ZIP if multiple, single DOCX if one
      if (allDocs.length > 1) {
        setStatusMessage('Creating ZIP pack…');
        const zipB64 = zip.generate({ type: 'base64', compression: 'DEFLATE' });
        const zipName = `${cleanFileName(project?.ref || 'Project')}_Notice_Pack_${noticeDate}.zip`;
        downloadB64File(zipB64, zipName, 'application/zip');
      } else if (allDocs.length === 1) {
        downloadB64File(allDocs[0].docx_b64, allDocs[0].fileName,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      }

      setStatusMessage('Notice workflow completed successfully.');
      await onServed?.({ completed, selectedAOs, selectedTypes, noticeDate });
      onClose();
      alert(`Generated and recorded ${completed.length} notice document${completed.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('[NoticeServingModal] workflow error:', err);
      setErrorMessage(err.message || 'Could not serve notice.');
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {NOTICE_TYPES.map(type => (
            <button key={type.key} onClick={() => toggleType(type.key)} style={{ padding: 14, borderRadius: 14, border: noticeTypes[type.key] ? '2px solid var(--blue)' : '1px solid #e5e7eb', background: noticeTypes[type.key] ? 'var(--blue-bg)' : '#fff', cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{type.label}</div>
            </button>
          ))}
        </div>

        <div style={sectionStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Adjoining owners</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {aos.map(ao => (
              <label key={aoKey(ao)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedAOKeys.includes(aoKey(ao))} onChange={() => toggleAO(aoKey(ao))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>AO{ao.num} - {aoAddress(ao) || ao.name || 'Unnamed AO'}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>
              Notice date
              <input type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} style={{ ...inputStyle, marginTop: 5 }} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>
              Notifiable works
              <textarea rows={4} value={works} onChange={e => setWorks(e.target.value)} style={{ ...inputStyle, marginTop: 5, resize: 'vertical' }} />
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
            <input type="checkbox" checked={includeCoverLetter} onChange={e => setIncludeCoverLetter(e.target.checked)} />
            Include covering letter
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text2)' }}>
            <input type="checkbox" checked={createReminder} onChange={e => setCreateReminder(e.target.checked)} />
            Create consent / deadline task
          </label>
        </div>

        {statusMessage && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', borderRadius: 12, padding: '10px 12px', fontSize: 12.5 }}>{statusMessage}</div>
        )}
        {errorMessage && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: 12.5 }}>{errorMessage}</div>
        )}
        {previewOpen && (
          <div style={{ ...sectionStyle, background: '#f8fafc', fontSize: 12.5, lineHeight: 1.7, color: 'var(--text2)' }}>
            Notices: {selectedTypes.map(t => t.label).join(', ') || 'None'}<br />
            AOs: {selectedAOs.map(ao => `AO${ao.num} ${aoAddress(ao) || ao.name}`).join(', ') || 'None'}<br />
            Notice date: {noticeDate}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid #d8dde6', paddingTop: 16 }}>
          <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Back</button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPreviewOpen(v => !v)} className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', borderRadius: 99 }}>Preview</button>
            <button onClick={handleServe} disabled={saving} className="btn btn-sm btn-primary" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>
              {saving ? 'Generating…' : 'Serve notice'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
