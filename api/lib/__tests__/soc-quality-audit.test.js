// api/lib/__tests__/soc-quality-audit.test.js
//
// Phase D5 — regression tests for the Professional Quality Audit.
// All fixtures synthetic; nothing touches production inspection
// evidence.
//
// What's genuinely testable in code (and tested directly here): row
// blocking is structural (a blocked row is never sent to the model
// and comes back byte-for-byte unchanged); edits are matched by
// stable row_id, never array position; row_id and source_item_ids
// survive every edit untouched; row count is preserved 1:1 (this
// architecture has no merge primitive — D5 edits a row's own text, it
// never combines two D3 rows into one, so "must not merge distinct
// observations" is structurally guaranteed here, not just prompt-
// instructed); an unedited row is left byte-for-byte alone.
//
// What is NOT independently provable by a mock (the actual judgment
// behind each of the 13 requested lock/quality scenarios — does the
// model actually decline to invent a defect, does it actually keep
// 450mm, etc.) is tested for correct plumbing here (contract states
// the rule; a compliant mocked response flows through correctly) and
// was separately verified against the live model — see the D5 report.

import { describe, it, expect, vi } from 'vitest';

import { runQualityAudit } from '../soc-brain-v2/quality-audit.js';
import { QUALITY_AUDIT_CONTRACT } from '../soc-brain-v2/quality-audit-contract.js';

const FB = { section_id: 'sec-front', section_name: 'Front Bedroom' };

function mockModel(bySection) {
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const sectionName = /SECTION: (.+)/.exec(body.messages[1].content)?.[1];
    const result = bySection[sectionName] || { status: 'pass', edits: [], issues_for_upstream_review: [] };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
  };
}

function draftWith(rows) {
  return { session_id: 's1', sections: [{ ...FB, rows }], reconciliation_items: [], excluded: [] };
}

describe('QUALITY_AUDIT_CONTRACT — governing locks are stated (genuine model judgment verified live, see D5 report)', () => {
  it('locks measurements, units, qualifiers, axes, reference points, and directions', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('alter measurements, units, or qualifiers');
    expect(QUALITY_AUDIT_CONTRACT).toContain('alter axes, reference points, or directions');
  });
  it('locks condition assessment upgrades explicitly', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('upgrade a condition assessment');
    expect(QUALITY_AUDIT_CONTRACT).toContain('generally good condition');
  });
  it('locks operational-test results against strengthening', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('add or strengthen operational-test results');
  });
  it('locks diagnosis, causation, and structural significance', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('add diagnosis, causation, or structural significance');
  });
  it('locks section order and element identity', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('alter section order');
    expect(QUALITY_AUDIT_CONTRACT).toContain('alter element identity');
  });
  it('instructs declining rather than guessing when a fact is not established', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('do not make the edit');
    expect(QUALITY_AUDIT_CONTRACT).toContain('issue for upstream review');
  });
  it('instructs leaving an already-professional row alone rather than rewriting for variety', () => {
    expect(QUALITY_AUDIT_CONTRACT).toContain('should be left alone');
    expect(QUALITY_AUDIT_CONTRACT).toContain('Do not rewrite merely to demonstrate variety');
  });
});

describe('runQualityAudit — blocking is structural: a blocked row never reaches the model', () => {
  it('excludes a blocked row from the prompt entirely and returns it byte-for-byte unchanged', async () => {
    let capturedPrompt = '';
    global.fetch = async (url, opts) => {
      capturedPrompt = JSON.parse(opts.body).messages[1].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"pass","edits":[],"issues_for_upstream_review":[]}' } }] }) };
    };
    const draft = draftWith([
      { row_id: 'row-a', observation: 'A measurement of 200mm was recorded in relation to the party wall.', element: 'party wall', source_item_ids: ['a'] },
      { row_id: 'row-b', observation: 'The party wall has a plaster and emulsion finish.', element: 'party wall', source_item_ids: ['b'] },
    ]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, blockedRowIds: ['row-a'], apiKey: 'k' });
    expect(capturedPrompt).not.toContain('200mm was recorded');
    const blockedRow = result.sections[0].rows.find(r => r.row_id === 'row-a');
    expect(blockedRow.observation).toBe('A measurement of 200mm was recorded in relation to the party wall.');
    expect(blockedRow.quality_reviewed).toBe(false);
    expect(blockedRow.quality_skip_reason).toBe('unresolved fidelity block');
  });

  it('a section where every row is blocked never calls the model at all', async () => {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const draft = draftWith([{ row_id: 'row-a', observation: 'x', element: 'e', source_item_ids: ['a'] }]);
    await runQualityAudit({}, { sessionId: 's1', draftResult: draft, blockedRowIds: ['row-a'], apiKey: 'k' });
    expect(called).toBe(false);
  });
});

