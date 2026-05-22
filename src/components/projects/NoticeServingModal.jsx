import { useState } from 'react';
import { buildNoticePlaceholders } from '../../utils/buildNoticePlaceholders';
import PizZip from 'pizzip';

const NOTICE_TYPES = [
  {
    key: 's1',
    label: 'Section 1 Notice',
    deadlineDays: 14,
  },
  {
    key: 's3',
    label: 'Section 3 Notice',
    deadlineDays: 14,
  },
  {
    key: 's6',
    label: 'Section 6 Notice',
    deadlineDays: 14,
  },
  {
    key: 's10',
    label: 'Section 10 Notice',
    deadlineDays: 10,
  },
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

export default function NoticeServingModal({
  project,
  ao,
  generateDocument,
  onServe,
  onClose,
}) {
  const [selected, setSelected] = useState([]);
  const [includeCover, setIncludeCover] = useState(true);
  const [loading, setLoading] = useState(false);

  const toggle = key => {
    setSelected(prev =>
      prev.includes(key)
        ? prev.filter(v => v !== key)
        : [...prev, key]
    );
  };

  const handleServe = async () => {
    if (!selected.length) {
      alert('Please select at least one notice type.');
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

          const fileName = `${project?.ref || 'Project'}_${ao?.name || 'AO'}_${key}.docx`
            .replace(/\s+/g, '_');

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
          `${project?.ref || 'Project'}_${ao?.name || 'AO'}_Notice_Pack.zip`.replace(/\s+/g, '_'),
          'application/zip'
        );
      }

      await onServe({
        sections: selected,
        includeCover,
        warnings,
      });

      if (warnings.length) {
        alert(`Notice workflow saved with warnings:\n\n${warnings.join('\n')}`);
      }

      onClose?.();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to serve notices.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 flex flex-col gap-5">
        <div>
          <div className="text-lg font-semibold">Serve Notices</div>
          <div className="text-sm text-neutral-500 mt-1">
            {ao?.name || 'Adjoining Owner'} • {project?.ref || 'Project'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {NOTICE_TYPES.map(item => {
            const active = selected.includes(item.key);

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggle(item.key)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-neutral-200 hover:border-neutral-400'
                }`}
              >
                <div className="font-medium">{item.label}</div>
                <div className="text-xs opacity-70 mt-1">
                  {item.deadlineDays}-day workflow
                </div>
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={includeCover}
            onChange={e => setIncludeCover(e.target.checked)}
          />
          Include covering letter
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-neutral-300"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={handleServe}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-50"
          >
            {loading ? 'Serving…' : 'Serve Notice Pack'}
          </button>
        </div>
      </div>
    </div>
  );
}
