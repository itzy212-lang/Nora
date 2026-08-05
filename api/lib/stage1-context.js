// api/lib/stage1-context.js
//
// Opaque, request-scoped source ID assignment and context-block selection
// for Stage 1, per the context-selection specification produced earlier in
// this design process.
//
// PHASE 1 STATUS: not imported anywhere in api/ely-smart.js, not reachable
// from any production request path.
//
// Source IDs are deterministic and opaque: email_0001, email_0002, ...,
// chat_0001, chat_0002, ..., current_message. They contain no names,
// addresses, or dates. The mapping from opaque id back to raw text
// (sourceIdMap) is intended to live only in memory for the duration of a
// request — this module does not persist it anywhere.

function pad4(n) {
  return String(n).padStart(4, '0');
}

function extractEmailText(email) {
  if (typeof email === 'string') return email;
  if (email && typeof email === 'object') {
    // Accept either a raw body string or a structured email-like object.
    const parts = [];
    if (email.subject) parts.push(`Subject: ${email.subject}`);
    if (email.body) parts.push(email.body);
    else if (email.body_preview) parts.push(email.body_preview);
    return parts.join('\n');
  }
  return '';
}

function extractChatText(message) {
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    const role = message.role ? `${message.role}: ` : '';
    return `${role}${message.content || ''}`;
  }
  return '';
}

/**
 * Assign deterministic, opaque source IDs to a set of emails and chat
 * messages, in the order supplied. Order is the caller's responsibility
 * (e.g. chronological) — this function does not re-sort.
 *
 * @param {{ emails?: Array, chatMessages?: Array }} args
 * @returns {{ sourceIdMap: Record<string,string>, emailIds: string[], chatIds: string[] }}
 */
export function assignSourceIds({ emails = [], chatMessages = [] } = {}) {
  const sourceIdMap = {};
  const emailIds = [];
  const chatIds = [];

  emails.forEach((email, i) => {
    const id = `email_${pad4(i + 1)}`;
    sourceIdMap[id] = extractEmailText(email);
    emailIds.push(id);
  });

  chatMessages.forEach((message, i) => {
    const id = `chat_${pad4(i + 1)}`;
    sourceIdMap[id] = extractChatText(message);
    chatIds.push(id);
  });

  return { sourceIdMap, emailIds, chatIds };
}

function formatProjectFacts(projectBundle) {
  if (!projectBundle || typeof projectBundle !== 'object') return '';
  const p = projectBundle.project || {};
  const lines = [];
  if (p.ref) lines.push(`Project ref: ${p.ref}`);
  if (p.address) lines.push(`Project address: ${p.address}`);
  const bo = p.bo || {};
  if (bo.name) lines.push(`Building Owner: ${bo.name}`);
  const aos = projectBundle.adjoining_owners || [];
  aos.forEach((ao, i) => {
    if (ao?.name) lines.push(`Adjoining Owner ${i + 1}: ${ao.name}`);
  });
  return lines.join('\n');
}

function formatSemanticResults(semanticResults) {
  if (!Array.isArray(semanticResults) || semanticResults.length === 0) return '';
  return semanticResults
    .map((r) => (typeof r === 'string' ? r : r?.content || ''))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Build the ordered context blocks and opaque source-id map Stage 1 should
 * receive, per the priority order established in the context-selection
 * specification: (1) current user message, (2) the selected email/reply
 * target in full, (3) recent chat history, (4) project facts, (5) semantic
 * results (must be genuinely populated, not hardcoded null/empty — the
 * defect identified against the pre-redesign implementation), (6) any
 * additional thread history beyond the immediate reply target.
 *
 * @param {{
 *   userPrompt?: string,
 *   selectedEmail?: object|string|null,
 *   scopedEmailContext?: Array,
 *   chatHistory?: Array,
 *   projectBundle?: object|null,
 *   semanticResults?: Array|null,
 * }} args
 * @returns {{ contextBlocks: Array<{sourceId:string,label:string,text:string}>, sourceIdMap: Record<string,string> }}
 */
export function buildStage1Context({
  userPrompt = '',
  selectedEmail = null,
  scopedEmailContext = [],
  chatHistory = [],
  projectBundle = null,
  semanticResults = null,
} = {}) {
  const emails = [];
  if (selectedEmail) emails.push(selectedEmail);
  (scopedEmailContext || []).forEach((e) => {
    if (e !== selectedEmail) emails.push(e);
  });

  const { sourceIdMap, emailIds, chatIds } = assignSourceIds({ emails, chatMessages: chatHistory });
  sourceIdMap.current_message = userPrompt;

  const contextBlocks = [];
  contextBlocks.push({ sourceId: 'current_message', label: 'USER DICTATION', text: userPrompt });

  emailIds.forEach((id, i) => {
    contextBlocks.push({
      sourceId: id,
      label: i === 0 && selectedEmail ? 'SELECTED EMAIL / REPLY TARGET' : 'EMAIL',
      text: sourceIdMap[id],
    });
  });

  chatIds.forEach((id) => {
    contextBlocks.push({ sourceId: id, label: 'CHAT HISTORY', text: sourceIdMap[id] });
  });

  const projectFactsText = formatProjectFacts(projectBundle);
  if (projectFactsText) {
    contextBlocks.push({ sourceId: 'project_facts', label: 'PROJECT FACTS', text: projectFactsText });
    sourceIdMap.project_facts = projectFactsText;
  }

  const semanticText = formatSemanticResults(semanticResults);
  if (semanticText) {
    contextBlocks.push({ sourceId: 'semantic_results', label: 'SEMANTICALLY RELEVANT CONTEXT', text: semanticText });
    sourceIdMap.semantic_results = semanticText;
  }

  return { contextBlocks, sourceIdMap };
}
