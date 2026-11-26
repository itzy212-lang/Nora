import { describe, it, expect, vi, afterEach } from 'vitest';
import { rowFromResponse, featureFromStack, setUsageContext, withUsageContext } from '../ai-usage.js';
import { priceFor, costOf } from '../ai-usage-prices.js';

const UUID = '3bd1f331-e8ce-477a-8a5d-c5dcdd901434';

describe('ai-usage rows', () => {
  it('captures tokens, reasoning, cache, model and finish reason from an OpenAI reply', () => {
    const row = rowFromResponse({
      endpoint: 'chat', status: 200, latencyMs: 1234, feature: 'ely-smart',
      ctx: { userId: UUID, projectId: 'abc123' },
      requestBody: { model: 'gpt-6.2-sol' },
      json: { model: 'gpt-6.2-sol', choices: [{ finish_reason: 'length' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
          completion_tokens_details: { reasoning_tokens: 40 }, prompt_tokens_details: { cached_tokens: 10 } } },
    });
    expect(row).toMatchObject({ user_id: UUID, project_id: 'abc123', feature: 'ely-smart', endpoint: 'chat',
      model_requested: 'gpt-6.2-sol', model_returned: 'gpt-6.2-sol', prompt_tokens: 100, completion_tokens: 50,
      reasoning_tokens: 40, cached_tokens: 10, total_tokens: 150, finish_reason: 'length', latency_ms: 1234, status: 200 });
  });
  it('never saves a user id that is not a uuid, and keeps rows for failed calls', () => {
    const row = rowFromResponse({ endpoint: 'embeddings', status: 429, json: { error: { message: 'rate' } }, ctx: { userId: 'someone@example.com' }, feature: 'embed' });
    expect(row.user_id).toBeNull();
    expect(row.status).toBe(429);
    expect(row.prompt_tokens).toBeNull();
  });
  it('names the feature from the file that made the call', () => {
    const stack = 'Error\n    at trackedFetch (/var/task/api/lib/ai-usage.js:99:1)\n    at callIt (/var/task/api/lib/soc-brain-v2/drafting.js:61:5)';
    expect(featureFromStack(stack)).toBe('soc-brain-v2/drafting');
    expect(featureFromStack('Error\n at x (/var/task/api/ely-smart.js:1:1)')).toBe('ely-smart');
    expect(featureFromStack('nothing useful')).toBe('unknown');
  });
});

describe('ai-usage prices', () => {
  it('matches dated model names and works out cost with cached input', () => {
    expect(priceFor('gpt-4o-2024-08-06').match).toBe('gpt-4o');
    expect(priceFor('gpt-4o-mini-2024-07-18').match).toBe('gpt-4o-mini');
    // Sol: 1,000,000 prompt of which 500,000 cached, 100,000 out = 0.5*2 + 0.5*0.10 + 0.1*10 = 2.05
    expect(costOf('gpt-6.2-sol', { prompt: 1e6, cached: 5e5, completion: 1e5 })).toBeCloseTo(2.05, 6);
  });
  it('returns null (no price set) for unknown models instead of guessing', () => {
    expect(costOf('some-new-model', { prompt: 1000, completion: 1000 })).toBeNull();
  });
});

describe('fetch tracking', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete globalThis[Symbol.for('nora.aiUsageTrackingInstalled')]; });

  it('passes OpenAI calls straight through, saves usage, and survives a failing log', async () => {
    const calls = [];
    const original = vi.fn(async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('api.openai.com')) {
        return new Response(JSON.stringify({ model: 'gpt-6.2-sol', usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }, choices: [{ finish_reason: 'stop' }] }), { status: 200 });
      }
      throw new Error('database down');
    });
    vi.stubGlobal('fetch', original);
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const mod = await import('../ai-usage.js');
    mod.installUsageTracking();
    const res = await withUsageContext({ userId: UUID }, () => fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-6.2-sol' }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).usage.total_tokens).toBe(12); // caller can still read the body
    expect(calls.some(u => u.includes('/rest/v1/ai_usage_log'))).toBe(true);
  });

  it('ignores non-OpenAI calls entirely', async () => {
    const original = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', original);
    const mod = await import('../ai-usage.js');
    mod.installUsageTracking();
    await fetch('https://example.com/x');
    expect(original).toHaveBeenCalledTimes(1);
  });
});
