import { useMemo, useState } from 'react';
import { buildNoticePlaceholders } from '../../utils/buildNoticePlaceholders';
import PizZip from 'pizzip';

const NOTICE_TYPES = [
  { key: 's1', label: 'Section 1 Notice', deadlineDays: 14 },
  { key: 's3', label: 'Section 3 Notice', deadlineDays: 14 },
  { key: 's6', label: 'Section 6 Notice', deadlineDays: 14 },
  { key: 's10', label: 'Section 10 Notice', deadlineDays: 10 },
];

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

function safeName(value) {
  return String(value || 'Document')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

function addDaysIsoFromDate(value, days) {
  const [year, month, day] = String(value || todayIso()).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function aoKey(item) {
  return String(item?.id || item?.num || item?.ao_id || item?.name || item?.premise || item?.address || '');
}

function aoAddress(item) {
  return item?.premise || item?.reg_addr || item?.address || item?.service_address || item?.serviceAddress || '';
}

function normaliseAOList({ ao, aos, project }) {
  const sources = [
    Array.isArray(aos) ? aos : [],
    Array.isArray(project?.aos) ? project.aos : [],
    Array.isArray(project?.adjoining_owners) ? project.adjoining_owners : [],
    Array.isArray(project?.adjoiningOwners) ? project.adjoiningOwners : [],
    Array.isArray(project?.adjoiningowners) ? project.adjoiningowners : [],
    Array.isArray(project?.ao_list) ? project.ao_list : [],
    Array.isArray(project?.owners) ? project.owners : [],
    ao ? [ao] : [],
  ];

  const seen = new Set();
  const out = [];

  for (const source of sources) {
    for (const item of source) {
      if (!item) continue;
      const key = aoKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

export default function NoticeServingModal({
  project,
  ao,
  aos = [],
  defaultSections = [],
  generateDocument,
  onServe,
  onClose,
}) {
  const lockedToSingleAO = !!ao;

  const availableAOs = useMemo(
    () => lockedToSingleAO ? [ao] : normaliseAOList({ ao, aos, project }),
    [ao, aos, project, lockedToSingleAO]
  );

  const [selectedAOKeys, setSelectedAOKeys] = useState(
    lockedToSingleAO && ao ? [aoKey(ao)] : []
  );
  const [selected, setSelected] = useState(defaultSections || []);
  const [includeCover, setIncludeCover] = useState(!defaultSections?.includes('s10'));
  const [createDeadlineTask, setCreateDeadlineTask] = useState(true);
  const [noticeDate, setNoticeDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);

  const selectedAOs = availableAOs.filter(item => selectedAOKeys.includes(aoKey(item)));

  const toggleAO = item => {
    if (lockedToSingleAO) return;

    const key = aoKey(item);
    setSelectedAOKeys(prev =>
      prev.includes(key)
        ? prev.filter(v => v !== key)
        : [...prev, key]
    );
  };

  const toggleNotice = key => {
    setSelected(prev =>
      prev.includes(key)
        ? prev.filter(v => v !== key)
        : [...prev, key]
    );
  };

  const handleServe = async () => {
    if (!selectedAOs.length) {
      alert('Please select at least one adjoining owner/property.');
      return;
    }

    if (!selected.length) {
      alert('Please select at least one notice type.');
      return;
    }

    if (typeof generateDocument !== 'function') {
      alert('Document generator is not available.');
      return;
    }

    const canSaveWorkflow = typeof onServe === 'function';

    setLoading(true);

    try {
      const warnings = [];
      let totalGenerated = 0;

      for (const selectedAO of selectedAOs) {
        const zip = new PizZip();
        const generatedDocs = [];

        const allKeys = [...selected];
        if (includeCover) allKeys.unshift('cover');

        for (const key of allKeys) {
          try {
            const placeholders = buildNoticePlaceholders(project, selectedAO, {
              noticeDate,
              noticeType: key,
              noticeSection: key,
            });

            const fileName = `${safeName(project?.ref || 'Project')}_${safeName(selectedAO?.name || `AO${selectedAO?.num || ''}`)}_${safeName(key)}.docx`;

            const result = await generateDocument({
              templateKey: key,
              mergeData: placeholders,
              fileName,
              projectId: project?.id,
              skipDownload: allKeys.length > 1,
            });

            if (result?.success && result?.docx_b64) {
              generatedDocs.push({ fileName, b64: result.docx_b64 });
              addDocxToZip(zip, fileName, result.docx_b64);
            } else {
              warnings.push(`AO${selectedAO?.num || ''} ${key}: ${result?.error || 'Document generation failed'}`);
            }
          } catch (err) {
            warnings.push(`AO${selectedAO?.num || ''} ${key}: ${err.message}`);
          }
        }

        if (generatedDocs.length > 1) {
          const zipB64 = zip.generate({ type: 'base64', compression: 'DEFLATE' });
          downloadB64File(
            zipB64,
            `${safeName(project?.ref || 'Project')}_${safeName(selectedAO?.name || `AO${selectedAO?.num || ''}`)}_Notice_Pack.zip`,
            'application/zip'
          );
        } else if (generatedDocs.length === 1) {
          downloadB64File(
            generatedDocs[0].b64,
            generatedDocs[0].fileName,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          );
        }

        totalGenerated += generatedDocs.length;

        if (canSaveWorkflow) {
          await onServe({
            ao: selectedAO,
            sections: selected,
            includeCover,
            noticeDate,
            createDeadlineTask,
            warnings,
            generatedCount: generatedDocs.length,
          });
        }
      }

      onClose?.();

      if (!canSaveWorkflow) {
        alert(`Documents generated, but the notice workflow was not saved because the save handler is not connected.`);
      } else if (warnings.length) {
        alert(`Notice workflow saved with warnings:\n\n${warnings.join('\n')}`);
      } else {
        alert(`Notice workflow saved. ${totalGenerated} document(s) generated.`);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to serve notices.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
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
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
              Serve Notices
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              {lockedToSingleAO
                ? `${ao?.name || 'Adjoining Owner'} • ${project?.ref || 'Project'}`
                : `Select adjoining owners • ${project?.ref || 'Project'}`}
            </div>
          </div>

          <button onClick={onClose} style={{
            border: 'none',
            background: 'transparent',
            color: '#6b7280',
            cursor: 'pointer',
            fontSize: 24,
            lineHeight: 1,
          }}>
            ×
          </button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 18,
            padding: 16,
          }}>
            <div style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              marginBottom: 12,
            }}>
              Adjoining owner / property
            </div>

            {availableAOs.length === 0 ? (
              <div style={{ fontSize: 13, color: '#dc2626' }}>
                No adjoining owners are recorded on this project.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {availableAOs.map(item => {
                  const key = aoKey(item);
                  const active = selectedAOKeys.includes(key);

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleAO(item)}
                      disabled={lockedToSingleAO}
                      style={{
                        textAlign: 'left',
                        padding: '12px 14px',
                        borderRadius: 14,
                        border: active ? '2px solid #2563eb' : '1px solid #e5e7eb',
                        background: active ? '#eff6ff' : '#fff',
                        color: active ? '#1d4ed8' : '#111827',
                        cursor: lockedToSingleAO ? 'default' : 'pointer',
                        fontWeight: active ? 700 : 500,
                        opacity: lockedToSingleAO && !active ? 0.6 : 1,
                      }}
                    >
                      <div>
                        AO{item?.num || ''} — {item?.name || 'Unnamed AO'}
                      </div>
                      {aoAddress(item) && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.35 }}>
                          {aoAddress(item)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 18,
            padding: 16,
          }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 700,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              marginBottom: 8,
            }}>
              Notice date
            </label>

            <input
              type="date"
              value={noticeDate}
              onChange={e => setNoticeDate(e.target.value || todayIso())}
              style={{
                width: '100%',
                maxWidth: 260,
                border: '1px solid #d1d5db',
                borderRadius: 12,
                padding: '10px 12px',
                fontSize: 14,
                color: '#111827',
                background: '#fff',
              }}
            />

            <div style={{
              marginTop: 8,
              fontSize: 12.5,
              color: '#6b7280',
            }}>
              Documents will show this as {formatLongNoticeDate(noticeDate)}.
            </div>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 18,
            padding: 16,
          }}>
            <div style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              marginBottom: 12,
            }}>
              Select notices
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {NOTICE_TYPES.map(item => {
                const active = selected.includes(item.key);

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleNotice(item.key)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: active ? '2px solid #2563eb' : '1px solid #e5e7eb',
                      background: active ? '#eff6ff' : '#fff',
                      color: active ? '#1d4ed8' : '#111827',
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    <div>{item.label}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 3 }}>
                      {item.deadlineDays}-day workflow
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 18,
            padding: 16,
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input
                type="checkbox"
                checked={includeCover}
                onChange={e => setIncludeCover(e.target.checked)}
              />
              Include covering letter
            </label>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 18,
            padding: 16,
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input
                type="checkbox"
                checked={createDeadlineTask}
                onChange={e => setCreateDeadlineTask(e.target.checked)}
              />
              Create deadline task
            </label>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 14,
            padding: '10px 14px',
            fontSize: 12.5,
            color: '#6b7280',
            lineHeight: 1.55,
          }}>
            S1/S3/S6 create one 14-day deadline task for each selected AO. Section 10 creates one 10-day deadline task. Untick the task box if this is a duplicate or supplementary notice.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: 99,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleServe}
              style={{
                padding: '8px 16px',
                borderRadius: 99,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.65 : 1,
                fontWeight: 700,
              }}
            >
              {loading ? 'Serving…' : 'Serve Notice Pack'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
