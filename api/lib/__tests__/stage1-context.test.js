import { describe, it, expect } from 'vitest';
import { assignSourceIds, buildStage1Context } from '../stage1-context.js';

describe('stage1-context: opaque source IDs', () => {
  it('assigns deterministic, zero-padded IDs in supplied order', () => {
    const { sourceIdMap, emailIds, chatIds } = assignSourceIds({
      emails: ['first email body', 'second email body'],
      chatMessages: [{ role: 'user', content: 'hello' }],
    });
    expect(emailIds).toEqual(['email_0001', 'email_0002']);
    expect(chatIds).toEqual(['chat_0001']);
    expect(sourceIdMap.email_0001).toBe('first email body');
    expect(sourceIdMap.email_0002).toBe('second email body');
    expect(sourceIdMap.chat_0001).toBe('user: hello');
  });

  it('produces IDs containing no names, addresses or dates from the content itself', () => {
    const { emailIds } = assignSourceIds({
      emails: [{ subject: 'Re: 8 Village Close', body: 'From Robin Nicole Zaragoza, dated 19 June 2026' }],
    });
    expect(emailIds[0]).toBe('email_0001');
    expect(emailIds[0]).not.toMatch(/robin|zaragoza|village|2026/i);
  });

  it('handles structured email objects (subject + body)', () => {
    const { sourceIdMap } = assignSourceIds({ emails: [{ subject: 'Subject line', body: 'Body text' }] });
    expect(sourceIdMap.email_0001).toContain('Subject line');
    expect(sourceIdMap.email_0001).toContain('Body text');
  });

  it('returns empty arrays/maps for empty input', () => {
    const { sourceIdMap, emailIds, chatIds } = assignSourceIds({});
    expect(sourceIdMap).toEqual({});
    expect(emailIds).toEqual([]);
    expect(chatIds).toEqual([]);
  });
});

describe('stage1-context: buildStage1Context (context selection)', () => {
  it('always includes the current user message as current_message', () => {
    const { contextBlocks, sourceIdMap } = buildStage1Context({ userPrompt: 'draft a reply' });
    expect(sourceIdMap.current_message).toBe('draft a reply');
    expect(contextBlocks[0]).toMatchObject({ sourceId: 'current_message', label: 'USER DICTATION' });
  });

  it('includes the selected email in full and labels it as the reply target', () => {
    const { contextBlocks } = buildStage1Context({
      userPrompt: 'reply to this',
      selectedEmail: 'the full email body',
    });
    const emailBlock = contextBlocks.find((b) => b.sourceId === 'email_0001');
    expect(emailBlock.label).toBe('SELECTED EMAIL / REPLY TARGET');
    expect(emailBlock.text).toBe('the full email body');
  });

  it('does not duplicate the selected email if it also appears in scopedEmailContext', () => {
    const email = 'same email object';
    const { contextBlocks } = buildStage1Context({
      selectedEmail: email,
      scopedEmailContext: [email, 'a different email'],
    });
    const emailBlocks = contextBlocks.filter((b) => b.sourceId.startsWith('email_'));
    expect(emailBlocks).toHaveLength(2);
  });

  it('includes project facts as a distinct block when a projectBundle is supplied', () => {
    const { contextBlocks } = buildStage1Context({
      projectBundle: { project: { ref: 'ELY-2026-006', address: '8 Village Close' } },
    });
    const block = contextBlocks.find((b) => b.sourceId === 'project_facts');
    expect(block).toBeDefined();
    expect(block.text).toContain('ELY-2026-006');
  });

  it('includes semantic results when genuinely populated (the pre-redesign defect being fixed)', () => {
    const { contextBlocks } = buildStage1Context({
      semanticResults: [{ content: 'a relevant prior note' }, 'a plain string result'],
    });
    const block = contextBlocks.find((b) => b.sourceId === 'semantic_results');
    expect(block).toBeDefined();
    expect(block.text).toContain('a relevant prior note');
    expect(block.text).toContain('a plain string result');
  });

  it('omits the semantic-results block entirely when none are supplied, rather than injecting an empty section', () => {
    const { contextBlocks } = buildStage1Context({ userPrompt: 'x' });
    expect(contextBlocks.find((b) => b.sourceId === 'semantic_results')).toBeUndefined();
  });

  it('includes chat history blocks after email blocks', () => {
    const { contextBlocks } = buildStage1Context({
      selectedEmail: 'email text',
      chatHistory: [{ role: 'user', content: 'earlier turn' }],
    });
    const emailIdx = contextBlocks.findIndex((b) => b.sourceId === 'email_0001');
    const chatIdx = contextBlocks.findIndex((b) => b.sourceId === 'chat_0001');
    expect(emailIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(emailIdx);
  });
});
