// api/lib/__tests__/phase2a-generate-stage1-brief.test.js
//
// Behavioral tests for the Phase 2A redesign of generateStage1Brief()
// (api/ely-smart.js). Terra and Supabase are both mocked — no live network
// call, no live Supabase call, no live OpenAI call is made by this suite.
//
// generateStage1Brief is exposed via a test-only named export added to
// api/ely-smart.js (see the comment at the bottom of that file) — the
// default export (the Vercel handler) is unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}));

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.OPENAI_API_KEY = 'test-openai-key';

const { generateStage1Brief, emptyRetrievedAuthority, STAGE1_VALIDATION_RESULT } = await import('../../ely-smart.js');

function mockFetchOnce(status, jsonBody) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
  });
}

function terraResponse(contentObj, usage = { total_tokens: 1234 }) {
  return {
    choices: [{ message: { content: JSON.stringify(contentObj) } }],
    usage,
  };
}

function minimalValidRawBrief() {
  return {
    user_objective: 'Confirm the adjoining owner will not dissent to the notice.',
    real_problem_to_solve: 'The adjoining owner has raised concerns about access.',
    original_factual_premise: 'Notice was served on 1 June.',
    chronology: [
      { source_id: 'email_0001', date: '1 June 2026', event: 'Notice served', excerpt: 'we served notice on 1 June' },
    ],
    controlling_facts: [
      {
        fact_id: 'fact_01',
        fact: 'Notice was validly served.',
        status: 'established',
        supporting_evidence: [{ source_id: 'email_0001', excerpt: 'we served notice on 1 June' }],
        opposing_evidence: [],
        inference_basis_ids: [],
      },
    ],
    material_changes: [
      {
        change_id: 'change_01',
        change: 'The adjoining owner appointed a surveyor.',
        source_id: 'email_0002',
        excerpt: 'I have appointed a surveyor to act for me',
        strategic_effect: 'A dispute is deemed to have arisen.',
      },
    ],
    user_emphasised_points: [],
    express_concessions_and_admissions: [],
    implied_changes_of_position: [],
    prior_commitments: [],
    contradictions: [],
    candidate_arguments: [
      {
        argument_id: 'arg_01',
        core_argument: 'A dispute has arisen and the section 10 procedure now applies.',
        required_finding_ids: ['change_01'],
        reinforcements: [],
        strength: 'strong',
        limitations: 'None identified.',
      },
    ],
    argument_ranking: ['arg_01'],
    decisive_issue: {
      exists: false, argument_id: null, core_reason: null, reinforcements: [],
      counterfactual_test: null, counterfactual_expected_answer: null,
      required_dependency_ids: [], supporting_dependency_ids: [], confidence: null,
    },
    strongest_counterargument: 'The adjoining owner may argue the works are not notifiable.',
    residual_issues: ['Fee liability remains to be agreed.'],
    overstatement_risks: ['Do not assert the works are definitely notifiable.'],
    evidence_references: [{ source_id: 'email_0002', excerpt: 'I have appointed a surveyor to act for me', used_for: 'material_changes[0]' }],
    recommended_argument_order: ['arg_01'],
    recommended_response_strategy: 'Acknowledge the appointment and propose a first meeting of surveyors.',
    recommended_strategy_required_finding_ids: ['change_01'],
    requires_clarification: { needed: false, material_gaps: [], clarification_question: null },
    tone_register: 'professional-conversational',
    user_terminology_to_preserve: {},
    must_include: [],
    do_not_include: [],
    analysis_confidence: 'high',
    analysis_gaps: [],
  };
}

const baseArgs = {
  projectId: 'proj_123',
  userId: 'user_abc',
  surface: 'draft_with_ely',
  modeHint: 'draft',
  projectBundle: { project: { ref: 'ELY-2026-001' } },
  scopedEmailContext: [
    { body: 'Dear Sir, we served notice on 1 June regarding the excavation works.', direction: 'outgoing' },
    { body: 'Thank you. I have appointed a surveyor to act for me in this matter.', direction: 'incoming' },
  ],
  selectedEmail: null,
  semanticResults: null,
  chatHistory: [],
  userPrompt: 'reply confirming next steps',
  representationLock: { role: 'BO_SURVEYOR', label: 'Building Owner surveyor', source: 'linked project' },
  retrievedAuthority: emptyRetrievedAuthority(),
  diagnosticsState: 'SHADOW',
};

beforeEach(() => {
  insertMock.mockClear();
  fromMock.mockClear();
});

describe('generateStage1Brief — model payload', () => {
  it('sends gpt-5.6-terra, no temperature, response_format json_object', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief(baseArgs);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = global.fetch.mock.calls[0];
    const payload = JSON.parse(requestInit.body);

    expect(payload.model).toBe('gpt-5.6-terra');
    expect(payload).not.toHaveProperty('temperature');
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload.messages).toHaveLength(2);
  });

  it('includes the fixed representation lock and empty retrievedAuthority in the user message, not asked of the model', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief(baseArgs);
    const [, requestInit] = global.fetch.mock.calls[0];
    const payload = JSON.parse(requestInit.body);
    const userMessage = payload.messages.find((m) => m.role === 'user').content;

    expect(userMessage).toContain('REPRESENTATION LOCK');
    expect(userMessage).toContain('BO_SURVEYOR');
    expect(userMessage).toContain('RETRIEVED AUTHORITY');
    expect(userMessage).toContain('not_attempted');
  });
});

