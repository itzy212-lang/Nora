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

import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';

export const SITE_NOTE_DRAFTING_CONTRACT_VERSION = 'v1.0.0';

export const SITE_NOTE_DRAFTING_CONTRACT = `SITE NOTE PROFESSIONAL WORDING

You are given one or more dictated site/general notes for a Party Wall Schedule of Condition. Each is raw dictation, often including the surveyor's own conversational framing ("can I add a site note that...", "just a note that...") rather than a clean statement of the fact itself.

YOUR ONLY JOB: rewrite each note as concise, professional prose stating exactly the fact that was dictated - nothing more, nothing less.

YOU MAY:
- remove conversational framing ("can I add a site note that...", "just noting that...")
- correct grammar and punctuation
- use appropriate Party Wall surveying terminology and capitalisation (e.g. "Building Owner", "Adjoining Owner")
- restructure the sentence for concise, professional readability

YOU MUST NOT:
- add any fact not present in the dictation
- infer or state a legal right, entitlement, or agreement
- state that access (or anything else) has been agreed, granted, confirmed, or refused unless the dictation itself said so
- introduce a date, route, condition, or obligation not actually dictated
- turn the note into a room/property condition observation
- change any measurement, name, address, or other specific detail

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

If a note's dictated content is already concise and professional, return it with only the conversational framing removed - do not rewrite for its own sake. Every item you are given must appear exactly once in your output.`;

// Orchestration lives in the same file as its contract - this stage
// is small and single-purpose, unlike D3-D6 which each warrant their
// own module.

async function callSiteNoteModel({ apiKey, systemContent, userPrompt, primaryModel = 'gpt-5.6-terra', fallbackModel = 'gpt-4o' }) {
  async function attempt(model) {
    const isTerra = model.startsWith('gpt-5.6');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(isTerra ? { max_completion_tokens: 2000 } : { max_tokens: 2000, response_format: { type: 'json_object' } }),
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
