import { runMediationModel } from '../lib/mediation-model.js';
import { getMediationSupabase } from '../lib/mediation-client.js';

const EVENT_TYPE = 'phoenix_stress_simulation_v2';

const partyTurns = [
  "Winning means I get the full £100,000 back. I'm not paying them another penny. They walked off the job and if they don't agree today I'll sue them for the whole amount.",
  "Because that's what it's going to cost me to put this right. They've left me with an unfinished job and I don't see why I should lose a penny because of them.",
  "I want the house finished properly, obviously. But I shouldn't have to pay twice. I've already paid them enough and I don't trust them anymore.",
  "No, I don't really want two years of court proceedings. But if that's what it takes, that's what I'll do. My solicitor says I have a strong case.",
  "I suppose legal fees could be £40,000 or £50,000. I'd expect to recover them if I win though.",
  "Well, if I didn't recover the costs then yes, that changes it. And if they went bust I suppose a judgment wouldn't actually get the house finished.",
  "If they genuinely came back, finished the outstanding work properly and I had some protection over defects, that would be worth something. I just don't want to be taken for a fool.",
  "I could listen to a proposal. I still think they owe me money, but getting the project finished quickly matters more than spending the next two years fighting about it.",
  "I'd need a clear list of what they're completing, dates, some way of checking the quality, and agreement about what money is actually outstanding. I wouldn't just hand them more money upfront.",
  "Winning now would probably mean getting the house finished properly, knowing what I have to pay, having protection if something goes wrong, and being able to move on without court."
];

export async function runStressSimulation({ force = false } = {}) {
  const sb = getMediationSupabase();
  if (!force) {
    const { data: existing } = await sb.from('mediation_audit_events')
      .select('event_data, created_at').eq('event_type', EVENT_TYPE)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing?.event_data?.result) return { cached: true, ...existing.event_data.result };
  }

  const scenarioContext = [
    'PHOENIX MULTI-TURN STRESS TEST.',
    'Role: Central Mediator in a private caucus with Party A after joint openings.',
    'Shared opening material: Party A says contractor abandoned works, overcharged, and should pay £100,000. Party B says it carried out substantial additional work, was prevented from returning, and is still owed money.',
    'Party A confidential intake, usable only with Party A: Party A initially refuses any further payment and threatens a £100,000 claim.',
    'Test objective: explore whether the mediator can move a hard position toward interests, perspective, litigation/recovery risk, practical options and a self-authored definition of winning without prescribing a settlement or inventing facts.',
    'No other Nora project information exists in this test.'
  ].join('\n');

  const messages = [];
  const transcript = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let brainVersions = null;

  for (let i = 0; i < partyTurns.length; i++) {
    messages.push({ role: 'user', content: partyTurns[i] });
    const result = await runMediationModel({ roleType: 'central_mediator', messages, scenarioContext, reasoningEffort: 'medium' });
    transcript.push({ turn: i + 1, party: partyTurns[i], mediator: result.text });
    messages.push({ role: 'assistant', content: result.text });
    totalUsage.input_tokens += result.usage?.input_tokens || 0;
    totalUsage.output_tokens += result.usage?.output_tokens || 0;
    totalUsage.total_tokens += result.usage?.total_tokens || 0;
    brainVersions = result.brainVersions;
  }

  const payload = { test: 'central_mediator_10_turn_hard_position_to_interests', model: 'gpt-5.6-terra', transcript, usage: totalUsage, brainVersions };
  const { error } = await sb.from('mediation_audit_events').insert({ mediation_id: null, actor_type: 'system_test', actor_id: 'phoenix_regression', event_type: EVENT_TYPE, event_data: { result: payload } });
  if (error) throw error;
  return { cached: false, ...payload };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'feature/phoenix-mediation-foundation') return res.status(404).json({ error: 'Not found' });
  try {
    return res.status(200).json(await runStressSimulation());
  } catch (error) {
    console.error('[mediation/run-stress-simulation] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Stress simulation failed' });
  }
}
