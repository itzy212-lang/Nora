// src/hooks/useEly.js
// Pulls project, email, and chat context from app state on every Ely call.

import { useState, useCallback } from 'react';
import { callEly } from '../api/elyRouter';
import { useApp } from '../state/appStore';

function first(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '') || '';
}

function normaliseAO(ao = {}, index = 0) {
  return {
    id: ao.id || ao.ao_id || null,
    num: ao.num || index + 1,
    name: first(ao.name, ao.ao_name, ao.owner_name, ao.ao_1_name),
    name2: first(ao.name2, ao.ao_name_2, ao.owner_name_2, ao.ao_2_name),
    email: first(ao.email, ao.ao_email, ao.owner_email, ao.ao_1_email),
    email2: first(ao.email2, ao.ao_email_2, ao.owner_email_2, ao.ao_2_email),
    phone: first(ao.phone, ao.ao_phone, ao.owner_phone, ao.ao_1_phone),
    phone2: first(ao.phone2, ao.ao_phone_2, ao.owner_phone_2, ao.ao_2_phone),
    premise: first(ao.premise, ao.reg_addr, ao.address, ao.ao_premise_address),
    service_address: first(ao.service_address, ao.serviceAddress, ao.ao_service_address, ao.reg_addr, ao.premise, ao.address),
    status: ao.status || '',
    agreed_surveyor: !!ao.agreed_surveyor,
    notice_served_date: first(ao.notice_served_date, ao.noticeServedDate, ao.ao_notice_served_date),
    consent_deadline: first(ao.consent_deadline, ao.consentDeadline, ao.ao_consent_deadline),
    s10_deadline: first(ao.s10_deadline, ao.s10Deadline, ao.ao_s10_deadline),
    surveyor: {
      name: first(ao.surv_name, ao.surveyorName, ao.surveyor_name),
      firm: first(ao.surv_firm, ao.surveyorFirm, ao.surveyor_firm),
      email: first(ao.surv_email, ao.surveyorEmail, ao.surveyor_email),
      phone: first(ao.surv_phone, ao.surveyorPhone, ao.surveyor_phone),
    },
    third_surveyor: {
      name: first(ao.third_surveyor_name, ao.ts_name),
      firm: first(ao.third_surveyor_firm, ao.ts_firm),
      email: first(ao.third_surveyor_email, ao.ts_email),
      phone: first(ao.third_surveyor_phone, ao.ts_phone),
    },
  };
}

function normaliseProject(project = {}) {
  const aos = Array.isArray(project.aos) ? project.aos : [];
  return {
    id: project.id || null,
    ref: first(project.ref, project.reference, project.project_ref),
    status: project.status || 'active',
    role: first(project.role, project.surveyor_role, 'BO'),
    address: first(project.address, project.bo_premise_address, project.premise),
    bo_premise_address: first(project.bo_premise_address, project.address, project.premise),
    bo_service_address: first(project.bo_service_address, project.bo_1_service_address, project.bo_address, project.bo_premise_address, project.address),
    building_owner: {
      name: first(project.bo_1_name, project.bo, project.bo_name, project.building_owner),
      name2: first(project.bo_2_name, project.bo2, project.bo_name_2),
      email: first(project.bo_1_email, project.bo_email, project.boEmail),
      email2: first(project.bo_2_email, project.bo2_email),
      phone: first(project.bo_1_phone, project.bo_phone, project.boPhone),
      phone2: first(project.bo_2_phone, project.bo2_phone),
    },
    bo_surveyor: {
      name: first(project.bos_name, project.bo_surveyor_name, project.building_owner_surveyor_name),
      firm: first(project.bos_firm, project.bo_surveyor_firm, project.building_owner_surveyor_firm),
      email: first(project.bos_email, project.bo_surveyor_email, project.building_owner_surveyor_email),
      phone: first(project.bos_phone, project.bo_surveyor_phone, project.building_owner_surveyor_phone),
    },
    works: first(project.works, project.works_description, project.description),
    fee: project.fee || '',
    aos: aos.map(normaliseAO),
    aoCount: aos.length,
    documents: project.documents || [],
    notices: project.notices || [],
    awards: project.awards || project.awards_list || [],
  };
}

