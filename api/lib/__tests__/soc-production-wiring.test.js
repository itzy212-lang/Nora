// api/lib/__tests__/soc-production-wiring.test.js
//
// Final integration phase — proves the ACTUAL production generation
// orchestration (extractStructuredData in generate-soc.js) executes
// the new D1-D6 pipeline by default, never silently substitutes the
// legacy pipeline on failure, and that the explicit legacy flag still
// reaches the old, preserved code path. These tests exercise
// generate-soc.js's own exported functions directly - not a
// standalone call to runSocV2Pipeline - because the point is to prove
// the production entry point itself is wired correctly, not merely
// that the pipeline module works in isolation (already covered
// elsewhere).

import { describe, it, expect, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
  }),
}));

function mockV2Success(overrides = {}) {
  return vi.fn(async () => ({
    sections: [
      { number: 1, title: 'Ground Floor Front Reception Room', rows: [{ ref: 'FR01', observation: 'x', action: 'Record only' }] },
    ],
    site_notes: [{ topic: 'general', description: 'Garden access note.' }],
    actions: [],
    emails_required: [],
    unresolved_notes: [],
    _soc_v2_metadata: {
      pipeline: 'soc_v2', pipeline_version: 'v1.0.0',
      d1_status: 'pass', d2_items_count: 5, d2_recovered_count: 0, d2_excluded_count: 0,
      d3_row_count: 1,
      d4_status: 'pass', d4_findings: [], d4_blocked_row_ids: [],
      d5_changed_count: 0, d5_issues: [],
      d6_status: 'pass', d6_accept_d5_count: 0, d6_revert_to_d4_count: 0, d6_flag_uncertain_count: 0, d6_guard_findings_count: 0,
      row_identity: [{ row_id: 'row-abc', section_id: 'sec-1', source_item_ids: ['c-1'], human_reference: 'FR01' }],
      ...overrides,
    },
  }));
}

function mockLegacyFns() {
  return {
    draftFromClaims: vi.fn(async () => ({ sections: [{ number: 1, title: 'Legacy Room', rows: [] }] })),
    runQualityAudit: vi.fn(async (d) => d),
    runCompletenessAudit: vi.fn(() => ({ issues: [], warnings: [] })),
  };
}

describe('1-6. the production path calls the v2 pipeline (which itself sequences D1-D6)', () => {
  it('extractStructuredData calls runSocV2Pipeline by default, with the session/project/apiKey it was given', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    const { runSocV2Pipeline } = await import('../soc-brain-v2/production-pipeline.js');

    await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', 'ao-1', 'user-1');

    expect(runSocV2Pipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-1', projectId: 'project-1', aoId: 'ao-1', apiKey: 'key' })
    );
  });
});

describe('7. the final persisted/returned output is exactly the D6 result, reference-coded', () => {
  it('sections/site_notes in the returned dataForRender match what the v2 pipeline produced', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    const result = await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');

    expect(result.sections[0].title).toBe('Ground Floor Front Reception Room');
    expect(result.sections[0].rows[0].ref).toBe('FR01');
    expect(result.site_notes).toEqual([{ topic: 'general', description: 'Garden access note.' }]);
    expect(result.generation_status).toBe('complete');
  });
});

describe('8-10. the old drafting/quality/completeness functions are never called on a successful v2 run', () => {
  it('draftFromClaims, the old runQualityAudit, and runCompletenessAudit are not invoked', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    const legacy = mockLegacyFns();
    vi.doMock('../soc-pipeline.js', () => legacy);

    const { extractStructuredData } = await import('../../generate-soc.js');
    await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');

    expect(legacy.draftFromClaims).not.toHaveBeenCalled();
    expect(legacy.runQualityAudit).not.toHaveBeenCalled();
    expect(legacy.runCompletenessAudit).not.toHaveBeenCalled();
  });
});

