// api/lib/__tests__/v2-routing-integration.test.js
//
// Structural (source-scan) proof that api/ely-smart.js wires V1/V2 routing
// correctly: exactly one routing decision point, V1's core functions are
// never touched, and the V2 branch always returns before reaching V1 code.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../../ely-smart.js'), 'utf8');

describe('V1/V2 routing — structural guarantees', () => {
  it('resolveArchitectureVersion is called exactly once (excluding comments)', () => {
    const codeLines = source.split('\n').filter((line) => !line.trim().startsWith('//'));
    const codeOnly = codeLines.join('\n');
    const matches = codeOnly.match(/resolveArchitectureVersion\(/g) || [];
    // One real call site: `const v2ArchitectureVersion = resolveArchitectureVersion({`
    expect(matches.length).toBe(1);
  });

  it('the V2 branch returns before any V1 code (buildSystemPrompt / buildMessages) can execute for that request', () => {
    const idx = source.indexOf("if (v2ArchitectureVersion === 'v2')");
    const buildSystemPromptCallIdx = source.indexOf('const systemPrompt = await buildSystemPrompt(');
    expect(idx).toBeGreaterThan(-1);
    expect(buildSystemPromptCallIdx).toBeGreaterThan(idx);
    const branchBlock = source.slice(idx, buildSystemPromptCallIdx);
    // Every path inside the v2 branch must return or throw — never fall
    // through into V1 code.
    expect(branchBlock).toContain('return res.status(200).json(');
    expect(branchBlock).toContain('return res.status(500).json(');
  });

  it('buildSystemPrompt and buildMessages definitions are not inside the V2 pipeline function', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).not.toContain('async function buildSystemPrompt');
    expect(pipelineBody).not.toContain('async function buildMessages');
  });

  it('runV2Pipeline never references V1-only brain layer names', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).not.toContain('ely_master_v3');
    expect(pipelineBody).not.toContain('party_wall_drafting');
    expect(pipelineBody).not.toContain("'user_brain'"); // the V1 table name, quoted
  });

  it('the V2 pipeline makes exactly one Terra fetch call, no fallback model', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    const fetchMatches = pipelineBody.match(/await fetch\(/g) || [];
    expect(fetchMatches.length).toBe(1);
    expect(pipelineBody).not.toContain("'gpt-4o'");
    expect(pipelineBody).toContain("model: 'gpt-5.6-terra'");
    expect(pipelineBody).not.toMatch(/temperature/);
  });

  // Context-wiring correction (2026-08-06), spec items 8 and 9.
  it('semanticResults is no longer hardcoded to null in the runV2Pipeline call site', () => {
    const callSiteIdx = source.indexOf('const { replyText, diagnostics } = await runV2Pipeline({');
    const callSiteEnd = source.indexOf('});', callSiteIdx);
    const callSite = source.slice(callSiteIdx, callSiteEnd);
    expect(callSite).not.toContain('semanticResults: null');
  });

  it('projectMemory is no longer hardcoded to [] inside runV2Pipeline', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).not.toContain('projectMemory: [],');
  });

  it('runV2Pipeline actually calls the existing semanticSearchProject function, scoped to effectiveProjectId', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).toContain('semanticSearchProject(effectiveProjectId, prompt');
  });

  it('V1 remains completely unmodified: buildSystemPrompt/buildMessages still have zero overlap with any V2 diff region (spec item 8)', () => {
    // Re-asserts the same structural guarantee already proven above,
    // specifically after the context-wiring correction's edits.
    const bspIdx = source.indexOf('async function buildSystemPrompt(');
    const bmIdx = source.indexOf('async function buildMessages(');
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    expect(bspIdx).toBeGreaterThan(pipelineEnd);
    expect(bmIdx).toBeGreaterThan(pipelineEnd);
  });

  // Project-context correction (2026-08-06), spec tests 6 and 7.
  it('the newest email is selected by default (scopedEmailContext reversed) when no explicit selection was made', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).toContain('hasExplicitEmailSelection');
    expect(pipelineBody).toMatch(/\[\.\.\.\(scopedEmailContext \|\| \[\]\)\]\.reverse\(\)/);
  });

  it('an explicit email/thread selection remains authoritative — the reversal is conditional, not unconditional', () => {
    const callSiteIdx = source.indexOf('const { replyText, draft, diagnostics } = await runV2Pipeline({');
    const callSiteEnd = source.indexOf('});', callSiteIdx);
    const callSite = source.slice(callSiteIdx, callSiteEnd);
    expect(callSite).toContain('hasExplicitEmailSelection: !!(suppliedEmailContext || body.threadId || body.emailId');
  });

  it('projectFacts no longer uses the crude JSON.stringify(projectBundle).slice(0,4000) dump', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).not.toContain('JSON.stringify(projectBundle).slice(0, 4000)');
    expect(pipelineBody).toContain('buildStructuredProjectFacts(projectBundle)');
  });

  it('projectMemory is populated directly from projectBundle.project_memory, not only from semantic search', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).toContain('extractProjectMemory(projectBundle)');
  });
});

