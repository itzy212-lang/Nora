/**
 * /api/drafting-test
 * Developer-only A/B/C diagnostic endpoint.
 * Runs the same dictation through three configurations side by side.
 * Does NOT affect production behaviour in any way.
 *
 * POST body: { dictation: "..." }
 * Optional: { secret: "nora-test-2026" } to prevent accidental public use.
 */

import { createClient } from '@supabase/supabase-js';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TEST_SECRET = 'nora-test-2026';

const LEWIS_DICTATION = `Let's respond to Lewis saying I managed to speak to the adjoining owner she is available on Monday this coming Monday at 1 p.m. so let me know if that works for you. With regards to my appointment I believe it's to the leasehold owner of number 19. Regarding the other the remaining freeholder and leaseholder appointments if you have served them a section 10 notice that is now expired I'd happily take on the section 10 for B appointment on this I'll happily I'm happy to discuss these with you based on the basis that is effectively a duplicate award minus any adjoining owner detail change and individual schedule of conditions for each owner so yep I'm happy to have a discussion if the 10 for B appointments come up`;

async function callOpenAI({ messages, temperature = 0.62, label }) {
  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_completion_tokens: 3500,
      temperature,
      messages,
    }),
  });

  const data = await res.json();
  const elapsed = Date.now() - start;

  if (!res.ok) {
    return {
      label,
      error: data.error?.message || `HTTP ${res.status}`,
      elapsed_ms: elapsed,
    };
  }

  const reply = data.choices?.[0]?.message?.content || '';
  const promptTokens = data.usage?.prompt_tokens || 0;
  const completionTokens = data.usage?.completion_tokens || 0;

  return {
    label,
    model: data.model,
    temperature,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    message_count: messages.length,
    messages_summary: messages.map(m => ({
      role: m.role,
      length: m.content?.length || 0,
      preview: (m.content || '').slice(0, 120).replace(/\n/g, ' '),
    })),
    output: reply,
    elapsed_ms: elapsed,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const body = req.body || {};

  if (body.secret !== TEST_SECRET) {
    return res.status(403).json({ error: 'Forbidden. Include { secret: "nora-test-2026" }' });
  }

  const dictation = body.dictation || LEWIS_DICTATION;

  // ── Fetch brain from Supabase ──────────────────────────────────────────────
  let masterBrainSystemPrompt = '';
  let masterBrainOutputRules = '';
  let masterBrainBehaviourRules = '';

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sb
      .from('ai_instruction_sets')
      .select('system_prompt, output_rules, behaviour_rules')
      .eq('name', 'ely_master_v3')
      .eq('active', true)
      .single();

    if (data) {
      masterBrainSystemPrompt = data.system_prompt || '';
      masterBrainOutputRules = data.output_rules || '';
      masterBrainBehaviourRules = data.behaviour_rules || '';
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load brain from Supabase', detail: err.message });
  }

  // ── CONFIG A: Current production runtime (simplified — no project/email context) ──
  // Mirrors what buildSystemPrompt produces for a draft on DraftWithEly
  const configASystemPrompt = [
    masterBrainSystemPrompt,
    masterBrainOutputRules,
    masterBrainBehaviourRules,
    `\n\nACTIVE MODE: DRAFT\n\nYour current task is to draft the completed correspondence.\n\nApply the drafting philosophy defined in the master brain in full.\n\nTreat voice dictation as raw material rather than wording to preserve.\n\nPreserve the user's intended meaning, reasoning and outcome rather than their sentence structure or spoken phrasing.\n\nReturn only the completed correspondence.\n\nBegin with the greeting.\n\nEnd with Kind regards,`,
  ].filter(Boolean).join('\n\n');

  const configAMessages = [
    { role: 'system', content: configASystemPrompt },
    { role: 'user', content: dictation },
  ];

  // ── CONFIG B: Master brain system_prompt only, no output_rules, simple instruction ──
  const configBSystemPrompt = masterBrainSystemPrompt;

  const configBMessages = [
    { role: 'system', content: configBSystemPrompt },
    { role: 'user', content: `Draft the completed correspondence from the following rough voice dictation. Preserve meaning, not wording.\n\n${dictation}` },
  ];

  // ── CONFIG C: No Nora brain — minimal authoring prompt only ──────────────────
  const configCSystemPrompt = `You are an expert professional email drafter. You specialise in rewriting rough voice dictation into naturally authored professional correspondence.

Your job is not to clean up or correct the dictation. Your job is to understand what the person meant to say and write it as a confident, experienced professional would have written it from scratch.

Do not preserve the dictated wording. Preserve the intended meaning.
Remove all spoken filler, repetition, false starts and hedging.
Write in plain, direct, conversational professional English.
Do not add facts or arguments not present in the dictation.
Begin with the greeting. End with Kind regards,`;

  const configCMessages = [
    { role: 'system', content: configCSystemPrompt },
    { role: 'user', content: `Rewrite this rough voice dictation into a professional email:\n\n${dictation}` },
  ];

  // ── Run all three in parallel ──────────────────────────────────────────────
  const [resultA, resultB, resultC] = await Promise.all([
    callOpenAI({ messages: configAMessages, temperature: 0.62, label: 'A — Current production runtime' }),
    callOpenAI({ messages: configBMessages, temperature: 0.62, label: 'B — Master brain system_prompt only' }),
    callOpenAI({ messages: configCMessages, temperature: 0.62, label: 'C — Minimal authoring prompt only' }),
  ]);

  return res.status(200).json({
    dictation_used: dictation.slice(0, 200) + '...',
    model: 'gpt-4o',
    temperature: 0.62,
    results: [resultA, resultB, resultC],
  });
}