describe('11/18/19/20. safe generation-failure behaviour', () => {
  it('11. a v2 pipeline failure never falls back to draftFromClaims or any legacy function', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({
      runSocV2Pipeline: vi.fn(async () => { const e = new Error('SOC_V2_GENERATION_FAILED: stage d3 — boom'); e.stage = 'd3'; throw e; }),
    }));
    const legacy = mockLegacyFns();
    vi.doMock('../soc-pipeline.js', () => legacy);

    const { extractStructuredData } = await import('../../generate-soc.js');
    await expect(extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1')).rejects.toThrow(/GENERATION_INCOMPLETE/);

    expect(legacy.draftFromClaims).not.toHaveBeenCalled();
    expect(legacy.runQualityAudit).not.toHaveBeenCalled();
    expect(legacy.runCompletenessAudit).not.toHaveBeenCalled();
  });

  it('18. the thrown error safely identifies the failed stage without a raw stack trace', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({
      runSocV2Pipeline: vi.fn(async () => { const e = new Error('x'); e.stage = 'd5'; throw e; }),
    }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    try {
      await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).toContain('stage: d5');
      expect(err.message).not.toContain(' at ');
      expect(err.message).not.toMatch(/\.js:\d+/);
    }
  });

  it('19. generation failure does not destroy evidence — no write-table call is made anywhere in the failure path', async () => {
    vi.resetModules();
    const fromSpy = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: fromSpy }) }));
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({
      runSocV2Pipeline: vi.fn(async () => { const e = new Error('x'); e.stage = 'd4'; throw e; }),
    }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    await expect(extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1')).rejects.toThrow();

    for (const call of fromSpy.mock.calls) {
      expect(['projects', 'user_brain_v2']).toContain(call[0]);
    }
  });

  it('20. generation failure does not fall back to legacy drafting even when the failure is a barrier block', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({
      runSocV2Pipeline: vi.fn(async () => { const e = new Error('notes still processing'); e.isBarrierBlock = true; throw e; }),
    }));
    const legacy = mockLegacyFns();
    vi.doMock('../soc-pipeline.js', () => legacy);

    const { extractStructuredData } = await import('../../generate-soc.js');
    await expect(extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1')).rejects.toThrow(/GENERATION_INCOMPLETE/);
    expect(legacy.draftFromClaims).not.toHaveBeenCalled();
  });
});

describe('explicit legacy opt-in still reaches the preserved old code path', () => {
  it('projectMeta.useLegacyPipeline routes to extractStructuredDataLegacy, not the v2 pipeline', async () => {
    vi.resetModules();
    const v2 = mockV2Success();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: v2 }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData, extractStructuredDataLegacy } = await import('../../generate-soc.js');
    expect(typeof extractStructuredDataLegacy).toBe('function');

    try {
      await extractStructuredData('[1] some note', { useLegacyPipeline: true }, 'key', 'session-1', 'project-1', null, 'user-1');
    } catch {
      // The legacy path may fail for unrelated reasons in this mocked
      // environment (e.g. no real claims) - irrelevant to this test,
      // which only checks routing.
    }
    expect(v2).not.toHaveBeenCalled();
  });
});

describe('12-13. site note routing, exercised through the production entry point', () => {
  it('a site note produced by the v2 pipeline appears in site_notes, not embedded in any section row', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    const result = await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');

    expect(result.site_notes.some(sn => sn.description.includes('Garden access'))).toBe(true);
    const allRowText = result.sections.flatMap(s => s.rows.map(r => r.observation)).join(' ');
    expect(allRowText).not.toContain('Garden access');
  });
});

describe('14-15. stable row IDs and source_item_ids survive to the returned/persisted metadata', () => {
  it('row_identity in _soc_v2_metadata carries row_id and source_item_ids through unchanged', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    const result = await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');

    expect(result._soc_v2_metadata.row_identity[0]).toMatchObject({ row_id: 'row-abc', source_item_ids: ['c-1'] });
  });
});

describe('16. concise human-facing references are what reaches the final output', () => {
  it('row refs are the concise form (e.g. FR01), never a floor-prefixed form (e.g. GFFR01)', async () => {
    vi.resetModules();
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    const result = await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');

    expect(result.sections[0].rows[0].ref).toBe('FR01');
    expect(result.sections[0].rows[0].ref).not.toMatch(/^GF/);
  });
});

describe('17. Phase C evidence is never written to by the production entry point itself', () => {
  it('extractStructuredData makes no write call to soc_claims/soc_sections/soc_notes before or after invoking the pipeline', async () => {
    vi.resetModules();
    const fromSpy = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ from: fromSpy }) }));
    vi.doMock('../soc-brain-v2/production-pipeline.js', () => ({ runSocV2Pipeline: mockV2Success() }));
    vi.doMock('../soc-pipeline.js', () => mockLegacyFns());

    const { extractStructuredData } = await import('../../generate-soc.js');
    await extractStructuredData('notes', {}, 'key', 'session-1', 'project-1', null, 'user-1');

    for (const call of fromSpy.mock.calls) {
      expect(['soc_claims', 'soc_sections', 'soc_notes']).not.toContain(call[0]);
    }
  });
});
