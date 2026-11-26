import '../ai-usage-install.js'; // AI token tracking (api/lib/ai-usage.js)
// api/lib/soc-brain-v2/site-note-drafting.js
//
// Nora SOC v2, close-out pass — professional site-note wording.
//
// Site-note ROUTING (which items are site notes, and that they never
// enter room drafting) is accepted, frozen architecture from the
// prior phase and is not touched here. This module solves a
// presentation problem only: the raw dictated sentence (including the
// user's own conversational framing, e.g. "can I add a site note
// that...") was being persisted verbatim as the final Site Notes
// text. This turns it into concise professional prose, strictly
// bound to the dictated facts - it must never add, infer, or imply
// anything the surveyor did not actually say.

import { modelFor, isReasoningModel } from '../model-config.js';
import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';

export const SITE_NOTE_DRAFTING_CONTRACT_VERSION = 'v1.2.0';

export const SITE_NOTE_DRAFTING_CONTRACT = `SITE NOTE PROFESSIONAL WORDING

You are given one or more dictated site/general notes for a Party Wall Schedule of Condition. Each is raw dictation, often including the surveyor's own conversational framing ("can I add a site note that...", "just a note that...") rather than a clean statement of the fact itself.

YOUR JOB: write each note up as a chartered building surveyor would for a Schedule of Condition: clear, complete, professionally worded sentences that state everything the surveyor dictated, and nothing they did not. The notes are a record for the surveyor to review later, and may include requests, recommendations and matters to be discussed between the parties (e.g. requesting a CCTV inspection of a drain before and after the works; where no award is being made, that access should be discussed between the parties). Turn a rough instruction into a properly worded request or recommendation, using the natural 'who, what, when' structure, but only with the who, what and when the surveyor actually gave. Where one dictated note contains several points, keep every point, in full sentences or a short sequence of sentences. Each note may be as long as its content needs.

YOU MAY:
- remove conversational framing ("can I add a site note that...", "just noting that...")
- correct grammar and punctuation
- use appropriate Party Wall surveying terminology and capitalisation (e.g. "Building Owner", "Adjoining Owner")
- restructure and expand the dictation into complete, well-formed professional sentences
- phrase requests and recommendations in the form a chartered surveyor would (e.g. "It is recommended that...", "The Building Owner is requested to...") where the dictation was itself a request, recommendation or instruction
- keep a list the surveyor dictated as a list, in the order given

YOU MUST NOT:
- add any fact not present in the dictation
- infer or state a legal right, entitlement, or agreement
- state that access (or anything else) has been agreed, granted, confirmed, or refused unless the dictation itself said so
- introduce a date, route, condition, or obligation not actually dictated
- add items to a list, or reasons, that were not dictated (if the surveyor said access 'should include' items, include only the items they named)
- turn a request or recommendation into a statement that something has been done or agreed
- turn the note into a room/property condition observation
- change any measurement, name, address, or other specific detail

TIMING AND TENSE
- A statement of present condition made during the inspection ("no access to the flat roof") describes the position at the time of inspection: write it in the past tense with "at the time of inspection" (e.g. "could not be accessed at the time of inspection"), never as something that will be the case in future.
- Words such as "once the scaffolding is up", "prior to commencement" or "when the works start" say WHEN a requested action is to happen. Attach them to the request, never to a statement about access or condition.
- Read the whole note for its purpose before writing. If a limitation is followed by a request, the usual meaning is: this could not be seen or reached now, so someone is asked to do something later. Write it so the reader sees that cause and request clearly.

EXAMPLE
Raw: "add a side note no access to the flat roof above the kitchen, once the scaffolding is up if the contractors could take a series of photos and provide them to us before the works start"
Professional: "The flat roof above the kitchen could not be accessed at the time of inspection. It is requested that, once the scaffolding is erected, the contractors take a series of photographs of the flat roof and provide them to the surveyor prior to the commencement of the works."
NOT: "No access will be available to the flat roof once the scaffolding is erected." (attaches the timing to the access statement and changes the meaning)

EXAMPLE
Raw: "can I add a site note that the building owner will require access through the Garden of the adjoining owner"
Professional: "The Building Owner will require access through the garden of the Adjoining Owner."
NOT: "The Adjoining Owner has agreed to provide access." (invents agreement not dictated)
NOT: "The Building Owner is entitled to access." (invents a legal conclusion not dictated)

RETURN VALID JSON ONLY, matching exactly:
{
  "site_notes": [
    { "item_id": "the id of the site-note item this concerns, exactly as given", "professional_text": "the rewritten, evidence-bound professional sentence" }
  ]
}

If a note's dictated content is already concise and professional, return it with only the conversational framing removed - do not pad it. Every item you are given must appear exactly once in your output.`;

// Orchestration lives in the same file as its contract - this stage
// is small and single-purpose, unlike D3-D6 which each warrant their
// own module.

async function callSiteNoteModel({ apiKey, systemContent, userPrompt, primaryModel = modelFor('soc_site_notes').model, fallbackModel = modelFor('soc_site_notes').fallbackModel }) {
  async function attempt(model) {
    const isTerra = isReasoningModel(model);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(isTerra ? { max_completion_tokens: modelFor('soc_site_notes').maxCompletionTokens } : { max_tokens: 2000, response_format: { type: 'json_object' } }),
        messages: [
          { role: isTerra ? 'developer' : 'system', content: systemContent },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Site note drafting model call failed (${model}): ${res.status}`);
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '')
      .replace(/^[`]{3}(?:json)?[\s]*/m, '').replace(/[\s]*[`]{3}$/m, '').trim();
    return JSON.parse(raw);
  }
  try {
    return await attempt(primaryModel);
  } catch (primaryErr) {
    if (primaryModel === fallbackModel) throw primaryErr;
    return await attempt(fallbackModel);
  }
}

/**
 * Rewrites a list of site-note reconciliation items (each with at
 * least `id` and `resolved_content`, the raw dictated text D2 already
 * resolved) into professional prose. Evidence-bound: never adds a
 * fact, never infers agreement/entitlement, never introduces details
 * not dictated - enforced by the contract, and by keeping this
 * strictly a rewrite of given text, never a call that has access to
 * anything else it could pull unsupported detail from.
 *
 * Returns the same items with an added `professional_text` field.
 * If no apiKey is available, or the model call fails, falls back to
 * the item's own resolved_content unchanged - a plain, unpolished
 * site note is always safer than a fabricated one, and never blocks
 * the site note from appearing in the final output.
 */
export async function draftSiteNotes(items, { apiKey, model } = {}) {
  if (!items.length) return [];
  if (!apiKey) return items.map(i => ({ ...i, professional_text: i.resolved_content }));

  const userPrompt = items.map(i => `[${i.id}] "${i.resolved_content}"`).join('\n');
  try {
    const result = await callSiteNoteModel({
      apiKey, model,
      systemContent: UNIVERSAL_SOC_BRAIN_V2 + '\n\n' + SITE_NOTE_DRAFTING_CONTRACT,
      userPrompt: `SITE NOTES TO REWRITE:\n${userPrompt}`,
    });
    const byId = new Map((result.site_notes || []).map(r => [r.item_id, r.professional_text]));
    return items.map(i => ({ ...i, professional_text: byId.get(i.id) || i.resolved_content }));
  } catch (err) {
    console.warn('[site-note-drafting] Falling back to unpolished site-note text:', err.message);
    return items.map(i => ({ ...i, professional_text: i.resolved_content }));
  }
}
