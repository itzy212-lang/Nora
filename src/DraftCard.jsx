import { useState } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { getProjColour, getAOStatus, fmtShort } from '../../utils/formatters';

export function ProjectCard({ project, onClick }) {
  const colour = getProjColour(project);
  const activeAOs = (project.aos || []).filter(ao => ao.status && ao.status !== 'complete');

  return (
    <div className={`proj-card ${colour}`} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{project.ref || 'Project'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{project.address || project.bo_address || ''}</div>
        </div>
        <span style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 99, background: 'var(--bg4)', color: 'var(--text3)', fontWeight: 500, flexShrink: 0 }}>
          {project.status || 'active'}
        </span>
      </div>
      {activeAOs.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {activeAOs.slice(0, 2).map(ao => {
            const { label, colour: c } = getAOStatus(ao);
            return (
              <span key={ao.id} className={`${c}`} style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 99, background: 'var(--bg4)', border: '1px solid var(--border)' }}>
                {ao.name || ao.premise || 'AO'} · {label}
              </span>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>
          {(project.aos || []).length} AO{(project.aos || []).length !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>
          {project.created_at ? fmtShort(project.created_at) : ''}
        </span>
      </div>
    </div>
  );
}

export default function ProjectList({ onOpenProject }) {
  const { projects, loadProjects } = useProjects();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const filtered = projects.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.ref || '').toLowerCase().includes(q) ||
      (p.address || '').toLowerCase().includes(q) ||
      (p.bo_name || '').toLowerCase().includes(q) ||
      (p.status || '').toLowerCase().includes(q)
    );
  });

  const handleRefresh = async () => {
    setLoading(true);
    await loadProjects();
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search projects..."
          style={{ flex: 1 }}
        />
        <button className="btn btn-sm" onClick={handleRefresh} disabled={loading}>
          {loading ? '⟳' : '⟳'} Refresh
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => onOpenProject('new')}>
          + New project
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📁</div>
          <div>{projects.length === 0 ? 'No projects yet. Create your first project.' : 'No projects match your search.'}</div>
        </div>
      ) : (
        <div className="project-grid">
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p} onClick={() => onOpenProject(p)} />
          ))}
        </div>
      )}
    </div>
  );
}
