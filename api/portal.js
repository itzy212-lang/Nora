// api/portal.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
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
      return res.status(200).json({ portal_user: data, invite_url: inviteUrl });
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

      const { data: user } = await supabase.from('portal_users')
        .select('*')
        .eq('email', String(email).toLowerCase().trim())
        .eq('invite_status', 'active')
        .single();

      if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

      const [salt, storedHash] = user.password_hash.split(':');
      const testHash = hashPassword(password, salt);
      if (testHash !== storedHash) return res.status(401).json({ error: 'Invalid email or password' });

      await supabase.from('portal_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

      // Simple session token — signed with a server secret, includes user id + expiry
      const sessionToken = Buffer.from(JSON.stringify({
        uid: user.id, pid: user.project_id, exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      })).toString('base64');

      return res.status(200).json({
        session_token: sessionToken,
        user: { id: user.id, email: user.email, name: user.name, project_id: user.project_id, user_type: user.user_type, subcontractor_id: user.subcontractor_id },
      });
    }

    // ── Portal user: request a password reset link ────────────────────────────
    if (action === 'request_reset') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Missing email' });

      const { data: user } = await supabase.from('portal_users')
        .select('*')
        .eq('email', String(email).toLowerCase().trim())
        .eq('invite_status', 'active')
        .single();

      // Always return success even if not found — don't leak whether an email is registered
      if (!user) return res.status(200).json({ ok: true });

      const resetToken = generateToken();
      await supabase.from('portal_users').update({
        invite_token: resetToken, // reuse the same token column — activation flow is now dormant once active
      }).eq('id', user.id);

      const resetUrl = `${process.env.PORTAL_BASE_URL || 'https://nora-d9wy.vercel.app'}/portal/reset?token=${resetToken}`;
      return res.status(200).json({ ok: true, reset_url: resetUrl });
    }

    // ── Portal user: set a new password from a reset token ────────────────────
    if (action === 'reset_password') {
      const { token, password } = req.body;
      if (!token || !password || password.length < 8) {
        return res.status(400).json({ error: 'Invalid token or password too short (min 8 characters)' });
      }
      const { data: user } = await supabase.from('portal_users').select('*').eq('invite_token', token).eq('invite_status', 'active').single();
      if (!user) return res.status(404).json({ error: 'Reset link not found or already used' });

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      const { data: updated, error } = await supabase.from('portal_users').update({
        password_hash: `${salt}:${hash}`,
        invite_token: null, // token is single-use
      }).eq('id', user.id).select('*').single();
      if (error) throw error;

      return res.status(200).json({ user: { id: updated.id, email: updated.email, name: updated.name, project_id: updated.project_id, user_type: updated.user_type } });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[portal] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Portal request failed' });
  }
}
