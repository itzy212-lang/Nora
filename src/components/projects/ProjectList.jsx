import { useEffect, useState } from 'react';
import { useApp } from '../../state/appStore';
import { useProjects } from '../../hooks/useProjects';

const STATUS_COLOURS = {
  active:   { bg: 'var(--blue-bg)',   text: 'var(--blue)'  },
  complete: { bg: 'var(--green-bg)',  text: 'var(--green)' },
  on_hold:  { bg: 'var(--amber-bg)',  text: 'var(--amber)' },
  dispute:  { bg: 'var(--red-bg)',    text: 'var(--red)'   },
};

function ProjectCard({ project, onClick }) {
  const sc = STATUS_COLOURS[project.status] || STATUS_COLOURS.active;
  const aoCount = (project.aos || []).length;
  const date = project.created_at
    ? new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <div
      onClick={() => onClick(project)}
      style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '16px 18px',
        cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--border2)';
        e.currentTarget.style.background = 'var(--bg3)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background = 'var(--bg2)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{project.ref}</div>
        <span style={{
          fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
          background: sc.bg, color: sc.text,
        }}>
          {project.status || 'active'}
        </span>
      </div>

      {project.address && (
        <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.4 }}>
          {project.address}
        </div>
      )}

      {project.bo && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
          BO: {project.bo}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>
          {aoCount} {aoCount === 1 ? 'AO' : 'AOs'}
          {project.fee ? ` · £${parseFloat(project.fee).toLocaleString('en-GB')}` : ''}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{date}</span>
      </div>
    </div>
  );
}

export default function ProjectList({ onOpenProject }) {
  const { state } = useApp();
  const { loadProjects } = useProjects();
  const { projects = [] } = state;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    loadProjects().finally(() => setLoading(false));
  }, [loadProjects]);

  const filtered = projects.filter(p => {
    const matchesFilter = filter === 'all' || p.status === filter;
    const q = search.toLowerCase();
    const matchesSearch = !q
      || (p.ref || '').toLowerCase().includes(q)
      || (p.address || '').toLowerCase().includes(q)
      || (p.bo || '').toLowerCase().includes(q)
      || (p.works || '').toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  return (
    <div style={{ padding: '24px 28px' }}>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search projects…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 12px', fontSize: 13,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none',
          }}
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            padding: '8px 12px', fontSize: 13,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)', cursor: 'pointer',
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="complete">Complete</option>
          <option value="on_hold">On hold</option>
          <option value="dispute">Dispute</option>
        </select>
        <button
          className="btn btn-ghost btn-sm"
          style={{ cursor: 'pointer' }}
          onClick={() => { setLoading(true); loadProjects().finally(() => setLoading(false)); }}
        >
          ↻ Refresh
        </button>
        <button
          className="btn btn-primary btn-sm"
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenProject('new')}
        >
          + New project
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)', fontSize: 13 }}>
          Loading projects…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {search ? 'No projects match your search' : 'No projects yet'}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 14,
        }}>
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p} onClick={onOpenProject} />
          ))}
        </div>
      )}
    </div>
  );
}
