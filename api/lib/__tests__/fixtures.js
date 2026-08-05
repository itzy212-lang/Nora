// Shared fixtures for Phase 1 unit tests. Not imported by any production
// code — test-only.

export function minimalValidBrief() {
  return {
    user_objective: 'Confirm the adjoining owner will not dissent to the notice.',
    real_problem_to_solve: 'The adjoining owner has raised concerns about access.',
    original_factual_premise: 'Notice was served on 1 June.',
    chronology: [
      { source_id: 'email_0001', date: '1 June 2026', event: 'Notice served', excerpt: 'we served notice on 1 June' },
    ],
    controlling_facts: [
      {
        fact_id: 'fact_01',
        fact: 'Notice was validly served on 1 June 2026.',
        status: 'established',
        supporting_evidence: [{ source_id: 'email_0001', excerpt: 'we served notice on 1 June' }],
        opposing_evidence: [],
        inference_basis_ids: [],
      },
    ],
    material_changes: [
      {
        change_id: 'change_01',
        change: 'The adjoining owner appointed a surveyor.',
        source_id: 'email_0002',
        excerpt: 'I have appointed a surveyor to act for me',
        strategic_effect: 'A dispute is deemed to have arisen under section 10.',
      },
    ],
    user_emphasised_points: [],
    express_concessions_and_admissions: [],
    implied_changes_of_position: [],
    prior_commitments: [],
    contradictions: [],
    candidate_arguments: [
      {
        argument_id: 'arg_01',
        core_argument: 'A dispute has arisen and the section 10 procedure now applies.',
        required_finding_ids: ['change_01'],
        reinforcements: [],
        strength: 'strong',
        limitations: 'None identified.',
      },
    ],
    argument_ranking: ['arg_01'],
    decisive_issue: {
      exists: false,
      argument_id: null,
      core_reason: null,
      reinforcements: [],
      counterfactual_test: null,
      counterfactual_expected_answer: null,
      required_dependency_ids: [],
      supporting_dependency_ids: [],
      confidence: null,
    },
    strongest_counterargument: 'The adjoining owner may argue the works are not notifiable.',
    residual_issues: ['Fee liability remains to be agreed.'],
    overstatement_risks: ['Do not assert the works are definitely notifiable without confirming scope.'],
    evidence_references: [{ source_id: 'email_0002', excerpt: 'I have appointed a surveyor to act for me', used_for: 'material_changes[0]' }],
    recommended_argument_order: ['arg_01'],
    recommended_response_strategy: 'Acknowledge the appointment and propose a first meeting of surveyors.',
    recommended_strategy_required_finding_ids: ['change_01'],
    requires_clarification: { needed: false, material_gaps: [], clarification_question: null },
    tone_register: 'professional-conversational',
    user_terminology_to_preserve: {},
    must_include: [],
    do_not_include: [],
    analysis_confidence: 'high',
    analysis_gaps: [],
  };
}

export function minimalSourceIdMap() {
  return {
    email_0001: 'Dear Sir, we served notice on 1 June regarding the excavation works. Kind regards.',
    email_0002: 'Thank you. I have appointed a surveyor to act for me in this matter.',
  };
}

/**
 * The Olivia acceptance-test fixture, per IMPLEMENTATION_READY_OLIVIA_TEST.md.
 * required dependency: change_01 (Caroline appoints her own contractor).
 * supporting-only dependency: concession_01 (Olivia's acceptance).
 */