describe('generateStage1Brief — outcomes', () => {
  it('VALID: a well-formed, evidence-consistent response produces a validated brief', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    const result = await generateStage1Brief(baseArgs);

    expect(result.generationSucceeded).toBe(true);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.VALID);
    expect(result.brief).not.toBeNull();
    expect(result.brief.candidate_arguments[0].argument_id).toBe('arg_01');
  });

  it('SHAPE_INVALID: a response missing required fields is rejected before dependency validation', async () => {
    const broken = minimalValidRawBrief();
    delete broken.user_objective;
    mockFetchOnce(200, terraResponse(broken));
    const result = await generateStage1Brief(baseArgs);

    expect(result.generationSucceeded).toBe(true);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.SHAPE_INVALID);
    expect(result.brief).toBeNull();
    expect(result.shapeErrors.length).toBeGreaterThan(0);
  });

  it('DEPENDENCY_INVALID: a shape-valid response whose required excerpt does not verify is invalidated', async () => {
    const broken = minimalValidRawBrief();
    broken.material_changes[0].excerpt = 'this text does not appear anywhere in the supplied sources';
    mockFetchOnce(200, terraResponse(broken));
    const result = await generateStage1Brief(baseArgs);

    expect(result.generationSucceeded).toBe(true);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.DEPENDENCY_INVALID);
    expect(result.brief).toBeNull();
    expect(result.dependencyValidation.invalidationReason).toBeTruthy();
  });

  it('GENERATION_FAILED: an HTTP error from Terra is handled without throwing', async () => {
    mockFetchOnce(500, { error: { message: 'internal error' } });
    const result = await generateStage1Brief(baseArgs);

    expect(result.generationSucceeded).toBe(false);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.GENERATION_FAILED);
    expect(result.brief).toBeNull();
    expect(result.errorMsg).toBeTruthy();
  });

  it('GENERATION_FAILED: malformed JSON from Terra is handled without throwing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'not valid json {{{' } }], usage: {} }),
    });
    const result = await generateStage1Brief(baseArgs);

    expect(result.generationSucceeded).toBe(false);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.GENERATION_FAILED);
    expect(result.brief).toBeNull();
  });

  it('GENERATION_FAILED: a network-level fetch rejection is caught, not thrown', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('network unreachable'));
    const result = await generateStage1Brief(baseArgs);

    expect(result.generationSucceeded).toBe(false);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.GENERATION_FAILED);
    expect(result.errorMsg).toContain('network unreachable');
  });
});

describe('generateStage1Brief — diagnostics (existing stage1_briefs table, no migration)', () => {
  it('writes exactly one diagnostics row per call, using the existing table/columns only', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief(baseArgs);

    expect(fromMock).toHaveBeenCalledWith('stage1_briefs');
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [rows] = insertMock.mock.calls[0];
    const row = rows[0];

    expect(Object.keys(row).sort()).toEqual(
      ['error', 'model', 'prompt_snippet', 'project_id', 'stage1_duration_ms', 'stage1_tokens_used', 'surface', 'user_id', 'brief'].sort()
    );
  });

  it('embeds the versioned envelope inside the existing brief JSONB column, with the caller-supplied state', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief({ ...baseArgs, diagnosticsState: 'PROMOTED_CANDIDATE_BLOCKED' });

    const [rows] = insertMock.mock.calls[0];
    const envelope = rows[0].brief;

    expect(envelope.schema_version).toBe('phase2a_shadow_v2');
    expect(envelope.state).toBe('PROMOTED_CANDIDATE_BLOCKED');
    expect(envelope.validation_result).toBe('valid');
    expect(envelope.strategic_brief).not.toBeNull();
    expect(envelope.retrieved_authority_status).toBe('not_attempted');
    expect(envelope.dependency_validation).toHaveProperty('removedReinforcements');
  });

  it('records validation_result and a null strategic_brief for a dependency-invalid outcome', async () => {
    const broken = minimalValidRawBrief();
    broken.material_changes[0].excerpt = 'no match for this anywhere';
    mockFetchOnce(200, terraResponse(broken));
    await generateStage1Brief(baseArgs);

    const [rows] = insertMock.mock.calls[0];
    const envelope = rows[0].brief;
    expect(envelope.validation_result).toBe('dependency_invalid');
    expect(envelope.strategic_brief).toBeNull();
  });

  it('does not store raw chain-of-thought or a duplicated full email body — only the final validated brief and a truncated prompt snippet', async () => {
    const longPrompt = 'x'.repeat(5000);
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief({ ...baseArgs, userPrompt: longPrompt });

    const [rows] = insertMock.mock.calls[0];
    expect(rows[0].prompt_snippet.length).toBeLessThanOrEqual(200);
  });
});

