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
  // Rich context — passed in by useEly automatically from app state
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

  // Obtain current Supabase session and extract access token.
  // Fail clearly if no authenticated session exists — do not fall back to email.
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  if (!session?.access_token) {
    throw new Error('Not authenticated — no Supabase session found');
  }

  const res = await fetch(ROUTER_URL, {
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
  console.log('[Ely] model used:', data.model || 'unknown');
  return {
    reply: data.reply || data.replyText || '',
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

