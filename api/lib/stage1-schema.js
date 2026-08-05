// api/lib/stage1-schema.js
//
// Structural/shape validation of a Stage 1 strategic-analysis brief against
// IMPLEMENTATION_READY_STAGE1_SCHEMA.md.
//
// PHASE 1 STATUS: this module is not imported anywhere in api/ely-smart.js
// and is not reachable from any production request path. It exists only to
// be unit-tested in isolation ahead of Phase 2 wiring.
//
// This module performs SHAPE and REFERENTIAL-INTEGRITY checks only:
//   - required fields present, correct primitive/array/object types
//   - enum fields hold an allowed value
//   - stable ID fields (fact_id, change_id, concession_id, position_change_id,
//     commitment_id, contradiction_id, argument_id) are present and unique
//   - every cross-reference (required_finding_ids, reinforcements[].finding_ids,
//     argument_ranking, decisive_issue.argument_id, required_dependency_ids,
//     supporting_dependency_ids, recommended_strategy_required_finding_ids,
//     recommended_argument_order) resolves to a finding/argument that actually
//     exists in the brief
//   - the hard rule: an inferred controlling_fact must have a non-empty
//     inference_basis_ids array
//
// It does NOT verify excerpts against source text (api/lib/stage1-evidence.js)
// and does NOT apply dependency-tier validation outcomes (api/lib/stage1-dependency-graph.js).