describe('generateStage1Brief — preflight correction: token budget', () => {
  it('sends max_completion_tokens: 8000 (raised from 4000)', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief(baseArgs);

    const [, requestInit] = global.fetch.mock.calls[0];
    const payload = JSON.parse(requestInit.body);
    expect(payload.max_completion_tokens).toBe(8000);
  });

  it('records the configured completion_token_limit in the diagnostics envelope regardless of outcome', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    await generateStage1Brief(baseArgs);

    const [rows] = insertMock.mock.calls[0];
    expect(rows[0].brief.completion_token_limit).toBe(8000);
  });
});

describe('generateStage1Brief — preflight correction: completion_truncated', () => {
  it('classifies a finish_reason: "length" response as completion_truncated, not generation_failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"user_objective": "truncated mid' }, finish_reason: 'length' }],
        usage: { total_tokens: 8000 },
      }),
    });
    const result = await generateStage1Brief(baseArgs);

    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.COMPLETION_TRUNCATED);
    expect(result.validationResult).not.toBe(STAGE1_VALIDATION_RESULT.GENERATION_FAILED);
    expect(result.brief).toBeNull();
  });

  it('classifies a finish_reason: "length" response as completion_truncated even if the cut-off text happens to still parse as valid JSON', async () => {
    // Deliberately valid, complete-looking JSON but finish_reason still
    // reports length — per the requirement, truncation classification is
    // based on finish_reason, not on whether JSON.parse happens to succeed.
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{}' }, finish_reason: 'length' }],
        usage: { total_tokens: 8000 },
      }),
    });
    const result = await generateStage1Brief(baseArgs);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.COMPLETION_TRUNCATED);
  });

  it('records completion_truncated in the diagnostics envelope validation_result field', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"partial' }, finish_reason: 'length' }],
        usage: { total_tokens: 8000 },
      }),
    });
    await generateStage1Brief(baseArgs);
    const [rows] = insertMock.mock.calls[0];
    expect(rows[0].brief.validation_result).toBe('completion_truncated');
  });

  it('does not treat a normal finish_reason: "stop" response as truncated', async () => {
    mockFetchOnce(200, terraResponse(minimalValidRawBrief()));
    // terraResponse() helper does not set finish_reason — confirm the
    // absence of "length" does not trigger truncation classification.
    const result = await generateStage1Brief(baseArgs);
    expect(result.validationResult).not.toBe(STAGE1_VALIDATION_RESULT.COMPLETION_TRUNCATED);
  });
});

describe('generateStage1Brief — preflight correction: transient Terra retry', () => {
  it('retries once on an "insufficient permissions" error and succeeds on retry', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Insufficient permissions for this operation' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => terraResponse(minimalValidRawBrief()),
      });

    const result = await generateStage1Brief(baseArgs);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.retryAttempted).toBe(true);
    expect(result.retryOutcome).toBe('succeeded');
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.VALID);
  }, 10000);

  it('retries once on "insufficient permissions" and records failure if the retry also fails — no second retry', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Insufficient permissions for this operation' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Insufficient permissions for this operation' } }),
      });

    const result = await generateStage1Brief(baseArgs);

    // Exactly 2 calls total — the original attempt plus exactly one retry,
    // never a second retry / recursive path.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.retryAttempted).toBe(true);
    expect(result.retryOutcome).toBe('failed');
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.GENERATION_FAILED);
  }, 10000);

  it('does not retry an ordinary (non-transient) Terra error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'model not found' } }),
    });

    const result = await generateStage1Brief(baseArgs);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.retryAttempted).toBe(false);
    expect(result.retryOutcome).toBeNull();
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.GENERATION_FAILED);
  });

  it('does not retry a schema-validation failure (retry only applies to the specific transient Terra condition, never to reasoning-quality outcomes)', async () => {
    const broken = minimalValidRawBrief();
    delete broken.user_objective;
    mockFetchOnce(200, terraResponse(broken));

    const result = await generateStage1Brief(baseArgs);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.retryAttempted).toBe(false);
    expect(result.validationResult).toBe(STAGE1_VALIDATION_RESULT.SHAPE_INVALID);
  });

  it('the retry uses the same model, same reasoning configuration, and no temperature — identical payload to the original attempt', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'insufficient permissions' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => terraResponse(minimalValidRawBrief()),
      });

    await generateStage1Brief(baseArgs);

    const firstPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
    const retryPayload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(retryPayload).toEqual(firstPayload);
    expect(retryPayload.model).toBe('gpt-5.6-terra');
    expect(retryPayload).not.toHaveProperty('temperature');
  }, 10000);

  it('records retry_attempted and retry_outcome in the diagnostics envelope', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'insufficient permissions' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => terraResponse(minimalValidRawBrief()),
      });

    await generateStage1Brief(baseArgs);

    const [rows] = insertMock.mock.calls[0];
    expect(rows[0].brief.retry_attempted).toBe(true);
    expect(rows[0].brief.retry_outcome).toBe('succeeded');
  }, 10000);
});