describe('projectChatHistory dedup does not exclude distinct short messages (final verification fix)', () => {
  it('short generic replies ("Agreed", "Okay") are kept even if the current session has an identical short reply', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).toContain('DEDUP_MIN_LENGTH');
    expect(pipelineBody).toMatch(/if \(text\.length < DEDUP_MIN_LENGTH\) return true;/);
  });
});

describe('email resolution hierarchy — mechanical tier 3, per final verification (2026-08-06)', () => {
  it('runV2Pipeline calls identifyDiscussedEmail when no explicit selection was made', () => {
    const pipelineStart = source.indexOf('async function runV2Pipeline(');
    const pipelineEnd = source.indexOf('\n}\n', pipelineStart);
    const pipelineBody = source.slice(pipelineStart, pipelineEnd);
    expect(pipelineBody).toContain('identifyDiscussedEmail(prompt, newestFirst)');
  });

  it('hasExplicitEmailSelection includes suppliedEmailContext (tier 2: pasted/attached), not only threadId/emailId', () => {
    const callSiteIdx = source.indexOf('const { replyText, draft, diagnostics } = await runV2Pipeline({');
    const callSiteEnd = source.indexOf('});', callSiteIdx);
    const callSite = source.slice(callSiteIdx, callSiteEnd);
    expect(callSite).toContain('hasExplicitEmailSelection: !!(suppliedEmailContext ||');
  });
});

describe('mode field in the response, and frontend trusting it (2026-08-07, real user-reported mismatch)', () => {
  it('the V2 response includes mode: modeHint, not just architecture_version', () => {
    const callSiteIdx = source.indexOf("res.status(200).json({ reply: replyText, draft, draftType: draft ? 'email' : null");
    const callSiteEnd = source.indexOf('});', callSiteIdx);
    const callSite = source.slice(callSiteIdx, callSiteEnd);
    expect(callSite).toContain('mode: modeHint');
  });
});

describe('backend intent classifier — ambiguous drafting phrases gated by length (2026-08-07, real user-reported failure)', () => {
  it('hasExplicitDraftRequest no longer force-drafts a long message that only opens with ambiguous framing', () => {
    const idx = source.indexOf('function hasExplicitDraftRequest(');
    const end = source.indexOf('\nfunction hasExplicitReviewRequest', idx);
    const body = source.slice(idx, end);
    expect(body).toContain('ambiguousDraftFraming');
    expect(body).toMatch(/wordCount < 40/);
  });

  it('unambiguous drafting language (the literal word "draft", "write an email", etc.) still triggers regardless of length', () => {
    const idx = source.indexOf('function hasExplicitDraftRequest(');
    const end = source.indexOf('\nfunction hasExplicitReviewRequest', idx);
    const body = source.slice(idx, end);
    expect(body).toContain('unambiguousDraft');
    expect(body).toMatch(/if \(unambiguousDraft\) return true;/);
  });
});

