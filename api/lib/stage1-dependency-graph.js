// api/lib/stage1-dependency-graph.js
//
// Dependency-graph construction and required-vs-reinforcement validation
// outcomes, per IMPLEMENTATION_READY_DEPENDENCY_MODEL.md.
//
// PHASE 1 STATUS: not imported anywhere in api/ely-smart.js, not reachable
// from any production request path.
//
// This module NEVER edits free-text fields (core_argument, core_reason). It
// only ever (a) verifies an excerpt exists verbatim in its source, or (b)
// removes a whole, schema-defined object (a reinforcements entry, a
// candidate_arguments entry, or the whole brief).

import { verifyExcerpt } from './stage1-evidence.js';

function findingArrays(brief) {
  return [
    { list: brief.controlling_facts || [], idField: 'fact_id', kind: 'controlling_fact' },
    { list: brief.material_changes || [], idField: 'change_id', kind: 'material_change' },
    { list: brief.express_concessions_and_admissions || [], idField: 'concession_id', kind: 'concession' },
    { list: brief.implied_changes_of_position || [], idField: 'position_change_id', kind: 'position_change' },
    { list: brief.prior_commitments || [], idField: 'commitment_id', kind: 'commitment' },
  ];
}

function findFindingById(brief, id) {
  for (const { list, idField, kind } of findingArrays(brief)) {
    const record = list.find((item) => item[idField] === id);
    if (record) return { record, kind };
  }
  return null;
}

/**
 * Evaluate the validity of a single finding (by its stable id), recursively
 * resolving "inferred" controlling_facts through their inference_basis_ids.
 * Memoises results in `cache` and guards against reference cycles.
 */
function evaluateFindingValidity(brief, id, sourceIdMap, cache, visiting = new Set()) {
  if (cache.has(id)) return cache.get(id);
  if (visiting.has(id)) {
    // Cycle in inference_basis_ids — treat as invalid rather than looping.
    cache.set(id, false);
    return false;
  }

  const found = findFindingById(brief, id);
  if (!found) {
    // Reference to an id that doesn't exist — schema validation should have
    // already caught this, but this module fails safe rather than throwing.
    cache.set(id, false);
    return false;
  }

  visiting.add(id);
  let valid;
  const { record, kind } = found;

  if (kind === 'controlling_fact' && record.status === 'inferred') {
    const basis = record.inference_basis_ids || [];
    valid = basis.length > 0 && basis.every((basisId) =>
      evaluateFindingValidity(brief, basisId, sourceIdMap, cache, visiting));
  } else if (kind === 'controlling_fact') {
    // established or disputed: needs >=1 verified supporting_evidence entry.
    valid = (record.supporting_evidence || []).some((ev) =>
      verifyExcerpt(ev.excerpt, ev.source_id, sourceIdMap));
  } else if (kind === 'position_change') {
    valid = verifyExcerpt(record.earlier_excerpt, record.earlier_source_id, sourceIdMap)
      && verifyExcerpt(record.later_excerpt, record.later_source_id, sourceIdMap);
  } else {
    // material_change, concession, commitment: single source_id/excerpt pair.
    valid = verifyExcerpt(record.excerpt, record.source_id, sourceIdMap);
  }

  visiting.delete(id);
  cache.set(id, valid);
  return valid;
}

function allValid(ids, brief, sourceIdMap, cache) {
  return (ids || []).every((id) => evaluateFindingValidity(brief, id, sourceIdMap, cache));
}

function pruneReinforcements(reinforcements, brief, sourceIdMap, cache) {
  const surviving = [];
  const removed = [];
  (reinforcements || []).forEach((r) => {
    if (allValid(r.finding_ids, brief, sourceIdMap, cache)) {
      surviving.push(r);
    } else {
      removed.push(r);
    }
  });
  return { surviving, removed };
}

function flattenFindingIds(reinforcements) {
  const ids = new Set();
  (reinforcements || []).forEach((r) => (r.finding_ids || []).forEach((id) => ids.add(id)));
  return Array.from(ids);
}

/**
 * Apply dependency-aware evidence validation to a structurally-valid Stage 1
 * brief. Returns either a (possibly narrowed) valid brief or an invalidation
 * result — never a brief with a conclusion whose required evidence failed.
 *
 * @param {object} brief - structurally valid brief (post stage1-schema.js)
 * @param {Record<string,string>} sourceIdMap - source_id -> raw source text
 * @returns {{
 *   valid: boolean,
 *   brief: object|null,
 *   invalidationReason: string|null,
 *   removedReinforcements: Array<{ owner: string, reinforcement_id: string }>,
 *   removedFindings: Array<{ kind: string, id: string }>,
 *   removedArguments: Array<string>,
 * }}
 */
