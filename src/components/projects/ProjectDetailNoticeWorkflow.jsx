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

  return <ProjectDetail key={refreshKey} {...props} />;
}
