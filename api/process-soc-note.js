// api/process-soc-note.js
// Receives one dictated note, saves to Supabase, processes with GPT-4o,
// returns "Noted." or an amendment confirmation.

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    note,
    session_id,
    project_id,
    ao_id,
  } = req.body;

  if (!note?.trim()) return res.status(400).json({ error: 'No note provided' });
  if (!session_id)   return res.status(400).json({ error: 'No session_id provided' });

  try {
    // ── 1. Get all previous notes for this session ──────────────────────────
    const { data: previousNotes, error: fetchError } = await supabase
      .from('soc_notes')
      .select('id, sequence, raw_note, current_section, is_correction, ai_response')
      .eq('session_id', session_id)
      .order('sequence', { ascending: true });

    if (fetchError) throw fetchError;

    const sequence = (previousNotes?.length || 0) + 1;

    // ── 2. Build context string of previous notes ───────────────────────────
    const previousContext = previousNotes?.length
      ? previousNotes.map(n =>
          `[${n.sequence}] ${n.current_section ? `(${n.current_section}) ` : ''}${n.raw_note}`
        ).join('\n')
      : 'None yet.';

    // ── 3. Ask GPT-4o to process this note in context ───────────────────────
    const systemPrompt = `You are assisting a party wall surveyor conducting a Schedule of Condition inspection.

Your job is to process each dictated note as it comes in. You must:

1. ROOM/AREA DECLARATIONS — If the note declares a new room or area (e.g. "moving into the kitchen", "we're now in the rear bedroom", "continuing at the rear elevation"), respond with the section name only, e.g.: "Kitchen — rear elevation. Got it."

2. CORRECTIONS — If the note corrects or amends a previous note (signals: "scratch that", "strike that", "actually", "correction", "go back", "that last note", "ignore that", "change that"), identify which previous note is being corrected, describe the amendment in one line, e.g.: "Amended note [3] — moved to front bedroom."

3. CONTRADICTIONS — If the note contradicts a previous note about the same element, flag and reconcile: "Updated — [brief description of what changed]."

4. NORMAL OBSERVATIONS — For everything else, respond with just: "Noted."

Rules:
- Keep responses to one line maximum.
- Never repeat the note back.
- Never ask questions.
- Never add commentary.
- Just respond with one of the four patterns above.

Previous notes this session:
${previousContext}`;

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
    const aiResponse = openaiData.choices?.[0]?.message?.content?.trim() || 'Noted.';

    // ── 4. Determine current section ────────────────────────────────────────
    // If this note is a room declaration, extract the section name
    // Otherwise inherit from the last note that had a section
    let currentSection = previousNotes?.length
      ? [...previousNotes].reverse().find(n => n.current_section)?.current_section || null
      : null;

    // If AI confirmed a new section, extract it from the response
    const isRoomDeclaration = aiResponse.includes('Got it.') && !aiResponse.startsWith('Noted');
    if (isRoomDeclaration) {
      currentSection = aiResponse.replace('Got it.', '').replace('.', '').trim();
    }

    // ── 5. Detect if this is a correction ───────────────────────────────────
    const correctionSignals = ['scratch that', 'strike that', 'actually', 'correction', 'go back', 'that last note', 'ignore that', 'change that'];
    const isCorrection = correctionSignals.some(s => note.toLowerCase().includes(s));

    // ── 6. Save note to Supabase ─────────────────────────────────────────────
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
        ai_response: aiResponse,
      });

    if (insertError) throw insertError;

    // ── 7. Return response ───────────────────────────────────────────────────
    return res.status(200).json({
      response: aiResponse,
      sequence,
      current_section: currentSection,
      is_correction: isCorrection,
    });

  } catch (err) {
    console.error('process-soc-note error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process note' });
  }
}
