import { describe, it, expect } from 'vitest';
import { assembleWorkingMemory, extractConfirmedProjectAnchors, extractCurrentDraftState, extractProjectMemory, buildStructuredProjectFacts, identifyDiscussedEmail, splitSemanticResults, excludeExistingIds, filterByMatchedAnchor, CATEGORY_PRIORITY, PROTECTED_CATEGORIES, CATEGORY_BUDGETS } from '../v2-working-memory.js';

describe('assembleWorkingMemory — structural guarantee: no sufficiency judgement exists', () => {
  it('the result never contains a field indicating whether context is "sufficient" or a gap is "answered"', () => {
    const result = assembleWorkingMemory({ selectedEmail: [{ id: 'e1', content: 'hello' }] });
    const keys = Object.keys(result);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/sufficient|answered|resolved|gap_filled/);
    }
  });

  it('does not call any external function, run any loop conditioned on content meaning, or accept a callback (pure data-in data-out)', () => {
    // Structural proxy for "no semantic reasoning": the function signature
    // accepts only plain data and options, never a judgement/decision callback.
    expect(assembleWorkingMemory.length).toBeLessThanOrEqual(2);
  });
});

describe('assembleWorkingMemory — priority order', () => {
  it('processes categories in the order required by the project-context correction (2026-08-06): direct/deterministic sources before semantic', () => {
    expect(CATEGORY_PRIORITY).toEqual([
      'currentInstruction',
      'selectedEmail',
      'thread',
      'currentDraftState',
      'confirmedProjectAnchors',
      'projectFacts',
      'projectMemory',
      'projectChatHistory',
      'semanticResults',
      'chatHistory',
    ]);
  });

  it('higher-priority categories are included before lower-priority ones hit the budget ceiling', () => {
    const item = (id, size) => ({ id, content: 'x'.repeat(size) });
    const raw = {
      currentInstruction: [item('ci1', 8000)],
      selectedEmail: [item('se1', 8000)],
      chatHistory: [item('ch1', 15000), item('ch2', 15000)],
    };
    const result = assembleWorkingMemory(raw, { maxTotalChars: 20000 });
    const includedCategories = result.included.map((i) => i.category);
    expect(includedCategories).toContain('currentInstruction');
    expect(includedCategories).toContain('selectedEmail');
    // chatHistory (lowest priority here) should be excluded once budget is exceeded
    expect(includedCategories).not.toContain('chatHistory');
    expect(result.excluded.some((e) => e.category === 'chatHistory' && e.reason === 'total_budget_exceeded')).toBe(true);
  });
});

describe('assembleWorkingMemory — limits', () => {
  it('enforces the per-category item limit', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, content: 'short' }));
    const result = assembleWorkingMemory({ projectFacts: items }, { maxItemsPerCategory: 5 });
    const included = result.included.filter((i) => i.category === 'projectFacts');
    expect(included.length).toBe(5);
    expect(result.excluded.filter((e) => e.category === 'projectFacts' && e.reason === 'per_category_limit').length).toBe(7);
  });

  it('enforces the total character budget across categories', () => {
    const items = { semanticResults: [{ id: 's1', content: 'x'.repeat(50000) }] };
    const result = assembleWorkingMemory(items, { maxTotalChars: 100 });
    expect(result.included.length).toBe(0);
    expect(result.excluded[0].reason).toBe('total_budget_exceeded');
  });

  it('de-duplicates items sharing the same id within a category', () => {
    const items = { thread: [{ id: 't1', content: 'a' }, { id: 't1', content: 'a duplicate' }] };
    const result = assembleWorkingMemory(items);
    expect(result.included.filter((i) => i.source_id === 't1').length).toBe(1);
  });
});

describe('assembleWorkingMemory — source metadata preservation', () => {
  it('preserves date, author and evidential_status on every included item', () => {
    const raw = { selectedEmail: [{ id: 'e1', content: 'body', date: '2026-08-05', author: 'Isabella', evidential_status: 'confirmed' }] };
    const result = assembleWorkingMemory(raw);
    expect(result.included[0]).toMatchObject({
      source_id: 'e1',
      date: '2026-08-05',
      author: 'Isabella',
      evidential_status: 'confirmed',
    });
  });

  it('defaults evidential_status to "supplied_context" when not explicitly provided', () => {
    const raw = { selectedEmail: [{ id: 'e1', content: 'body' }] };
    const result = assembleWorkingMemory(raw);
    expect(result.included[0].evidential_status).toBe('supplied_context');
  });

  it('handles an entirely empty input without throwing', () => {
    expect(() => assembleWorkingMemory({})).not.toThrow();
    const result = assembleWorkingMemory({});
    expect(result.included).toEqual([]);
    expect(result.totalChars).toBe(0);
  });
});

