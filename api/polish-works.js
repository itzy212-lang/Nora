// api/polish-works.js
// Takes raw dictation of a notifiable work item and returns professional surveying language

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { rawText, section } = req.body || {};
  if (!rawText?.trim()) return res.status(400).json({ error: 'rawText is required' });

  const sectionContext = {
    s1: 'Section 1(5) — line of junction / new wall on boundary',
    s2: 'Section 2(2) — party structure works',
    s6: 'Section 6(1) — excavation within 3 or 6 metres of adjoining structure',
  }[section] || 'party wall works';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 120,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are a Party Wall surveyor lightly editing a description of notifiable works for a statutory notice under the Party Wall etc. Act 1996. Your job is to make the wording sound professional and grammatically correct whilst preserving the exact technical content and method described. Do NOT change what is being done, how it is being done, or what materials or elements are involved. Only fix grammar, tense, and phrasing. If the description is already clear, change as little as possible. Context: ${sectionContext}. Output the corrected description only — no preamble, no explanation. UK English.`,
          },
          {
            role: 'user',
            content: rawText.trim(),
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI error ${response.status}`);
    }

    const data = await response.json();
    const polished = data.choices?.[0]?.message?.content?.trim() || rawText;
    return res.status(200).json({ polished });
  } catch (err) {
    console.error('[polish-works] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
