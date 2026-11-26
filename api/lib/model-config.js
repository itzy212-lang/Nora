// api/lib/model-config.js
//
// ONE place that says which OpenAI model each part of Nora uses, at what reasoning effort,
// with what token limit and which fallback. Written 26 Nov 2026 for the move to a newer model
// family. Nothing here changes behaviour by itself: every default below is exactly what the
// code used before it was centralised.
//
// How to change a model later (no code edits needed):
//   NORA_CORE_MODEL=gpt-6.2-sol          every "core" function (the reasoning-heavy ones)
//   NORA_MODEL_<FUNCTION>=...            one function only, e.g. NORA_MODEL_MINUTES_DRAFT
//   NORA_EFFORT_<FUNCTION>=low|medium|high   one function's reasoning effort
//   NORA_FALLBACK_MODEL=gpt-4o           the model every function falls back to
// To roll back, remove the variable (or set it to gpt-5.6-terra). Change a default in this
// file to make a switch permanent.
//
// Older single-purpose variables still work where the code already read them:
//   SOC_DRAFT_MODEL, MINUTES_DRAFT_MODEL, MINUTES_EXTRACT_MODEL, DRAFTING_REASONING_EFFORT,
//   STAGE1_REASONING_EFFORT.

export const TIER_DEFAULTS = {
  core: 'gpt-5.6-terra',     // reasoning-heavy: chat, drafting, SOC, audits, disputes, minutes
  light: 'gpt-5.6-luna',     // small extraction / classification jobs
  economy: 'gpt-4o',         // utility calls that need speed, not depth
};

export const DEFAULT_FALLBACK_MODEL = 'gpt-4o';

// function key -> { tier, effort, maxCompletionTokens, note }
// effort is only used for reasoning models. Token limits include the model's hidden reasoning.
export const FUNCTIONS = {
  chat_main:            { tier: 'core', effort: 'medium', maxCompletionTokens: 3500, note: 'Nora main conversation (ely-smart final answer)' },
  chat_stage1:          { tier: 'core', effort: 'medium', maxCompletionTokens: null, note: 'Nora Stage 1 case assessment (token limit set where it is called)' },
  email_draft_auto:     { tier: 'core', effort: null,     maxCompletionTokens: 2000, note: 'Auto-response drafting (cron-auto-draft)' },
  project_memory:       { tier: 'core', effort: null,     maxCompletionTokens: 900,  note: 'Interpreting what a document means for the brain (summarise-knowledge)' },
  dispute_analysis:     { tier: 'core', effort: 'medium', maxCompletionTokens: 9000, note: 'Dispute synopsis / analysis' },
  soc_draft:            { tier: 'core', effort: null,     maxCompletionTokens: 4000, note: 'SOC v2 professional drafting' },
  soc_reconcile:        { tier: 'core', effort: null,     maxCompletionTokens: 4000, note: 'SOC v2 reconciliation' },
  soc_site_notes:       { tier: 'core', effort: null,     maxCompletionTokens: 2000, note: 'SOC v2 site note wording' },
  soc_fidelity_audit:   { tier: 'core', effort: null,     maxCompletionTokens: 4000, note: 'SOC v2 fidelity audit' },
  soc_quality_audit:    { tier: 'core', effort: null,     maxCompletionTokens: 4000, note: 'SOC v2 quality audit' },
  soc_factual_guard:    { tier: 'core', effort: null,     maxCompletionTokens: 4000, note: 'SOC v2 factual guard' },
  soc_legacy_draft:     { tier: 'core', effort: null,     maxCompletionTokens: 128000, note: 'Legacy SOC pipeline Stage 2 (flag-only path)' },
  minutes_draft:        { tier: 'core', effort: null,     maxCompletionTokens: 3000, note: 'Meeting minutes drafting' },
  // Not moved: left on their current models until measured (see the upgrade report).
  soc_live:             { tier: 'economy', effort: null, maxCompletionTokens: null, note: 'SOC live note processing, runs on every dictated note (speed matters)' },
  minutes_extract:      { tier: 'economy', effort: null, maxCompletionTokens: 3000, note: 'Meeting minutes extraction' },
};

const REASONING_MODEL = /^(gpt-5|gpt-6|o\d)/i;

/** True for models that use max_completion_tokens, the developer role and reasoning effort. */
export function isReasoningModel(model) {
  return REASONING_MODEL.test(String(model || ''));
}

/** GPT-6.x rejects effort "none" and "minimal"; map them to "low" as the migration guide says. */
export function normaliseEffort(model, effort) {
  if (!effort) return undefined;
  if (/^gpt-6/i.test(String(model || '')) && (effort === 'none' || effort === 'minimal')) return 'low';
  return effort;
}

const envKey = fn => String(fn).toUpperCase();

/** Model, effort, token limit and fallback for one function. */
export function modelFor(fn, env = process.env) {
  const spec = FUNCTIONS[fn];
  if (!spec) throw new Error(`model-config: unknown function "${fn}"`);
  const tierModel = spec.tier === 'core' ? (env.NORA_CORE_MODEL || TIER_DEFAULTS.core) : TIER_DEFAULTS[spec.tier];
  const model = env[`NORA_MODEL_${envKey(fn)}`] || tierModel;
  const effort = normaliseEffort(model, env[`NORA_EFFORT_${envKey(fn)}`] || spec.effort);
  return {
    model,
    reasoningEffort: isReasoningModel(model) ? effort : undefined,
    maxCompletionTokens: spec.maxCompletionTokens,
    fallbackModel: env.NORA_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
  };
}

/** Role name for the instruction message: reasoning models take "developer", others "system". */
export function instructionRole(model) {
  return isReasoningModel(model) ? 'developer' : 'system';
}

/**
 * Request fields that depend on the model family, so a function can be pointed at any model:
 * reasoning models get max_completion_tokens (+ effort), older ones get max_tokens (+ JSON mode
 * when asked). Never includes temperature: reasoning models reject it.
 */
export function tokenParams(model, { maxTokens, reasoningEffort, jsonMode = false } = {}) {
  if (isReasoningModel(model)) {
    const effort = normaliseEffort(model, reasoningEffort);
    return { max_completion_tokens: maxTokens, ...(effort ? { reasoning_effort: effort } : {}) };
  }
  return { max_tokens: maxTokens, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}) };
}
