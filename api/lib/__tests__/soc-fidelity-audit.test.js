// api/lib/__tests__/soc-fidelity-audit.test.js
//
// Phase D4 — regression tests for the Fidelity Audit. All fixtures
// here are synthetic, built for these tests only — nothing touches
// production inspection evidence. Deterministic checks (completeness,
// supersession, section order/assignment, measurement presence,
// duplicate consumption) are tested directly, calling the real
// functions against controlled, deliberately-corrupted synthetic
// drafts. AI-dependent checks (invention, diagnosis, spatial
// relationship, lost detail, contextual/synthesis distortion) are
// tested against a mocked model response, since this sandbox has no
// network path to the live model — the deterministic tests are the
// ones proving actual detection logic; the AI-path tests prove the
// plumbing (correct evidence reaches the model, findings flow through
// correctly) rather than genuine model judgment, which was separately
// verified live (see the D4 report).

import { describe, it, expect } from 'vitest';
import { runFidelityAudit, applyRepairs } from '../soc-brain-v2/fidelity-audit.js';

const FB = 'sec-front';
const RB = 'sec-rear';

function makeSupabase({ sections }) {
  return {
    from: (table) => {
      if (table === 'ai_messages') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
      if (table === 'soc_sections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: sections, error: null }) }) }) };
      if (table === 'soc_claims') return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function mockModel(findingsPerSection = {}) {
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const userMsg = body.messages[1].content;
    const sectionName = /SECTION: (.+)/.exec(userMsg)?.[1];
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ findings: findingsPerSection[sectionName] || [] }) } }] }) };
  };
}

const authoritativeSections = [
  { id: FB, first_entered_sequence: 1 },
  { id: RB, first_entered_sequence: 6 },
];

function baseReconciliationItems() {
  return [
    { id: 'c-2-1', section_id: FB, section_name: 'Front Bedroom', element: 'party wall', resolved_content: 'party wall, plaster and emulsion finish', disposition: 'active_evidence', status: 'active', draftable: true, raw_provenance: [{ raw_fragment: 'The party wall has a plaster and emulsion finish' }] },
    { id: 'c-5-1', section_id: FB, section_name: 'Front Bedroom', element: 'party wall', resolved_content: 'party wall, hairline crack, 450mm, diagonally up, corner', disposition: 'active_evidence', status: 'active', draftable: true, raw_provenance: [{ raw_fragment: "Actually, that's 450, not 650." }] },
    { id: 'c-4-1', section_id: FB, section_name: 'Front Bedroom', element: 'party wall', resolved_content: 'party wall, hairline crack, 650mm, diagonally up, corner', disposition: 'superseded', status: 'superseded', superseded_by: 'c-5-1', draftable: false, raw_provenance: [{ raw_fragment: 'hairline crack, about 650mm' }] },
    { id: 'c-3-1', section_id: FB, section_name: 'Front Bedroom', element: 'window', resolved_content: 'window, opened and closed satisfactorily, no sticking or binding', disposition: 'active_evidence', status: 'active', draftable: true, raw_provenance: [{ raw_fragment: 'The window opened and closed satisfactorily, no sticking or binding' }] },
    { id: 'c-8-1', section_id: RB, section_name: 'Rear Bedroom', element: 'party wall', resolved_content: 'party wall, crack, 300mm, vertical', disposition: 'active_evidence', status: 'active', draftable: true, raw_provenance: [{ raw_fragment: 'a crack, roughly 300 millimetres, running vertically' }] },
    { id: 'c-9-1', section_id: RB, section_name: 'Rear Bedroom', element: 'party wall', resolved_content: 'party wall, staining, just above the crack', disposition: 'active_evidence', status: 'active', draftable: true, raw_provenance: [{ raw_fragment: "there's also some staining just above it" }] },
  ];
}

