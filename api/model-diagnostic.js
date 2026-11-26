// api/model-diagnostic.js
//
// TEMPORARY (26 Nov 2026). Server-side model upgrade diagnostic. Uses the OpenAI key already in
// this deployment's environment, so the key never leaves Vercel. Deleted when the upgrade is
// verified. Protected by DIAG_SECRET (a temporary variable removed with this file).
//
// It only calls OpenAI. It never reads or writes the database and never sends an email.
// It returns model names, token counts, timings and model answers on made-up inputs. It never
// returns any secret.
//
//   GET ?key=...&step=config                       effective model configuration at runtime
//   GET ?key=...&step=probe&model=gpt-6.2-sol      account access + parameter compatibility
//   GET ?key=...&step=case&i=0&model=...[&effort=medium&maxtokens=8000]   one comparison case
//   GET ?key=...&step=effective                    one tiny call using the config-resolved model
//                                                  for every function, returning the model OpenAI
//                                                  actually answered with
import crypto from 'crypto';
import { FUNCTIONS, modelFor, tokenParams, instructionRole, isReasoningModel } from './lib/model-config.js';
import { SITE_NOTE_DRAFTING_CONTRACT } from './lib/soc-brain-v2/site-note-drafting.js';

const API = 'https://api.openai.com/v1';
const PRICE = { 'gpt-5.6-terra': [2.0, 12.0], 'gpt-6.2-sol': [2.0, 10.0] }; // USD per 1M tokens (OpenAI model pages)
const SAFE_ENV = ['NORA_CORE_MODEL', 'NORA_FALLBACK_MODEL', 'SOC_DRAFT_MODEL', 'MINUTES_DRAFT_MODEL', 'MINUTES_EXTRACT_MODEL',
  'DRAFTING_MODEL', 'STAGE1_MODEL', 'PROJECT_CHAT_DISCUSS_MODEL', 'DRAFTING_REASONING_EFFORT', 'STAGE1_REASONING_EFFORT',
  'STAGE1_DRAFTING', 'STAGE1_PROMOTED', 'USE_SOC_MASTER_V1', 'NORA_BRAIN_VERSION'];

const same = (a, b) => {
  const x = Buffer.alloc(128); Buffer.from(String(a || '')).copy(x);
  const y = Buffer.alloc(128); Buffer.from(String(b || '')).copy(y);
  return crypto.timingSafeEqual(x, y) && String(a || '').length === String(b || '').length;
};

async function call(body) {
  const t0 = Date.now();
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, data, error: data?.error?.message };
}

const SYS = 'You are Nora, a senior party wall surveyor\'s assistant in England and Wales. Be accurate, professional and concise. Do not invent facts.';
const CASES = [
  { name: 'Professional judgement (party wall)', json: false, system: SYS,
    user: 'The adjoining owner served a dissent to a Party Structure Notice and has not appointed a surveyor. 12 days have passed since the dissent. What are the options for the building owner and what should I check before acting?' },
  { name: 'Email drafting', json: false, system: SYS + ' Write the reply email only, from the surveyor, plain text, no more than 150 words.',
    user: 'Email from a building owner: "Hi, the builders want to start the loft conversion in three weeks. Do we need to do anything about the neighbour at number 14 first? They have not said anything to us." Context: no notices have been served yet; the works include cutting into the party wall for steel beams.' },
  { name: 'Document / memory interpretation', json: false, system: SYS + ' Summarise what this means for how a surveyor should behave, in about 120 words.',
    user: 'Practice note: Where an adjoining owner consents in writing to works, a schedule of condition is still recommended. Where no award is made, the parties should agree access arrangements in writing, including hours, areas, and any protection to be provided. A consent given by one co-owner does not bind the other co-owners.' },
  { name: 'SOC site note wording (real contract)', json: true, system: SITE_NOTE_DRAFTING_CONTRACT,
    user: 'Items:\n[{"item_id":"n1","raw":"add a side note no access to the flat roof above the kitchen, once the scaffolding is up if the contractors could take a series of photos and provide them to us before the works start"},{"item_id":"n2","raw":"just as a site note request a CCTV inspection of the shared drain before and after the works, as no award is being made discuss access between the parties"}]' },
  { name: 'Automatic-response judgement (decision only, nothing is sent)', json: true,
    system: SYS + ' Decide whether Nora may draft an automatic reply. Never reply to automated notifications, marketing, or anything needing the surveyor\'s own judgement on fees, liability or a dispute. Return JSON {"results":[{"email":1,"reply":true|false,"reason":"..."}]}.',
    user: 'EMAIL 1: "Your Royal Mail parcel is out for delivery. Do not reply to this message."\nEMAIL 2: "Can you confirm you are still OK for Tuesday 10am at 5 Example Road for the schedule of condition? Thanks, Sam".\nEMAIL 3: "Your fee is excessive and we may refuse to pay. Explain yourself."' },
  { name: 'Structured analysis (dispute)', json: true, system: SYS + ' Return JSON {"synopsis":"..","key_points":[".."],"risks":[".."]}.',
    user: 'Building owner says the adjoining owner\'s chimney breast was removed without notice and cracks have appeared in the shared wall. Adjoining owner says the cracks pre-date the works and refuses access. A schedule of condition exists for the ground floor only.' },
];

