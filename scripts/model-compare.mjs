#!/usr/bin/env node
// scripts/model-compare.mjs
//
// Compatibility check + side-by-side comparison of two models on identical inputs.
//   OPENAI_API_KEY=sk-... node scripts/model-compare.mjs                      (Terra vs Sol)
//   OPENAI_API_KEY=sk-... node scripts/model-compare.mjs gpt-5.6-terra gpt-6.2-sol
//
// Safe to run: it only calls the chat completions and models endpoints. It never touches the
// database, never sends an email, and uses made-up inputs (no real client data).
// Writes a readable report to scripts/out/ so the answers can be read side by side.
import { mkdirSync, writeFileSync } from 'node:fs';
import { SITE_NOTE_DRAFTING_CONTRACT } from '../api/lib/soc-brain-v2/site-note-drafting.js';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('Set OPENAI_API_KEY (the key is not stored in this repo).'); process.exit(1); }
const [A = 'gpt-5.6-terra', B = 'gpt-6.2-sol'] = process.argv.slice(2);
const PRICE = { // USD per 1M tokens: input, output (standard tier, OpenAI model pages, 26 Nov 2026)
  'gpt-5.6-terra': [2.0, 12.0],
  'gpt-6.2-sol': [2.0, 10.0],
};
const API = 'https://api.openai.com/v1';

async function call(body) {
  const t0 = Date.now();
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ms, data, error: data?.error?.message };
}

// ── 1. Compatibility probes ────────────────────────────────────────────────────────────────
async function probes(model) {
  const msgs = [{ role: 'developer', content: 'Reply with the JSON {"ok":true}.' }, { role: 'user', content: 'go' }];
  const out = [];
  const m = await fetch(`${API}/models/${model}`, { headers: { Authorization: `Bearer ${KEY}` } });
  out.push(['account can see the model (GET /models)', m.ok ? 'YES' : `NO (${m.status})`]);
  const cases = [
    ['developer role + reasoning_effort medium + max_completion_tokens', { reasoning_effort: 'medium', max_completion_tokens: 2000 }, true],
    ['…plus response_format json_object', { reasoning_effort: 'medium', max_completion_tokens: 2000, response_format: { type: 'json_object' } }, true],
    ['reasoning_effort low', { reasoning_effort: 'low', max_completion_tokens: 2000 }, true],
    ['reasoning_effort none (expected to be rejected)', { reasoning_effort: 'none', max_completion_tokens: 2000 }, false],
    ['temperature 0.2 (expected to be rejected)', { temperature: 0.2, max_completion_tokens: 2000 }, false],
    ['max_tokens instead of max_completion_tokens', { max_tokens: 2000 }, null],
  ];
  for (const [label, extra, expectOk] of cases) {
    const r = await call({ model, messages: msgs, ...extra });
    out.push([label, `${r.ok ? 'accepted' : 'rejected'}${r.ok ? '' : ` (${r.status}: ${String(r.error).slice(0, 90)})`}${expectOk === null ? '' : (r.ok === expectOk ? '' : '  <-- UNEXPECTED')}`, r.data?.model]);
  }
  return out;
}

