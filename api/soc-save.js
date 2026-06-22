// api/soc-save.js
// Single self-contained endpoint for all SOC save operations.
// No imports from other api/ files.
// POST { action: 'init_session', project_id, ao_id, ao_address } -> { session_id }
// POST { action: 'save_note', session_id, content, project_id } -> { ok }
// GET  ?project_id=xxx -> { sessions: [...] }
// GET  ?session_id=xxx -> { notes: [...] }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── GET — load session list or notes ────────────────────────────────────
  if (req.method === 'GET') {
    const { project_id, session_id } = req.query;

    // Load notes for a session
    if (session_id) {
      const { data, error } = await supabase
        .from('ai_messages')
        .select('id, role, content, created_at')
        .eq('session_id', session_id)
        .eq('surface', 'soc')
        .order('created_at', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ notes: data || [] });
    }

    // Load all SOC sessions for a project
    if (project_id) {
      const { data: sessions, error } = await supabase
        .from('ai_sessions')
        .select('id, title, ao_id, created_at, last_message_at')
        .eq('project_id', project_id)
        .eq('session_type', 'soc')
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (error) return res.status(500).json({ error: error.message });

      // Get note counts
      const enriched = await Promise.all((sessions || []).map(async s => {
        const { count } = await supabase
          .from('ai_messages')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', s.id)
          .eq('surface', 'soc')
          .eq('role', 'user');
        return {
          sessionId: s.id,
          aoId: s.ao_id,
          aoAddress: s.title || 'Adjoining Owner',
          noteCount: count || 0,
          lastUpdated: s.last_message_at || s.created_at,
        };
      }));
      return res.status(200).json({ sessions: enriched });
    }

    return res.status(400).json({ error: 'Provide project_id or session_id' });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, project_id, ao_id, ao_address, session_id, content } = req.body;

    // Init or find session for this project+AO
    if (action === 'init_session') {
      if (!project_id || !ao_id) return res.status(400).json({ error: 'project_id and ao_id required' });

      // Find existing
      const { data: existing } = await supabase
        .from('ai_sessions')
        .select('id')
        .eq('project_id', project_id)
        .eq('session_type', 'soc')
        .eq('ao_id', String(ao_id))
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing?.[0]?.id) {
        return res.status(200).json({ session_id: existing[0].id, created: false });
      }

      // Create new
      const { data: created, error } = await supabase
        .from('ai_sessions')
        .insert({
          user_id: 'itzy212@gmail.com',
          project_id,
          ao_id: String(ao_id),
          session_type: 'soc',
          surface: 'soc',
          title: ao_address || 'Adjoining Owner',
          auto_title: ao_address || 'Adjoining Owner',
        })
        .select('id')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ session_id: created.id, created: true });
    }

    // Save a note
    if (action === 'save_note') {
      if (!session_id || !content) return res.status(400).json({ error: 'session_id and content required' });

      const { error } = await supabase.from('ai_messages').insert({
        session_id,
        role: 'user',
        content,
        project_id: project_id || null,
        surface: 'soc',
      });

      // Update last_message_at on session
      await supabase.from('ai_sessions')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', session_id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Save manually edited preview state
    if (action === 'save_edited_preview') {
      const { report_id, edited_sections, session_id: editSessionId } = req.body;
      if (!report_id || !edited_sections) {
        return res.status(400).json({ error: 'report_id and edited_sections required' });
      }

      const { error } = await supabase
        .from('soc_reports')
        .update({
          edit_state: { sections: edited_sections, saved_at: new Date().toISOString() },
          edit_state_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', report_id);

      if (error) return res.status(500).json({ error: error.message });

      // Also update soc_drafts content_json
      if (editSessionId) {
        await supabase
          .from('soc_drafts')
          .update({ content_json: { sections: edited_sections, saved_at: new Date().toISOString() } })
          .eq('session_id', editSessionId)
          .order('created_at', { ascending: false });
      }

      return res.status(200).json({ ok: true, saved_at: new Date().toISOString() });
    }

    // Load saved edited preview state
    if (action === 'load_edited_preview') {
      const { report_id } = req.body;
      if (!report_id) return res.status(400).json({ error: 'report_id required' });

      const { data, error } = await supabase
        .from('soc_reports')
        .select('edit_state, edit_state_at, structured_data, preview_html')
        .eq('id', report_id)
        .single();

      if (error) return res.status(500).json({ error: error.message });

      // Return edit_state if it exists, otherwise structured_data
      return res.status(200).json({
        edit_state: data?.edit_state || null,
        edit_state_at: data?.edit_state_at || null,
        structured_data: data?.structured_data || null,
        preview_html: data?.preview_html || null,
      });
    }

    // Mark claims as excluded when a row is deleted from the editable preview
    if (action === 'mark_claims_excluded') {
      const { session_id: claimSession, claim_ids, row_ref } = req.body;
      if (!claim_ids?.length) return res.status(400).json({ error: 'claim_ids required' });

      const supabase2 = supabase; // same client
      const { error } = await supabase2
        .from('soc_claims')
        .update({ status: 'excluded', destination_type: 'excluded', destination_id: row_ref || 'deleted' })
        .in('claim_id', claim_ids)
        .eq('session_id', claimSession || '');

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, excluded: claim_ids.length });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
