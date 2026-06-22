// api/process-soc-note.js
// Receives one dictated note during a live SOC inspection.
// Saves raw note to Supabase immediately.
// Calls GPT-4o for intelligent classification, section inference, amendment detection
// and structured acknowledgement.
// Returns a meaningful response to the surveyor on site.

import { createClient } from '@supabase/supabase-js';
import {
  CORRECTION_SIGNALS,
  SECTION_KEYWORDS,
  LIVE_NOTE_SYSTEM_PROMPT,
} from './soc-framework.js';
import { noteComplexity, modelForComplexity } from './lib/soc-pipeline.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Infer likely section from note content ────────────────────────────────
function inferSectionFromContent(note) {
  const lower = note.toLowerCase();
  for (const [section, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return section;
  }
  return null;
}

// ── Build session state summary for the GPT prompt ───────────────────────
function buildSessionState(previousNotes, observations, keywordHint = null, inheritedSection = null) {
  if (!previousNotes?.length) return 'No notes recorded yet. This is the first note.';

  const hintText = keywordHint
    ? `\n\nKEYWORD HINT (supporting only — verify with full context): Subject matter may suggest "${keywordHint}". Use only if consistent with context and physical location. Generic terms (wall, floor, window, door) in many sections must not override context.`
    : '';

  const currentSectionText = inheritedSection
    ? `CURRENT ACTIVE SECTION: ${inheritedSection}`
    : 'CURRENT ACTIVE SECTION: Not yet established.';

  const sections = [...new Set(previousNotes
    .map(n => n.current_section || n.inferred_section)
    .filter(Boolean))];

  const activeObs = observations?.filter(o => o.status === 'active') || [];

  const recentNotes = previousNotes.slice(-8).map(n =>
    `[${n.sequence}]${n.current_section ? ` (${n.current_section})` : ''} ${n.raw_note}`
  ).join('\n');

  const obsState = activeObs.slice(0, 20).map(o =>
    `  ${o.id} | ${o.section} | ${o.element || 'element unspecified'} | ${o.observation.slice(0, 100)}`
  ).join('\n');

  return `${currentSectionText}
SECTIONS VISITED: ${sections.join(', ') || 'None yet'}

RECENT NOTES (last 8):
${recentNotes}

ACTIVE OBSERVATIONS (for amendment lookup):
${obsState || '  None yet.'}${hintText}`;
}

// ── Generate a stable observation ID ─────────────────────────────────────
function makeObsId(section, sequence) {
  const prefix = (section || 'unk')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 8);
  return `obs-${prefix}-${String(sequence).padStart(2, '0')}`;
}


// ── Live atomic claim extraction + persistence ────────────────────────────
// Called non-blocking after every dictated note.
// Uses gpt-4o-mini (fast, low latency for on-site use).

// ── Call the PostgreSQL RPC for atomic transactional claim processing ─────────
// The RPC acquires a session-level advisory lock, inserts claims,
// supersedes amended claims and updates note status in one transaction.
async function processNoteViaRpc(supabase, {
  claims, sessionId, noteId, sequence, section,
  noteType, correctionMode, projectId, aoId,
}) {
  const { data, error } = await supabase.rpc('process_soc_note_atomic', {
    p_session_id:      sessionId,
    p_note_id:         noteId,
    p_sequence:        sequence,
    p_claims:          JSON.stringify(claims),
    p_section:         section || null,
    p_note_type:       noteType || 'observation',
    p_correction_mode: correctionMode || null,
    p_project_id:      projectId || null,
    p_ao_id:           aoId || null,
  });
  if (error) throw new Error(`RPC process_soc_note_atomic failed: ${error.message}`);
  return data; // { ok, session_id, note_sequence, claims_inserted, claims_superseded }
}


