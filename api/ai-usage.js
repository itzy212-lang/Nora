// api/ai-usage.js
//
// GET /api/ai-usage  (Authorization: Bearer <user token>)
// Returns the signed-in user's own AI usage: today / last 7 days / last 30 days, split by feature
// and model, with cost worked out from api/lib/ai-usage-prices.js. Each user only ever sees their
// own rows. Read-only.
import { createClient } from '@supabase/supabase-js';
import { costOf, priceFor } from './lib/ai-usage-prices.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function userIdFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error || !user?.id ? null : user.id;
}

const zero = () => ({ calls: 0, prompt: 0, completion: 0, reasoning: 0, cached: 0, truncated: 0, errors: 0, cost: 0, unpricedCalls: 0, estimated: false });

function add(acc, r) {
  acc.calls += Number(r.calls); acc.prompt += Number(r.prompt_tokens); acc.completion += Number(r.completion_tokens);
  acc.reasoning += Number(r.reasoning_tokens); acc.cached += Number(r.cached_tokens);
  acc.truncated += Number(r.truncated); acc.errors += Number(r.errors);
  const cost = costOf(r.model, { prompt: Number(r.prompt_tokens), completion: Number(r.completion_tokens), cached: Number(r.cached_tokens) });
  if (cost == null) acc.unpricedCalls += Number(r.calls);
  else { acc.cost += cost; if (!priceFor(r.model)?.verified) acc.estimated = true; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in' });

  // Owner view: ?scope=all returns everyone's usage plus calls with no owner (background jobs).
  // Only for users listed in NORA_ADMIN_USER_IDS (comma-separated user ids). Everyone else, and
  // anyone not listed, gets their own usage only.
  const admins = String(process.env.NORA_ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  const isAdmin = admins.includes(userId);
  const wantAll = req.query?.scope === 'all';
  if (wantAll && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

  const { data, error } = wantAll
    ? await supabase.rpc('ai_usage_summary_all', { p_days: 30 })
    : await supabase.rpc('ai_usage_summary', { p_user: userId, p_days: 30 });
  if (error) return res.status(500).json({ error: 'Could not load usage' });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const weekAgo = new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const periods = { today: zero(), week: zero(), month: zero() };
  const byFeature = {}; const byModel = {}; const byUser = {};
  for (const r of data || []) {
    const day = String(r.day);
    add(periods.month, r);
    if (day >= weekAgo) add(periods.week, r);
    if (day === today) add(periods.today, r);
    const f = (byFeature[`${r.feature}`] ||= { feature: r.feature, ...zero() }); add(f, r);
    const m = (byModel[r.model || 'unknown'] ||= { model: r.model || 'unknown', ...zero() }); add(m, r);
    if (wantAll) {
      const key = r.user_id || 'system';
      const u = (byUser[key] ||= { user: r.user_id ? key : 'No owner (background and system)', system: !r.user_id, ...zero() }); add(u, r);
    }
  }
  const top = obj => Object.values(obj).sort((a, b) => (b.cost - a.cost) || (b.prompt + b.completion - a.prompt - a.completion)).slice(0, 12);
  return res.status(200).json({ periods, byFeature: top(byFeature), byModel: top(byModel), byUser: wantAll ? top(byUser) : undefined, isAdmin, scope: wantAll ? 'all' : 'me', currency: 'USD' });
}
