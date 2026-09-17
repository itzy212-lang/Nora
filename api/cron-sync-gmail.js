// api/cron-sync-gmail.js
//
// Real gap closed 2026-09-17: sync_outlook already runs every 5
// minutes via a Supabase pg_cron job and loops over every connected
// Outlook account automatically — any user who connects Outlook is
// picked up with zero extra setup. Gmail had no equivalent at all:
// syncing only ever happened on-demand, when a user opened or
// refreshed the Inbox screen inside Nora itself. This is the missing
// piece, built to match the exact same shape: loop over every
// connected Gmail account, not one specific user.

import { createClient } from '@supabase/supabase-js';
import { syncOneGmailAccount } from './sync-gmail.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  // Same auth pattern as cron-auto-draft.js: the documented Vercel
  // cron mechanism (Authorization: Bearer CRON_SECRET) as the primary
  // check, with a manual-trigger escape hatch for testing.
  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}` || (req.method === 'GET' && req.headers['user-agent']?.includes('vercel-cron'));
  const isManual = req.method === 'POST' && req.headers['x-nora-manual'] === 'true';
  if (!isCron && !isManual) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Every account that has actually connected Gmail — not one
    // hardcoded user. Anyone who connects Gmail from here on is
    // picked up automatically, same as Outlook.
    const { data: accounts, error } = await supabase
      .from('user_integrations')
      .select('user_id')
      .not('gmail_refresh_token', 'is', null);

    if (error) throw error;

    const results = [];
    let totalNew = 0, totalSkipped = 0, totalFailed = 0;

    for (const account of accounts || []) {
      try {
        const result = await syncOneGmailAccount(account.user_id);
        results.push({ user_id: account.user_id, ...result });
        if (result.ok) {
          totalNew += result.processed || 0;
          totalSkipped += result.skipped || 0;
          totalFailed += result.failed || 0;
        }
      } catch (err) {
        console.error(`[cron-sync-gmail] account ${account.user_id} failed:`, err.message);
        results.push({ user_id: account.user_id, ok: false, error: err.message });
      }
    }

    // Same cross-provider auto-link pass Outlook triggers, once after
    // the whole loop rather than once per account.
    try {
      await fetch(`${supabaseUrl}/functions/v1/auto-link-emails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: '{}',
      });
    } catch (err) {
      console.warn('[cron-sync-gmail] auto-link-emails trigger failed (non-fatal):', err.message);
    }

    console.log(`[cron-sync-gmail] ${accounts?.length || 0} accounts, new: ${totalNew}, skipped: ${totalSkipped}, failed: ${totalFailed}`);

    return res.status(200).json({
      ok: true,
      accountsProcessed: accounts?.length || 0,
      totalNew,
      totalSkipped,
      totalFailed,
      results,
    });
  } catch (error) {
    console.error('[cron-sync-gmail] fatal:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
