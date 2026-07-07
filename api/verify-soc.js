// api/verify-soc.js
// Claude independently reads the raw SOC dictation notes and checks GPT-4o's generated SOC.
// Returns: { corrections: [...], additions: [...], notes: "..." }
// Corrections = things GPT got wrong. Additions = things GPT missed entirely.

export const config = { maxDuration: 120 };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY missing' });

  const { raw_notes, structured_data } = req.body || {};
  if (!raw_notes) return res.status(400).json({ error: 'raw_notes required' });
  if (!structured_data) return res.status(400).json({ error: 'structured_data required' });

  // Flatten the structured SOC into a readable list for Claude to check against
  const rows = [];
  for (const section of (structured_data.sections || [])) {
    for (const row of (section.rows || [])) {
      if (row.observation) {
        rows.push({ ref: row.ref, section: section.title, observation: row.observation });
      }
    }
  }

  const prompt = `You are a quality checker for a party wall Schedule of Condition.

A surveyor dictated notes during a property inspection. GPT-4o has already converted those notes into a structured Schedule of Condition. Your job is to check GPT's work — not redo it.

Find only:
1. CORRECTIONS — observations GPT got factually wrong (wrong location, wrong description, significant misrepresentation of what was dictated).
2. ADDITIONS — observations that are clearly in the raw notes but are completely absent from the SOC rows.

Do not flag minor wording differences. Do not flag things you are uncertain about. Only flag clear, definite mistakes or clear omissions.

RAW DICTATED NOTES:
${raw_notes}

GPT'S GENERATED SOC ROWS:
${JSON.stringify(rows, null, 2)}

Return ONLY valid JSON with no markdown:
{
  "corrections": [
    {
      "ref": "the row ref e.g. LG-001",
      "section": "section name",
      "gpt_version": "what GPT wrote",
      "claude_version": "what it should say",
      "reason": "brief reason"
    }
  ],
  "additions": [
    {
      "section": "which section this belongs in",
      "observation": "the missing observation",
      "reason": "where in the notes this came from"
    }
  ],
  "notes": "optional overall comment if there is a pattern of issues, otherwise empty string"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude error ${response.status}`);
    }

    const data = await response.json();
    const rawText = data?.content?.[0]?.text || '';

    let diff;
    try {
      diff = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      console.warn('[verify-soc] JSON parse failed:', rawText.slice(0, 200));
      return res.status(200).json({ diff: { corrections: [], additions: [], notes: '' } });
    }

    return res.status(200).json({ diff });
  } catch (err) {
    console.error('[verify-soc] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
