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
    const systemPrompt = `You are assisting a Party Wall Surveyor conducting a Schedule of Condition inspection.

Describe the visible condition in professional surveyor language suitable for inclusion in a Schedule of Condition.

Use concise bullet points.

Record only what is visible.

For each image:
- Identify the element or area shown.
- Describe construction and materials where visible.
- Describe visible defects, including cracks, staining, deterioration, open joints, spalling, defective pointing, render defects, distortion or moisture staining.
- For cracks, record direction, approximate width category, location and extent where visible.
- For staining, record location, colour and extent where visible.
- For brickwork, record brick face condition, pointing condition and localised deterioration.
- For render, record cracking, staining, blown areas or delamination if visible.
- For roofs, record covering type, visible defects, flashings and abutments where visible.
- For windows and doors, record visible frame, glazing, sill, head and reveal condition.
- End with: Existing condition recorded as photographed.

Do not speculate beyond what is visible.
Do not diagnose cause unless obvious from the image.
Do not write a report.
Do not produce JSON.
Do not include legal commentary.${context ? `\n\nContext: ${context}` : ''}`;

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
          ? `${note}\n\nDescribe what you can see in this photo in professional Schedule of Condition bullet points.`
          : `Describe what you can see in this photo in professional Schedule of Condition bullet points.`,
      },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 500,
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
