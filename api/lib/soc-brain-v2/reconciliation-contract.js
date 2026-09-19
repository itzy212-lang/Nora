// api/lib/soc-brain-v2/reconciliation-contract.js
//
// Nora SOC v2, Phase D2 — the Reconciliation Contract.
//
// Reconciliation has two genuinely different kinds of work, and only
// one of them needs a model at all:
//
// 1. Mapping Phase C's already-resolved claims (active and superseded)
//    into the reconciliation representation. This needs NO judgment -
//    Phase C already decided disposition, section, status, and
//    supersession. Code does this deterministically (reconciliation.js,
//    buildDeterministicItems) — asking a model to redo work Phase C
//    already did correctly would be exactly the "reinterpret from
//    scratch" the governing documents explicitly prohibit.
//
// 2. Recovering supported raw detail that Phase C's structured
//    extraction genuinely didn't capture as its own claim (e.g. "no
//    visible defects" stated in the same breath as "also plastered",
//    with only the plastered fact extracted). This DOES need
//    judgment, and — fixed 2026-09-19, D2 acceptance correction — is
//    now a genuine per-note semantic completeness check, not a
//    lexical pre-filter. The model is given the note's COMPLETE raw
//    text and the COMPLETE set of claims already extracted from it,
//    and is asked directly whether everything factual in the text is
//    accounted for. A prior design used word-overlap to decide
//    per-clause whether to even ask the model at all - confirmed,
//    directly, to cause a real false negative: a note stating two
//    facts joined without a comma/period boundary, where one shared
//    enough vocabulary with an already-captured claim to score above
//    threshold, silently hid the second, uncaptured fact from ever
//    reaching this judgment. Every substantive note (any note with at
//    least one Phase C claim) now gets this check; nothing decides to
//    skip it based on lexical similarity.

export const RECONCILIATION_CONTRACT_VERSION = 'v2.0.0';

export const RECONCILIATION_CONTRACT = `RECONCILIATION CONTRACT — per-note evidence completeness check

You are given ONE complete dictated note's raw text, the resolved section it belongs to, and every claim Phase C's live processor already extracted from it. Your job is a completeness check: is every genuine factual statement in this note's raw text already accounted for by these claims, or is something missing?

RETURN VALID JSON ONLY, matching exactly:
{
  "fully_covered": true | false,
  "recovered": [
    {
      "recovered_content": "the specific factual statement, in your own words, drawn only from the note's text",
      "element": "the element this fact is about — normally the same element the note's existing claim(s) already established, unless the text clearly names a different one",
      "basis": "a short, specific quote or paraphrase of the exact words in the note that support this"
    }
  ]
}

If fully_covered is true, recovered must be an empty array. If anything is missing, fully_covered is false and recovered lists each missing fact as its own entry.

WHEN SOMETHING IS MISSING (add it to recovered):
- The note states a specific, concrete fact (a condition, a defect, an absence of a defect, a measurement, a finish, an operational result) that none of the existing claims represent, even implicitly.
- The fact is stated plainly and is not contradicted by anything else in the note or by the claims themselves.
- Example: the existing claim covers "plastered"; the note also says "no visible defects" — that is a distinct, supported, uncontradicted fact about the same element and must be recovered, even though it shares no unusual vocabulary that would make it stand out lexically.
- Two facts joined by "and", by a new clause, or by no punctuation at all are still two separate facts. Do not let one claim's coverage of part of a sentence excuse missing the rest of it.

WHEN NOTHING IS MISSING, or something looks missing but should NOT be recovered:
- The apparent leftover text is filler, hedging, repetition, or restates what an existing claim already means in different words.
- The apparent leftover text is itself navigational, procedural, or conversational rather than a property fact.
- The apparent leftover text is genuinely ambiguous about what it refers to, or would require guessing an element, defect type, or measurement not actually stated.
- When in doubt about whether something is genuinely a new, distinct fact, do not recover it. A missed recovery can still be corrected later by professional drafting reading the raw transcript directly; a wrongly invented recovery becomes a fabricated fact in the record. Preserve uncertainty rather than invent.

Do not alter, restate, dispute, or comment on the claims you were shown — they are Phase C's resolved state and are not yours to reinterpret, correct, or duplicate. Your output only ever adds a new, clearly separate fact, or nothing at all.`;

