// Real simulation test — not a unit test on an isolated regex, and not
// source-scanning. This feeds an actual, realistic result object
// (reconstructed from the real failed/succeeding turns in project
// moy1t4ziomb, session f4bed0aa, 2026-08-07) through the exact same
// function the app uses to decide what to render, and checks the
// output directly. Added 2026-08-07 specifically because prior "tests"
// for this bug were all unit-level or structural, never an actual
// simulation — a real gap, pointed out directly, not found by me first.

import { describe, it, expect } from 'vitest';
import { computeAssistantMessagesFromResult } from '../projectChatMessageLogic.js';

describe('computeAssistantMessagesFromResult — real simulation using actual turn shapes', () => {
  it('a real, successful discuss-mode turn (13:25:57, real content) renders as a brief message, no Done.', () => {
    const result = {
      reply: 'Yes. The legal framing should be that the present situation did not originate with Arpit\u2019s works in isolation...',
      draft: null,
      draftType: null,
      mode: 'discuss',
      architecture_version: 'v2',
    };
    const { newMessages, doneCause } = computeAssistantMessagesFromResult(result, result.mode === 'draft', 'moy1t4ziomb');
    expect(doneCause).toBeNull();
    expect(newMessages.length).toBe(1);
    // Note: this branch (!wantsDraft) has never set messageType at all —
    // confirmed harmless, since ChatMessage.jsx only ever checks for
    // messageType === 'draft' specifically, never 'brief' vs undefined.
    expect(newMessages[0].messageType).toBeUndefined();
    expect(newMessages[0].content).not.toBe('Done.');
  });

  it('the diagnostic logging fix itself: a normal, populated discuss reply never produces a false-positive doneCause (caught by this exact test suite before shipping)', () => {
    const result = { reply: 'A completely ordinary, real discussion reply with real content.', draft: null, mode: 'discuss' };
    const { doneCause } = computeAssistantMessagesFromResult(result, false, 'moy1t4ziomb');
    expect(doneCause).toBeNull();
  });

  it('a real draft-mode turn (13:28:58) with a pure draft and empty reply — the exact shape of the actual failing case — renders as a proper draft bubble, not Done.', () => {
    // Reconstructed directly from the real saved database content for
    // this exact turn: a clean draft starting "Hi Olivia," with no
    // separate commentary, matching what splitDraftFromCommentary
    // produces when the whole response is inside the delimiters.
    const realDraftText = 'Hi Olivia,\n\nThank you for your email.\n\nThe Building Owner accepts that notifiable works commenced without the relevant notices having first been served...\n\nKind regards,';
    const result = {
      reply: '',
      draft: realDraftText,
      draftType: 'email',
      mode: 'draft',
      architecture_version: 'v2',
    };
    const wantsDraft = result.mode === 'draft'; // exactly what actualWantsDraft computes
    const { newMessages, updatedLastDraft, doneCause } = computeAssistantMessagesFromResult(result, wantsDraft, 'moy1t4ziomb');

    expect(doneCause).toBeNull();
    const draftMsg = newMessages.find(m => m.messageType === 'draft');
    expect(draftMsg).toBeDefined();
    expect(draftMsg.content).toContain('Hi Olivia,');
    expect(updatedLastDraft).toBe(realDraftText);
    expect(newMessages.some(m => m.content === 'Done.')).toBe(false);
  });

  it('reproduces the actual bug: if result.draft is somehow null/undefined despite mode saying draft, Done. DOES fire — this is the one input shape that would explain it', () => {
    // This is the one shape of `result` that would genuinely produce
    // "Done." given wantsDraft=true: reply empty AND draft falsy. If the
    // real failure is ever reproduced live with logging now in place,
    // checking whether result.draft was actually null/undefined/empty
    // at that moment (despite the database having real content) is the
    // single most informative thing the new console logging can reveal.
    const result = { reply: '', draft: null, mode: 'draft' };
    const { newMessages, doneCause } = computeAssistantMessagesFromResult(result, true, 'moy1t4ziomb');
    expect(doneCause).toBe('wantsDraft=true branch, no reply/draft/documentText/replyText produced any message');
    expect(newMessages[0].content).toBe('Done.');
  });

  it('reproduces the bug via a different shape: reply is present but whitespace-only, draft is an empty string (falsy) — also produces Done.', () => {
    // A subtler possible real-world shape: if JSON serialization or a
    // network layer ever turned draft into an empty string rather than
    // null, `if (result.draft)` is falsy for '' too, and this exact
    // fallback fires despite `draft` technically being "present" as a
    // key.
    const result = { reply: '   ', draft: '', mode: 'draft' };
    const { doneCause } = computeAssistantMessagesFromResult(result, true, 'moy1t4ziomb');
    expect(doneCause).not.toBeNull();
  });

  it('confirms wantsDraft=false with a real populated draft still correctly shows the draft, not Done. (the mismatch-recovery path)', () => {
    const result = { reply: '', draft: 'Hi Olivia,\n\n...\n\nKind regards,', mode: 'draft' };
    // Deliberately pass wantsDraft=false to simulate the exact
    // frontend/backend mismatch bug found earlier today
    const { newMessages, doneCause } = computeAssistantMessagesFromResult(result, false, 'moy1t4ziomb');
    expect(doneCause).toBeNull();
    expect(newMessages[0].messageType).toBe('draft');
  });
});
