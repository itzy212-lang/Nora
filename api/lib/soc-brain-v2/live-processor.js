// api/lib/soc-brain-v2/live-processor.js
//
// Nora SOC v2, Phase C — the live semantic processor's model-calling
// layer. Assembles the context a single note needs (section index,
// current section, recent same-section context, pending clarification),
// calls the model with the Universal SOC Brain + Live Processing
// Contract, and returns its parsed structured output.
//
// Kept separate from live-state.js (the code-enforced persistence layer)
// so the two responsibilities — "what does this mean" (model) and
// "guarantee this invariant" (code) — stay genuinely separate, matching
// the governing principle throughout the v2 specifications.

import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';
import { LIVE_PROCESSING_CONTRACT } from './live-processing-contract.js';
import { buildSectionIndexText } from './live-state.js';

/**
 * Loads the context a live processing call needs: the section index,
 * the current section, and recent notes from that section (for
 * resolving "that crack"/"the same wall" style references) — bounded,
 * not the full transcript, per Pipeline Spec §27 (token/latency control
 * — final reconciliation gets the full snapshot, live processing does
 * not need it on every call).
 */
export async function loadLiveContext(supabase, { sessionId }) {
  const { data: sections } = await supabase
    .from('soc_sections')
    .select('id, section_key, display_name, floor_level, last_active_sequence, status')
    .eq('session_id', sessionId)
    .order('first_entered_sequence', { ascending: true });

  const currentSection = (sections || [])
    .slice()
    .sort((a, b) => (b.last_active_sequence || 0) - (a.last_active_sequence || 0))[0] || null;

  let recentNotes = [];
  if (currentSection) {
    const { data } = await supabase
      .from('soc_claims')
      .select('raw_fragment, content, element, section')
      .eq('session_id', sessionId)
      .eq('section_id', currentSection.id)
      .eq('status', 'active')
      .order('note_sequence', { ascending: true })
      .limit(30);
    recentNotes = data || [];
  }

  return {
    sections: sections || [],
    currentSection,
    recentNotes,
  };
}

function buildUserPrompt({ context, pendingClarification, noteText }) {
  const sectionIndexText = buildSectionIndexText(context.sections, context.currentSection?.id || null);
  const recentContextText = context.recentNotes.length
    ? context.recentNotes.map(n => `- ${n.raw_fragment || n.content || ''}`.trim()).filter(Boolean).join('\n')
    : '(no prior notes in the current section yet)';

  const pendingText = pendingClarification
    ? `PENDING CLARIFICATION (asked on a previous note, not yet resolved):\n"${pendingClarification.question}"\nIf this new note answers it, set resolves_pending_clarification: true.`
    : 'No pending clarification.';

  return [
    `SECTION INDEX:\n${sectionIndexText}`,
    `CURRENT SECTION: ${context.currentSection ? `"${context.currentSection.display_name}" (key: ${context.currentSection.section_key})` : 'none yet — this is the first note'}`,
    `RECENT CONTEXT FROM THE CURRENT SECTION:\n${recentContextText}`,
    pendingText,
    `NEW NOTE:\n"${noteText}"`,
  ].join('\n\n');
}

/**
 * Calls the live semantic model for one note and returns its parsed,
 * structured output. Throws on a malformed/unparseable response rather
 * than silently returning a default — the caller is responsible for
 * marking the note 'failed' and surfacing that, per Pipeline Spec §6
 * ("a failed semantic-processing call must remain visible... not
 * silently disappear").
 */
export async function callLiveSemanticProcessor({ apiKey, context, pendingClarification, noteText, model = 'gpt-4o' }) {
  const userPrompt = buildUserPrompt({ context, pendingClarification, noteText });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: UNIVERSAL_SOC_BRAIN_V2 + '\n\n' + LIVE_PROCESSING_CONTRACT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Live processing model call failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Live processing model returned unparseable JSON: ${e.message}`);
  }

  if (!parsed.section_resolution || !Array.isArray(parsed.claims) || !parsed.live_response) {
    throw new Error('Live processing model response missing required fields (section_resolution, claims, live_response)');
  }

  return parsed;
}