export function applyDependencyValidation(brief, sourceIdMap) {
  const cache = new Map();
  const removedReinforcements = [];
  const removedFindings = [];
  const removedArguments = [];

  const argumentsById = new Map((brief.candidate_arguments || []).map((a) => [a.argument_id, a]));
  const topRankedId = (brief.argument_ranking || [])[0] || null;
  const topRankedArg = topRankedId ? argumentsById.get(topRankedId) : null;

  // ── Whole-brief invalidation checks ────────────────────────────────────

  if (topRankedId && !topRankedArg) {
    return { valid: false, brief: null, invalidationReason: `argument_ranking[0] references unknown argument_id "${topRankedId}"`, removedReinforcements, removedFindings, removedArguments };
  }

  if (topRankedArg && !allValid(topRankedArg.required_finding_ids, brief, sourceIdMap, cache)) {
    return { valid: false, brief: null, invalidationReason: `top-ranked argument "${topRankedId}" lost required evidence`, removedReinforcements, removedFindings, removedArguments };
  }

  const decisive = brief.decisive_issue;
  if (decisive && decisive.exists) {
    const decisiveArg = argumentsById.get(decisive.argument_id);
    if (!decisiveArg) {
      return { valid: false, brief: null, invalidationReason: `decisive_issue.argument_id "${decisive.argument_id}" does not resolve to a candidate argument`, removedReinforcements, removedFindings, removedArguments };
    }
    if (!allValid(decisiveArg.required_finding_ids, brief, sourceIdMap, cache)) {
      return { valid: false, brief: null, invalidationReason: `decisive_issue's argument "${decisive.argument_id}" lost required evidence`, removedReinforcements, removedFindings, removedArguments };
    }
    if (!allValid(decisive.required_dependency_ids, brief, sourceIdMap, cache)) {
      return { valid: false, brief: null, invalidationReason: 'decisive_issue lost required evidence in its own required_dependency_ids', removedReinforcements, removedFindings, removedArguments };
    }
  }

  if (!allValid(brief.recommended_strategy_required_finding_ids, brief, sourceIdMap, cache)) {
    return { valid: false, brief: null, invalidationReason: 'recommended_response_strategy lost required evidence', removedReinforcements, removedFindings, removedArguments };
  }

  // ── Narrowing (Tier 2 / reinforcement-only failures) ───────────────────

  const narrowed = JSON.parse(JSON.stringify(brief)); // structural clone; only whole objects are ever removed below

  // Prune non-top-ranked, non-decisive arguments whose own required findings failed.
  const decisiveArgId = decisive && decisive.exists ? decisive.argument_id : null;
  narrowed.candidate_arguments = (narrowed.candidate_arguments || []).filter((arg) => {
    const isProtected = arg.argument_id === topRankedId || arg.argument_id === decisiveArgId;
    if (isProtected) return true;
    const ok = allValid(arg.required_finding_ids, brief, sourceIdMap, cache);
    if (!ok) removedArguments.push(arg.argument_id);
    return ok;
  });
  const survivingArgIds = new Set(narrowed.candidate_arguments.map((a) => a.argument_id));
  narrowed.argument_ranking = (narrowed.argument_ranking || []).filter((id) => survivingArgIds.has(id));
  narrowed.recommended_argument_order = (narrowed.recommended_argument_order || []).filter((id) => survivingArgIds.has(id));

  // Prune reinforcements on every surviving argument.
  narrowed.candidate_arguments.forEach((arg) => {
    const { surviving, removed } = pruneReinforcements(arg.reinforcements, brief, sourceIdMap, cache);
    removed.forEach((r) => removedReinforcements.push({ owner: arg.argument_id, reinforcement_id: r.reinforcement_id }));
    arg.reinforcements = surviving;
  });

  // Prune reinforcements on decisive_issue, keep supporting_dependency_ids in sync.
  if (narrowed.decisive_issue && narrowed.decisive_issue.exists) {
    const { surviving, removed } = pruneReinforcements(narrowed.decisive_issue.reinforcements, brief, sourceIdMap, cache);
    removed.forEach((r) => removedReinforcements.push({ owner: 'decisive_issue', reinforcement_id: r.reinforcement_id }));
    narrowed.decisive_issue.reinforcements = surviving;
    narrowed.decisive_issue.supporting_dependency_ids = flattenFindingIds(surviving);
  }

  // Drop top-level finding entries that failed their own validity check —
  // they are no longer asserted in the validated brief, whether or not
  // anything referenced them.
  findingArrays(narrowed).forEach(({ list, idField, kind }) => {
    const kept = list.filter((item) => {
      const ok = evaluateFindingValidity(brief, item[idField], sourceIdMap, cache);
      if (!ok) removedFindings.push({ kind, id: item[idField] });
      return ok;
    });
    if (kind === 'controlling_fact') narrowed.controlling_facts = kept;
    else if (kind === 'material_change') narrowed.material_changes = kept;
    else if (kind === 'concession') narrowed.express_concessions_and_admissions = kept;
    else if (kind === 'position_change') narrowed.implied_changes_of_position = kept;
    else if (kind === 'commitment') narrowed.prior_commitments = kept;
  });

  // Drop non-dependency-graph informational entries whose own excerpts fail
  // (Tier 2, no cascade): chronology, contradictions, evidence_references,
  // user_emphasised_points.
  narrowed.chronology = (narrowed.chronology || []).filter((e) => verifyExcerpt(e.excerpt, e.source_id, sourceIdMap));
  narrowed.contradictions = (narrowed.contradictions || []).filter((c) =>
    verifyExcerpt(c.source_a_excerpt, c.source_a_id, sourceIdMap) && verifyExcerpt(c.source_b_excerpt, c.source_b_id, sourceIdMap));
  narrowed.evidence_references = (narrowed.evidence_references || []).filter((r) => verifyExcerpt(r.excerpt, r.source_id, sourceIdMap));
  narrowed.user_emphasised_points = (narrowed.user_emphasised_points || []).filter((p) => verifyExcerpt(p.excerpt, p.source_id, sourceIdMap));

  return {
    valid: true,
    brief: narrowed,
    invalidationReason: null,
    removedReinforcements,
    removedFindings,
    removedArguments,
  };
}