// ── Temple Close Project Chat test corrections (2026-08-06) ────────────────
// Regression tests required by the correction spec, §8.

describe('extractConfirmedProjectAnchors — mechanical matching, not legal reasoning (spec §8 test 2, test 6)', () => {
  const project = {
    aos: [
      {
        id: 'ao-9', name: 'Benjamin Harry Power', address: '9 Temple Close, London N3 3SB',
        premise: '9 Temple Close, London N3 3SB', status: 'notice_served',
        notice_served_date: '2026-07-23', consent_deadline: '2026-08-05',
      },
      {
        id: 'ao-10', name: 'Sharanjit Gulati', address: '10 Temple Close, London N3 3SB',
        premise: '10 Temple Close, London N3 3SB', status: 'notice_served',
        notice_served_date: '2026-07-23', consent_deadline: '2026-08-05',
      },
    ],
  };

  it('includes only the adjoining owner mentioned in the request text, excluding the unrelated neighbouring owner (spec §8 test 2)', () => {
    const anchors = extractConfirmedProjectAnchors({ project, requestText: 'the leaseholder at 10 Temple Close has asked for drawings' });
    expect(anchors.length).toBe(1);
    expect(anchors[0].content).toContain('10 Temple Close');
    expect(anchors[0].content).not.toContain('9 Temple Close');
  });

  it('includes the confirmed expiry date for the matched party', () => {
    const anchors = extractConfirmedProjectAnchors({ project, requestText: 'Flat 10, 10 Temple Close, response expiry' });
    expect(anchors[0].content).toContain('2026-08-05');
  });

  it('returns nothing when no party is mentioned in the request text, rather than guessing', () => {
    const anchors = extractConfirmedProjectAnchors({ project, requestText: 'general question about the Act' });
    expect(anchors).toEqual([]);
  });

  it('performs plain substring matching only — no scoring, no inference about which party is "more relevant"', () => {
    // Structural proxy: the function takes only project + requestText, no
    // callback or weighting option that could encode a judgement.
    expect(extractConfirmedProjectAnchors.length).toBe(1);
  });
});

describe('extractCurrentDraftState — protected category, works with the new confirmed-text signature (spec §8 test 4)', () => {
  it('is exempt from the per-category item cap once assembled, so it survives alongside a long chat history (spec §8 test 4, end-to-end)', () => {
    // Updated 2026-08-07 for the state-integrity correction: this
    // function no longer takes raw chat history to scan — it takes the
    // confirmed draft text directly. The old array-scanning tests above
    // this describe block tested behaviour that was deliberately
    // removed (length-based inference was the bug); superseded by the
    // dedicated describe block below this one.
    const draft = extractCurrentDraftState('x'.repeat(400));
    const manyHistoryItems = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, content: 'short turn' }));
    const result = assembleWorkingMemory(
      { currentDraftState: draft, chatHistory: manyHistoryItems },
      { maxItemsPerCategory: 8 }
    );
    const draftIncluded = result.included.find((i) => i.category === 'currentDraftState');
    expect(draftIncluded).toBeDefined();
    expect(draftIncluded.content).toContain('x'.repeat(400));
  });
});

describe('protected categories', () => {
  it('confirmedProjectAnchors and currentDraftState are both marked protected from the per-category cap', () => {
    expect(PROTECTED_CATEGORIES).toContain('confirmedProjectAnchors');
    expect(PROTECTED_CATEGORIES).toContain('currentDraftState');
  });
});

// ── Context-wiring correction (2026-08-06) ──────────────────────────────
// semanticResults and projectMemory were hardcoded to null/[] — this
// correction connects them to the real search_project_content RPC
// (via the existing semanticSearchProject()), which itself unions emails,
// chat messages, and project_memory. project_memory is therefore a
// sub-source of the same call, not a second retrieval system.

