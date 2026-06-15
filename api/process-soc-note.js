// api/process-soc-note.js
// Receives one dictated note, saves to Supabase FIRST, then processes with GPT-4o.
// Note is always saved regardless of whether OpenAI call succeeds.

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const correctionSignals = [
  'scratch that', 'strike that', 'actually', 'correction', 'go back',
  'that last note', 'ignore that', 'change that', 'amendment', 'amend',
  'minor amendment', 'just to amend', 'going back to', 'just to clarify',
  'correction to', 'to correct', 'revise', 'revision to', 'update to',
  'update my last', 'amending my last', 'amending the last', 'just some minor',
  'just to add to', 'adding to my last', 'adding to the last'
];

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', endpoint: 'process-soc-note' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { note, session_id, project_id, ao_id } = req.body;

  if (!note?.trim()) return res.status(400).json({ error: 'No note provided' });
  if (!session_id)   return res.status(400).json({ error: 'No session_id provided' });

  try {
    // ── 1. Get previous notes for context ───────────────────────────────────
    const { data: previousNotes, error: fetchError } = await supabase
      .from('soc_notes')
      .select('id, sequence, raw_note, current_section, is_correction, ai_response')
      .eq('session_id', session_id)
      .order('sequence', { ascending: true });

    if (fetchError) throw fetchError;

    const sequence = (previousNotes?.length || 0) + 1;
    const isCorrection = correctionSignals.some(s => note.toLowerCase().includes(s));

    // Inherit current section from last note that had one
    let currentSection = previousNotes?.length
      ? [...previousNotes].reverse().find(n => n.current_section)?.current_section || null
      : null;

    // ── 2. Save note to Supabase FIRST ──────────────────────────────────────
    // This ensures the note is always persisted even if OpenAI times out
    const { error: insertError } = await supabase
      .from('soc_notes')
      .insert({
        session_id,
        project_id: project_id || null,
        ao_id: ao_id || null,
        sequence,
        raw_note: note.trim(),
        current_section: currentSection,
        is_correction: isCorrection,
        ai_response: 'Noted.',
      });

    if (insertError) throw insertError;

    // ── 3. Call OpenAI for acknowledgement ──────────────────────────────────
    const previousContext = previousNotes?.length
      ? previousNotes.map(n =>
          `[${n.sequence}]${n.current_section ? ` (${n.current_section})` : ''} ${n.raw_note}`
        ).join('\n')
      : 'None yet.';

    const systemPrompt = `You are assisting a party wall surveyor during a Schedule of Condition inspection.

Process each dictated note and respond with ONE LINE only:

1. ROOM/AREA DECLARATION — note declares a location ("moving into the kitchen", "now in rear bedroom", "external rear elevation"):
   Respond: "[Room name]. Got it."

2. CORRECTION/AMENDMENT — note corrects a previous one ("scratch that", "amendment", "minor amendment", "actually", "just to amend", "going back to", "just some minor amendments to my last"):
   Respond: "Amended note [N] — [one line description of what changed]."

3. CONTRADICTION — note contradicts a previous observation about the same element:
   Respond: "Updated — [one line description of what changed]."

4. NORMAL OBSERVATION — everything else:
   Respond: "Noted."

Rules: One line only. No questions. No commentary. No repeating the note.

Previous notes this session:
${previousContext}`;

    let aiResponse = 'Noted.';
    try {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          temperature: 0.1,
          max_tokens: 60,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: note }
          ]
        })
      });
      const openaiData = await openaiRes.json();
      aiResponse = openaiData.choices?.[0]?.message?.content?.trim() || 'Noted.';

      // Update section if this was a room declaration
      const isRoomDeclaration = aiResponse.includes('Got it.') && !aiResponse.startsWith('Noted');
      if (isRoomDeclaration) {
        currentSection = aiResponse.replace(/\.\s*Got it\.?/i, '').trim();
      }

      // Update the saved note with AI response and section
      await supabase
        .from('soc_notes')
        .update({ ai_response: aiResponse, current_section: currentSection })
        .eq('session_id', session_id)
        .eq('sequence', sequence);

    } catch (aiErr) {
      console.error('[process-soc-note] OpenAI failed — note saved, returning Noted.:', aiErr.message);
    }

    return res.status(200).json({
      response: aiResponse,
      sequence,
      current_section: currentSection,
      is_correction: isCorrection,
    });

  } catch (err) {
    console.error('[process-soc-note] fatal error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to process note' });
  }
}
