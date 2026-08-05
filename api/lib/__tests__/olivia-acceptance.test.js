import { describe, it, expect } from 'vitest';
import { validateBriefShape } from '../stage1-schema.js';
import { applyDependencyValidation } from '../stage1-dependency-graph.js';
import { oliviaBrief, oliviaSourceIdMap } from './fixtures.js';

// This test file directly exercises the fixture defined in
// IMPLEMENTATION_READY_OLIVIA_TEST.md against the Phase 1 modules. It does
// not call a real model — the fixture in fixtures.js represents what a
// correct Terra output should look like; these tests prove the validation
// pipeline handles it correctly, not that Terra will produce it (that is a
// Phase 6 human-review question, not a Phase 1 unit-test question).

describe('Olivia acceptance test: structural shape', () => {
  it('the fixture is structurally valid per the implementation-ready schema', () => {
    const result = validateBriefShape(oliviaBrief());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('concession_01 is referenced only as a reinforcement dependency, never as a required one', () => {
    const brief = oliviaBrief();
    expect(brief.candidate_arguments[0].required_finding_ids).toEqual(['change_01']);
    expect(brief.candidate_arguments[0].required_finding_ids).not.toContain('concession_01');
    expect(brief.decisive_issue.required_dependency_ids).toEqual(['change_01']);
    expect(brief.decisive_issue.required_dependency_ids).not.toContain('concession_01');
    expect(brief.decisive_issue.supporting_dependency_ids).toEqual(['concession_01']);
  });
});

describe('Olivia acceptance test: pass condition (both sources verify)', () => {
  it('validates in full with no removals when both change_01 and concession_01 verify', () => {
    const result = applyDependencyValidation(oliviaBrief(), oliviaSourceIdMap());
    expect(result.valid).toBe(true);
    expect(result.removedReinforcements).toEqual([]);
    expect(result.brief.decisive_issue.exists).toBe(true);
    expect(result.brief.decisive_issue.argument_id).toBe('arg_01');
    expect(result.brief.decisive_issue.supporting_dependency_ids).toEqual(['concession_01']);
  });
});

describe('Olivia sub-test A: required dependency (change_01) fails', () => {
  it('invalidates the whole brief when the contractor-appointment evidence fails, regardless of concession_01 validity', () => {
    const sourceIdMap = oliviaSourceIdMap();
    // Corrupt only the contractor-appointment excerpt.
    sourceIdMap.email_0001 = 'This message no longer mentions any contractor appointment at all.';

    const result = applyDependencyValidation(oliviaBrief(), sourceIdMap);

    expect(result.valid).toBe(false);
    expect(result.brief).toBeNull();
    expect(result.invalidationReason).toMatch(/top-ranked argument|decisive_issue/);
  });
});

describe('Olivia sub-test B: supporting dependency (concession_01) fails', () => {
  it('removes the reinforcement, preserves core_argument and core_reason byte-for-byte, and keeps the brief valid', () => {
    const brief = oliviaBrief();
    const originalCoreArgument = brief.candidate_arguments[0].core_argument;
    const originalCoreReason = brief.decisive_issue.core_reason;

    const sourceIdMap = oliviaSourceIdMap();
    // Corrupt only Olivia's acceptance excerpt — change_01 remains valid.
    sourceIdMap.email_0002 = 'This message no longer contains any acceptance of responsibility.';

    const result = applyDependencyValidation(brief, sourceIdMap);

    // Whole brief remains valid.
    expect(result.valid).toBe(true);
    expect(result.brief).not.toBeNull();

    // Both reinforcement objects (one on the argument, one on decisive_issue)
    // pointing at concession_01 are removed.
    expect(result.removedReinforcements).toEqual(
      expect.arrayContaining([
        { owner: 'arg_01', reinforcement_id: 'reinforcement_01' },
        { owner: 'decisive_issue', reinforcement_id: 'reinforcement_02' },
      ])
    );
    expect(result.removedReinforcements).toHaveLength(2);

    // The concession finding itself is dropped from the top-level array.
    expect(result.brief.express_concessions_and_admissions).toEqual([]);

    // decisive_issue and the argument both survive, on change_01 alone.
    expect(result.brief.decisive_issue.exists).toBe(true);
    expect(result.brief.decisive_issue.argument_id).toBe('arg_01');
    expect(result.brief.decisive_issue.required_dependency_ids).toEqual(['change_01']);
    expect(result.brief.decisive_issue.supporting_dependency_ids).toEqual([]); // no surviving reinforcement
    expect(result.brief.candidate_arguments).toHaveLength(1);
    expect(result.brief.candidate_arguments[0].reinforcements).toEqual([]);

    // The critical correction: JavaScript never rewrites core_argument/core_reason.
    expect(result.brief.candidate_arguments[0].core_argument).toBe(originalCoreArgument);
    expect(result.brief.decisive_issue.core_reason).toBe(originalCoreReason);
  });
});
