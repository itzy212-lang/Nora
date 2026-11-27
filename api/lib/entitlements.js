// api/lib/entitlements.js
//
// 27 Nov 2026. The ONE place that decides "may this user use this feature?". Do not add plan checks
// anywhere else; call canUse() / checkFeature() so every feature follows the same rule.
//
// Plan = which features. (How much AI is a separate allowance, added later.)
//   essentials : no AI. Generators, job statuses, email and storage integrations, automatic linking by rule.
//   inspect    : essentials + AI Schedule of Condition.
//   complete   : inspect + AI drafting (email, project chat, main chat) and project memory.
//
// Effective plan, in order: locked -> none; complimentary upgrade (until its end date, or indefinitely when
// no end date is set); trial -> complete until the trial ends; an expired trial -> needs a subscription.
//
// MODE: record-only. While ENFORCE is false, canUse() always answers yes and only records (in
// entitlement_would_block) what it would have refused, so the effect can be checked before anyone is
// affected. Set ENTITLEMENTS_ENFORCE=1 on Vercel to enforce.
//
// Provider-neutral by design: nothing here depends on Outlook/Gmail or OneDrive/Google Drive.

export const FEATURES = {
  generators:        'essentials',
  job_statuses:      'essentials',
  email_integration: 'essentials',
  auto_link_emails:  'essentials',
  soc_ai:            'inspect',
  ai_drafting:       'complete',
  project_chat:      'complete',
  main_chat:         'complete',
  project_memory:    'complete',
};

const RANK = { none: 0, essentials: 1, inspect: 2, complete: 3 };

/** The plan a user effectively has right now, plus why. row = a user_plans row (or null). */
export function effectivePlan(row, now = new Date()) {
  if (!row) return { plan: 'none', reason: 'no_plan_row' };
  if (row.status === 'locked') return { plan: 'none', reason: 'locked' };
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (row.complimentary_plan) {
    const until = row.complimentary_until ? new Date(row.complimentary_until).getTime() : null;
    if (until == null || until > t) return { plan: row.complimentary_plan, reason: until == null ? 'complimentary_indefinite' : 'complimentary' };
  }
  if (row.status === 'trial') {
    const ends = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
    if (ends > t) return { plan: 'complete', reason: 'trial' };
    return { plan: 'none', reason: 'trial_expired' };
  }
  return { plan: row.plan || 'essentials', reason: 'subscription' };
}

/** Pure check: { allowed, reason, plan, needs } for a feature. */
export function evaluate(row, feature, now = new Date()) {
  const needs = FEATURES[feature];
  if (!needs) return { allowed: false, reason: 'unknown_feature', plan: 'none', needs: null };
  const eff = effectivePlan(row, now);
  const allowed = RANK[eff.plan] >= RANK[needs];
  return { allowed, reason: allowed ? eff.reason : (eff.plan === 'none' ? eff.reason : 'plan_too_low'), plan: eff.plan, needs };
}

export const isEnforcing = () => process.env.ENTITLEMENTS_ENFORCE === '1';

/** Looks up the user's plan row with the given Supabase (service-role) client. */
export async function loadPlan(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase.from('user_plans').select('*').eq('user_id', userId).maybeSingle();
  return data || null;
}

/** Full check. In record-only mode it always allows, and records what would have been refused. */
export async function checkFeature(supabase, userId, feature) {
  const row = await loadPlan(supabase, userId);
  const result = evaluate(row, feature);
  if (!result.allowed && !isEnforcing()) {
    try {
      await supabase.from('entitlement_would_block').insert({ user_id: userId || null, feature, reason: result.reason, effective_plan: result.plan });
    } catch { /* recording must never break a feature */ }
    return { ...result, allowed: true, recordedOnly: true, wouldHaveBlocked: true };
  }
  return result;
}

export async function canUse(supabase, userId, feature) {
  return (await checkFeature(supabase, userId, feature)).allowed;
}
