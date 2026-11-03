import { describe, it, expect } from 'vitest';
import { computeAssistantMessagesFromResult, looksLikeEmailDraft } from '../projectChatMessageLogic.js';

const EMAIL = 'Hi,\n\nI am currently waiting for availability from the two appointed surveyors for next week.\n\nCould you please speak with the occupiers?\n\nKind regards,\nItzik';

describe('follow-up draft returned as plain chat text', () => {
  it('detects a sendable email', () => {
    expect(looksLikeEmailDraft(EMAIL)).toBe(true);
    expect(looksLikeEmailDraft('Sure, I can do that. What tone would you like?')).toBe(false);
  });
  it.each([false, true])('is shown as a draft with buttons (wantsDraft=%s)', (w) => {
    const { newMessages, updatedLastDraft } = computeAssistantMessagesFromResult({ reply: EMAIL, mode: 'general' }, w, 'p');
    const d = newMessages.find(m => m.messageType === 'draft');
    expect(d).toBeTruthy();
    expect(d.draft).toContain('waiting for availability');
    expect(updatedLastDraft).toContain('waiting for availability');
  });
  it('keeps an intro line as a separate note', () => {
    const { newMessages } = computeAssistantMessagesFromResult({ reply: 'Here you go:\n\n' + EMAIL }, false, 'p');
    expect(newMessages.some(m => m.messageType === 'draft')).toBe(true);
  });
  it('does not throw when only replyText is returned', () => {
    const { newMessages } = computeAssistantMessagesFromResult({ replyText: EMAIL, mode: 'draft' }, true, 'p');
    expect(newMessages.some(m => m.messageType === 'draft')).toBe(true);
  });
  it('leaves ordinary chat alone', () => {
    const { newMessages } = computeAssistantMessagesFromResult({ reply: 'The notice was served on 3 Nov.' }, false, 'p');
    expect(newMessages.every(m => m.messageType !== 'draft')).toBe(true);
  });
});
