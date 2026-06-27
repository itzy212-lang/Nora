/**
 * SaveToOneDriveOverlay
 * 
 * Shows folder selection before saving a generated document to OneDrive.
 * Pre-selects the correct AO subfolder if known.
 * On confirm → uploads to OneDrive → triggers callback (e.g. open email composer).
 * 
 * Props:
 *   projectId      {string}
 *   aoIndex        {number}   currently selected AO index in project.aos
 *   fileName       {string}   e.g. "Schedule of Conditions - 9 Biggin Avenue.pdf"
 *   fileBase64     {string}   base64 encoded file content
 *   mimeType       {string}   'application/pdf' or 'application/vnd.openxmlformats...'
 *   onSaved        {fn}       called with { web_url, name } after successful save
 *   onClose        {fn}
 */

import { useState, useEffect } from 'react';
import sb from '../../supabaseClient';

export default function SaveToOneDriveOverlay({
  projectId,
  aoIndex,
  fileName,
  fileBase64,
  mimeType = 'application/pdf',
  onSaved,
  onClose,
}) {
  const [project, setProject] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [selectedFolderLabel, setSelectedFolderLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    sb.from('projects')
      .select('id, bo_premise_address, onedrive_folder_id, onedrive_folder_url, aos')
      .eq('id', projectId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setProject(data);

        const aos = Array.isArray(data.aos) ? data.aos : [];
        const ao = aoIndex != null ? aos[aoIndex] : null;

        // Pre-select AO subfolder if available, else project root
        if (ao?.onedrive_folder_id) {
          setSelectedFolderId(ao.onedrive_folder_id);
          setSelectedFolderLabel(`${data.bo_premise_address || 'Project'} › ${ao.premise || ao.address || `AO ${aoIndex + 1}`}`);
        } else if (data.onedrive_folder_id) {
          setSelectedFolderId(data.onedrive_folder_id);
          setSelectedFolderLabel(data.bo_premise_address || 'Project folder');
        }
      });
  }, [projectId, aoIndex]);

  const folders = (() => {
    if (!project) return [];
    const aos = Array.isArray(project.aos) ? project.aos : [];
    const result = [];

    if (project.onedrive_folder_id) {
      result.push({
        id: project.onedrive_folder_id,
        label: project.bo_premise_address || 'Project folder',
        type: 'project',
      });
    }

    aos.forEach((ao, i) => {
      if (ao.onedrive_folder_id) {
        result.push({
          id: ao.onedrive_folder_id,
          label: `${project.bo_premise_address || 'Project'} › ${ao.premise || ao.address || `AO ${i + 1}`}`,
          type: 'ao',
          aoIndex: i,
        });
      }
    });

    return result;
  })();

  const handleSave = async () => {
    if (!selectedFolderId) { setError('Please select a folder'); return; }
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/onedrive-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'help@sq1consulting.co.uk',
          folder_id: selectedFolderId,
          filename: fileName,
          content_base64: fileBase64,
          content_type: mimeType,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

      onSaved?.({ web_url: data.web_url, name: data.name });
    } catch (err) {
      setError(err.message || 'Upload failed');
      setSaving(false);
    }
  };

  const inp = {
    width: '100%', padding: '9px 12px', fontSize: 13,
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text)', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>

        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          💾 Save to OneDrive
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>
          {fileName}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>SAVE TO FOLDER</div>
          {folders.length > 0 ? (
            <select
              style={inp}
              value={selectedFolderId}
              onChange={e => {
                setSelectedFolderId(e.target.value);
                const f = folders.find(f => f.id === e.target.value);
                setSelectedFolderLabel(f?.label || '');
              }}
            >
              <option value="">Select folder…</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>
              No OneDrive folders found for this project. Set up OneDrive folders in the project settings first.
            </div>
          )}
        </div>

        {selectedFolderLabel && (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8 }}>
            📁 {selectedFolderLabel}
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text3)' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !selectedFolderId || folders.length === 0}
            style={{
              padding: '8px 20px',
              background: selectedFolderId && !saving ? '#3b82f6' : 'var(--border)',
              color: selectedFolderId && !saving ? '#fff' : 'var(--text3)',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: selectedFolderId && !saving ? 'pointer' : 'not-allowed',
            }}>
            {saving ? 'Saving…' : 'Save & open email'}
          </button>
        </div>
      </div>
    </div>
  );
}
