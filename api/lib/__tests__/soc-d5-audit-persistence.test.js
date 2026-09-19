// api/lib/__tests__/soc-d5-audit-persistence.test.js
//
// Close-out pass, fix 3 — persist enough D5 audit detail to inspect
// the actual professional rewrite later. Tests the merge logic in
// runSocV2Pipeline directly (mocking D1-D6's own functions, already
// tested individually elsewhere) — this is pure persistence
// plumbing, not a change to D5's or D6's own decision-making, so
// these tests focus on whether the merged record is correct, not on
// re-testing D5/D6 logic itself.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../soc-brain-v2/generation-barrier.js', () => ({ checkGenerationBarrier: vi.fn(async () => ({ ok: true })) }));
vi.mock('../soc-brain-v2/reconciliation.js', () => ({
  reconcile: vi.fn(async () => ({
    items: [], excluded: [], site_notes: [],
    sections: [{ id: 'sec-1', display_name: 'Room', first_entered_sequence: 1 }],
  })),
}));

const baseRow = (rowId, obs, sourceIds = ['c-1']) => ({ row_id: rowId, observation: obs, element: 'x', source_item_ids: sourceIds });

function mockDraft(rows) {
  return vi.fn(async () => ({
    sections: [{ section_id: 'sec-1', section_name: 'Room', rows }],
    reconciliation_items: [],
    excluded: [],
  }));
}

vi.mock('../soc-brain-v2/drafting.js', () => ({ draft: vi.fn() }));
vi.mock('../soc-brain-v2/fidelity-audit.js', () => ({
  runFidelityAudit: vi.fn(async () => ({ findings: [], status: 'pass' })),
  applyRepairs: vi.fn((draftResult) => ({ repairedDraft: draftResult, auditTrail: [] })),
}));
vi.mock('../soc-brain-v2/site-note-drafting.js', () => ({ draftSiteNotes: vi.fn(async () => []) }));

