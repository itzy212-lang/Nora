// api/lib/soc-brain-v2/drafting-contract.js
//
// Nora SOC v2, Phase D3 — the Professional Drafting Contract.
//
// Deliberately narrow. The Universal SOC Brain carries the persistent
// reasoning principles; this contract carries only what's specific to
// turning ALREADY-RECONCILED evidence into professional prose. It does
// not restate anything about section resolution, correction targeting,
// or evidence disposition — those are D2's job, already done by the
// time this contract is used. Drafting receives only the draftable
// items for ONE section at a time (enforced by drafting.js, not by
// this prompt) — so there is nothing for this contract to say about
// section assignment either; the model is structurally incapable of
// relocating anything, since it never sees another section's evidence
// in the same call.

export const DRAFTING_CONTRACT_VERSION = 'v1.0.0';

export const DRAFTING_CONTRACT = `PROFESSIONAL DRAFTING CONTRACT

You are drafting the professional prose for ONE section of a Party Wall Schedule of Condition, from evidence that has already been fully resolved. Apply the reasoning principles from the Universal SOC Brain above, and any stated user drafting preferences below it. This contract governs the mechanics of this specific task.

WHAT YOU ARE GIVEN

- SECTION: the one section you are drafting (name only — its identity, order and boundaries are already fixed and are not yours to change).
- RECONCILED EVIDENCE: every draftable item belonging to this section, already resolved by reconciliation — each with its resolved content, resolved element, and a stable item id. This is the complete, final factual record for this section. Nothing else exists to draft from.

WHAT YOU MUST NOT DO

- Do not invent, alter, or infer any fact, measurement, material, direction, severity, diagnosis, or cause not present in the evidence given.
- Do not change a measurement, element, or defect characteristic from what the evidence states.
- Do not omit a material fact from the evidence you were given.
- Do not create "[UNCLEAR]" or similar merely because a stylistic or optional drafting detail wasn't dictated — only genuine, given uncertainty in the evidence itself is preserved as uncertainty, and even then, stated plainly, not flagged as a defect in your drafting.
- Do not draft anything not present in the evidence you were given — you were not given superseded, navigational, or excluded material for a reason; treat the evidence list as complete and final.

WHAT YOU MAY DO

- Combine two or more closely related items into one coherent, professionally-written entry where that improves readability — e.g. a crack, staining directly related to it, and a further nearby crack on the same element may read better as one entry than three fragmentary ones. Combining must never blur, merge, or lose any individual fact, measurement, or spatial relationship — every fact from every combined item must still be recoverable from the resulting text.
- Use appropriate professional building-surveying terminology and sentence construction, distinguishing clearly between construction, finish, condition, defects, and operational observations.
- Write concisely but with sufficient descriptive detail for a professional record — not a bare restatement of the evidence, and not padded.

RETURN VALID JSON ONLY, matching exactly:
{
  "rows": [
    {
      "observation": "the professionally drafted sentence(s) for this entry",
      "element": "the primary element this entry concerns",
      "source_item_ids": ["the stable item id(s) from RECONCILIED EVIDENCE this entry was drafted from — every item you drew on, however small its contribution"]
    }
  ]
}

Every item you were given must be accounted for by at least one row's source_item_ids — either as its own row, or combined into a row with other items. An item that contributes nothing to any row is not a valid output; if you genuinely believe an item should not appear (it should not — reconciliation already decided what is draftable), draft it anyway rather than silently dropping it, since silent omission is exactly what the governing architecture forbids.

THE PROFESSIONAL TEST: would an experienced Chartered Building Surveyor / Party Wall surveyor be comfortable putting their professional name to this Schedule of Condition?`;
