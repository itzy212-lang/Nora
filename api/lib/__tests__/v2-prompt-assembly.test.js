import { describe, it, expect } from 'vitest';
import { assembleV2Prompt, buildSurfaceContract, splitDraftFromCommentary, DRAFT_DELIMITER_START, DRAFT_DELIMITER_END } from '../v2-prompt-assembly.js';

describe('assembleV2Prompt — section order', () => {
  it('orders sections: universal brain, representation, voice, gold standard, domain, working memory, surface contract, final validation', () => {
    const { sections } = assembleV2Prompt({
      universalBrain: 'UB',
      effectiveVoice: { text: 'VOICE' },
      goldStandardBlock: { text: 'GS' },
      domainKnowledge: 'DOMAIN',
      workingMemory: { included: [{ category: 'selectedEmail', source_id: 'e1', date: null, content: 'body' }] },
      surface: 'inbox_draft',
      modeHint: 'draft',
      representationLock: 'REP',
    });
    const names = sections.map((s) => s.name);
    expect(names).toEqual([
      'universal_brain',
      'representation_lock',
      'effective_voice',
      'gold_standard_examples',
      'domain_knowledge',
      'dynamic_working_memory',
      'surface_contract',
      'final_validation',
    ]);
  });

  it('the Universal Brain is always first', () => {
    const { sections } = assembleV2Prompt({ universalBrain: 'UB', effectiveVoice: { text: 'V' }, surface: 'main_chat', modeHint: 'discuss' });
    expect(sections[0].name).toBe('universal_brain');
  });

  it('final_validation is always last among non-empty sections', () => {
    const { sections } = assembleV2Prompt({ universalBrain: 'UB', effectiveVoice: { text: 'V' }, surface: 'main_chat', modeHint: 'discuss' });
    expect(sections[sections.length - 1].name).toBe('final_validation');
  });

  it('empty/absent optional sections (representation, gold standard, domain, memory) are omitted, not left as blank placeholders', () => {
    const { prompt, sections } = assembleV2Prompt({
      universalBrain: 'UB',
      effectiveVoice: { text: 'V' },
      surface: 'main_chat',
      modeHint: 'discuss',
    });
    const names = sections.map((s) => s.name);
    expect(names).not.toContain('representation_lock');
    expect(names).not.toContain('gold_standard_examples');
    expect(names).not.toContain('domain_knowledge');
    expect(names).not.toContain('dynamic_working_memory');
    expect(prompt).not.toMatch(/undefined|null/);
  });
});

describe('buildSurfaceContract', () => {
  it('produces the discuss-mode Project Chat contract when surface is project_chat and mode is not draft', () => {
    const contract = buildSurfaceContract('project_chat', 'discuss');
    expect(contract).toMatch(/Project Chat, discuss mode/);
    expect(contract).toMatch(/Do not draft until asked/);
  });

  it('produces the Main Chat contract, including the representation-confusion safeguard', () => {
    const contract = buildSurfaceContract('main_chat', 'discuss');
    expect(contract).toMatch(/Main Chat/);
    expect(contract).toMatch(/Do not confuse the authenticated user with email senders/);
  });

  it('produces the draft contract regardless of surface, when mode is draft', () => {
    const contract = buildSurfaceContract('project_chat', 'draft');
    expect(contract).toMatch(/SURFACE: Draft/);
    expect(contract).toMatch(/kept separate/);
  });

  it('falls back to a generic contract for an unrecognised surface', () => {
    const contract = buildSurfaceContract('unknown_surface', 'discuss');
    expect(contract).toContain('unknown_surface');
  });
});

// ── Draft/commentary split correction (2026-08-06) ──────────────────────
// V2 previously returned one flat string, so commentary and the draft
// always landed in the same message bubble, and the draft never got the
// frontend's draft-only action bar (Open in email composer, etc.) since
// messageType: 'draft' was never set. This is a mechanical, fixed-
// delimiter split — not a judgement about what "counts" as a draft.

describe('splitDraftFromCommentary — mechanical delimiter extraction', () => {
  it('extracts the draft and keeps commentary before and after it separate', () => {
    const raw = `Some analysis first.\n\n${DRAFT_DELIMITER_START}\nHi Kris,\n\nBody text.\n\nKind regards,\n${DRAFT_DELIMITER_END}\n\nPossible additional point: consider X.`;
    const { reply, draft } = splitDraftFromCommentary(raw);
    expect(draft).toContain('Hi Kris,');
    expect(draft).toContain('Kind regards,');
    expect(draft).not.toContain('Possible additional point');
    expect(reply).toContain('Some analysis first.');
    expect(reply).toContain('Possible additional point: consider X.');
    expect(reply).not.toContain('Hi Kris,');
  });

  it('returns draft: null and the full text as reply when no markers are present (discuss mode)', () => {
    const raw = 'Just a discussion response, no draft requested.';
    const { reply, draft } = splitDraftFromCommentary(raw);
    expect(draft).toBeNull();
    expect(reply).toBe(raw);
  });

  it('never fabricates a draft when only one marker is present', () => {
    const raw = `${DRAFT_DELIMITER_START}\nunterminated`;
    const { reply, draft } = splitDraftFromCommentary(raw);
    expect(draft).toBeNull();
    expect(reply).toBe(raw);
  });

  it('handles empty or null input without throwing', () => {
    expect(splitDraftFromCommentary('')).toEqual({ reply: '', draft: null });
    expect(splitDraftFromCommentary(null)).toEqual({ reply: '', draft: null });
  });

  it('produces no commentary when the entire response is the draft with nothing before or after', () => {
    const raw = `${DRAFT_DELIMITER_START}\nHi Kris,\n\nBody.\n${DRAFT_DELIMITER_END}`;
    const { reply, draft } = splitDraftFromCommentary(raw);
    expect(reply).toBe('');
    expect(draft).toContain('Hi Kris,');
  });
});

describe('buildSurfaceContract — draft mode instructs the delimiter format', () => {
  it('instructs the model to wrap the draft in the exact markers splitDraftFromCommentary expects', () => {
    const contract = buildSurfaceContract('inbox_draft', 'draft');
    expect(contract).toContain(DRAFT_DELIMITER_START);
    expect(contract).toContain(DRAFT_DELIMITER_END);
  });

  it('applies to project_chat in draft mode too, not just inbox_draft', () => {
    const contract = buildSurfaceContract('project_chat', 'draft');
    expect(contract).toContain(DRAFT_DELIMITER_START);
  });

  it('does not instruct delimiters in discuss mode', () => {
    const contract = buildSurfaceContract('project_chat', 'discuss');
    expect(contract).not.toContain(DRAFT_DELIMITER_START);
  });
});
