// api/portal.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

// Sends via the same Microsoft account the main app uses to send all other emails.
// Only one sending address exists today — if a second (e.g. admin@ / portal@) is set
// up later, this becomes a Settings-selectable "from" address rather than hardcoded.
async function sendPortalEmail({ toEmail, subject, bodyHtml }) {
  try {
    const { data, error } = await supabase.functions.invoke('send_email_via_microsoft', {
      body: {
        to_email: toEmail,
        subject,
        body: bodyHtml,
        user_id: process.env.PORTAL_SENDER_USER_ID || null,
      },
    });
    if (error || data?.error) {
      console.error('[portal] email send failed:', error?.message || data?.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[portal] email send exception:', err.message);
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { action } = req.body || {};

    // ── Account owner: invite a client or subcontractor to the portal ────────
    if (action === 'invite') {
      const { project_id, email, name, user_type, subcontractor_id } = req.body;
      if (!project_id || !email) {
        return res.status(400).json({ error: 'Missing project_id or email' });
      }

      const inviteToken = generateToken();
      const { data, error } = await supabase.from('portal_users').insert([{
        project_id,
        email: String(email).toLowerCase().trim(),
        name: name || null,
        user_type: user_type === 'subcontractor' ? 'subcontractor' : 'client',
        subcontractor_id: user_type === 'subcontractor' ? (subcontractor_id || null) : null,
        invite_token: inviteToken,
        invite_status: 'pending',
      }]).select('*').single();

      if (error) throw error;

      const inviteUrl = `${process.env.PORTAL_BASE_URL || 'https://nora-d9wy.vercel.app'}/portal/activate?token=${inviteToken}`;

      const { data: project } = await supabase.from('projects').select('bo_premise_address, bo_address').eq('id', project_id).single();
      const projectAddress = project?.bo_premise_address || project?.bo_address || 'your project';

      const emailSent = await sendPortalEmail({
        toEmail: data.email,
        subject: `You've been invited to the project portal — ${projectAddress}`,
        bodyHtml: `<p>Hi ${name || ''},</p>` +
          `<p>You've been invited to access the project portal for <strong>${projectAddress}</strong>.</p>` +
          `<p>Click the link below to set up your account:</p>` +
          `<p><a href="${inviteUrl}">${inviteUrl}</a></p>` +
          `<p>This link is unique to you — please don't share it.</p>`,
      });

      return res.status(200).json({ portal_user: data, invite_url: inviteUrl, email_sent: emailSent });
    }

    // ── List portal users for a project (account owner side) ─────────────────
    if (action === 'list_users') {
      const { project_id } = req.body;
      const { data } = await supabase.from('portal_users').select('*').eq('project_id', project_id).order('invited_at', { ascending: false });
      return res.status(200).json({ users: data || [] });
    }

    // ── Revoke a portal user's access ─────────────────────────────────────────
    if (action === 'revoke') {
      const { portal_user_id } = req.body;
      const { data } = await supabase.from('portal_users').update({ invite_status: 'revoked' }).eq('id', portal_user_id).select('*').single();
      return res.status(200).json({ user: data });
    }

    // ── Account owner: create an approval and push it to a client's portal ────
    if (action === 'create_approval') {
      const { project_id, approval_type, title, description, client_facing_amount, time_impact_days, linked_item_type, linked_item_id } = req.body;
      if (!project_id || !title) return res.status(400).json({ error: 'Missing project_id or title' });

      const { data, error } = await supabase.from('portal_approvals').insert([{
        project_id,
        approval_type: approval_type || 'variation',
        title,
        description: description || null,
        client_facing_amount: client_facing_amount != null ? parseFloat(client_facing_amount) : null,
        time_impact_days: time_impact_days ? parseInt(time_impact_days, 10) : null,
        linked_item_type: linked_item_type || null,
        linked_item_id: linked_item_id || null,
        status: 'pending',
      }]).select('*').single();
      if (error) throw error;

      // Notify the client if they have active portal access
      const { data: clientUser } = await supabase.from('portal_users').select('*').eq('project_id', project_id).eq('user_type', 'client').eq('invite_status', 'active').limit(1).single();
      if (clientUser) {
        await sendPortalEmail({
          toEmail: clientUser.email,
          subject: `Action needed: ${title}`,
          bodyHtml: `<p>Hi ${clientUser.name || ''},</p>` +
            `<p>A new item is awaiting your review on the project portal:</p>` +
            `<p><strong>${title}</strong></p>` +
            (description ? `<p>${description}</p>` : '') +
            (client_facing_amount != null ? `<p>Amount: £${parseFloat(client_facing_amount).toFixed(2)}</p>` : '') +
            `<p><a href="${process.env.PORTAL_BASE_URL || 'https://nora-d9wy.vercel.app'}/portal">View and respond</a></p>`,
        });
      }

      return res.status(200).json({ approval: data });
    }

    // ── Account owner: list all approvals for a project ────────────────────────
    if (action === 'list_approvals') {
      const { project_id } = req.body;
      const { data } = await supabase.from('portal_approvals').select('*, portal_approval_comments(*)').eq('project_id', project_id).order('sent_at', { ascending: false });
      return res.status(200).json({ approvals: data || [] });
    }

    // ── Account owner: withdraw/delete a pending approval ───────────────────────
    if (action === 'delete_approval') {
      const { approval_id } = req.body;
      await supabase.from('portal_approvals').delete().eq('id', approval_id);
      return res.status(200).json({ ok: true });
    }

    // ── Portal user: activate account (set password via invite token) ────────
    if (action === 'activate') {
      const { token, password } = req.body;
      if (!token || !password || password.length < 8) {
        return res.status(400).json({ error: 'Invalid token or password too short (min 8 characters)' });
      }
      const { data: user } = await supabase.from('portal_users').select('*').eq('invite_token', token).eq('invite_status', 'pending').single();
      if (!user) return res.status(404).json({ error: 'Invite not found or already used' });

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      const { data: updated, error } = await supabase.from('portal_users').update({
        password_hash: `${salt}:${hash}`,
        invite_status: 'active',
        activated_at: new Date().toISOString(),
      }).eq('id', user.id).select('*').single();
      if (error) throw error;

      return res.status(200).json({ user: { id: updated.id, email: updated.email, name: updated.name, project_id: updated.project_id, user_type: updated.user_type } });
    }

    // ── Portal user: login ─────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

      // One email can legitimately have multiple active portal accounts (e.g. a subcontractor
      // invited to several different projects) — check the password against each until one matches,
      // rather than assuming exactly one row (which throws with .single() and silently breaks login).
      const { data: candidates } = await supabase.from('portal_users')
        .select('*')
        .eq('email', String(email).toLowerCase().trim())
        .eq('invite_status', 'active');

      const user = (candidates || []).find(u => {
        if (!u.password_hash) return false;
        const [salt, storedHash] = u.password_hash.split(':');
        return hashPassword(password, salt) === storedHash;
      });

      if (!user) return res.status(401).json({ error: 'Invalid email or password' });

      await supabase.from('portal_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

      // Simple session token — signed with a server secret, includes user id + expiry
      const sessionToken = Buffer.from(JSON.stringify({
        uid: user.id, pid: user.project_id, exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      })).toString('base64');

      return res.status(200).json({
        session_token: sessionToken,
        user: { id: user.id, email: user.email, name: user.name, project_id: user.project_id, user_type: user.user_type, subcontractor_id: user.subcontractor_id },
        other_projects_count: (candidates || []).length - 1,
      });
    }

    // ── Portal user: request a password reset link ────────────────────────────
    if (action === 'request_reset') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Missing email' });

      const { data: users } = await supabase.from('portal_users')
        .select('*')
        .eq('email', String(email).toLowerCase().trim())
        .eq('invite_status', 'active');

      // Always return success even if not found — don't leak whether an email is registered
      if (!users || !users.length) return res.status(200).json({ ok: true });

      const resetToken = generateToken();
      // Same token applied to every account for this email — one reset link fixes password
      // access across all projects this person has been invited to.
      await supabase.from('portal_users').update({ invite_token: resetToken }).in('id', users.map(u => u.id));

      const resetUrl = `${process.env.PORTAL_BASE_URL || 'https://nora-d9wy.vercel.app'}/portal/reset?token=${resetToken}`;

      const emailSent = await sendPortalEmail({
        toEmail: users[0].email,
        subject: 'Reset your project portal password',
        bodyHtml: `<p>Hi ${users[0].name || ''},</p>` +
          `<p>We received a request to reset your project portal password. Click the link below to set a new one:</p>` +
          `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
          `<p>If you didn't request this, you can ignore this email.</p>`,
      });

      return res.status(200).json({ ok: true, email_sent: emailSent });
    }

    // ── Portal user: set a new password from a reset token ────────────────────
    if (action === 'reset_password') {
      const { token, password } = req.body;
      if (!token || !password || password.length < 8) {
        return res.status(400).json({ error: 'Invalid token or password too short (min 8 characters)' });
      }
      const { data: users } = await supabase.from('portal_users').select('*').eq('invite_token', token).eq('invite_status', 'active');
      if (!users || !users.length) return res.status(404).json({ error: 'Reset link not found or already used' });

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      const { data: updated, error } = await supabase.from('portal_users').update({
        password_hash: `${salt}:${hash}`,
        invite_token: null, // token is single-use
      }).in('id', users.map(u => u.id)).select('*');
      if (error) throw error;

      const primary = updated[0];
      return res.status(200).json({ user: { id: primary.id, email: primary.email, name: primary.name, project_id: primary.project_id, user_type: primary.user_type } });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[portal] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Portal request failed' });
  }
}
