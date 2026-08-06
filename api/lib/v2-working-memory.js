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

const DEFAULT_MAX_ITEMS_PER_CATEGORY = 8;
const DEFAULT_MAX_TOTAL_CHARS = 40000; // strict context budget, per the approved plan

// Fixed priority order, per NORA_V2_IMPLEMENTATION_PLAN_V2.md §1:
// surface -> linked project -> selected email -> thread -> explicit user
// instruction -> existing retrieval mechanisms.
const CATEGORY_PRIORITY = Object.freeze([
  'currentInstruction',
  'selectedEmail',
  'thread',
  'projectFacts',
  'projectMemory',
  'semanticResults',
  'chatHistory',
]);

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
    const limited = deduped.slice(0, maxPerCategory);

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

export { assembleWorkingMemory, CATEGORY_PRIORITY, DEFAULT_MAX_ITEMS_PER_CATEGORY, DEFAULT_MAX_TOTAL_CHARS };