const CONTROLLING_FACT_STATUSES = ['established', 'disputed', 'inferred'];
const CONCESSION_CLASSIFICATIONS = ['concession', 'admission'];
const COMMITMENT_STATUSES = ['fulfilled', 'outstanding', 'withdrawn', 'unclear'];
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
const ARGUMENT_STRENGTHS = ['strong', 'moderate', 'weak'];
const TONE_REGISTERS = ['formal', 'professional-conversational', 'warm', 'firm'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isString(v) {
  return typeof v === 'string';
}

function isArray(v) {
  return Array.isArray(v);
}

function isBoolean(v) {
  return typeof v === 'boolean';
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pushError(errors, path, message) {
  errors.push({ path, message });
}

function validateEvidencePair(entry, path, errors, { sourceField = 'source_id', excerptField = 'excerpt' } = {}) {
  if (!isNonEmptyString(entry?.[sourceField])) {
    pushError(errors, `${path}.${sourceField}`, 'must be a non-empty string');
  }
  if (!isNonEmptyString(entry?.[excerptField])) {
    pushError(errors, `${path}.${excerptField}`, 'must be a non-empty string');
  }
}

function validateChronology(chronology, errors) {
  if (!isArray(chronology)) {
    pushError(errors, 'chronology', 'must be an array');
    return;
  }
  chronology.forEach((entry, i) => {
    const path = `chronology[${i}]`;
    validateEvidencePair(entry, path, errors);
    if (!isString(entry?.date)) pushError(errors, `${path}.date`, 'must be a string');
    if (!isNonEmptyString(entry?.event)) pushError(errors, `${path}.event`, 'must be a non-empty string');
  });
}

function validateControllingFacts(facts, errors, idRegistry) {
  if (!isArray(facts)) {
    pushError(errors, 'controlling_facts', 'must be an array');
    return;
  }
  facts.forEach((fact, i) => {
    const path = `controlling_facts[${i}]`;
    if (!isNonEmptyString(fact?.fact_id)) {
      pushError(errors, `${path}.fact_id`, 'must be a non-empty string');
    } else {
      idRegistry.registerFinding(fact.fact_id, path);
    }
    if (!isNonEmptyString(fact?.fact)) pushError(errors, `${path}.fact`, 'must be a non-empty string');
    if (!CONTROLLING_FACT_STATUSES.includes(fact?.status)) {
      pushError(errors, `${path}.status`, `must be one of ${CONTROLLING_FACT_STATUSES.join(', ')}`);
    }

    const supporting = fact?.supporting_evidence;
    const opposing = fact?.opposing_evidence;
    if (!isArray(supporting)) pushError(errors, `${path}.supporting_evidence`, 'must be an array');
    else supporting.forEach((ev, j) => validateEvidencePair(ev, `${path}.supporting_evidence[${j}]`, errors));

    if (opposing !== undefined && opposing !== null) {
      if (!isArray(opposing)) pushError(errors, `${path}.opposing_evidence`, 'must be an array when present');
      else opposing.forEach((ev, j) => validateEvidencePair(ev, `${path}.opposing_evidence[${j}]`, errors));
    }

    const basis = fact?.inference_basis_ids;
    if (fact?.status === 'inferred') {
      // HARD RULE: no inferred fact may exist without a non-empty basis.
      if (!isArray(basis) || basis.length === 0) {
        pushError(errors, `${path}.inference_basis_ids`, 'must be a non-empty array when status is "inferred"');
      }
    } else if (basis !== undefined && basis !== null && !isArray(basis)) {
      pushError(errors, `${path}.inference_basis_ids`, 'must be an array when present');
    }
  });
}

function validateMaterialChanges(changes, errors, idRegistry) {
  if (!isArray(changes)) {
    pushError(errors, 'material_changes', 'must be an array');
    return;
  }
  changes.forEach((c, i) => {
    const path = `material_changes[${i}]`;
    if (!isNonEmptyString(c?.change_id)) pushError(errors, `${path}.change_id`, 'must be a non-empty string');
    else idRegistry.registerFinding(c.change_id, path);
    if (!isNonEmptyString(c?.change)) pushError(errors, `${path}.change`, 'must be a non-empty string');
    validateEvidencePair(c, path, errors);
    if (!isNonEmptyString(c?.strategic_effect)) pushError(errors, `${path}.strategic_effect`, 'must be a non-empty string');
  });
}

function validateUserEmphasisedPoints(points, errors) {
  if (!isArray(points)) {
    pushError(errors, 'user_emphasised_points', 'must be an array');
    return;
  }
  points.forEach((p, i) => {
    const path = `user_emphasised_points[${i}]`;
    if (!isNonEmptyString(p?.point)) pushError(errors, `${path}.point`, 'must be a non-empty string');
    validateEvidencePair(p, path, errors);
    if (!isBoolean(p?.should_control_response)) pushError(errors, `${path}.should_control_response`, 'must be a boolean');
  });
}

function validateConcessions(list, errors, idRegistry) {
  if (!isArray(list)) {
    pushError(errors, 'express_concessions_and_admissions', 'must be an array');
    return;
  }
  list.forEach((c, i) => {
    const path = `express_concessions_and_admissions[${i}]`;
    if (!isNonEmptyString(c?.concession_id)) pushError(errors, `${path}.concession_id`, 'must be a non-empty string');
    else idRegistry.registerFinding(c.concession_id, path);
    if (!isNonEmptyString(c?.party)) pushError(errors, `${path}.party`, 'must be a non-empty string');
    validateEvidencePair(c, path, errors);
    if (!CONCESSION_CLASSIFICATIONS.includes(c?.classification)) {
      pushError(errors, `${path}.classification`, `must be one of ${CONCESSION_CLASSIFICATIONS.join(', ')}`);
    }
  });
}

function validateImpliedChanges(list, errors, idRegistry) {
  if (!isArray(list)) {
    pushError(errors, 'implied_changes_of_position', 'must be an array');
    return;
  }
  list.forEach((c, i) => {
    const path = `implied_changes_of_position[${i}]`;
    if (!isNonEmptyString(c?.position_change_id)) pushError(errors, `${path}.position_change_id`, 'must be a non-empty string');
    else idRegistry.registerFinding(c.position_change_id, path);
    if (!isNonEmptyString(c?.description)) pushError(errors, `${path}.description`, 'must be a non-empty string');
    validateEvidencePair(c, path, errors, { sourceField: 'earlier_source_id', excerptField: 'earlier_excerpt' });
    validateEvidencePair(c, path, errors, { sourceField: 'later_source_id', excerptField: 'later_excerpt' });
    if (!CONFIDENCE_LEVELS.includes(c?.confidence)) {
      pushError(errors, `${path}.confidence`, `must be one of ${CONFIDENCE_LEVELS.join(', ')}`);
    }
  });
}

function validatePriorCommitments(list, errors, idRegistry) {
  if (!isArray(list)) {
    pushError(errors, 'prior_commitments', 'must be an array');
    return;
  }
  list.forEach((c, i) => {
    const path = `prior_commitments[${i}]`;
    if (!isNonEmptyString(c?.commitment_id)) pushError(errors, `${path}.commitment_id`, 'must be a non-empty string');
    else idRegistry.registerFinding(c.commitment_id, path);
    if (!isNonEmptyString(c?.party)) pushError(errors, `${path}.party`, 'must be a non-empty string');
    validateEvidencePair(c, path, errors);
    if (!COMMITMENT_STATUSES.includes(c?.status)) {
      pushError(errors, `${path}.status`, `must be one of ${COMMITMENT_STATUSES.join(', ')}`);
    }
    if (!isNonEmptyString(c?.strategic_effect)) pushError(errors, `${path}.strategic_effect`, 'must be a non-empty string');
  });
}

function validateContradictions(list, errors) {
  if (!isArray(list)) {
    pushError(errors, 'contradictions', 'must be an array');
    return;
  }
  list.forEach((c, i) => {
    const path = `contradictions[${i}]`;
    if (!isNonEmptyString(c?.contradiction_id)) pushError(errors, `${path}.contradiction_id`, 'must be a non-empty string');
    if (!isNonEmptyString(c?.description)) pushError(errors, `${path}.description`, 'must be a non-empty string');
    validateEvidencePair(c, path, errors, { sourceField: 'source_a_id', excerptField: 'source_a_excerpt' });
    validateEvidencePair(c, path, errors, { sourceField: 'source_b_id', excerptField: 'source_b_excerpt' });
  });
}

function validateReinforcements(reinforcements, path, errors, idRegistry, refChecks) {
  if (reinforcements === undefined) return; // optional-but-recommended array
  if (!isArray(reinforcements)) {
    pushError(errors, path, 'must be an array when present');
    return;
  }
  reinforcements.forEach((r, i) => {
    const rPath = `${path}[${i}]`;
    if (!isNonEmptyString(r?.reinforcement_id)) pushError(errors, `${rPath}.reinforcement_id`, 'must be a non-empty string');
    if (!isArray(r?.finding_ids) || r.finding_ids.length === 0) {
      pushError(errors, `${rPath}.finding_ids`, 'must be a non-empty array');
    } else {
      r.finding_ids.forEach((fid) => refChecks.push({ id: fid, path: `${rPath}.finding_ids` }));
    }
    if (!isNonEmptyString(r?.statement)) pushError(errors, `${rPath}.statement`, 'must be a non-empty string');
  });
}

function containsReinforcementLikeLanguage(coreText) {
  // Heuristic only, used for prompt-compliance review, NOT a validation
  // failure — per IMPLEMENTATION_READY_OLIVIA_TEST.md this is flagged for
  // human review, not auto-rejected by the schema validator.
  if (!isNonEmptyString(coreText)) return false;
  return /\bexpressly (accept|admit|concede|acknowledge)/i.test(coreText)
    || /\b(accepts|admits|concedes|acknowledges) (that|responsibility)/i.test(coreText);
}

function validateCandidateArguments(list, errors, idRegistry, refChecks) {
  if (!isArray(list)) {
    pushError(errors, 'candidate_arguments', 'must be an array');
    return { promptComplianceFlags: [] };
  }
  const promptComplianceFlags = [];
  list.forEach((arg, i) => {
    const path = `candidate_arguments[${i}]`;
    if (!isNonEmptyString(arg?.argument_id)) {
      pushError(errors, `${path}.argument_id`, 'must be a non-empty string');
    } else {
      idRegistry.registerArgument(arg.argument_id, path);
    }
    if (!isNonEmptyString(arg?.core_argument)) {
      pushError(errors, `${path}.core_argument`, 'must be a non-empty string');
    } else if (containsReinforcementLikeLanguage(arg.core_argument)) {
      promptComplianceFlags.push({ path: `${path}.core_argument`, note: 'contains language resembling a reinforcement-only claim (opposing-side acceptance) — review against reinforcements[] per IMPLEMENTATION_READY schema; not treated as a hard validation failure' });
    }
    if (!isArray(arg?.required_finding_ids)) {
      pushError(errors, `${path}.required_finding_ids`, 'must be an array');
    } else {
      arg.required_finding_ids.forEach((fid) => refChecks.push({ id: fid, path: `${path}.required_finding_ids` }));
    }
    validateReinforcements(arg?.reinforcements, `${path}.reinforcements`, errors, idRegistry, refChecks);
    if (!ARGUMENT_STRENGTHS.includes(arg?.strength)) {
      pushError(errors, `${path}.strength`, `must be one of ${ARGUMENT_STRENGTHS.join(', ')}`);
    }
    if (!isString(arg?.limitations)) pushError(errors, `${path}.limitations`, 'must be a string');
  });
  return { promptComplianceFlags };
}

function validateDecisiveIssue(issue, errors, idRegistry, refChecks) {
  const path = 'decisive_issue';
  if (!isPlainObject(issue)) {
    pushError(errors, path, 'must be an object');
    return { promptComplianceFlags: [] };
  }
  if (!isBoolean(issue.exists)) {
    pushError(errors, `${path}.exists`, 'must be a boolean');
    return { promptComplianceFlags: [] };
  }

  const promptComplianceFlags = [];

  if (issue.exists === false) {
    // When no decisive issue exists, the other decisive_issue fields should
    // be null — this is the structural guard against inventing a decisive
    // issue where none exists.
    ['argument_id', 'core_reason', 'counterfactual_test', 'counterfactual_expected_answer'].forEach((f) => {
      if (issue[f] !== null && issue[f] !== undefined) {
        pushError(errors, `${path}.${f}`, 'must be null when decisive_issue.exists is false');
      }
    });
    if (isArray(issue.required_dependency_ids) && issue.required_dependency_ids.length > 0) {
      pushError(errors, `${path}.required_dependency_ids`, 'must be empty when decisive_issue.exists is false');
    }
    return { promptComplianceFlags };
  }

  // exists === true
  if (!isNonEmptyString(issue.argument_id)) {
    pushError(errors, `${path}.argument_id`, 'must be a non-empty string when exists is true');
  } else {
    refChecks.push({ id: issue.argument_id, path: `${path}.argument_id`, mustBeArgument: true });
  }
  if (!isNonEmptyString(issue.core_reason)) {
    pushError(errors, `${path}.core_reason`, 'must be a non-empty string when exists is true');
  } else if (containsReinforcementLikeLanguage(issue.core_reason)) {
    promptComplianceFlags.push({ path: `${path}.core_reason`, note: 'contains language resembling a reinforcement-only claim (opposing-side acceptance) — review against reinforcements[]; not treated as a hard validation failure' });
  }
  if (!isNonEmptyString(issue.counterfactual_test)) {
    pushError(errors, `${path}.counterfactual_test`, 'must be a non-empty string when exists is true');
  }
  if (!isNonEmptyString(issue.counterfactual_expected_answer)) {
    pushError(errors, `${path}.counterfactual_expected_answer`, 'must be a non-empty string when exists is true');
  }
  if (!isArray(issue.required_dependency_ids) || issue.required_dependency_ids.length === 0) {
    pushError(errors, `${path}.required_dependency_ids`, 'must be a non-empty array when exists is true');
  } else {
    issue.required_dependency_ids.forEach((fid) => refChecks.push({ id: fid, path: `${path}.required_dependency_ids` }));
  }
  if (issue.supporting_dependency_ids !== undefined) {
    if (!isArray(issue.supporting_dependency_ids)) {
      pushError(errors, `${path}.supporting_dependency_ids`, 'must be an array when present');
    } else {
      issue.supporting_dependency_ids.forEach((fid) => refChecks.push({ id: fid, path: `${path}.supporting_dependency_ids` }));
    }
  }
  validateReinforcements(issue.reinforcements, `${path}.reinforcements`, errors, idRegistry, refChecks);
  if (!CONFIDENCE_LEVELS.includes(issue.confidence)) {
    pushError(errors, `${path}.confidence`, `must be one of ${CONFIDENCE_LEVELS.join(', ')}`);
  }

  return { promptComplianceFlags };
}

function makeIdRegistry() {
  const findingIds = new Map(); // id -> [paths]
  const argumentIds = new Map();
  return {
    registerFinding(id, path) {
      if (!findingIds.has(id)) findingIds.set(id, []);
      findingIds.get(id).push(path);
    },
    registerArgument(id, path) {
      if (!argumentIds.has(id)) argumentIds.set(id, []);
      argumentIds.get(id).push(path);
    },
    findingIds,
    argumentIds,
  };
}

function checkDuplicateIds(idRegistry, errors) {
  for (const [id, paths] of idRegistry.findingIds.entries()) {
    if (paths.length > 1) {
      pushError(errors, paths.join(', '), `duplicate finding id "${id}" used in more than one finding`);
    }
  }
  for (const [id, paths] of idRegistry.argumentIds.entries()) {
    if (paths.length > 1) {
      pushError(errors, paths.join(', '), `duplicate argument id "${id}" used in more than one argument`);
    }
  }
}

function resolveRefChecks(refChecks, idRegistry, errors) {
  refChecks.forEach(({ id, path, mustBeArgument }) => {
    if (!isNonEmptyString(id)) {
      pushError(errors, path, 'referenced id must be a non-empty string');
      return;
    }
    const isKnownFinding = idRegistry.findingIds.has(id);
    const isKnownArgument = idRegistry.argumentIds.has(id);
    if (mustBeArgument) {
      if (!isKnownArgument) pushError(errors, path, `references unknown argument_id "${id}"`);
      return;
    }
    if (!isKnownFinding) {
      pushError(errors, path, `references unknown finding id "${id}"`);
    }
  });
}

function validateArgumentRanking(brief, errors, idRegistry) {
  if (!isArray(brief.argument_ranking)) {
    pushError(errors, 'argument_ranking', 'must be an array');
    return;
  }
  brief.argument_ranking.forEach((id, i) => {
    if (!idRegistry.argumentIds.has(id)) {
      pushError(errors, `argument_ranking[${i}]`, `references unknown argument_id "${id}"`);
    }
  });
  if (isArray(brief.recommended_argument_order)) {
    brief.recommended_argument_order.forEach((id, i) => {
      if (!idRegistry.argumentIds.has(id)) {
        pushError(errors, `recommended_argument_order[${i}]`, `references unknown argument_id "${id}"`);
      }
    });
  } else {
    pushError(errors, 'recommended_argument_order', 'must be an array');
  }
}

function validateRequiresClarification(rc, errors) {
  const path = 'requires_clarification';
  if (!isPlainObject(rc)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isBoolean(rc.needed)) pushError(errors, `${path}.needed`, 'must be a boolean');
  if (!isArray(rc.material_gaps)) pushError(errors, `${path}.material_gaps`, 'must be an array');
  if (rc.needed === true && !isNonEmptyString(rc.clarification_question)) {
    pushError(errors, `${path}.clarification_question`, 'must be a non-empty string when needed is true');
  }
}

/**
 * Validate the structural shape of a raw Stage 1 brief (as parsed from the
 * model's JSON response) against IMPLEMENTATION_READY_STAGE1_SCHEMA.md.
 *
 * Does NOT verify excerpts against source text — see stage1-evidence.js.
 * Does NOT apply dependency-tier outcomes — see stage1-dependency-graph.js.
 *
 * @param {object} rawJson
 * @returns {{ valid: boolean, errors: Array<{path:string,message:string}>, promptComplianceFlags: Array, brief: object|null }}
 */
export function validateBriefShape(rawJson) {
  const errors = [];
  const refChecks = [];

  if (!isPlainObject(rawJson)) {
    return { valid: false, errors: [{ path: '(root)', message: 'brief must be a JSON object' }], promptComplianceFlags: [], brief: null };
  }

  const idRegistry = makeIdRegistry();

  if (!isNonEmptyString(rawJson.user_objective)) pushError(errors, 'user_objective', 'must be a non-empty string');
  if (!isNonEmptyString(rawJson.real_problem_to_solve)) pushError(errors, 'real_problem_to_solve', 'must be a non-empty string');
  if (!isString(rawJson.original_factual_premise)) pushError(errors, 'original_factual_premise', 'must be a string');

  validateChronology(rawJson.chronology, errors);
  validateControllingFacts(rawJson.controlling_facts, errors, idRegistry);
  validateMaterialChanges(rawJson.material_changes, errors, idRegistry);
  validateUserEmphasisedPoints(rawJson.user_emphasised_points, errors);
  validateConcessions(rawJson.express_concessions_and_admissions, errors, idRegistry);
  validateImpliedChanges(rawJson.implied_changes_of_position, errors, idRegistry);
  validatePriorCommitments(rawJson.prior_commitments, errors, idRegistry);
  validateContradictions(rawJson.contradictions, errors);

  const argResult = validateCandidateArguments(rawJson.candidate_arguments, errors, idRegistry, refChecks);
  const decisiveResult = validateDecisiveIssue(rawJson.decisive_issue, errors, idRegistry, refChecks);

  checkDuplicateIds(idRegistry, errors);
  validateArgumentRanking(rawJson, errors, idRegistry);

  if (!isNonEmptyString(rawJson.strongest_counterargument)) pushError(errors, 'strongest_counterargument', 'must be a non-empty string');
  if (!isArray(rawJson.residual_issues)) pushError(errors, 'residual_issues', 'must be an array');
  if (!isArray(rawJson.overstatement_risks)) pushError(errors, 'overstatement_risks', 'must be an array');
  if (!isArray(rawJson.evidence_references)) {
    pushError(errors, 'evidence_references', 'must be an array');
  } else {
    rawJson.evidence_references.forEach((ref, i) => {
      const path = `evidence_references[${i}]`;
      validateEvidencePair(ref, path, errors);
      if (!isNonEmptyString(ref?.used_for)) pushError(errors, `${path}.used_for`, 'must be a non-empty string');
    });
  }
  if (!isNonEmptyString(rawJson.recommended_response_strategy)) pushError(errors, 'recommended_response_strategy', 'must be a non-empty string');
  if (!isArray(rawJson.recommended_strategy_required_finding_ids)) {
    pushError(errors, 'recommended_strategy_required_finding_ids', 'must be an array');
  } else {
    rawJson.recommended_strategy_required_finding_ids.forEach((fid) => refChecks.push({ id: fid, path: 'recommended_strategy_required_finding_ids' }));
  }

  validateRequiresClarification(rawJson.requires_clarification, errors);

  if (!TONE_REGISTERS.includes(rawJson.tone_register)) {
    pushError(errors, 'tone_register', `must be one of ${TONE_REGISTERS.join(', ')}`);
  }
  if (!isPlainObject(rawJson.user_terminology_to_preserve)) pushError(errors, 'user_terminology_to_preserve', 'must be an object');
  if (!isArray(rawJson.must_include)) pushError(errors, 'must_include', 'must be an array');
  if (!isArray(rawJson.do_not_include)) pushError(errors, 'do_not_include', 'must be an array');
  if (!CONFIDENCE_LEVELS.includes(rawJson.analysis_confidence)) {
    pushError(errors, 'analysis_confidence', `must be one of ${CONFIDENCE_LEVELS.join(', ')}`);
  }
  if (!isArray(rawJson.analysis_gaps)) pushError(errors, 'analysis_gaps', 'must be an array');

  // Resolve every accumulated cross-reference (required_finding_ids,
  // reinforcements[].finding_ids, decisive_issue.argument_id,
  // required_dependency_ids, supporting_dependency_ids,
  // recommended_strategy_required_finding_ids) now that every field above
  // has had a chance to register into refChecks. Deliberately done once,
  // at the end, after all registration and all refChecks.push calls.
  resolveRefChecks(refChecks, idRegistry, errors);

  const promptComplianceFlags = [...argResult.promptComplianceFlags, ...decisiveResult.promptComplianceFlags];

  return {
    valid: errors.length === 0,
    errors,
    promptComplianceFlags,
    brief: errors.length === 0 ? rawJson : null,
  };
}

export const __internal = {
  CONTROLLING_FACT_STATUSES,
  CONCESSION_CLASSIFICATIONS,
  COMMITMENT_STATUSES,
  CONFIDENCE_LEVELS,
  ARGUMENT_STRENGTHS,
  TONE_REGISTERS,
};
