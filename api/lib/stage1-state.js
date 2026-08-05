// api/lib/stage1-state.js
//
// Two-flag shadow state-machine evaluation, per FINAL_SHADOW_STATE_MACHINE.md.
//
// PHASE 1 STATUS: not imported anywhere in api/ely-smart.js, not reachable
// from any production request path. In Phase 2 this becomes the single
// authority the caller consults to decide whether a validated brief may
// ever be passed into buildSystemPrompt() — the structural gate described
// in REVISED_IMPLEMENTATION_MAP.md section 2.

export const STAGE1_STATE = Object.freeze({
  OFF: 'OFF',
  SHADOW: 'SHADOW',
  PROMOTED_CANDIDATE: 'PROMOTED_CANDIDATE',
});

/**
 * A flag is enabled only when its value is the exact string "true" — no
 * fuzzy matching, no case-insensitivity, matching the existing live pattern
 * already used for STAGE1_DRAFTING (api/ely-smart.js, current line 3511:
 * `process.env.STAGE1_DRAFTING === 'true'`).
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isExactlyTrue(value) {
  return value === 'true';
}

/**
 * Resolve which of OFF / SHADOW / PROMOTED_CANDIDATE the two flags put the
 * system in for the current request. There is no state in which
 * STAGE1_PROMOTED alone (without STAGE1_DRAFTING) causes anything — the
 * pathway must actually be enabled to run before there is anything to
 * promote.
 *
 * @param {{ stage1DraftingEnv: *, stage1PromotedEnv: * }} env
 * @returns {{ state: string, draftingEnabled: boolean, promotedEnabled: boolean }}
 */
export function resolveStage1State({ stage1DraftingEnv, stage1PromotedEnv } = {}) {
  const draftingEnabled = isExactlyTrue(stage1DraftingEnv);
  const promotedEnabled = isExactlyTrue(stage1PromotedEnv);

  let state = STAGE1_STATE.OFF;
  if (draftingEnabled && promotedEnabled) {
    state = STAGE1_STATE.PROMOTED_CANDIDATE;
  } else if (draftingEnabled && !promotedEnabled) {
    state = STAGE1_STATE.SHADOW;
  }

  return { state, draftingEnabled, promotedEnabled };
}

/**
 * Compute the value that may be passed into buildSystemPrompt()'s
 * stage1Brief injection parameter. Returns null in every case except
 * PROMOTED_CANDIDATE state with successful generation and passed
 * validation — this is the single choke point described in
 * REVISED_IMPLEMENTATION_MAP.md section 2 ("briefForInjection").
 *
 * @param {{ state: string, generationSucceeded: boolean, validationPassed: boolean, brief: object|null }} args
 * @returns {object|null}
 */
export function computeBriefForInjection({ state, generationSucceeded, validationPassed, brief }) {
  if (state !== STAGE1_STATE.PROMOTED_CANDIDATE) return null;
  if (!generationSucceeded) return null;
  if (!validationPassed) return null;
  return brief || null;
}
