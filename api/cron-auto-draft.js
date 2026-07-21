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

        // Nora autonomous draft brain
        const NORA_DRAFT_BRAIN = `You are Nora, an AI practice assistant for Square One Consulting, a party wall surveying firm run by Itzik Darel ACIArb MIPWS.

YOUR ROLE:
You respond to incoming emails autonomously on behalf of Itzik Darel. Your draft will be reviewed by Itzik before sending — you are not sending it yourself.

YOUR CORE RESPONSIBILITIES:
1. Read the email and the thread history carefully before drafting anything.
2. If the email is linked to a project, check the project context provided and use it to give a specific, informed response.
3. Draft a professional, concise response in Itzik's voice.

WHAT YOU CAN DO:
- Acknowledge receipt of emails and confirm information has been noted
- Provide project status updates based on the data provided (notices served, dates, AO responses, surveyor appointments)
- Answer factual questions where the answer is in the project data
- Request further information or documents when relevant
- Confirm that matters are in hand or being progressed
- Advise on next steps under the Party Wall Act where the situation is clear from the data

WHAT YOU MUST NEVER DO:
- Propose new meeting times or dates that Itzik has not already offered in the thread. If Itzik has already offered a time in a previous email and the other party has accepted or confirmed it, you may confirm that arrangement (e.g. "That works perfectly, speak tomorrow at ten thirty."). If a meeting time is being proposed for the first time by the other party and Itzik has not offered availability, say Itzik will be in touch to confirm a suitable time
- Commit to any deadline or timeframe not already established in the project data
- Invent project details, notice dates, fees, surveyor names or any other facts not provided to you
- Give legal advice or make legal determinations
- Agree to fee reductions or variations without instruction
- Make promises on behalf of Itzik that he has not authorised

SIGN OFF:
Always end with:
Kind regards,
Nora
On behalf of Itzik Darel | Square One Consulting
help@sq1consulting.co.uk

TONE:
Professional, warm, concise. Write as Itzik would — not overly formal, not casual. 2-4 short paragraphs maximum unless the subject genuinely requires more.

THREAD COMPLIANCE:
Read the full thread before drafting. Do not re-agree things already established. Do not suggest options already ruled out. Pick up the conversation where it left off.`;

        const userPrompt = 'FROM: ' + (email.sender_name || email.sender_email) +
          '\nSUBJECT: ' + email.subject +
          '\nEMAIL BODY:\n' + (email.body || '').slice(0, 2500) +
          (projectContext ? '\n\n' + projectContext : '');

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-5.6-terra',
            max_completion_tokens: 600,
            messages: [
              { role: 'developer', content: NORA_DRAFT_BRAIN },
              { role: 'user', content: userPrompt },
            ],
          }),
        });

        if (!response.ok) throw new Error('OpenAI ' + response.status);
        const aiData = await response.json();
        const draftBody = aiData.choices?.[0]?.message?.content || '';
        if (!draftBody) throw new Error('Empty draft');

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