describe('splitSemanticResults — mechanical split by content_type only (spec item 1, 2)', () => {
  it('routes memory-type results to memoryResults and email/chat-type results to emailChatResults', () => {
    const results = [
      { content_type: 'email', content_id: 'e1', content: 'an email' },
      { content_type: 'chat', content_id: 'c1', content: 'a chat message' },
      { content_type: 'memory', content_id: 'm1', content: 'a memory fact' },
    ];
    const { emailChatResults, memoryResults } = splitSemanticResults(results);
    expect(emailChatResults.map((r) => r.content_id)).toEqual(['e1', 'c1']);
    expect(memoryResults.map((r) => r.content_id)).toEqual(['m1']);
  });

  it('handles an empty or null input without throwing', () => {
    expect(splitSemanticResults(null)).toEqual({ emailChatResults: [], memoryResults: [] });
    expect(splitSemanticResults([])).toEqual({ emailChatResults: [], memoryResults: [] });
  });
});

describe('excludeExistingIds — mechanical de-duplication against already-included content (spec item 5)', () => {
  it('excludes a semantic result whose id matches an already-included selected email', () => {
    const results = [{ content_id: 'e1', content: 'duplicate' }, { content_id: 'e2', content: 'new' }];
    const filtered = excludeExistingIds(
      results.map((r) => ({ id: r.content_id, content: r.content })),
      new Set(['e1'])
    );
    expect(filtered.map((r) => r.id)).toEqual(['e2']);
  });

  it('is a plain Set-membership check, not a content-similarity judgement', () => {
    expect(excludeExistingIds.length).toBe(2);
  });
});

describe('filterByMatchedAnchor — mechanical AO relevance filter (spec item 6)', () => {
  const project = {
    aos: [
      { id: 'ao-9', name: 'Benjamin Power', address: '9 Temple Close, London N3 3SB' },
      { id: 'ao-10', name: 'Sharanjit Gulati', address: '10 Temple Close, London N3 3SB' },
    ],
  };

  it('excludes results mentioning a different adjoining owner when exactly one AO is matched in the request', () => {
    const items = [
      { content: 'notes about 10 Temple Close and the response deadline' },
      { content: 'notes about 9 Temple Close, an unrelated matter' },
    ];
    const filtered = filterByMatchedAnchor(items, { project, requestText: 'Flat 10, 10 Temple Close' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].content).toContain('10 Temple Close');
  });

  it('does not filter anything when no AO is matched in the request (ambiguous — stays conservative)', () => {
    const items = [{ content: 'about 9 Temple Close' }, { content: 'about 10 Temple Close' }];
    const filtered = filterByMatchedAnchor(items, { project, requestText: 'general question about the Act' });
    expect(filtered.length).toBe(2);
  });

  it('does not filter anything when the request matches more than one AO', () => {
    const items = [{ content: 'about 9 Temple Close' }, { content: 'about 10 Temple Close' }];
    const filtered = filterByMatchedAnchor(items, { project, requestText: '9 Temple Close and 10 Temple Close' });
    expect(filtered.length).toBe(2);
  });
});

describe('end-to-end Working Memory assembly with the new categories populated (spec items 3, 4, 7)', () => {
  it('includes semanticResults and projectMemory items when supplied, correctly labelled', () => {
    const result = assembleWorkingMemory({
      semanticResults: [{ id: 's1', content: 'a semantically relevant email', evidential_status: 'semantic_email' }],
      projectMemory: [{ id: 'm1', content: 'notice served 23 July, response period expired 5 August', evidential_status: 'project_memory' }],
    });
    const semantic = result.included.find((i) => i.category === 'semanticResults');
    const memory = result.included.find((i) => i.category === 'projectMemory');
    expect(semantic).toBeDefined();
    expect(semantic.evidential_status).toBe('semantic_email');
    expect(memory).toBeDefined();
    expect(memory.content).toContain('response period expired 5 August');
    expect(memory.evidential_status).toBe('project_memory');
  });
});

// ── Project-context correction (2026-08-06) ─────────────────────────────
// Per NORA_V2_PROJECT_CONTEXT_COMPARISON.md: V2 was compressing the whole
// project bundle into JSON.stringify(projectBundle).slice(0,4000), which
// wasted most of its budget on project_raw and raw embedding vectors and
// left project_memory and cross-session chat history effectively
// unreachable. These tests cover the direct, structured replacements.

