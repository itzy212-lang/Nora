import { describe, it, expect } from 'vitest';
import { applyDependencyValidation } from '../stage1-dependency-graph.js';
import { minimalValidBrief, minimalSourceIdMap } from './fixtures.js';

describe('stage1-dependency-graph: baseline', () => {
  it('validates a fully consistent minimal brief with no removals', () => {
    const result = applyDependencyValidation(minimalValidBrief(), minimalSourceIdMap());
    expect(result.valid).toBe(true);
    expect(result.removedReinforcements).toEqual([]);
    expect(result.removedFindings).toEqual([]);
    expect(result.removedArguments).toEqual([]);
  });
});

describe('stage1-dependency-graph: required dependency propagation', () => {
  it('invalidates the whole brief when the top-ranked argument loses its required finding', () => {
    const brief = minimalValidBrief();
    const sourceIdMap = minimalSourceIdMap();
    // Corrupt the excerpt so change_01 no longer verifies.
    sourceIdMap.email_0002 = 'This text no longer contains the claimed appointment wording.';
    const result = applyDependencyValidation(brief, sourceIdMap);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.invalidationReason).toMatch(/top-ranked argument/);
  });

  it('propagates required-dependency failure through an inferred fact chain', () => {
    const brief = minimalValidBrief();
    brief.controlling_facts.push({
      fact_id: 'fact_02',
      fact: 'The works will likely require excavation near the boundary.',
      status: 'inferred',
      supporting_evidence: [],
      opposing_evidence: [],
      inference_basis_ids: ['fact_01'],
    });
    brief.candidate_arguments[0].required_finding_ids = ['fact_02'];

    const sourceIdMap = minimalSourceIdMap();
    // fact_01's own supporting excerpt no longer verifies -> fact_02 (inferred
    // from fact_01) must also become invalid, transitively.
    sourceIdMap.email_0001 = 'A completely unrelated message with no notice wording.';

    const result = applyDependencyValidation(brief, sourceIdMap);
    expect(result.valid).toBe(false);
    expect(result.invalidationReason).toMatch(/top-ranked argument/);
  });

  it('invalidates the whole brief when a top-ranked-only recommended_strategy_required_finding_ids entry fails', () => {
    const brief = minimalValidBrief();
    brief.recommended_strategy_required_finding_ids = ['change_01'];
    const sourceIdMap = minimalSourceIdMap();
    sourceIdMap.email_0002 = 'No appointment wording here at all.';
    const result = applyDependencyValidation(brief, sourceIdMap);
    expect(result.valid).toBe(false);
  });
});

describe('stage1-dependency-graph: reinforcement-only removal (no free-text editing)', () => {
  function briefWithReinforcement() {
    const brief = minimalValidBrief();
    brief.controlling_facts.push({
      fact_id: 'fact_02',
      fact: 'A secondary, non-essential supporting fact.',
      status: 'established',
      supporting_evidence: [{ source_id: 'email_0001', excerpt: 'we served notice on 1 June' }],
      opposing_evidence: [],
      inference_basis_ids: [],
    });
    brief.candidate_arguments[0].reinforcements = [
      { reinforcement_id: 'reinforcement_01', finding_ids: ['fact_02'], statement: 'A secondary reinforcing point.' },
    ];
    return brief;
  }

  it('removes only the reinforcement object when its finding fails, and leaves core_argument byte-for-byte unchanged', () => {
    const brief = briefWithReinforcement();
    const originalCoreArgument = brief.candidate_arguments[0].core_argument;
    const sourceIdMap = minimalSourceIdMap();
    // Break fact_02's supporting excerpt only — change_01 (required) still verifies.
    const brokenMap = { ...sourceIdMap, email_0001: 'This text has been changed and no longer supports fact_02.' };

    const result = applyDependencyValidation(brief, brokenMap);

    expect(result.valid).toBe(true);
    expect(result.removedReinforcements).toEqual([{ owner: 'arg_01', reinforcement_id: 'reinforcement_01' }]);
    expect(result.brief.candidate_arguments[0].reinforcements).toEqual([]);
    // The critical assertion: core_argument text is untouched, character for character.
    expect(result.brief.candidate_arguments[0].core_argument).toBe(originalCoreArgument);
  });

  it('retains the reinforcement when its finding remains valid', () => {
    const brief = briefWithReinforcement();
    const result = applyDependencyValidation(brief, minimalSourceIdMap());
    expect(result.valid).toBe(true);
    expect(result.removedReinforcements).toEqual([]);
    expect(result.brief.candidate_arguments[0].reinforcements).toHaveLength(1);
  });
});