export function oliviaBrief() {
  return {
    user_objective: 'Respond to Olivia regarding responsibility for the remedial works.',
    real_problem_to_solve: 'Whether the Building Owner remains responsible for design and execution of the remedial works.',
    original_factual_premise: 'The Building Owner originally undertook to complete the Section A works including remedial repair.',
    chronology: [
      { source_id: 'email_0001', date: '10 July 2026', event: 'Caroline confirms she has appointed her own contractor', excerpt: 'Caroline has appointed her own contractor to carry out the remedial works' },
      { source_id: 'email_0002', date: '12 July 2026', event: "Olivia's side accepts the reallocation of responsibility", excerpt: 'we accept that responsibility for the design and execution of those works now rests with her contractor' },
    ],
    controlling_facts: [],
    material_changes: [
      {
        change_id: 'change_01',
        change: "Caroline appoints her own contractor to design and carry out the remedial works.",
        source_id: 'email_0001',
        excerpt: 'Caroline has appointed her own contractor to carry out the remedial works',
        strategic_effect: 'Design and execution responsibility for the remedial works moves away from the Building Owner.',
      },
    ],
    user_emphasised_points: [],
    express_concessions_and_admissions: [
      {
        concession_id: 'concession_01',
        party: "Olivia's side",
        source_id: 'email_0002',
        excerpt: 'we accept that responsibility for the design and execution of those works now rests with her contractor',
        classification: 'concession',
      },
    ],
    implied_changes_of_position: [],
    prior_commitments: [],
    contradictions: [],
    candidate_arguments: [
      {
        argument_id: 'arg_01',
        core_argument: "Caroline's contractor will design and carry out the remedial works, so the Building Owner's original Section A design obligation, workmanship warranty and responsibility for defects in those new remedial works no longer fit the arrangement.",
        required_finding_ids: ['change_01'],
        reinforcements: [
          {
            reinforcement_id: 'reinforcement_01',
            finding_ids: ['concession_01'],
            statement: "Olivia's side expressly accepts that design and execution responsibility rests with Caroline's contractor.",
          },
        ],
        strength: 'strong',
        limitations: 'Historic damage liability may remain a separate issue.',
      },
    ],
    argument_ranking: ['arg_01'],
    decisive_issue: {
      exists: true,
      argument_id: 'arg_01',
      core_reason: 'Because the contractor now bears design and execution responsibility, the original Section A detail, workmanship warranty and future defect responsibility no longer fit the proposed arrangement.',
      reinforcements: [
        {
          reinforcement_id: 'reinforcement_02',
          finding_ids: ['concession_01'],
          statement: "Olivia's side has expressly acknowledged this reallocation of responsibility.",
        },
      ],
      counterfactual_test: 'If Caroline\'s contractor were not carrying out the works and the Building Owner remained responsible for design and execution, would the Section A detail, warranties and original agreement remain relevant?',
      counterfactual_expected_answer: 'Yes — the Section A detail and warranties would remain directly relevant, which confirms it is the contractor appointment that has changed their relevance, not that they were always irrelevant.',
      required_dependency_ids: ['change_01'],
      supporting_dependency_ids: ['concession_01'],
      confidence: 'high',
    },
    strongest_counterargument: 'The opposing side may argue historic damage predates the contractor appointment and remains the Building Owner\'s responsibility.',
    residual_issues: ['Historic damage liability may remain live notwithstanding the contractor change.'],
    overstatement_risks: ['Do not claim the contractor change extinguishes every historic liability.'],
    evidence_references: [
      { source_id: 'email_0001', excerpt: 'Caroline has appointed her own contractor to carry out the remedial works', used_for: 'material_changes[0]' },
    ],
    recommended_argument_order: ['arg_01'],
    recommended_response_strategy: 'Propose a defined remedial scope and a reasonable quotation rather than assuming no further action is needed.',
    recommended_strategy_required_finding_ids: ['change_01'],
    requires_clarification: { needed: false, material_gaps: [], clarification_question: null },
    tone_register: 'professional-conversational',
    user_terminology_to_preserve: {},
    must_include: [],
    do_not_include: [],
    analysis_confidence: 'high',
    analysis_gaps: [],
  };
}

export function oliviaSourceIdMap() {
  return {
    email_0001: 'Hi, just to update you — Caroline has appointed her own contractor to carry out the remedial works. He starts on site next week.',
    email_0002: 'Thanks for letting us know. On that basis we accept that responsibility for the design and execution of those works now rests with her contractor.',
  };
}