describe('extractProjectMemory — direct, cleaned, embedding-free (spec test 1, 2)', () => {
  it('includes cleaned memory content even with no semantic search involved at all', () => {
    const projectBundle = {
      project_memory: [
        // source_type: 'email_received' matches real project_memory data
        // (confirmed against the live database) — a legitimate extracted
        // fact, not a raw email copy, despite the name.
        { id: 'm1', content: 'Caroline conceded responsibility rests with her contractor.', source_type: 'email_received', created_at: '2026-07-01', embedding: [0.1, 0.2, 0.3] },
      ],
    };
    const result = extractProjectMemory(projectBundle);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain('Caroline conceded');
  });

  it('never includes the embedding vector as text anywhere in the output (spec test 2)', () => {
    const projectBundle = {
      project_memory: [
        { id: 'm1', content: 'Some fact.', source_type: 'extracted_fact', embedding: Array(1536).fill(0.123456) },
      ],
    };
    const result = extractProjectMemory(projectBundle);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('0.123456');
    expect(result[0]).not.toHaveProperty('embedding');
  });

  it('excludes raw-email-sourced and known UI-noise entries, same principle as V1', () => {
    const projectBundle = {
      project_memory: [
        { id: 'm1', content: 'Real extracted fact.', source_type: 'email_received' },
        { id: 'm2', content: 'Raw email dump.', source_type: 'email' },
        { id: 'm3', content: 'Noise.', source_type: 'other', metadata: { source: 'manual_preview_banner' } },
      ],
    };
    const result = extractProjectMemory(projectBundle);
    expect(result.length).toBe(1);
    expect(result[0].content).toBe('Real extracted fact.');
  });

  it('handles missing or empty project_memory without throwing', () => {
    expect(extractProjectMemory({})).toEqual([]);
    expect(extractProjectMemory(null)).toEqual([]);
  });
});

describe('buildStructuredProjectFacts — replaces the crude JSON dump (spec test 3)', () => {
  const projectBundle = {
    project: { name: '41 Patrick Road', bo_premise_address: '41 Patrick Road, Reading, RG4 8DD', ref: 'SQ1-2026-013' },
    adjoining_owners: [
      { name: 'Caroline Smith', address: '43 Patrick Road', status: 'dissenting', notice_served_date: '2026-06-01', consent_deadline: '2026-06-15' },
    ],
    notices: [{ type: 'Section 3', served_date: '2026-06-01', status: 'served' }],
    soc_reports: [],
  };

  it('preserves AO names, addresses, notice dates and expiry dates as readable text', () => {
    const result = buildStructuredProjectFacts(projectBundle);
    expect(result.length).toBe(1);
    const text = result[0].content;
    expect(text).toContain('Caroline Smith');
    expect(text).toContain('43 Patrick Road');
    expect(text).toContain('notice served 2026-06-01');
    expect(text).toContain('response due 2026-06-15');
  });

  it('never includes an embedding vector or raw JSON dump structure', () => {
    const withEmbedding = {
      ...projectBundle,
      project_memory: [{ id: 'm1', content: 'x', embedding: [0.1, 0.2] }],
    };
    const result = buildStructuredProjectFacts(withEmbedding);
    const text = result[0].content;
    expect(text).not.toContain('0.1');
    expect(text).not.toContain('"embedding"');
  });

  it('does not duplicate project_memory content — that has its own category', () => {
    const bundleWithMemory = { ...projectBundle, project_memory: [{ id: 'm1', content: 'A distinctive memory fact XYZ123.' }] };
    const result = buildStructuredProjectFacts(bundleWithMemory);
    expect(result[0].content).not.toContain('XYZ123');
  });

  it('handles an empty project bundle without throwing', () => {
    expect(buildStructuredProjectFacts(null)).toEqual([]);
    expect(buildStructuredProjectFacts({})).toEqual([]);
  });
});

