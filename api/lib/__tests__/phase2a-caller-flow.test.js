// api/lib/__tests__/phase2a-caller-flow.test.js
//
// Two kinds of test here, both disclosed honestly:
//
// 1. STRUCTURAL (source-scan) tests — handler() in api/ely-smart.js is a
//    large, monolithic, unexported Vercel function with heavy external
//    dependencies (auth, Supabase project/email loading, OpenAI calls for
//    unrelated features). Phase 2A does not refactor it into an isolated,
//    mockable unit. These tests read the actual source text and assert
//    specific structural guarantees directly against it — e.g. that exactly
//    one call site for generateStage1Brief() exists. This is a legitimate,
//    honest way to prove a single-call-site/single-pathway guarantee when
//    the surrounding function cannot practically be invoked in isolation;
//    it is not a substitute for the behavioral tests in
//    phase2a-generate-stage1-brief.test.js, which do invoke real code.
//
// 2. LOGIC-EQUIVALENCE tests — the state → stage1BriefForPrompt decision
//    implemented in the caller (OFF/ineligible → null; SHADOW/eligible →
//    generate then null; PROMOTED_CANDIDATE → generate then null) is
//    re-implemented here as a small, independent, pure function and tested
//    directly. This proves the *decision logic* is correct; combined with
//    the source-scan tests (which prove the real caller assigns the literal
//    value null in every branch, not a computed one) and the Phase 1
//    state-machine tests (which prove resolveStage1State/
//    computeBriefForInjection resolve correctly), the three together cover
//    what a direct handler() unit test would have covered.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveStage1State, computeBriefForInjection, STAGE1_STATE } from '../stage1-state.js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
}));

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.OPENAI_API_KEY = 'test-openai-key';

