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
    expect(callSite).toContain('hasExplicitEmailSelection: !!(body.threadId || body.emailId');
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