function baseCorrectDraft() {
  return {
    reconciliation_items: baseReconciliationItems(),
    sections: [
      { section_id: FB, section_name: 'Front Bedroom', rows: [
        { row_id: 'row-c-2-1', observation: 'The party wall has a plaster and emulsion finish.', element: 'party wall', source_item_ids: ['c-2-1'] },
        { row_id: 'row-c-5-1', observation: 'A hairline crack extends approximately 450mm diagonally upward from the corner of the party wall.', element: 'party wall', source_item_ids: ['c-5-1'] },
        { row_id: 'row-c-3-1', observation: 'The window was tested and operated satisfactorily without sticking or binding.', element: 'window', source_item_ids: ['c-3-1'] },
      ] },
      { section_id: RB, section_name: 'Rear Bedroom', rows: [
        { row_id: 'row-c-8-1_c-9-1', observation: 'A vertical crack of approximately 300mm was noted to the party wall, with staining immediately above it.', element: 'party wall', source_item_ids: ['c-8-1', 'c-9-1'] },
      ] },
    ],
  };
}

describe('runFidelityAudit — a genuinely correct draft produces no findings', () => {
  it('passes with zero findings when nothing is wrong', async () => {
    mockModel({});
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });
});

describe('runFidelityAudit — deterministic detection (tests 1, 2, 4, 13, 14, and wrong-section)', () => {
  it('[1] 450mm deliberately changed to 650mm in the drafted text is caught as altered_measurement', async () => {
    mockModel({});
    const draft = baseCorrectDraft();
    draft.sections[0].rows[1].observation = 'A hairline crack extends approximately 650mm diagonally upward from the corner of the party wall.';
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'altered_measurement' && f.source_item_ids.includes('c-5-1'))).toBe(true);
  });

  it('[2] the superseded 650mm fact deliberately inserted as an active row is caught as superseded_fact_resurrected', async () => {
    mockModel({});
    const draft = baseCorrectDraft();
    draft.sections[0].rows.push({ observation: 'A hairline crack of 650mm was noted.', element: 'party wall', source_item_ids: ['c-4-1'] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'superseded_fact_resurrected' && f.source_item_ids.includes('c-4-1'))).toBe(true);
  });

  it('[3] a Front Bedroom item deliberately drafted under Rear Bedroom is caught as wrong_section', async () => {
    mockModel({});
    const draft = baseCorrectDraft();
    // c-5-1 belongs to Front Bedroom but is cited from a Rear Bedroom row.
    draft.sections[1].rows.push({ observation: 'A hairline crack of 450mm was noted to the party wall.', element: 'party wall', source_item_ids: ['c-5-1'] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'wrong_section' && f.source_item_ids.includes('c-5-1'))).toBe(true);
  });

  it('[4] an active supported observation removed entirely is caught as omitted_evidence', async () => {
    mockModel({});
    const draft = baseCorrectDraft();
    draft.sections[0].rows = draft.sections[0].rows.filter(r => !r.source_item_ids.includes('c-3-1'));
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'omitted_evidence' && f.source_item_ids.includes('c-3-1'))).toBe(true);
  });

  it('[13] the same evidence cited by two separate rows without justification is caught as duplicated_observation', async () => {
    mockModel({});
    const draft = baseCorrectDraft();
    draft.sections[0].rows.push({ observation: 'The party wall is plastered and painted.', element: 'party wall', source_item_ids: ['c-2-1'] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'duplicated_observation' && f.source_item_ids.includes('c-2-1'))).toBe(true);
  });

  it('[14] a changed section first-visit order is caught as section_order_violation', async () => {
    mockModel({});
    const draft = baseCorrectDraft();
    draft.sections.reverse(); // Rear Bedroom now drafted before Front Bedroom
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'section_order_violation')).toBe(true);
  });
});

