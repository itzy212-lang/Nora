// api/lib/__tests__/soc-factual-guard.test.js
//
// Phase D6 — regression tests. Deterministic checks (provenance,
// section, row_id, blocked-row, measurement-drop, row-set integrity,
// section order) are tested directly against real code with
// synthetic fixtures. Semantic comparisons are tested against a
// mocked model response for correct plumbing/fail-safe behaviour;
// genuine model judgment is verified live (see the D6 report). No
// production data touched by any test.

import { describe, it, expect } from 'vitest';
import { runPostQualityGuard } from '../soc-brain-v2/factual-guard.js';

const FB = 'sec-front';

function d4Draft(rows) {
  return { sections: [{ section_id: FB, section_name: 'Front Bedroom', rows }] };
}
function d5Draft(rows) {
  return { sections: [{ section_id: FB, section_name: 'Front Bedroom', rows }] };
}

function mockVerdicts(verdictsByRowId) {
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const userMsg = body.messages[1].content;
    const results = Object.entries(verdictsByRowId)
      .filter(([id]) => userMsg.includes(`[${id}]`))
      .map(([reference, v]) => ({ reference, ...v }));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ results }) } }] }) };
  };
}

describe('runPostQualityGuard — semantic fail-safe (tests 1, 2, 4, 5, 16, 20)', () => {
  it('[1][16] a genuine professional rewrite with preserved measurement is ACCEPT_D5', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'A hairline crack measuring approximately 450mm was noted.', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'A hairline crack, approximately 450mm in length, was noted.', element: 'party wall', source_item_ids: ['c-1'] }]);
    mockVerdicts({ r1: { verdict: 'FACTUALLY_EQUIVALENT', explanation: 'Same measurement, same defect, equivalent phrasing.' } });
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.audit_trail[0].action).toBe('ACCEPT_D5');
    expect(result.sections[0].rows[0].observation).toBe('A hairline crack, approximately 450mm in length, was noted.');
  });

  it('[4] a rephrased but preserved spatial relationship is ACCEPT_D5', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'A further crack was noted 200mm to the left of the previously noted crack.', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'A further crack was noted, positioned 200mm to the left of the previously identified crack.', element: 'party wall', source_item_ids: ['c-1'] }]);
    mockVerdicts({ r1: { verdict: 'FACTUALLY_EQUIVALENT', explanation: 'Same spatial relationship, same measurement.' } });
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.audit_trail[0].action).toBe('ACCEPT_D5');
  });

  it('[5] left changed to right is REJECT / REVERT_TO_D4', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: '200mm to the left of the existing crack.', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: '200mm to the right of the existing crack.', element: 'party wall', source_item_ids: ['c-1'] }]);
    mockVerdicts({ r1: { verdict: 'FACTUAL_CHANGE', explanation: 'Spatial relationship reversed: left became right.' } });
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.audit_trail[0].action).toBe('REVERT_TO_D4');
    expect(result.sections[0].rows[0].observation).toBe('200mm to the left of the existing crack.');
  });

  it('[20] a genuinely uncertain verdict restores D4 wording and flags, never silently passes', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'Original wording.', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'Ambiguously reworded.', element: 'party wall', source_item_ids: ['c-1'] }]);
    mockVerdicts({ r1: { verdict: 'UNCERTAIN', explanation: 'Cannot confidently determine if meaning is preserved.' } });
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.audit_trail[0].action).toBe('FLAG_UNCERTAIN');
    expect(result.sections[0].rows[0].observation).toBe('Original wording.');
  });

  it('a row the model returns no verdict for is treated as uncertain, never a silent pass', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'x', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'y', element: 'party wall', source_item_ids: ['c-1'] }]);
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"results":[]}' } }] }) });
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.audit_trail[0].action).toBe('FLAG_UNCERTAIN');
    expect(result.sections[0].rows[0].observation).toBe('x');
  });
});

