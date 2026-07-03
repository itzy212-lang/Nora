import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { project_id, email_id, subject, body, direction, from_address, to_address, received_at } = req.body;

  if (!project_id || !body) {
    return res.status(400).json({ error: 'project_id and body required' });
  }

  try {
    const dateStr = received_at
      ? new Date(received_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const emailContext = [
      `Date: ${dateStr}`,
      `Direction: ${direction === 'sent' ? 'Email sent by Itzik' : 'Email received by Itzik'}`,
      from_address ? `From: ${from_address}` : null,
      to_address ? `To: ${to_address}` : null,
      subject ? `Subject: ${subject}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `You are extracting project memory facts for a party wall surveyor's practice management system.

Read the following email and extract every important fact that should be remembered for this project. 

Rules:
- Each fact must be a complete, self-contained sentence that makes sense on its own
- Every fact must state WHAT it is, WHO it involves, and WHEN (use the email date)
- Include: figures and what they represent, decisions made, positions agreed or disputed, appointments confirmed, deadlines set, names and roles of people mentioned, documents sent or requested, key statements made
- Do NOT include: greetings, pleasantries, generic statements, filler content
- Do NOT record bare figures without context — write "Enclosure cost estimate of £3,500 given to Emma Collins on ${dateStr}" not just "£3,500"
- If there are no important facts, return an empty array

Return ONLY a JSON array of strings. No preamble, no markdown, no explanation.

Example output:
["Enclosure cost estimate of £3,500 provided to BO Emma Collins on 14 Jun 2026 (email: RE: Sellafield Way party wall).", "BO confirmed they are proceeding with the works and wish to appoint Itzik as Agreed Surveyor on 14 Jun 2026.", "AO surveyor David Vizard requested copy of signed LOA and drawings on 14 Jun 2026."]

EMAIL METADATA:
${emailContext}

EMAIL BODY:
${body.slice(0, 6000)}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.1,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '[]';
    
    let facts = [];
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      facts = JSON.parse(cleaned);
      if (!Array.isArray(facts)) facts = [];
    } catch {
      console.warn('[extract-email-memory] JSON parse failed:', raw.slice(0, 100));
      facts = [];
    }

    if (!facts.length) {
      return res.status(200).json({ ok: true, saved: 0, message: 'No facts extracted' });
    }

    // Save each fact as a row in project_memory
    const sourceType = direction === 'sent' ? 'email_sent' : 'email_received';
    const rows = facts.map((fact, idx) => ({
      project_id,
      source_type: sourceType,
      source_id: email_id || null,
      title: subject ? subject.slice(0, 200) : `Email ${dateStr}`,
      content: fact,
      summary: fact,
      metadata: {
        direction,
        from_address: from_address || null,
        to_address: to_address || null,
        email_date: dateStr,
        extracted_at: new Date().toISOString(),
      },
      importance_score: 0.7,
    }));

    const { error } = await supabase.from('project_memory').insert(rows);

    if (error) {
      console.error('[extract-email-memory] insert error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    console.log(`[extract-email-memory] saved ${facts.length} facts for project ${project_id}`);
    return res.status(200).json({ ok: true, saved: facts.length, facts });

  } catch (err) {
    console.error('[extract-email-memory] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
