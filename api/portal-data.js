// api/portal-data.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function verifySession(sessionToken) {
  try {
    const decoded = JSON.parse(Buffer.from(sessionToken, 'base64').toString('utf8'));
    if (!decoded.uid || !decoded.pid || !decoded.exp) return null;
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Given a portal user's identity, return the visibility filter condition to apply
function buildVisibilityFilter(user) {
  // Client sees anything shared with visible_to_type='client', or targeted directly at their portal_user_id
  // Subcontractor sees anything shared with their specific subcontractor_id, or targeted directly at their portal_user_id
  if (user.user_type === 'subcontractor') {
    return { visible_to_type: 'subcontractor', visible_to_subcontractor_id: user.subcontractor_id };
  }
  return { visible_to_type: 'client' };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { session_token, action } = req.body || {};
    const session = verifySession(session_token);
    if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

    const { data: portalUser } = await supabase.from('portal_users').select('*').eq('id', session.uid).eq('invite_status', 'active').single();
    if (!portalUser) return res.status(401).json({ error: 'User not found or inactive' });

    const projectId = session.pid;
    const visFilter = buildVisibilityFilter(portalUser);

    // ── Programme (Gantt) — only tasks with an approved visibility row ────────
    if (action === 'programme') {
      let visQuery = supabase.from('portal_visibility').select('item_id').eq('project_id', projectId).eq('item_type', 'programme_task').eq('visible_to_type', visFilter.visible_to_type);
      if (visFilter.visible_to_subcontractor_id) visQuery = visQuery.eq('visible_to_subcontractor_id', visFilter.visible_to_subcontractor_id);
      const { data: visRows } = await visQuery;
      const visibleIds = (visRows || []).map(v => v.item_id);
      if (!visibleIds.length) return res.status(200).json({ tasks: [] });

      const { data: tasks } = await supabase.from('programme_tasks').select('id, title, trade, notes, start_date, end_date, status, room_id, marked_complete_at, project_rooms(name)').in('id', visibleIds);
      return res.status(200).json({ tasks: tasks || [] });
    }

    // ── Site Log — visit history (read-only summary, no internal task detail) ─
    if (action === 'site_log') {
      const { data: sessions } = await supabase.from('minutes_sessions').select('id, week_label, visit_date, status').eq('project_id', projectId).eq('status', 'generated').order('visit_date', { ascending: false });
      return res.status(200).json({ visits: sessions || [] });
    }

    // ── Payments — invoices only, total price never margin/cost breakdown ─────
    if (action === 'payments') {
      if (portalUser.user_type !== 'client') return res.status(200).json({ invoices: [] }); // subcontractors don't see client payments
      const { data: invoices } = await supabase.from('invoices').select('id, invoice_number, invoice_date, due_date, total, status, paid_date').eq('project_id', projectId).order('invoice_date', { ascending: false });
      return res.status(200).json({ invoices: invoices || [] });
    }

    // ── Documents — only files with an approved visibility row ────────────────
    if (action === 'documents') {
      let visQuery = supabase.from('portal_visibility').select('item_id, item_name, item_url, created_at').eq('project_id', projectId).eq('item_type', 'document').eq('visible_to_type', visFilter.visible_to_type);
      if (visFilter.visible_to_subcontractor_id) visQuery = visQuery.eq('visible_to_subcontractor_id', visFilter.visible_to_subcontractor_id);
      const { data: visRows } = await visQuery;
      const documents = (visRows || []).map(v => ({ id: v.item_id, file_name: v.item_name, webUrl: v.item_url, shared_at: v.created_at }));
      return res.status(200).json({ documents });
    }

    // ── Approvals — variations/requests sent to this portal user ──────────────
    if (action === 'approvals') {
      if (portalUser.user_type !== 'client') return res.status(200).json({ approvals: [] }); // v1: approvals are client-facing only
      const { data: approvals } = await supabase.from('portal_approvals').select('*').eq('project_id', projectId).order('sent_at', { ascending: false });
      return res.status(200).json({ approvals: approvals || [] });
    }

    // ── Respond to an approval — accept / reject / comment ─────────────────────
    if (action === 'respond_approval') {
      const { approval_id, response, comment } = req.body;
      if (!['accepted', 'rejected', 'commented'].includes(response)) {
        return res.status(400).json({ error: 'Invalid response type' });
      }
      const { data: approval } = await supabase.from('portal_approvals').select('*').eq('id', approval_id).eq('project_id', projectId).single();
      if (!approval) return res.status(404).json({ error: 'Approval not found' });

      const patch = { responded_by_portal_user_id: portalUser.id };
      if (response !== 'commented') {
        patch.status = response;
        patch.responded_at = new Date().toISOString();
      }
      const { data: updated } = await supabase.from('portal_approvals').update(patch).eq('id', approval_id).select('*').single();

      if (comment) {
        await supabase.from('portal_approval_comments').insert([{
          approval_id, portal_user_id: portalUser.id, is_account_owner: false, content: comment,
        }]);
      }

      return res.status(200).json({ approval: updated });
    }

    // ── Subcontractor marks a task complete — does NOT close it, flags for PM/contractor confirmation ──
    if (action === 'mark_task_complete') {
      const { task_id } = req.body;
      if (!task_id) return res.status(400).json({ error: 'Missing task_id' });

      // Security: only allow marking a task this portal user actually has visibility on
      let visQuery = supabase.from('portal_visibility').select('id').eq('project_id', projectId).eq('item_type', 'programme_task').eq('item_id', task_id).eq('visible_to_type', visFilter.visible_to_type);
      if (visFilter.visible_to_subcontractor_id) visQuery = visQuery.eq('visible_to_subcontractor_id', visFilter.visible_to_subcontractor_id);
      const { data: visRows } = await visQuery;
      if (!visRows || !visRows.length) return res.status(403).json({ error: 'You do not have access to this task' });

      const { data: task } = await supabase.from('programme_tasks').select('*').eq('id', task_id).single();
      if (!task) return res.status(404).json({ error: 'Task not found' });

      await supabase.from('programme_tasks').update({
        marked_complete_by_portal_user_id: portalUser.id,
        marked_complete_at: new Date().toISOString(),
      }).eq('id', task_id);

      // Create a project_task so it surfaces in the main app's Site Log task list and
      // pre-visit summary until a PM/contractor confirms and closes it
      const { data: existingTask } = await supabase.from('project_tasks').select('id')
        .eq('linked_programme_task_id', task_id).eq('source', 'portal_completion').eq('status', 'open').limit(1);
      if (!existingTask || !existingTask.length) {
        await supabase.from('project_tasks').insert([{
          project_id: projectId,
          title: `Confirm complete: ${task.title}${task.room_id ? '' : ''}`,
          description: `${portalUser.name || portalUser.email} marked this as complete on the portal. Confirm before closing.`,
          status: 'open',
          severity: 'follow-up',
          room_id: task.room_id,
          linked_programme_task_id: task_id,
          source: 'portal_completion',
        }]);
      }

      return res.status(200).json({ ok: true });
    }

    // ── Subcontractor marks a task as started — sets in_progress, no confirmation needed ──
    if (action === 'mark_task_started') {
      const { task_id } = req.body;
      if (!task_id) return res.status(400).json({ error: 'Missing task_id' });

      let visQuery = supabase.from('portal_visibility').select('id').eq('project_id', projectId).eq('item_type', 'programme_task').eq('item_id', task_id).eq('visible_to_type', visFilter.visible_to_type);
      if (visFilter.visible_to_subcontractor_id) visQuery = visQuery.eq('visible_to_subcontractor_id', visFilter.visible_to_subcontractor_id);
      const { data: visRows } = await visQuery;
      if (!visRows || !visRows.length) return res.status(403).json({ error: 'You do not have access to this task' });

      await supabase.from('programme_tasks').update({ status: 'in_progress' }).eq('id', task_id);
      return res.status(200).json({ ok: true });
    }

    // ── Subcontractor requests a delay — does NOT change the Gantt, just flags it for the team ──
    if (action === 'request_delay') {
      const { task_id, requested_new_start_date, requested_new_end_date, reason } = req.body;
      if (!task_id) return res.status(400).json({ error: 'Missing task_id' });

      let visQuery = supabase.from('portal_visibility').select('id').eq('project_id', projectId).eq('item_type', 'programme_task').eq('item_id', task_id).eq('visible_to_type', visFilter.visible_to_type);
      if (visFilter.visible_to_subcontractor_id) visQuery = visQuery.eq('visible_to_subcontractor_id', visFilter.visible_to_subcontractor_id);
      const { data: visRows } = await visQuery;
      if (!visRows || !visRows.length) return res.status(403).json({ error: 'You do not have access to this task' });

      const { data: task } = await supabase.from('programme_tasks').select('*').eq('id', task_id).single();
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const { data: delayRequest } = await supabase.from('portal_delay_requests').insert([{
        project_id: projectId, programme_task_id: task_id, portal_user_id: portalUser.id,
        requested_new_start_date: requested_new_start_date || null,
        requested_new_end_date: requested_new_end_date || null,
        reason: reason || null,
      }]).select('*').single();

      // Create a project_task so the team sees it needs a decision
      const dateNote = requested_new_start_date
        ? ` They can do ${requested_new_start_date}${requested_new_end_date ? ` to ${requested_new_end_date}` : ''}.`
        : '';
      await supabase.from('project_tasks').insert([{
        project_id: projectId,
        title: `Delay requested: ${task.title}`,
        description: `${portalUser.name || portalUser.email} has requested a delay.${reason ? ` Reason: ${reason}.` : ''}${dateNote} Authorise or contact them to discuss.`,
        status: 'open',
        severity: 'urgent',
        room_id: task.room_id,
        linked_programme_task_id: task_id,
        source: 'portal_delay_request',
      }]);

      return res.status(200).json({ ok: true, delay_request: delayRequest });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[portal-data] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Portal data request failed' });
  }
}