describe('runPostQualityGuard — deterministic detection, no model judgment needed (tests 2, 3, 6, 9, 10, 11, 15 as deterministic-catchable subset)', () => {
  it('[3] a measurement present in D4 but dropped entirely from D5 is deterministically REVERT_TO_D4, no model call needed', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'A hairline crack of 450mm was noted.', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'A hairline crack was noted.', element: 'party wall', source_item_ids: ['c-1'] }]);
    let modelCalled = false;
    global.fetch = async () => { modelCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"results":[]}' } }] }) }; };
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.audit_trail[0].action).toBe('REVERT_TO_D4');
    expect(result.audit_trail[0].deterministic_result[0].check).toBe('protected_measurement');
    expect(modelCalled).toBe(false);
  });

  it('[12] changed source_item_ids is a deterministic BLOCKING finding, REVERT_TO_D4', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'x', element: 'party wall', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'x', element: 'party wall', source_item_ids: ['c-2'] }]);
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.status).toBe('guard_findings_present');
    expect(result.guard_findings.some(f => f.check === 'source_item_ids')).toBe(true);
  });

  it('[13] changed section_id is a deterministic BLOCKING finding, REVERT_TO_D4', async () => {
    const d4 = { sections: [{ section_id: 'sec-a', section_name: 'A', rows: [{ row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] }] }] };
    const d5 = { sections: [{ section_id: 'sec-b', section_name: 'B', rows: [{ row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] }] }] };
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.guard_findings.some(f => f.check === 'section_id')).toBe(true);
    expect(result.audit_trail.find(a => a.row_id === 'r1').action).toBe('REVERT_TO_D4');
  });

  it('[14] a row_id present in D5 but absent from D4 is a row_set_integrity finding', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([
      { row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] },
      { row_id: 'r2-unexplained', observation: 'y', element: 'e', source_item_ids: ['c-1'] },
    ]);
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.guard_findings.some(f => f.row_id === 'r2-unexplained' && f.check === 'row_set_integrity')).toBe(true);
  });

  it('a row present in D4 but missing from D5 is a row_set_integrity finding', async () => {
    const d4 = d4Draft([
      { row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] },
      { row_id: 'r2', observation: 'y', element: 'e', source_item_ids: ['c-2'] },
    ]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] }]);
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.guard_findings.some(f => f.row_id === 'r2' && f.check === 'row_set_integrity')).toBe(true);
  });
});

describe('runPostQualityGuard — [18][19] blocked and skipped rows require no model call and stay untouched', () => {
  it('a D4-blocked row untouched by D5 passes through with no semantic call', async () => {
    const d4 = d4Draft([{ row_id: 'r-blocked', observation: 'Blocked wording.', element: 'e', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r-blocked', observation: 'Blocked wording.', element: 'e', source_item_ids: ['c-1'] }]);
    let modelCalled = false;
    global.fetch = async () => { modelCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"results":[]}' } }] }) }; };
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, blockedRowIds: ['r-blocked'], apiKey: 'k' });
    expect(modelCalled).toBe(false);
    expect(result.sections[0].rows[0].observation).toBe('Blocked wording.');
    expect(result.audit_trail.length).toBe(0); // PASSTHROUGH rows are not in the audit trail
  });

  it('[18] a D4-blocked row that D5 somehow modified anyway is caught and reverted', async () => {
    const d4 = d4Draft([{ row_id: 'r-blocked', observation: 'Blocked wording.', element: 'e', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r-blocked', observation: 'D5 should never have touched this.', element: 'e', source_item_ids: ['c-1'] }]);
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, blockedRowIds: ['r-blocked'], apiKey: 'k' });
    expect(result.guard_findings.some(f => f.check === 'blocked_row_untouched')).toBe(true);
    expect(result.sections[0].rows[0].observation).toBe('Blocked wording.');
  });

  it('[17][19] an unchanged, non-blocked row requires no model call', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'Same wording throughout.', element: 'e', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'Same wording throughout.', element: 'e', source_item_ids: ['c-1'] }]);
    let modelCalled = false;
    global.fetch = async () => { modelCalled = true; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"results":[]}' } }] }) }; };
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(modelCalled).toBe(false);
    expect(result.sections[0].rows[0].observation).toBe('Same wording throughout.');
  });
});

describe('runPostQualityGuard — section order integrity', () => {
  it('a changed section order between D4 and D5 is a blocking finding', async () => {
    const d4 = { sections: [{ section_id: 'a', section_name: 'A', rows: [] }, { section_id: 'b', section_name: 'B', rows: [] }] };
    const d5 = { sections: [{ section_id: 'b', section_name: 'B', rows: [] }, { section_id: 'a', section_name: 'A', rows: [] }] };
    const result = await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(result.guard_findings.some(f => f.check === 'section_order')).toBe(true);
  });
});

describe('runPostQualityGuard — model/configuration', () => {
  it('uses gpt-5.6-terra with its established invocation pattern', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'y', element: 'e', source_item_ids: ['c-1'] }]);
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"results":[{"reference":"r1","verdict":"FACTUALLY_EQUIVALENT","explanation":"ok"}]}' } }] }) };
    };
    await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(capturedBody.model).toBe('gpt-5.6-terra');
    expect(capturedBody.messages[0].role).toBe('developer');
  });

  it('falls back to gpt-4o if Terra fails', async () => {
    const d4 = d4Draft([{ row_id: 'r1', observation: 'x', element: 'e', source_item_ids: ['c-1'] }]);
    const d5 = d5Draft([{ row_id: 'r1', observation: 'y', element: 'e', source_item_ids: ['c-1'] }]);
    const models = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      models.push(body.model);
      if (body.model === 'gpt-5.6-terra') return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"results":[{"reference":"r1","verdict":"FACTUALLY_EQUIVALENT","explanation":"ok"}]}' } }] }) };
    };
    await runPostQualityGuard({}, { sessionId: 's1', d4Draft: d4, d5Draft: d5, apiKey: 'k' });
    expect(models).toEqual(['gpt-5.6-terra', 'gpt-4o']);
  });
});
