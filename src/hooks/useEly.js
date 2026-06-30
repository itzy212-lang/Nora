// src/hooks/useEly.js
// Pulls project, email, and chat context from app state on every Ely call.
// v2 adds persistent AI sessions, project-linked chats, session restore, and project chat history helpers.

import { useState, useCallback, useEffect } from 'react';
import { callEly } from '../api/elyRouter';
import { useApp } from '../state/appStore';
import sb from '../supabaseClient';

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
      phone: first(project.bos_phone, project.bo_surveyor_phone, project.bo_surveyor_phone),
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

function makeTitleFromPrompt(prompt = '') {
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > 54 ? `${clean.slice(0, 54)}...` : clean;
}

function mapDbMessagesToChatHistory(messages = []) {
  return (messages || [])
    .filter(m => m?.role === 'user' || m?.role === 'assistant' || m?.role === 'ely')
    .map(m => ({
      role: m.role === 'ely' ? 'assistant' : m.role,
      content: String(m.content || ''),
    }));
}

function mapDbMessagesToUiMessages(messages = []) {
  return (messages || [])
    .filter(m => m?.role === 'user' || m?.role === 'assistant' || m?.role === 'ely')
    .map(m => ({
      id: m.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: m.role === 'assistant' ? 'ely' : m.role,
      content: String(m.content || ''),
      created_at: m.created_at || null,
      // Restores draft/brief classification on reload — without this, every
      // draft's action row (Copy/Compose/Attach Quote) silently disappeared
      // whenever a session reloaded, because messageType was never persisted.
      ...(m.message_type ? { messageType: m.message_type } : {}),
      // draft field is what ChatMessage.jsx actually checks for the draft body —
      // restore it from content when messageType is 'draft' so reload behaves
      // identically to a freshly-generated draft message.
      ...(m.message_type === 'draft' ? { draft: String(m.content || '') } : {}),
    }));
}

async function createAiSession({ userId, projectId, surface, mode = 'discuss', title = 'New chat', sessionType = 'chat' }) {
  if (!sb) return null;

  const { data, error } = await sb
    .from('ai_sessions')
    .insert([{
      user_id: userId || 'itzy212@gmail.com',
      project_id: projectId || null,
      title,
      auto_title: title,
      surface: projectId ? 'project_chat' : surface,
      linked_from_surface: projectId ? surface : null,
      mode,
      session_type: projectId ? 'project_chat' : sessionType,
      context_scope: projectId ? 'project' : 'global',
      last_message_at: new Date().toISOString(),
      metadata: {
        created_from: surface,
        created_by_hook: 'useEly_v2',
      },
    }])
    .select('*')
    .single();

  if (error) {
    console.warn('[useEly] createAiSession failed:', error.message);
    return null;
  }

  return data || null;
}

