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

      const { data: tasks } = await supabase.from('programme_tasks').select('id, title, trade, notes, start_date, end_date, status, room_id, project_rooms(name)').in('id', visibleIds);
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
      let visQuery = supabase.from('portal_visibility').select('item_id').eq('project_id', projectId).eq('item_type', 'document').eq('visible_to_type', visFilter.visible_to_type);
      if (visFilter.visible_to_subcontractor_id) visQuery = visQuery.eq('visible_to_subcontractor_id', visFilter.visible_to_subcontractor_id);
      const { data: visRows } = await visQuery;
      const visibleIds = (visRows || []).map(v => v.item_id);
      if (!visibleIds.length) return res.status(200).json({ documents: [] });

      const { data: docs } = await supabase.from('documents').select('id, file_name, file_url, public_url, signed_url, category, created_at').in('id', visibleIds);
      return res.status(200).json({ documents: docs || [] });
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

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[portal-data] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Portal data request failed' });
  }
}