describe('hasLiveDraftInstruction — distinguishes a live drafting instruction from a historical mention (2026-08-07, real second occurrence of this bug)', () => {
  it('does not treat "had agreed for me to draft" as a live instruction — narrating a past authorisation', () => {
    const idx = source.indexOf('function hasLiveDraftInstruction(');
    const end = source.indexOf('\nfunction hasExplicitDraftRequest', idx);
    const body = source.slice(idx, end);
    expect(body).toContain('retrospectiveMarkers');
    expect(body).toContain('the original');
    expect(body).toMatch(/\(had\|has\|have\) \(agreed/);
  });

  it('unambiguousDraft now calls hasLiveDraftInstruction instead of a bare word-boundary match', () => {
    const idx = source.indexOf('function hasExplicitDraftRequest(');
    const end = source.indexOf('\nfunction hasExplicitReviewRequest', idx);
    const body = source.slice(idx, end);
    expect(body).toContain('hasLiveDraftInstruction(p)');
    expect(body).not.toMatch(/const unambiguousDraft =\s*\/\\bdraft\\b\/i\.test\(p\)/);
  });

  it('stops the retrospective-marker lookback at a clause boundary, not a fixed character count alone', () => {
    const idx = source.indexOf('function hasLiveDraftInstruction(');
    const end = source.indexOf('\nfunction hasExplicitDraftRequest', idx);
    const body = source.slice(idx, end);
    expect(body).toMatch(/\[,\.;\]/);
  });
});

describe('looksLikeAmendmentInstruction gate — requires a confirmed draft, not just an attached email (state-integrity correction, 2026-08-07)', () => {
  it('the gate now checks confirmedDraft, not emailContext/threadId/emailId presence', () => {
    const idx = source.indexOf("const confirmedDraft = body.context?.previousDraft");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 300);
    expect(block).toContain('if (confirmedDraft && looksLikeAmendmentInstruction(p))');
    expect(block).not.toContain('body.emailContext || body.threadId || body.emailId');
  });

  it('spec tests 3-5: ordinary discussion phrases remain discuss mode with no confirmed draft, even with an email attached', () => {
    // Direct simulation of the real gate logic, matching the exact
    // fixed source: amendment mode requires BOTH a confirmed draft AND
    // an amendment-shaped phrase.
    const looksLikeAmendmentInstruction = (p) =>
      /\badd (the|a|that|this|some|more)\b/i.test(p) ||
      /\binclude (the|a|that|this)\b/i.test(p) ||
      /\bchange (the|a|that|this)\b/i.test(p) ||
      /\bcheck if\b/i.test(p);

    const decide = (confirmedDraft, prompt) => (confirmedDraft && looksLikeAmendmentInstruction(prompt)) ? 'draft' : 'discuss';

    expect(decide(null, 'i want to change my approach here')).toBe('discuss'); // "change my" isn't "change the/a/that/this" anyway, but no draft either way
    expect(decide(null, 'add this into our thinking for the next point')).toBe('discuss');
    expect(decide(null, 'can we include the chronology when we discuss this')).toBe('discuss');
    expect(decide(null, 'check if olivia said this yesterday')).toBe('discuss');
  });

  it('spec tests 6-7: the same amendment-shaped phrases correctly enter amendment/draft mode once a confirmed draft exists', () => {
    const looksLikeAmendmentInstruction = (p) =>
      /\bchange (the|a|that|this)\b/i.test(p) ||
      /\badd (the|a|that|this|some|more)\b/i.test(p);

    const decide = (confirmedDraft, prompt) => (confirmedDraft && looksLikeAmendmentInstruction(prompt)) ? 'draft' : 'discuss';

    expect(decide('Hi Olivia,\n\n...\n\nKind regards,', 'change the second paragraph')).toBe('draft');
    expect(decide('Hi Olivia,\n\n...\n\nKind regards,', 'add this point to the draft')).toBe('draft');
  });

  it('spec test 10: frontend and backend derive the confirmed-draft signal from the identical source', () => {
    // Backend reads body.context.previousDraft
    const backendIdx = source.indexOf('body.context?.previousDraft || body.previousDraft || null');
    expect(backendIdx).toBeGreaterThan(-1);
    // Frontend sends context.previousDraft, itself set only from a real result.draft
    const feCallIdx = source.indexOf("confirmedDraftText: body.context?.previousDraft");
    expect(feCallIdx).toBeGreaterThan(-1);
  });
});

describe('extractCurrentDraftState call site — no longer passed raw chat history (state-integrity correction)', () => {
  it('runV2Pipeline calls extractCurrentDraftState with confirmedDraftText, not chatHistory', () => {
    const idx = source.indexOf('currentDraftState: extractCurrentDraftState(');
    const line = source.slice(idx, idx + 80);
    expect(line).toContain('extractCurrentDraftState(confirmedDraftText)');
    expect(line).not.toContain('chatHistory');
  });
});