describe('runFidelityAudit — AI-path plumbing for semantic findings (tests 5-12; genuine judgment verified live, see D4 report)', () => {
  it('[5] an unsupported defect/condition insertion, reported by the model, flows through as invented_fact', async () => {
    mockModel({ 'Front Bedroom': [{ severity: 'blocking', type: 'invented_fact', draft_row_id: 'sec-front#row1', source_item_ids: ['c-2-1'], draft_text: 'The party wall has a plaster and emulsion finish with visible mould.', evidence_summary: 'No mould was recorded in the evidence.', required_action: 'Remove the invented mould reference.', auto_repairable: false, proposed_repair: null }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
    expect(result.status).toBe('fail');
    expect(result.findings.some(f => f.type === 'invented_fact')).toBe(true);
  });

  it('[6] unsupported diagnosis/causation flows through as unsupported_diagnosis', async () => {
    mockModel({ 'Front Bedroom': [{ severity: 'blocking', type: 'unsupported_diagnosis', draft_row_id: 'sec-front#row2', source_item_ids: ['c-5-1'], draft_text: 'consistent with differential movement', evidence_summary: 'No cause was established by the surveyor.', required_action: 'Remove the causal diagnosis.', auto_repairable: true, proposed_repair: 'A hairline crack extends approximately 450mm diagonally upward from the corner of the party wall.' }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'unsupported_diagnosis' && f.auto_repairable)).toBe(true);
  });

  it('[7] a resolved clarification converted to [UNCLEAR] flows through as resolved_matter_marked_unresolved', async () => {
    mockModel({ 'Front Bedroom': [{ severity: 'blocking', type: 'resolved_matter_marked_unresolved', draft_row_id: 'sec-front#row2', source_item_ids: ['c-5-1'], draft_text: '[UNCLEAR: measurement axis not confirmed]', evidence_summary: 'This was resolved via clarification and is not genuinely unresolved.', required_action: 'Replace with the resolved fact.', auto_repairable: true, proposed_repair: 'A hairline crack extends approximately 450mm diagonally upward from the corner of the party wall.' }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'resolved_matter_marked_unresolved')).toBe(true);
  });

  it('[8] genuine unresolved evidence falsely stated as resolved fact flows through as unresolved_matter_falsely_resolved', async () => {
    const draft = baseCorrectDraft();
    draft.reconciliation_items.push({ id: 'c-99-1', section_id: FB, section_name: 'Front Bedroom', element: null, resolved_content: 'There is a defect on the wall, extent unclear', disposition: 'unresolved', status: 'active', draftable: false, raw_provenance: [{ raw_fragment: 'something about the wall, unclear' }] });
    draft.sections[0].rows.push({ observation: 'A defect was noted to the wall.', element: 'wall', source_item_ids: ['c-99-1'] });
    mockModel({ 'Front Bedroom': [{ severity: 'blocking', type: 'unresolved_matter_falsely_resolved', draft_row_id: 'sec-front#row4', source_item_ids: ['c-99-1'], draft_text: 'A defect was noted to the wall.', evidence_summary: 'This item is genuinely unresolved and must not be presented as a resolved fact.', required_action: 'Remove or clearly flag as unresolved.', auto_repairable: false, proposed_repair: null }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'unresolved_matter_falsely_resolved')).toBe(true);
  });

  it('[9] a measurement attached to the wrong one of two defects flows through as synthesis_distortion', async () => {
    mockModel({ 'Front Bedroom': [{ severity: 'blocking', type: 'synthesis_distortion', draft_row_id: 'sec-front#row2', source_item_ids: ['c-5-1'], draft_text: 'ambiguous combined sentence', evidence_summary: 'The 450mm measurement could be misread as belonging to a different defect in this combined row.', required_action: 'Separate into distinct rows or make attribution unambiguous.', auto_repairable: false, proposed_repair: null }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'synthesis_distortion')).toBe(true);
  });

  it('[10] a removed/changed "above the crack" spatial relationship flows through as lost_spatial_relationship', async () => {
    const draft = baseCorrectDraft();
    draft.sections[1].rows[0].observation = 'A vertical crack of approximately 300mm was noted to the party wall. Staining was also noted.';
    mockModel({ 'Rear Bedroom': [{ severity: 'material', type: 'lost_spatial_relationship', draft_row_id: 'sec-rear#row1', source_item_ids: ['c-9-1'], draft_text: draft.sections[1].rows[0].observation, evidence_summary: 'The evidence states the staining is immediately above the crack; this spatial relationship is lost.', required_action: 'Restate the spatial relationship.', auto_repairable: true, proposed_repair: 'A vertical crack of approximately 300mm was noted to the party wall, with staining immediately above it.' }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'lost_spatial_relationship' && f.auto_repairable)).toBe(true);
  });

  it('[11] an omitted window operational result flows through as lost_operational_result', async () => {
    const draft = baseCorrectDraft();
    draft.sections[0].rows[2].observation = 'The window was tested.';
    mockModel({ 'Front Bedroom': [{ severity: 'material', type: 'lost_operational_result', draft_row_id: 'sec-front#row3', source_item_ids: ['c-3-1'], draft_text: 'The window was tested.', evidence_summary: 'The evidence states the result was satisfactory with no sticking or binding; the result itself is missing.', required_action: 'State the operational result.', auto_repairable: true, proposed_repair: 'The window was tested and operated satisfactorily without sticking or binding.' }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'lost_operational_result')).toBe(true);
  });

  it('[12] an omitted finish/condition flows through as lost_condition_or_finish', async () => {
    const draft = baseCorrectDraft();
    draft.sections[0].rows[0].observation = 'A party wall is present.';
    mockModel({ 'Front Bedroom': [{ severity: 'material', type: 'lost_condition_or_finish', draft_row_id: 'sec-front#row1', source_item_ids: ['c-2-1'], draft_text: 'A party wall is present.', evidence_summary: 'The evidence states a plaster and emulsion finish; this is missing entirely.', required_action: 'State the finish.', auto_repairable: true, proposed_repair: 'The party wall has a plaster and emulsion finish.' }] });
    const supabase = makeSupabase({ sections: authoritativeSections });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult: draft, apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'lost_condition_or_finish')).toBe(true);
  });
});

describe('applyRepairs — targeted, evidence-bound, provenance-preserving', () => {
  it('applies only auto_repairable findings, leaving unrelated rows untouched', () => {
    const draft = baseCorrectDraft();
    const findings = [
      { auto_repairable: true, proposed_repair: 'The party wall has a plaster and emulsion finish, in generally good condition.', draft_row_id: 'row-c-2-1', type: 'lost_condition_or_finish', severity: 'material', evidence_summary: 'x' },
    ];
    const { repairedDraft, auditTrail } = applyRepairs(draft, findings);
    expect(repairedDraft.sections[0].rows[0].observation).toContain('generally good condition');
    // Unrelated rows untouched.
    expect(repairedDraft.sections[0].rows[1].observation).toBe(draft.sections[0].rows[1].observation);
    expect(repairedDraft.sections[1].rows[0].observation).toBe(draft.sections[1].rows[0].observation);
    expect(auditTrail.length).toBe(1);
    expect(auditTrail[0].original_row).toBe('The party wall has a plaster and emulsion finish.');
  });

  it('never changes source_item_ids on a repaired row — provenance survives exactly', () => {
    const draft = baseCorrectDraft();
    const originalIds = [...draft.sections[1].rows[0].source_item_ids];
    const findings = [
      { auto_repairable: true, proposed_repair: 'A vertical crack of approximately 300mm was noted to the party wall, with staining immediately above it.', draft_row_id: 'row-c-8-1_c-9-1', type: 'lost_spatial_relationship', severity: 'material', evidence_summary: 'x' },
    ];
    const { repairedDraft } = applyRepairs(draft, findings);
    expect(repairedDraft.sections[1].rows[0].source_item_ids).toEqual(originalIds);
  });

  it('ignores a finding with no proposed_repair or not marked auto_repairable', () => {
    const draft = baseCorrectDraft();
    const findings = [
      { auto_repairable: false, proposed_repair: null, draft_row_id: 'row-c-2-1', type: 'wrong_section', severity: 'blocking', evidence_summary: 'x' },
    ];
    const { repairedDraft, auditTrail } = applyRepairs(draft, findings);
    expect(repairedDraft.sections[0].rows[0].observation).toBe(draft.sections[0].rows[0].observation);
    expect(auditTrail.length).toBe(0);
  });

  it('does not mutate the original draft object passed in', () => {
    const draft = baseCorrectDraft();
    const originalText = draft.sections[0].rows[0].observation;
    const findings = [
      { auto_repairable: true, proposed_repair: 'Different text entirely.', draft_row_id: 'row-c-2-1', type: 'invented_fact', severity: 'blocking', evidence_summary: 'x' },
    ];
    applyRepairs(draft, findings);
    expect(draft.sections[0].rows[0].observation).toBe(originalText);
  });
});

describe('runFidelityAudit — model/configuration', () => {
  it('uses gpt-5.6-terra with its established invocation pattern', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"findings":[]}' } }] }) };
    };
    const supabase = makeSupabase({ sections: authoritativeSections });
    await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
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
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"findings":[]}' } }] }) };
    };
    const supabase = makeSupabase({ sections: authoritativeSections });
    await runFidelityAudit(supabase, { sessionId: 's1', draftResult: baseCorrectDraft(), apiKey: 'k' });
    expect(models).toEqual(['gpt-5.6-terra', 'gpt-4o', 'gpt-5.6-terra', 'gpt-4o']);
  });
});
