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
//    judgment: is the leftover text a genuine, supported, uncontradicted
//    fact, or just phrasing/filler already covered by what was
//    extracted? This contract governs only that judgment call, made
//    once per note where code has already detected a textual coverage
//    gap (reconciliation.js, findCoverageGaps) - the model is never
//    asked to decide FOR EVERY note, only for the specific candidates
//    code has already identified as incompletely covered.

export const RECONCILIATION_CONTRACT_VERSION = 'v1.0.0';

export const RECONCILIATION_CONTRACT = `RECONCILIATION CONTRACT — raw-evidence recovery judgment

You are given ONE dictated note's raw text, the resolved section it belongs to, and the claim(s) Phase C's live processor already extracted from it. Code has already determined that this note's raw text is not fully accounted for by those claims — there is leftover text your judgment is needed for.

YOUR ONLY JOB: decide whether the leftover portion of this note states a genuine, supported, uncontradicted fact about the property that deserves its own recovered record — not to re-derive, re-classify, or second-guess the claims that already exist for this note. Those are settled; do not touch them.

RETURN VALID JSON ONLY, matching exactly:
{
  "recoverable": true | false,
  "recovered_content": "the specific factual statement, in your own words, drawn only from the leftover text" | null,
  "element": "the element this recovered fact is about — normally the same element the note's existing claim(s) already established, unless the leftover text clearly names a different one" | null,
  "basis": "a short, specific quote or paraphrase of the exact leftover words that support this" | null
}

WHEN TO RECOVER (recoverable: true):
- The leftover text states a specific, concrete fact (a condition, a defect, an absence of a defect, a measurement, a finish) that is not already represented, even implicitly, by the note's existing claims.
- The fact is stated plainly and is not contradicted by anything else in this note or by the resolved section's other established facts.
- Example: existing claim covers "plastered"; leftover text is "no visible defects" — recoverable, a distinct, supported, uncontradicted fact about the same element.

WHEN NOT TO RECOVER (recoverable: false):
- The leftover text is filler, hedging, repetition, or restates what the existing claim already means in different words.
- The leftover text is itself navigational, procedural, or conversational rather than a property fact.
- The leftover text is genuinely ambiguous about what it refers to, or would require guessing an element, defect type, or measurement not actually stated.
- When in doubt, do not recover. A missed recovery can be corrected by professional drafting reading the raw transcript directly; a wrongly invented recovery becomes a fabricated fact in the record. Preserve uncertainty rather than invent.

Do not alter, restate, or comment on the claims you were shown — they are Phase C's resolved state and are not yours to reinterpret. Your output is additive only: a new, clearly separate fact, or nothing.`;