describe('stage1-dependency-graph: secondary (non-top-ranked, non-decisive) argument removal', () => {
  it('removes a secondary argument whose own required finding fails, without invalidating the whole brief', () => {
    const brief = minimalValidBrief();
    brief.material_changes.push({
      change_id: 'change_02',
      change: 'A secondary, weaker change in circumstances.',
      source_id: 'email_0002',
      excerpt: 'this exact phrase is not present anywhere',
      strategic_effect: 'minor',
    });
    brief.candidate_arguments.push({
      argument_id: 'arg_02',
      core_argument: 'A weaker, secondary argument.',
      required_finding_ids: ['change_02'],
      reinforcements: [],
      strength: 'weak',
      limitations: 'Secondary only.',
    });
    // arg_01 remains top-ranked; arg_02 is not referenced by decisive_issue or the ranking's first slot.
    brief.argument_ranking = ['arg_01', 'arg_02'];

    const result = applyDependencyValidation(brief, minimalSourceIdMap());

    expect(result.valid).toBe(true);
    expect(result.removedArguments).toEqual(['arg_02']);
    expect(result.brief.candidate_arguments.map((a) => a.argument_id)).toEqual(['arg_01']);
    expect(result.brief.argument_ranking).toEqual(['arg_01']);
  });
});

describe('stage1-dependency-graph: whole-brief invalidation', () => {
  it('invalidates the whole brief when decisive_issue exists and its required_dependency_ids fail', () => {
    const brief = minimalValidBrief();
    brief.decisive_issue = {
      exists: true,
      argument_id: 'arg_01',
      core_reason: 'because',
      reinforcements: [],
      counterfactual_test: 'test',
      counterfactual_expected_answer: 'yes',
      required_dependency_ids: ['change_01'],
      supporting_dependency_ids: [],
      confidence: 'high',
    };
    const sourceIdMap = minimalSourceIdMap();
    sourceIdMap.email_0002 = 'no appointment wording present';
    const result = applyDependencyValidation(brief, sourceIdMap);
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
  });

  it('does not silently reset decisive_issue.exists to false on required-dependency failure — it invalidates the whole brief instead', () => {
    const brief = minimalValidBrief();
    brief.decisive_issue = {
      exists: true,
      argument_id: 'arg_01',
      core_reason: 'because',
      reinforcements: [],
      counterfactual_test: 'test',
      counterfactual_expected_answer: 'yes',
      required_dependency_ids: ['change_01'],
      supporting_dependency_ids: [],
      confidence: 'high',
    };
    const sourceIdMap = minimalSourceIdMap();
    sourceIdMap.email_0002 = 'no appointment wording present';
    const result = applyDependencyValidation(brief, sourceIdMap);
    // The whole result must be invalid — there must be no "partially kept"
    // brief with decisive_issue quietly downgraded.
    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
  });
});

describe('stage1-dependency-graph: Tier 2 informational pruning (no cascade)', () => {
  it('drops a chronology entry whose excerpt fails, without affecting overall validity', () => {
    const brief = minimalValidBrief();
    brief.chronology.push({ source_id: 'email_0002', date: 'x', event: 'y', excerpt: 'nonexistent phrase' });
    const result = applyDependencyValidation(brief, minimalSourceIdMap());
    expect(result.valid).toBe(true);
    expect(result.brief.chronology).toHaveLength(1);
  });
});
