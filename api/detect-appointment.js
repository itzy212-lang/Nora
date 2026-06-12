// api/detect-appointment.js
// Silently analyses an email to detect proposed appointments
// Cross-references diary and other emails to check for clashes

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const { email_id, subject, body, from, thread_id } = req.body || {};
  if (!body && !subject) return res.status(200).json({ appointment_detected: false });

  try {
    // Step 1: Ask GPT if this email contains a proposed appointment
    const detectionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_completion_tokens: 400,
        temperature: 0,
        messages: [{
          role: 'system',
          content: `You are analysing an email to detect if it contains a proposed or confirmed appointment, meeting, inspection, or site visit with a specific date and/or time.

Return ONLY a JSON object in this format:
{
  "detected": true/false,
  "is_confirmed": true/false,
  "is_proposal": true/false,
  "date_text": "the date/time as mentioned e.g. Monday 16 June at 1pm",
  "iso_date": "YYYY-MM-DD or null — always use 2026 as the year unless a different year is explicitly stated in the email","
  "time": "HH:MM or null",
  "person": "name of the person proposing/confirming",
  "address": "property address if mentioned",
  "type": "soc/meeting/inspection/call/other",
  "title": "a short diary-friendly title e.g. Schedule of Condition - 52 Sherrards Way or Inspection - 8 Village Close or Meeting with Andrew",
  "confirm_reply": "a short natural confirmation reply e.g. Thanks Andrew, confirmed for Monday 16 June at 1pm — see you then."
}

Only set detected:true if there is a specific proposed or confirmed date. Vague availability like "let me know when you're free" should return detected:false.
Set is_confirmed:true if both parties have agreed. Set is_proposal:true if only one party has suggested a time.`
        }, {
          role: 'user',
          content: `From: ${from}\nSubject: ${subject}\n\n${body?.slice(0, 2000) || ''}`,
        }],
      }),
    });

    const detectionData = await detectionResponse.json();
    const rawContent = detectionData.choices?.[0]?.message?.content || '{}';
    let detection = {};
    try {
      detection = JSON.parse(rawContent.replace(/```json|```/g, '').trim());
    } catch { return res.status(200).json({ appointment_detected: false }); }

    if (!detection.detected) return res.status(200).json({ appointment_detected: false });

    // Step 2: Check diary for clashes
    const sb = getSupabase();
    let diaryClash = null;
    let emailClash = null;

    if (detection.iso_date && sb) {
      // Check tasks table for same date
      const { data: tasks } = await sb
        .from('tasks')
        .select('title, due_date, start_time, project_address_snapshot')
        .eq('due_date', detection.iso_date)
        .neq('status', 'completed')
        .limit(5);

      if (tasks?.length) {
        // Check for time clash if we have a time
        if (detection.time) {
          const clashingTask = tasks.find(t => {
            if (!t.start_time) return true; // same day, no time = potential clash
            // Simple time comparison — within 1 hour
            const [th, tm] = t.start_time.split(':').map(Number);
            const [dh, dm] = detection.time.split(':').map(Number);
            return Math.abs((th * 60 + tm) - (dh * 60 + dm)) < 60;
          });
          if (clashingTask) {
            diaryClash = `You have "${clashingTask.title}"${clashingTask.start_time ? ' at ' + clashingTask.start_time : ''} already in your diary${clashingTask.project_address_snapshot ? ' at ' + clashingTask.project_address_snapshot : ''}.`;
          }
        } else {
          diaryClash = `You have ${tasks.length} other appointment${tasks.length > 1 ? 's' : ''} on ${detection.date_text?.split(' at ')[0] || 'that day'} — worth checking for clashes.`;
        }
      }

      // Step 3: Check emails for conflicting commitments on same date
      if (!diaryClash && sb) {
        const { data: clashEmails } = await sb
          .from('emails')
          .select('subject, from_name, body_text, received_at')
          .neq('id', email_id)
          .or(`subject.ilike.%${detection.date_text?.split(' ')[0] || ''}%,body_text.ilike.%${detection.date_text?.split(' ')[0] || ''}%`)
          .order('received_at', { ascending: false })
          .limit(5);

        if (clashEmails?.length) {
          // Ask GPT if any of these emails show a conflicting commitment
          const clashCheckResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify({
              model: 'gpt-4o',
              max_completion_tokens: 200,
              temperature: 0,
              messages: [{
                role: 'system',
                content: `Does any of the following email correspondence show that the user has already committed to an appointment on ${detection.date_text}? Reply with JSON: {"clash": true/false, "detail": "brief description if clash found"}`
              }, {
                role: 'user',
                content: clashEmails.map(e => `Subject: ${e.subject}\nFrom: ${e.from_name}\n${(e.body_text || '').slice(0, 300)}`).join('\n\n---\n\n'),
              }],
            }),
          });
          const clashData = await clashCheckResponse.json();
          try {
            const clashResult = JSON.parse(clashData.choices?.[0]?.message?.content?.replace(/```json|```/g, '').trim() || '{}');
            if (clashResult.clash) {
              emailClash = `I also found an email suggesting you may have committed to something else at that time: ${clashResult.detail}`;
            }
          } catch { /* ignore */ }
        }
      }
    }

    const hasClash = !!(diaryClash || emailClash);
    const clashDetail = [diaryClash, emailClash].filter(Boolean).join(' ');

    // Build summary
    const summary = `${detection.person ? detection.person + ' has' : 'Someone has'} ${detection.is_confirmed ? 'confirmed' : 'proposed'} ${detection.date_text}${detection.address ? ' at ' + detection.address : ''}.${!hasClash ? ' Your diary and emails look clear.' : ''}`;

    return res.status(200).json({
      appointment_detected: true,
      is_confirmed: detection.is_confirmed,
      is_proposal: detection.is_proposal,
      has_clash: hasClash,
      clash_detail: clashDetail || null,
      summary,
      date_text: detection.date_text,
      iso_date: detection.iso_date,
      title: detection.title || null,
      time: detection.time,
      person: detection.person,
      address: detection.address,
      confirm_reply: detection.confirm_reply || '',
      pending_booking: {
        taskType: detection.type === 'soc' ? 'soc' : detection.type || 'appointment',
        title: `${detection.type === 'soc' ? 'Schedule of Condition' : 'Appointment'}${detection.address ? ' — ' + detection.address : ''}`,
        dueDate: detection.iso_date,
        startTime: detection.time,
        projectAddress: detection.address || null,
        displayDate: detection.date_text,
      },
    });

  } catch (err) {
    console.error('[detect-appointment] error:', err.message);
    return res.status(200).json({ appointment_detected: false });
  }
}

