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

      if (projectRows.length > 0) {
        const ids = projectRows.map(p => p.id);

        // Load adjoining owners
        const { data: aoRows } = await sb
          .from('adjoining_owners')
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

        const enriched = projectRows.map(p => ({
          ...p,
          // Normalise field names so components use consistent keys
          address:  p.bo_premise_address || p.name || '',
          bo:       p.bo_1_name || p.bo || '',
          bo_email: p.bo_1_email || '',
          bo_phone: p.bo_phone || '',
          // AOs from adjoining_owners table
          aos: (aoMap[p.id] || []).map((ao, i) => ({
            ...ao,
            num:   i + 1,
            label: `AO ${i + 1}`,
          })),
          documents: docMap[p.id] || [],
          _t: p._t || new Date(p.created_at || 0).getTime(),
        }));

        dispatch({ type: 'SET_PROJECTS', payload: enriched });
        return enriched;
      }

      dispatch({ type: 'SET_PROJECTS', payload: [] });
      return [];
    } catch (err) {
      console.error('loadProjects error:', err);
      return [];
    }
  }, [dispatch]);

  const setCurrentProject = useCallback((project) => {
    dispatch({ type: 'SET_CURRENT_PROJECT', payload: project });
  }, [dispatch]);

  const clearCurrentProject = useCallback(() => {
    dispatch({ type: 'SET_CURRENT_PROJECT', payload: null });
  }, [dispatch]);

  const saveProject = useCallback(async (projectData) => {
    if (!sb) return;
    const { data, error } = await sb
      .from('projects')
      .upsert({
        ...projectData,
        bo_premise_address: projectData.address || projectData.bo_premise_address || '',
        bo_1_name:          projectData.bo      || projectData.bo_1_name || '',
      }, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    await loadProjects();
    return data;
  }, [loadProjects]);

  const deleteProject = useCallback(async (id) => {
    if (!sb) return;
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) throw error;
    await loadProjects();
  }, [loadProjects]);

  return { loadProjects, setCurrentProject, clearCurrentProject, saveProject, deleteProject };
}
