import { runMediationModel } from '../lib/mediation-model.js';

function authorised(req) {
  const expected = process.env.PHOENIX_TEST_SECRET;
  if (!expected) return false;
  const supplied = req.headers?.['x-phoenix-test-secret'];
  return typeof supplied === 'string' && supplied.length > 0 && supplied === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorised(req)) return res.status(404).json({ error: 'Not found' });

  try {
    const roleType = req.body?.role_type;
    const messages = req.body?.messages;
    const scenarioContext = String(req.body?.scenario_context || '').slice(0, 12000);

    const result = await runMediationModel({ roleType, messages, scenarioContext });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[mediation/test-terra] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Test run failed' });
  }
}
