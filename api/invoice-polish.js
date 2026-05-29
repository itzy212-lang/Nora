// api/invoice-polish.js

const OPENAI_KEY = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const { text } = req.body || {};
  const raw = String(text || '').trim();

  if (!raw) {
    return res.status(400).json({ error: 'No description provided' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You improve invoice line item descriptions for a UK party wall surveyor. Use British English spelling and terminology. Return only the polished invoice description. Keep it concise, professional and suitable for an invoice. Do not add a sign-off, explanation, quotes, markdown or extra commentary. Do not use em dashes.',
          },
          {
            role: 'user',
            content: raw,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'AI polish request failed',
      });
    }

    const polished = data?.choices?.[0]?.message?.content?.trim();

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
