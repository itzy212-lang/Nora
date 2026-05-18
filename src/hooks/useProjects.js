import { useCallback } from 'react';
import { useApp } from '../state/appStore';
import sb from '../supabaseClient';

export function useProjects() {
  const { state, dispatch } = useApp();

  const loadProjects = useCallback(async () => {
    if (!sb) return;
    try {
      const { data: rows, error } = await sb
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const projectRows = rows || [];

      // Load AOs
      if (projectRows.length > 0) {
        const ids = projectRows.map(p => p.id);
        const { data: aoRows } = await sb
          .from('ao')
          .select('*')
          .in('project_id', ids);
        const aoMap = {};
        (aoRows || []).forEach(ao => {
          if (!aoMap[ao.project_id]) aoMap[ao.project_id] = [];
          aoMap[ao.project_id].push(ao);
        });

        // Load documents
        const { data: docRows } = await sb
          .from('documents')
          .select('*')
          .in('project_id', ids);
        const docMap = {};
        (docRows || []).forEach(d => {
          if (!docMap[d.project_id]) docMap[d.project_id] = [];
          docMap[d.project_id].push(d);
        });

        // Load notices
        const { data: noticeRows } = await sb
          .from('notices')
          .select('*')
          .in('project_id', ids);
        const noticeMap = {};
        (noticeRows || []).forEach(n => {
          if (!noticeMap[n.project_id]) noticeMap[n.project_id] = [];
          noticeMap[n.project_id].push(n);
        });

        const enriched = projectRows.map(p => ({
          ...p,
          aos: (aoMap[p.id] || []).map((ao, i) => ({ ...ao, num: i + 1 })),
          documents: docMap[p.id] || [],
          notices: noticeMap[p.id] || [],
          awards_list: [],
          _t: new Date(p.created_at || 0).getTime(),
        }));
        dispatch({ type: 'SET_PROJECTS', payload: enriched });
        return enriched;
      }

      dispatch({ type: 'SET_PROJECTS', payload: [] });
      return [];
    } catch (err) {
      console.error('[useProjects] load failed:', err);
      return [];
    }
  }, [dispatch]);

  const saveProject = useCallback(async (project) => {
    if (!sb) return null;
    try {
      if (project.id) {
        const { data, error } = await sb
          .from('projects')
          .update(project)
          .eq('id', project.id)
          .select('*')
          .single();
        if (error) throw error;
        dispatch({ type: 'UPDATE_PROJECT', payload: data });
        return data;
      } else {
        const { data, error } = await sb
          .from('projects')
          .insert(project)
          .select('*')
          .single();
        if (error) throw error;
        dispatch({ type: 'ADD_PROJECT', payload: { ...data, aos: [], documents: [], notices: [], awards_list: [], _t: Date.now() } });
        return data;
      }
    } catch (err) {
      console.error('[useProjects] save failed:', err);
      throw err;
    }
  }, [dispatch]);

  const deleteProject = useCallback(async (projectId) => {
    if (!sb) return;
    await sb.from('documents').delete().eq('project_id', projectId);
    await sb.from('notices').delete().eq('project_id', projectId);
    await sb.from('ao').delete().eq('project_id', projectId);
    await sb.from('projects').delete().eq('id', projectId);
    dispatch({ type: 'REMOVE_PROJECT', payload: projectId });
  }, [dispatch]);

  const setCurrentProject = useCallback((project) => {
    dispatch({ type: 'SET_CURRENT_PROJECT', payload: project });
  }, [dispatch]);

  const clearCurrentProject = useCallback(() => {
    dispatch({ type: 'CLEAR_CURRENT_PROJECT' });
  }, [dispatch]);

  return {
    projects: state.projects,
    currentProject: state.currentProject,
    loadProjects,
    saveProject,
    deleteProject,
    setCurrentProject,
    clearCurrentProject,
  };
}
