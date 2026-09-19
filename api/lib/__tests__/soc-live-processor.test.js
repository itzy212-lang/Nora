// api/lib/__tests__/soc-live-processor.test.js
//
// Regression tests for three defects found by the live semantic
// acceptance test (2026-09-19): a contextual correction ("actually,
// that's 450, not 650") failed to supersede its target because the
// amendment claim carried no resolved element; contextual references
// ("same wall", "that one") were persisted as literal element names
// instead of being resolved; a genuinely ambiguous "the wall" was
// silently promoted to active evidence instead of triggering
// clarification.
//
// All three traced to the same two root causes, not to the
// code-enforced persistence layer (live-state.js), which was already
// correct: the context handed to the model was unstructured raw
// prose only, and the prompt's own instructions didn't require
// resolution in these cases. This file tests what's actually testable
// in this environment (the prompt content itself, and the new
// structured-context formatting) — it cannot exercise the model's own
// reasoning, since this sandbox has no network path to the live model
// API. See the Phase C defect-fix checkpoint for how that gap was
// otherwise addressed.

import { describe, it, expect } from 'vitest';
import { LIVE_PROCESSING_CONTRACT, LIVE_PROCESSING_CONTRACT_VERSION } from '../soc-brain-v2/live-processing-contract.js';
import { formatRecentClaim } from '../soc-brain-v2/live-processor.js';

describe('LIVE_PROCESSING_CONTRACT — defect 1: amendment claims must resolve element', () => {
  it('requires a resolved element on every amendment, even when the surveyor did not repeat it', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('an amendment claim must always carry a resolved element');
    expect(LIVE_PROCESSING_CONTRACT).toContain('Without a resolved element, a correction cannot be safely applied and will not take effect');
  });

  it('still allows unaffected detail fields to stay null, distinct from element', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('leave unaffected detail fields null');
  });
});

describe('LIVE_PROCESSING_CONTRACT — defect 2: contextual references must resolve, not persist literally', () => {
  it('explicitly names the literal-persistence failure mode and forbids it', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('never persist one of these phrases as the value of element');
    expect(LIVE_PROCESSING_CONTRACT).toMatch(/"same wall"/);
  });

  it('requires raw_fragment to keep the surveyor\'s original words even when element is resolved', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('raw_fragment always keeps the surveyor\'s actual words');
  });

  it('distinguishes resolution from classification: resolve the referent first, then decide addition vs amendment', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('resolve first, then classify as addition or amendment');
  });
});

describe('LIVE_PROCESSING_CONTRACT — defect 3: an unresolvable generic reference must ask, not guess', () => {
  it('connects an unresolved contextual reference directly to the clarification requirement', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('do not promote it to a resolved, active claim under a vague label');
    expect(LIVE_PROCESSING_CONTRACT).toContain('Ask instead');
  });

  it('requires the claim itself to stay "unresolved", not a resolved type, while a question is pending', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('mark the claim itself "unresolved"');
  });

  it('gives the exact worked example from the failing test case', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('Which wall is the 200mm crack on?');
  });

  it('defines when a reference resolves safely vs when it does not (one clear candidate vs none/several)', () => {
    expect(LIVE_PROCESSING_CONTRACT).toContain('ONE clear, specific candidate');
  });
});

describe('LIVE_PROCESSING_CONTRACT — version bumped for this content change', () => {
  it('is no longer v1.0.0', () => {
    expect(LIVE_PROCESSING_CONTRACT_VERSION).not.toBe('v1.0.0');
  });
});

describe('formatRecentClaim — structured context, not bare prose (the other half of defects 1 and 2)', () => {
  it('labels the established element explicitly, not just the raw sentence', () => {
    const line = formatRecentClaim({ claim_id: 'c-4-1', claim_type: 'specific_defect', element: 'party wall', defect_type: 'hairline crack', measurement: 'about 650 millimetres', direction: 'running diagonally up', raw_fragment: 'a hairline crack in the party wall, about 650 millimetres, running diagonally up from the corner' });
    expect(line).toContain('element="party wall"');
    expect(line).toContain('hairline crack');
    expect(line).toContain('about 650 millimetres');
    expect(line).toContain('running diagonally up');
    // The original words must still be present too - resolution augments, never replaces the evidence.
    expect(line).toContain('running diagonally up from the corner');
  });

  it('falls back to claim_type when no element has been resolved yet', () => {
    const line = formatRecentClaim({ claim_id: 'c-1-1', claim_type: 'section_declaration', raw_fragment: 'Moving into the first floor front bedroom.' });
    expect(line).toContain('(section_declaration)');
  });

  it('omits an empty facts segment cleanly rather than leaving stray punctuation', () => {
    const line = formatRecentClaim({ claim_id: 'c-2-1', element: 'window', raw_fragment: 'The window opened and closed satisfactorily' });
    expect(line).not.toContain(' — (');
    expect(line).not.toContain(' — undefined');
  });
});
