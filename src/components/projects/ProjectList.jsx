import { useEffect, useState } from 'react';
import { useApp } from '../../state/appStore';
import { useProjects } from '../../hooks/useProjects';
import NewProjectModal from './NewProjectModal';

function getProjectColour(project) {
  const aos = project.aos || [];

  if (aos.length === 0) return '#9ca3af';

  const now = Date.now();

  const hasOverdue = aos.some(ao => {
    const cd = ao.consentDeadline || ao.ao_consent_deadline || ao.consent_deadline;
    const sd = ao.s10Deadline || ao.ao_s10_deadline || ao.s10_deadline;
    const st = (ao.status || ao.ao_status || '').toLowerCase();

    if (cd && new Date(cd).getTime() < now && st !== 'consent' && st !== 'dissent' && st !== 'appointed_ao') return true;
    if (sd && new Date(sd).getTime() < now) return true;

    return false;
  });

  if (hasOverdue) return '#ef4444';

  const hasNotices = aos.some(ao =>
    ao.consentDeadline ||
    ao.noticeServedDate ||
    ao.ao_notice_served_date ||
    ao.ao_consent_deadline ||
    ao.consent_deadline ||
    ao.notice_served_date
  );

  if (hasNotices) return '#22c55e';

  return '#a855f7';
}

function streetSortKey(address) {
  const str = (address || '').trim();
  const match = str.match(/^(\d+)/);
  const num = match ? parseInt(match[1], 10) : Infinity;
  const rest = str.replace(/^\d+\s*/, '').toLowerCase();
  return [num, rest];
}

function compareAddresses(a, b) {
  const [an, ar] = streetSortKey(a);
  const [bn, br] = streetSortKey(b);
  if (an !== bn) return an - bn;
  return ar < br ? -1 : ar > br ? 1 : 0;
}

function getAppointmentAddress(project) {
  const role = (project.role || project.appointment_role || '').toUpperCase();

  if (project.appointment_address) return project.appointment_address;
  if (role === 'AO') {
    const firstAO = (project.aos || [])[0];
    return firstAO?.premise || firstAO?.address || firstAO?.reg_addr || project.address || '';
  }

  return project.address || project.bo_premise_address || '';
}

function getAppointmentName(project) {
  const role = (project.role || project.appointment_role || '').toUpperCase();

  if (project.appointment_name) return project.appointment_name;

  if (role === 'AO') {
    const firstAO = (project.aos || [])[0];
    return firstAO?.name || '';
  }

  return project.bo || project.bo_1_name || '';
}

function ProjectCard({ project, onClick }) {
  const colour = getProjectColour(project);
  const aoCount = (project.aos || []).length;
  const date = project.created_at
    ? new Date(project.created_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  const role = (project.role || project.appointment_role || 'BO').toUpperCase();
  const displayAddress = getAppointmentAddress(project);
  const appointmentName = getAppointmentName(project);

  return (
    <div
      onClick={() => onClick(project)}
      style={{
        background: '#ffffff',
        border: '1px solid #e7eaf0',
        borderRadius: 18,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = colour;
        e.currentTarget.style.boxShadow = '0 8px 22px rgba(15,23,42,0.10)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#e7eaf0';
        e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,0.06)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ width: 4, background: colour, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '14px 16px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 7,
          gap: 8,
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text3)',
            letterSpacing: '0.3px',
          }}>
            {project.ref}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 99,
              background: role === 'AO' ? 'var(--purple-bg)' : 'var(--blue-bg)',
              color: role === 'AO' ? 'var(--purple)' : 'var(--blue)',
              border: `1px solid ${role === 'AO' ? 'var(--purple)' : 'var(--blue)'}`,
            }}>
              {role === 'AO' ? 'AO' : 'BO'}
            </span>

            <span style={{
              fontSize: 10.5,
              fontWeight: 500,
              padding: '2px 7px',
              borderRadius: 99,
              background: '#f8fafc',
              color: 'var(--text3)',
              border: '1px solid #edf0f4',
            }}>
              {project.status || 'active'}
            </span>
          </div>
        </div>

        {displayAddress && (
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 5,
            lineHeight: 1.4,
          }}>
            {displayAddress}
          </div>
        )}

        {appointmentName && (
          <div style={{
            fontSize: 12,
            color: 'var(--text3)',
            marginBottom: 8,
          }}>
            {appointmentName}
          </div>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11.5, color: colour, fontWeight: 500 }}>
            {aoCount} {aoCount === 1 ? 'AO' : 'AOs'}
            {project.fee ? ` · £${parseFloat(project.fee).toLocaleString('en-GB')}` : ''}
          </span>

          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            {date}
          </span>
        </div>
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
  const [showNewProject, setShowNewProject] = useState(false);

  useEffect(() => {
    setLoading(true);
    loadProjects().finally(() => setLoading(false));
  }, [loadProjects]);

  const filtered = projects.filter(p => {
    const matchesFilter = filter === 'all' || p.status === filter;
    const q = search.toLowerCase();

    const appointmentAddress = getAppointmentAddress(p);
    const appointmentName = getAppointmentName(p);

    const matchesSearch = !q
      || (p.ref || '').toLowerCase().includes(q)
      || (appointmentAddress || '').toLowerCase().includes(q)
      || (appointmentName || '').toLowerCase().includes(q)
      || (p.address || '').toLowerCase().includes(q)
      || (p.bo || '').toLowerCase().includes(q)
      || (p.bo_1_name || '').toLowerCase().includes(q)
      || (p.works || '').toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  }).sort((a, b) => compareAddresses(getAppointmentAddress(a), getAppointmentAddress(b)));

  const handleCreated = (newProject) => {
    loadProjects();
    if (newProject) onOpenProject(newProject);
  };

  return (
    <div style={{ padding: '24px 28px', background: '#f1f3f6', minHeight: '100%' }}>
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={handleCreated}
        />
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search projects…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: 13,
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            color: 'var(--text)',
            outline: 'none',
          }}
        />

        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            fontSize: 13,
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            color: 'var(--text)',
            cursor: 'pointer',
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
          onClick={() => {
            setLoading(true);
            loadProjects().finally(() => setLoading(false));
          }}
        >
          ↻ Refresh
        </button>

        <button
          className="btn btn-primary btn-sm"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowNewProject(true)}
        >
          + New project
        </button>
      </div>

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
          gap: 12,
        }}>
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p} onClick={onOpenProject} />
          ))}
        </div>
      )}
    </div>
  );
}
