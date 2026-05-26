import { useCallback, useEffect, useMemo, useState } from 'react';
import ProjectDetail from './ProjectDetail';
import NoticeServingModal from './NoticeServingModal';
import useDocumentGenerator from '../../hooks/useDocumentGenerator';
import sb from '../../supabaseClient';

const aoAddress = ao => ao?.premise || ao?.reg_addr || ao?.address || '';

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

function aoKey(item) {
  return String(
    item?.id ||
    item?.num ||
    item?.name ||
    item?.premise ||
    item?.address ||
    ''
  );
}

function addDaysIsoFromDate(value, days) {
  const [year, month, day] = String(value).split('-').map(Number);

  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + Number(days || 0));

  return date.toISOString().slice(0, 10);
}

async function persistAOStatus(projectId, ao, patch) {
  const { data: project, error } = await sb
    .from('projects')
    .select('id,aos')
    .eq('id', projectId)
    .single();

  if (error) {
    throw error;
  }

  const currentAOs = Array.isArray(project?.aos)
    ? project.aos
    : [];

  const nextAOs = currentAOs.map(item =>
    aoKeyMatches(item, ao)
      ? {
          ...item,
          ...patch,
          updated_at: new Date().toISOString(),
        }
      : item
  );

  const { error: updateError } = await sb
    .from('projects')
    .update({
      aos: nextAOs,
    })
    .eq('id', projectId);

  if (updateError) {
    throw updateError;
  }

  return nextAOs;
}

export default function ProjectDetailNoticeWorkflow(props) {
  const [project, setProject] = useState(props.project);
  const [noticeAO, setNoticeAO] = useState(undefined);

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

  const handleClickCapture = useCallback(event => {
    const button = event.target?.closest?.('button');

    if (!button) return;

    if (button.closest('[data-notice-serving-modal="true"]')) {
      return;
    }

    const label = (button.textContent || '')
      .trim()
      .toLowerCase();

    if (label !== 'serve notice') return;

    event.preventDefault();
    event.stopPropagation();

    const aos = project?.aos || [];

    let matchedAO = null;

    aos.forEach(item => {
      const token = `AO${item?.num || ''}`;

      if (
        button.textContent?.includes(token)
      ) {
        matchedAO = item;
      }
    });

    openNoticeModal(matchedAO || null);
  }, [openNoticeModal, project]);

  const persistWorkflow = useCallback(async payload => {
    const {
      ao,
      sections = [],
      noticeDate,
    } = payload;

    if (!ao) {
      throw new Error('No adjoining owner supplied.');
    }

    const patch = {};

    const hasStandardNotice = sections.some(s =>
      ['s1', 's3', 's6'].includes(s)
    );

    if (hasStandardNotice) {
      patch.status = 'notice_served';
      patch.notice_served_date = noticeDate;
      patch.noticeServedDate = noticeDate;

      const consentDeadline =
        addDaysIsoFromDate(noticeDate, 14);

      patch.consent_deadline = consentDeadline;
      patch.consentDeadline = consentDeadline;
    }

    if (sections.includes('s10')) {
      patch.status = 's10';

      patch.s10_served_date = noticeDate;
      patch.s10ServedDate = noticeDate;

      const s10Deadline =
        addDaysIsoFromDate(noticeDate, 10);

      patch.s10_deadline = s10Deadline;
      patch.s10Deadline = s10Deadline;
    }

    const updatedAOs = await persistAOStatus(
      project.id,
      ao,
      patch
    );

    setProject(prev => ({
      ...prev,
      aos: updatedAOs,
    }));

    return {
      success: true,
      patch,
    };
  }, [project.id]);

  const projectForChild = useMemo(
    () => ({ ...project }),
    [project]
  );

  return (
    <div
      style={{ position: 'relative' }}
      onClickCapture={handleClickCapture}
    >
      {noticeAO !== undefined && (
        <div data-notice-serving-modal="true">
          <NoticeServingModal
            project={projectForChild}
            ao={noticeAO}
            aos={projectForChild?.aos || []}
            defaultSections={[]}
            generateDocument={generateDocument}
            onServe={persistWorkflow}
            onClose={closeNoticeModal}
          />
        </div>
      )}

      <ProjectDetail
        {...props}
        project={projectForChild}
      />

      <div
        style={{
          position: 'absolute',
          right: 24,
          top: 92,
          width: 300,
          maxWidth: 'calc(100vw - 48px)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '14px 16px',
            boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text)',
              marginBottom: 6,
            }}
          >
            📋 Notices
          </div>

          <div
            style={{
              fontSize: 11.5,
              color: 'var(--text3)',
              lineHeight: 1.45,
              marginBottom: 10,
            }}
          >
            Generate and record notices for one or more adjoining owners.
          </div>

          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => openNoticeModal(null)}
            style={{
              width: '100%',
              cursor: 'pointer',
              borderRadius: 99,
            }}
          >
            Serve notice
          </button>
        </div>
      </div>
    </div>
  );
}
