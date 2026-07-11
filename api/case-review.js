// api/case-review.js
// Async case review endpoint — runs Claude call without Vercel 60s timeout
// POST { action: 'start', project_id, topic } -> { job_id }
// GET  ?job_id=xxx -> { status, result }
// Uses maxDuration: 300 (5 min) via Vercel config

export const config = { maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  );
}

function cleanOutput(text = '') {
  return text.trim();
}

async function runCaseReview({ projectId, topic, sb }) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  // Load emails
  let allEmails = [];
  try {
    const { data } = await sb
      .from('emails')
      .select('subject, sender_email, sender_name, sent_at, body, folder, is_sent')
      .eq('project_id', projectId)
      .order('sent_at', { ascending: true });

    const topicWords = (topic || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = (data || []).map(e => {
      const text = ((e.body || '') + ' ' + (e.subject || '')).toLowerCase();
      const score = topicWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return { ...e, _score: score };
    }).sort((a, b) => b._score - a._score);

    allEmails = scored.slice(0, 50).map(e => ({
      date: e.sent_at ? new Date(e.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      direction: e.is_sent ? 'Sent' : 'Received',
      from: e.sender_name || e.sender_email || '',
      subject: e.subject || '',
      body: (e.body || '').slice(0, 3000),
    }));
  } catch (err) {
    console.warn('[case-review] email load error:', err.message);
  }

  // Load project chat messages
  let allChat = [];
  try {
    const { data } = await sb
      .from('ai_messages')
      .select('role, content, created_at')
      .eq('project_id', projectId)
      .eq('surface', 'project_chat')
      .order('created_at', { ascending: true });

    const topicWords = (topic || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = (data || []).map(m => {
      const text = (m.content || '').toLowerCase();
      const score = topicWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return { ...m, _score: score };
    }).sort((a, b) => b._score - a._score);

    allChat = scored.slice(0, 100).map(m => ({
      date: m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      role: m.role === 'user' ? 'Surveyor' : 'Ely',
      content: (m.content || '').slice(0, 1500),
    }));
  } catch (err) {
    console.warn('[case-review] chat load error:', err.message);
  }

  // Load project details
  let projectAddress = '';
  try {
    const { data } = await sb.from('projects').select('bo_premise_address, address').eq('id', projectId).single();
    projectAddress = data?.bo_premise_address || data?.address || '';
  } catch {}

  const emailsText = allEmails.length
    ? allEmails.map(e => `[${e.date}] ${e.direction} -- From: ${e.from}\nSubject: ${e.subject}\n${e.body}`).join('\n\n---\n\n')
    : 'No emails found.';

  const chatText = allChat.length
    ? allChat.map(m => `[${m.date}] ${m.role}: ${m.content}`).join('\n\n')
    : 'No project chat notes found.';

  const prompt = `You are assisting a party wall surveyor called Itzik (Square One Consulting) with a case review.

Project: ${projectAddress}
Topic to investigate: ${topic}

Your task:
1. Read ALL the correspondence and notes below chronologically
2. Build a structured timeline of key events relevant to the topic
3. Identify patterns — delays, contradictions, jurisdictional overreach, billing anomalies, position changes
4. Extract verbatim quotes from emails that are most relevant — include the date, sender, and exact words
5. Summarise the strongest arguments Itzik can make based on the evidence
6. Flag anything that weakens Itzik's position so he is prepared

Be thorough. This is for use in a professional dispute. Accuracy and evidence matter.

--- ALL EMAILS (${allEmails.length} most relevant, chronological) ---
${emailsText}

--- PROJECT CHAT NOTES (${allChat.length} most relevant) ---
${chatText}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      system: 'You are an expert party wall surveyor assistant helping build evidence-based case files. Be precise, factual, and thorough. Use British English.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Claude case review failed');

  const systemWithHandoff = `This is a bit too large for me -- let me get our admin team on that for you right away.`;
  return cleanOutput(payload.content?.[0]?.text || 'No findings returned.');
}

export default async function handler(req, res) {
  const sb = getSupabase();

  // ── GET — poll for job result ─────────────────────────────────────────
  if (req.method === 'GET') {
    const { job_id } = req.query;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });

    const { data, error } = await sb
      .from('case_review_jobs')
      .select('id, status, result, error, updated_at')
      .eq('id', job_id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Job not found' });
    return res.status(200).json(data);
  }

  // ── POST — start or process ───────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, project_id, topic, job_id } = req.body || {};

    // Start a new job — create record and kick off processing
    if (action === 'start') {
      if (!project_id || !topic) return res.status(400).json({ error: 'project_id and topic required' });

      // Create job record
      const { data: job, error } = await sb
        .from('case_review_jobs')
        .insert([{ project_id, topic, status: 'running' }])
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      // Run the review — this endpoint has maxDuration: 300 so no timeout
      try {
        const result = await runCaseReview({ projectId: project_id, topic, sb });
        await sb.from('case_review_jobs')
          .update({ status: 'complete', result, updated_at: new Date().toISOString() })
          .eq('id', job.id);
        return res.status(200).json({ job_id: job.id, status: 'complete', result });
      } catch (err) {
        await sb.from('case_review_jobs')
          .update({ status: 'error', error: err.message, updated_at: new Date().toISOString() })
          .eq('id', job.id);
        return res.status(500).json({ job_id: job.id, status: 'error', error: err.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
