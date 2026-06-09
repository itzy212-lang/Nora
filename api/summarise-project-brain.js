import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUMMARISE_THRESHOLD = 40;  // summarise when unsummarised messages exceed this
const KEEP_RECENT = 20;          // always keep this many recent messages unsummarised

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { project_id } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  try {
    // Get all non-summary entries for this project, oldest first
    const { data: allEntries, error } = await supabase
      .from('project_brain')
      .select('id, role, content, content_type, file_name, created_at, is_summary')
      .eq('project_id', project_id)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    const nonSummary = (allEntries || []).filter(e => !e.is_summary);

    // Not enough to summarise yet
    if (nonSummary.length <= SUMMARISE_THRESHOLD) {
      return res.status(200).json({ 
        status: 'skipped', 
        reason: `Only ${nonSummary.length} messages — threshold is ${SUMMARISE_THRESHOLD}`,
        count: nonSummary.length 
      });
    }

    // Split: entries to summarise vs recent entries to keep raw
    const toSummarise = nonSummary.slice(0, nonSummary.length - KEEP_RECENT);
    
    if (toSummarise.length < 10) {
      return res.status(200).json({ 
        status: 'skipped', 
        reason: 'Not enough old entries to make summarisation worthwhile' 
      });
    }

    // Get existing summary if there is one (to extend it)
    const existingSummary = (allEntries || []).find(e => e.is_summary);

    // Build the text to summarise
    const entriesText = toSummarise.map(e => {
      const label = e.role === 'user' ? 'Surveyor' : 'Ely';
      const date = e.created_at 
        ? new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      const typeLabel = e.content_type === 'email_received' ? '[Email received]'
        : e.content_type === 'email_sent' ? '[Email sent]'
        : e.content_type === 'upload' ? `[Uploaded: ${e.file_name || 'file'}]`
        : '';
      return `${label}${date ? ` (${date})` : ''}${typeLabel ? ' ' + typeLabel : ''}: ${e.content}`;
    }).join('\n\n');

    const existingSummaryText = existingSummary?.content 
      ? `Existing summary (extend this, do not repeat):\n${existingSummary.content}\n\n`
      : '';

    const prompt = `${existingSummaryText}You are summarising the project brain history for a party wall surveying project. Create a concise but comprehensive running summary that captures:

- The nature of the dispute or works
- Key parties involved (names, roles, addresses)
- Chronological sequence of key events with dates
- Correspondence highlights (who wrote what, when, and what was the response)
- Current status and any outstanding issues
- Any important facts, deadlines, or agreements mentioned

Write in clear professional bullet points organised chronologically. Preserve specific dates, names, addresses, and key facts. This summary will be used as memory context for an AI assistant answering questions about the project.

Entries to summarise:
${entriesText}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        system: 'You are a professional party wall surveying assistant. Create concise, factual summaries that preserve all important dates, names, and facts.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || 'Summarisation failed');

    const summaryText = payload.content?.[0]?.text || '';
    if (!summaryText) throw new Error('Empty summary returned');

    // Delete old summary if exists, then insert new one
    if (existingSummary) {
      await supabase.from('project_brain').delete().eq('id', existingSummary.id);
    }

    // Insert new summary
    await supabase.from('project_brain').insert({
      project_id,
      role: 'ely',
      content: summaryText,
      content_type: 'summary',
      is_summary: true,
      summarised_up_to: toSummarise[toSummarise.length - 1].created_at,
    });

    // Delete the entries that were summarised
    const idsToDelete = toSummarise.map(e => e.id);
    await supabase.from('project_brain').delete().in('id', idsToDelete);

    return res.status(200).json({
      status: 'summarised',
      entries_summarised: toSummarise.length,
      entries_kept: KEEP_RECENT,
      summary_length: summaryText.length,
    });

  } catch (err) {
    console.error('[summarise-project-brain] error:', err);
    return res.status(500).json({ error: err.message || 'Summarisation failed' });
  }
}
