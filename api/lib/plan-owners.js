// api/lib/plan-owners.js
//
// 28 Nov 2026. For catch-up jobs that run across every user at once (the embedding backfills): which owners
// may have this feature? Uses the one plan check (api/lib/entitlements.js evaluate()), so the rule is never
// written twice.
//
// Returns null while plans are not enforced (ENTITLEMENTS_ENFORCE is not '1'): the job then behaves exactly as
// it always has. When enforcing, returns { keys } where keys are the owners' ids AND email addresses, because
// emails.user_id and ai_messages.user_id hold either form (stored as text, inconsistently).
import { FEATURES, evaluate, isEnforcing } from './entitlements.js';

export async function allowedOwnerKeys(supabase, feature) {
  if (!isEnforcing()) return null;
  if (!FEATURES[feature]) return { keys: [] };
  const { data: plans } = await supabase.from('user_plans').select('*');
  const ids = (plans || []).filter(row => evaluate(row, feature).allowed).map(row => row.user_id);
  if (!ids.length) return { keys: [] };
  const wanted = new Set(ids);
  const keys = new Set(ids);
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data?.users || []) {
      if (wanted.has(u.id) && u.email) { keys.add(u.email); keys.add(u.email.toLowerCase()); }
    }
    if ((data?.users || []).length < 200) break;
  }
  return { keys: [...keys] };
}

/** Project ids owned by the allowed owners (for tables that only carry project_id). */
export async function allowedProjectIds(supabase, allowed) {
  if (!allowed?.keys?.length) return [];
  const { data } = await supabase.from('projects').select('id').in('user_id', allowed.keys);
  return (data || []).map(p => p.id);
}
