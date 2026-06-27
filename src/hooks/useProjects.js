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

        const { data: docRows } = await sb
          .from('documents')
          .select('*')
          .in('project_id', ids);
        const docMap = {};
        (docRows || []).forEach(d => {
          if (!docMap[d.project_id]) docMap[d.project_id] = [];
          docMap[d.project_id].push(d);
        });

        const enriched = projectRows.map(p => {
          // AOs come from project.aos JSONB — field names from the old app:
          // premise = address, reg_addr = registered address
          // surv_name/firm/email/phone, consent_deadline, notice_served_date, s10_deadline
          const aos = Array.isArray(p.aos) ? p.aos : [];

          return {
            ...p,
            address:  p.bo_premise_address || p.name || '',
            bo:       p.bo_1_name          || p.bo   || '',
            bo_email: p.bo_1_email         || '',
            bo_phone: p.bo_phone           || '',
            aos,
            documents: docMap[p.id] || [],
            _t: p._t || new Date(p.created_at || 0).getTime(),
          };
        });

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

  const setCurrentProject   = useCallback((p) => dispatch({ type: 'SET_CURRENT_PROJECT', payload: p }),   [dispatch]);
  const clearCurrentProject = useCallback(() => dispatch({ type: 'SET_CURRENT_PROJECT', payload: null }), [dispatch]);

  const saveProject = useCallback(async (projectData) => {
    if (!sb) return;

    // Build upsert payload — never overwrite aos unless explicitly provided
    // This prevents the upsert from wiping existing AO data on project edits
    const upsertPayload = {
      ...projectData,
      bo_premise_address: projectData.address  || projectData.bo_premise_address || '',
      bo_1_name:          projectData.bo       || projectData.bo_1_name          || '',
      bo_1_email:         projectData.bo_email || projectData.bo_1_email         || '',
    };

    // If aos not explicitly provided in projectData, remove it from payload
    // so existing aos in DB is preserved
    if (!Object.prototype.hasOwnProperty.call(projectData, 'aos')) {
      delete upsertPayload.aos;
    }

    const { data, error } = await sb
      .from('projects')
      .upsert(upsertPayload, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;

    // Create OneDrive folder if not already created
    const boAddress = projectData.address || projectData.bo_premise_address || '';
    const alreadyHasFolder = projectData.onedrive_folder_id || data?.onedrive_folder_id;
    if (boAddress && !alreadyHasFolder) {
      try {
        const folderRes = await fetch('/api/onedrive-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: 'help@sq1consulting.co.uk',
            action: 'create_project_folder',
            project_address: boAddress,
          }),
        });
        const folderData = await folderRes.json();
        if (folderData.success && folderData.folder_id) {
          await sb.from('projects').update({
            onedrive_folder_id: folderData.folder_id,
            onedrive_folder_url: folderData.web_url || null,
          }).eq('id', data.id);
        }
      } catch (folderErr) {
        console.warn('[saveProject] OneDrive folder creation failed:', folderErr.message);
      }
    }

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