async function saveAiMessage({ sessionId, userId, projectId, surface, role, content, model, messageType }) {
  if (!sb || !sessionId || !content) return null;

  const dbRole = role === 'ely' ? 'assistant' : role;

  const { data, error } = await sb
    .from('ai_messages')
    .insert([{
      session_id: sessionId,
      role: dbRole,
      content: String(content || ''),
      user_id: userId || 'itzy212@gmail.com',
      project_id: projectId || null,
      surface: projectId ? 'project_chat' : surface,
      source_type: 'chat',
      ...(model ? { model } : {}),
      ...(messageType ? { message_type: messageType } : {}),
    }])
    .select('id, role, content, created_at, message_type')
    .single();

  if (error) {
    console.warn('[useEly] saveAiMessage failed:', error.message);
    return null;
  }

  await sb
    .from('ai_sessions')
    .update({
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return data || null;
}

export function useEly({ surface = 'main_chat', projectId = null } = {}) {
  const { state } = useApp();

  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [projectSessions, setProjectSessions] = useState([]);
  const [globalSessions, setGlobalSessions] = useState([]);
  const [error, setError] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);

  const userId =
    state.currentUser?.id ||
    state.currentUser?.email ||
    'itzy212@gmail.com';

  const resolveCurrentProject = useCallback((explicitProjectId = null) => {
    const projects = state.projects || [];
    const currentProject = state.currentProject || state.selectedProject || null;
    const targetId = explicitProjectId || projectId || currentProject?.id || null;

    if (targetId) {
      const fromList = projects.find(p => String(p.id) === String(targetId));
      if (fromList) return fromList;
      if (String(currentProject?.id) === String(targetId)) return currentProject;
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
          aos: np.aos.map(ao => ({
            name: ao.name,
            name2: ao.name2,
            premise: ao.premise,
            status: ao.status,
            surveyor: ao.surveyor,
          })),
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

    return emails
      .slice(0, 8)
      .map(e => ({
        id: e.id || e.external_id || '',
        project_id: e.project_id || '',
        from: first(e.from_email, e.sender_email, e.from),
        from_name: first(e.from, e.sender_name),
        subject: e.subject || '',
        date: e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB') : '',
        preview: first(e.body_preview, e.preview),
      }));
  }, [state.emails]);

  const refreshProjectSessions = useCallback(async (explicitProjectId = null) => {
    const targetProjectId =
      explicitProjectId ||
      projectId ||
      state.currentProject?.id ||
      state.selectedProject?.id ||
      null;

    if (!sb || !targetProjectId) {
      setProjectSessions([]);
      return [];
    }

    setSessionsLoading(true);

    try {
      const { data, error: rpcError } = await sb.rpc('get_project_ai_sessions', {
        p_project_id: String(targetProjectId),
        p_user_id: userId,
        p_limit: 50,
      });

      if (rpcError) throw rpcError;

      const sessions = Array.isArray(data) ? data : [];
      setProjectSessions(sessions);
      return sessions;
    } catch (err) {
      console.warn('[useEly] refreshProjectSessions failed:', err.message);
      setProjectSessions([]);
      return [];
    } finally {
      setSessionsLoading(false);
    }
  }, [projectId, state.currentProject?.id, state.selectedProject?.id, userId]);

  const refreshGlobalSessions = useCallback(async () => {
    if (!sb) {
      setGlobalSessions([]);
      return [];
    }

    setSessionsLoading(true);

    try {
      const { data, error: queryError } = await sb
        .from('ai_sessions')
        .select('id,title,auto_title,surface,mode,session_type,summary,is_pinned,is_archived,last_message_at,created_at,updated_at,project_id')
        .is('project_id', null)
        .eq('is_archived', false)
        .eq('user_id', userId)
        .order('is_pinned', { ascending: false })
        .order('last_message_at', { ascending: false })
        .limit(50);

      if (queryError) throw queryError;

      const sessions = data || [];
      setGlobalSessions(sessions);
      return sessions;
    } catch (err) {
      console.warn('[useEly] refreshGlobalSessions failed:', err.message);
      setGlobalSessions([]);
      return [];
    } finally {
      setSessionsLoading(false);
    }
  }, [userId]);

  const loadSession = useCallback(async (targetSessionId) => {
    if (!sb || !targetSessionId) return null;

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await sb.rpc('get_ai_session_bundle', {
        p_session_id: targetSessionId,
      });

      if (rpcError) throw rpcError;

      const messages = data?.messages || [];

      setSessionId(targetSessionId);
      setChatHistory(mapDbMessagesToChatHistory(messages));

      return {
        session: data?.session || {},
        messages: mapDbMessagesToUiMessages(messages),
        uploads: data?.uploads || [],
        projectMemory: data?.project_memory || [],
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const linkSessionToProject = useCallback(async ({
    targetSessionId = null,
    targetProjectId = null,
    title = null,
  } = {}) => {
    if (!sb) return null;

    const actualSessionId = targetSessionId || sessionId;
    const actualProjectId =
      targetProjectId ||
      projectId ||
      state.currentProject?.id ||
      state.selectedProject?.id ||
      null;

    if (!actualSessionId || !actualProjectId) {
      throw new Error('Missing chat session or project to link.');
    }

    const { data, error: rpcError } = await sb.rpc('link_ai_session_to_project', {
      p_session_id: actualSessionId,
      p_project_id: String(actualProjectId),
      p_user_id: userId,
      p_title: title,
    });

    if (rpcError) throw rpcError;

    await refreshProjectSessions(actualProjectId);
    await refreshGlobalSessions();

    return data;
  }, [
    sessionId,
    projectId,
    state.currentProject?.id,
    state.selectedProject?.id,
    userId,
    refreshProjectSessions,
    refreshGlobalSessions,
  ]);

  const ensureSession = useCallback(async ({
    prompt,
    effectiveProjectId = null,
    mode = 'discuss',
    sessionType = 'chat',
  } = {}) => {
    if (sessionId) return sessionId;

    const title = makeTitleFromPrompt(prompt);
    const created = await createAiSession({
      userId,
      projectId: effectiveProjectId || null,
      surface,
      mode,
      title,
      sessionType,
    });

    if (created?.id) {
      setSessionId(created.id);
      return created.id;
    }

    return null;
  }, [sessionId, userId, surface]);

  const send = useCallback(async (prompt, extraOpts = {}) => {
    setLoading(true);
    setError(null);

    const effectiveProjectId =
      extraOpts.projectId ||
      projectId ||
      state.currentProject?.id ||
      state.selectedProject?.id ||
      null;

    const modeHint =
      extraOpts.mode ||
      (extraOpts.mainChatWorkflow === 'draft_clean_bubble_only' ? 'draft' : 'discuss');

    try {
      const actualSessionId = await ensureSession({
        prompt,
        effectiveProjectId,
        mode: modeHint,
        sessionType: extraOpts.sessionType || 'chat',
      });

      const userMsg = { role: 'user', content: prompt };
      const currentHistory = [...chatHistory, userMsg];
      const currentProject = buildCurrentProject(effectiveProjectId);
      const projectsContext = buildProjectsContext();
      const recentEmails = buildRecentEmails();
      if (actualSessionId) {
        await saveAiMessage({
          sessionId: actualSessionId,
          userId,
          projectId: effectiveProjectId,
          surface,
          role: 'user',
          content: prompt,
        });
      }

      const result = await callEly({
        prompt,
        message: prompt,
        surface,
        sessionId: actualSessionId,
        projectId: effectiveProjectId,
        userId,
        emailContext: extraOpts.emailContext || null,
        emailId: extraOpts.emailId || null,
        threadId: extraOpts.threadId || null,
        uploadIds: extraOpts.uploadIds || [],
        documentContext: extraOpts.documentContext || null,
        awardContext: extraOpts.awardContext || null,

        context: {
          currentProject,
          projectsContext,
          recentEmails,
          currentView: state.currentView || null,
          activeProjectId: effectiveProjectId,
          sessionId: actualSessionId,
          mainChatWorkflow: extraOpts.mainChatWorkflow || null,
          ...(extraOpts.context || {}),
        },

        chatHistory: (() => {
          // For project chat use more history — notes pasted earlier must stay in context
          const isProjectChat = extraOpts.surface === 'project_chat' || surface === 'project_chat';
          const limit = isProjectChat ? 40 : 16;
          const history = currentHistory.slice(-limit);

          // Always include long user notes regardless of position — these are pasted project notes
          const longUserNotes = currentHistory.filter(m =>
            m.role === 'user' && m.content && m.content.length > 500 &&
            !history.includes(m)
          ).slice(-5); // up to 5 earlier long notes

          const combined = [...longUserNotes, ...history];

          // Find the index of the last assistant message with a substantial draft
          let lastDraftIdx = -1;
          combined.forEach((msg, i) => {
            if (msg.role === 'assistant' && msg.content && msg.content.length > 300) {
              lastDraftIdx = i;
            }
          });
          return combined.map((msg, i) => {
            // Keep the most recent draft in full so Ely knows exactly what's on screen
            if (msg.role === 'assistant' && msg.content && msg.content.length > 300) {
              if (i === lastDraftIdx) return msg; // keep latest draft intact
              return { ...msg, content: '[earlier draft — superseded]' }; // strip older ones
            }
            return msg;
          });
        })(),
        projectsContext,
        currentProject,
        recentEmails,

        ...extraOpts,
      });

      const assistantText =
        result.reply ||
        result.replyText ||
        result.documentText ||
        result.draft ||
        '';

      if (actualSessionId && assistantText) {
        await saveAiMessage({
          sessionId: actualSessionId,
          userId,
          projectId: effectiveProjectId,
          surface,
          role: 'assistant',
          content: assistantText,
          model: result.model || null,
        });
      }

      if (actualSessionId && !sessionId) {
        setSessionId(actualSessionId);
      }

      setChatHistory(prev => [
        ...prev,
        userMsg,
        { role: 'assistant', content: result.reply || result.replyText || assistantText || '' },
      ].slice(-30));

      if (effectiveProjectId) {
        refreshProjectSessions(effectiveProjectId);
      } else {
        refreshGlobalSessions();
      }

      return {
        ...result,
        sessionId: actualSessionId || result.sessionId || null,
        reply: result.reply || result.replyText || '',
        draft: result.draft || result.documentText || null,
        draftType: result.draftType || result.action || null,
        recipient: result.recipient || null,
        selectedAO: result.selectedAO || null,
        recipientSuggestions: result.recipientSuggestions || [],
        projectId: effectiveProjectId,
        currentProject,
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [
    surface,
    sessionId,
    projectId,
    state.currentUser,
    state.currentProject,
    state.selectedProject,
    state.currentView,
    chatHistory,
    userId,
    buildProjectsContext,
    buildCurrentProject,
    buildRecentEmails,
    ensureSession,
    refreshProjectSessions,
    refreshGlobalSessions,
  ]);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setChatHistory([]);
  }, []);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    setChatHistory([]);
  }, []);

  useEffect(() => {
    if (projectId || state.currentProject?.id || state.selectedProject?.id) {
      refreshProjectSessions(projectId || state.currentProject?.id || state.selectedProject?.id);
    } else {
      refreshGlobalSessions();
    }
  }, [
    projectId,
    state.currentProject?.id,
    state.selectedProject?.id,
    refreshProjectSessions,
    refreshGlobalSessions,
  ]);

  // Exposed so callers (e.g. MainChat) that split one AI reply into multiple
  // UI messages (brief / draft / after) client-side can persist each one with
  // its correct messageType — the auto-save inside send() happens before that
  // split occurs and can't know the classification yet.
  // Accepts an optional sessionId override — the hook's own `sessionId` state
  // can lag behind the actual session ID returned by send() due to React's
  // async state updates, which intermittently caused this to silently return
  // null right after a fresh send and lose the message's draft classification.
  // Callers that just received a send() result should pass result.sessionId
  // directly rather than relying on this hook's state.
  const saveMessage = useCallback(({ role, content, messageType, model, sessionId: sessionIdOverride } = {}) => {
    const actualSessionId = sessionIdOverride || sessionId;
    if (!actualSessionId) return null;
    return saveAiMessage({
      sessionId: actualSessionId,
      userId,
      projectId: projectId || state.currentProject?.id || state.selectedProject?.id || null,
      surface,
      role,
      content,
      messageType,
      model,
    });
  }, [sessionId, userId, projectId, state.currentProject?.id, state.selectedProject?.id, surface]);

  return {
    send,
    loading,
    sessionsLoading,
    error,
    sessionId,
    resetSession,
    startNewSession,
    loadSession,
    linkSessionToProject,
    refreshProjectSessions,
    refreshGlobalSessions,
    projectSessions,
    globalSessions,
    chatHistory,
    saveMessage,
  };
}


