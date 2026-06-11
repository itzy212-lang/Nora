// src/api/elyRouter.js — the ONLY place in the app that calls the AI backend

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

  const res = await fetch(ROUTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

