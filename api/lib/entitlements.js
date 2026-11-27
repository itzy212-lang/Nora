// api/lib/entitlements.js
//
// 27 Nov 2026. The ONE place that decides "may this user use this feature?". Do not add plan checks
// anywhere else; call canUse() / checkFeature() so every feature follows the same rule.
//
// Core plus bolt-ons (prices ex VAT):
//   core      £20  : generators, job statuses, email and storage integrations, automatic linking of emails
//                    to projects by rule. No AI.
//   soc       +£20 : AI Schedule of Condition.
//   assistant +£39 : AI drafting (email, project chat, main chat) and project memory.
//   All three = £79. (How much AI each includes is a separate allowance, added later.)
//
// Access, in order: locked -> none; complimentary (free) access (until its end date, or indefinitely when no end
// date is set) gives Core plus the listed bolt-ons; trial -> everything until the trial ends; an expired trial
// -> none (needs a subscription); otherwise Core plus the bolt-ons the customer pays for.
// Paid and complimentary bolt-ons add together.
//
// MODE: record-only. While ENFORCE is false, canUse() always answers yes and only records (in
// entitlement_would_block) what it would have refused, so the effect can be checked before anyone is
// affected. Set ENTITLEMENTS_ENFORCE=1 on Vercel to enforce.
//
// Provider-neutral by design: nothing here depends on Outlook/Gmail or OneDrive/Google Drive.

export const ADDONS = ['soc', 'assistant'];

export const FEATURES = {
  generators:        'core',
  job_statuses:      'core',
  email_integration: 'core',
  auto_link_emails:  'core',
  soc_ai:           'soc',
  ai_drafting:       'assistant',
  project_chat:      'assistant',
  main_chat:         'assistant',
  project_memory:    'assistant',
  // Every other AI helper (reading documents, summaries, polishing wording, minutes, etc.): no AI without Assistant.
  ai_tools:          'assistant',
  // Voice dictation: chatting by voice (Assistant) or dictating a Schedule of Condition (Schedule of Condition).
  voice:             ['assistant', 'soc'],
};

const clean = list => (Array.isArray(list) ? list.filter(a => ADDONS.includes(a)) : []);
const union = (a, b) => [...new Set([...a, ...b])];

/** What a user effectively has right now: { core, addons, reason }. row = a user_plans row (or null). */
export function effectiveAccess(row, now = new Date()) {
  if (!row) return { core: false, addons: [], reason: 'no_plan_row' };
  if (row.status === 'locked') return { core: false, addons: [], reason: 'locked' };
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Array.isArray(row.complimentary_addons)) {
    const until = row.complimentary_until ? new Date(row.complimentary_until).getTime() : null;
    if (until == null || until > t) {
      return { core: true, addons: union(clean(row.complimentary_addons), row.status === 'active' ? clean(row.addons) : []), reason: until == null ? 'complimentary_indefinite' : 'complimentary' };
    }
  }
  if (row.status === 'trial') {
    const ends = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
    if (ends > t) return { core: true, addons: [...ADDONS], reason: 'trial' };
    return { core: false, addons: [], reason: 'trial_expired' };
  }
  return { core: true, addons: clean(row.addons), reason: 'subscription' };
}

export const ADDON_NAMES = { soc: 'Schedule of Condition', assistant: 'Nora Assistant' };

/** Plain-words name for a set of bolt-ons: "Core", "Core + Nora Assistant", "Core + Nora Assistant + Schedule of Condition". */
export function planLabel(addons) {
  const have = clean(addons);
  const parts = ['assistant', 'soc'].filter(a => have.includes(a)).map(a => ADDON_NAMES[a]);
  return ['Core', ...parts].join(' + ');
}

/** What to show the customer (and the admin) for a plan row: { label, note, reason, core, addons, trialDaysLeft }. */
export function describeAccess(row, now = new Date()) {
  const eff = effectiveAccess(row, now);
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const out = { core: eff.core, addons: eff.addons, reason: eff.reason, label: '', note: '', trialDaysLeft: null };
  if (!eff.core) {
    out.label = eff.reason === 'locked' ? 'Account locked' : eff.reason === 'trial_expired' ? 'Trial ended' : 'No active plan';
    return out;
  }
  if (eff.reason === 'trial') {
    out.trialDaysLeft = Math.max(1, Math.ceil((new Date(row.trial_ends_at).getTime() - t) / 864e5));
    out.label = 'Free trial';
    out.note = `Everything included, ${out.trialDaysLeft} day${out.trialDaysLeft === 1 ? '' : 's'} left`;
    return out;
  }
  out.label = planLabel(eff.addons);
  if (eff.reason === 'complimentary_indefinite') out.note = 'Complimentary';
  else if (eff.reason === 'complimentary') out.note = `Complimentary until ${new Date(row.complimentary_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })}`;
  return out;
}

/** Pure check: { allowed, reason, addons, needs } for a feature. */
export function evaluate(row, feature, now = new Date()) {
  const needs = FEATURES[feature];
  if (!needs) return { allowed: false, reason: 'unknown_feature', addons: [], needs: null };
  const eff = effectiveAccess(row, now);
  if (!eff.core) return { allowed: false, reason: eff.reason, addons: [], needs };
  // needs may be one bolt-on, or a list where any one of them is enough.
  const allowed = needs === 'core' || [].concat(needs).some(n => eff.addons.includes(n));
  return { allowed, reason: allowed ? eff.reason : 'bolt_on_missing', addons: eff.addons, needs };
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
      await supabase.from('entitlement_would_block').insert({ user_id: userId || null, feature, reason: result.reason, effective_plan: result.addons.length ? `core+${result.addons.join('+')}` : 'core' });
    } catch { /* recording must never break a feature */ }
    return { ...result, allowed: true, recordedOnly: true, wouldHaveBlocked: true };
  }
  return result;
}

export async function canUse(supabase, userId, feature) {
  return (await checkFeature(supabase, userId, feature)).allowed;
}
