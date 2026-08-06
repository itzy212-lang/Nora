// api/lib/v2-voice-resolution.js
//
// Implements the four-level voice precedence hierarchy from
// docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md:
//   1. Universal factual/representation/anti-invention safeguards (never overridden here)
//   2. Current express user instruction for this request (handled by the caller, not this module)
//   3. Authenticated User Voice Profile (user_brain_v2)
//   4. Platform Default Voice Profile (ai_instruction_sets, name='default_voice_profile_v2')
//
// This module resolves levels 3 and 4 into one effective voice block, plus
// the Gold Standard example with its explicit authority framing — reframed
// per the approved plan, never injected as anonymous JSON.

// Renders the structured banned_phrases_structured jsonb (added by the
// additive migration, 2026-08-06) into prose. Falls back to the original
// banned_phrases text column where the structured form is not yet
// populated for a given row — per the explicit instruction that this must
// be a temporary fallback, not a silent replacement.
function renderBannedPhrases(userBrainV2) {
  if (userBrainV2?.banned_phrases_structured) {
    const s = userBrainV2.banned_phrases_structured;
    const parts = [];
    if (s.general?.length) parts.push(`Avoid generally: ${s.general.join('; ')}.`);
    if (s.domain_specific?.phrases?.length) {
      parts.push(`Avoid (${s.domain_specific.note || 'domain-specific'}): ${s.domain_specific.phrases.join('; ')}.`);
    }
    if (s.openers?.length) parts.push(`Do not open with: ${s.openers.join('; ')}.`);
    if (s.closers?.length) parts.push(`Do not close with: ${s.closers.join('; ')}.`);
    if (s.punctuation_and_formatting?.length) parts.push(s.punctuation_and_formatting.join(' '));
    if (parts.length) return parts.join(' ');
  }
  // Temporary fallback only — remove once every user_brain_v2 row has
  // banned_phrases_structured populated.
  return userBrainV2?.banned_phrases || null;
}

function resolveEffectiveVoice({ defaultVoiceProfile, userBrainV2 }) {
  const hasUserVoice = !!(userBrainV2 && userBrainV2.voice_content);
  const parts = [];

  if (defaultVoiceProfile) {
    parts.push({ name: 'default_voice_profile', content: defaultVoiceProfile });
  }
  if (hasUserVoice) {
    parts.push({ name: 'user_voice_override', content: userBrainV2.voice_content });
  }
  if (userBrainV2?.identity_content) {
    parts.push({ name: 'user_identity', content: userBrainV2.identity_content });
  }
  const bannedPhrasesText = renderBannedPhrases(userBrainV2);
  if (bannedPhrasesText) {
    parts.push({ name: 'user_banned_phrases', content: bannedPhrasesText });
  }
  if (userBrainV2?.fee_structure_content) {
    parts.push({ name: 'user_fee_structure', content: userBrainV2.fee_structure_content });
  }
  if (userBrainV2?.sign_off) {
    parts.push({ name: 'user_sign_off', content: `Sign off with: ${userBrainV2.sign_off} Nothing may appear after it.` });
  }

  return {
    effectiveVoiceProfileId: hasUserVoice ? `user_brain_v2:${userBrainV2.user_id}` : 'default_voice_profile_v2',
    sections: parts,
    text: parts.map((p) => p.content).join('\n\n'),
  };
}

// Explicit authority framing — the exact gap identified in the Gold Standard
// investigation: examples were previously injected as bare-labelled JSON
// with no operative instruction on their authority. This is that instruction.
function buildGoldStandardBlock({ example, userBrainV2 }) {
  if (!example) return null;

  const framing = userBrainV2?.gold_standard_framing ||
    'These examples demonstrate how the authenticated user naturally structures, phrases and softens professional correspondence. Match their tone, directness, cadence and level of formality. Do not copy their facts or wording mechanically. Where generic drafting guidance conflicts with the style demonstrated here, the authenticated user\'s voice controls unless the user expressly requests a different tone.';

  const authorityStatement =
    'The authenticated user\'s voice definition and Gold Standard examples above are the authoritative guide for all written output. Editorial improvements must preserve that voice. Generic drafting rules, surface instructions and domain knowledge may improve accuracy, clarity and structure, but must not replace the user\'s tone, cadence, terminology, emphasis or professional character.';

  return {
    exampleId: example.id,
    text: `${framing}\n\n${JSON.stringify([example], null, 2)}\n\n${authorityStatement}`,
  };
}

export { resolveEffectiveVoice, buildGoldStandardBlock, renderBannedPhrases };
