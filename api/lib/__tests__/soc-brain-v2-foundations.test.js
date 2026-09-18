// api/lib/__tests__/soc-brain-v2-foundations.test.js
//
// Phase B foundation tests — SOC v2 canonical brain modules.
// These modules are not yet wired into any live path; these tests
// confirm the foundations themselves are correct in isolation, per
// the Master Instructions' requirement not to claim success from
// compilation alone.

import { describe, it, expect } from 'vitest';
import { UNIVERSAL_SOC_BRAIN_V2, UNIVERSAL_SOC_BRAIN_VERSION } from '../soc-brain-v2/universal-soc-brain.js';
import { USER_SOC_BRAIN_V2, USER_SOC_BRAIN_VERSION, buildUserSocBrainContext } from '../soc-brain-v2/user-soc-brain.js';
import { SOC_V2_VERSIONS } from '../soc-brain-v2/versions.js';

describe('Universal SOC Brain v2 (canonical module)', () => {
  it('is the verbatim supplied specification, not a summary or rewrite', () => {
    expect(UNIVERSAL_SOC_BRAIN_V2).toContain('You perform two connected but distinct professional functions');
    expect(UNIVERSAL_SOC_BRAIN_V2).toContain('RETURNING TO A PREVIOUS SECTION');
    expect(UNIVERSAL_SOC_BRAIN_V2).toContain('SECTION ORDER');
    expect(UNIVERSAL_SOC_BRAIN_V2.length).toBe(22581);
  });

  it('does not contain fixture-specific contamination (the class of bug found live in SOC_MASTER_V1)', () => {
    expect(UNIVERSAL_SOC_BRAIN_V2).not.toContain('500mm');
    expect(UNIVERSAL_SOC_BRAIN_V2).not.toContain('intermittently');
  });

  it('does not instruct structural floor-based section ordering (explicitly prohibited by the spec itself)', () => {
    expect(UNIVERSAL_SOC_BRAIN_V2).not.toMatch(/Ground floor.*First floor.*Loft.*External/s);
    expect(UNIVERSAL_SOC_BRAIN_V2).toContain('Do not reorganise sections according to floor level');
  });

  it('has a defined version', () => {
    expect(UNIVERSAL_SOC_BRAIN_VERSION).toBe('v2.0.0');
  });
});

describe('User SOC Brain v2 (canonical module)', () => {
  it('is the verbatim supplied specification', () => {
    expect(USER_SOC_BRAIN_V2).toContain('Learn the surveyor\'s professional drafting style, not new facts from');
    expect(USER_SOC_BRAIN_V2).toContain('Gold-standard documents are style references, not factual precedents');
    expect(USER_SOC_BRAIN_V2.length).toBe(15814);
  });

  it('has a defined version', () => {
    expect(USER_SOC_BRAIN_VERSION).toBe('v2.0.0');
  });
});

describe('buildUserSocBrainContext — runtime assembly helper', () => {
  it('returns exactly the base governing text when the user has no stored preferences or example', () => {
    const ctx = buildUserSocBrainContext({});
    expect(ctx).toBe(USER_SOC_BRAIN_V2);
  });

  it('appends stated style preferences, clearly labelled, when present', () => {
    const ctx = buildUserSocBrainContext({ soc_style_preferences: 'Prefer short sentences.' });
    expect(ctx).toContain(USER_SOC_BRAIN_V2);
    expect(ctx).toContain('STATED STYLE PREFERENCES');
    expect(ctx).toContain('Prefer short sentences.');
  });

  it('appends the gold-standard example, explicitly labelled as style-only, not a source of evidence', () => {
    const ctx = buildUserSocBrainContext({ soc_gold_standard: 'EXAMPLE SOC TEXT HERE' });
    expect(ctx).toContain('style reference only');
    expect(ctx).toContain('never a source of evidence for the current property');
    expect(ctx).toContain('EXAMPLE SOC TEXT HERE');
  });

  it('ignores blank/whitespace-only fields rather than appending an empty section', () => {
    const ctx = buildUserSocBrainContext({ soc_style_preferences: '   ', soc_gold_standard: '' });
    expect(ctx).toBe(USER_SOC_BRAIN_V2);
  });
});

describe('SOC_V2_VERSIONS — central version registry', () => {
  it('tracks the two components actually built this phase', () => {
    expect(SOC_V2_VERSIONS.universal_soc_brain).toBe('v2.0.0');
    expect(SOC_V2_VERSIONS.user_soc_brain).toBe('v2.0.0');
    expect(SOC_V2_VERSIONS.inspection_state_contract).toBe('v1.0.0');
  });

  it('honestly represents not-yet-implemented components as null, not a placeholder version string', () => {
    expect(SOC_V2_VERSIONS.reconciliation_contract).toBeNull();
    expect(SOC_V2_VERSIONS.drafting_contract).toBeNull();
    expect(SOC_V2_VERSIONS.fidelity_audit).toBeNull();
    expect(SOC_V2_VERSIONS.quality_audit).toBeNull();
  });
});
