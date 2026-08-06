import { describe, it, expect } from 'vitest';
import { assembleV2Prompt, buildSurfaceContract } from '../v2-prompt-assembly.js';

describe('assembleV2Prompt — section order', () => {
  it('orders sections: universal brain, representation, voice, gold standard, domain, working memory, surface contract, final validation', () => {
    const { sections } = assembleV2Prompt({
      universalBrain: 'UB',
      effectiveVoice: { text: 'VOICE' },
      goldStandardBlock: { text: 'GS' },
      domainKnowledge: 'DOMAIN',
      workingMemory: { included: [{ category: 'selectedEmail', source_id: 'e1', date: null, content: 'body' }] },
      surface: 'inbox_draft',
      modeHint: 'draft',
      representationLock: 'REP',
    });
    const names = sections.map((s) => s.name);
    expect(names).toEqual([
      'universal_brain',
      'representation_lock',
      'effective_voice',
      'gold_standard_examples',
      'domain_knowledge',
      'dynamic_working_memory',
      'surface_contract',
      'final_validation',
    ]);
  });

  it('the Universal Brain is always first', () => {
    const { sections } = assembleV2Prompt({ universalBrain: 'UB', effectiveVoice: { text: 'V' }, surface: 'main_chat', modeHint: 'discuss' });
    expect(sections[0].name).toBe('universal_brain');
  });

  it('final_validation is always last among non-empty sections', () => {
    const { sections } = assembleV2Prompt({ universalBrain: 'UB', effectiveVoice: { text: 'V' }, surface: 'main_chat', modeHint: 'discuss' });
    expect(sections[sections.length - 1].name).toBe('final_validation');
  });

  it('empty/absent optional sections (representation, gold standard, domain, memory) are omitted, not left as blank placeholders', () => {
    const { prompt, sections } = assembleV2Prompt({
      universalBrain: 'UB',
      effectiveVoice: { text: 'V' },
      surface: 'main_chat',
      modeHint: 'discuss',
    });
    const names = sections.map((s) => s.name);
    expect(names).not.toContain('representation_lock');
    expect(names).not.toContain('gold_standard_examples');
    expect(names).not.toContain('domain_knowledge');
    expect(names).not.toContain('dynamic_working_memory');
    expect(prompt).not.toMatch(/undefined|null/);
  });
});

describe('buildSurfaceContract', () => {
  it('produces the discuss-mode Project Chat contract when surface is project_chat and mode is not draft', () => {
    const contract = buildSurfaceContract('project_chat', 'discuss');
    expect(contract).toMatch(/Project Chat, discuss mode/);
    expect(contract).toMatch(/draft only when asked/);
  });

  it('produces the Main Chat contract, including the representation-confusion safeguard', () => {
    const contract = buildSurfaceContract('main_chat', 'discuss');
    expect(contract).toMatch(/Main Chat/);
    expect(contract).toMatch(/Do not confuse the authenticated user with email senders/);
  });

  it('produces the draft contract regardless of surface, when mode is draft', () => {
    const contract = buildSurfaceContract('project_chat', 'draft');
    expect(contract).toMatch(/SURFACE: Draft/);
    expect(contract).toMatch(/kept separate/);
  });

  it('falls back to a generic contract for an unrecognised surface', () => {
    const contract = buildSurfaceContract('unknown_surface', 'discuss');
    expect(contract).toContain('unknown_surface');
  });
});
