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
  // Allow Vercel cron (GET) and manual triggers (POST)
  // Also allow any GET from vercel-cron user agent
  const isCron = req.headers['x-vercel-cron'] === '1' || (req.method === 'GET' && req.headers['user-agent']?.includes('vercel-cron'));
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

        // Always load thread history — regardless of project link
        if (email.thread_id) {
          const { data: thread } = await supabase
            .from('emails')
            .select('sender_email, sender_name, body, direction, received_at')
            .eq('thread_id', email.thread_id)
            .neq('id', email.id)
            .order('received_at', { ascending: true })
            .limit(10);

          if (thread?.length) {
            const threadText = thread.map(t =>
              '[' + (t.direction === 'incoming' ? 'FROM: ' + (t.sender_name || t.sender_email) : 'FROM ITZIK:') + ']\n' + (t.body || '').slice(0, 500)
            ).join('\n\n---\n\n');
            projectContext = 'THREAD HISTORY (oldest first):\n' + threadText;
          }
        }

        // Also load project context if linked
        if (email.project_id) {
          const { data: project } = await supabase
            .from('projects')
            .select('ref, bo_address, bo_names, proposed_works, status')
            .eq('id', email.project_id)
            .single();
          if (project) {
            projectContext = 'PROJECT: Ref ' + project.ref + ' | ' + project.bo_address + ' | Building Owner: ' + project.bo_names + ' | Works: ' + (project.proposed_works || 'not specified') + '\n\n' + projectContext;
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
- Propose new meeting times or dates that Itzik has not already offered in the thread. If a meeting time is being proposed for the first time by the other party and Itzik has not offered availability, say Itzik will be in touch to confirm a suitable time

CONFIRMED APPOINTMENTS — SPECIAL RULE:
If the thread shows that a specific call or meeting time has been confirmed (either Itzik offered it and they accepted, or they proposed a time and it was agreed), you should:
1. Acknowledge it warmly — e.g. "Thank you for confirming — I will make sure Itzik is aware that you will be calling at 10:30 tomorrow."
2. Note that it has been added to the diary — e.g. "I have added this to the diary."
3. Keep it short — 2-3 sentences maximum.
Do NOT say "Itzik will be in touch to confirm a suitable time" when the time is already confirmed in the thread.
- Commit to any deadline or timeframe not already established in the project data
- Invent project details, notice dates, fees, surveyor names or any other facts not provided to you
- Give legal advice or make legal determinations
- Agree to fee reductions or variations without instruction
- Make promises on behalf of Itzik that he has not authorised

FIRST PERSON RULES — CRITICAL:
You are Nora, writing on behalf of Itzik Darel. Itzik is the surveyor — he is the one who has received emails, served notices, attended inspections, reviewed documents, and taken actions. You have not done any of these things.

NEVER write:
- "I have received your email" → write "Thank you for your email" or "Itzik has received your email"
- "I have served the notice" → write "the notice has been served" or "Itzik has served the notice"
- "I have reviewed" → write "Itzik has reviewed" or "this has been reviewed"
- "I will be attending" → write "Itzik will be attending"
- "I carried out the inspection" → write "Itzik carried out the inspection"

USE INSTEAD:
- "Thank you for your email" (not "I have received your email")
- "Itzik has..." for things Itzik has done
- "The notice has been..." / "The award has been..." for passive constructions
- "We will..." when referring to Square One Consulting collectively
- "Itzik will be in touch..." for follow-up actions

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

        // Detect confirmed appointment and book calendar event
        try {
          const appointmentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-5.6-luna',
              max_completion_tokens: 200,
              messages: [
                { role: 'developer', content: 'You extract confirmed appointment details from email threads. Respond only with valid JSON or null. If a specific call/meeting time is confirmed in the thread (not just proposed), return: {"confirmed": true, "date": "YYYY-MM-DD", "time": "HH:MM", "duration_minutes": 30, "title": "Call with [name]", "description": "brief context"}. If no confirmed time, return: {"confirmed": false}. Today is ' + new Date().toISOString().split('T')[0] + '.' },
                { role: 'user', content: 'EMAIL FROM: ' + (email.sender_name || email.sender_email) + '\nSUBJECT: ' + email.subject + '\nBODY: ' + (email.body || '').slice(0, 1000) + '\n\n' + (projectContext || '') },
              ],
            }),
          });

          if (appointmentRes.ok) {
            const apptData = await appointmentRes.json();
            const apptText = apptData.choices?.[0]?.message?.content || '';
            const appt = JSON.parse(apptText.replace(/```json|```/g, '').trim());

            if (appt?.confirmed && appt.date && appt.time) {
              const startDt = new Date(appt.date + 'T' + appt.time + ':00');
              const endDt = new Date(startDt.getTime() + (appt.duration_minutes || 30) * 60000);

              // Save to calendar_events table for Nora to display
              await supabase.from('calendar_events').insert({
                title: appt.title || 'Call with ' + (email.sender_name || email.sender_email),
                description: appt.description || 'Auto-booked from email: ' + email.subject,
                start_time: startDt.toISOString(),
                end_time: endDt.toISOString(),
                source: 'nora_auto_draft',
                email_id: email.id,
                project_id: email.project_id || null,
                created_by: 'cron-auto-draft',
              }).catch(e => console.warn('[cron-auto-draft] Calendar insert failed:', e.message));

              console.log('[cron-auto-draft] Booked calendar event:', appt.title, appt.date, appt.time);
            }
          }
        } catch (calErr) {
          console.warn('[cron-auto-draft] Calendar detection failed:', calErr.message);
        }

        results.drafted++;

      } catch (e) {
        results.errors++;
        console.error('[cron-auto-draft] Email', email.id, e.message);
      }
    }

    // ── AUTO-CHASER: send payment reminders for invoices 3+ days overdue ──────
    const chaserResults = { checked: 0, chased: 0, errors: 0 };
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data: overdueInvoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, bill_to_name, bill_to_email, due_date, total, vat_rate, vat_amount, chaser_sent_at, chaser_count')
        .eq('status', 'unpaid')
        .not('due_date', 'is', null)
        .lte('due_date', threeDaysAgo);

      for (const inv of overdueInvoices || []) {
        chaserResults.checked++;
        // Skip if chaser already sent in last 7 days
        if (inv.chaser_sent_at) {
          const daysSince = (Date.now() - new Date(inv.chaser_sent_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < 7) continue;
        }
        if (!inv.bill_to_email) continue;

        try {
          const firstName = (inv.bill_to_name || '').split(' ')[0] || inv.bill_to_name || '';
          const grand = parseFloat(inv.total || 0) + parseFloat(inv.vat_amount || 0);
          const vatNote = parseFloat(inv.vat_rate || 0) > 0 ? ' (inc. VAT)' : '';
          const body = `Hi ${firstName},\n\nI hope you are well. I am writing to follow up on invoice ${inv.invoice_number}${inv.due_date ? `, which was due on ${new Date(inv.due_date).toLocaleDateString('en-GB')},` : ','} for the amount of £${grand.toFixed(2)}${vatNote}. This may be an oversight — if you could please let me know once the invoice has been settled, that would be much appreciated. If you have any questions regarding this invoice, please do not hesitate to get in touch.\n\nKind regards,\nNora\nOn behalf of Itzik Darel`;

          // Send via email API
          const sendRes = await fetch((process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://nora-d9wy.vercel.app') + '/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: inv.bill_to_email,
              subject: `Invoice ${inv.invoice_number} — Payment Reminder`,
              body,
              from_name: 'Square One Consulting',
            }),
          });

          if (sendRes.ok) {
            await supabase.from('invoices').update({
              chaser_sent_at: new Date().toISOString(),
              chaser_count: (inv.chaser_count || 0) + 1,
            }).eq('id', inv.id);
            chaserResults.chased++;
            console.log('[cron-auto-draft] Chaser sent for invoice', inv.invoice_number, 'to', inv.bill_to_email);
          }
        } catch (e) {
          chaserResults.errors++;
          console.warn('[cron-auto-draft] Chaser failed for invoice', inv.invoice_number, e.message);
        }
      }
    } catch (e) {
      console.warn('[cron-auto-draft] Auto-chaser error:', e.message);
    }

    console.log('[cron-auto-draft] Done:', results, 'Chasers:', chaserResults);
    return res.status(200).json({ ok: true, ...results, chasers: chaserResults });

  } catch (err) {
    console.error('[cron-auto-draft] Fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
