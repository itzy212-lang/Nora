// api/lib/ai-gate.js
//
// 28 Nov 2026. Puts the plan check (api/lib/entitlements.js, the only place that decides this) in front of an
// AI endpoint. Wrap the endpoint's handler once:
//     async function handler(req, res) { ... }
//     export default withAiGate('ai_tools', handler);
// Only POST calls are checked; preflight (OPTIONS) and wrong-method calls go straight to the endpoint.
//
// Who is asking comes from the signed-in user's token (the app sends it on every /api call, src/utils/apiAuth.js).
// MODE follows entitlements.js: while ENTITLEMENTS_ENFORCE is not '1', nothing is ever blocked. A call that would
// have been refused is recorded in entitlement_would_block, and a call with no sign-in is recorded there too
// (reason 'not_signed_in') so we can see who is calling without a token before enforcing.
// When enforcing: no sign-in -> 401, plan without the bolt-on -> 402 with a plain message.
import { createClient } from '@supabase/supabase-js';
import { ADDON_NAMES, FEATURES, checkFeature, isEnforcing } from './entitlements.js';
import { setUsageContext } from './ai-usage.js';

let client;
const sb = () => (client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY));

const needName = feature => [].concat(FEATURES[feature] || []).map(a => ADDON_NAMES[a] || a).join(' or ');

/** Returns { ok, userId }. When ok is false the response has already been sent. */
export async function aiGate(req, res, feature) {
  try {
    const h = req.headers?.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    let userId = null;
    // Nora's own server (for example the Gmail sync asking for an email to be indexed) proves itself with the
    // internal secret and names the user it is acting for; the check then applies to that user. With no user
    // named there is nobody to check, so the call goes through.
    if (token && process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
      const named = String(req.headers?.['x-nora-user'] || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(named)) return { ok: true, userId: null };
      const result = await checkFeature(sb(), named, feature);
      if (!result.allowed) { res.status(402).json({ error: `This needs ${needName(feature)}.`, feature, needs: FEATURES[feature] }); return { ok: false, userId: named }; }
      return { ok: true, userId: named };
    }
    if (token) {
      const { data, error } = await sb().auth.getUser(token);
      if (!error) userId = data?.user?.id || null;
    }
    if (!userId) {
      if (isEnforcing()) { res.status(401).json({ error: 'Please sign in to use this' }); return { ok: false, userId: null }; }
      try { await sb().from('entitlement_would_block').insert({ user_id: null, feature, reason: 'not_signed_in', effective_plan: null }); } catch { /* recording only */ }
      return { ok: true, userId: null };
    }
    const result = await checkFeature(sb(), userId, feature);
    if (!result.allowed) {
      res.status(402).json({ error: `This needs ${needName(feature)}. You can add it to your plan.`, feature, needs: FEATURES[feature] });
      return { ok: false, userId };
    }
    return { ok: true, userId };
  } catch (err) {
    console.error('[ai-gate]', err.message);
    // Never let the check itself break a feature while we are only recording.
    if (isEnforcing()) { res.status(503).json({ error: 'Could not check your plan, please try again' }); return { ok: false, userId: null }; }
    return { ok: true, userId: null };
  }
}

export function withAiGate(feature, handler) {
  return async function gated(req, res) {
    if (req.method !== 'POST') return handler(req, res);
    const { ok, userId } = await aiGate(req, res, feature);
    if (!ok) return undefined;
    if (userId) setUsageContext({ userId }); // AI usage tracking: whose calls these are (api/lib/ai-usage.js)
    return handler(req, res);
  };
}