describe('runQualityAudit — provenance lock: row_id and source_item_ids survive every edit unchanged', () => {
  it('an applied edit changes only observation text', async () => {
    mockModel({ 'Front Bedroom': { status: 'pass_with_edits', edits: [{ reference: 'row-a', original: 'The party wall was identified within the room.', revised: 'The party wall was inspected.', reason: 'removed weak/robotic phrasing' }], issues_for_upstream_review: [] } });
    const draft = draftWith([{ row_id: 'row-a', observation: 'The party wall was identified within the room.', element: 'party wall', source_item_ids: ['c-2-1', 'c-2-2'] }]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    const row = result.sections[0].rows[0];
    expect(row.row_id).toBe('row-a');
    expect(row.source_item_ids).toEqual(['c-2-1', 'c-2-2']);
    expect(row.observation).toBe('The party wall was inspected.');
  });

  it('ignores an edit whose reference does not match any row genuinely offered to that call', async () => {
    mockModel({ 'Front Bedroom': { status: 'pass_with_edits', edits: [{ reference: 'row-hallucinated', original: 'x', revised: 'y', reason: 'z' }], issues_for_upstream_review: [] } });
    const draft = draftWith([{ row_id: 'row-a', observation: 'Original text.', element: 'e', source_item_ids: ['a'] }]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.sections[0].rows[0].observation).toBe('Original text.');
  });
});

describe('runQualityAudit — row count preserved 1:1, no merge primitive (test 5: distinct observations)', () => {
  it('two distinct rows on the same element remain two separate rows after review', async () => {
    mockModel({ 'Front Bedroom': { status: 'pass', edits: [], issues_for_upstream_review: [] } });
    const draft = draftWith([
      { row_id: 'row-crack-1', observation: 'A crack of 300mm was noted to the party wall.', element: 'party wall', source_item_ids: ['c1'] },
      { row_id: 'row-crack-2', observation: 'A separate crack of 150mm was noted to the party wall.', element: 'party wall', source_item_ids: ['c2'] },
    ]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.sections[0].rows.length).toBe(2);
    expect(result.sections[0].rows.map(r => r.row_id)).toEqual(['row-crack-1', 'row-crack-2']);
  });
});

describe('runQualityAudit — test 13: good-draft baseline left alone', () => {
  it('a row the model reports as already acceptable (status: pass, no edits) is returned unchanged', async () => {
    mockModel({ 'Front Bedroom': { status: 'pass', edits: [], issues_for_upstream_review: [] } });
    const draft = draftWith([{ row_id: 'row-a', observation: 'A hairline crack extends approximately 450mm diagonally upward from the corner of the party wall.', element: 'party wall', source_item_ids: ['a'] }]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.sections[0].rows[0].observation).toBe('A hairline crack extends approximately 450mm diagonally upward from the corner of the party wall.');
    expect(result.sections[0].rows[0].quality_reviewed).toBe(true);
  });

  it('does not record an audit-trail entry when the model returns the same text as an "edit"', async () => {
    const text = 'Already fine.';
    mockModel({ 'Front Bedroom': { status: 'pass_with_edits', edits: [{ reference: 'row-a', original: text, revised: text, reason: 'no actual change' }], issues_for_upstream_review: [] } });
    const draft = draftWith([{ row_id: 'row-a', observation: text, element: 'e', source_item_ids: ['a'] }]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.quality_audit_trail.length).toBe(0);
  });
});

describe('runQualityAudit — audit trail and issues for upstream review', () => {
  it('records original, reason, and revised wording for every applied edit', async () => {
    mockModel({ 'Front Bedroom': { status: 'pass_with_edits', edits: [{ reference: 'row-a', original: 'Old text.', revised: 'New text.', reason: 'clarity' }], issues_for_upstream_review: [] } });
    const draft = draftWith([{ row_id: 'row-a', observation: 'Old text.', element: 'e', source_item_ids: ['a'] }]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.quality_audit_trail).toEqual([{ row_id: 'row-a', section_id: 'sec-front', original: 'Old text.', reason: 'clarity', revised: 'New text.' }]);
  });

  it('surfaces an upstream-review issue for a row the model declined to edit due to factual doubt (test: awkward measurement, no invention)', async () => {
    mockModel({ 'Front Bedroom': { status: 'upstream_review_required', edits: [], issues_for_upstream_review: [{ reference: 'row-a', issue: 'Cannot determine what the 200mm measurement describes without inventing a defect type.' }] } });
    const draft = draftWith([{ row_id: 'row-a', observation: 'A measurement of 200mm was recorded in relation to the party wall.', element: 'party wall', source_item_ids: ['c-14-1'] }]);
    const result = await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    // Row is untouched - the model declined to invent a fact rather than improve prose.
    expect(result.sections[0].rows[0].observation).toBe('A measurement of 200mm was recorded in relation to the party wall.');
    expect(result.issues_for_upstream_review.length).toBe(1);
    expect(result.issues_for_upstream_review[0].issue).not.toContain('crack'); // did not invent a defect type to justify itself
  });
});

describe('runQualityAudit — model/configuration', () => {
  it('uses gpt-5.6-terra with its established invocation pattern', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"pass","edits":[],"issues_for_upstream_review":[]}' } }] }) };
    };
    const draft = draftWith([{ row_id: 'row-a', observation: 'x', element: 'e', source_item_ids: ['a'] }]);
    await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(capturedBody.model).toBe('gpt-5.6-terra');
    expect(capturedBody.messages[0].role).toBe('developer');
    expect(capturedBody.max_completion_tokens).toBeDefined();
  });

  it('falls back to gpt-4o if Terra fails', async () => {
    const models = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      models.push(body.model);
      if (body.model === 'gpt-5.6-terra') return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"pass","edits":[],"issues_for_upstream_review":[]}' } }] }) };
    };
    const draft = draftWith([{ row_id: 'row-a', observation: 'x', element: 'e', source_item_ids: ['a'] }]);
    await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(models).toEqual(['gpt-5.6-terra', 'gpt-4o']);
  });
});

describe('runQualityAudit — User Brain integration', () => {
  it('includes stated style preferences in the system content sent to the model', async () => {
    let capturedSystem = '';
    global.fetch = async (url, opts) => {
      capturedSystem = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"pass","edits":[],"issues_for_upstream_review":[]}' } }] }) };
    };
    const draft = draftWith([{ row_id: 'row-a', observation: 'x', element: 'e', source_item_ids: ['a'] }]);
    await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k', userBrain: { soc_style_preferences: 'Prefer short, direct sentences.' } });
    expect(capturedSystem).toContain('Prefer short, direct sentences.');
  });

  it('falls back to the governing User Brain text alone when no per-user preferences exist', async () => {
    let capturedSystem = '';
    global.fetch = async (url, opts) => {
      capturedSystem = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"pass","edits":[],"issues_for_upstream_review":[]}' } }] }) };
    };
    const draft = draftWith([{ row_id: 'row-a', observation: 'x', element: 'e', source_item_ids: ['a'] }]);
    await runQualityAudit({}, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(capturedSystem).toContain('Nora User SOC Brain');
  });
});
