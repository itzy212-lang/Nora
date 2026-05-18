import { useState, useEffect } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { useEmails } from '../../hooks/useEmails';
import { useApp } from '../../state/appStore';
import ProjectChat from '../chat/ProjectChat';
import { getAOStatus, getProjColour, fmtShort, uid, todayStr } from '../../utils/formatters';
import sb from '../../supabaseClient';

const AO_STATUSES = [
  { value: 'awaiting', label: 'Awaiting notice' },
  { value: 'details_added', label: 'Details added' },
  { value: 'notice_served', label: 'Notice served' },
  { value: 'consented', label: 'Consented' },
  { value: 'dissented', label: 'Dissented' },
  { value: 'surveyor_appointed', label: 'Surveyor appointed' },
  { value: 'award_in_progress', label: 'Award in progress' },
  { value: 'award_served', label: 'Award served' },
  { value: 'notice_expired', label: 'Notice expired' },
  { value: 'complete', label: 'Complete' },
];

export default function ProjectDetail({ project: initialProject, onBack, onOpenComposer }) {
  const { state } = useApp();
  const { saveProject, deleteProject, setCurrentProject } = useProjects();
  const { emails } = useEmails();
  const [activeTab, setActiveTab] = useState('details');
  const [showChat, setShowChat] = useState(false);
  const [project, setProject] = useState(initialProject);

  // Keep currentProject in sync
  useEffect(() => {
    setCurrentProject(project);
    return () => setCurrentProject(null);
  }, [project?.id]);

  // Refresh project from store when it changes
  useEffect(() => {
    const fresh = state.projects.find(p => p.id === initialProject?.id);
    if (fresh) setProject(fresh);
  }, [state.projects, initialProject?.id]);

  const projEmails = emails.filter(e => e.project_id === project?.id);
  const TABS = ['details', 'emails', 'documents', 'timeline', 'chat'];

  const PIPELINE_STAGES = ['Notice', 'Response', 'Appointment', 'Award', 'Complete'];
  const aos = project?.aos || [];
  const pipelineStep =
    aos.some(ao => ['award_served', 'complete'].includes(ao.status)) ? 4 :
    aos.some(ao => ['award_in_progress'].includes(ao.status)) ? 3 :
    aos.some(ao => ['surveyor_appointed', 'dissented'].includes(ao.status)) ? 2 :
    aos.some(ao => ['consented', 'notice_served'].includes(ao.status)) ? 1 : 0;

  const handleDelete = async () => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    await deleteProject(project.id);
    onBack();
  };

  if (!project) return <div className="empty"><div>Project not found</div></div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Projects</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 600 }}>{project.ref || 'Project'}</h2>
            <span className={`${getProjColour(project).replace('c-', 's-')}`} style={{ fontSize: 12, padding: '3px 9px', borderRadius: 99, background: 'var(--bg4)', border: '1px solid var(--border)' }}>
              {project.status || 'active'}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{project.address || project.bo_address || ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" onClick={() => { setShowChat(true); }}>
            💬 Chat with Ely
          </button>
          <button className="btn btn-sm" onClick={() => onOpenComposer({ mode: 'compose', projectId: project.id })}>
            ✏ Compose email
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleDelete}>🗑 Delete</button>
        </div>
      </div>

      {/* Pipeline */}
      <div className="pipeline" style={{ marginBottom: 16 }}>
        {PIPELINE_STAGES.map((s, i) => (
          <div key={i} className="pip-step">
            <div className={`pip-inner${i < pipelineStep ? ' done' : i === pipelineStep ? ' active' : ''}`}>{s}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(tab => (
          <div key={tab} className={`tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)} style={{ textTransform: 'capitalize' }}>
            {tab === 'chat' ? '💬 Chat' : tab}
          </div>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'details' && <DetailsTab project={project} onSave={async (updates) => {
        const saved = await saveProject({ ...project, ...updates });
        if (saved) setProject(p => ({ ...p, ...updates }));
      }} />}

      {activeTab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{projEmails.length} email(s)</div>
            <button className="btn btn-sm btn-primary" onClick={() => onOpenComposer({ mode: 'compose', projectId: project.id })}>✏ Compose</button>
          </div>
          {projEmails.length === 0 ? (
            <div className="empty"><div className="empty-icon">📭</div><div>No emails linked to this project</div></div>
          ) : (
            projEmails.map(email => (
              <div key={email.id} className="mail-item" onClick={() => onOpenComposer({ mode: 'reply', originalEmail: email })}>
                <div className="mail-item-top">
                  <div className="mail-item-from">{email.from}</div>
                  <div className="mail-item-time">{email.time}</div>
                </div>
                <div className="mail-item-subject">{email.subject}</div>
                <div className="mail-item-preview">{email.preview}</div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <DocumentsTab project={project} />
      )}

      {activeTab === 'timeline' && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', textAlign: 'center', padding: 30 }}>
            Timeline view coming soon
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <button className="btn btn-primary" onClick={() => setShowChat(true)}>
            💬 Open Project Chat
          </button>
        </div>
      )}

      {/* Project Chat full screen */}
      {showChat && (
        <ProjectChat
          project={project}
          onOpenComposer={onOpenComposer}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}

function DetailsTab({ project, onSave }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    ref: project.ref || '',
    address: project.address || '',
    bo_name: project.bo_name || '',
    bo_email: project.bo_email || '',
    bo_phone: project.bo_phone || '',
    status: project.status || 'active',
    fee: project.fee || '',
  });

  const handleSave = async () => {
    await onSave(form);
    setEditing(false);
  };

  return (
    <div>
      {/* AOs */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Adjoining Owners</div>
        </div>
        {(project.aos || []).length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: 12, background: 'var(--bg4)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
            No adjoining owners added yet.
          </div>
        ) : (
          (project.aos || []).map(ao => {
            const { label, colour } = getAOStatus(ao);
            return (
              <div key={ao.id} className={`ao-tile ${colour}`}>
                <div className="ao-header">
                  <div>
                    <div className="ao-name">AO {ao.num || ''}: {ao.name || ao.premise || 'AO'}</div>
                    <div className="ao-sub">{ao.address || ao.premise || ''}</div>
                  </div>
                  <span className={colour} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, background: 'var(--bg4)', border: '1px solid var(--border)' }}>
                    {label}
                  </span>
                </div>
                {ao.surv_name && (
                  <div style={{ background: 'var(--bg4)', borderRadius: 8, padding: '9px 11px', margin: '8px 0', fontSize: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Surveyor</div>
                    <div>{ao.surv_name}</div>
                    {ao.surv_email && <div style={{ color: 'var(--text3)', fontSize: 11 }}>{ao.surv_email}</div>}
                    {ao.surv_phone && <div style={{ color: 'var(--text3)', fontSize: 11 }}>{ao.surv_phone}</div>}
                  </div>
                )}
                {ao.notice_date && (
                  <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                    Notice served: {fmtShort(ao.notice_date)}
                    {ao.response_deadline && ` · Deadline: ${fmtShort(ao.response_deadline)}`}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Project details */}
      <div className="card">
        <div className="card-title">
          Project details
          <button className="btn btn-xs btn-ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : '✏ Edit'}
          </button>
        </div>
        {editing ? (
          <>
            <div className="two-col">
              <div className="form-row"><label className="form-label">Project ref</label><input value={form.ref} onChange={e => setForm(p => ({ ...p, ref: e.target.value }))} /></div>
              <div className="form-row"><label className="form-label">Status</label>
                <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="complete">Complete</option>
                  <option value="on_hold">On hold</option>
                </select>
              </div>
            </div>
            <div className="form-row"><label className="form-label">Building address</label><input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
            <div className="two-col">
              <div className="form-row"><label className="form-label">Building Owner name</label><input value={form.bo_name} onChange={e => setForm(p => ({ ...p, bo_name: e.target.value }))} /></div>
              <div className="form-row"><label className="form-label">BO email</label><input value={form.bo_email} onChange={e => setForm(p => ({ ...p, bo_email: e.target.value }))} /></div>
            </div>
            <div className="form-row"><label className="form-label">Agreed fee (£)</label><input value={form.fee} onChange={e => setForm(p => ({ ...p, fee: e.target.value }))} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
              <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
              {[
                ['Ref', project.ref],
                ['Status', project.status],
                ['Address', project.address],
                ['BO Name', project.bo_name],
                ['BO Email', project.bo_email],
                ['BO Phone', project.bo_phone],
                ['Fee', project.fee ? `£${project.fee}` : ''],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{k}</span>
                  <span style={{ fontSize: 13, marginTop: 2 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentsTab({ project }) {
  const [docs, setDocs] = useState(project.documents || []);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !sb) return;
    setUploading(true);
    try {
      const path = `${project.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await sb.storage.from('documents').upload(path, file);
      if (uploadErr) throw uploadErr;
      const { data: signedData } = await sb.storage.from('documents').createSignedUrl(path, 3600 * 24 * 365);
      const payload = {
        project_id: project.id,
        name: file.name,
        file_url: signedData?.signedUrl || path,
        file_type: file.name.split('.').pop().toLowerCase(),
        category: 'general',
        created_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from('documents').insert(payload).select('*').single();
      if (error) throw error;
      setDocs(prev => [...prev, data]);
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{docs.length} document(s)</div>
        <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
          {uploading ? 'Uploading…' : '📎 Upload'}
          <input type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      {docs.length === 0 ? (
        <div className="empty"><div className="empty-icon">📂</div><div>No documents yet</div></div>
      ) : (
        docs.map(doc => (
          <div key={doc.id} className="doc-item">
            <span style={{ fontSize: 16 }}>{doc.file_type === 'pdf' ? '📄' : doc.file_type?.match(/^(doc|docx)$/) ? '📝' : '📎'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 1 }}>{doc.category || ''} · {fmtShort(doc.created_at)}</div>
            </div>
            {doc.file_url && (
              <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost">View</a>
            )}
          </div>
        ))
      )}
    </div>
  );
}
