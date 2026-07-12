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
            content: `You are a Party Wall surveyor editing notifiable works descriptions for a statutory notice under the Party Wall etc. Act 1996. Your job is to make the wording sound like it was written by an experienced party wall surveyor — professional, precise, and in keeping with standard notice language — whilst preserving the exact technical method, materials, and elements described. You may improve sentence structure, use correct surveying terminology, and make it read naturally. Do NOT change the construction method, what is being fixed to what, or substitute different techniques. For example: "connection of steel column to party wall using resin anchors" should remain about resin anchors into the party wall — do not change it to cutting or inserting. Context: ${sectionContext}. Output the improved description only — no preamble, no explanation. UK English.`,
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
