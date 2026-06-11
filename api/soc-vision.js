// api/soc-vision.js
// Secure server-side OpenAI vision call for SOC photo descriptions
// The API key never leaves the server

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const { image_base64, mime_type, note, context } = req.body || {};

  if (!image_base64 || !mime_type) {
    return res.status(400).json({ error: 'Missing image_base64 or mime_type' });
  }

  try {
    const userContent = [
      {
        type: 'image_url',
        image_url: {
          url: `data:${mime_type};base64,${image_base64}`,
          detail: 'high',
        },
      },
      {
        type: 'text',
        text: note
          ? `${note}\n\nDescribe what you can see in this photo using professional party wall surveyor language suitable for a Schedule of Condition. Be specific about cracks, staining, damage, defects, finishes, and materials. Be concise and factual. Do not use markdown or bullet points unless listing multiple distinct defects.`
          : `Describe what you can see in this photo using professional party wall surveyor language suitable for a Schedule of Condition. Be specific about cracks, staining, damage, defects, finishes, and materials. Be concise and factual. Do not use markdown or bullet points unless listing multiple distinct defects.`,
      },
    ];

    const systemPrompt = `You are assisting a party wall surveyor conducting a Schedule of Condition inspection. 
    
Your role is to describe what you see in photos in professional surveyor language that can be used directly in a formal Schedule of Condition document.

Use precise language:
- For cracks: describe direction (horizontal/vertical/diagonal), width (hairline/fine/medium/wide), length, and location
- For staining: describe colour, extent, and likely cause if obvious
- For finishes: describe material, condition, and any deterioration
- For dampness: describe extent and pattern
- For structural elements: describe material, condition, and any defects

Keep descriptions factual and objective. Do not speculate beyond what is visible.
${context ? `\nContext: ${context}` : ''}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',  // better vision than gpt-4o, released March 2026
        max_tokens: 400,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI error ${response.status}`);

    const description = data.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({ description });

  } catch (err) {
    console.error('[soc-vision] error:', err.message);
    return res.status(500).json({ error: err.message || 'Vision call failed' });
  }
}