export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', endpoint: 'process-soc-note' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { note, session_id, project_id, ao_id, resolution, force_section, source_note_index } = req.body;

  // ── Direct resolution path — when user resolves an unresolved note from the UI ─
  // This bypasses normal GPT classification and persists the resolution directly.
  if (resolution && session_id && note) {
    const UUID_RE_local = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeAoIdLocal = ao_id && UUID_RE_local.test(String(ao_id)) ? ao_id : null;

    const validResolutions = ['allocated', 'contextual', 'site_note', 'award_note', 'excluded'];
    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution type' });
    }

    try {
      // Update the existing note status if source_note_index is provided
      if (source_note_index != null) {
        await supabase.from('soc_notes')
          .update({ note_status: resolution === 'allocated' ? 'allocated' : resolution })
          .eq('session_id', session_id)
          .eq('sequence', source_note_index);
      }

      // For 'allocated' resolution, send through professional SOC processing
      if (resolution === 'allocated' && force_section) {
        // Call GPT to produce professional observation wording
        const obsId = makeObsId(force_section, source_note_index || Date.now());
        const processPrompt = `You are a party wall surveyor writing a Schedule of Condition.
Convert this raw dictated note into a single professional Schedule of Condition observation row.
Section: ${force_section}
Raw note: "${note}"

Return JSON only: {"element": "...", "observation": "Professional SOC wording.", "action": "Record only"}`;

        let professionalObs = note;
        try {
          const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer \${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.1, max_tokens: 200,
              messages: [{ role: 'user', content: processPrompt }] }),
          });
          const gptData = await gptRes.json();
          const raw = (gptData.choices?.[0]?.message?.content || '').trim()
            .replace(/^```json\n?/, '').replace(/\n?```$/, '');
          const parsed = JSON.parse(raw);
          professionalObs = parsed.observation || note;

          // Create observation in soc_observations
          await supabase.from('soc_observations').insert({
            id: obsId, session_id,
            project_id: project_id || null, ao_id: safeAoIdLocal,
            section: force_section,
            element: parsed.element || null,
            observation: professionalObs,
            status: 'active',
            source_note_ids: source_note_index != null ? [source_note_index] : [],
          });
        } catch (gptErr) {
          // If GPT fails, insert raw note — still persists
          await supabase.from('soc_observations').insert({
            id: obsId, session_id,
            project_id: project_id || null, ao_id: safeAoIdLocal,
            section: force_section, element: null,
            observation: note, status: 'active',
            source_note_ids: source_note_index != null ? [source_note_index] : [],
          }).catch(() => {});
        }
      }

      return res.status(200).json({ ok: true, resolution, section: force_section || null });
    } catch (resErr) {
      return res.status(500).json({ error: resErr.message || 'Resolution failed' });
    }
  }

  const safeAoId = ao_id && UUID_RE.test(String(ao_id)) ? ao_id : null;

  if (!note?.trim()) return res.status(400).json({ error: 'No note provided' });
  if (!session_id)   return res.status(400).json({ error: 'No session_id provided' });

  try {
    // ── 1. Load previous notes and active observations ────────────────────
    const [{ data: previousNotes, error: notesErr }, { data: observations, error: obsErr }] =
      await Promise.all([
        supabase.from('soc_notes')
          .select('id, sequence, raw_note, current_section, inferred_section, is_correction, ai_response, note_type, observation_id')
          .eq('session_id', session_id)
          .order('sequence', { ascending: true }),
        supabase.from('soc_observations')
          .select('id, section, element, observation, status, source_note_ids')
          .eq('session_id', session_id)
          .eq('status', 'active'),
      ]);

    if (notesErr) throw notesErr;

    const sequence = (previousNotes?.length || 0) + 1;
    const isCorrection = CORRECTION_SIGNALS.some(s => note.toLowerCase().includes(s));
    // Keyword inference provides a HINT only — GPT is the primary classifier
    // Generic terms (window, floor, wall, door) must not cause incorrect allocation
    const keywordHint = inferSectionFromContent(note);
    const inheritedSection = previousNotes?.length
      ? [...previousNotes].reverse().find(n => n.current_section || n.inferred_section)
        ?.current_section || null
      : null;
    // currentSection starts as inherited; GPT will confirm, override or create new section
    const currentSection = inheritedSection;

    // ── 2. Save raw note immediately ──────────────────────────────────────
    const { error: insertError } = await supabase.from('soc_notes').insert({
      session_id,
      project_id: project_id || null,
      ao_id: safeAoId,
      sequence,
      raw_note: note.trim(),
      current_section: inheritedSection,
      inferred_section: keywordHint,
      is_correction: isCorrection,
      note_status: 'pending',
      ai_response: 'Noted.',
    });

    if (insertError) throw insertError;

    // ── 3. Call GPT-4o for intelligent classification ─────────────────────
    const sessionState = buildSessionState(previousNotes, observations, keywordHint, inheritedSection);
    const systemPrompt = LIVE_NOTE_SYSTEM_PROMPT.replace('{{SESSION_STATE}}', sessionState);

    let aiResult = null;
    let aiResponse = 'Noted.';
    let noteType = 'observation';
    let finalSection = currentSection;
    let observationId = null;
    let targetObsId = null;
    let correctionMode = null;

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
          max_tokens: 300,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: note },
          ],
        }),
      });

      const openaiData = await openaiRes.json();
      const rawContent = openaiData.choices?.[0]?.message?.content?.trim() || '';

      // Parse JSON response
      try {
        const jsonStr = rawContent.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        aiResult = JSON.parse(jsonStr);
        aiResponse = aiResult.response || 'Noted.';
        noteType = aiResult.note_type || 'observation';
        correctionMode = aiResult.correction_mode || null;
        targetObsId = aiResult.target_observation_id || null;

        // Determine final section
        if (aiResult.section) {
          finalSection = aiResult.section;
        } else if (noteType === 'room_change' && aiResponse.includes('Got it')) {
          finalSection = aiResponse.replace(/\.\s*Got it\.?/i, '').trim();
        }

        // Generate observation ID for new observations
        if (['observation', 'room_change'].includes(noteType) && aiResult.section_action !== 'contextual') {
          observationId = makeObsId(finalSection, sequence);
        }

      } catch (parseErr) {
        // If JSON parse fails, use the raw text as response
        aiResponse = rawContent.split('\n')[0].slice(0, 200) || 'Noted.';
      }

    } catch (aiErr) {
      console.error('[process-soc-note] OpenAI failed — note saved with Noted.:', aiErr.message);
    }

    // ── 4. Update soc_observations — mode-specific correction behaviour ────
    try {
      const existing = targetObsId ? observations?.find(o => o.id === targetObsId) : null;

      if ((noteType === 'amendment' || noteType === 'addition') && targetObsId) {
        const mode = correctionMode || 'replace';

        if (mode === 'replace' && aiResult?.final_observation) {
          // REPLACE: supersede earlier, create corrected observation
          await supabase.from('soc_observations')
            .update({ status: 'superseded' })
            .eq('id', targetObsId).eq('session_id', session_id);
          const newObsId = makeObsId(finalSection || 'unknown', sequence);
          await supabase.from('soc_observations').insert({
            id: newObsId, session_id,
            project_id: project_id || null, ao_id: safeAoId,
            section: finalSection || existing?.section || 'Unknown',
            element: aiResult.element || existing?.element || null,
            observation: aiResult.final_observation,
            status: 'active', supersedes: [targetObsId],
            source_note_ids: [sequence],
          });
          observationId = newObsId;

        } else if (mode === 'supplement') {
          // SUPPLEMENT: add detail, retain earlier substance, no supersession
          if (existing) {
            const newText = aiResult?.final_observation
              ? existing.observation.trimEnd() + ' ' + aiResult.final_observation
              : existing.observation;
            await supabase.from('soc_observations')
              .update({ observation: newText, source_note_ids: [...(existing.source_note_ids || []), sequence] })
              .eq('id', targetObsId).eq('session_id', session_id);
            observationId = targetObsId;
          }

        } else if (mode === 'qualify' && aiResult?.final_observation) {
          // QUALIFY: update in place with reconciled qualified observation (not superseded)
          if (existing) {
            await supabase.from('soc_observations')
              .update({ observation: aiResult.final_observation, source_note_ids: [...(existing.source_note_ids || []), sequence] })
              .eq('id', targetObsId).eq('session_id', session_id);
            observationId = targetObsId;
          }

        } else if (mode === 'withdraw') {
          // WITHDRAW: mark inactive, no replacement
          await supabase.from('soc_observations')
            .update({ status: 'withdrawn' })
            .eq('id', targetObsId).eq('session_id', session_id);
          observationId = null;

        } else if ((mode === 'correct_measurement' || mode === 'correct_location') && aiResult?.final_observation && existing) {
          // CORRECT DETAIL: update only affected detail, preserve rest
          await supabase.from('soc_observations')
            .update({ observation: aiResult.final_observation, source_note_ids: [...(existing.source_note_ids || []), sequence] })
            .eq('id', targetObsId).eq('session_id', session_id);
          observationId = targetObsId;

        } else if (aiResult?.final_observation) {
          // Fallback replace
          await supabase.from('soc_observations')
            .update({ status: 'superseded' })
            .eq('id', targetObsId).eq('session_id', session_id);
          const newObsId = makeObsId(finalSection || 'unknown', sequence);
          await supabase.from('soc_observations').insert({
            id: newObsId, session_id,
            project_id: project_id || null, ao_id: safeAoId,
            section: finalSection || existing?.section || 'Unknown',
            element: aiResult.element || existing?.element || null,
            observation: aiResult.final_observation,
            status: 'active', supersedes: [targetObsId],
            source_note_ids: [sequence],
          });
          observationId = newObsId;
        }

      } else if (observationId && noteType === 'observation' && finalSection) {
        // New observation
        await supabase.from('soc_observations').insert({
          id: observationId, session_id,
          project_id: project_id || null, ao_id: safeAoId,
          section: finalSection,
          element: aiResult?.element || null,
          observation: aiResult?.final_observation || note.trim(),
          status: 'active',
          source_note_ids: [sequence],
        });
      }
    } catch (obsUpdateErr) {
      console.warn('[process-soc-note] observation update failed:', obsUpdateErr.message);
    }
    // ── 5. Determine note_status ──────────────────────────────────────────
    let noteStatus = 'allocated';
    if (noteType === 'unresolved') noteStatus = 'unresolved';
    else if (noteType === 'contextual') noteStatus = 'contextual';
    else if (noteType === 'site_note') noteStatus = 'site_note';
    else if (noteType === 'question') noteStatus = 'question';
    else if (noteType === 'amendment' || noteType === 'addition') noteStatus = 'amended';

    // ── 6. Update note record with AI results ─────────────────────────────
    await supabase.from('soc_notes')
      .update({
        ai_response: aiResponse,
        current_section: finalSection || inheritedSection,
        inferred_section: keywordHint,
        note_type: noteType,
        note_status: noteStatus,
        observation_id: observationId,
        target_observation_ids: targetObsId ? [targetObsId] : null,
        correction_mode: correctionMode,
      })
      .eq('session_id', session_id)
      .eq('sequence', sequence);


    // ── 7. Extract claims (GPT) then persist atomically via RPC ─────────────────
    // The RPC holds a session-level advisory lock — sequential even across instances.
    let claimCount = 0;
    let claimError = null;
    try {
      const complexity = noteComplexity(note.trim(), noteType, isCorrection);
      const model = modelForComplexity(complexity);
      const maxTokens = complexity === 'high' ? 2000 : 1000;

      // Extract claims for this single note using appropriate model
      const singleNoteText = `[${sequence}] ${note.trim()}`;
      const currentSectionCtx = finalSection ? `CURRENT ACTIVE SECTION: ${finalSection}\n\n` : '';
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.05,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: 'Extract atomic claims from a single site note. Return valid JSON only.' },
            { role: 'user', content: `${currentSectionCtx}Extract every atomic factual claim from this note. Return JSON: { "claims": [{ "claim_id": "c-${sequence}-N", "source_note_id": ${sequence}, "note_sequence": ${sequence}, "claim_sequence": N, "claim_type": "...", "section": "...", "element": "...", "location": "...", "content": "...", "confidence": "high|medium|low", "status": "active|superseded|contextual|unresolved", "superseded_by": null, "amendment_mode": null }] }\n\nNOTE: ${note.trim()}` },
          ],
        }),
      });
      let noteClaims = [];
      if (openaiRes.ok) {
        const oData = await openaiRes.json();
        const raw = (oData.choices?.[0]?.message?.content || '').replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
        try { noteClaims = JSON.parse(raw).claims || []; } catch {}
      }

      if (noteClaims.length > 0) {
        // Persist atomically via PostgreSQL RPC (advisory lock + transaction)
        const rpcResult = await processNoteViaRpc(supabase, {
          claims: noteClaims,
          sessionId: session_id,
          noteId: null, // soc_notes.id not tracked here — updates by session+sequence
          sequence,
          section: finalSection || null,
          noteType,
          correctionMode,
          projectId: project_id || null,
          aoId: safeAoId,
        });
        claimCount = rpcResult?.claims_inserted || noteClaims.length;
        console.log(`[process-soc-note] Note ${sequence}: ${claimCount} claims persisted (model=${model})`);
      }
    } catch (claimErr) {
      claimError = claimErr.message;
      console.warn('[process-soc-note] claim RPC failed for note', sequence, claimErr.message);
    }

    return res.status(200).json({
      response: aiResponse,
      sequence,
      current_section: finalSection || inheritedSection,
      inferred_section: keywordHint,
      note_type: noteType,
      note_status: noteStatus,
      observation_id: observationId,
      is_correction: isCorrection,
      claims_extracted: claimCount,
      claim_error: claimError || undefined,
    });

  } catch (err) {
    console.error('[process-soc-note] fatal error:', err.message);
    return res.status(500).json({
      error: err.message || 'Failed to process note',
      stack: err.stack?.split('\n').slice(0, 3),
    });
  }
}
