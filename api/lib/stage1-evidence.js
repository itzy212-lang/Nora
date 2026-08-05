// api/lib/stage1-evidence.js
//
// Verbatim excerpt verification: confirms a claimed excerpt actually exists,
// allowing only whitespace/punctuation normalisation, within the source text
// registered under its source_id. This is a mechanical check — it never
// judges paraphrase quality, only literal presence.
//
// PHASE 1 STATUS: not imported anywhere in api/ely-smart.js, not reachable
// from any production request path.

/**
 * Normalise text for excerpt comparison: collapse whitespace, normalise
 * curly quotes/apostrophes/dashes to their plain equivalents, and lowercase.
 * This is deliberately narrow — it must not paper over a materially
 * different word or phrase, only superficial formatting differences.
 *
 * @param {string} text
 * @returns {string}
 */
export function normaliseForMatch(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes -> straight
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes -> straight
    .replace(/[\u2013\u2014]/g, '-')   // en/em dash -> hyphen
    .replace(/\s+/g, ' ')              // collapse all whitespace/newlines
    .trim()
    .toLowerCase();
}

/**
 * Verify a claimed excerpt exists verbatim (after normalisation) within the
 * text registered under sourceId in sourceIdMap.
 *
 * @param {string} excerpt
 * @param {string} sourceId
 * @param {Record<string,string>} sourceIdMap
 * @returns {boolean}
 */
export function verifyExcerpt(excerpt, sourceId, sourceIdMap) {
  if (typeof excerpt !== 'string' || excerpt.trim().length === 0) return false;
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) return false;
  if (!sourceIdMap || typeof sourceIdMap !== 'object') return false;

  const sourceText = sourceIdMap[sourceId];
  if (typeof sourceText !== 'string' || sourceText.length === 0) return false;

  const normalisedExcerpt = normaliseForMatch(excerpt);
  const normalisedSource = normaliseForMatch(sourceText);
  if (normalisedExcerpt.length === 0) return false;

  return normalisedSource.includes(normalisedExcerpt);
}

/**
 * Walk every evidence-bearing field in a structurally-valid Stage 1 brief
 * (per stage1-schema.js) and verify each excerpt against sourceIdMap.
 * Returns a flat diagnostic report — used for logging and for tests, not
 * itself a dependency-validation outcome (see stage1-dependency-graph.js).
 *
 * @param {object} brief
 * @param {Record<string,string>} sourceIdMap
 * @returns {{ total: number, passed: number, failed: number, details: Array }}
 */
export function verifyAllExcerpts(brief, sourceIdMap) {
  const details = [];

  function check(path, sourceId, excerpt) {
    const valid = verifyExcerpt(excerpt, sourceId, sourceIdMap);
    details.push({ path, sourceId, excerpt, valid });
    return valid;
  }

  (brief?.chronology || []).forEach((e, i) => check(`chronology[${i}]`, e.source_id, e.excerpt));

  (brief?.controlling_facts || []).forEach((f, i) => {
    (f.supporting_evidence || []).forEach((ev, j) =>
      check(`controlling_facts[${i}].supporting_evidence[${j}]`, ev.source_id, ev.excerpt));
    (f.opposing_evidence || []).forEach((ev, j) =>
      check(`controlling_facts[${i}].opposing_evidence[${j}]`, ev.source_id, ev.excerpt));
  });

  (brief?.material_changes || []).forEach((c, i) => check(`material_changes[${i}]`, c.source_id, c.excerpt));

  (brief?.user_emphasised_points || []).forEach((p, i) => check(`user_emphasised_points[${i}]`, p.source_id, p.excerpt));

  (brief?.express_concessions_and_admissions || []).forEach((c, i) =>
    check(`express_concessions_and_admissions[${i}]`, c.source_id, c.excerpt));

  (brief?.implied_changes_of_position || []).forEach((c, i) => {
    check(`implied_changes_of_position[${i}].earlier`, c.earlier_source_id, c.earlier_excerpt);
    check(`implied_changes_of_position[${i}].later`, c.later_source_id, c.later_excerpt);
  });

  (brief?.prior_commitments || []).forEach((c, i) => check(`prior_commitments[${i}]`, c.source_id, c.excerpt));

  (brief?.contradictions || []).forEach((c, i) => {
    check(`contradictions[${i}].source_a`, c.source_a_id, c.source_a_excerpt);
    check(`contradictions[${i}].source_b`, c.source_b_id, c.source_b_excerpt);
  });

  (brief?.evidence_references || []).forEach((r, i) => check(`evidence_references[${i}]`, r.source_id, r.excerpt));

  const passed = details.filter((d) => d.valid).length;
  return { total: details.length, passed, failed: details.length - passed, details };
}
