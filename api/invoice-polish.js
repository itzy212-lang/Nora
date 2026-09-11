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
        // Fixed 2026-09-10, real bug reported live: this specific
        // endpoint used 'gpt-4o-mini', a different, older model
        // variant than every other working OpenAI call in this
        // codebase — the confirmed-working main pipeline uses
        // gpt-5.6-terra, and several other smaller features already
        // use gpt-4o (without '-mini') successfully today. Couldn't
        // fully confirm from search alone whether gpt-4o-mini has
        // specifically been retired from OpenAI's own direct API (as
        // opposed to the separate ChatGPT consumer app or Azure
        // Foundry, which have their own, different retirement
        // timelines) — rather than guess, switched to gpt-4o, the
        // variant already proven to work in this same app today.
        model: 'gpt-4o',
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
