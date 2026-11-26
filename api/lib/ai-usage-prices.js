// api/lib/ai-usage-prices.js
//
// USD per 1 million tokens. Cost is worked out from these when usage is viewed (nothing is stored),
// so correcting a price here corrects the whole history.
//   verified: true  = read from OpenAI's own model/pricing page on 26 Nov 2026
//   verified: false = from general knowledge, NOT checked against OpenAI's page: shown as "estimate"
// Models not listed are counted in tokens but shown as "no price set". Update when prices change.
export const PRICES = [
  { match: 'gpt-6.2-sol',            input: 2.00, cached: 0.10, output: 10.00, verified: true },
  { match: 'gpt-5.6-luna',           input: 0.20, cached: 0.02, output: 1.20,  verified: true },
  { match: 'gpt-5.6-terra',          input: 2.00, cached: null, output: 12.00, verified: true },
  { match: 'gpt-4o-mini',            input: 0.15, cached: 0.075, output: 0.60, verified: false },
  { match: 'gpt-4o',                 input: 2.50, cached: 1.25, output: 10.00, verified: false },
  { match: 'text-embedding-3-small', input: 0.02, cached: null, output: 0,     verified: false },
  { match: 'text-embedding-3-large', input: 0.13, cached: null, output: 0,     verified: false },
  { match: 'text-embedding-ada-002', input: 0.10, cached: null, output: 0,     verified: false },
];

/** Longest matching price entry for a model name (handles dated names like gpt-4o-2024-08-06). */
export function priceFor(model) {
  const m = String(model || '').toLowerCase();
  let best = null;
  for (const p of PRICES) if (m.startsWith(p.match) && (!best || p.match.length > best.match.length)) best = p;
  return best;
}

/** Cost in USD for token counts on one model, or null when no price is set. */
export function costOf(model, { prompt = 0, completion = 0, cached = 0 } = {}) {
  const p = priceFor(model);
  if (!p) return null;
  const cachedTokens = Math.min(cached || 0, prompt || 0);
  const cachedRate = p.cached ?? p.input;
  return ((prompt - cachedTokens) * p.input + cachedTokens * cachedRate + (completion || 0) * p.output) / 1e6;
}
