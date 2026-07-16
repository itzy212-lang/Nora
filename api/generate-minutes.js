// api/generate-minutes.js
export const config = { maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { extractMinutesClaims, draftMinutes } from './lib/minutes-pipeline.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OpenAI API key' });

    const { action } = req.body || {};

    // ── Save a single dictated note, extract claims live ────────────────────
    if (action === 'save_note') {
      const { session_id, project_id, content, week_label, visit_date, attended_by } = req.body;
      if (!content || !String(content).trim()) {
        return res.status(400).json({ error: 'Missing note content' });
      }

      let sessionId = session_id;

      // Create session if this is the first note
      if (!sessionId) {
        const { data: newSession, error: sessionErr } = await supabase
          .from('minutes_sessions')
          .insert([{
            project_id,
            week_label: week_label || 'Week 1',
            visit_date: visit_date || new Date().toISOString().slice(0, 10),
            attended_by: attended_by || null,
            status: 'draft',
          }])
          .select('*')
          .single();
        if (sessionErr) throw sessionErr;
        sessionId = newSession.id;
      }

      // Get next note sequence
      const { data: existingNotes } = await supabase
        .from('minutes_notes')
        .select('note_sequence')
        .eq('session_id', sessionId)
        .order('note_sequence', { ascending: false })
        .limit(1);
      const nextSeq = (existingNotes?.[0]?.note_sequence || 0) + 1;

      // Save the raw note
      const { data: savedNote, error: noteErr } = await supabase
        .from('minutes_notes')
        .insert([{ session_id: sessionId, note_sequence: nextSeq, content: content.trim() }])
        .select('*')
        .single();
      if (noteErr) throw noteErr;

      // Get project rooms for room matching
      const { data: rooms } = await supabase.from('project_rooms').select('*').eq('project_id', project_id).order('position');
      const roomNames = (rooms || []).map(r => r.name);

      // Get prior notes this session for context
      const { data: priorNotes } = await supabase
        .from('minutes_notes')
        .select('note_sequence, content')
        .eq('session_id', sessionId)
        .lt('note_sequence', nextSeq)
        .order('note_sequence');
      const priorNotesText = (priorNotes || []).map(n => `[${n.note_sequence}] ${n.content}`).join('\n');

      // Extract claims for this note
      let claims = [];
      try {
        claims = await extractMinutesClaims(content.trim(), priorNotesText, roomNames, apiKey);
      } catch (extractErr) {
        console.error('[generate-minutes] extraction failed:', extractErr.message);
        // Non-fatal — note is saved even if extraction fails; can be regenerated later
      }

      // Match claims to room_ids and save
      const roomLookup = {};
      (rooms || []).forEach(r => { roomLookup[(r.name || '').toLowerCase().trim()] = r.id; });

      const claimRows = claims.map((c, i) => ({
        session_id: sessionId,
        note_sequence: nextSeq,
        claim_sequence: i + 1,
        room_id: c.room_name ? (roomLookup[c.room_name.toLowerCase().trim()] || null) : null,
        room_name_raw: c.room_name || null,
        description: c.description || '',
        action: c.action || 'None',
        severity: c.severity || 'none',
        is_general_note: !!c.is_general_note,
        status: 'active',
      }));

      if (claimRows.length) {
        await supabase.from('minutes_claims').insert(claimRows);
      }

      // Build a short acknowledgement summarising what was detected
      let ack = 'Noted';
      if (claims.length === 1) {
        const c = claims[0];
        ack = c.is_general_note
          ? 'Noted — general note'
          : `Noted — ${c.room_name || 'unassigned'}${c.severity === 'urgent' ? ' (flagged urgent)' : ''}`;
      } else if (claims.length > 1) {
        ack = `Noted — ${claims.length} items captured`;
      }

      return res.status(200).json({ session_id: sessionId, note: savedNote, claims: claimRows, ack });
    }

    // ── List sessions for a project (history sidebar) ────────────────────────
    if (action === 'list_sessions') {
      const { project_id } = req.body;
      const { data: sessions, error } = await supabase
        .from('minutes_sessions')
        .select('*')
        .eq('project_id', project_id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Attach note counts
      const withCounts = await Promise.all((sessions || []).map(async (s) => {
        const { count } = await supabase.from('minutes_notes').select('*', { count: 'exact', head: true }).eq('session_id', s.id);
        return { ...s, note_count: count || 0 };
      }));

      return res.status(200).json({ sessions: withCounts });
    }

    // ── Load a session's full note + claim history ───────────────────────────
    if (action === 'load_session') {
      const { session_id } = req.body;
      const { data: session } = await supabase.from('minutes_sessions').select('*').eq('id', session_id).single();
      const { data: notes } = await supabase.from('minutes_notes').select('*').eq('session_id', session_id).order('note_sequence');
      const { data: claims } = await supabase.from('minutes_claims').select('*').eq('session_id', session_id).eq('status', 'active');
      return res.status(200).json({ session, notes: notes || [], claims: claims || [] });
    }

    // ── Generate the final document from all active claims ───────────────────
    if (action === 'generate') {
      const { session_id, project_id } = req.body;

      const { data: session } = await supabase.from('minutes_sessions').select('*').eq('id', session_id).single();
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const { data: claims } = await supabase.from('minutes_claims').select('*').eq('session_id', session_id).eq('status', 'active');
      if (!claims || !claims.length) {
        return res.status(400).json({ error: 'No notes captured yet for this session' });
      }

      const { data: project } = await supabase.from('projects').select('*').eq('id', project_id).single();

      // Check programme for completeness — flag anything due this week not mentioned
      const { data: tasks } = await supabase.from('programme_tasks').select('*').eq('project_id', project_id);
      const today = new Date();
      const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dueThisWeek = (tasks || []).filter(t => {
        if (!t.end_date || t.status === 'complete') return false;
        const end = new Date(t.end_date);
        return end >= today && end <= weekEnd;
      });
      const mentionedRoomIds = new Set(claims.map(c => c.room_id).filter(Boolean));
      const missedTasks = dueThisWeek.filter(t => t.room_id && !mentionedRoomIds.has(t.room_id));

      const draft = await draftMinutes(claims, {
        address: project?.bo_premise_address || project?.bo_address || '',
        week_label: session.week_label,
        visit_date: session.visit_date,
      }, process.env.OPENAI_API_KEY);

      await supabase.from('minutes_sessions').update({
        status: 'generated',
        generated_at: new Date().toISOString(),
      }).eq('id', session_id);

      return res.status(200).json({
        draft,
        missed_tasks: missedTasks.map(t => ({ title: t.title, end_date: t.end_date })),
        session,
      });
    }

    // ── Rename a session (e.g. change "Week 2" to "Week 3") ──────────────────
    if (action === 'rename_session') {
      const { session_id, week_label } = req.body;
      const { data } = await supabase.from('minutes_sessions').update({ week_label }).eq('id', session_id).select('*').single();
      return res.status(200).json({ session: data });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[generate-minutes] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Weekly minutes request failed' });
  }
}
