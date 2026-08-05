import { describe, it, expect } from 'vitest';
import { validateBriefShape } from '../stage1-schema.js';
import { minimalValidBrief } from './fixtures.js';

describe('stage1-schema: structural validation', () => {
  it('accepts a well-formed minimal brief', () => {
    const result = validateBriefShape(minimalValidBrief());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.brief).not.toBeNull();
  });

  it('rejects a non-object payload', () => {
    const result = validateBriefShape('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('(root)');
  });

  it('rejects a brief missing a required top-level field', () => {
    const brief = minimalValidBrief();
    delete brief.user_objective;
    const result = validateBriefShape(brief);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'user_objective')).toBe(true);
  });

  it('rejects an invalid enum value', () => {
    const brief = minimalValidBrief();
    brief.tone_register = 'sarcastic';
    const result = validateBriefShape(brief);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'tone_register')).toBe(true);
  });

  describe('controlling-fact validation', () => {
    it('accepts an established fact with supporting evidence', () => {
      const brief = minimalValidBrief();
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(true);
    });

    it('accepts a disputed fact with both supporting and opposing evidence', () => {
      const brief = minimalValidBrief();
      brief.controlling_facts.push({
        fact_id: 'fact_02',
        fact: 'The boundary line is disputed.',
        status: 'disputed',
        supporting_evidence: [{ source_id: 'email_0001', excerpt: 'we served notice on 1 June' }],
        opposing_evidence: [{ source_id: 'email_0002', excerpt: 'I have appointed a surveyor to act for me' }],
        inference_basis_ids: [],
      });
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(true);
    });

    it('rejects a fact with an invalid status', () => {
      const brief = minimalValidBrief();
      brief.controlling_facts[0].status = 'probably';
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'controlling_facts[0].status')).toBe(true);
    });
  });

  describe('inferred-fact dependency requirements (hard rule)', () => {
    it('rejects an inferred fact with no inference_basis_ids', () => {
      const brief = minimalValidBrief();
      brief.controlling_facts.push({
        fact_id: 'fact_03',
        fact: 'The works are likely to affect the party structure.',
        status: 'inferred',
        supporting_evidence: [],
        opposing_evidence: [],
        inference_basis_ids: [],
      });
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'controlling_facts[1].inference_basis_ids')).toBe(true);
    });

    it('accepts an inferred fact with a populated, resolvable inference_basis_ids', () => {
      const brief = minimalValidBrief();
      brief.controlling_facts.push({
        fact_id: 'fact_03',
        fact: 'The works are likely to affect the party structure.',
        status: 'inferred',
        supporting_evidence: [],
        opposing_evidence: [],
        inference_basis_ids: ['fact_01'],
      });
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(true);
    });
  });

  describe('stable argument and finding ID references', () => {
    it('rejects a candidate_arguments.required_finding_ids reference to a non-existent finding', () => {
      const brief = minimalValidBrief();
      brief.candidate_arguments[0].required_finding_ids = ['change_99'];
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('unknown finding id "change_99"'))).toBe(true);
    });

    it('rejects argument_ranking referencing an unknown argument_id', () => {
      const brief = minimalValidBrief();
      brief.argument_ranking = ['arg_99'];
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'argument_ranking[0]')).toBe(true);
    });

    it('rejects decisive_issue.argument_id referencing an unknown argument', () => {
      const brief = minimalValidBrief();
      brief.decisive_issue = {
        exists: true,
        argument_id: 'arg_99',
        core_reason: 'because',
        reinforcements: [],
        counterfactual_test: 'test',
        counterfactual_expected_answer: 'yes',
        required_dependency_ids: ['change_01'],
        supporting_dependency_ids: [],
        confidence: 'high',
      };
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('unknown argument_id "arg_99"'))).toBe(true);
    });

    it('rejects a reinforcement finding_ids entry referencing an unknown finding', () => {
      const brief = minimalValidBrief();
      brief.candidate_arguments[0].reinforcements = [
        { reinforcement_id: 'r_01', finding_ids: ['concession_99'], statement: 'x' },
      ];
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('unknown finding id "concession_99"'))).toBe(true);
    });

    it('rejects duplicate finding ids used across two different findings', () => {
      const brief = minimalValidBrief();
      brief.material_changes.push({
        change_id: 'fact_01', // duplicate of the controlling_fact's id
        change: 'Something else changed.',
        source_id: 'email_0002',
        excerpt: 'I have appointed a surveyor to act for me',
        strategic_effect: 'x',
      });
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('duplicate finding id "fact_01"'))).toBe(true);
    });

    it('rejects recommended_strategy_required_finding_ids referencing an unknown finding', () => {
      const brief = minimalValidBrief();
      brief.recommended_strategy_required_finding_ids = ['change_404'];
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'recommended_strategy_required_finding_ids')).toBe(true);
    });
  });

  describe('decisive_issue structural guard against invented decisive issues', () => {
    it('rejects decisive_issue.exists=false with a non-null argument_id', () => {
      const brief = minimalValidBrief();
      brief.decisive_issue.exists = false;
      brief.decisive_issue.argument_id = 'arg_01';
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'decisive_issue.argument_id')).toBe(true);
    });

    it('rejects decisive_issue.exists=true with an empty required_dependency_ids', () => {
      const brief = minimalValidBrief();
      brief.decisive_issue = {
        exists: true,
        argument_id: 'arg_01',
        core_reason: 'because',
        reinforcements: [],
        counterfactual_test: 'test',
        counterfactual_expected_answer: 'yes',
        required_dependency_ids: [],
        supporting_dependency_ids: [],
        confidence: 'high',
      };
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'decisive_issue.required_dependency_ids')).toBe(true);
    });
  });

  describe('prompt-compliance flag (non-fatal)', () => {
    it('flags but does not fail a core_argument containing reinforcement-like acceptance language', () => {
      const brief = minimalValidBrief();
      brief.candidate_arguments[0].core_argument = 'The opposing side expressly accepts that responsibility rests with the contractor.';
      const result = validateBriefShape(brief);
      expect(result.valid).toBe(true);
      expect(result.promptComplianceFlags.length).toBeGreaterThan(0);
      expect(result.promptComplianceFlags[0].path).toBe('candidate_arguments[0].core_argument');
    });
  });
});
