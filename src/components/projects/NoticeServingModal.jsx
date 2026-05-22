import { useState } from 'react';
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

export default function NoticeServingModal({
  project,
  ao,
  defaultSections = [],
  generateDocument,
  onServe,
  onClose,
}) {
  const [selected, setSelected] = useState(defaultSections || []);
  const [includeCover, setIncludeCover] = useState(!defaultSections?.includes('s10'));
  const [loading, setLoading] = useState(false);

  const toggle = key => {
    setSelected(prev =>
      prev.includes(key)
        ? prev.filter(v => v !== key)
        : [...prev, key]
    );
  };

  const handleServe = async () => {
    if (!ao) {
      alert('Please select an adjoining owner first.');
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

    if (typeof onServe !== 'function') {
      alert('Notice save handler is not available.');
      return;
    }

    setLoading(true);

    try {
      const zip = new PizZip();
      const generatedDocs = [];
      const warnings = [];

      const allKeys = [...selected];
      if (includeCover) allKeys.unshift('cover');

      for (const key of allKeys) {
        try {
          const placeholders = buildNoticePlaceholders({
            project,
            ao,
            noticeType: key,
          });

          const fileName = `${safeName(project?.ref || 'Project')}_${safeName(ao?.name || `AO${ao?.num || ''}`)}_${safeName(key)}.docx`;

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
            warnings.push(`${key}: ${result?.error || 'Document generation failed'}`);
          }
        } catch (err) {
          warnings.push(`${key}: ${err.message}`);
        }
      }

      if (generatedDocs.length > 1) {
        const zipB64 = zip.generate({ type: 'base64', compression: 'DEFLATE' });
        downloadB64File(
          zipB64,
          `${safeName(project?.ref || 'Project')}_${safeName(ao?.name || `AO${ao?.num || ''}`)}_Notice_Pack.zip`,
          'application/zip'
        );
      }

      await onServe({
        ao,
        sections: selected,
        includeCover,
        warnings,
        generatedCount: generatedDocs.length,
      });

      onClose?.();

      if (warnings.length) {
        alert(`Notice workflow saved with warnings:\n\n${warnings.join('\n')}`);
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
        width: 680,
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
              {ao?.name || 'Adjoining Owner'} • {project?.ref || 'Project'}
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
              Select notices
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {NOTICE_TYPES.map(item => {
                const active = selected.includes(item.key);

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggle(item.key)}
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
            borderRadius: 14,
            padding: '10px 14px',
            fontSize: 12.5,
            color: '#6b7280',
            lineHeight: 1.55,
          }}>
            S1/S3/S6 create one 14-day deadline task for this AO. Section 10 creates one 10-day deadline task. Duplicate tasks are skipped automatically.
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
