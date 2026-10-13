import { describe, it, expect } from 'vitest';
import { checkGenerationBarrier } from '../soc-brain-v2/generation-barrier.js';

function mockSupabase(notes, metadata = {}) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        order() { return Promise.resolve({ data: notes, error: null }); },
        maybeSingle() { return Promise.resolve({ data: { metadata }, error: null }); },
      };
      return chain;
    },
  };
}

describe('generation barrier', () => {
  it('does not block on a failed note that is an exact duplicate of a processed note', async () => {
    const r = await checkGenerationBarrier(mockSupabase([
      { id: 1, sequence: 1, raw_note: 'Starting the schedule of conditions in flat B', processing_status: 'failed' },
      { id: 2, sequence: 2, raw_note: 'starting the schedule of conditions in  flat b', processing_status: 'processed' },
    ]), 's');
    expect(r.ok).toBe(true);
  });
  it('still blocks on a failed note whose words are not captured anywhere else', async () => {
    const r = await checkGenerationBarrier(mockSupabase([
      { id: 1, sequence: 1, raw_note: 'crack above the door', processing_status: 'failed' },
      { id: 2, sequence: 2, raw_note: 'something else', processing_status: 'processed' },
    ]), 's');
    expect(r).toMatchObject({ ok: false, reason: 'notes_failed_processing' });
    expect(r.blocking_notes).toHaveLength(1);
  });
  it('still blocks while a note is processing, or on an unanswered clarification', async () => {
    expect((await checkGenerationBarrier(mockSupabase([{ id: 1, sequence: 1, raw_note: 'x', processing_status: 'processing' }]), 's')).reason).toBe('notes_still_processing');
    expect((await checkGenerationBarrier(mockSupabase([{ id: 1, sequence: 1, raw_note: 'x', processing_status: 'processed' }], { pending_clarification: { question: 'q' } }), 's')).reason).toBe('pending_clarification_unanswered');
  });
});
