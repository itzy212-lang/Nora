// src/hooks/useEly.js
// Automatically pulls project + email context from app state on every send

import { useState, useCallback } from 'react';
import { callEly } from '../api/elyRouter';
import { useApp } from '../state/appStore';

export function useEly({ surface = 'main_chat', projectId = null } = {}) {
  const { state } = useApp();
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);

  // Build project summaries from app state
  const buildProjectsContext = useCallback(() => {
    const projects = state.projects || [];
    return projects
      .filter(p => p.status !== 'complete' && p.status !== 'archived')
      .slice(0, 20)
      .map(p => ({
        ref: p.ref || p.reference || '',
        address: p.address || p.premise || '',
        status: p.status || 'active',
        role: p.role || p.surveyor_role || 'BO',
        boName: p.bo_name || p.building_owner || '',
        aoCount: (p.aos || []).length || p.ao_count || 0,
        nextAction: p.next_action || '',
      }));
  }, [state.projects]);

  // Build current project detail (for project_chat surface)
  const buildCurrentProject = useCallback(() => {
    if (surface !== 'project_chat' || !projectId) return null;
    const projects = state.projects || [];
    const project = projects.find(p => p.id === projectId);
    if (!project) return null;
    return {
      ref: project.ref || project.reference || '',
      address: project.address || project.premise || '',
      status: project.status || 'active',
      role: project.role || project.surveyor_role || 'BO',
      bo_name: project.bo_name || project.building_owner || '',
      bo_email: project.bo_email || '',
      works: project.works || project.works_description || '',
      aos: (project.aos || []).map(ao => ({
        name: ao.name || ao.owner_name || '',
        premise: ao.premise || ao.address || '',
        status: ao.status || '',
        consent_deadline: ao.consent_deadline || ao.consentDeadline || '',
      })),
    };
  }, [surface, projectId, state.projects]);

  // Build recent emails summary
  const buildRecentEmails = useCallback(() => {
    const emails = state.emails || [];
    return emails
      .slice(0, 8)
      .map(e => ({
        from: e.from_email || e.from || '',
        subject: e.subject || '',
        date: e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB') : '',
        preview: e.body_preview || e.preview || '',
      }));
  }, [state.emails]);

  const send = useCallback(async (prompt, extraOpts = {}) => {
    setLoading(true);
    setError(null);

    // Track chat history for context
    const userMsg = { role: 'user', content: prompt };
    const currentHistory = [...chatHistory, userMsg];

    try {
      const result = await callEly({
        prompt,
        surface,
        sessionId,
        projectId: projectId || extraOpts.projectId || null,
        userId: state.currentUser?.id || state.currentUser?.email || null,
        emailContext: extraOpts.emailContext || null,
        emailId: extraOpts.emailId || null,
        threadId: extraOpts.threadId || null,
        // Rich context — auto-built from app state
        chatHistory: currentHistory.slice(-16), // last 8 turns
        projectsContext: buildProjectsContext(),
        currentProject: buildCurrentProject(),
        recentEmails: buildRecentEmails(),
        ...extraOpts,
      });

      if (result.sessionId) setSessionId(result.sessionId);

      // Add both messages to history
      setChatHistory(prev => [
        ...prev,
        userMsg,
        { role: 'ely', content: result.reply },
      ].slice(-30)); // keep last 15 turns

      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [
    surface, sessionId, projectId, state.currentUser,
    chatHistory, buildProjectsContext, buildCurrentProject, buildRecentEmails,
  ]);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setChatHistory([]);
  }, []);

  return { send, loading, error, sessionId, resetSession };
}
