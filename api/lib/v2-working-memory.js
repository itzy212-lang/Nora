// api/lib/v2-working-memory.js
//
// Assembles Dynamic Working Memory per request. Per the corrected design
// (NORA_V2_IMPLEMENTATION_PLAN_V2.md §1, mandatory correction 1): this
// module NEVER decides whether retrieved evidence is sufficient, whether a
// fact answers the professional question, or whether another search is
// strategically necessary. Those are model judgments. This module's role is
// strictly: assemble already-fetched sources in a fixed priority order,
// enforce count/budget limits, de-duplicate, and preserve source metadata.
// Where the assembly is incomplete, that is surfaced as-is — Terra
// identifies the gap, this module does not try to fill it.
//
// Actual retrieval (semantic search, project bundle loading, email context)
// is NOT reimplemented here — it is performed by the existing, already-
// working functions in api/ely-smart.js and passed in as plain data. This
// module only assembles, limits, and labels what it is given.
//
// Targeted correction (Temple Close Project Chat test, 2026-08-06):
// two mechanical, non-judgmental additions —
//   1. confirmedProjectAnchors: a compact package of confirmed project
//      values (party name/spelling, property, notice/expiry dates,
//      appointment status), filtered to the party actually mentioned in
//      the current request by plain substring matching against address/
//      name fields — never by inferring which party is "relevant" to the
//      legal question. Matching, not reasoning.
//   2. currentDraftState: the most recent substantial (>300 char)
//      assistant message is treated as a protected item, exempt from the
//      per-category cap, so a minor-amendment request can never lose the
//      accepted draft to truncation. This mirrors the same length-based
//      rule the frontend (src/hooks/useEly.js) already uses to decide
//      which draft to keep in full — applied here so it survives V2's
//      own separate slicing too.

const DEFAULT_MAX_ITEMS_PER_CATEGORY = 8;

// Per-category item-count overrides (2026-08-08, on request): most
// categories are fine at the default 8, but chatHistory needs headroom
// for genuinely complex, long collaborations — confirmed against a real
// 31-message session where the default cap, even after fixing which end
// of the window it kept (see the ordering fix above), still only
// surfaced 8 of the conversation's turns. Raised specifically for
// chatHistory rather than the global default, so simple conversations
// don't pay any extra token cost — a short conversation naturally
// produces few items regardless of this ceiling; this only matters once
// a conversation is long enough to hit it.
const CATEGORY_MAX_ITEMS = Object.freeze({
  chatHistory: 40, // raised 2026-08-08: temporary diagnostic increase, to
  // isolate whether a real content-quality problem is a context-window
  // issue or a Universal Brain issue, by removing the window as a
  // variable entirely for one real test. 40 matches the true ceiling —
  // src/hooks/useEly.js already caps the raw chatHistory array at 40
  // messages for project_chat before this file ever sees it, so this is
  // the maximum meaningfully available without also raising that cap.
});
const DEFAULT_MAX_TOTAL_CHARS = 80000; // raised from 40000 (2026-08-06): a real session
// hit this cap mid-conversation (peaked at 37,078 chars, 2 items dropped for budget
// reasons). Doubled for headroom. Other prompt sections (Universal Brain ~15.7k,
// voice ~7.4k, domain knowledge ~8.6k, gold standard ~2-4.6k) total roughly 35k on
// top of this, so worst case the full system prompt lands around 115k chars
// (~29k tokens) — comfortably inside gpt-5.6-terra's context window.
const DRAFT_LENGTH_THRESHOLD = 300; // matches src/hooks/useEly.js's own threshold

// Per-category character budgets (2026-08-06 project-context correction).
// Direct/deterministic categories get a dedicated ceiling so one category
// can never crowd out another before the shared total cap is even reached —
// per NORA_V2_PROJECT_CONTEXT_COMPARISON.md, V1 gave project memory an
// uncapped section and the project bundle 14,000 chars; this restores
// comparable dedicated budgets without reproducing V1's uncapped behaviour.
// Categories not listed here fall back to the shared DEFAULT_MAX_TOTAL_CHARS
// pool only.
const CATEGORY_BUDGETS = Object.freeze({
  projectFacts: 14000,      // matches V1's compactJson(bundleWithoutNotes, 14000)
  projectMemory: 10000,     // deliberately capped, unlike V1's uncapped section
  projectChatHistory: 8000, // matches V1's ALL PROJECT NOTES & CHAT cap
});

