// api/invoice-polish.js

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { text } = req.body || {};
  const raw = String(text || '').trim();

  if (!raw) {
    return res.status(400).json({ error: 'No description provided' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: 'You improve invoice line item descriptions for a UK party wall surveyor. Use British English spelling and terminology. Return only the polished invoice description. Keep it concise, professional and suitable for an invoice. Do not add a sign-off, explanation, quotes, markdown or extra commentary. Do not use em dashes.',
        messages: [{ role: 'user', content: raw }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'AI polish request failed',
      });
    }

    const polished = data?.content?.[0]?.text?.trim();

    if (!polished) {
      return res.status(500).json({ error: 'No polished description returned' });
    }

    return res.status(200).json({
      description: polished.replace(/—/g, '-'),
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Could not polish description',
    });
  }
}
