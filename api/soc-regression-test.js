// api/soc-regression-test.js
// Protected isolated regression harness for the 17 Park Avenue transcript.
// POST only. Secret required in x-regression-key header. No default secret.
// Reads transcript from fixture session (read-only), runs in an isolated
// temporary session, cleans up, and returns full audit output.

import { createClient } from '@supabase/supabase-js';
import {
  extractAtomicClaims,
  draftFromClaims,
  runQualityAudit,
  runFidelityAudit,
  runCompletenessAudit,
} from './lib/soc-pipeline.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// The 17 Park Avenue fixture session — used as IMMUTABLE SOURCE only.
const FIXTURE_SESSION_ID = 'addc4c06-5224-4141-9dea-214cd3af53b1';

export default async function handler(req, res) {
  // ── Security: POST only, header-only secret, no fallback ────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = req.headers['x-regression-key'];
  const expected = process.env.REGRESSION_TEST_KEY;
  if (!expected) return res.status(500).json({ error: 'REGRESSION_TEST_KEY not configured on server' });
  if (!secret || secret !== expected) return res.status(404).end(); // 404, not 403 — don't confirm existence

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const log = [];
  let tempSessionId = null;
  const startAt = Date.now();

  try {
    // ── 1. Load source transcript (read-only) ──────────────────────────────
    log.push({ stage: 'load_fixture', at: 0 });
    const { data: sourceNotes, error: notesErr } = await supabase
      .from('ai_messages')
      .select('content, created_at')
      .eq('session_id', FIXTURE_SESSION_ID)
      .eq('role', 'user')
      .order('created_at', { ascending: true });

    if (notesErr || !sourceNotes?.length) {
      return res.status(500).json({ error: 'Could not load fixture notes', detail: notesErr?.message });
    }
    log.push({ stage: 'load_fixture', note_count: sourceNotes.length, ms: Date.now() - startAt });

    // ── 2. Create temporary isolated session ───────────────────────────────
    const { data: tempSession, error: sessionErr } = await supabase
      .from('ai_sessions')
      .insert({
        user_id: 'itzy212@gmail.com',
        title: `REGRESSION_TEST_${Date.now()}`,
        auto_title: `REGRESSION_TEST_${Date.now()}`,
        surface: 'soc',
        session_type: 'soc',
        status: 'active',
        metadata: { regression: true, fixture_session: FIXTURE_SESSION_ID },
      })
      .select('id')
      .single();

    if (sessionErr || !tempSession?.id) {
      return res.status(500).json({ error: 'Could not create temp session', detail: sessionErr?.message });
    }
    tempSessionId = tempSession.id;
    log.push({ stage: 'create_temp_session', temp_session_id: tempSessionId, ms: Date.now() - startAt });

    // ── 3. Copy notes into temporary session ───────────────────────────────
    const noteRows = sourceNotes.map((n, i) => ({
      session_id: tempSessionId,
      role: 'user',
      content: n.content,
      surface: 'soc',
    }));
    const { error: insertNotesErr } = await supabase.from('ai_messages').insert(noteRows);
    if (insertNotesErr) throw new Error('Could not copy notes: ' + insertNotesErr.message);
    log.push({ stage: 'copy_notes', count: noteRows.length, ms: Date.now() - startAt });

    // ── 4. Build raw notes text ────────────────────────────────────────────
    const rawNotes = sourceNotes.map((n, i) => `[${i + 1}] ${n.content}`).join('\n\n');
    const projectMeta = {
      bo_address: '15 Park Avenue, London N3 2EJ',
      ao_address: '17 Park Avenue, London N3 2EJ',
      inspection_date: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      proposed_works: 'Rear extension and associated works',
    };

    // ── 5. Extract atomic claims (shared pipeline function) ────────────────
    log.push({ stage: 'claim_extraction', at: Date.now() - startAt });
    const claims = await extractAtomicClaims(rawNotes, OPENAI_KEY);
    log.push({ stage: 'claim_extraction', claim_count: claims.length, ms: Date.now() - startAt });

    // Persist claims to temp session
    if (claims.length) {
      const claimRows = claims.map(c => ({
        session_id: tempSessionId,
        claim_id: c.claim_id,
        source_note_id: c.source_note_id || c.note_sequence || 0,
        note_sequence: c.note_sequence || c.source_note_id || 0,
        sequence: c.claim_sequence || c.sequence || 1,
        claim_sequence: c.claim_sequence || c.sequence || 1,
        claim_type: c.claim_type || 'unresolved',
        section: c.section, element: c.element, location: c.location,
        content: c.content || '',
        confidence: c.confidence || 'high',
        status: c.status || 'active',
        amendment_mode: c.amendment_mode,
        superseded_by: c.superseded_by,
      }));
      await supabase.from('soc_claims').insert(claimRows);
    }

    // ── 6. Professional drafting (shared pipeline, with section batching) ──
    log.push({ stage: 'drafting', at: Date.now() - startAt });
    const draftedResult = await draftFromClaims(claims, projectMeta, OPENAI_KEY);
    log.push({ stage: 'drafting', sections: draftedResult.sections?.length, ms: Date.now() - startAt });

    // ── 7. Quality audit (shared pipeline, batched) ─────────────────────
    log.push({ stage: 'quality_audit', at: Date.now() - startAt });
    const qualityResult = await runQualityAudit(draftedResult, OPENAI_KEY);
    log.push({ stage: 'quality_audit', ms: Date.now() - startAt });

    // ── 8. Fidelity audit (coded + semantic, shared pipeline) ──────────────
    log.push({ stage: 'fidelity', at: Date.now() - startAt });
    const fidelityResult = await runFidelityAudit(qualityResult, claims, OPENAI_KEY);
    log.push({ stage: 'fidelity', issues: fidelityResult.issues.length, ms: Date.now() - startAt });

    // ── 9. Completeness audit ─────────────────────────────────────────────
    const completeness = runCompletenessAudit(qualityResult, claims);

    // ── 10. Save draft state ──────────────────────────────────────────────
    const editState = { sections: qualityResult.sections, saved_at: new Date().toISOString() };
    const { data: reportInsert } = await supabase.from('soc_reports').insert({
      project_id: 'REGRESSION_TEST',
      session_id: tempSessionId,
      template_key: 'soc',
      ao_address: projectMeta.ao_address,
      bo_address: projectMeta.bo_address,
      structured_data: qualityResult,
      edit_state: editState,
      edit_state_at: new Date().toISOString(),
      generation_status: completeness.issues.length > 0 ? 'quality_flagged' : 'complete',
    }).select('id').single();
    const reportId = reportInsert?.id;
    log.push({ stage: 'save_draft', report_id: reportId, ms: Date.now() - startAt });

    // ── 11. Reopen draft (simulate load_edited_preview) ────────────────────
    let reopenedState = null;
    if (reportId) {
      const { data: reopened } = await supabase
        .from('soc_reports')
        .select('edit_state, edit_state_at, structured_data')
        .eq('id', reportId)
        .single();
      reopenedState = reopened?.edit_state || reopened?.structured_data;
    }
    log.push({ stage: 'reopen_draft', sections: reopenedState?.sections?.length, ms: Date.now() - startAt });

    // ── 12. Acceptance criteria ───────────────────────────────────────────
    const sectionTitles = (qualityResult.sections || []).map(s => s.title || '');
    const allObservations = JSON.stringify(qualityResult.sections || []);
    const acceptance = {
      first_floor_front_elevation_present: sectionTitles.some(t => /first.*floor.*front|front.*elevation.*room/i.test(t)),
      no_intermittent_500mm_crack: !(/intermittent/i.test(allObservations) && /500\s*mm/i.test(allObservations)),
      opposite_corner_crack_present: /opposite.*corner|crack.*ceiling.*flat.*roof/i.test(allObservations),
      water_ingress_recorded_dry: /dry|remote.*from.*works|water.*ingress/i.test(allObservations),
      rear_bedroom_window_tests_present: (() => {
        const wt = (allObservations.match(/window.*open|opener/gi) || []).length;
        return wt >= 3;
      })(),
      rear_bedroom_ceiling_general_condition: /rear.*bedroom.*ceiling|ceiling.*rear.*bedroom/i.test(allObservations),
      pitched_roof_gutter_flat_roof_skylight: /pitch.*roof/i.test(allObservations) && /gutter/i.test(allObservations) && /flat.*roof/i.test(allObservations),
      patio_observations_present: /patio/i.test(allObservations),
      no_unresolved_items: (qualityResult.unresolved_notes || []).length === 0,
      completeness_100_percent: completeness.missing_substantive === 0,
    };

    // ── 13. Cleanup: delete all temp data ─────────────────────────────────
    log.push({ stage: 'cleanup', at: Date.now() - startAt });
    if (tempSessionId) {
      if (reportId) {
        await supabase.from('soc_reports').delete().eq('id', reportId);
      }
      await supabase.from('soc_claims').delete().eq('session_id', tempSessionId);
      await supabase.from('ai_messages').delete().eq('session_id', tempSessionId);
      await supabase.from('ai_sessions').delete().eq('id', tempSessionId);
    }
    log.push({ stage: 'cleanup', temp_session_deleted: tempSessionId, ms: Date.now() - startAt });

    // ── 14. Return full results ────────────────────────────────────────────
    return res.status(200).json({
      source_session: FIXTURE_SESSION_ID,
      temp_session_id: tempSessionId,
      source_note_count: sourceNotes.length,
      total_ms: Date.now() - startAt,
      pipeline_log: log,
      // Claims
      total_claims: claims.length,
      active_claims: claims.filter(c => c.status === 'active').length,
      superseded_claims: claims.filter(c => c.status === 'superseded').length,
      unresolved_claims: claims.filter(c => c.status === 'unresolved').length,
      claims_by_section: Object.fromEntries(
        [...new Set(claims.map(c => c.section || 'Unallocated'))].map(sec => [
          sec,
          claims.filter(c => c.section === sec).map(c => ({ id: c.claim_id, type: c.claim_type, status: c.status, content: (c.content || '').slice(0, 100) }))
        ])
      ),
      amendments: claims.filter(c => c.claim_type === 'amendment' || c.amendment_mode),
      // Sections
      sections: qualityResult.sections?.map(s => ({
        title: s.title,
        row_count: s.rows?.length,
        rows: s.rows?.map(r => ({ ref: r.ref, element: r.element, observation: r.observation, flagged: r.flagged, source_claim_ids: r.source_claim_ids })),
      })),
      unresolved_notes: qualityResult.unresolved_notes || [],
      // Audits
      completeness,
      fidelity: fidelityResult,
      quality_flags: (qualityResult.sections || []).flatMap(s => (s.rows || []).filter(r => r.flagged).map(r => ({ section: s.title, ref: r.ref, reason: r.flag_reason }))),
      // Edit state
      saved_edit_state_sections: editState.sections?.length,
      reopened_edit_state_sections: reopenedState?.sections?.length,
      reopened_matches_saved: JSON.stringify(reopenedState?.sections) === JSON.stringify(editState.sections),
      // Acceptance
      acceptance,
      acceptance_passed: Object.values(acceptance).every(Boolean),
      // Cleanup
      cleanup: { temp_session_deleted: tempSessionId, fixture_session_untouched: true },
    });

  } catch (err) {
    // Clean up on error too
    if (tempSessionId) {
      await supabase.from('soc_claims').delete().eq('session_id', tempSessionId).catch(() => {});
      await supabase.from('ai_messages').delete().eq('session_id', tempSessionId).catch(() => {});
      await supabase.from('ai_sessions').delete().eq('id', tempSessionId).catch(() => {});
    }
    return res.status(500).json({ error: err.message, log, ms: Date.now() - startAt });
  }
}