export function useEly({ surface = 'main_chat', projectId = null } = {}) {
  const { state } = useApp();
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);

  const resolveCurrentProject = useCallback((explicitProjectId = null) => {
    const projects = state.projects || [];
    const currentProject = state.currentProject || state.selectedProject || null;
    const targetId = explicitProjectId || projectId || currentProject?.id || null;
    if (targetId) {
      const fromList = projects.find(p => p.id === targetId);
      if (fromList) return fromList;
      if (currentProject?.id === targetId) return currentProject;
    }
    if (currentProject?.id) return currentProject;
    return null;
  }, [state.projects, state.currentProject, state.selectedProject, projectId]);

  const buildProjectsContext = useCallback(() => {
    const projects = state.projects || [];
    return projects
      .filter(p => p.status !== 'complete' && p.status !== 'archived')
      .slice(0, 20)
      .map(p => {
        const np = normaliseProject(p);
        return {
          id: np.id,
          ref: np.ref,
          address: np.address,
          status: np.status,
          role: np.role,
          boName: np.building_owner.name,
          boName2: np.building_owner.name2,
          boEmail: np.building_owner.email,
          boEmail2: np.building_owner.email2,
          works: np.works,
          aoCount: np.aoCount,
          aos: np.aos.map(ao => ({ name: ao.name, name2: ao.name2, premise: ao.premise, status: ao.status, surveyor: ao.surveyor })),
        };
      });
  }, [state.projects]);

  const buildCurrentProject = useCallback((explicitProjectId = null) => {
    const project = resolveCurrentProject(explicitProjectId);
    if (!project) return null;
    return normaliseProject(project);
  }, [resolveCurrentProject]);

  const buildRecentEmails = useCallback(() => {
    const emails = state.emails || [];
    return emails.slice(0, 8).map(e => ({
      id: e.id || e.external_id || '',
      project_id: e.project_id || '',
      from: first(e.from_email, e.sender_email, e.from),
      from_name: first(e.from, e.sender_name),
      subject: e.subject || '',
      date: e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB') : '',
      preview: first(e.body_preview, e.preview),
    }));
  }, [state.emails]);

  const send = useCallback(async (prompt, extraOpts = {}) => {
    setLoading(true);
    setError(null);
    const effectiveProjectId = extraOpts.projectId || projectId || state.currentProject?.id || state.selectedProject?.id || null;
    const userMsg = { role: 'user', content: prompt };
    const currentHistory = [...chatHistory, userMsg];
    const currentProject = buildCurrentProject(effectiveProjectId);
    const projectsContext = buildProjectsContext();
    const recentEmails = buildRecentEmails();

    try {
      const result = await callEly({
        prompt,
        message: prompt,
        surface,
        sessionId,
        projectId: effectiveProjectId,
        userId: state.currentUser?.id || state.currentUser?.email || null,
        emailContext: extraOpts.emailContext || null,
        emailId: extraOpts.emailId || null,
        threadId: extraOpts.threadId || null,
        context: {
          currentProject,
          projectsContext,
          recentEmails,
          currentView: state.currentView || null,
          activeProjectId: effectiveProjectId,
          ...(extraOpts.context || {}),
        },
        chatHistory: currentHistory.slice(-16),
        projectsContext,
        currentProject,
        recentEmails,
        ...extraOpts,
      });
      if (result.sessionId) setSessionId(result.sessionId);
      setChatHistory(prev => [...prev, userMsg, { role: 'ely', content: result.reply || result.replyText || '' }].slice(-30));
      return {
        ...result,
        reply: result.reply || result.replyText || '',
        draft: result.draft || result.documentText || null,
        draftType: result.draftType || result.action || null,
        recipient: result.recipient || null,
        selectedAO: result.selectedAO || null,
        recipientSuggestions: result.recipientSuggestions || [],
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [surface, sessionId, projectId, state.currentUser, state.currentProject, state.selectedProject, state.currentView, chatHistory, buildProjectsContext, buildCurrentProject, buildRecentEmails]);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setChatHistory([]);
  }, []);

  return { send, loading, error, sessionId, resetSession };
}
