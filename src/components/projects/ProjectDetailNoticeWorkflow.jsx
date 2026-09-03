import { useEffect, useState } from 'react';
import ProjectDetail from './ProjectDetail';
import sb from '../../supabaseClient';
import { saveAdjoiningOwners } from '../../utils/adjoiningOwners';

function addDaysIso(value, days) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function aoKey(ao) {
  return String(ao?.id || ao?.num || ao?.ao_id || '');
}

function isAdvancedStatus(status) {
  return [
    'consent',
    'dissent',
    's104b',
    'award',
    'award_served',
    'complete',
    'appointed_ao',
  ].includes(String(status || '').toLowerCase());
}

async function reconcileNoticeStatuses(projectId) {
  if (!projectId || !sb) return;

  const [{ data: project, error: projectError }, { data: noticeRows, error: noticeError }] = await Promise.all([
    sb.from('projects').select('id,aos').eq('id', projectId).single(),
    sb
      .from('notices')
      .select('ao_id,notice_date,section_1,section_2,section_3,section_6,section_10,status,run_number')
      .eq('project_id', projectId)
      .eq('status', 'served')
      .order('run_number', { ascending: true }),
  ]);

  if (projectError) throw projectError;
  if (noticeError) throw noticeError;

  const rows = noticeRows || [];
  const currentAOs = Array.isArray(project?.aos) ? project.aos : [];
  if (!currentAOs.length || !rows.length) return;

  let changed = false;
  const updatedAOs = currentAOs.map(ao => {
    const key = aoKey(ao);
    const aoRows = rows.filter(row => String(row?.ao_id || '') === key);
    if (!aoRows.length) return ao;

    const ordinaryRows = aoRows.filter(row => row.section_1 || row.section_2 || row.section_3 || row.section_6);
    const s10Rows = aoRows.filter(row => row.section_10);
    const ordinaryDate = ordinaryRows.at(-1)?.notice_date || '';
    const s10Date = s10Rows.at(-1)?.notice_date || '';

    const patch = {};

    if (ordinaryDate) {
      patch.notice_served_date = ordinaryDate;
      patch.noticeServedDate = ordinaryDate;
      patch.consent_deadline = addDaysIso(ordinaryDate, 14);
      patch.consentDeadline = patch.consent_deadline;
    }

    if (s10Date) {
      patch.s10_served_date = s10Date;
      patch.s10ServedDate = s10Date;
      patch.s10_deadline = addDaysIso(s10Date, 10);
      patch.s10Deadline = patch.s10_deadline;
      patch.consent_deadline = '';
      patch.consentDeadline = '';
    }

    if (!isAdvancedStatus(ao.status)) {
      patch.status = s10Date ? 's10' : ordinaryDate ? 'notice_served' : ao.status;
    }

    const needsUpdate = Object.entries(patch).some(([field, value]) => ao?.[field] !== value);
    if (!needsUpdate) return ao;

    changed = true;
    return { ...ao, ...patch, updated_at: new Date().toISOString() };
  });

  if (!changed) return;

  const { error } = await saveAdjoiningOwners(projectId, updatedAOs);
  if (error) throw error;
}

export default function ProjectDetailNoticeWorkflow(props) {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const openComposer = event => {
      if (event?.detail) props.onOpenComposer?.(event.detail);
    };

    const refreshProject = async () => {
      try {
        await reconcileNoticeStatuses(props.project?.id);
      } catch (error) {
        console.warn('[notice reconciliation] failed:', error?.message || error);
      } finally {
        if (active) setRefreshKey(key => key + 1);
      }
    };

    window.addEventListener('ely:open-project-composer', openComposer);
    window.addEventListener('ely:refresh-project-detail', refreshProject);

    // Repair any previously missed AO status as soon as the project is opened.
    refreshProject();

    return () => {
      active = false;
      window.removeEventListener('ely:open-project-composer', openComposer);
      window.removeEventListener('ely:refresh-project-detail', refreshProject);
    };
  }, [props.onOpenComposer, props.project?.id]);

  useEffect(() => {
    const keepFinaliseVisible = () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const finaliseButton = buttons.find(button => {
        const text = (button.textContent || '').trim();
        return text === 'Finalise →' || text.startsWith('Confirm AO ');
      });

      if (!finaliseButton) return;

      Object.assign(finaliseButton.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: '1050',
        minWidth: '150px',
        minHeight: '44px',
        boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
      });
    };

    keepFinaliseVisible();
    const observer = new MutationObserver(keepFinaliseVisible);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', keepFinaliseVisible);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', keepFinaliseVisible);
    };
  }, [refreshKey]);

  return <ProjectDetail key={refreshKey} {...props} />;
}
