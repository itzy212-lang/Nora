// elyRouter.js — the ONLY place in the app that calls the AI backend

const ROUTER_URL = '/api/ely-ai';

export async function callEly({
  prompt,
  surface = 'main_chat',
  mode = 'discuss',
  sessionId = null,
  projectId = null,
  threadId = null,
  emailId = null,
  currentDraft = null,
  emailContext = null,
  instructionSet = 'party_wall_default',
  uploadedDocuments = [],
  userId,
}) {
  const payload = {
    prompt,
    message: prompt,
    surface,
    mode,
    session_id: sessionId,
    project_id: projectId,
    thread_id: threadId,
    email_id: emailId,
    current_draft: currentDraft,
    email_context: emailContext,
    instruction_set: instructionSet,
    uploaded_documents: uploadedDocuments,
    user_id: userId,
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

  return {
    reply: data.replyText || data.reply || '',
    draft: data.documentText || data.draft || null,
    sessionId: data.sessionId || data.session_id || null,
    action: data.action || 'general_answer',
    draftType: data.draftType || 'general',
    projectDetected: data.projectDetected || null,
    suggestedProjectLinks: data.suggestedProjectLinks || [],
    suggestedActions: data.suggestedActions || [],
    recipient: data.recipient || null,
    clarifyingQuestions: data.clarifyingQuestions || [],
    debug: data._debug || {},
  };
}
