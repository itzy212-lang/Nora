// api/lib/v2-operating-system.js
//
// Nora V2 Operating System — orchestration layer only. Per
// docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md, this owns execution order,
// routing, and diagnostics construction. It owns no voice, no domain
// knowledge, no project facts, no detailed reasoning prose.
//
// V1/V2 routing is two-layer, mirroring the STAGE1_DRAFTING/STAGE1_PROMOTED
// safety pattern already proven in this codebase: a flag that enables V2 at
// all, and an explicit allowlist gating which specific users are routed to
// it. Both must be satisfied for a request to use V2 — absence of either
// falls through to V1 with no other code change required.

const V2_ALLOWLIST = Object.freeze([
  '3bd1f331-e8ce-477a-8a5d-c5dcdd901434', // Itzik Darel — initial V2 user, per approved plan
]);

function isV2Enabled(brainVersionEnv) {
  return brainVersionEnv === 'v2';
}

function isV2AllowedForUser(userId) {
  return !!userId && V2_ALLOWLIST.includes(userId);
}

// Single routing decision point. Returns exactly one of 'v1' | 'v2'.
// This is the only place either version is chosen — nothing downstream
// re-decides it, and nothing may run both assemblers for one request.
function resolveArchitectureVersion({ brainVersionEnv, userId }) {
  if (isV2Enabled(brainVersionEnv) && isV2AllowedForUser(userId)) {
    return 'v2';
  }
  return 'v1';
}

// Diagnostics envelope — logged fields per the approved plan, with the
// requested/observed reasoning-effort distinction kept explicit rather than
// conflated, since OpenAI does not independently verify a requested tier
// was actually honoured internally.
function buildDiagnosticsEnvelope({
  architectureVersion,
  modelReturned,
  requestedReasoningEffort,
  observedReasoningTokens,
  surface,
  modeHint,
  representation,
  promptSections = [],
  effectiveVoiceProfileId,
  contextSelected = [],
  contextExcluded = [],
  goldStandardExampleId,
  fallbackOccurred = false,
  validationResult = null,
}) {
  return {
    schema_version: 'nora_v2_diagnostics_v1',
    architecture_version: architectureVersion,
    model_returned: modelReturned || null,
    reasoning_effort_requested: requestedReasoningEffort || null,
    reasoning_tokens_observed: observedReasoningTokens ?? null,
    surface: surface || null,
    mode: modeHint || null,
    representation: representation || null,
    prompt_sections: promptSections.map((s) => ({ name: s.name, chars: s.content ? s.content.length : 0 })),
    effective_voice_profile: effectiveVoiceProfileId || null,
    context_selected: contextSelected,
    context_excluded: contextExcluded,
    gold_standard_example_id: goldStandardExampleId || null,
    fallback_occurred: !!fallbackOccurred,
    validation_result: validationResult,
  };
}

export { V2_ALLOWLIST, isV2Enabled, isV2AllowedForUser, resolveArchitectureVersion, buildDiagnosticsEnvelope };