describe('D5 audit trail persistence — the merge logic', () => {
  it('unchanged rows do not falsely appear in the persisted trail', async () => {
    vi.resetModules();
    const rows = [baseRow('row-unchanged', 'Same text throughout.')];
    vi.doMock('../soc-brain-v2/drafting.js', () => ({ draft: mockDraft(rows) }));
    vi.doMock('../soc-brain-v2/quality-audit.js', () => ({
      runQualityAudit: vi.fn(async () => ({ sections: [{ section_id: 'sec-1', section_name: 'Room', rows }], quality_audit_trail: [], issues_for_upstream_review: [] })),
    }));
    vi.doMock('../soc-brain-v2/factual-guard.js', () => ({
      runPostQualityGuard: vi.fn(async () => ({ sections: [{ section_id: 'sec-1', section_name: 'Room', rows }], audit_trail: [], guard_findings: [], status: 'pass' })),
    }));
    const { runSocV2Pipeline } = await import('../soc-brain-v2/production-pipeline.js');
    const result = await runSocV2Pipeline({}, { sessionId: 's1', apiKey: 'k' });
    expect(result._soc_v2_metadata.d5_audit_trail).toEqual([]);
  });

  it('a changed row retains its stable row_id and source_item_ids, with correct before/after text', async () => {
    vi.resetModules();
    const d4Rows = [baseRow('row-changed', 'The party wall was recorded.', ['c-2-1', 'c-2-2'])];
    const d5Rows = [baseRow('row-changed', 'The party wall has a plaster finish.', ['c-2-1', 'c-2-2'])];
    vi.doMock('../soc-brain-v2/drafting.js', () => ({ draft: mockDraft(d4Rows) }));
    vi.doMock('../soc-brain-v2/quality-audit.js', () => ({
      runQualityAudit: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        quality_audit_trail: [{ row_id: 'row-changed', section_id: 'sec-1', original: d4Rows[0].observation, reason: 'Added the finish, which was recorded but omitted.', revised: d5Rows[0].observation }],
        issues_for_upstream_review: [],
      })),
    }));
    vi.doMock('../soc-brain-v2/factual-guard.js', () => ({
      runPostQualityGuard: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        audit_trail: [{ row_id: 'row-changed', section_id: 'sec-1', source_item_ids: ['c-2-1', 'c-2-2'], d4_wording: d4Rows[0].observation, d5_wording: d5Rows[0].observation, action: 'ACCEPT_D5', final_wording: d5Rows[0].observation }],
        guard_findings: [], status: 'pass',
      })),
    }));
    const { runSocV2Pipeline } = await import('../soc-brain-v2/production-pipeline.js');
    const result = await runSocV2Pipeline({}, { sessionId: 's1', apiKey: 'k' });
    const entry = result._soc_v2_metadata.d5_audit_trail[0];
    expect(entry.row_id).toBe('row-changed');
    expect(entry.source_item_ids).toEqual(['c-2-1', 'c-2-2']);
    expect(entry.before_wording).toBe('The party wall was recorded.');
    expect(entry.after_wording).toBe('The party wall has a plaster finish.');
    expect(entry.quality_reason).toBe('Added the finish, which was recorded but omitted.');
  });

  it('ACCEPT_D5 is reflected correctly, and final_wording matches the actually-persisted row', async () => {
    vi.resetModules();
    const d4Rows = [baseRow('row-1', 'before text')];
    const d5Rows = [baseRow('row-1', 'after text')];
    vi.doMock('../soc-brain-v2/drafting.js', () => ({ draft: mockDraft(d4Rows) }));
    vi.doMock('../soc-brain-v2/quality-audit.js', () => ({
      runQualityAudit: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        quality_audit_trail: [{ row_id: 'row-1', section_id: 'sec-1', original: 'before text', reason: 'clarity', revised: 'after text' }],
        issues_for_upstream_review: [],
      })),
    }));
    vi.doMock('../soc-brain-v2/factual-guard.js', () => ({
      runPostQualityGuard: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        audit_trail: [{ row_id: 'row-1', section_id: 'sec-1', source_item_ids: ['c-1'], d4_wording: 'before text', d5_wording: 'after text', action: 'ACCEPT_D5', final_wording: 'after text' }],
        guard_findings: [], status: 'pass',
      })),
    }));
    const { runSocV2Pipeline } = await import('../soc-brain-v2/production-pipeline.js');
    const result = await runSocV2Pipeline({}, { sessionId: 's1', apiKey: 'k' });
    const entry = result._soc_v2_metadata.d5_audit_trail[0];
    expect(entry.d6_decision).toBe('ACCEPT_D5');
    expect(entry.final_wording).toBe('after text');
    expect(result.sections[0].rows[0].observation).toBe('after text');
  });

  it('REVERT_TO_D4 is reflected correctly, and final_wording matches the reverted (D4) text actually persisted', async () => {
    vi.resetModules();
    const d4Rows = [baseRow('row-1', 'the original, factually correct wording')];
    const d5Rows = [baseRow('row-1', 'a rewrite that D6 rejected')];
    const finalRows = [baseRow('row-1', 'the original, factually correct wording')];
    vi.doMock('../soc-brain-v2/drafting.js', () => ({ draft: mockDraft(d4Rows) }));
    vi.doMock('../soc-brain-v2/quality-audit.js', () => ({
      runQualityAudit: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        quality_audit_trail: [{ row_id: 'row-1', section_id: 'sec-1', original: d4Rows[0].observation, reason: 'style', revised: d5Rows[0].observation }],
        issues_for_upstream_review: [],
      })),
    }));
    vi.doMock('../soc-brain-v2/factual-guard.js', () => ({
      runPostQualityGuard: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: finalRows }],
        audit_trail: [{ row_id: 'row-1', section_id: 'sec-1', source_item_ids: ['c-1'], d4_wording: d4Rows[0].observation, d5_wording: d5Rows[0].observation, action: 'REVERT_TO_D4', final_wording: finalRows[0].observation }],
        guard_findings: [], status: 'pass',
      })),
    }));
    const { runSocV2Pipeline } = await import('../soc-brain-v2/production-pipeline.js');
    const result = await runSocV2Pipeline({}, { sessionId: 's1', apiKey: 'k' });
    const entry = result._soc_v2_metadata.d5_audit_trail[0];
    expect(entry.d6_decision).toBe('REVERT_TO_D4');
    expect(entry.final_wording).toBe('the original, factually correct wording');
    expect(result.sections[0].rows[0].observation).toBe('the original, factually correct wording');
  });

  it('does not include hidden model reasoning or chain-of-thought — only the structured reason text D5 itself produced', async () => {
    vi.resetModules();
    const d4Rows = [baseRow('row-1', 'before')];
    const d5Rows = [baseRow('row-1', 'after')];
    vi.doMock('../soc-brain-v2/drafting.js', () => ({ draft: mockDraft(d4Rows) }));
    vi.doMock('../soc-brain-v2/quality-audit.js', () => ({
      runQualityAudit: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        quality_audit_trail: [{ row_id: 'row-1', section_id: 'sec-1', original: 'before', reason: 'Improved concision.', revised: 'after' }],
        issues_for_upstream_review: [],
      })),
    }));
    vi.doMock('../soc-brain-v2/factual-guard.js', () => ({
      runPostQualityGuard: vi.fn(async () => ({
        sections: [{ section_id: 'sec-1', section_name: 'Room', rows: d5Rows }],
        audit_trail: [{ row_id: 'row-1', section_id: 'sec-1', source_item_ids: ['c-1'], d4_wording: 'before', d5_wording: 'after', action: 'ACCEPT_D5', final_wording: 'after' }],
        guard_findings: [], status: 'pass',
      })),
    }));
    const { runSocV2Pipeline } = await import('../soc-brain-v2/production-pipeline.js');
    const result = await runSocV2Pipeline({}, { sessionId: 's1', apiKey: 'k' });
    const entry = result._soc_v2_metadata.d5_audit_trail[0];
    expect(Object.keys(entry).sort()).toEqual(['after_wording', 'before_wording', 'd6_decision', 'final_wording', 'quality_reason', 'row_id', 'section_id', 'source_item_ids'].sort());
  });
});