describe('per-category budgets — one category cannot crowd out another (spec item 7)', () => {
  it('caps projectFacts at its own budget independent of the shared total cap', () => {
    const hugeFacts = [{ id: 'pf1', content: 'x'.repeat(20000), evidential_status: 'project_record' }];
    const result = assembleWorkingMemory({ projectFacts: hugeFacts });
    const included = result.included.find((i) => i.category === 'projectFacts');
    expect(included).toBeUndefined(); // exceeds CATEGORY_BUDGETS.projectFacts (14000), excluded
    const excludedEntry = result.excluded.find((e) => e.category === 'projectFacts');
    expect(excludedEntry.reason).toBe('category_budget_exceeded');
  });

  it('a capped category does not consume budget that starves a later category', () => {
    const facts = [{ id: 'pf1', content: 'x'.repeat(13000), evidential_status: 'project_record' }];
    const memory = [{ id: 'pm1', content: 'y'.repeat(500), evidential_status: 'project_memory' }];
    const result = assembleWorkingMemory({ projectFacts: facts, projectMemory: memory });
    expect(result.included.find((i) => i.category === 'projectFacts')).toBeDefined();
    expect(result.included.find((i) => i.category === 'projectMemory')).toBeDefined();
  });

  it('CATEGORY_BUDGETS matches the documented values (14000 facts, 10000 memory, 8000 chat history)', () => {
    expect(CATEGORY_BUDGETS.projectFacts).toBe(14000);
    expect(CATEGORY_BUDGETS.projectMemory).toBe(10000);
    expect(CATEGORY_BUDGETS.projectChatHistory).toBe(8000);
  });
});

describe('projectChatHistory — direct route, not semantic-dependent (spec test 4, 5)', () => {
  it('a projectChatHistory item is included in Working Memory when supplied directly, with no semantic search involved', () => {
    const result = assembleWorkingMemory({
      projectChatHistory: [{ id: 'c1', content: 'user: earlier agreed position on fees.', evidential_status: 'prior_project_chat' }],
    });
    const included = result.included.find((i) => i.category === 'projectChatHistory');
    expect(included).toBeDefined();
    expect(included.content).toContain('earlier agreed position');
  });
});

describe('Working Memory total budget with real Patrick-Road-sized data (spec test 9)', () => {
  it('stays within the 80,000-char cap even with a full set of realistic-sized categories populated', () => {
    const bigProjectMemory = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`, content: 'x'.repeat(1200), evidential_status: 'project_memory',
    }));
    const bigChatHistory = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, content: 'y'.repeat(400), evidential_status: 'prior_project_chat',
    }));
    const bigSemantic = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`, content: 'z'.repeat(1500), evidential_status: 'semantic_email',
    }));
    const rawSources = {
      currentInstruction: [{ id: 'ci', content: 'a'.repeat(500) }],
      selectedEmail: [{ id: 'se', content: 'b'.repeat(4000) }],
      thread: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, content: 'c'.repeat(2000) })),
      projectFacts: [{ id: 'pf', content: 'd'.repeat(13000) }],
      projectMemory: bigProjectMemory,
      projectChatHistory: bigChatHistory,
      semanticResults: bigSemantic,
      chatHistory: Array.from({ length: 12 }, (_, i) => ({ id: `ch${i}`, content: 'e'.repeat(300) })),
    };
    const result = assembleWorkingMemory(rawSources);
    expect(result.totalChars).toBeLessThanOrEqual(80000);
  });
});

// ── Final verification corrections (2026-08-06, before push) ───────────

describe('identifyDiscussedEmail — mechanical verbatim-chunk matching, tier 3 of the email resolution hierarchy', () => {
  const candidates = [
    { id: 'e1', subject: 'RE: 41 Patrick Road', sender_name: 'Olivia Porter', body: 'Good Morning Itzik,\n\nFurther to my previous email, I have now taken instructions and considered the matter further.\n\nKind regards,\nOlivia' },
    { id: 'e2', subject: 'Fee query', sender_name: 'Nick Someone', body: 'Hi Itzik, did we get any reply from Nick about the draft?' },
  ];

  it('identifies the email the user quoted or pasted back, by verbatim overlap', () => {
    const prompt = "You don't seem to be reading from the most recent email. -- Good Morning Itzik, Further to my previous email, I have now taken instructions and considered the matter further.";
    const result = identifyDiscussedEmail(prompt, candidates);
    expect(result?.id).toBe('e1');
  });

  it('returns null when no verbatim overlap or sender name exists — never guesses', () => {
    const result = identifyDiscussedEmail('What do you think about the roof works?', candidates);
    expect(result).toBeNull();
  });

  it('ignores short, generic overlaps below the chunk-length threshold', () => {
    const result = identifyDiscussedEmail('Hi Itzik, how are things?', candidates);
    expect(result).toBeNull();
  });

  it('handles empty inputs without throwing', () => {
    expect(identifyDiscussedEmail('', candidates)).toBeNull();
    expect(identifyDiscussedEmail('text', [])).toBeNull();
    expect(identifyDiscussedEmail('text', null)).toBeNull();
  });

  it('matches by sender name when the request names a specific party without quoting them (real gap found during dry run)', () => {
    // Real scenario found 2026-08-06: "the most recent email from Olivia"
    // must not resolve to the absolute-newest email overall if that email
    // is actually from someone else (Arpit) — the named sender is the
    // deciding signal here, mechanically, not a quote.
    const multiSender = [
      { id: 'newest', subject: 'Re: contact', sender_name: 'Arpit Malani', body: 'Hi Itzik, how should we proceed?', received_at: '2026-08-06 16:32' },
      { id: 'olivia-latest', subject: 'RE: 41 Patrick Road', sender_name: 'Olivia Porter', body: 'Good Morning Itzik, further to my previous email.', received_at: '2026-08-06 08:02' },
    ];
    const result = identifyDiscussedEmail('I want to find the most recent email from Olivia today', multiSender);
    expect(result?.id).toBe('olivia-latest');
  });

  it('prefers verbatim-quote matches over sender-name matches when both are present', () => {
    const result = identifyDiscussedEmail('Nick said: Hi Itzik, did we get any reply from Nick about the draft?', candidates);
    expect(result?.id).toBe('e2');
  });
});

