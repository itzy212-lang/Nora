// api/review-award.js — extracts DOCX text then reviews with OpenAI GPT-4o

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  try {
    const { doc1_b64, doc2_b64, mode, system } = req.body;
    if (!doc1_b64) return res.status(400).json({ error: 'No document provided' });

    // Extract text from DOCX base64 using mammoth
    const mammoth = await import('mammoth');

    const extractText = async (b64) => {
      const buffer = Buffer.from(b64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    };

    const text1 = await extractText(doc1_b64);
    const text2 = doc2_b64 ? await extractText(doc2_b64) : null;

    // Build the user prompt
    let userPrompt;
    if (mode === 'benchmark') {
      userPrompt = `Please review this party wall award against my master benchmark template.

AWARD TO REVIEW:
${text1}`;
    } else {
      userPrompt = `Please compare these two party wall award drafts.

DOCUMENT 1 — BASE DRAFT:
${text1}

DOCUMENT 2 — REVISED DRAFT:
${text2}

Tell me:
1. What has changed between Document 1 and Document 2 (additions, deletions, wording changes)
2. Which version is stronger for each changed clause and why
3. Any changes in Document 2 that weaken or introduce problems compared to Document 1
4. Any changes in Document 2 that improve on Document 1

Be specific — quote the exact wording differences. Reference the Act where relevant.`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI API error');

    return res.status(200).json({
      content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
    });

  } catch (err) {
    console.error('[review-award] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