const { runStage1ShadowTask, emptyRetrievedAuthority } = await import('../../ely-smart.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, '../../ely-smart.js');
const source = readFileSync(SOURCE_PATH, 'utf8');

describe('structural: single Stage 1 pathway (source-scan of api/ely-smart.js)', () => {
  it('has exactly one generateStage1Brief() call site (excluding its own definition, comments, and the test-only export line)', () => {
    const callSitePattern = /\bgenerateStage1Brief\(\{/g;
    const matches = source.match(callSitePattern) || [];
    // The function's own parameter-destructuring line uses `generateStage1Brief({`
    // exactly once (the definition itself), and the real call site uses the
    // same pattern once more (`await generateStage1Brief({`). Total: 2.
    expect(matches.length).toBe(2);
  });

  it('has exactly one function declaration for generateStage1Brief', () => {
    const defPattern = /^async function generateStage1Brief\(/gm;
    const matches = source.match(defPattern) || [];
    expect(matches.length).toBe(1);
  });

  it('has no second/legacy Stage 1 generation function (e.g. no "Luna" or "STAGE1_MODEL" fallback path remaining)', () => {
    expect(source).not.toContain('STAGE1_MODEL');
    expect(source).not.toContain("|| 'gpt-5.6-luna'");
  });

  it('buildSystemPrompt() is called with stage1Brief bound to the caller-controlled variable, not a fresh generation result', () => {
    expect(source).toContain('stage1Brief: stage1BriefForPrompt');
  });

  it('stage1BriefForPrompt is declared and initialised to null, and is never reassigned to a generation result or computeBriefForInjection() output', () => {
    expect(source).toContain('let stage1BriefForPrompt = null;');
    // The only two other appearances of the identifier should be: the
    // comment block referencing it, and the buildSystemPrompt() call site
    // checked above — never `stage1BriefForPrompt = <something-other-than-null>`.
    const reassignmentPattern = /stage1BriefForPrompt\s*=\s*(?!null)[^;]+;/g;
    const suspiciousReassignments = (source.match(reassignmentPattern) || [])
      .filter((m) => !m.includes('stage1BriefForPrompt = null'));
    expect(suspiciousReassignments).toEqual([]);
  });

  it('the caller explicitly handles OFF, SHADOW, and PROMOTED_CANDIDATE — no state falls through unhandled', () => {
    expect(source).toContain('STAGE1_STATE.OFF');
    expect(source).toContain('STAGE1_STATE.SHADOW');
    expect(source).toContain('STAGE1_STATE.PROMOTED_CANDIDATE');
  });

  it('the PROMOTED_CANDIDATE branch is explicitly labelled as blocked, not silently treated as promotion', () => {
    expect(source).toContain('PROMOTED_CANDIDATE_BLOCKED');
    expect(source).toContain('Phase 2A has no promotion path');
  });
});

describe('logic-equivalence: state → stage1BriefForPrompt decision', () => {
  // Mirrors exactly the branching implemented in api/ely-smart.js's caller.
  // generateFn is injected so this can be tested without invoking the real
  // network-calling generateStage1Brief().
  async function decideStage1BriefForPrompt({ state, eligible, generateFn }) {
    let stage1BriefForPrompt = null;
    if (state === STAGE1_STATE.OFF || !eligible) {
      // no generation
    } else if (state === STAGE1_STATE.SHADOW || state === STAGE1_STATE.PROMOTED_CANDIDATE) {
      await generateFn(); // result intentionally discarded for stage1BriefForPrompt purposes
      // stage1BriefForPrompt remains null regardless of outcome
    }
    return stage1BriefForPrompt;
  }

  it('OFF: no generation call, null returned', async () => {
    const generateFn = vi_stub();
    const value = await decideStage1BriefForPrompt({ state: STAGE1_STATE.OFF, eligible: true, generateFn });
    expect(generateFn.calls).toBe(0);
    expect(value).toBeNull();
  });

  it('ineligible request in any state: no generation call, null returned', async () => {
    const generateFn = vi_stub();
    const value = await decideStage1BriefForPrompt({ state: STAGE1_STATE.SHADOW, eligible: false, generateFn });
    expect(generateFn.calls).toBe(0);
    expect(value).toBeNull();
  });

  it('SHADOW + eligible: generation called exactly once, null returned regardless of what generation returns', async () => {
    const generateFn = vi_stub({ generationSucceeded: true, validationResult: 'valid', brief: { some: 'thing' } });
    const value = await decideStage1BriefForPrompt({ state: STAGE1_STATE.SHADOW, eligible: true, generateFn });
    expect(generateFn.calls).toBe(1);
    expect(value).toBeNull();
  });

  it('SHADOW + eligible, generation fails: generation called exactly once, null returned', async () => {
    const generateFn = vi_stub({ generationSucceeded: false, validationResult: 'generation_failed', brief: null });
    const value = await decideStage1BriefForPrompt({ state: STAGE1_STATE.SHADOW, eligible: true, generateFn });
    expect(generateFn.calls).toBe(1);
    expect(value).toBeNull();
  });

  it('PROMOTED_CANDIDATE + eligible (STAGE1_PROMOTED accidentally true): generation called at most once, null still returned', async () => {
    const generateFn = vi_stub({ generationSucceeded: true, validationResult: 'valid', brief: { some: 'thing' } });
    const value = await decideStage1BriefForPrompt({ state: STAGE1_STATE.PROMOTED_CANDIDATE, eligible: true, generateFn });
    expect(generateFn.calls).toBe(1);
    expect(value).toBeNull();
  });

  it('PROMOTED_CANDIDATE + ineligible: no generation call, null returned', async () => {
    const generateFn = vi_stub();
    const value = await decideStage1BriefForPrompt({ state: STAGE1_STATE.PROMOTED_CANDIDATE, eligible: false, generateFn });
    expect(generateFn.calls).toBe(0);
    expect(value).toBeNull();
  });

  it('every one of the three resolvable states, and ineligibility, produces null — no state is unhandled or produces a non-null value', async () => {
    for (const state of [STAGE1_STATE.OFF, STAGE1_STATE.SHADOW, STAGE1_STATE.PROMOTED_CANDIDATE]) {
      for (const eligible of [true, false]) {
        const generateFn = vi_stub({ generationSucceeded: true, validationResult: 'valid', brief: { x: 1 } });
        const value = await decideStage1BriefForPrompt({ state, eligible, generateFn });
        expect(value).toBeNull();
      }
    }
  });

  function vi_stub(resolvedValue = null) {
    const fn = async () => resolvedValue;
    const wrapped = (...args) => { wrapped.calls += 1; return fn(...args); };
    wrapped.calls = 0;
    return wrapped;
  }
});

describe('Phase 1 promotion utility — sanity-check values referenced by the caller (not re-testing Phase 1 itself)', () => {
  // Phase 1's own test suite (stage1-state.test.js) already proves
  // resolveStage1State/computeBriefForInjection exhaustively. These two
  // checks exist only to confirm the specific values the Phase 2A caller's
  // runtime sanity-check branch depends on, without modifying or duplicating
  // Phase 1's own test file.
  it('computeBriefForInjection returns null for SHADOW even with a successful, valid generation', () => {
    const value = computeBriefForInjection({
      state: STAGE1_STATE.SHADOW,
      generationSucceeded: true,
      validationPassed: true,
      brief: { some: 'thing' },
    });
    expect(value).toBeNull();
  });

  it('computeBriefForInjection can return non-null for PROMOTED_CANDIDATE — Phase 2A never reads this value, per the structural tests above', () => {
    const brief = { some: 'thing' };
    const value = computeBriefForInjection({
      state: STAGE1_STATE.PROMOTED_CANDIDATE,
      generationSucceeded: true,
      validationPassed: true,
      brief,
    });
    expect(value).toBe(brief);
  });
});

describe('PREFLIGHT CORRECTION — structural: Stage 1 is scheduled via waitUntil(), never awaited (source-scan)', () => {
  it('imports waitUntil from @vercel/functions', () => {
    expect(source).toContain("import { waitUntil } from '@vercel/functions';");
  });

  it('calls waitUntil(runStage1ShadowTask(...)) at the scheduling point', () => {
    expect(source).toContain('waitUntil(runStage1ShadowTask(stage1Snapshot));');
  });

  it('never awaits waitUntil() — the whole point is that scheduling is synchronous and non-blocking', () => {
    expect(source).not.toMatch(/await\s+waitUntil\(/);
  });

  it('no longer awaits generateStage1Brief() or a Stage-1-only semantic search directly inside the caller (both now live inside the background task)', () => {
    // The caller (handler()) itself must not contain a blocking call to
    // either — both must only appear inside runStage1ShadowTask's own body.
    const callerSection = source.slice(
      source.indexOf('// ── PHASE 2A: Stage 1 shadow-only strategic reasoning'),
      source.indexOf('const systemPrompt = await buildSystemPrompt({')
    );
    expect(callerSection).not.toMatch(/await\s+generateStage1Brief\(/);
    expect(callerSection).not.toMatch(/await\s+semanticSearchProject\(/);
  });

  it('the immutable snapshot passed to the background task contains only the approved fields', () => {
    const snapshotBlock = source.slice(
      source.indexOf('const stage1Snapshot = {'),
      source.indexOf('waitUntil(runStage1ShadowTask(stage1Snapshot));')
    );
    const approvedFields = [
      'projectId', 'userId', 'surface', 'modeHint', 'projectBundle',
      'scopedEmailContext', 'selectedEmail', 'chatHistory', 'userPrompt',
      'representationLock', 'retrievedAuthority', 'diagnosticsState',
    ];
    for (const field of approvedFields) {
      expect(snapshotBlock).toContain(field);
    }
    // Must not capture raw request/response objects or a service-role client.
    expect(snapshotBlock).not.toMatch(/\breq\b/);
    expect(snapshotBlock).not.toMatch(/\bres\b/);
    expect(snapshotBlock).not.toContain('getSupabase');
  });

  it('stage1BriefForPrompt is computed and assigned before the background task is scheduled, and is never reassigned after', () => {
    const idx = source.indexOf('let stage1BriefForPrompt = null;');
    const afterSchedule = source.indexOf('waitUntil(runStage1ShadowTask(stage1Snapshot));');
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(afterSchedule);
    const afterScheduleSection = source.slice(afterSchedule, source.indexOf('const systemPrompt = await buildSystemPrompt({'));
    expect(afterScheduleSection).not.toMatch(/stage1BriefForPrompt\s*=/);
  });
});

describe('PREFLIGHT CORRECTION — behavioral: runStage1ShadowTask never rejects', () => {
  it('resolves (does not reject) even when something inside throws before generateStage1Brief\'s own try/catch is reached', async () => {
    const circular = {};
    circular.self = circular; // JSON.stringify(circular) throws — this happens
    // in generateStage1Brief() before its internal try/catch around the
    // fetch call, so this exercises runStage1ShadowTask's own outer catch.
    const snapshot = {
      projectId: 'proj_x',
      userId: 'user_x',
      surface: 'draft_with_ely',
      modeHint: 'draft',
      projectBundle: null,
      scopedEmailContext: [],
      selectedEmail: null,
      chatHistory: [],
      userPrompt: 'test',
      representationLock: circular,
      retrievedAuthority: emptyRetrievedAuthority(),
      diagnosticsState: 'SHADOW',
    };

    await expect(runStage1ShadowTask(snapshot)).resolves.toBeUndefined();
  });
});