// Fixed priority order. Updated per the project-context correction
// (2026-08-06): direct/deterministic sources are ordered before
// semantically-retrieved supporting material, per the "current working
// file" principle — immediate context must not compete with, or be
// crowded out by, older supporting evidence. projectMemory moved before
// semanticResults now that it is populated directly rather than only via
// semantic ranking. projectChatHistory is new — direct, bounded,
// cross-session prior discussion, not dependent on semantic ranking.
const CATEGORY_PRIORITY = Object.freeze([
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

const PROTECTED_CATEGORIES = Object.freeze(['confirmedProjectAnchors', 'currentDraftState', 'projectMemory']);
// projectMemory added (2026-08-06 verification): must be governed by its
// character budget alone, not the general 8-item cap — otherwise a 9th+
// valid standing fact would be silently dropped even with budget to
// spare. Confirmed this was a real gap before the fix.

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

function withSourceMetadata(item, category) {
  return {
    category,
    source_id: item.id || item.source_id || null,
    date: item.date || item.received_at || item.sent_at || item.created_at || null,
    author: item.author || item.sender_name || item.sender_email || null,
    evidential_status: item.evidential_status || 'supplied_context',
    content: item.content || item.body || item.text || '',
  };
}

/**
 * Mechanical extraction, not legal reasoning: builds a compact anchor list
 * from the project bundle's adjoining owners, filtered to the one(s) whose
 * name/address/premise text is actually substring-matched in the supplied
 * request text. If nothing matches (or no request text is supplied), no
 * anchors are returned — this function never guesses which party "must be"
 * relevant.
 */
/**
 * Cleans and formats project_memory rows for direct inclusion in Working
 * Memory — mechanical filtering only, not a relevance judgement. Mirrors
 * V1's proven cleaning principle (buildSystemPrompt, "Layer 6: Project
 * memory facts"): excludes raw-email-sourced copies and known UI-noise
 * entries, strips the embedding vector and other DB-only metadata, keeps
 * content/summary/source/date. Unlike V1, this is deliberately capped
 * (CATEGORY_BUDGETS.projectMemory), not unbounded.
 */
function extractProjectMemory(projectBundle) {
  const rawMemory = projectBundle?.project_memory || [];
  const cleaned = [];
  for (const rec of rawMemory) {
    const sourceType = rec.source_type || '';
    const metaSource = rec.metadata?.source || '';
    // Matches V1's exact exclusion rule (buildSystemPrompt, "Layer 6"),
    // confirmed against real project data before finalizing this: only
    // literal 'email' (a raw full-body copy) is excluded by source_type.
    // 'email_received' is a distinct, legitimate extracted-fact category
    // (e.g. "Olivia requested the Section A weathering detail on 21 May
    // 2026.") — excluding it was a real bug caught before commit, not
    // present in V1's own logic, which this function is required to
    // mirror.
    const isRawEmailOrNoise = sourceType === 'email'
      || metaSource === 'manual_preview_banner' || metaSource === 'manual_attachment_popup';
    if (isRawEmailOrNoise) continue;
    const text = String(rec.content || rec.summary || '').trim();
    if (!text) continue;
    cleaned.push({
      id: rec.id,
      content: text,
      date: rec.created_at || null,
      author: rec.source_type || null,
      evidential_status: 'project_memory',
    });
  }
  return cleaned;
}

/**
 * Replaces the crude JSON.stringify(projectBundle).slice(0,4000) dump
 * with structured, labelled, readable project-fact text — mechanical
 * field selection, not a relevance judgement about which facts matter.
 * Never includes embedding vectors or opaque DB metadata. Never
 * duplicates project_memory or full email bodies — those have their own
 * categories.
 */
function buildStructuredProjectFacts(projectBundle) {
  if (!projectBundle) return [];
  const parts = [];
  const p = projectBundle.project || projectBundle.project_raw || {};

  const identityLines = [
    p.name ? `Project: ${p.name}` : null,
    // Fixed 2026-09-02, real, confirmed, high-impact gap: the
    // building owner's own name was never included here at all —
    // only the project name, address, reference and status. Every
    // party wall project has exactly one building owner, and the
    // user is in direct correspondence with them constantly, so this
    // was a significant, high-frequency gap, not an edge case.
    // Confirmed directly: dictated 'Sean' got written exactly as
    // dictated, though the real building owner on this project is
    // 'Shawn' — the model had genuinely never seen the correct
    // spelling anywhere in its prompt to check against.
    (p.bo || p.bo_1_name) ? `Building Owner: ${p.bo || p.bo_1_name}${p.bo_1_email ? ` (${p.bo_1_email})` : ''}` : null,
    p.bo_2_name ? `Building Owner 2: ${p.bo_2_name}${p.bo_2_email ? ` (${p.bo_2_email})` : ''}` : null,
    p.bo_premise_address || p.address ? `Address: ${p.bo_premise_address || p.address}` : null,
    p.ref ? `Reference: ${p.ref}` : null,
    p.status ? `Status: ${p.status}` : null,
  ].filter(Boolean);
  if (identityLines.length) parts.push(identityLines.join('\n'));

  const aos = projectBundle.adjoining_owners || [];
  if (aos.length) {
    const aoLines = aos.map((ao) => {
      // Fixed 2026-08-27, real, confirmed gap: adjoining_owners has no
      // status column at all — ao.status was always empty, silently
      // dropped by the filter below, on every single request. The
      // model never received an explicit consent/dissent label for
      // any adjoining owner, only scattered fields to infer from
      // (reported live: got a property number wrong, and missed that
      // a surveyor's appointment for one owner made a Section 10
      // notice for another owner unnecessary — both explained by
      // never being told plainly who stands where). Derives a real
      // status from what actually exists: a named surveyor means
      // dissent and appointment; otherwise, awaiting response.
      // Fixed 2026-09-02, real, confirmed bug found while
      // investigating a specific case live: adjoining_owners often
      // has no rows at all for a project — the real AO data instead
      // lives in a separate projects.aos JSON column, which the
      // backend already correctly falls back to (loadProjectFacts).
      // But that JSON's own objects use different field names
      // entirely (surv_name/surv_firm and, inconsistently, a second
      // duplicate set surveyorName/surveyorFirm — confirmed directly
      // against real data) — not the table's surveyor_name/
      // surveyor_firm this fix originally checked. So for any
      // project using the JSON fallback, this status derivation
      // silently never found the surveyor at all. Now checks every
      // real variant confirmed to exist.
      const svName = ao.surveyor_name || ao.surv_name || ao.surveyorName;
      const svFirm = ao.surveyor_firm || ao.surv_firm || ao.surveyorFirm;
      const derivedStatus = svName
        ? `dissented — appointed ${svName}${svFirm ? ` (${svFirm})` : ''} as their surveyor`
        : (ao.status || 'no response recorded yet');
      const bits = [
        ao.name || 'unnamed adjoining owner',
        ao.address || ao.premise || null,
        derivedStatus,
        ao.notice_served_date ? `notice served ${ao.notice_served_date}` : null,
        ao.consent_deadline ? `response due ${ao.consent_deadline}` : null,
      ].filter(Boolean);
      return `- ${bits.join(' | ')}`;
    });
    parts.push(`Adjoining owners:\n${aoLines.join('\n')}`);
  }

  const notices = projectBundle.notices || [];
  if (notices.length) {
    const noticeLines = notices.map((n) => {
      const bits = [
        n.type || n.notice_type || 'notice',
        n.served_date ? `served ${n.served_date}` : null,
        n.status || null,
      ].filter(Boolean);
      return `- ${bits.join(' | ')}`;
    });
    parts.push(`Notices:\n${noticeLines.join('\n')}`);
  }

  const socReports = projectBundle.soc_reports || [];
  if (socReports.length) {
    const socLines = socReports.map((s) => {
      const bits = [
        s.ao_names || s.ao_address || 'SOC report',
        s.status || null,
        s.inspection_date ? `inspected ${s.inspection_date}` : null,
      ].filter(Boolean);
      return `- ${bits.join(' | ')}`;
    });
    parts.push(`SOC reports:\n${socLines.join('\n')}`);
  }

  const text = parts.join('\n\n').trim();
  if (!text) return [];
  return [{ id: 'structured_project_facts', content: text, evidential_status: 'project_record' }];
}

function extractConfirmedProjectAnchors({ project, requestText }) {
  if (!project || !requestText) return [];
  const haystack = requestText.toLowerCase();
  const aos = project?.aos || project?.project_raw?.aos || [];
  // Match against the full field and, since a full address (with postcode)
  // is rarely typed verbatim, against each comma-separated fragment of it
  // too (e.g. "10 Temple Close" out of "10 Temple Close, London N3 3SB").
  // Still plain substring matching — no scoring, no inference.
  const matched = aos.filter((ao) => {
    const candidates = [ao.name, ao.address, ao.premise, ao.reg_addr].filter(Boolean);
    return candidates.some((c) => {
      const full = String(c).toLowerCase();
      if (haystack.includes(full)) return true;
      return full.split(',').map((part) => part.trim()).filter((part) => part.length > 2)
        .some((part) => haystack.includes(part));
    });
  });
  return matched.map((ao) => ({
    id: `anchor_${ao.id || ao.address}`,
    content: [
      `Confirmed party: ${ao.name || 'unnamed'}`,
      `Property: ${ao.address || ao.premise || 'unknown'}`,
      ao.notice_served_date ? `Notice served: ${ao.notice_served_date}` : null,
      ao.consent_deadline ? `Response period expires: ${ao.consent_deadline}` : null,
      ao.status ? `Current status: ${ao.status}` : null,
    ].filter(Boolean).join(' | '),
    evidential_status: 'confirmed_project_record',
  }));
}

/**
 * Mechanical selection, same length-based rule already used by the
 * frontend: the most recent assistant message over the draft-length
 * threshold is the current draft state. Returns at most one item.
 */
/**
 * Mechanical identification of which candidate email the current request
 * is discussing, by verbatim-chunk matching — never a relevance or intent
 * judgement. Splits each candidate's subject/body into chunks (sentences/
 * lines) of at least MIN_CHUNK_LENGTH characters, and checks whether any
 * chunk appears verbatim (case-insensitive) inside the request text. This
 * catches the common real pattern of a user pasting or quoting back part
 * of an email they're discussing, without requiring an explicit UI
 * selection. Returns the first matching candidate, or null if none match
 * — never guesses when there's no verbatim overlap.
 */
const MIN_CHUNK_LENGTH = 40;
function identifyDiscussedEmail(requestText, candidateEmails) {
  if (!requestText || !Array.isArray(candidateEmails) || !candidateEmails.length) return null;
  const haystack = requestText.toLowerCase();

  // Verbatim-quote match first (strongest signal: the user pasted or
  // quoted the email back).
  for (const email of candidateEmails) {
    const source = [email.subject, email.body, email.body_preview].filter(Boolean).join('\n');
    const chunks = source.split(/[\r\n.]+/).map((c) => c.trim()).filter((c) => c.length >= MIN_CHUNK_LENGTH);
    for (const chunk of chunks) {
      if (haystack.includes(chunk.toLowerCase())) return email;
    }
  }

  // Sender/party name match: if the request mentions a specific sender's
  // name (a plain substring check on sender_name, at least 3 characters
  // to avoid matching on initials or noise), prefer the newest email FROM
  // that named sender over the newest email overall. Mechanical matching
  // only — never infers who "must" be relevant when no name is mentioned.
  const namedCandidates = candidateEmails.filter((e) => {
    const name = (e.sender_name || '').trim();
    if (name.length < 3) return false;
    // match on the first token of the name (e.g. "Olivia" out of "Olivia Porter")
    const firstName = name.split(/\s+/)[0].toLowerCase();
    return firstName.length >= 3 && haystack.includes(firstName);
  });
  if (namedCandidates.length) return namedCandidates[0]; // candidates are already newest-first

  return null;
}

/**
 * Fixed 2026-08-07 (state-integrity correction): previously inferred a
 * "current draft" from the last assistant message over
 * DRAFT_LENGTH_THRESHOLD (300) characters in raw chat history — a real,
 * confirmed bug, independent of the mode classifier: a long collaborative
 * discussion reply routinely exceeds 300 characters and is not a draft.
 * That could cause Working Memory to tell Terra "there is already an
 * accepted draft, preserve it" during ordinary discussion, which is a
 * model-level bias no mode-classifier fix could ever catch.
 *
 * Now takes the confirmed draft text directly — sourced exclusively from
 * a prior backend response's own `draft` field (populated only when
 * <<<DRAFT>>> delimiters were actually found and split), passed through
 * by the frontend as body.context.previousDraft and forwarded here by
 * the caller. No inference from length, keywords, or formatting. If no
 * confirmed draft was supplied, this returns empty — never guesses.
 */
function extractCurrentDraftState(confirmedDraftText) {
  if (!confirmedDraftText || typeof confirmedDraftText !== 'string' || !confirmedDraftText.trim()) return [];
  return [{
    id: 'current_draft_state',
    content: `Current accepted draft (preserve unless the user requests a substantive change):\n${confirmedDraftText}`,
    evidential_status: 'current_draft_state',
  }];
}

/**
 * Mechanical split of search_project_content results by their own
 * content_type field — never a relevance judgement. 'memory' rows (from
 * project_memory, itself a source unioned inside search_project_content)
 * go to one category; 'email'/'chat' rows go to the other.
 */
function splitSemanticResults(results) {
  const memoryResults = [];
  const emailChatResults = [];
  for (const r of results || []) {
    const target = r.content_type === 'memory' ? memoryResults : emailChatResults;
    target.push(r);
  }
  return { emailChatResults, memoryResults };
}

/**
 * Mechanical de-duplication against IDs already included elsewhere in
 * Working Memory (selected email, thread, current draft) — a plain Set
 * lookup, not a similarity or relevance judgement.
 */
function excludeExistingIds(items, existingIds) {
  const seen = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  return (items || []).filter((it) => {
    const id = it.id || it.content_id || it.source_id;
    return !id || !seen.has(id);
  });
}

/**
 * Mechanical relevance filter, same technique as
 * extractConfirmedProjectAnchors: if the request text substring-matches
 * exactly one adjoining owner's name/address, exclude results whose
 * content mentions a *different* adjoining owner's distinguishing
 * address, so Flat 9 material doesn't surface for a Flat 10 request.
 * If zero or more than one AO is matched, no filtering is applied —
 * this function never guesses which party is relevant.
 */
function filterByMatchedAnchor(items, { project, requestText }) {
  const anchors = extractConfirmedProjectAnchors({ project, requestText });
  if (anchors.length !== 1) return items; // ambiguous or no match — do not filter
  const aos = project?.aos || project?.project_raw?.aos || [];
  const matchedId = anchors[0].id;
  // Same fragment-based matching as extractConfirmedProjectAnchors, for
  // consistency: a full "9 Temple Close, London N3 3SB" address is
  // unlikely to appear verbatim in retrieved content either.
  const otherFragments = aos
    .filter((ao) => `anchor_${ao.id || ao.address}` !== matchedId)
    .flatMap((ao) => [ao.address, ao.premise].filter(Boolean))
    .flatMap((full) => full.toLowerCase().split(',').map((p) => p.trim()).filter((p) => p.length > 2));
  if (!otherFragments.length) return items;
  return (items || []).filter((it) => {
    const content = (it.content || '').toLowerCase();
    return !otherFragments.some((frag) => content.includes(frag));
  });
}

// Pure assembly — no sufficiency judgement. Enforces limits, de-duplicates,
// labels. Returns both what was included and what was excluded (and why),
// for diagnostics — never a "gap answered" determination.
function assembleWorkingMemory(rawSources, opts = {}) {
  const maxPerCategory = opts.maxItemsPerCategory ?? DEFAULT_MAX_ITEMS_PER_CATEGORY;
  const maxTotalChars = opts.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const categoryBudgets = opts.categoryBudgets ?? CATEGORY_BUDGETS;

  const included = [];
  const excluded = [];
  let runningChars = 0;
  const categoryChars = {};

  // Fixed 2026-08-08 (real, confirmed loss): chatHistory is chronological
  // (oldest-first), unlike relevance-ranked categories such as
  // semanticResults where "first" correctly means "most relevant". Taking
  // the first N items of a chronological array silently drops the most
  // RECENT turns once a conversation exceeds the per-category cap —
  // confirmed against a real session where this dropped the two most
  // recent, substantively developed arguments (a trespass/context
  // argument and half of a fees argument) from what Terra actually saw
  // for the final draft request, while an equal number of older,
  // already-superseded turns were kept instead.
  const CHRONOLOGICAL_KEEP_MOST_RECENT = new Set(['chatHistory']);

  for (const category of CATEGORY_PRIORITY) {
    const items = Array.isArray(rawSources[category]) ? rawSources[category] : [];
    const deduped = dedupeByKey(items, (it) => it.id || it.source_id || null);
    const categoryMax = opts.categoryMaxItems?.[category] ?? CATEGORY_MAX_ITEMS[category] ?? maxPerCategory;
    // Protected categories are never capped by item count — only by the
    // shared character budget below, same as everything else.
    let limited;
    if (PROTECTED_CATEGORIES.includes(category)) {
      limited = deduped;
    } else if (CHRONOLOGICAL_KEEP_MOST_RECENT.has(category)) {
      limited = deduped.slice(-categoryMax);
    } else {
      limited = deduped.slice(0, categoryMax);
    }

    for (const raw of deduped) {
      if (!limited.includes(raw)) {
        excluded.push({ category, reason: 'per_category_limit', source_id: raw.id || raw.source_id || null });
      }
    }

    const categoryBudget = categoryBudgets[category];
    categoryChars[category] = 0;

    for (const raw of limited) {
      const withMeta = withSourceMetadata(raw, category);
      if (categoryBudget != null && categoryChars[category] + withMeta.content.length > categoryBudget) {
        excluded.push({ category, reason: 'category_budget_exceeded', source_id: withMeta.source_id });
        continue;
      }
      if (runningChars + withMeta.content.length > maxTotalChars) {
        excluded.push({ category, reason: 'total_budget_exceeded', source_id: withMeta.source_id });
        continue;
      }
      included.push(withMeta);
      runningChars += withMeta.content.length;
      categoryChars[category] += withMeta.content.length;
    }
  }

  return {
    included,
    excluded,
    totalChars: runningChars,
    categoryChars,
    // Deliberately NOT included: any field indicating whether the assembled
    // memory is "sufficient" — that determination does not exist in this
    // module, per the corrected design.
  };
}

export {
  assembleWorkingMemory,
  extractConfirmedProjectAnchors,
  extractCurrentDraftState,
  extractProjectMemory,
  buildStructuredProjectFacts,
  identifyDiscussedEmail,
  splitSemanticResults,
  excludeExistingIds,
  filterByMatchedAnchor,
  CATEGORY_PRIORITY,
  PROTECTED_CATEGORIES,
  CATEGORY_BUDGETS,
  CATEGORY_MAX_ITEMS,
  DEFAULT_MAX_ITEMS_PER_CATEGORY,
  DEFAULT_MAX_TOTAL_CHARS,
  DRAFT_LENGTH_THRESHOLD,
};
