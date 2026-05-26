import { useCallback, useEffect, useMemo, useState } from 'react';
import ProjectDetail from './ProjectDetail';
import NoticeServingModal from './NoticeServingModal';
import useDocumentGenerator from '../../hooks/useDocumentGenerator';
import sb from '../../supabaseClient';

const aoAddress = ao => ao?.premise || ao?.reg_addr || ao?.address || ao?.service_address || ao?.serviceAddress || '';

function aoKeyMatches(a, target) {
  if (!a || !target) return false;

  if (a.id && target.id) {
    return String(a.id) === String(target.id);
  }

  if (a.num && target.num) {
    return String(a.num) === String(target.num);
  }

  return (
    String(a.name || '') === String(target.name || '') &&
    aoAddress(a) === aoAddress(target)
  );
}

function findAOFromClickTarget(target, aos) {
  let node = target;
  let depth = 0;

  while (node && depth < 12) {
    const text = node.textContent || '';
    const match = text.match(/AO\s*(\d+)/i);

    if (match?.[1]) {
      const ao = aos.find(item => String(item.num) === String(match[1]));
      if (ao) return ao;
    }

    node = node.parentElement;
    depth += 1;
  }

  return null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIsoFromDate(value, days) {
  const [year, month, day] = String(value || todayIso()).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

async function updateProjectAOs(projectId, ao, patch) {
  const { data: freshProject, error: fetchError } = await sb
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (fetchError) throw fetchError;

  const currentAOs = Array.isArray(freshProject?.aos) ? freshProject.aos : [];

  const updatedAOs = currentAOs.map(item =>
    aoKeyMatches(item, ao)
      ? {
          ...item,
          ...patch,
          updated_at: new Date().toISOString(),
        }
      : item
  );

  const { data: savedProject, error: saveError } = await sb
    .from('projects')
    .update({ aos: updatedAOs })
    .eq('id', projectId)
    .select('*')
    .single();

  if (saveError) throw saveError;

  return savedProject || {
    ...freshProject,
    aos: updatedAOs,
  };
}

async function insertNoticeRecord(projectId, ao, sections, includeCover, noticeDate) {
  try {
    await sb.from('notices').insert([{
      project_id: projectId,
      ao_id: ao?.id || String(ao?.num || ''),
      section_1: sections.includes('s1'),
      section_3: sections.includes('s3'),
      section_6: sections.includes('s6'),
      section_10: sections.includes('s10'),
      notice_cover_letter: !!includeCover,
      notice_date: noticeDate,
      status: 'served',
      template_type: sections.includes('s10') ? 's10' : 'notice_pack',
    }]);
  } catch (err) {
    console.warn('[NoticeWorkflow] notices insert warning:', err?.message || err);
  }
}

async function createDeadlineTask(project, ao, title, description, dueDate, taskType) {
  try {
    const aoToken = ao?.id || `AO${ao?.num || ''}`;

    const { data: existing } = await sb
      .from('tasks')
      .select('id')
      .eq('project_id', project.id)
      .eq('task_type', taskType)
      .eq('due_date', dueDate)
      .ilike('description', `%AO_REF:${aoToken}%`)
      .limit(1);

    if (existing?.length) return existing[0];

    const { data, error } = await sb
      .from('tasks')
      .insert([{
        project_id: project.id,
        title,
        description: `${description || ''}\nAO_REF:${aoToken}`,
        due_date: dueDate,
        task_type: taskType,
        status: 'open',
        priority: 'high',
        project_address_snapshot: aoAddress(ao) || project.bo_premise_address || project.address || '',
      }])
      .select('id')
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('[NoticeWorkflow] task warning:', err?.message || err);
    return null;
  }
}

export default function ProjectDetailNoticeWorkflow(props) {
  const [project, setProject] = useState(props.project);
  const [noticeAO, setNoticeAO] = useState(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const { generateDocument } = useDocumentGenerator();

  useEffect(() => {
    setProject(props.project);
  }, [props.project]);

  const openNoticeModal = useCallback((ao = null) => {
    setNoticeAO(ao);
  }, []);

  const closeNoticeModal = useCallback(() => {
    setNoticeAO(undefined);
  }, []);

  const persistNoticeWorkflow = useCallback(async ({
    ao,
    sections = [],
    includeCover = false,
    noticeDate: suppliedNoticeDate,
    createDeadlineTask: shouldCreateDeadlineTask = true,
  }) => {
    if (!project?.id) throw new Error('No project ID found.');
    if (!ao) throw new Error('No adjoining owner selected.');

    const noticeDate = suppliedNoticeDate || todayIso();
    const patch = {};

    await insertNoticeRecord(project.id, ao, sections, includeCover, noticeDate);

    const hasStandardNotice = sections.some(section => ['s1', 's3', 's6'].includes(section));

    if (hasStandardNotice) {
      const consentDeadline = addDaysIsoFromDate(noticeDate, 14);

      Object.assign(patch, {
        status: 'notice_served',
        notice_served_date: noticeDate,
        noticeServedDate: noticeDate,
        consent_deadline: consentDeadline,
        consentDeadline: consentDeadline,
      });

      if (shouldCreateDeadlineTask) {
        await createDeadlineTask(
          project,
          ao,
          `Consent deadline — AO${ao.num || ''} ${ao.name || ''}`.trim(),
          '14-day notice consent period expired. Review whether Section 10 is required.',
          consentDeadline,
          'notice_consent_deadline'
        );
      }
    }

    if (sections.includes('s10')) {
      const s10Deadline = addDaysIsoFromDate(noticeDate, 10);

      Object.assign(patch, {
        status: 's10',
        s10_served_date: noticeDate,
        s10ServedDate: noticeDate,
        s10_deadline: s10Deadline,
        s10Deadline: s10Deadline,
      });

      if (shouldCreateDeadlineTask) {
        await createDeadlineTask(
          project,
          ao,
          `Section 10 deadline — AO${ao.num || ''} ${ao.name || ''}`.trim(),
          '10-day Section 10 notice period expired.',
          s10Deadline,
          'notice_section10_deadline'
        );
      }
    }

    if (!Object.keys(patch).length) {
      return {
        completed: [{ ao, recorded: { status_patch: {} } }],
      };
    }

    const savedProject = await updateProjectAOs(project.id, ao, patch);

    setProject(savedProject);
    setRefreshKey(value => value + 1);

    return {
      completed: [{
        ao,
        recorded: {
          status_patch: patch,
        },
      }],
      project: savedProject,
    };
  }, [project]);

  const handleClickCapture = useCallback(event => {
    const button = event.target?.closest?.('button');
    if (!button) return;

    if (button.closest('[data-notice-serving-modal="true"]')) {
      return;
    }

    const label = (button.textContent || '').trim().toLowerCase();
    if (label !== 'serve notice') return;

    event.preventDefault();
    event.stopPropagation();

    const ao = findAOFromClickTarget(button, project?.aos || []);
    openNoticeModal(ao || null);
  }, [openNoticeModal, project?.aos]);

  const projectForChild = useMemo(() => ({ ...project }), [project]);

  return (
    <div style={{ position: 'relative' }} onClickCapture={handleClickCapture}>
      {noticeAO !== undefined && (
        <div data-notice-serving-modal="true">
          <NoticeServingModal
            project={projectForChild}
            ao={noticeAO}
            aos={projectForChild?.aos || []}
            defaultSections={[]}
            generateDocument={generateDocument}
            onServe={persistNoticeWorkflow}
            onClose={closeNoticeModal}
          />
        </div>
      )}

      <ProjectDetail
        key={`${projectForChild?.id || 'project'}-${refreshKey}`}
        {...props}
        project={projectForChild}
      />

      <div style={{
        position: 'absolute',
        right: 24,
        top: 92,
        width: 300,
        maxWidth: 'calc(100vw - 48px)',
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '14px 16px',
          boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
          pointerEvents: 'auto',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            📋 Notices
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 10 }}>
            Generate and record notices for one or more adjoining owners.
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => openNoticeModal(null)}
            style={{ width: '100%', cursor: 'pointer', borderRadius: 99 }}
          >
            Serve notice
          </button>
        </div>
      </div>
    </div>
  );
}
