import { useCallback, useEffect, useMemo, useState } from 'react';
import ProjectDetail from './ProjectDetail';
import NoticeServingModal from './NoticeServingModal';
import useDocumentGenerator from '../../hooks/useDocumentGenerator';

const aoAddress = ao => ao?.premise || ao?.reg_addr || ao?.address || '';

function aoKeyMatches(a, target) {
  if (!a || !target) return false;
  if (a.id && target.id) return a.id === target.id;
  if (a.num && target.num) return String(a.num) === String(target.num);
  return a.name === target.name && aoAddress(a) === aoAddress(target);
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

function applyNoticeResultToProject(project, result) {
  const completed = result?.completed || [];
  if (!completed.length) return project;

  const latestPatchByAO = new Map();

  completed.forEach(item => {
    const ao = item.ao;
    const patch = item.recorded?.status_patch || null;
    if (!ao || !patch) return;
    latestPatchByAO.set(String(ao.id || ao.num || ao.name || ''), { ao, patch });
  });

  const nextAOs = (project.aos || []).map(existing => {
    let matched = null;

    latestPatchByAO.forEach(value => {
      if (aoKeyMatches(existing, value.ao)) matched = value;
    });

    if (!matched) return existing;

    return {
      ...existing,
      ...matched.patch,
      updated_at: new Date().toISOString(),
    };
  });

  return {
    ...project,
    aos: nextAOs,
  };
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

  const handleNoticeServed = useCallback(async result => {
    setProject(prev => applyNoticeResultToProject(prev, result));
  }, []);

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

    const ao = findAOFromClickTarget(button, project.aos || []);
    openNoticeModal(ao || null);
  }, [openNoticeModal, project.aos]);

  const projectForChild = useMemo(() => ({ ...project }), [project]);

  return (
    <div style={{ position: 'relative' }} onClickCapture={handleClickCapture}>
      {noticeAO !== undefined && (
        <div data-notice-serving-modal="true">
          <NoticeServingModal
            project={projectForChild}
            initialAO={noticeAO}
            generateDocument={generateDocument}
            onServed={handleNoticeServed}
            onClose={closeNoticeModal}
          />
        </div>
      )}

      <ProjectDetail {...props} project={projectForChild} />

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
