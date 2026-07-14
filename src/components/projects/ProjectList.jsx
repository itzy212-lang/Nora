import { useEffect, useState } from 'react';
import { useApp } from '../../state/appStore';
import { useProjects } from '../../hooks/useProjects';
import NewProjectModal from './NewProjectModal';

function getProjectColour(project) {
  const aos = project.aos || [];

  // Grey — no AOs added
  if (aos.length === 0) return '#9ca3af';

  const now = Date.now();

  // Check for any AO with an overdue deadline or stalled 14+ days
  const hasRed = aos.some(ao => {
    const cd = ao.consentDeadline || ao.ao_consent_deadline || ao.consent_deadline;
    const sd = ao.s10Deadline || ao.ao_s10_deadline || ao.s10_deadline;
    const st = (ao.status || ao.ao_status || '').toLowerCase();
    const resolved = ['consent', 'complete', 'award_served'].includes(st);
    const awardServed = !!(ao.award_served_date || ao.awardServedDate);
    if (resolved || awardServed) return false;
    // Dissent with surveyor appointed — not red regardless of deadlines
    const hasSurveyor = !!(ao.surv_name || ao.surveyorName || ao.ao_surveyor_name || ao.aoSurveyorName || ao.agreed_surveyor || ao.agreedSurveyor);
    if (st === 'dissent' && hasSurveyor) return false;
    // 10(4)(b) served — not red
    if (ao.s104b_served_date || ao.s104bServedDate) return false;
    // Overdue consent deadline (only if not dissent)
    if (cd && new Date(cd).getTime() < now && !['consent','dissent'].includes(st)) return true;
    // Overdue S10 deadline (only if not dissent with surveyor)
    if (sd && new Date(sd).getTime() < now && st !== 'dissent') return true;
    // Stale — no progress for 14+ days
    const lastChange = ao.last_status_change ? new Date(ao.last_status_change) : null;
    const noticed = !!(ao.noticeServedDate || ao.notice_served_date || ao.ao_notice_served_date || cd);
    if (noticed && lastChange && Math.floor((now - lastChange.getTime()) / 86400000) >= 14) return true;
    return false;
  });
  if (hasRed) return '#ef4444';

  // Amber — deadline approaching (≤3 days) or dissent with no surveyor
  const hasAmber = aos.some(ao => {
    const cd = ao.consentDeadline || ao.ao_consent_deadline || ao.consent_deadline;
    const sd = ao.s10Deadline || ao.ao_s10_deadline || ao.s10_deadline;
    const st = (ao.status || ao.ao_status || '').toLowerCase();
    if (cd) {
      const daysLeft = Math.ceil((new Date(cd).getTime() - now) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 3) return true;
    }
    if (sd) {
      const daysLeft = Math.ceil((new Date(sd).getTime() - now) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 3) return true;
    }
    // Dissent with no surveyor and no agreed surveyor
    if (st === 'dissent' && !ao.agreed_surveyor && !ao.surv_name && !ao.surveyorName && !ao.ao_surveyor_name && !ao.aoSurveyorName) return true;
    // Stale 10-13 days
    const lastChange = ao.last_status_change ? new Date(ao.last_status_change) : null;
    const noticed = !!(ao.noticeServedDate || ao.notice_served_date || ao.ao_notice_served_date || cd);
    if (noticed && lastChange) {
      const days = Math.floor((now - lastChange.getTime()) / 86400000);
      if (days >= 10 && days < 14) return true;
    }
    return false;
  });
  if (hasAmber) return '#f59e0b';

  // Check if any notice has been served
  const hasNotices = aos.some(ao =>
    ao.consentDeadline || ao.noticeServedDate ||
    ao.ao_notice_served_date || ao.ao_consent_deadline ||
    ao.consent_deadline || ao.notice_served_date
  );

  // Green — notice served and on track
  if (hasNotices) return '#22c55e';

  // Blue — AOs added but no notice served yet
  return '#3b82f6';
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

  // No-AO warning — project older than 3 days with no AOs
  const createdAt = project.created_at ? new Date(project.created_at) : null;
  const projectAgeDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 86400000) : 0;
  const showNoAOWarning = aoCount === 0 && projectAgeDays >= 3;
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

  // Get most actionable AO status to show on card
  const aos = project.aos || [];
  let cardStatus = null;
  if (aos.length > 0) {
    const getSimpleStatus = (ao) => {
      const st = (ao?.status || '').toLowerCase();
      if (ao?.award_served_date || ao?.awardServedDate || st === 'complete') return null; // done, don't show
      if (ao?.award_generated_at || ao?.awardGeneratedAt || st === 'award') return { label: 'Award drafted — serve', colour: '#f59e0b' };
      if (st === 'dissent' && !ao.surv_name && !ao.surveyorName && !ao.ao_surveyor_name && !ao.aoSurveyorName && !ao.agreed_surveyor) return { label: 'Dissent — no surveyor', colour: '#ef4444' };
      if (st === 'dissent') return null; // surveyor appointed — no urgent action
      if (st === 'consent') return { label: 'Consent received', colour: '#22c55e' };
      if (st === 's10') {
        const sd = ao?.s10_deadline || ao?.s10Deadline || '';
        const days = sd ? Math.ceil((new Date(sd) - new Date()) / 86400000) : null;
        if (days !== null && days <= 0) return { label: 'Serve 10(4)(b)', colour: '#ef4444' };
        if (days !== null && days <= 3) return { label: `S.10 — ${days}d left`, colour: '#f59e0b' };
        return null;
      }
      if (st === 'notice_served') {
        const cd = ao?.consent_deadline || ao?.consentDeadline || '';
        const days = cd ? Math.ceil((new Date(cd) - new Date()) / 86400000) : null;
        if (days !== null && days <= 0) return { label: 'Serve Section 10', colour: '#ef4444' };
        if (days !== null && days <= 3) return { label: `Deadline — ${days}d`, colour: '#f59e0b' };
        return null;
      }
      return null;
    };
    const statuses = aos.map(getSimpleStatus).filter(Boolean);
    const red = statuses.find(s => s.colour === '#ef4444');
    const amber = statuses.find(s => s.colour === '#f59e0b');
    cardStatus = red || amber || statuses[0] || null;
  }

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

          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {project.project_type === 'construction' && (
              <span style={{
                fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
                background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
              }}>
                🏗️ PM
              </span>
            )}
            {(!project.project_type || project.project_type === 'party_wall') && (
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
            )}

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
            {project.fee ? ` . £${parseFloat(project.fee).toLocaleString('en-GB')}` : ''}
          </span>
          {showNoAOWarning && (
            <span style={{
              fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
              background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
            }}>
              ⚠️ No AO
            </span>
          )}
          {!showNoAOWarning && cardStatus && (
            <span style={{
              fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
              background: cardStatus.colour + '22',
              color: cardStatus.colour,
              border: '1px solid ' + cardStatus.colour + '44',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {cardStatus.label}
            </span>
          )}

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
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

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

  const handleCreated = async (newProject) => {
    await loadProjects();
    if (newProject) onOpenProject(newProject);
  };

  const handleSyncOneDrive = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const sb = (await import('../../supabaseClient')).default;
      const { data: projects } = await sb
        .from('projects')
        .select('id, bo_premise_address, onedrive_folder_id, aos');

      let projectsCreated = 0;
      let aosCreated = 0;
      let failed = 0;

      for (const project of (projects || [])) {
        // 1. Create project folder if missing
        let folderId = project.onedrive_folder_id;
        if (!folderId && project.bo_premise_address) {
          try {
            const res = await fetch('/api/onedrive-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: 'help@sq1consulting.co.uk',
                action: 'create_project_folder',
                project_address: project.bo_premise_address,
              }),
            });
            const data = await res.json();
            if (data.success && data.folder_id) {
              folderId = data.folder_id;
              await sb.from('projects').update({
                onedrive_folder_id: data.folder_id,
                onedrive_folder_url: data.web_url || null,
              }).eq('id', project.id);
              projectsCreated++;
            } else {
              failed++;
            }
          } catch { failed++; }
        }

        // 2. Create AO subfolders for each AO in this project
        if (folderId) {
          const aos = Array.isArray(project.aos) ? project.aos : [];
          let aosUpdated = false;
          const updatedAos = [...aos];

          for (let i = 0; i < updatedAos.length; i++) {
            const ao = updatedAos[i];
            const aoAddress = ao.premise || ao.address || ao.name;
            if (!aoAddress) continue;

            // Skip if already has a folder
            if (ao.onedrive_folder_id) continue;

            try {
              const res = await fetch('/api/onedrive-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  user_id: 'help@sq1consulting.co.uk',
                  action: 'create_ao_folder',
                  project_folder_id: folderId,
                  ao_address: aoAddress,
                }),
              });
              const data = await res.json();
              if (data.success && data.folder_id) {
                updatedAos[i] = {
                  ...ao,
                  onedrive_folder_id: data.folder_id,
                  onedrive_folder_url: data.web_url || null,
                };
                aosUpdated = true;
                aosCreated++;
              } else {
                failed++;
              }
            } catch { failed++; }
          }

          // Save updated aos array back to project
          if (aosUpdated) {
            await sb.from('projects').update({ aos: updatedAos }).eq('id', project.id);
          }
        }
      }

      setSyncResult({ projectsCreated, aosCreated, failed });
      await loadProjects();
    } catch (err) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
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
          <option value="award_served">Award Served</option>
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
          className="btn btn-ghost btn-sm"
          style={{ cursor: 'pointer', color: syncing ? '#9ca3af' : '#2563eb' }}
          onClick={handleSyncOneDrive}
          disabled={syncing}
          title="Create OneDrive folders for any projects that don't have one yet"
        >
          {syncing ? '⏳ Syncing…' : '☁ Sync OneDrive'}
        </button>

        {syncResult && !syncing && (
          <span style={{ fontSize: 12, color: syncResult.error ? '#ef4444' : '#16a34a' }}>
            {syncResult.error
              ? `Error: ${syncResult.error}`
              : (syncResult.projectsCreated === 0 && syncResult.aosCreated === 0)
              ? '✓ All folders already synced'
              : `✓ ${syncResult.projectsCreated} project${syncResult.projectsCreated !== 1 ? 's' : ''}, ${syncResult.aosCreated} AO folder${syncResult.aosCreated !== 1 ? 's' : ''} created${syncResult.failed ? ` . ${syncResult.failed} failed` : ''}`
            }
          </span>
        )}

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


