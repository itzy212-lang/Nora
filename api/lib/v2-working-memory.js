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
const DEFAULT_MAX_TOTAL_CHARS = 40000; // strict context budget, per the approved plan
const DRAFT_LENGTH_THRESHOLD = 300; // matches src/hooks/useEly.js's own threshold

// Fixed priority order. Updated per the context-wiring correction
// (2026-08-06): current instruction; selected email/thread; current
// draft state (immediate context); confirmed project anchors; project
// facts/deadlines; semantic-search results; project memory; chat
// history last. Domain knowledge is a separate top-level prompt section,
// not part of Working Memory, so it is not listed here.
const CATEGORY_PRIORITY = Object.freeze([
  'currentInstruction',
  'selectedEmail',
  'thread',
  'currentDraftState',
  'confirmedProjectAnchors',
  'projectFacts',
  'semanticResults',
  'projectMemory',
  'chatHistory',
]);

const PROTECTED_CATEGORIES = Object.freeze(['confirmedProjectAnchors', 'currentDraftState']);

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
function extractCurrentDraftState(chatHistoryRaw) {
  if (!Array.isArray(chatHistoryRaw)) return [];
  let last = null;
  for (const m of chatHistoryRaw) {
    if (m.role === 'assistant' && m.content && m.content.length > DRAFT_LENGTH_THRESHOLD
        && m.content !== '[earlier draft — superseded]') {
      last = m;
    }
  }
  if (!last) return [];
  return [{
    id: 'current_draft_state',
    content: `Current accepted draft (preserve unless the user requests a substantive change):\n${last.content}`,
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

  const included = [];
  const excluded = [];
  let runningChars = 0;

  for (const category of CATEGORY_PRIORITY) {
    const items = Array.isArray(rawSources[category]) ? rawSources[category] : [];
    const deduped = dedupeByKey(items, (it) => it.id || it.source_id || null);
    // Protected categories are never capped by item count — only by the
    // shared character budget below, same as everything else.
    const limited = PROTECTED_CATEGORIES.includes(category) ? deduped : deduped.slice(0, maxPerCategory);

    for (const raw of deduped) {
      if (!limited.includes(raw)) {
        excluded.push({ category, reason: 'per_category_limit', source_id: raw.id || raw.source_id || null });
      }
    }

    for (const raw of limited) {
      const withMeta = withSourceMetadata(raw, category);
      if (runningChars + withMeta.content.length > maxTotalChars) {
        excluded.push({ category, reason: 'total_budget_exceeded', source_id: withMeta.source_id });
        continue;
      }
      included.push(withMeta);
      runningChars += withMeta.content.length;
    }
  }

  return {
    included,
    excluded,
    totalChars: runningChars,
    // Deliberately NOT included: any field indicating whether the assembled
    // memory is "sufficient" — that determination does not exist in this
    // module, per the corrected design.
  };
}

export {
  assembleWorkingMemory,
  extractConfirmedProjectAnchors,
  extractCurrentDraftState,
  splitSemanticResults,
  excludeExistingIds,
  filterByMatchedAnchor,
  CATEGORY_PRIORITY,
  PROTECTED_CATEGORIES,
  DEFAULT_MAX_ITEMS_PER_CATEGORY,
  DEFAULT_MAX_TOTAL_CHARS,
  DRAFT_LENGTH_THRESHOLD,
};
