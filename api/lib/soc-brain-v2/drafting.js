// api/lib/soc-brain-v2/drafting.js
//
// Nora SOC v2, Phase D3 — professional drafting. Extended minimally
// in Phase D5 (2026-09-19) to give each row a stable row_id at
// creation — see generateRowId() below — so it can be tracked as the
// same logical observation through D4 repair, D5 rewrite, and D6,
// rather than by array position. No other drafting behaviour changed.
//
// Consumes D2's reconciled representation (reconcile(), never
// re-derives it) and produces professionally drafted SOC prose, with
// provenance back to the reconciled evidence for the later Fidelity
// Audit. Does not implement Fidelity Audit, Professional Quality
// Audit, or the post-quality factual guard — those are later phases.
//
// Section integrity is enforced by construction, not by prompt
// instruction: the model is called once PER SECTION, given only that
// section's draftable items. It is never shown another section's
// evidence in the same call, so it is structurally incapable of
// relocating anything between rooms — this is the same "code
// guarantees facts that don't require judgment" principle used
// throughout this architecture, applied to section boundaries here.
//
// Only draftable items (reconciliation's own disposition-derived
// isDraftable() — active_evidence / site_general_note) are ever shown
// to the model. Superseded, navigation_context, and unresolved items
// are excluded from the input entirely — not merely instructed
// against — so resurrecting superseded evidence or drafting
// conversational material is not a matter of the model choosing
// correctly, it is evidence that was never in front of it to choose.

import { reconcile } from './reconciliation.js';
import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';
import { USER_SOC_BRAIN_V2, buildUserSocBrainContext } from './user-soc-brain.js';
import { DRAFTING_CONTRACT } from './drafting-contract.js';
import { randomUUID } from 'crypto';

// Stable drafted-row identity (Phase D5 requirement): generated once,
// here, when a row is first created — never recomputed from array
// position downstream. D4 repairs and D5 rewrites read/carry this
// value forward on the row object itself; they never regenerate or
// reposition-derive it. This is the only change D5 required of D3.
function generateRowId() {
  return `row-${randomUUID().slice(0, 8)}`;
}

/**
 * Terra (gpt-5.6-terra), matching its exact established invocation
 * pattern (see reconciliation.js and draftFromClaims for the same
 * reasoning) - developer role, max_completion_tokens, no forced
 * response_format, tolerant JSON parsing. Falls back to gpt-4o on
 * failure, the same pattern already established for drafting
 * elsewhere in this codebase. Phase C's own model (gpt-4o, confirmed
 * during D2) is deliberately left untouched — this is a separate
 * model choice for a separate stage, not a change to Phase C.
 */
async function callDraftingModel({ apiKey, systemContent, userPrompt, primaryModel = 'gpt-5.6-terra', fallbackModel = 'gpt-4o' }) {
  async function attempt(model) {
    const isTerra = model.startsWith('gpt-5.6');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(isTerra ? { max_completion_tokens: 4000 } : { max_tokens: 4000, response_format: { type: 'json_object' } }),
        messages: [
          { role: isTerra ? 'developer' : 'system', content: systemContent },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Drafting model call failed (${model}): ${res.status}`);
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

function formatItemForDrafting(item) {
  return `- [${item.id}] ${item.element ? `${item.element}: ` : ''}${item.resolved_content}`;
}

/**
 * Drafts one section from its already-filtered, draftable items only.
 * Validates every returned row's source_item_ids against the actual
 * item ids given — code-level provenance enforcement, not trust in
 * the model's own bookkeeping.
 */
async function draftSection({ apiKey, model, universalBrain, userBrainContext, section, items }) {
  if (!items.length) return { section_id: section.id, section_name: section.display_name, rows: [] };

  const systemContent = [universalBrain, DRAFTING_CONTRACT, userBrainContext].filter(Boolean).join('\n\n');
  const userPrompt = [
    `SECTION: ${section.display_name}`,
    `RECONCILED EVIDENCE (${items.length} item${items.length === 1 ? '' : 's'}):\n${items.map(formatItemForDrafting).join('\n')}`,
  ].join('\n\n');

  const result = await callDraftingModel({ apiKey, model, systemContent, userPrompt });
  const validItemIds = new Set(items.map(i => i.id));

  const rows = (result.rows || []).map(r => {
    const source_item_ids = (r.source_item_ids || []).filter(id => validItemIds.has(id));
    return {
      // Fixed 2026-09-19, D5 acceptance boundary: stable row identity,
      // generated once here at creation - the only point a row is
      // ever newly created in the pipeline - and never recomputed
      // from array position again. A random id rather than a hash of
      // source_item_ids: stability only needs to hold for one
      // generation lifecycle (D3 -> D4 repair -> D5 rewrite -> D6),
      // not to be reproducible across separate runs, and a random id
      // avoids any collision risk if two rows ever ended up citing
      // the same evidence. D4 repairs and D5 rewrites read/carry this
      // value forward on the row object itself; they never regenerate
      // or reposition-derive it. source_item_ids remains the separate,
      // authoritative provenance record - row_id identifies the row,
      // it does not replace what the row is drawn from.
      row_id: generateRowId(),
      observation: r.observation,
      element: r.element || null,
      // Code-level provenance validation: only ids that were genuinely
      // offered to this call are kept. A hallucinated or cross-section
      // id cannot enter the output even if the model produced one.
      source_item_ids,
    };
  });

  return { section_id: section.id, section_name: section.display_name, rows };
}

/**
 * Full D3 drafting. Consumes reconcile() (D2) directly — does not
 * re-extract, re-resolve sections, or re-decide disposition. Sections
 * are drafted in first-visit order (D2's own section ordering,
 * unchanged) and only ever as separate, section-scoped calls.
 */
export async function draft(supabase, { sessionId, projectId, aoId, apiKey, model, userBrain }) {
  const reconciliation = await reconcile(supabase, { sessionId, projectId, aoId, apiKey });

  const userBrainContext = userBrain
    ? buildUserSocBrainContext(userBrain)
    : USER_SOC_BRAIN_V2; // governing text alone when no per-user preferences/example are set

  const itemsBySection = new Map();
  for (const item of reconciliation.items) {
    if (!item.draftable) continue; // superseded / navigation_context / unresolved never reach drafting
    if (!itemsBySection.has(item.section_id)) itemsBySection.set(item.section_id, []);
    itemsBySection.get(item.section_id).push(item);
  }

  const sections = [];
  for (const section of reconciliation.sections) { // already in first-visit order from D2/D1
    const items = itemsBySection.get(section.id) || [];
    const drafted = await draftSection({
      apiKey, model,
      universalBrain: UNIVERSAL_SOC_BRAIN_V2,
      userBrainContext,
      section, items,
    });
    sections.push(drafted);
  }

  return {
    session_id: sessionId,
    sections,
    // Reconciliation's own accounting travels with the draft so later
    // stages (Fidelity Audit) can compare drafted output against the
    // same evidence package this stage drafted from, not re-derive it.
    reconciliation_items: reconciliation.items,
    excluded: reconciliation.excluded,
  };
}
