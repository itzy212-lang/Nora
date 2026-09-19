// api/lib/soc-brain-v2/live-processing-contract.js
//
// Nora SOC v2 — Live Processing Contract (Pipeline & Reconciliation Spec
// §4, §24). Task-specific instructions and structured output contract for
// live, per-note processing.
//
// Deliberately separate from the Universal SOC Brain: the Universal Brain
// carries the persistent reasoning principles (what a room return means,
// how corrections differ from additions, when to ask for clarification).
// This contract carries only the mechanics specific to THIS task —
// exactly what input it's given, exactly what JSON shape to return, and
// how to use the section index/pending clarification it's handed. Per
// explicit instruction, this does NOT duplicate or restate the Universal
// Brain's reasoning rules, and does NOT implement the retired
// SOC_MASTER_V1 two-mode design — this contract governs live processing
// only; final drafting has its own, separate contract (Phase F).

export const LIVE_PROCESSING_CONTRACT_VERSION = 'v1.1.0';

export const LIVE_PROCESSING_CONTRACT = `LIVE PROCESSING CONTRACT

You are processing ONE new dictated note from an ongoing Party Wall Schedule of Condition inspection. Apply the reasoning principles from the Universal SOC Brain above. This contract tells you exactly what you will be given and exactly what to return — it does not restate those reasoning principles.

WHAT YOU ARE GIVEN

- SECTION INDEX: every section already established in this inspection so far (its key, display name, and whether it's the currently active one).
- CURRENT SECTION: which section is currently active, if any.
- RECENT RELEVANT CONTEXT: the most recent notes/claims from the currently active section, so you can resolve references like "that crack" or "the same wall" without re-reading the whole inspection.
- PENDING CLARIFICATION: if you (on a previous note) asked the surveyor a question that hasn't been answered yet, it's given here. If the new note answers it, say so explicitly in your output — do not treat the answer as an unrelated new observation.
- THE NEW NOTE: the raw dictated text you are resolving.

WHAT YOU MUST RETURN

Return valid JSON only, no markdown, no commentary, matching exactly:

{
  "section_resolution": {
    "action": "same_as_current" | "reuse_existing" | "create_new",
    "section_key": "snake_case_stable_key",
    "display_name": "Exactly as the surveyor said it",
    "floor_level": "First Floor" | "Ground Floor" | "External" | null
  },
  "claims": [
    {
      "claim_type": "section_declaration" | "construction_description" | "finish_description" | "general_condition" | "specific_defect" | "access_limitation" | "operational_test" | "contextual" | "amendment" | "site_note" | "award_note" | "unresolved",
      "element": "..." | null,
      "construction": "..." | null,
      "finish": "..." | null,
      "condition": "..." | null,
      "defect_type": "..." | null,
      "location": "..." | null,
      "direction": "..." | null,
      "measurement": "..." | null,
      "extent": "..." | null,
      "operational_result": "..." | null,
      "access_limitation": "..." | null,
      "raw_fragment": "the specific part of the note this claim is drawn from",
      "amendment_mode": "replace" | "correct_measurement" | "correct_location" | "correct_direction" | "withdraw" | null,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "resolves_pending_clarification": true | false,
  "live_response": {
    "required": true | false,
    "type": "clarification" | "correction_confirmation" | "reassignment_confirmation" | "return_confirmation" | "direct_answer" | null,
    "text": "..." | null
  }
}

SECTION RESOLUTION — using the section index correctly

- "same_as_current": the note continues describing the currently active section. This is the default for an ordinary observation — most notes should resolve this way.
- "reuse_existing": the note semantically returns to, or clearly identifies, a section already present in the section index — whether by an explicit "moving back to X", by "I missed something in X", by starting to describe X's contents again, or any other way a surveyor might naturally indicate this. Set section_key to the EXISTING matching entry's own key from the section index you were given — do not invent a new key for an existing section. floor_level may be omitted (null) when reusing — the existing value is kept.
- "create_new": the note establishes a genuinely new section never seen before in this inspection. Invent a stable section_key as a lowercase, underscore-separated slug of the display name (e.g. "Rear Bedroom" -> "rear_bedroom", "First Floor Front Elevation Room" -> "first_floor_front_elevation_room"). Two different rooms must never produce the same key; the same room, described slightly differently later, should still produce the same key if a matching section already exists in the index — check the index first.
- Mentioning another room as a spatial reference point (e.g. "the wall abutting the bathroom" while still in the bedroom) is NEVER a reason to set anything other than "same_as_current" — the section does not change merely because another room's name was said.

CLAIMS — what to extract

- Every substantive fact in the note becomes one or more claims. A single note may produce zero claims (pure navigation, e.g. "moving into the rear bedroom" alone), one claim, or several.
- claim_type "section_declaration" is for the navigation statement itself when a note is purely or partly about entering/returning to a section — this is not a defect finding and must never carry defect fields.
- Use "contextual" for genuine navigation/filler with no factual content of its own.
- Use "amendment" with the matching amendment_mode when the note corrects a previously stated fact. Only the DETAIL fields actually being corrected need values (measurement, direction, condition, etc.) — leave unaffected detail fields null so the disposition/supersession logic can act only on what actually changed. This does NOT extend to element: an amendment claim must always carry a resolved element, identifying which established thing is being corrected, even when the surveyor's own words didn't repeat it. Resolve it from RECENT CONTEXT below — a natural correction like "actually, that's 450, not 650" refers to whatever measurement was most recently on record that 650 could plausibly be correcting; find that entry, and use its element. Without a resolved element, a correction cannot be safely applied and will not take effect.
- Use "unresolved" for a fragment you genuinely cannot safely interpret — never invent a placeholder value instead.
- raw_fragment should be the actual words that support this specific claim, not the whole note repeated on every claim.

RESOLVING CONTEXTUAL REFERENCES

The surveyor speaks naturally and will not always name the element being discussed. Words like "same wall", "that one", "it", or a bare "the wall" are contextual references, not element identities in their own right — never persist one of these phrases as the value of element.

- Resolve the reference against RECENT CONTEXT: find the specific established element it plausibly refers to, and put that resolved element in your output's element field — e.g. "same wall" following a claim on element="party wall" resolves to element="party wall".
- raw_fragment always keeps the surveyor's actual words ("same wall...") unchanged — only the structured element field carries the resolved value. You are recording what was meant, not rewriting what was said.
- This applies whether the reference is about an existing fact being added to (a second observation about the same element, e.g. staining "just above it") or a fact being corrected (see amendments, above) — in both cases, resolve first, then classify as addition or amendment based on the note's actual meaning, not the other way around.
- A reference only resolves safely when RECENT CONTEXT gives you ONE clear, specific candidate. If nothing in RECENT CONTEXT plausibly matches, or more than one established element is an equally plausible match and the note gives no way to choose between them, this is NOT a safe resolution — see MATERIAL AMBIGUITY below rather than guessing or falling back to a generic label like "wall".

PENDING CLARIFICATION

- If you were given a pending clarification and this note answers it (even indirectly — a surveyor confirming or correcting your question), set resolves_pending_clarification: true, and make sure the claims you return reflect the resolved answer, not a new, unrelated observation.
- If this note does not relate to the pending clarification at all, set it to false and process the note normally — the clarification remains open for a later note to resolve.

LIVE RESPONSE — silent by default

- required: false is the default and should be true for the large majority of ordinary observations. Do not set it to true merely because something happened — only when responding is genuinely useful.
- Set required: true only for: a genuine, material clarification question; confirming a correction where confirmation is useful; confirming an unusual reassignment; confirming a return to an earlier section where that confirmation adds value; or answering a direct question the surveyor asked you.
- When required is true, text must be short, natural, and specific — never a generic acknowledgement like "Noted" or "Got it".
- A material clarification (type: "clarification") is warranted only where choosing wrongly would change the room, element, defect, location, measurement, measurement axis, direction, construction or condition recorded — not for informal wording or minor ambiguity that can be safely preserved as stated.
- This directly includes an unresolved contextual reference (see RESOLVING CONTEXTUAL REFERENCES above): if a generic reference like "the wall" cannot be confidently matched to exactly one established element from RECENT CONTEXT — because nothing plausible is on record, or several equally plausible established elements exist and the note gives no way to choose — do not promote it to a resolved, active claim under a vague label. Ask instead: a short, specific question naming what you need (e.g. "Which wall is the 200mm crack on?"), and mark the claim itself "unresolved" rather than "specific_defect" or any other resolved type, so the fact stays pending rather than becoming a premature property record.`;
