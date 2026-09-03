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

        // Added 2026-09-03, stage 2 of the AO consolidation planned
        // and audited yesterday: adjoining_owners is now the migrated,
        // verified source (every project's row count confirmed to
        // match its original JSON exactly before this was switched
        // on). Fetched here, transformed back into the exact same
        // shape the rest of the app already reads from project.aos —
        // nothing downstream needs to change for this stage. The JSON
        // fallback stays in place per project (not just globally) as
        // the safety net agreed in the plan, for any row this doesn't
        // cover.
        const { data: aoRows } = await sb
          .from('adjoining_owners')
          .select('*')
          .in('project_id', ids);
        const aoMap = {};
        (aoRows || []).forEach(ao => {
          if (!aoMap[ao.project_id]) aoMap[ao.project_id] = [];
          aoMap[ao.project_id].push({
            id: ao.id,
            num: ao.num,
            name: ao.name,
            name2: ao.name2,
            email: ao.email,
            email2: ao.email2,
            phone: ao.phone,
            phone2: ao.phone2,
            status: ao.status,
            premise: ao.address,
            address: ao.address,
            reg_addr: ao.reg_addr,
            service_address: ao.service_address,
            surv_name: ao.surveyor_name,
            surveyorName: ao.surveyor_name,
            surv_email: ao.surveyor_email,
            surveyorEmail: ao.surveyor_email,
            surv_firm: ao.surveyor_firm,
            surveyorFirm: ao.surveyor_firm,
            third_surveyor_name: ao.third_surveyor_name,
            third_surveyor_email: ao.third_surveyor_email,
            third_surveyor_firm: ao.third_surveyor_firm,
            onedrive_folder_id: ao.onedrive_folder_id,
            onedrive_folder_url: ao.onedrive_folder_url,
            consent_deadline: ao.consent_deadline,
            consentDeadline: ao.consent_deadline,
            s10_deadline: ao.s10_deadline,
            s10Deadline: ao.s10_deadline,
            s10_served_date: ao.s10_served_date,
            s10ServedDate: ao.s10_served_date,
            notice_served_date: ao.notice_served_date,
            noticeServedDate: ao.notice_served_date,
            dissent_received_date: ao.dissent_received_date,
            dissentReceivedDate: ao.dissent_received_date,
            s104b_served_date: ao.s104b_served_date,
            award_served_date: ao.award_served_date,
            awardServedDate: ao.award_served_date,
            award_generated_at: ao.award_generated_at,
            awardGeneratedAt: ao.award_generated_at,
            soc_agreed_date: ao.soc_agreed_date,
            soc_date: ao.soc_agreed_date,
            socDate: ao.soc_agreed_date,
            socAgreedDate: ao.soc_agreed_date,
            schedule_of_condition_date: ao.schedule_of_condition_date,
            scheduleOfConditionDate: ao.schedule_of_condition_date,
            schedule_of_conditions_date: ao.schedule_of_condition_date,
            scheduleOfConditionsDate: ao.schedule_of_condition_date,
            soc_status: ao.soc_status,
            soc_required: ao.soc_required,
            soc_task_id: ao.soc_task_id,
            third_surveyor_phone: ao.third_surveyor_phone,
            security_amount: ao.security_amount,
            section_11_amount: ao.section_11_amount,
            response_deadline: ao.response_deadline,
            responseDeadline: ao.response_deadline,
            sections_served: ao.sections_served,
            intention_date: ao.intention_date,
            intention_noted: ao.intention_noted,
            agreed_surveyor: ao.agreed_surveyor,
            appointed_by_me: ao.appointed_by_me,
            updated_at: ao.last_status_change,
          });
        });

        const enriched = projectRows.map(p => {
          // AOs come from project.aos JSONB — field names from the old app:
          // premise = address, reg_addr = registered address
          // surv_name/firm/email/phone, consent_deadline, notice_served_date, s10_deadline
          const aos = aoMap[p.id] || (Array.isArray(p.aos) ? p.aos : []);

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

        // Sort by ref number so all project dropdowns are in numerical order
        const sorted = [...enriched].sort((a, b) => {
          const na = parseInt((a.ref || '').replace(/\D/g, ''), 10) || 0;
          const nb = parseInt((b.ref || '').replace(/\D/g, ''), 10) || 0;
          return na - nb;
        });
        dispatch({ type: 'SET_PROJECTS', payload: sorted });
        return sorted;
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