export default async function handler(req, res) {
  if (!process.env.DIAG_SECRET || !same(req.query?.key, process.env.DIAG_SECRET)) return res.status(404).json({ error: 'Not found' });
  const { step } = req.query;
  try {
    if (step === 'config') {
      const env = {};
      for (const k of SAFE_ENV) env[k] = process.env[k] === undefined ? '(not set)' : process.env[k];
      const functions = {};
      for (const fn of Object.keys(FUNCTIONS)) functions[fn] = modelFor(fn);
      return res.status(200).json({ openai_key_present: !!process.env.OPENAI_API_KEY, env, effective: functions });
    }

    const model = req.query.model;
    if (step === 'probe') {
      const msgs = [{ role: 'developer', content: 'Reply with the JSON {"ok":true}.' }, { role: 'user', content: 'go' }];
      const m = await fetch(`${API}/models/${model}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
      const out = [{ check: 'account can see the model', result: m.ok ? 'YES' : `NO (${m.status})` }];
      const cases = [
        ['developer role + reasoning_effort medium + max_completion_tokens', { reasoning_effort: 'medium', max_completion_tokens: 2000 }],
        ['plus response_format json_object', { reasoning_effort: 'medium', max_completion_tokens: 2000, response_format: { type: 'json_object' } }],
        ['reasoning_effort low', { reasoning_effort: 'low', max_completion_tokens: 2000 }],
        ['reasoning_effort high', { reasoning_effort: 'high', max_completion_tokens: 4000 }],
        ['reasoning_effort none', { reasoning_effort: 'none', max_completion_tokens: 2000 }],
        ['temperature 0.2', { temperature: 0.2, max_completion_tokens: 2000 }],
        ['max_tokens (old name)', { max_tokens: 2000 }],
        ['system role instead of developer', { max_completion_tokens: 2000, __system: true }],
      ];
      for (const [check, extra] of cases) {
        const { __system, ...rest } = extra;
        const r = await call({ model, messages: __system ? [{ role: 'system', content: msgs[0].content }, msgs[1]] : msgs, ...rest });
        out.push({ check, result: r.ok ? 'accepted' : `rejected ${r.status}: ${String(r.error).slice(0, 110)}`, model_returned: r.data?.model, ms: r.ms,
          finish: r.data?.choices?.[0]?.finish_reason, usage: r.data?.usage ? { in: r.data.usage.prompt_tokens, out: r.data.usage.completion_tokens, reasoning: r.data.usage.completion_tokens_details?.reasoning_tokens } : undefined });
      }
      return res.status(200).json({ model, out });
    }

    if (step === 'case') {
      const c = CASES[Number(req.query.i)];
      if (!c) return res.status(400).json({ error: 'bad case index' });
      const effort = req.query.effort || 'medium';
      const maxTokens = Number(req.query.maxtokens || 8000);
      const r = await call({
        model, ...(isReasoningModel(model) ? { reasoning_effort: effort, max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        ...(c.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: instructionRole(model), content: c.system }, { role: 'user', content: c.user }],
      });
      const u = r.data?.usage; const p = PRICE[model];
      return res.status(200).json({
        case: c.name, model_requested: model, model_returned: r.data?.model, ok: r.ok, error: r.error, ms: r.ms,
        finish: r.data?.choices?.[0]?.finish_reason, effort, maxTokens,
        usage: u ? { in: u.prompt_tokens, out: u.completion_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens } : null,
        usd: u && p ? (u.prompt_tokens * p[0] + u.completion_tokens * p[1]) / 1e6 : null,
        text: r.data?.choices?.[0]?.message?.content ?? '',
      });
    }

    if (step === 'effective') {
      // One tiny call per function using exactly the model + parameters the app now resolves.
      const out = {};
      for (const fn of Object.keys(FUNCTIONS)) {
        const cfg = modelFor(fn);
        const r = await call({
          model: cfg.model,
          ...tokenParams(cfg.model, { maxTokens: isReasoningModel(cfg.model) ? 1500 : 50, reasoningEffort: cfg.reasoningEffort || 'low' }),
          messages: [{ role: instructionRole(cfg.model), content: 'Reply with the single word OK.' }, { role: 'user', content: 'ping' }],
        });
        out[fn] = { configured: cfg.model, effort: cfg.reasoningEffort || null, ok: r.ok, model_returned_by_openai: r.data?.model, error: r.error };
      }
      return res.status(200).json(out);
    }
    return res.status(400).json({ error: 'unknown step' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err).slice(0, 200) });
  }
}
