// api/cron-auto-draft.js
// Runs every 15 minutes via Vercel cron.
// Finds new inbound emails that need a draft response and generates them via Ely.

export const config = { maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';

const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notifications@', 'mailer@', 'newsletter@', 'updates@',
  'bounce@', 'postmaster@',
  'xero.com', 'invoicereminders@', 'accounting@', 'billing@',
  'sage.com', 'quickbooks', 'hmrc', 'gov.uk',
  'linkedin.com', 'twitter.com', 'facebook.com',
  'google.com', 'microsoft.com', 'apple.com',
];

const SKIP_FOLDERS = ['junk', 'spam', 'deleted', 'trash', 'junkemail'];

function shouldSkip(email) {
  const sender = (email.sender_email || '').toLowerCase();
  const folder = (email.folder || '').toLowerCase();
  if (SKIP_FOLDERS.some(f => folder.includes(f))) return 'junk folder';
  if (SKIP_SENDERS.some(s => sender.includes(s))) return 'automated sender';
  if (email.is_replied) return 'already replied';
  if (email.ai_category === 'spam' || email.ai_category === 'newsletter') return 'spam';
  return null;
}

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const isManual = req.method === 'POST' && req.headers['x-nora-manual'] === 'true';
  if (!isCron && !isManual) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const openaiKey = process.env.OPENAI_API_KEY;

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: emails, error } = await supabase
      .from('emails')
      .select('id, subject, body, sender_email, sender_name, received_at, project_id, folder, is_replied, ai_category, thread_id, direction')
      .eq('direction', 'incoming')
      .eq('is_draft', false)
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    const results = { processed: 0, skipped: 0, drafted: 0, errors: 0 };

    for (const email of emails || []) {
      const { data: existing } = await supabase
        .from('email_auto_drafts')
        .select('id')
        .eq('email_id', email.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) { results.skipped++; continue; }

      const skipReason = shouldSkip(email);
      if (skipReason) { results.skipped++; continue; }

      results.processed++;

      try {
        let projectContext = '';
        if (email.project_id) {
          const { data: project } = await supabase
            .from('projects')
            .select('ref, bo_address, bo_names, proposed_works, status')
            .eq('id', email.project_id)
            .single();
          if (project) {
            projectContext = '\n\nPROJECT: Ref ' + project.ref + ' | ' + project.bo_address + ' | Building Owner: ' + project.bo_names + ' | Works: ' + (project.proposed_works || 'not specified');
          }

          const { data: thread } = await supabase
            .from('emails')
            .select('sender_email, sender_name, body, direction, received_at')
            .eq('thread_id', email.thread_id)
            .neq('id', email.id)
            .order('received_at', { ascending: true })
            .limit(8);

          if (thread?.length) {
            const threadText = thread.map(t =>
              '[' + (t.direction === 'inbound' ? 'FROM: ' + (t.sender_name || t.sender_email) : 'FROM: Itzik Darel') + '] ' + (t.body || '').slice(0, 400)
            ).join('\n\n---\n\n');
            projectContext += '\n\nPREVIOUS THREAD:\n' + threadText;
          }
        }

        // Call ely-smart with full brain — same as Draft with Ely in the app
        const baseUrl = process.env.VERCEL_URL
          ? 'https://' + process.env.VERCEL_URL
          : 'https://nora-d9wy.vercel.app';

        const elyPayload = {
          surface: 'inbox_draft',
          mode: 'draft_with_ely',
          workflowStage: 'draft_with_ely',
          prompt: 'Draft a professional response to this email on behalf of Itzik Darel. Sign off as: Kind regards, Nora | On behalf of Itzik Darel, Square One Consulting. Never agree to meeting times or dates.',
          emailContext: {
            subject: email.subject,
            from: email.sender_name || email.sender_email,
            body: (email.body || '').slice(0, 3000),
            thread: projectContext,
          },
          projectId: email.project_id || null,
          auto_draft: true,
        };

        const elyRes = await fetch(baseUrl + '/api/ely-smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(elyPayload),
        });

        if (!elyRes.ok) throw new Error('ely-smart ' + elyRes.status);
        const elyData = await elyRes.json();
        const draftBody = elyData.reply || elyData.text || elyData.draft || '';
        if (!draftBody) throw new Error('Empty draft from ely-smart');

        const { error: saveError } = await supabase.from('email_auto_drafts').insert({
          email_id: email.id,
          project_id: email.project_id || null,
          thread_id: email.thread_id || null,
          subject: 'Re: ' + (email.subject || ''),
          body: draftBody,
          to_email: email.sender_email,
          to_name: email.sender_name,
          status: 'pending',
          generated_by: 'cron-auto-draft',
          model: 'gpt-5.6-terra',
        });

        if (saveError) throw saveError;
        results.drafted++;

      } catch (e) {
        results.errors++;
        console.error('[cron-auto-draft] Email', email.id, e.message);
      }
    }

    console.log('[cron-auto-draft] Done:', results);
    return res.status(200).json({ ok: true, ...results });

  } catch (err) {
    console.error('[cron-auto-draft] Fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
