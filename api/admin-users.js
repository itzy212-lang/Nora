// api/admin-users.js  (admins only: user_plans.is_admin)
//
// GET  /api/admin-users  -> every user with their plan, in plain words.
// POST /api/admin-users  { user_id, action, ... }  actions:
//   set_addons          { addons: ['soc','assistant'] }                 the bolt-ons they pay for
//   set_complimentary   { addons: [...] | null, until: ISO date | null, note }   free Core + bolt-ons; null addons clears it; until null = indefinitely
//   set_trial           { days }                                        (re)start a free trial of everything
//   lock / unlock       { reason }                                      unlock returns them to an active plan
// Nothing here is enforced yet (api/lib/entitlements.js is record-only); this only sets what will apply.
import { createClient } from '@supabase/supabase-js';
import { ADDONS, describeAccess } from './lib/entitlements.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function adminFrom(req) {
  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user?.id) return null;
  const { data: row } = await supabase.from('user_plans').select('is_admin').eq('user_id', user.id).maybeSingle();
  return row?.is_admin ? user.id : null;
}

const validAddons = a => Array.isArray(a) && a.every(x => ADDONS.includes(x));

async function listUsers() {
  const users = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...(data?.users || []));
    if ((data?.users || []).length < 200) break;
  }
  const { data: plans } = await supabase.from('user_plans').select('*');
  const byId = new Map((plans || []).map(p => [p.user_id, p]));
  const { data: asked } = await supabase.from('upgrade_requests').select('user_id, addon').is('handled_at', null);
  const requestsById = new Map();
  for (const r of asked || []) requestsById.set(r.user_id, [...(requestsById.get(r.user_id) || []), r.addon]);
  return users.map(u => {
    const row = byId.get(u.id) || null;
    return {
      user_id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
      status: row?.status || null, addons: row?.addons || [], complimentary_addons: row?.complimentary_addons ?? null,
      complimentary_until: row?.complimentary_until || null, complimentary_note: row?.complimentary_note || '',
      trial_ends_at: row?.trial_ends_at || null, locked_reason: row?.locked_reason || '', is_admin: !!row?.is_admin,
      access: describeAccess(row),
      upgrade_requests: requestsById.get(u.id) || [],
    };
  }).sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

export default async function handler(req, res) {
  const adminId = await adminFrom(req);
  if (!adminId) return res.status(403).json({ error: 'Admins only' });

  try {
    if (req.method === 'GET') return res.status(200).json({ users: await listUsers() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { user_id: userId, action } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'No user given' });
    const { data: existing } = await supabase.from('user_plans').select('user_id, status').eq('user_id', userId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'That user has no plan record' });

    const b = req.body || {};
    let patch;
    if (action === 'set_addons') {
      if (!validAddons(b.addons)) return res.status(400).json({ error: 'Unknown bolt-on' });
      // A trial becomes a normal (active) plan; a locked account stays locked until it is unlocked.
      patch = { addons: [...new Set(b.addons)], ...(existing.status === 'trial' ? { status: 'active' } : {}) };
    } else if (action === 'set_complimentary') {
      if (b.addons === null) patch = { complimentary_addons: null, complimentary_until: null, complimentary_note: null };
      else {
        if (!validAddons(b.addons)) return res.status(400).json({ error: 'Unknown bolt-on' });
        let until = null;
        if (b.until) {
          until = new Date(b.until);
          if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return res.status(400).json({ error: 'The end date must be in the future' });
          until = until.toISOString();
        }
        patch = { complimentary_addons: [...new Set(b.addons)], complimentary_until: until, complimentary_note: String(b.note || '').slice(0, 300) || null };
      }
    } else if (action === 'set_trial') {
      const days = Math.round(Number(b.days));
      if (!(days >= 1 && days <= 365)) return res.status(400).json({ error: 'Trial length must be 1 to 365 days' });
      patch = { status: 'trial', trial_ends_at: new Date(Date.now() + days * 864e5).toISOString(), locked_reason: null };
    } else if (action === 'lock') {
      if (userId === adminId) return res.status(400).json({ error: 'You cannot lock your own account' });
      patch = { status: 'locked', locked_reason: String(b.reason || '').slice(0, 300) || null };
    } else if (action === 'unlock') {
      patch = { status: 'active', locked_reason: null };
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    const { error } = await supabase.from('user_plans').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    // A bolt-on switched on (paid or free) answers any open request for it.
    const nowOn = [...(patch.addons || []), ...(patch.complimentary_addons || [])];
    if (nowOn.length) await supabase.from('upgrade_requests').update({ handled_at: new Date().toISOString() }).eq('user_id', userId).is('handled_at', null).in('addon', nowOn);
    return res.status(200).json({ ok: true, users: await listUsers() });
  } catch (err) {
    console.error('[admin-users]', err.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