// ── 2. Representative cases (made-up facts) ────────────────────────────────────────────────
const SYS = 'You are Nora, a senior party wall surveyor\'s assistant in England and Wales. Be accurate, professional and concise. Do not invent facts.';
const CASES = [
  { name: 'Professional judgement (party wall)', json: false,
    system: SYS,
    user: 'The adjoining owner served a dissent to a Party Structure Notice and has not appointed a surveyor. 12 days have passed since the dissent. What are the options for the building owner and what should I check before acting?' },
  { name: 'Email drafting', json: false,
    system: SYS + ' Write the reply email only, from the surveyor, plain text, no more than 150 words.',
    user: 'Email from a building owner: "Hi, the builders want to start the loft conversion in three weeks. Do we need to do anything about the neighbour at number 14 first? They have not said anything to us." Context: no notices have been served yet; the works include cutting into the party wall for steel beams.' },
  { name: 'Document / memory interpretation', json: false,
    system: SYS + ' Summarise what this means for how a surveyor should behave, in about 120 words.',
    user: 'Practice note: Where an adjoining owner consents in writing to works, a schedule of condition is still recommended. Where no award is made, the parties should agree access arrangements in writing, including hours, areas, and any protection to be provided. A consent given by one co-owner does not bind the other co-owners.' },
  { name: 'SOC site note wording (real contract)', json: true,
    system: SITE_NOTE_DRAFTING_CONTRACT,
    user: 'Items:\n[{"item_id":"n1","raw":"add a side note no access to the flat roof above the kitchen, once the scaffolding is up if the contractors could take a series of photos and provide them to us before the works start"},{"item_id":"n2","raw":"just as a site note request a CCTV inspection of the shared drain before and after the works, as no award is being made discuss access between the parties"}]' },
  { name: 'Automatic-response judgement (decision only, nothing is sent)', json: true,
    system: SYS + ' Decide whether Nora may draft an automatic reply. Return JSON {"reply":true|false,"reason":"..."}. Never reply to automated notifications, marketing, or anything needing the surveyor\'s own judgement on fees, liability or a dispute.',
    user: 'EMAIL 1: "Your Royal Mail parcel is out for delivery. Do not reply to this message."\nEMAIL 2: "Can you confirm you are still OK for Tuesday 10am at 5 Example Road for the schedule of condition? Thanks, Sam".\nEMAIL 3: "Your fee is excessive and we may refuse to pay. Explain yourself."\nReturn a JSON object {"results":[{"email":1,"reply":..,"reason":..},...]}.' },
  { name: 'Structured analysis (dispute)', json: true,
    system: SYS + ' Return JSON {"synopsis":"..","key_points":[".."],"risks":[".."]}.',
    user: 'Building owner says the adjoining owner\'s chimney breast was removed without notice and cracks have appeared in the shared wall. Adjoining owner says the cracks pre-date the works and refuses access. A schedule of condition exists for the ground floor only.' },
];

function cost(model, usage) {
  const p = PRICE[model]; if (!p || !usage) return null;
  return (usage.prompt_tokens * p[0] + usage.completion_tokens * p[1]) / 1e6;
}

async function runCase(model, c) {
  const r = await call({
    model, reasoning_effort: 'medium', max_completion_tokens: 8000,
    ...(c.json ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'developer', content: c.system }, { role: 'user', content: c.user }],
  });
  const u = r.data?.usage;
  return {
    ok: r.ok, ms: r.ms, error: r.error, returned: r.data?.model,
    text: r.data?.choices?.[0]?.message?.content ?? '', finish: r.data?.choices?.[0]?.finish_reason,
    prompt: u?.prompt_tokens, completion: u?.completion_tokens, reasoning: u?.completion_tokens_details?.reasoning_tokens, usd: cost(model, u),
  };
}

const lines = [`# Model comparison: ${A} vs ${B}`, `Run: ${new Date().toISOString()}`, ''];
for (const model of [A, B]) {
  lines.push(`## Compatibility: ${model}`, '', '| Check | Result | Model returned |', '|---|---|---|');
  for (const [a, b, c] of await probes(model)) lines.push(`| ${a} | ${b} | ${c || ''} |`);
  lines.push('');
}
const totals = { [A]: { ms: 0, usd: 0, trunc: 0 }, [B]: { ms: 0, usd: 0, trunc: 0 } };
lines.push('## Side by side (medium reasoning, 8000-token ceiling)', '');
for (const c of CASES) {
  lines.push(`### ${c.name}`, '');
  const res = {};
  for (const model of [A, B]) {
    res[model] = await runCase(model, c);
    const r = res[model];
    totals[model].ms += r.ms; totals[model].usd += r.usd || 0; if (r.finish === 'length') totals[model].trunc++;
    lines.push(`**${model}**: ${r.ok ? 'ok' : 'ERROR ' + r.error} | ${(r.ms / 1000).toFixed(1)}s | in ${r.prompt} / out ${r.completion} (reasoning ${r.reasoning}) | $${(r.usd || 0).toFixed(4)} | API returned model "${r.returned}" | finish: ${r.finish}`, '', '```', r.text.trim(), '```', '');
  }
}
lines.push('## Totals', '', '| Model | Total time | Total cost | Truncated answers |', '|---|---|---|---|');
for (const m of [A, B]) lines.push(`| ${m} | ${(totals[m].ms / 1000).toFixed(1)}s | $${totals[m].usd.toFixed(4)} | ${totals[m].trunc} |`);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const file = new URL(`./out/compare-${Date.now()}.md`, import.meta.url);
writeFileSync(file, lines.join('\n'));
console.log(lines.join('\n'));
console.log('\nSaved to', file.pathname);
