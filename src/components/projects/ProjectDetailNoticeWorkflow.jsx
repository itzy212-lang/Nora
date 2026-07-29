import { useEffect, useState } from 'react';
import ProjectDetail from './ProjectDetail';

export default function ProjectDetailNoticeWorkflow(props) {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const openComposer = (event) => {
      if (event?.detail) props.onOpenComposer?.(event.detail);
    };
    const refreshProject = () => setRefreshKey(key => key + 1);

    window.addEventListener('ely:open-project-composer', openComposer);
    window.addEventListener('ely:refresh-project-detail', refreshProject);

    return () => {
      window.removeEventListener('ely:open-project-composer', openComposer);
      window.removeEventListener('ely:refresh-project-detail', refreshProject);
    };
  }, [props.onOpenComposer]);

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
