// src/components/chat/projectChatMessageLogic.js
//
// Pure message-shaping logic, extracted 2026-08-07 from ProjectChat.jsx
// into its own module with no JSX at all. Two reasons:
// 1. So it can be genuinely simulated in tests with a realistic result
//    object — a real gap identified directly: prior tests for this exact
//    class of bug ('Done.' appearing over a real generated draft) were
//    all unit-level or structural, never an actual end-to-end simulation.
// 2. ProjectChat.jsx has a pre-existing parser incompatibility elsewhere
//    in its JSX (unrelated to this logic) that vite's production build
//    tolerates but vitest's stricter oxc-based transform does not — this
//    module sidesteps that entirely by containing no JSX.
//
// Behaviour-preserving extraction only — identical logic to what was
// previously inline in ProjectChat.jsx, just moved verbatim.

import { uid } from '../../utils/formatters';

function splitAssistantResponse(raw = '') {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!text) return { brief: '', draft: '', after: '' };

  const draftStart = findDraftStart(text);

  if (draftStart === -1) {
    return { brief: cleanBrief(text), draft: '', after: '' };
  }

  const before = text.slice(0, draftStart).trim();
  let draftAndAfter = text.slice(draftStart).trim();
  let after = '';

  const afterPatterns = [
    /\n-{3,}\s*\n\s*(I included[\s\S]*)$/i,
    /\n-{3,}\s*\n\s*(I've included[\s\S]*)$/i,
    /\n-{3,}\s*\n\s*(This draft[\s\S]*)$/i,
    /\n-{3,}\s*\n\s*(Let me know[\s\S]*)$/i,
    /\n\s*(I included the[\s\S]*)$/i,
    /\n\s*(I've included the[\s\S]*)$/i,
    /\n\s*(Let me know if this tone[\s\S]*)$/i,
    /\n\s*(Let me know if this suits[\s\S]*)$/i,
    /\n\s*(Let me know if (you'd like|you would like|this works|there's anything)[\s\S]*)$/i,
    /\n\s*(Please let me know if (you'd like|you would like|there are any|any)[\s\S]*)$/i,
    /\n\s*(Happy to (amend|adjust|revise|tweak|change)[\s\S]*)$/i,
    /\n\s*(I can (amend|adjust|revise|tweak|change|also)[\s\S]*)$/i,
    /\n\s*(Feel free to (adjust|amend|change|let me know)[\s\S]*)$/i,
    /\n\s*(This (keeps|version|draft|should|aims)[\s\S]*)$/i,
    /\n\s*(That should[\s\S]*)$/i,
    /\n\s*(If you (want|need|would like|prefer)[\s\S]*)$/i,
    /\n\s*(Shall I[\s\S]*)$/i,
    /\n\s*(Would you like[\s\S]*)$/i,
    /\n\s*(Do you want[\s\S]*)$/i,
  ];

  for (const rx of afterPatterns) {
    const match = draftAndAfter.match(rx);
    if (match?.[1]) {
      after = cleanBrief(match[1]);
      draftAndAfter = draftAndAfter.replace(rx, '').trim();
      break;
    }
  }

  return {
    brief: cleanBrief(before),
    draft: normaliseProjectDraftText(draftAndAfter),
    after,
  };
}

function extractSubjectFromDraft(draftText = '') {
  // If draft starts with Subject: line, pull it out
  const match = draftText.match(/^Subject:\s*(.+)\n+/i);
  if (match) {
    return {
      subject: match[1].trim(),
      draft: draftText.replace(/^Subject:\s*.+\n+/i, '').trim(),
    };
  }
  return { subject: '', draft: draftText };
}

/**
 * Pure, standalone, exported version of the message-shaping logic
 * previously inlined in a useCallback (extracted 2026-08-07 specifically
 * so it can be genuinely simulated in tests with a realistic result
 * object, not just read and reasoned about — a real gap identified
 * directly, not assumed). Behaviour-preserving extraction: identical
 * logic to what was previously inline, just returning its output
 * instead of calling setMessages/setLastDraft directly.
 *
 * Returns { newMessages, updatedLastDraft, doneCause }. doneCause is
 * null unless the "Done." fallback was reached, in which case it names
 * which of the two fallback branches fired, for logging.
 */
export function computeAssistantMessagesFromResult(result, wantsDraft, projectId) {
  if (result.invoice_generated) return { newMessages: [], updatedLastDraft: undefined, doneCause: null };
  const cleanReply = (s) => String(s || '').replace(/<invoice_data>[\s\S]*?<\/invoice_data>/g, '').trim();

  if (!wantsDraft) {
    if (result.draft) {
      return {
        newMessages: [{
          id: uid(), role: 'ely', content: result.draft, draft: result.draft,
          draftType: result.draftType || 'email', messageType: 'draft',
          suggestedActions: [], projectId, createdAt: new Date().toISOString(),
        }],
        // Fixed 2026-08-08: a real, confirmed gap — this branch displayed
        // the draft correctly but never updated the app's record of the
        // confirmed Working Draft, since updatedLastDraft was left
        // undefined here. That meant a subsequent revision request would
        // be built from a stale, earlier draft, silently making whatever
        // was just shown invisible to the next turn's 'preserve the
        // Working Draft' instruction — a code-level cause of lost
        // content, independent of anything in the Universal Brain.
        updatedLastDraft: result.draft,
        doneCause: null,
      };
    }
    return {
      newMessages: [{
        id: uid(), role: 'ely', content: cleanReply(result.reply || 'Done.'),
        suggestedActions: result.suggestedActions, createdAt: new Date().toISOString(),
      }],
      updatedLastDraft: undefined,
      // Fixed 2026-08-07: caught by a real simulation test, not review —
      // this previously labelled every !wantsDraft-with-no-draft turn as
      // a "Done. fallback reached" cause, even when result.reply was
      // genuinely populated and the actual displayed content was real
      // text, not literally "Done.". Only a real absence of reply
      // content should be flagged.
      doneCause: (result.reply && result.reply.trim()) ? null : '!wantsDraft branch, no result.draft, no result.reply',
    };
  }

  const newMessages = [];
  let updatedLastDraft;

  if (result.reply && result.reply.trim()) {
    newMessages.push({
      id: uid(), role: 'ely', content: cleanReply(result.reply), messageType: 'brief',
      suggestedActions: [], projectId, createdAt: new Date().toISOString(),
    });
  }

  if (result.draft) {
    const { subject, draft } = extractSubjectFromDraft(result.draft);
    if (subject) {
      newMessages.push({
        id: uid(), role: 'ely', content: `Subject: ${subject}`, messageType: 'subject',
        suggestedActions: [], projectId, createdAt: new Date().toISOString(),
      });
    }
    newMessages.push({
      id: uid(), role: 'ely', content: draft || result.draft, draft: draft || result.draft,
      draftType: result.draftType || 'email', messageType: 'draft',
      suggestedActions: [], projectId, createdAt: new Date().toISOString(),
    });
    updatedLastDraft = draft || result.draft;
  } else if (result.documentText || result.replyText) {
    const raw = result.documentText || result.replyText || '';
    const { brief, draft: rawDraft, after } = splitAssistantResponse(raw);
    const { subject, draft } = extractSubjectFromDraft(rawDraft);

    if (brief) newMessages.push({ id: uid(), role: 'ely', content: brief, messageType: 'brief', suggestedActions: [], projectId, createdAt: new Date().toISOString() });
    if (subject) newMessages.push({ id: uid(), role: 'ely', content: `Subject: ${subject}`, messageType: 'subject', suggestedActions: [], projectId, createdAt: new Date().toISOString() });
    if (draft) {
      newMessages.push({ id: uid(), role: 'ely', content: draft, draft, draftType: result.draftType || 'email', messageType: 'draft', suggestedActions: [], projectId, createdAt: new Date().toISOString() });
      updatedLastDraft = draft;
    }
    if (after) newMessages.push({ id: uid(), role: 'ely', content: after, messageType: 'brief', suggestedActions: [], projectId, createdAt: new Date().toISOString() });
  }

  let doneCause = null;
  if (!newMessages.length && result.draft) {
    newMessages.push({
      id: uid(), role: 'ely', content: result.draft, draft: result.draft,
      draftType: result.draftType || 'email', messageType: 'draft',
      suggestedActions: [], projectId, createdAt: new Date().toISOString(),
    });
  }
  if (!newMessages.length) {
    doneCause = 'wantsDraft=true branch, no reply/draft/documentText/replyText produced any message';
    newMessages.push({
      id: uid(), role: 'ely', content: result.reply || 'Done.',
      suggestedActions: result.suggestedActions, createdAt: new Date().toISOString(),
    });
  }

  return { newMessages, updatedLastDraft, doneCause };
}
function isDraftRequest(text = '', hasPreviousDraft = false) {
  const s = String(text || '').toLowerCase();

  // Only force draft mode when there is a clearly explicit drafting instruction.
  // Words like "email", "reply", "respond" appear naturally in discussion messages
  // ("what do you think about this email?", "how should we respond?") and must NOT
  // trigger draft mode. Only trigger on unambiguous drafting commands.
  const explicitDraft =
    /\bdraft\b/i.test(s) ||
    /\bwrite (an?|the|a) (email|letter|reply|response)\b/i.test(s) ||
    /\bwrite to\b/i.test(s) ||
    /\bcompose (an?|the) (email|letter)\b/i.test(s) ||
    /\breply saying\b/i.test(s) ||
    /\brespond saying\b/i.test(s) ||
    /\bcan (you|we) draft\b/i.test(s) ||
    /\blet'?s (draft|write|prepare|compose)\b/i.test(s) ||
    /\bgive me (a |the )?(draft|email)\b/i.test(s) ||
    /\bprepare (a|an) (response|reply|email|letter)\b/i.test(s) ||
    /\bpoint by point\b/i.test(s) ||
    /\bline by line\b/i.test(s) ||
    /\binline response\b/i.test(s);

  if (explicitDraft) return true;

  // If a draft already exists and the user gives an amendment instruction, stay in draft mode
  const editWords = [
    'change', 'amend', 'revise', 'rewrite', 'update',
    'make it', 'add', 'remove', 'replace',
    'shorter', 'firmer', 'softer', 'more formal', 'less formal',
  ];
  if (hasPreviousDraft && editWords.some(word => s.includes(word))) return true;

  return false;
}
export { isDraftRequest };
