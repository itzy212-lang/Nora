// api/lib/ai-usage.js
//
// AI token tracking (26 Nov 2026). Records every OpenAI call Nora makes (chat, embeddings, voice)
// into ai_usage_log: who, which feature, which model, how many tokens. It reads the usage figures
// OpenAI already returns with each reply; it never changes a request or a response.
//
// How it works: installUsageTracking() wraps fetch once per server process. Any call to
// api.openai.com is passed straight through, then its `usage` block is saved. Every file that
// calls OpenAI imports './ai-usage-install.js' (one line) so a new call site is covered the
// moment it exists. Logging can never break a call: every step is wrapped, has a short timeout,
// and does nothing when the database settings are missing (tests, local runs).
//
// Who the call belongs to: handlers call setUsageContext({ userId, projectId }) once they know.
// Calls made without it are recorded with no user (visible to nobody) rather than guessed.
// Cost is not stored: usage-prices work it out when viewed, so a corrected price fixes history.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const INSTALLED = Symbol.for('nora.aiUsageTrackingInstalled');
const LOG_TIMEOUT_MS = 1500;

/** Set (or merge into) who the following AI calls in this request belong to. */
export function setUsageContext(ctx = {}) {
  const current = als.getStore() || {};
  als.enterWith({ ...current, ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v != null && v !== '')) });
}

/** Run fn with a usage context (alternative to setUsageContext, for loops over many users). */
export function withUsageContext(ctx, fn) {
  return als.run({ ...(als.getStore() || {}), ...ctx }, fn);
}

/** For background jobs with no signed-in user: attribute the following calls to the project's owner. */
export async function attributeToProject(supabase, projectId) {
  if (!projectId) return;
  try {
    const { data } = await supabase.from('projects').select('user_id').eq('id', projectId).maybeSingle();
    setUsageContext({ userId: data?.user_id, projectId });
  } catch { /* tracking only: never affects the job */ }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPENAI_URL = /^https:\/\/api\.openai\.com\/v1\/(chat\/completions|embeddings|audio\/transcriptions)/;

function urlOf(input) {
  try { return typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || ''; } catch { return ''; }
}

/** Which part of Nora made the call: the first api/ file in the stack (e.g. "ely-smart"). */
export function featureFromStack(stack) {
  const lines = String(stack || '').split('\n');
  for (const l of lines) {
    const m = l.match(/[\\/]api[\\/]((?:[\w.-]+[\\/])*[\w.-]+?)\.(?:js|mjs)/);
    if (m && !/ai-usage/.test(m[1])) return m[1].replace(/\\/g, '/').replace(/^lib\//, '');
  }
  return 'unknown';
}

/** Turn an OpenAI response body into the columns we store (pure, easy to test). */
export function rowFromResponse({ endpoint, requestBody, status, json, latencyMs, ctx, feature }) {
  const u = json?.usage || {};
  return {
    user_id: UUID_RE.test(String(ctx?.userId || '')) ? ctx.userId : null, // column is a uuid: never save anything else
    project_id: ctx?.projectId ? String(ctx.projectId) : null,
    feature: ctx?.feature || feature || 'unknown',
    endpoint,
    model_requested: requestBody?.model || null,
    model_returned: json?.model || null,
    prompt_tokens: u.prompt_tokens ?? null,
    completion_tokens: u.completion_tokens ?? null,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null,
    total_tokens: u.total_tokens ?? null,
    finish_reason: json?.choices?.[0]?.finish_reason ?? null,
    latency_ms: latencyMs ?? null,
    status: status ?? null,
  };
}

function parseBody(init) {
  try {
    if (typeof init?.body === 'string') return JSON.parse(init.body);
  } catch { /* multipart (voice) or not JSON */ }
  return null;
}

async function insertRow(origFetch, row) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOG_TIMEOUT_MS);
  try {
    await origFetch(`${base}/rest/v1/ai_usage_log`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
}

export function installUsageTracking() {
  if (globalThis[INSTALLED] || typeof globalThis.fetch !== 'function') return;
  globalThis[INSTALLED] = true;
  const origFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function trackedFetch(input, init) {
    const url = urlOf(input);
    const match = OPENAI_URL.exec(url);
    if (!match) return origFetch(input, init);

    const endpoint = match[1] === 'chat/completions' ? 'chat' : match[1] === 'embeddings' ? 'embeddings' : 'audio';
    const feature = featureFromStack(new Error().stack);
    const ctx = als.getStore();
    const t0 = Date.now();
    const res = await origFetch(input, init);
    try {
      let json = null;
      try { json = await res.clone().json(); } catch { /* not JSON, or a test double */ }
      const row = rowFromResponse({ endpoint, requestBody: parseBody(init), status: res.status, json, latencyMs: Date.now() - t0, ctx, feature });
      await insertRow(origFetch, row);
    } catch { /* tracking must never affect the call */ }
    return res;
  };
}