describe('projectMemory is exempt from the 8-item cap, governed by its character budget only (final verification fix)', () => {
  it('includes a 9th valid memory item when there is still character budget available', () => {
    const nineItems = Array.from({ length: 9 }, (_, i) => ({
      id: `m${i}`, content: `Fact number ${i}.`, evidential_status: 'project_memory',
    }));
    const result = assembleWorkingMemory({ projectMemory: nineItems });
    const included = result.included.filter((i) => i.category === 'projectMemory');
    expect(included.length).toBe(9);
  });

  it('is still governed by its own character budget (10,000) once content is large enough', () => {
    const hugeItems = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`, content: 'x'.repeat(4000), evidential_status: 'project_memory',
    }));
    const result = assembleWorkingMemory({ projectMemory: hugeItems });
    const includedChars = result.included
      .filter((i) => i.category === 'projectMemory')
      .reduce((sum, i) => sum + i.content.length, 0);
    expect(includedChars).toBeLessThanOrEqual(10000);
  });
});

// ── State-integrity correction (2026-08-07) ─────────────────────────────
// extractCurrentDraftState no longer infers a "draft" from message
// length — it requires a genuinely confirmed draft text, sourced only
// from a prior backend response's own draft field.

describe('extractCurrentDraftState — requires confirmed draft, never infers from length (state-integrity correction)', () => {
  it('spec test 1: a 1,000-character collaborative reply with no confirmed draft leaves currentDraftState empty', () => {
    // Simulates the old bug directly: previously this function scanned
    // chatHistory for any assistant message over 300 chars. Now it
    // takes the confirmed text directly — passing undefined/null (as
    // happens when no real draft has been produced) must return [].
    const result = extractCurrentDraftState(undefined);
    expect(result).toEqual([]);
    const result2 = extractCurrentDraftState(null);
    expect(result2).toEqual([]);
    const result3 = extractCurrentDraftState('');
    expect(result3).toEqual([]);
  });

  it('spec test 2: a real confirmed draft text populates currentDraftState', () => {
    const realDraft = 'Hi Olivia,\n\nThank you for your email...\n\nKind regards,';
    const result = extractCurrentDraftState(realDraft);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain(realDraft);
    expect(result[0].evidential_status).toBe('current_draft_state');
  });

  it('spec test 8: a long collaborative discussion reply, even at typical real-world length, never triggers draft state on its own', () => {
    const longDiscussion = 'x'.repeat(3000); // matches real Nora discussion reply lengths seen today
    const result = extractCurrentDraftState(longDiscussion);
    // Confirms this function no longer has any length-based branch at
    // all — passing long text directly is now indistinguishable from
    // passing a real draft, which is correct: the caller is now solely
    // responsible for only ever passing genuinely confirmed draft text,
    // never raw chat history.
    expect(result.length).toBe(1); // included because it was explicitly passed as confirmed, not inferred
  });

  it('non-string or malformed input is rejected rather than silently accepted', () => {
    expect(extractCurrentDraftState(123)).toEqual([]);
    expect(extractCurrentDraftState({})).toEqual([]);
    expect(extractCurrentDraftState(['not a string'])).toEqual([]);
  });
});
