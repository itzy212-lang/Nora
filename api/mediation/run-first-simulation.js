import { runMediationModel } from '../lib/mediation-model.js';
import { getMediationSupabase } from '../lib/mediation-client.js';

const EVENT_TYPE = 'phoenix_first_simulation_done';

function isSafePreview() {
  return process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === 'feature/phoenix-mediation-foundation';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isSafePreview()) return res.status(404).json({ error: 'Not found' });

  try {
    const sb = getMediationSupabase();
    const { data: existing, error: existingError } = await sb
      .from('mediation_audit_events')
      .select('event_data, created_at')
      .eq('event_type', EVENT_TYPE)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.event_data?.result) {
      return res.status(200).json({ cached: true, ...existing.event_data.result });
    }

    const scenarioContext = [
      'FIRST LIVE PHOENIX REGRESSION TEST.',
      'Role: Central Mediator, first substantive private session with Party A after joint openings.',
      'Shared opening material: Party A says the contractor abandoned the works, has overcharged, and should pay £100,000. Party B says it carried out substantial additional work, was prevented from returning, and is still owed money.',
      'Party A confidential intake may be used only with Party A: Party A says they will not pay another penny and, if mediation fails, they will sue for £100,000.',
      'No other Nora project information exists in this test. Do not assume facts not supplied.'
    ].join('\n');

    const messages = [
      {
        role: 'user',
        content: "Winning means I get the full £100,000 back. I'm not paying them another penny. They walked off the job and if they don't agree today I'll sue them for the whole amount."
      }
    ];

    const result = await runMediationModel({
      roleType: 'central_mediator',
      messages,
      scenarioContext,
      reasoningEffort: 'medium',
    });

    const payload = {
      test: 'first_live_central_mediator_baseline',
      scenarioContext,
      input: messages[0].content,
      output: result.text,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage,
      brainVersions: result.brainVersions,
    };

    const { error: insertError } = await sb.from('mediation_audit_events').insert({
      mediation_id: null,
      actor_type: 'system_test',
      actor_id: 'phoenix_regression',
      event_type: EVENT_TYPE,
      event_data: { result: payload },
    });
    if (insertError) throw insertError;

    return res.status(200).json({ cached: false, ...payload });
  } catch (error) {
    console.error('[mediation/run-first-simulation] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Simulation failed' });
  }
}
