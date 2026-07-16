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

    // ── List open tasks for a project (pre-visit summary + Tasks tab) ────────
    if (action === 'list_open_tasks') {
      const { project_id } = req.body;
      const { data: openTasks } = await supabase
        .from('project_tasks')
        .select('*, project_rooms(name), programme_tasks(title, start_date, end_date)')
        .eq('project_id', project_id)
        .eq('status', 'open')
        .order('created_at', { ascending: true });
      return res.status(200).json({ tasks: openTasks || [] });
    }

    // ── Close a task manually (from Tasks tab or Gantt popup) ─────────────────
    if (action === 'close_task') {
      const { task_id, closed_by } = req.body;
      const { data } = await supabase.from('project_tasks').update({
        status: 'closed', closed_at: new Date().toISOString(), closed_by: closed_by || 'manual',
      }).eq('id', task_id).select('*').single();
      return res.status(200).json({ task: data });
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

      // ── Create/close project_tasks from this session's claims ────────────────
      // Any claim with severity urgent/follow-up becomes a tracked task, linked to
      // a matching programme_task in the same room where the title clearly matches.
      const actionableClaims = claims.filter(c => c.severity === 'urgent' || c.severity === 'follow-up');
      const createdTaskIds = [];

      for (const claim of actionableClaims) {
        // Skip if a task already exists for this exact claim (re-generation safety)
        const { data: existing } = await supabase
          .from('project_tasks')
          .select('id')
          .eq('source_claim_id', claim.id)
          .limit(1);
        if (existing && existing.length) { createdTaskIds.push(existing[0].id); continue; }

        // Try to match a programme task in the same room by keyword overlap
        let linkedProgrammeTaskId = null;
        if (claim.room_id) {
          const roomTasks = (tasks || []).filter(t => t.room_id === claim.room_id && t.status !== 'complete');
          const claimWords = new Set(
            `${claim.description || ''} ${claim.action || ''}`.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3)
          );
          let bestMatch = null;
          let bestScore = 0;
          roomTasks.forEach(rt => {
            const titleWords = (rt.title || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
            const score = titleWords.filter(w => claimWords.has(w)).length;
            if (score > bestScore) { bestScore = score; bestMatch = rt; }
          });
          if (bestMatch && bestScore > 0) linkedProgrammeTaskId = bestMatch.id;
        }

        const { data: newTask } = await supabase.from('project_tasks').insert([{
          project_id,
          title: claim.description?.slice(0, 120) || claim.action,
          description: claim.description || '',
          status: 'open',
          severity: claim.severity,
          room_id: claim.room_id,
          linked_programme_task_id: linkedProgrammeTaskId,
          source: 'weekly_minutes',
          source_session_id: session_id,
          source_claim_id: claim.id,
        }]).select('id').single();
        if (newTask) createdTaskIds.push(newTask.id);
      }

      // Auto-close open tasks whose description strongly matches a "none"-severity
      // claim mentioning the same room — e.g. "tiles have now arrived" resolves "order tiles"
      const resolvedClaims = claims.filter(c => c.severity === 'none' && c.room_id);
      for (const claim of resolvedClaims) {
        const { data: openTasksInRoom } = await supabase
          .from('project_tasks')
          .select('id, title')
          .eq('project_id', project_id)
          .eq('room_id', claim.room_id)
          .eq('status', 'open');
        if (!openTasksInRoom?.length) continue;
        const claimWords = new Set((claim.description || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3));
        for (const ot of openTasksInRoom) {
          const titleWords = (ot.title || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
          const overlap = titleWords.filter(w => claimWords.has(w)).length;
          if (overlap >= 2) {
            await supabase.from('project_tasks').update({
              status: 'closed', closed_at: new Date().toISOString(), closed_by: 'auto (weekly minutes)',
            }).eq('id', ot.id);
          }
        }
      }

      // Generate email drafts for anything flagged urgent or follow-up — one per action item
      const actionableRows = [];
      (draft.rooms || []).forEach(room => {
        (room.rows || []).forEach(row => {
          if (row.severity === 'urgent' || row.severity === 'follow-up') {
            actionableRows.push({ room_name: room.room_name, ...row });
          }
        });
      });

      let emailDrafts = [];
      if (actionableRows.length) {
        try {
          const emailPrompt =
            `You are drafting short, professional emails on behalf of a Project Manager following a weekly site visit.\n\n` +
            `PROJECT: ${project?.bo_premise_address || ''}\n` +
            `VISIT: ${session.week_label}\n\n` +
            `For each action item below, draft a short, clear email to the most likely recipient (a specific trade/contractor if the item names one, otherwise the client). ` +
            `Keep it brief — 2-4 sentences. State the issue and what's needed, in a professional but friendly tone. Do not sign off with a name — end with "Kind regards,".\n\n` +
            `ACTION ITEMS:\n` +
            actionableRows.map((r, i) => `${i + 1}. [${r.room_name}] ${r.description} -- Action: ${r.action}`).join('\n') +
            `\n\nReturn ONLY valid JSON: { "drafts": [ { "recipient_guess": "e.g. Electrician / Client / Supplier", "subject": "...", "body": "..." } ] } — one draft per action item, same order.`;

          const emailRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o',
              temperature: 0.3,
              max_completion_tokens: 1500,
              messages: [{ role: 'user', content: emailPrompt }],
              response_format: { type: 'json_object' },
            }),
          });
          const emailPayload = await emailRes.json();
          const emailRaw = emailPayload.choices?.[0]?.message?.content || '{"drafts":[]}';
          const emailJson = JSON.parse(emailRaw);
          emailDrafts = Array.isArray(emailJson.drafts) ? emailJson.drafts : [];
        } catch (emailErr) {
          console.error('[generate-minutes] email draft generation failed:', emailErr.message);
        }
      }

      await supabase.from('minutes_sessions').update({
        status: 'generated',
        generated_at: new Date().toISOString(),
      }).eq('id', session_id);

      return res.status(200).json({
        draft,
        email_drafts: emailDrafts,
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
