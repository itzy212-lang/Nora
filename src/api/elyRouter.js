// src/api/elyRouter.js — the ONLY place in the app that calls the AI backend

import sb from '../supabaseClient';

const ROUTER_URL = '/api/ely-smart';

export async function callEly({
  prompt,
  surface = 'main_chat',
  sessionId = null,
  projectId = null,
  threadId = null,
  emailId = null,
  emailContext = null,
  userId = null,
  mode = null,
  workflowStage = null,
  chatHistory = [],
  projectsContext = [],
  currentProject = null,
  recentEmails = [],
  context = {},
  ...extra
}) {
  const payload = {
    prompt,
    surface,
    sessionId,
    projectId,
    threadId,
    emailId,
    emailContext,
    userId,
    mode,
    workflowStage,
    chatHistory,
    projectsContext,
    currentProject,
    recentEmails,
    context,
    ...extra,
  };

  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  if (!session?.access_token) {
    throw new Error('Not authenticated — no Supabase session found');
  }

  // Dispute preparation requires guaranteed structured JSON. Keep it out of the
  // general conversational router so a valid analysis cannot be lost to prose,
  // markdown fences or a truncated JSON response.
  const isDisputeSynopsis = !!context?.dispute_case_id && !!context?.dispute_intake;
  const endpoint = isDisputeSynopsis ? '/api/dispute-synopsis' : ROUTER_URL;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const reply = data.reply || data.replyText || '';
  console.log('[Ely] model used:', data.model || 'unknown');
  return {
    reply,
    response: reply,
    content: reply,
    text: reply,
    draft: data.draft || data.documentText || null,
    sessionId: data.sessionId || null,
    action: data.action || 'general_answer',
    draftType: data.draftType || 'general',
    suggestedActions: data.suggestedActions || [],
    mode: data.mode || mode || null,
    workflowStage: data.workflowStage || workflowStage || null,
    instructionSet: data.instructionSet || null,
    model: data.model || null,
  };
}
